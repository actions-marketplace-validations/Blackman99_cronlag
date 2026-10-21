import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDays, parseSince, resolveWindow, windowLabel, MAX_WINDOW_DAYS, WindowError } from "../src/window.ts";
import { GitHub, SETTLE_MS, type Run, type RunCache } from "../src/github.ts";
import { DiskRunCache, defaultCacheDir } from "../src/cache.ts";
import { compactSlots, markGlyph } from "../src/format.ts";
import type { Slot } from "../src/analyze.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-21T02:50:00Z");

test("--since accepts dates, date-times and relative windows", () => {
  assert.equal(parseSince("2026-09-01", NOW), Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(parseSince("2026-09-01T06:30Z", NOW), Date.parse("2026-09-01T06:30:00Z"));
  assert.equal(parseSince("2026-09-01T06:30", NOW), Date.parse("2026-09-01T06:30:00Z"), "no zone means UTC");
  assert.equal(parseSince("2026-09-01 08:30+02:00", NOW), Date.parse("2026-09-01T06:30:00Z"));
  assert.equal(parseSince("36h", NOW), NOW - 36 * HOUR);
  assert.equal(parseSince("30d", NOW), NOW - 30 * DAY);
  assert.equal(parseSince("6w", NOW), NOW - 42 * DAY);
  assert.equal(parseSince("2 weeks", NOW), NOW - 14 * DAY);
  assert.equal(parseSince(`${MAX_WINDOW_DAYS}d`, NOW), NOW - MAX_WINDOW_DAYS * DAY);
});

test("--since rejects bad input with a message that says what to type", () => {
  const err = (s: string, re: RegExp) => assert.throws(() => parseSince(s, NOW), (e: unknown) => e instanceof WindowError && re.test(e.message));
  err("yesterday", /not a date — use 2026-09-01/);
  err("2026-02-30", /not a real calendar date/);
  err("2026-13-01", /not a real calendar date/);
  err("2026-11-01", /in the future/);
  err("20m", /shortest window is 1h/);
  err("30 min", /shortest window is 1h/);
  err("0h", /less than an hour/);
  err("2024-01-01", /1024 days back; the longest window is 400 days \(try --since 400d\)/);
  err("401d", /longest window is 400 days/);
});

test("--days is validated instead of silently clamped, and excludes --since", () => {
  assert.equal(parseDays("14"), 14);
  assert.equal(parseDays(0.5), 0.5);
  assert.throws(() => parseDays("0"), /not a positive number/);
  assert.throws(() => parseDays("abc"), /not a positive number/);
  assert.throws(() => parseDays("401"), /longest window is 400 days/);
  assert.throws(() => resolveWindow({ days: "3", since: "30d" }, NOW), /either --days or --since, not both/);
  assert.deepEqual(resolveWindow({}, NOW), { from: NOW - 7 * DAY, days: 7, since: false });
  assert.equal(resolveWindow({ since: "2026-10-01" }, NOW).from, Date.parse("2026-10-01T00:00:00Z"));
});

test("windowLabel reads naturally for every window shape", () => {
  const iso = (t: number) => new Date(t).toISOString();
  assert.equal(windowLabel(iso(NOW - 7 * DAY), iso(NOW)), "last 7 days");
  assert.equal(windowLabel(iso(NOW - DAY), iso(NOW)), "last 24h");
  assert.equal(windowLabel(iso(NOW - 36 * HOUR), iso(NOW)), "last 36h");
  assert.equal(windowLabel(iso(NOW - 90 * DAY), iso(NOW)), "last 90 days");
  assert.equal(windowLabel("2026-10-01T00:00:00.000Z", iso(NOW)), "since 2026-10-01 00:00 (20 days)");
  assert.equal(windowLabel("2026-10-18T00:00:00.000Z", iso(NOW)), "since 2026-10-18 00:00 (3.1 days)");
});

// ---- runsWindow against a fake runs endpoint that behaves like GitHub's (newest first, 1000-result cap)

function fakeApi(runs: Run[], o: { totalCap?: number } = {}) {
  const urls: string[] = [];
  const fetchFn = (async (input: string | URL) => {
    const url = new URL(String(input));
    urls.push(decodeURIComponent(url.search));
    const q = url.searchParams;
    const created = q.get("created") ?? "";
    let lo = -Infinity;
    let hi = Infinity;
    if (created.startsWith(">=")) lo = Date.parse(created.slice(2));
    else if (created.includes("..")) [lo, hi] = created.split("..").map((x) => Date.parse(x));
    const match = runs.filter((r) => r.event === q.get("event") && r.created >= lo && r.created <= hi + 999).sort((a, b) => b.created - a.created);
    const per = Number(q.get("per_page"));
    const page = Number(q.get("page"));
    const visible = match.slice(0, 1000); // GitHub stops at 1000 results for filtered queries
    const body = { total_count: Math.min(match.length, o.totalCap ?? Infinity), workflow_runs: visible.slice((page - 1) * per, page * per).map(toApi) };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchFn, urls };
}

const toApi = (r: Run) => ({ id: r.id, run_number: r.number, event: r.event, status: r.status, conclusion: r.conclusion, created_at: new Date(r.created).toISOString(), run_started_at: r.started ? new Date(r.started).toISOString() : null, html_url: r.url });

function everyMinutes(min: number, from: number, to: number, event = "schedule"): Run[] {
  const out: Run[] = [];
  let id = 1;
  for (let t = from; t < to; t += min * 60_000) {
    const created = Math.floor((t + 30_000) / 1000) * 1000;
    out.push({ id: id, number: id++, event, status: "completed", conclusion: "success", created, started: created + 4000, url: `https://github.com/o/r/actions/runs/${id}` });
  }
  return out;
}

class MemCache implements RunCache {
  map = new Map<string, Run[]>();
  async get(k: string) {
    return this.map.get(k);
  }
  async set(k: string, v: Run[]) {
    this.map.set(k, v);
  }
}

test("runsWindow gets every run of a long busy window past the 1000-result cap", async () => {
  const since = NOW - 12 * DAY;
  const all = everyMinutes(5, since - DAY, NOW); // ~3700 runs
  const api = fakeApi(all);
  const gh = new GitHub({ fetch: api.fetch });
  const got = await gh.runsWindow("o/r", 1, { event: "schedule", since, now: NOW });
  const want = all.filter((r) => r.created >= since);
  assert.equal(got.length, want.length);
  assert.equal(new Set(got.map((r) => r.id)).size, got.length, "no duplicates");
  assert.ok(got.every((r, i) => i === 0 || got[i - 1].created <= r.created), "oldest first");
  assert.equal(gh.runStats.truncated, false);
  assert.ok(api.urls.every((u) => /created=/.test(u)));
});

test("runsWindow does not trust an underestimated total_count (big repos report a rounded number)", async () => {
  const since = NOW - 10 * DAY;
  const all = everyMinutes(5, since - DAY, NOW);
  const gh = new GitHub({ fetch: fakeApi(all, { totalCap: 900 }).fetch });
  const got = await gh.runsWindow("o/r", 1, { event: "schedule", since, now: NOW });
  assert.equal(got.length, all.filter((r) => r.created >= since).length);
  assert.equal(gh.runStats.truncated, false);
});

test("runsWindow: a short fresh window is one open-ended query (same API cost as before)", async () => {
  const all = everyMinutes(60, NOW - 8 * DAY, NOW);
  const api = fakeApi(all);
  const gh = new GitHub({ fetch: api.fetch });
  await gh.runsWindow("o/r", 1, { event: "schedule", since: NOW - 8 * DAY, now: NOW });
  assert.equal(api.urls.length, 2, "192 runs = 2 pages of one query");
  assert.match(api.urls[0], /created=>=/);
});

test("runsWindow caches settled, completed days and refetches only recent ones", async () => {
  const since = NOW - 30 * DAY;
  const all = everyMinutes(60, since - DAY, NOW);
  // A run from a settled day that is still queued must not freeze that day in the cache.
  const stuck = all.find((r) => r.created >= Date.parse("2026-10-10T00:00:00Z"))!;
  stuck.status = "queued";
  stuck.started = null;
  const cache = new MemCache();
  const api1 = fakeApi(all);
  const first = await new GitHub({ fetch: api1.fetch, cache }).runsWindow("O/R", 7, { event: "schedule", since, now: NOW });
  const keys = [...cache.map.keys()];
  assert.ok(keys.includes("api.github.com/o/r/7/schedule/2026-10-01"), "keyed by host + repo + workflow + event + UTC day");
  assert.ok(!keys.includes("api.github.com/o/r/7/schedule/2026-10-10"), "a day with an unfinished run is not cached");
  assert.ok(!keys.includes("api.github.com/o/r/7/schedule/2026-10-20"), "yesterday is within the 6h settle margin at 02:50 UTC");
  assert.ok(!keys.includes("api.github.com/o/r/7/schedule/2026-10-21"), "today is never cached");
  assert.ok(NOW - Date.parse("2026-10-21T00:00:00Z") < SETTLE_MS);

  const api2 = fakeApi(all);
  const gh2 = new GitHub({ fetch: api2.fetch, cache });
  const second = await gh2.runsWindow("o/r", 7, { event: "schedule", since, now: NOW });
  assert.deepEqual(second.map((r) => r.id), first.map((r) => r.id));
  assert.equal(api2.urls.length, 2, "one range for the unfinished 2026-10-10, one open query for the last two days");
  assert.ok(api2.urls.some((u) => /created=2026-10-10T00:00:00Z\.\.2026-10-10T23:59:59Z/.test(u)));
  assert.ok(api2.urls.some((u) => /created=>=2026-10-20T00:00:00Z/.test(u)));
  assert.equal(gh2.runStats.cachedDays, gh2.runStats.days - 3);
});

test("DiskRunCache round-trips, ignores corrupt files, and resolves the cache dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cronlag-cache-"));
  const c = new DiskRunCache(dir);
  const runs = everyMinutes(60, NOW - DAY, NOW - DAY + 3 * HOUR);
  await c.set("api.github.com/o/r/1/schedule/2026-10-01", runs);
  assert.deepEqual(await c.get("api.github.com/o/r/1/schedule/2026-10-01"), runs);
  assert.equal(await c.get("api.github.com/o/r/1/schedule/2026-10-02"), undefined);
  const p = join(dir, "runs", "v1", "api.github.com", "o", "r", "1", "schedule");
  assert.deepEqual(readdirSync(p), ["2026-10-01.json"], "no temp files left behind");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "2026-10-03.json"), "{not json");
  assert.equal(await c.get("api.github.com/o/r/1/schedule/2026-10-03"), undefined);
  assert.equal(defaultCacheDir({ CRONLAG_CACHE_DIR: "/x" }), "/x");
  assert.equal(defaultCacheDir({ XDG_CACHE_HOME: "/xdg" }, "linux"), join("/xdg", "cronlag"));
  assert.match(defaultCacheDir({}, "darwin"), /Library[\\/]Caches[\\/]cronlag$/);
  assert.match(defaultCacheDir({ LOCALAPPDATA: "C:\\L" }, "win32"), /cronlag[\\/]Cache$/);
});

test("compactSlots keeps long strips short and never hides a missed slot", () => {
  const run = { id: 1, number: 1, url: "", created: 0, conclusion: "success" };
  const s = (status: Slot["status"], lagMs = 0): Slot => ({ at: 0, cron: "", status, lagMs, ...(status === "missed" ? {} : { run }) });
  const slots = [...Array.from({ length: 299 }, () => s("ontime", 60_000)), s("missed", 0), s("late", 30 * 60_000)];
  const c = compactSlots(slots, 100);
  assert.equal(c.per, 4);
  assert.ok(c.marks.length <= 100);
  const partly = c.marks.filter((m) => m.someMissed);
  assert.equal(partly.length, 1, "the bucket with one miss among runs is an x, not hidden");
  assert.equal(markGlyph(partly[0]).ch, "x");
  assert.deepEqual(compactSlots(slots.slice(0, 50), 100).per, 1);
  const allMissed = compactSlots([s("missed"), s("missed"), s("missed"), s("missed")], 2);
  assert.ok(allMissed.marks.every((m) => !m.someMissed && markGlyph(m).ch === "✕"), "✕ only when every slot in the mark missed");
  const lag = compactSlots([s("ontime", 1), s("late", 20 * 60_000), s("ontime", 5)], 1);
  assert.equal(lag.marks[0].slot.status, "late");
});

test("MCP schedule_report validates since/days before touching the API", async () => {
  const { callTool } = await import("../src/mcp.ts");
  const boom = () => {
    throw new Error("should not reach the API");
  };
  const both = await callTool("schedule_report", { repo: "o/r", days: 3, since: "30d" }, boom as never);
  assert.equal(both.isError, true);
  assert.match(both.text, /either days or since/);
  const bad = await callTool("schedule_report", { repo: "o/r", since: "soon" }, boom as never);
  assert.equal(bad.isError, true);
  assert.match(bad.text, /since "soon" is not a date/);
});
