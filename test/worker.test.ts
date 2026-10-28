import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { planCatchup, guard, HOUR, MIN, DAY, type Snapshot } from "../src/analyze.ts";
import { parseCron, firesBetween, prevFire } from "../src/cron.ts";
import { GitHub, type Run } from "../src/github.ts";
import { runCatchup } from "../src/catchup.ts";
import { ENGINE } from "../src/worker/engine.generated.ts";
import { render, selectWorkflows, slug, tickFor, type WorkerSpec, type WorkerWorkflow } from "../src/worker.ts";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function load(name: string): Snapshot {
  const s = JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8")) as Snapshot;
  for (const w of s.workflows) w.schedules = w.schedules.map((x) => ({ ...x, parsed: parseCron(x.cron, x.timezone) }));
  return s;
}

/** The workflow file GitHub would serve for a fixture workflow. */
function yamlFor(w: Snapshot["workflows"][0], guarded = false): string {
  const sched = w.schedules.map((s) => `    - cron: "${s.cron}"${s.timezone !== "UTC" ? `\n      timezone: ${s.timezone}` : ""}`).join("\n");
  const steps = guarded ? "      - id: g\n        uses: Blackman99/cronlag@v0\n        with: { mode: guard }\n" : "      - run: echo hi\n";
  return `name: ${w.name}\non:\n  schedule:\n${sched}\n${w.hasDispatch ? "  workflow_dispatch:\n" : ""}jobs:\n  work:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
}

/**
 * A fake api.github.com serving a recorded Snapshot: repo, workflows, contents, filtered/paged runs,
 * and workflow_dispatch (which records the call and, like GitHub, creates a dispatch run a few seconds later).
 */
function fakeGitHub(snap: Snapshot, o: { guarded?: boolean; failDispatch?: number } = {}) {
  const dispatches: { id: number; ref: string; at: number }[] = [];
  const headers: Record<string, string>[] = [];
  let nextRun = 9_000_000;
  const toApi = (r: Run) => ({ id: r.id, run_number: r.number, event: r.event, status: r.status, conclusion: r.conclusion, created_at: new Date(r.created).toISOString(), run_started_at: r.started ? new Date(r.started).toISOString() : null, html_url: r.url });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input));
    headers.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
    const p = u.pathname;
    const full = snap.repo.fullName;
    if (p === `/repos/${full}`) return json({ full_name: full, default_branch: snap.repo.defaultBranch, fork: false, archived: false, private: false, pushed_at: new Date(snap.repo.pushedAt).toISOString(), html_url: snap.repo.url });
    if (p === `/repos/${full}/actions/workflows`) {
      return json({ total_count: snap.workflows.length, workflows: snap.workflows.map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state, html_url: w.url, created_at: w.created ? new Date(w.created).toISOString() : "2024-01-01T00:00:00Z" })) });
    }
    const c = p.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (c) {
      const w = snap.workflows.find((x) => x.path === decodeURIComponent(c[1]));
      return w ? new Response(yamlFor(w, o.guarded)) : json({ message: "Not Found" }, 404);
    }
    const d = p.match(/\/actions\/workflows\/(\d+)\/dispatches$/);
    if (d && init?.method === "POST") {
      const id = Number(d[1]);
      if (o.failDispatch === id) return json({ message: "Resource not accessible by personal access token" }, 403);
      const at = Date.now();
      dispatches.push({ id, ref: JSON.parse(String(init.body)).ref, at });
      const w = snap.workflows.find((x) => x.id === id)!;
      const n = nextRun++;
      w.dispatchRuns.push({ id: n, number: n, event: "workflow_dispatch", status: "queued", conclusion: null, created: at + 3000, started: null, url: `https://github.com/${full}/actions/runs/${n}` });
      return new Response(null, { status: 204 });
    }
    const r = p.match(/\/actions\/workflows\/(\d+)\/runs$/);
    if (r) {
      const w = snap.workflows.find((x) => x.id === Number(r[1]))!;
      const ev = u.searchParams.get("event");
      const created = u.searchParams.get("created") ?? "";
      const [lo, hi] = created.startsWith(">=") ? [Date.parse(created.slice(2)), Infinity] : created.split("..").map((x) => Date.parse(x));
      const pool = ev === "workflow_dispatch" ? w.dispatchRuns : w.scheduleRuns;
      const all = pool.filter((x) => x.created >= lo && x.created <= hi + 999).sort((a, b) => b.created - a.created);
      const per = Number(u.searchParams.get("per_page") ?? 30);
      const page = Number(u.searchParams.get("page") ?? 1);
      return json({ total_count: all.length, workflow_runs: all.slice((page - 1) * per, page * per).map(toApi) });
    }
    return json({ message: `unexpected ${p}` }, 500);
  };
  return { fetch, dispatches, headers };
}

/** Load the printed worker.js as a module, the way Cloudflare does (ES module, default export). */
async function loadWorker(text: string): Promise<{ scheduled: (c: unknown, env: Record<string, string>) => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "cronlag-worker-"));
  const f = join(dir, "worker.mjs");
  writeFileSync(f, text);
  return (await import(pathToFileURL(f).href)).default;
}

function specFor(snap: Snapshot, over: Partial<WorkerSpec> = {}): WorkerSpec {
  const workflows: WorkerWorkflow[] = snap.workflows.filter((w) => w.hasDispatch).map((w) => ({
    file: w.path.split("/").pop()!, path: w.path, name: w.name, id: w.id, state: w.state, schedules: w.schedules.map(({ cron, timezone }) => ({ cron, timezone })), hasDispatch: true, guarded: false, minIntervalMs: null,
  }));
  return { repo: snap.repo.fullName, target: "cloudflare", workflows, graceMs: 15 * MIN, tick: tickFor(10 * MIN), bin: "cronlag", generated: "2026-10-28", ...over };
}

/** Run one scheduled pass of the generated worker at `now` against the fake API; return what it logged. */
async function tick(worker: Awaited<ReturnType<typeof loadWorker>>, api: ReturnType<typeof fakeGitHub>, now: number, env: Record<string, string> = { GITHUB_TOKEN: "github_pat_test" }) {
  const realNow = Date.now;
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const logs: string[] = [];
  Date.now = () => now;
  globalThis.fetch = api.fetch as typeof fetch;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
  try {
    await worker.scheduled({ cron: "4,14,24,34,44,54 * * * *", scheduledTime: now }, env);
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  return logs.join("\n");
}

test("the embedded engine is current (run npm run build)", async () => {
  const r = await build({ bundle: true, platform: "neutral", mainFields: ["module", "main"], format: "iife", globalName: "cronlag", target: "es2022", minify: true, write: false, legalComments: "none", entryPoints: [fileURLToPath(new URL("../src/worker/engine.ts", import.meta.url))], logLevel: "silent" });
  assert.equal(ENGINE, r.outputFiles[0].text.replace(/^"use strict";/, ""), "src/worker/engine.generated.ts is stale: run npm run build");
});

test("tickFor: off minute 0, cron and OnCalendar agree, odd intervals rejected", () => {
  assert.deepEqual(tickFor(10 * MIN), { ms: 10 * MIN, label: "10m", cron: "4,14,24,34,44,54 * * * *", onCalendar: "*-*-* *:04/10:00 UTC" });
  assert.equal(tickFor(5 * MIN).cron, "4,9,14,19,24,29,34,39,44,49,54,59 * * * *");
  assert.equal(tickFor(15 * MIN).onCalendar, "*-*-* *:04/15:00 UTC");
  assert.deepEqual(tickFor(HOUR), { ms: HOUR, label: "1h", cron: "4 * * * *", onCalendar: "*-*-* *:04:00 UTC" });
  assert.equal(tickFor(6 * HOUR).cron, "4 */6 * * *");
  assert.equal(tickFor(6 * HOUR).onCalendar, "*-*-* 00/6:04:00 UTC");
  for (const bad of [2 * MIN, 7 * MIN, 45 * MIN, 5 * HOUR, DAY]) assert.throws(() => tickFor(bad));
  // The cron the worker gets fires at the same instants the timer does.
  for (const ms of [5 * MIN, 10 * MIN, 20 * MIN, 30 * MIN, HOUR, 3 * HOUR]) {
    const fires = firesBetween(parseCron(tickFor(ms).cron), Date.parse("2026-10-28T00:00:00Z"), Date.parse("2026-10-29T00:00:00Z"));
    assert.equal(fires.length, DAY / ms);
    assert.ok(fires.every((t, i) => i === 0 || t - fires[i - 1] === ms));
    assert.ok(fires.every((t) => new Date(t).getUTCMinutes() !== 0));
  }
});

test("slug is a valid Worker / unit name", () => {
  assert.equal(slug("robhunter/agentdeals"), "cronlag-catchup-robhunter-agentdeals");
  assert.equal(slug("fpgas-online/fpgas.online-e2e-tests"), "cronlag-catchup-fpgas-online-fpgas-online-e2e-tests");
  assert.ok(slug("a/" + "x".repeat(100)).length <= 63);
  assert.match(slug("Some.Org/Repo_Name"), /^[a-z0-9-]+$/);
});

test("worker.js parses as an ES module, carries no token, and wrangler.toml matches the tick", async () => {
  const snap = load("agentdeals.json");
  const [js, toml] = render(specFor(snap));
  assert.equal(js.name, "worker.js");
  assert.doesNotMatch(js.text, /github_pat_[A-Za-z0-9]|ghp_[A-Za-z0-9]/);
  assert.match(js.text, /const CONFIG = \{\n  repo: "robhunter\/agentdeals",\n  workflows: \["reverify\.yml"\],\n  graceMinutes: 15,\n\};/);
  assert.doesNotMatch(js.text, /\bimport\b[^(]|\brequire\(/, "no imports: the worker must be self-contained");
  assert.match(toml.text, /^crons = \["4,14,24,34,44,54 \* \* \* \*"\]/m);
  assert.match(toml.text, /^workers_dev = false/m);
  const w = await loadWorker(js.text);
  assert.equal(typeof w.scheduled, "function");
  await assert.rejects(tick(w, fakeGitHub(snap), snap.now, {}), /GITHUB_TOKEN is not set/);
});

test("generated worker decides exactly like planCatchup on every real fixture", async () => {
  let dispatched = 0;
  let passes = 0;
  for (const name of ["agentdeals.json", "fpgas-e2e.json", "kort-facts.json", "cronlag-probe.json"]) {
    const snap = load(name);
    // Walk through the last day in 10-minute ticks: every pass must agree with the analyser.
    for (let now = snap.now - DAY; now <= snap.now; now += 10 * MIN) {
      const cut = { ...snap, now, workflows: snap.workflows.map((w) => ({ ...w, scheduleRuns: w.scheduleRuns.filter((r) => r.created <= now), dispatchRuns: w.dispatchRuns.filter((r) => r.created <= now) })) };
      const expected = planCatchup(cut, 15 * MIN).filter((s) => s.action === "dispatch").map((s) => s.id).sort();
      const api = fakeGitHub(structuredClone(cut));
      const w = await loadWorker(render(specFor(cut))[0].text);
      await tick(w, api, now, { GITHUB_TOKEN: "t", DRY_RUN: "1" });
      assert.equal(api.dispatches.length, 0, "DRY_RUN never dispatches");
      const api2 = fakeGitHub(structuredClone(cut));
      await tick(w, api2, now);
      const dispatchable = new Set(specFor(cut).workflows.map((x) => x.id));
      assert.deepEqual(api2.dispatches.map((d) => d.id).sort(), expected.filter((id) => dispatchable.has(id)), `${name} at ${new Date(now).toISOString()}`);
      dispatched += api2.dispatches.length;
      passes++;
    }
  }
  // Not vacuous: the recorded incidents (late and dropped slots) do trigger dispatches.
  assert.ok(passes > 500 && dispatched > 5, `${passes} passes, ${dispatched} dispatches`);
});

test("late 06:00 slot: dispatched once after grace, then covered; GitHub's late run then guards itself", async () => {
  const snap = load("agentdeals.json");
  const wf = snap.workflows.find((w) => w.path.endsWith("reverify.yml"))!;
  const slot = prevFire(parseCron("0 6 * * *"), snap.now)!;
  // GitHub hasn't created the 06:00 run yet (the incident): drop it and anything after.
  wf.scheduleRuns = wf.scheduleRuns.filter((r) => r.created < slot);
  wf.dispatchRuns = wf.dispatchRuns.filter((r) => r.created < slot);
  const api = fakeGitHub(snap);
  const worker = await loadWorker(render(specFor(snap))[0].text);

  const early = await tick(worker, api, slot + 14 * MIN);
  assert.equal(api.dispatches.length, 0, "inside the 15m grace: nothing yet");
  assert.match(early, /SKIP|COVERED/);

  const first = await tick(worker, api, slot + 24 * MIN);
  assert.equal(api.dispatches.length, 1);
  assert.deepEqual(api.dispatches[0], { id: wf.id, ref: "main", at: slot + 24 * MIN });
  assert.match(first, /DISPATCHED reverify\.yml +06:00 UTC slot \(0 6 \* \* \*\) has no run after 24m/);

  for (let k = 3; k <= 30; k++) await tick(worker, api, slot + (k * 10 + 4) * MIN);
  assert.equal(api.dispatches.length, 1, "idempotent: the dispatch run covers the slot on every later pass");

  const workerHeaders = api.headers.slice();
  // The same answer from `cronlag catchup` on the same API state.
  const gh = new GitHub({ token: "t", fetch: api.fetch as typeof fetch });
  const r = await runCatchup(gh, snap.repo.fullName, { workflows: ["reverify.yml"], now: slot + 2 * HOUR });
  assert.equal(r.steps[0].action, "covered");
  assert.match(r.steps[0].reason, /workflow_dispatch run #\d+ already created after the slot/);

  // GitHub's scheduled run finally arrives 5h50 late: mode: guard tells it to skip.
  const g = guard(parseCron("0 6 * * *"), slot + 350 * MIN, wf.dispatchRuns);
  assert.equal(g.skip, true);

  // Every request was authenticated with the secret, and identified itself.
  assert.ok(workerHeaders.length > 30);
  assert.ok(workerHeaders.every((h) => h.Authorization === "Bearer github_pat_test" && /^cronlag-worker\//.test(h["User-Agent"])));
});

test("a failed dispatch fails the invocation but the other workflows still get theirs", async () => {
  const snap = load("agentdeals.json");
  const slot = Date.parse("2026-10-13T12:00:00Z");
  snap.now = slot + 30 * MIN;
  const daily = (id: number, file: string) => ({ ...snap.workflows[0], id, name: file, path: `.github/workflows/${file}`, schedules: [{ cron: "0 12 * * *", timezone: "UTC", parsed: parseCron("0 12 * * *") }], scheduleRuns: [], dispatchRuns: [] });
  snap.workflows = [daily(1, "a.yml"), daily(2, "b.yml")];
  const api = fakeGitHub(snap, { failDispatch: 1 });
  const worker = await loadWorker(render(specFor(snap))[0].text);
  await assert.rejects(tick(worker, api, snap.now), /dispatch failed: a\.yml: .*Resource not accessible/);
  assert.deepEqual(api.dispatches.map((d) => d.id), [2]);
});

test("selectWorkflows: explicit list, guard detection, no-dispatch workflows left out", async () => {
  const snap = load("agentdeals.json");
  const extra = { ...snap.workflows[0], id: 77, name: "no-dispatch", path: ".github/workflows/nod.yml", hasDispatch: false };
  snap.workflows.push(extra);
  const api = fakeGitHub(snap, { guarded: true });
  const gh = new GitHub({ token: "t", fetch: api.fetch as typeof fetch });
  const sel = await selectWorkflows(gh, snap.repo.fullName);
  assert.ok(sel.workflows.length >= 1);
  assert.ok(sel.workflows.every((w) => w.guarded && w.hasDispatch));
  assert.deepEqual(sel.noDispatch.map((w) => w.file), ["nod.yml"]);
  assert.equal(sel.workflows.find((w) => w.file === "reverify.yml")?.minIntervalMs, DAY);
  await assert.rejects(selectWorkflows(gh, snap.repo.fullName, ["nope.yml"]), /no workflow matches "nope\.yml"/);
});

test("systemd and crontab recipes: catchup command, token from the environment, quoting", () => {
  const snap = load("agentdeals.json");
  const base = specFor(snap, { bin: "npx -y github:Blackman99/cronlag#v0" });
  const [svc, timer] = render({ ...base, target: "systemd" });
  assert.equal(svc.name, "cronlag-catchup-robhunter-agentdeals.service");
  assert.match(svc.text, /^ExecStart=\/usr\/bin\/env npx -y github:Blackman99\/cronlag#v0 catchup robhunter\/agentdeals -w reverify\.yml --grace 15m --dispatch$/m);
  assert.match(svc.text, /^EnvironmentFile=\/etc\/cronlag\/cronlag-catchup-robhunter-agentdeals\.env$/m);
  assert.match(svc.text, /^Type=oneshot$/m);
  assert.match(timer.text, /^OnCalendar=\*-\*-\* \*:04\/10:00 UTC$/m);
  assert.match(timer.text, /^Persistent=true$/m);
  const odd = render({ ...base, target: "systemd", bin: "/opt/node/bin/cronlag", workflows: [{ ...base.workflows[0], file: "100% sure.yml" }] })[0].text;
  assert.match(odd, /^ExecStart=\/opt\/node\/bin\/cronlag catchup robhunter\/agentdeals -w "100%% sure\.yml"/m);
  const [cron] = render({ ...base, target: "crontab" });
  const line = cron.text.split("\n").find((l) => /^\d/.test(l))!;
  assert.equal(line, '4,14,24,34,44,54 * * * *  . "$HOME/.config/cronlag/cronlag-catchup-robhunter-agentdeals.env" && NO_COLOR=1 npx -y github:Blackman99/cronlag#v0 catchup robhunter/agentdeals -w reverify.yml --grace 15m --dispatch >> "$HOME/cronlag-catchup.log" 2>&1');
  const pct = render({ ...base, target: "crontab", workflows: [{ ...base.workflows[0], file: "100% sure.yml" }] })[0].text;
  assert.match(pct, /-w '100\\% sure\.yml'/);
  for (const f of [svc, timer, cron]) assert.doesNotMatch(f.text, /GITHUB_TOKEN=gh|github_pat_[A-Za-z0-9]/);
});

test("worker usage errors exit 2 before any API call", () => {
  const cases: [string[], RegExp][] = [
    [["--target", "lambda"], /--target must be one of cloudflare, systemd, crontab/],
    [["--every", "7m"], /doesn't divide an hour or a day/],
    [["--every", "1m"], /too often/],
    [["--grace", "2d"], /--grace must be between 1m and 24h/],
    [["--since", "3d"], /worker runs catch-up on the latest due slots only/],
    [["--dispatch"], /always prints a recipe that dispatches/],
    [["--bin", "cronlag"], /--bin is for systemd and crontab/],
    [["-f", "markdown"], /text or --format json/],
  ];
  for (const [extra, re] of cases) {
    const r = spawnSync(process.execPath, [CLI, "worker", "o/r", ...extra], { encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "x" } });
    assert.equal(r.status, 2, `${extra.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, re);
  }
  const h = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.match(h.stdout, /cronlag worker \[owner\/repo\]/);
});
