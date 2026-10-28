import { analyze, DAY, DEFAULTS, fmtDur, guard, HOUR, MIN, type Report, type Thresholds } from "./analyze.js";
import { collect } from "./collect.js";
import { runCatchup } from "./catchup.js";
import { CronError, nextFires, parseCron, minInterval } from "./cron.js";
import { formatCatchup, formatMarkdown, formatOrgMarkdown, formatOrgText, formatText, wrap } from "./format.js";
import { exitForOrg, scanOrg } from "./org.js";
import { GitHub, GitHubError } from "./github.js";
import { runMcp } from "./mcp.js";
import { findToken, repoFromGit } from "./token.js";
import { VERSION } from "./version.js";
import { DiskRunCache, defaultCacheDir, tildify } from "./cache.js";
import { MAX_WINDOW_DAYS, resolveWindow, WindowError } from "./window.js";
import { readTriggers } from "./workflow.js";
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { DEFAULT_BIN, notes, render, selectWorkflows, slug, TARGETS, tickFor, WorkerSpecError, type Selection, type Target, type WorkerSpec } from "./worker.js";
import { fileURLToPath } from "node:url";
import { join, resolve as resolvePath } from "node:path";

const HELP = `cronlag ${VERSION} — is your scheduled GitHub Actions workflow late, dropped, or broken?

Usage
  cronlag [owner/repo] [options]          slot-by-slot lag report (default: this git repo)
  cronlag org <org> [options]             all repos in an org with schedules, worst first
  cronlag --org <org> [options]           same as org (flag form)
  cronlag catchup [owner/repo] [--dispatch] [--grace 15m]
                                          find due slots with no run; --dispatch runs them via workflow_dispatch
  cronlag guard                           inside a scheduled run: skip=true if catch-up already ran this slot
  cronlag explain "<cron>" [--tz Zone] [-n 5]
                                          next fire times, interval, busy-minute check
  cronlag worker [owner/repo] [--target cloudflare|systemd|crontab] [--every 10m] [--grace 15m] [-o dir]
                                          print a ready-made external scheduler that runs catchup --dispatch
  cronlag mcp                             MCP server on stdio (read-only tools)

Options
  -d, --days <n>          window to inspect (default 7, max ${MAX_WINDOW_DAYS})
  -s, --since <when>      window start instead of --days: 2026-09-01, 2026-09-01T06:00Z (UTC),
                          or relative 36h / 30d / 6w
      --no-cache          don't read or write the run cache (always refetch from the API)
  -w, --workflow <x>      only this workflow (file, path, name or id); repeatable
  -f, --format <fmt>      text | json | markdown (default text)
      --org <org>         org-wide scan (same as \`cronlag org <org>\`)
      --fail-on <level>   never | dropped | late   exit 1 when a workflow is that bad (default never)
      --late <dur>        lag that counts as "very late" (default 1h)
      --on-time <dur>     lag still counted as on time (default 10m)
  -t, --target <t>        worker: cloudflare (default) | systemd | crontab
      --every <dur>       worker: how often the scheduler runs a catch-up pass (default 10m)
  -o, --out <dir>         worker: write the files into <dir> instead of printing them
      --bin <cmd>         worker (systemd/crontab): command that runs cronlag (default npx -y github:Blackman99/cronlag#v0)
      --token <t>         GitHub token (default: $GITHUB_TOKEN, $GH_TOKEN, then \`gh auth token\`)
      --no-color          plain output
  -h, --help / -v, --version

Public repos work without a token (60 API calls/hour); private repos need actions:read.
Run cache: settled days of runs are kept in ${tildify(defaultCacheDir())} (CRONLAG_CACHE_DIR to move it),
so a second long-window report only fetches the last day or so.
Org scan skips archived repos and uses --lite for fewer API calls. catchup --dispatch needs actions:write.
Docs: https://blackman99.github.io/cronlag/docs/`;

interface Args {
  cmd: string;
  pos: string[];
  flags: Record<string, string[]>;
}

const SHORT: Record<string, string> = { t: "target", o: "out", s: "since", d: "days", w: "workflow", f: "format", h: "help", v: "version", n: "count" };
const BOOL = new Set(["help", "version", "no-color", "no-cache", "dispatch", "lite", "json"]);
const VALUED = new Set(["days", "since", "workflow", "format", "count", "fail-on", "late", "on-time", "token", "grace", "tz", "cron", "org", "target", "every", "out", "bin"]);

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string[]> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) {
      let [k, v] = a.replace(/^--?/, "").split(/=(.*)/s, 2) as [string, string | undefined];
      if (!a.startsWith("--")) k = SHORT[k] ?? k;
      // Reject typos and not-yet-supported flags instead of silently reporting a different window.
      if (!BOOL.has(k) && !VALUED.has(k)) throw new UsageError(`unknown option ${a.split("=")[0]}`);
      if (BOOL.has(k)) {
        (flags[k] ??= []).push("true");
        continue;
      }
      if (v === undefined) v = argv[++i];
      if (v === undefined) throw new UsageError(`--${k} needs a value`);
      (flags[k] ??= []).push(v);
    } else pos.push(a);
  }
  const cmds = ["catchup", "guard", "explain", "mcp", "org", "report", "worker"];
  const cmd = pos.length && cmds.includes(pos[0]) ? (pos.shift() as string) : "report";
  return { cmd, pos, flags };
}

class UsageError extends Error {}

export function parseDur(s: string): number {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|min|h|d)?$/i);
  if (!m) throw new UsageError(`bad duration "${s}" (try 15m, 1h, 2d)`);
  const n = Number(m[1]);
  const u = (m[2] ?? "m").toLowerCase();
  return n * (u === "s" ? 1000 : u === "h" ? HOUR : u === "d" ? DAY : MIN);
}

function one(a: Args, k: string): string | undefined {
  const v = a.flags[k];
  return v ? v[v.length - 1] : undefined;
}

function thresholds(a: Args): Thresholds {
  return {
    ...DEFAULTS,
    lateMs: one(a, "late") ? parseDur(one(a, "late")!) : DEFAULTS.lateMs,
    onTimeMs: one(a, "on-time") ? parseDur(one(a, "on-time")!) : DEFAULTS.onTimeMs,
  };
}

function resolveRepo(a: Args): string {
  const r = a.pos[0] ?? process.env.GITHUB_REPOSITORY ?? repoFromGit();
  if (!r) throw new UsageError("which repo? pass owner/repo (or run inside a git clone with a GitHub origin)");
  const m = r.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new UsageError(`"${r}" is not owner/repo`);
  return m[1];
}

export function exitFor(r: Report, failOn: string): number {
  if (failOn === "never") return 0;
  const bad = failOn === "late" ? ["LATE", "DROPPING", "NOT FIRING", "DISABLED", "INVALID"] : ["DROPPING", "NOT FIRING", "DISABLED", "INVALID"];
  return r.workflows.some((w) => bad.includes(w.verdict)) ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  if (a.flags.help) {
    console.log(HELP);
    return 0;
  }
  if (a.flags.version) {
    console.log(VERSION);
    return 0;
  }
  const color = !a.flags["no-color"] && !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR);

  const useCache = !a.flags["no-cache"] && !/^(1|true|yes)$/i.test(process.env.CRONLAG_NO_CACHE ?? "");
  const cache = useCache ? new DiskRunCache() : undefined;

  if (a.cmd === "mcp") {
    await runMcp(() => new GitHub({ token: findToken(one(a, "token")), userAgent: `cronlag/${VERSION}`, cache }));
    return 0;
  }

  if (a.cmd === "explain") {
    const expr = a.pos.join(" ");
    if (!expr) throw new UsageError('explain needs a cron expression, e.g. cronlag explain "0 6 * * *"');
    const tz = one(a, "tz") ?? "UTC";
    let c;
    try {
      c = parseCron(expr, tz);
    } catch (e) {
      if (e instanceof CronError) {
        console.error(`invalid cron: ${e.message}`);
        return 2;
      }
      throw e;
    }
    const n = Number(one(a, "count") ?? 5);
    const fires = nextFires(c, Date.now(), n);
    const gap = minInterval(c, Date.now());
    if (one(a, "format") === "json") {
      console.log(JSON.stringify({ cron: c.source, timezone: tz, next: fires.map((t) => new Date(t).toISOString()), minIntervalMs: gap, minuteZero: c.minutes.includes(0) }, null, 2));
      return 0;
    }
    console.log(`${c.source}${tz !== "UTC" ? `  (${tz})` : ""}`);
    for (const t of fires) console.log(`  ${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    if (gap !== null) console.log(`  shortest interval ${fmtDur(gap)}${gap < 5 * MIN ? " — below GitHub's 5-minute minimum" : ""}`);
    if (c.minutes.includes(0)) console.log("  ! minute 0 is GitHub's busiest minute; pick another (e.g. 7 or 43)");
    return 0;
  }

  if (a.cmd === "worker") return await workerCmd(a);

  const token = findToken(one(a, "token"));
  // catchup and guard decide what to dispatch/skip right now: always read the API directly.
  const live = a.cmd === "catchup" || a.cmd === "guard";
  const gh = new GitHub({ token, userAgent: `cronlag/${VERSION}`, cache: live ? undefined : cache });
  if (live && (one(a, "since") || one(a, "days"))) throw new UsageError(`${a.cmd} looks at the latest due slots only; --since / --days apply to reports`);

  if (a.cmd === "guard") {
    const repo = process.env.GITHUB_REPOSITORY;
    const runId = Number(process.env.GITHUB_RUN_ID);
    const event = process.env.GITHUB_EVENT_NAME;
    const out = (k: string, v: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
    if (event !== "schedule") {
      console.log(`cronlag guard: event is ${event ?? "unknown"}, not schedule — nothing to guard (skip=false)`);
      out("skip", "false");
      return 0;
    }
    if (!repo || !runId) throw new UsageError("guard runs inside GitHub Actions (needs GITHUB_REPOSITORY and GITHUB_RUN_ID)");
    const ev = process.env.GITHUB_EVENT_PATH ? JSON.parse((await import("node:fs")).readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
    const cronStr: string | undefined = ev.schedule ?? one(a, "cron");
    if (!cronStr) throw new UsageError("could not read github.event.schedule");
    const run = await gh.run(repo, runId);
    const wfPath = process.env.GITHUB_WORKFLOW_REF?.split("@")[0].split("/").slice(2).join("/");
    let tz = one(a, "tz") ?? "UTC";
    let wfId: number | undefined;
    const wfs = await gh.workflows(repo);
    const wf = wfs.find((w) => w.path === wfPath) ?? wfs.find((w) => w.name === process.env.GITHUB_WORKFLOW);
    if (wf) {
      wfId = wf.id;
      try {
        const repoInfo = await gh.repo(repo);
        const t = readTriggers(await gh.file(repo, wf.path, repoInfo.defaultBranch));
        tz = t.schedules.find((s) => s.cron === cronStr.trim())?.timezone ?? tz;
      } catch {
        /* keep UTC */
      }
    }
    const dispatchRuns = wfId ? await gh.runs(repo, wfId, { event: "workflow_dispatch", since: run.created - 2 * DAY, maxPages: 1 }) : [];
    const g = guard(parseCron(cronStr, tz), run.created, dispatchRuns);
    console.log(`cronlag guard: ${g.skip ? "SKIP" : "RUN"} — ${g.reason}`);
    out("skip", String(g.skip));
    out("slot", g.slot ?? "");
    out("lag-minutes", g.lagMs === null ? "" : String(Math.round(g.lagMs / MIN)));
    return 0;
  }

  let win: ReturnType<typeof resolveWindow>;
  try {
    win = resolveWindow({ days: one(a, "days"), since: one(a, "since") });
  } catch (e) {
    if (e instanceof WindowError) throw new UsageError(e.message);
    throw e;
  }
  const t = thresholds(a);
  if (!token && process.stderr.isTTY) {
    console.error(
      win.days > 30
        ? `(no GitHub token found — public repos only, 60 API calls/hour; a ${Math.round(win.days)}-day window can need more on the first run)`
        : "(no GitHub token found — public repos only, 60 API calls/hour)",
    );
  }
  const runNote = () => {
    const st = gh.runStats;
    if (st.truncated) console.error("cronlag: warning — a single day had more than 1000 runs of one workflow; GitHub's API returns at most 1000, so some runs (and lag numbers) are missing");
    if (!process.stderr.isTTY || !st.days) return;
    const note = (msg: string) => console.error(color ? `\x1b[2m${msg}\x1b[0m` : msg);
    if (st.cachedDays) note(`(cached: ${st.cachedDays} of ${st.days} days of runs from ${gh.cacheLocation} · ${st.pages} API request${st.pages === 1 ? "" : "s"} for the rest)`);
    else if (win.days > 7 && cache) note(`(${st.pages} API requests for runs; finished days are now cached in ${gh.cacheLocation}, so the next run reuses them)`);
  };

  const orgName = a.cmd === "org" ? a.pos[0] : one(a, "org");
  if (a.cmd === "org" || orgName) {
    if (!orgName) throw new UsageError("org needs a name, e.g. cronlag org github");
    const progress = process.stderr.isTTY ? (msg: string) => console.error(msg) : undefined;
    const report = await scanOrg(gh, orgName, {
      from: win.from,
      workflows: a.flags.workflow,
      thresholds: t,
      onProgress: progress,
    });
    const format = one(a, "format") ?? (a.flags.json ? "json" : "text");
    if (format === "json") console.log(JSON.stringify(report, null, 2));
    else if (format === "markdown" || format === "md") console.log(formatOrgMarkdown(report));
    else console.log(formatOrgText(report, { color, width: process.stdout.columns }));
    runNote();
    return exitForOrg(report, one(a, "fail-on") ?? "never");
  }

  const repo = resolveRepo(a);

  if (a.cmd === "catchup") {
    const r = await runCatchup(gh, repo, { workflows: a.flags.workflow, graceMs: parseDur(one(a, "grace") ?? "15m"), dispatch: !!a.flags.dispatch, thresholds: t });
    if (one(a, "format") === "json") console.log(JSON.stringify(r, null, 2));
    else {
      console.log(formatCatchup(r.steps, r.dispatched, color));
      if (!r.dispatched && r.steps.some((s) => s.action === "dispatch")) console.log("\n(dry run — add --dispatch to run the slots above via workflow_dispatch)");
    }
    return r.steps.some((s) => s.error) ? 3 : 0;
  }

  const snap = await collect(gh, repo, { from: win.from, workflows: a.flags.workflow, lite: !!a.flags.lite });
  const report = analyze(snap, t);
  const format = one(a, "format") ?? (a.flags.json ? "json" : "text");
  if (format === "json") console.log(JSON.stringify(report, null, 2));
  else if (format === "markdown" || format === "md") console.log(formatMarkdown(report));
  else console.log(formatText(report, { color, width: process.stdout.columns }));
  runNote();
  return exitFor(report, one(a, "fail-on") ?? "never");
}

async function workerCmd(a: Args): Promise<number> {
  for (const k of ["since", "days", "dispatch"]) {
    if (a.flags[k]) throw new UsageError(k === "dispatch" ? "worker always prints a recipe that dispatches; each one explains its dry run" : `worker runs catch-up on the latest due slots only; --${k} applies to reports`);
  }
  const target = (one(a, "target") ?? "cloudflare").toLowerCase();
  if (!(TARGETS as readonly string[]).includes(target)) throw new UsageError(`--target must be one of ${TARGETS.join(", ")} (got "${target}")`);
  const graceMs = parseDur(one(a, "grace") ?? "15m");
  if (graceMs < MIN || graceMs >= DAY) throw new UsageError("--grace must be between 1m and 24h (catch-up only looks at slots from the last 24h)");
  let tick;
  try {
    tick = tickFor(parseDur(one(a, "every") ?? "10m"));
  } catch (e) {
    if (e instanceof WorkerSpecError) throw new UsageError(e.message);
    throw e;
  }
  const bin = one(a, "bin") ?? DEFAULT_BIN;
  if (target === "cloudflare" && one(a, "bin")) throw new UsageError("--bin is for systemd and crontab; the Cloudflare Worker carries its own copy of cronlag");
  const format = one(a, "format") ?? "text";
  if (!["text", "json"].includes(format)) throw new UsageError("worker prints text or --format json");
  const repo = resolveRepo(a);
  const gh = new GitHub({ token: findToken(one(a, "token")), userAgent: `cronlag/${VERSION}` });
  let sel;
  try {
    sel = await selectWorkflows(gh, repo, a.flags.workflow);
  } catch (e) {
    if (e instanceof WorkerSpecError) throw new UsageError(e.message);
    throw e;
  }
  if (a.flags.workflow?.length && sel.noDispatch.length) {
    throw new UsageError(`${sel.noDispatch.map((w) => w.file).join(", ")} ha${sel.noDispatch.length === 1 ? "s" : "ve"} no workflow_dispatch trigger, so catch-up can't start ${sel.noDispatch.length === 1 ? "it" : "them"}; add \`workflow_dispatch:\` under \`on:\` first`);
  }
  if (!sel.workflows.length) {
    throw new UsageError(
      sel.noDispatch.length
        ? `${sel.repo}: no scheduled workflow has a workflow_dispatch trigger (${sel.noDispatch.map((w) => w.file).join(", ")}); add \`workflow_dispatch:\` under \`on:\` so catch-up can start them`
        : `${sel.repo} has no workflows with on: schedule, so there is nothing to catch up`,
    );
  }
  const spec: WorkerSpec = { repo: sel.repo, target: target as Target, workflows: sel.workflows, graceMs, tick, bin, generated: new Date().toISOString().slice(0, 10) };
  const files = render(spec);
  const outDir = one(a, "out");
  if (format === "json") {
    if (outDir) throw new UsageError("--out writes files; leave it out with --format json");
    console.log(JSON.stringify({ repo: spec.repo, target, every: tick.label, cron: tick.cron, onCalendar: tick.onCalendar, graceMinutes: graceMs / MIN, workflows: spec.workflows, notes: notes(spec, sel), files }, null, 2));
    return 0;
  }
  const errColor = !a.flags["no-color"] && !process.env.NO_COLOR && (process.stderr.isTTY || !!process.env.FORCE_COLOR);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const wrote: string[] = [];
    for (const f of files) {
      const p = join(outDir, f.name);
      writeFileSync(p, f.text);
      wrote.push(`${p}  (${f.text.length >= 10_000 ? `${Math.round(f.text.length / 1024)} KB` : `${f.text.split("\n").length} lines`})`);
    }
    console.log(workerSummary(spec, sel, { color: !a.flags["no-color"] && !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR), wrote, outDir }));
    return 0;
  }
  if (target === "systemd") {
    console.log(files.map((f) => `# ===== /etc/systemd/system/${f.name} =====\n${f.text}`).join("\n"));
  } else {
    process.stdout.write(files[0].text.endsWith("\n") ? files[0].text : files[0].text + "\n");
  }
  console.error("\n" + workerSummary(spec, sel, { color: errColor }));
  return 0;
}

function workerSummary(spec: WorkerSpec, sel: Selection, o: { color: boolean; wrote?: string[]; outDir?: string }): string {
  const C = { dim: "\x1b[2m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m" };
  const c = (k: keyof typeof C, s: string) => (o.color ? C[k] + s + C.reset : s);
  const width = Math.max(60, Math.min(process.stderr.columns || 100, 120));
  const what = spec.target === "cloudflare" ? "Cloudflare Worker" : spec.target === "systemd" ? "systemd timer + service" : "crontab line";
  const when = spec.target === "systemd" ? `OnCalendar=${spec.tick.onCalendar}` : `${spec.tick.cron} UTC`;
  const L: string[] = [];
  L.push(`${c("bold", "cronlag worker")}  ${spec.repo} ${c("dim", "→")} ${what}`);
  L.push(c("dim", `  every ${spec.tick.label} (${when}) · grace ${fmtDur(spec.graceMs)} · latest due slot, once`));
  L.push("");
  const w = Math.max(...spec.workflows.map((x) => x.file.length));
  const cw = Math.max(...spec.workflows.map((x) => x.schedules.map((s) => s.cron).join(" · ").length));
  for (const x of spec.workflows) {
    const guard = x.guarded ? c("green", "guard ✓") : c("yellow", "no guard");
    L.push(`  ${x.file.padEnd(w)}  ${c("cyan", x.schedules.map((s) => s.cron).join(" · ").padEnd(cw))}  ${guard}`);
  }
  const ns = notes(spec, sel);
  if (ns.length) {
    L.push("");
    for (const n of ns) {
      wrap(n.text, width - 4).forEach((ln, i) => L.push(`  ${i ? " " : n.level === "warn" ? c("yellow", "!") : c("dim", "·")} ${n.level === "info" ? c("dim", ln) : ln}`));
    }
  }
  L.push("");
  if (o.wrote) {
    for (const p of o.wrote) L.push(`  ${c("green", "wrote")} ${p}`);
    L.push("");
  }
  const steps: string[] = [];
  const name = slug(spec.repo);
  const cd = o.outDir && o.outDir !== "." ? `cd ${o.outDir} && ` : "";
  if (spec.target === "cloudflare") {
    if (!o.wrote) steps.push("save it as worker.js (-o <dir> also writes wrangler.toml)");
    steps.push(`${cd}wrangler secret put GITHUB_TOKEN && wrangler deploy`);
    steps.push(c("dim", "# token: fine-grained, this repo only, Actions read and write"));
  } else if (spec.target === "systemd") {
    steps.push(o.wrote ? `sudo cp ${o.outDir}/${name}.{service,timer} /etc/systemd/system/` : "-o <dir> writes both unit files; copy them to /etc/systemd/system/");
    steps.push(`put GITHUB_TOKEN=… in /etc/cronlag/${name}.env ${c("dim", "(root only, chmod 600)")}`);
    steps.push(`sudo systemctl daemon-reload && sudo systemctl enable --now ${name}.timer`);
  } else {
    steps.push(`put \`export GITHUB_TOKEN=…\` in ~/.config/cronlag/${name}.env ${c("dim", "(chmod 600)")}`);
    steps.push(`crontab -e and paste the lines${o.wrote ? ` from ${o.wrote[0]}` : ""}`);
  }
  steps.forEach((st, i) => L.push(`  ${i ? "     " : c("bold", "next:")} ${st}`));
  return L.join("\n");
}

/** True when this file is the process entry point. npm/npx install the bin as a symlink, so compare real paths. */
function isEntryPoint(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  return norm(real(fileURLToPath(import.meta.url))) === norm(real(resolvePath(arg)));
}
const isDirect = isEntryPoint();
if (isDirect) {
  // Set exitCode instead of calling process.exit(): exit() drops whatever stdout still has
  // buffered for a pipe, which cut long --format json reports off at 64 KiB.
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      if (e instanceof UsageError) {
        console.error(`cronlag: ${e.message}\nRun \`cronlag --help\` for usage.`);
        process.exitCode = 2;
      } else if (e instanceof GitHubError) {
        console.error(`cronlag: ${e.message}`);
        process.exitCode = 3;
      } else {
        console.error(e);
        process.exitCode = 3;
      }
    },
  );
}
