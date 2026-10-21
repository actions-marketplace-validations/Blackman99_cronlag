import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze, attribute, offMinute, DEFAULTS, guard, planCatchup, HOUR, MIN, DAY, type Snapshot } from "../src/analyze.ts";
import { parseCron } from "../src/cron.ts";
import type { Run } from "../src/github.ts";
import { formatMarkdown, formatText } from "../src/format.ts";

function load(name: string): Snapshot {
  const s = JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8")) as Snapshot;
  const hydrate = (xs: any[]) => xs.map((x) => ({ ...x, parsed: parseCron(x.cron, x.timezone) }));
  for (const w of s.workflows) {
    w.schedules = hydrate(w.schedules);
    if (w.timeline) w.timeline = w.timeline.map((t) => ({ ...t, schedules: hydrate(t.schedules) }));
  }
  return s;
}

const run = (n: number, created: string, event = "schedule"): Run => ({
  id: n, number: n, event, status: "completed", conclusion: "success", created: Date.parse(created), started: Date.parse(created) + 5000, url: `https://github.com/o/r/actions/runs/${n}`,
});

function synth(over: Partial<Snapshot["workflows"][0]> = {}, now = "2026-10-13T12:00:00Z", days = 3): Snapshot {
  const nowMs = Date.parse(now);
  return {
    repo: { fullName: "o/r", defaultBranch: "main", fork: false, archived: false, private: false, pushedAt: nowMs - DAY, url: "https://github.com/o/r" },
    from: nowMs - days * DAY,
    now: nowMs,
    unscheduled: [],
    workflows: [
      {
        id: 1, name: "nightly", path: ".github/workflows/nightly.yml", state: "active", url: "u",
        schedules: [{ cron: "0 6 * * *", timezone: "UTC", parsed: parseCron("0 6 * * *") }],
        hasDispatch: true, scheduleRuns: [], dispatchRuns: [], ...over,
      },
    ],
  };
}

test("real fixture: robhunter/agentdeals reverify.yml is LATE by hours (issue #1848)", () => {
  const r = analyze(load("agentdeals.json"));
  const w = r.workflows[0];
  assert.equal(w.verdict, "LATE");
  assert.ok(w.stats.lagMedian! > 4 * HOUR, `median ${w.stats.lagMedian}`);
  assert.equal(w.stats.within1h, 0);
  assert.ok(w.findings.some((f) => f.code === "top-of-hour"));
  assert.ok(w.findings.some((f) => f.code === "scheduler-side"));
});

test("real fixture: fpgas e2e drops most slots and the cron change is honored (issue #16)", () => {
  const r = analyze(load("fpgas-e2e.json"));
  const w = r.workflows[0];
  assert.equal(w.verdict, "DROPPING");
  assert.equal(w.changes.length, 1);
  assert.match(w.changes[0].crons[0], /^0 \*\/2/);
  // before the change the cron was every 6h: no 2-hourly slots before 2026-10-08 10:57
  const change = Date.parse(w.changes[0].at);
  const before = w.slots.filter((s) => s.at < change);
  assert.ok(before.every((s) => new Date(s.at).getUTCHours() % 6 === 0));
  assert.ok(w.stats.missed > w.stats.ran);
});

test("real fixture: kort0881 facts drops slots and runs hours late (discussion #206134)", () => {
  const w = analyze(load("kort-facts.json")).workflows[0];
  assert.equal(w.verdict, "DROPPING");
  assert.ok(w.stats.missed >= 10);
  assert.ok(w.stats.lagMedian! > HOUR);
  const text = formatText(analyze(load("kort-facts.json")), { color: false });
  assert.match(text, /DROPPING/);
  assert.match(formatMarkdown(analyze(load("kort-facts.json"))), /\| \[facts\.yml\]/);
});

test("real fixture: a workflow added mid-window has no slots before GitHub registered it (cronlag probe.yml)", () => {
  const snap = load("cronlag-probe.json");
  const wf = snap.workflows[0];
  const w = analyze(snap).workflows[0];
  // probe.yml (17 * * * *) was registered 2026-10-13 08:26 UTC inside a 7-day window: first slot is 09:17, not 7 days back.
  assert.ok(wf.created && wf.created > snap.from);
  assert.ok(w.slots.every((s) => s.at >= wf.created!), "no slot before the workflow existed");
  assert.equal(new Date(w.slots[0].at).toISOString(), "2026-10-13T09:17:00.000Z");
  assert.equal(w.stats.due, 17);
  assert.equal(w.stats.ran, 3);
  assert.equal(w.stats.missed, 13);
  // without the registration time the same data would claim ~164 missed slots
  delete (wf as any).created;
  assert.ok(analyze(snap).workflows[0].stats.missed > 150);
});

test("synthetic: created inside the window limits slots and catch-up", () => {
  const created = Date.parse("2026-10-13T05:00:00Z");
  const w = analyze(synth({ created, scheduleRuns: [] }, "2026-10-13T12:00:00Z", 3)).workflows[0];
  assert.equal(w.slots.length, 1); // only 06:00 on 10-13
  assert.equal(new Date(w.slots[0].at).toISOString(), "2026-10-13T06:00:00.000Z");
  const before = analyze(synth({ created: Date.parse("2026-10-13T07:00:00Z") }, "2026-10-13T12:00:00Z", 3)).workflows[0];
  assert.equal(before.slots.length, 0);
});

test("attribution: each run claims the closest preceding free slot", () => {
  const slots = ["2026-10-12T06:00Z", "2026-10-12T12:00Z", "2026-10-12T18:00Z"].map((a) => ({ at: Date.parse(a), cron: "x" }));
  const runs = [run(1, "2026-10-12T09:10Z"), run(2, "2026-10-12T21:00Z"), run(3, "2026-10-12T21:05Z")];
  const { claimed, extra } = attribute(slots, runs, DEFAULTS);
  assert.equal(claimed.get(0)?.number, 1);
  assert.equal(claimed.get(2)?.number, 2);
  assert.equal(claimed.get(1)?.number, 3); // second run after 18:00 must belong to an earlier free slot
  assert.equal(extra.length, 0);
});

test("on time, late, missed, overdue and pending classification", () => {
  const s = synth({
    scheduleRuns: [run(1, "2026-10-10T06:03:00Z"), run(2, "2026-10-12T09:30:00Z")],
  });
  const w = analyze(s).workflows[0];
  // slots 10-10, 10-11, 10-12, 10-13 06:00; 10-10 at 12:00 is exactly at the window edge -> excluded
  const byDay = Object.fromEntries(w.slots.map((x) => [new Date(x.at).toISOString().slice(5, 10), x.status]));
  assert.equal(byDay["10-11"], "missed");
  assert.equal(byDay["10-12"], "verylate");
  assert.equal(byDay["10-13"], "overdue");
  assert.equal(w.verdict, "DROPPING");
});

test("not firing + not registered + inactivity warnings", () => {
  const s = synth({ fileChangedAt: Date.parse("2026-10-10T12:00:00Z") });
  s.repo.pushedAt = s.now - 52 * DAY;
  const w = analyze(s).workflows[0];
  assert.equal(w.verdict, "NOT FIRING");
  const codes = w.findings.map((f) => f.code);
  assert.ok(codes.includes("not-registered"));
  assert.ok(codes.includes("inactivity-soon"));
});

test("disabled_inactivity is reported with the enable command", () => {
  const w = analyze(synth({ state: "disabled_inactivity" })).workflows[0];
  assert.equal(w.verdict, "DISABLED");
  assert.match(w.findings[0].fix ?? "", /gh workflow enable nightly\.yml -R o\/r/);
});

test("a manually disabled workflow is DISABLED without 'not registered' or 'overdue' noise (community #210622)", () => {
  const w = analyze(synth({ state: "disabled_manually", fileChangedAt: Date.parse("2026-10-10T12:00:00Z") })).workflows[0];
  assert.equal(w.verdict, "DISABLED");
  assert.equal(w.headline, "workflow state is disabled_manually");
  const codes = w.findings.map((f) => f.code);
  assert.ok(codes.includes("disabled"));
  assert.ok(!codes.includes("not-registered"));
});

test("minute-0 fix keeps the schedule's frequency (every 5 min stays every 5 min)", () => {
  const fix = (cron: string) => offMinute(parseCron(cron).minutes, 3);
  assert.equal(fix("0 6 * * *"), "23");
  assert.equal(fix("0-59/5 * * * *"), "4-59/5");
  assert.equal(fix("*/15 * * * *"), "4-59/15");
  assert.equal(fix("0,30 * * * *"), "7,37");
  assert.equal(fix("0,10,45 * * * *"), "7,17,52");
  for (const c of ["*/5 * * * *", "0,30 * * * *", "0,10,45 * * * *", "*/2 * * * *", "0 6 * * *"]) {
    const before = parseCron(c).minutes.length;
    const after = parseCron(`${fix(c)} * * * *`).minutes;
    assert.equal(after.length, before, c);
    assert.ok(!after.includes(0), c);
  }
});

test("too-frequent cron and no workflow_dispatch", () => {
  const w = analyze(synth({ schedules: [{ cron: "*/2 * * * *", timezone: "UTC", parsed: parseCron("*/2 * * * *") }], hasDispatch: false }, "2026-10-13T12:00:00Z", 1)).workflows[0];
  const codes = w.findings.map((f) => f.code);
  assert.ok(codes.includes("too-frequent"));
  assert.ok(codes.includes("no-dispatch"));
});

test("catch-up: dispatch an uncovered slot, leave covered ones alone", () => {
  const base = synth({}, "2026-10-13T07:00:00Z");
  assert.equal(planCatchup(base)[0].action, "dispatch");
  const covered = synth({ scheduleRuns: [run(9, "2026-10-13T06:40:00Z")] }, "2026-10-13T07:00:00Z");
  assert.equal(planCatchup(covered)[0].action, "covered");
  const dispatched = synth({ dispatchRuns: [run(10, "2026-10-13T06:20:00Z", "workflow_dispatch")] }, "2026-10-13T07:00:00Z");
  assert.equal(planCatchup(dispatched)[0].action, "covered");
  // inside the 15-minute grace: today's slot is not due yet, yesterday's is past the 24h window
  assert.equal(planCatchup(synth({}, "2026-10-13T06:10:00Z"))[0].action, "skip");
  assert.equal(planCatchup(synth({}, "2026-10-13T06:20:00Z"))[0].slot, "2026-10-13 06:00 UTC");
  const noDispatch = synth({ hasDispatch: false }, "2026-10-13T07:00:00Z");
  assert.equal(planCatchup(noDispatch)[0].action, "skip");
});

test("guard: a late scheduled run skips when catch-up already ran its slot", () => {
  const c = parseCron("0 6 * * *");
  const g1 = guard(c, Date.parse("2026-10-13T10:45:00Z"), [run(10, "2026-10-13T06:20:00Z", "workflow_dispatch")]);
  assert.equal(g1.skip, true);
  assert.equal(g1.lagMs, 4 * HOUR + 45 * MIN);
  const g2 = guard(c, Date.parse("2026-10-13T06:04:00Z"), [run(10, "2026-10-12T06:20:00Z", "workflow_dispatch")]);
  assert.equal(g2.skip, false);
});
