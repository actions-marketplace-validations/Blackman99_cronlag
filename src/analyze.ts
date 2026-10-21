import { firesBetween, minInterval, prevFire, type Cron } from "./cron.js";
import type { RepoInfo, Run, WorkflowInfo } from "./github.js";
import type { ScheduleEntry } from "./workflow.js";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export interface WorkflowInput extends WorkflowInfo {
  schedules: ScheduleEntry[];
  hasDispatch: boolean;
  parseError?: string;
  fileChangedAt?: number | null;
  /** schedule versions over time, ascending; absent = current schedules always applied */
  timeline?: { since: number; sha?: string; schedules: ScheduleEntry[] }[];
  scheduleRuns: Run[];
  dispatchRuns: Run[];
}

export interface Snapshot {
  repo: RepoInfo;
  from: number;
  now: number;
  workflows: WorkflowInput[];
  /** workflows without any schedule trigger (names only) */
  unscheduled: string[];
}

export interface Thresholds {
  onTimeMs: number;
  lateMs: number;
  maxLagMs: number;
  earlyMs: number;
}

export const DEFAULTS: Thresholds = { onTimeMs: 10 * MIN, lateMs: HOUR, maxLagMs: DAY, earlyMs: 2 * MIN };

export type SlotStatus = "ontime" | "late" | "verylate" | "missed" | "overdue" | "pending";

export interface Slot {
  at: number;
  cron: string;
  status: SlotStatus;
  lagMs?: number;
  queueMs?: number | null;
  run?: { id: number; number: number; url: string; created: number; conclusion: string | null };
}

export type Verdict = "ON TIME" | "LATE" | "DROPPING" | "NOT FIRING" | "DISABLED" | "INVALID" | "NO DATA";

export interface Finding {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
  fix?: string;
}

export interface Stats {
  due: number;
  ran: number;
  missed: number;
  overdue: number;
  pending: number;
  onTime: number;
  late: number;
  veryLate: number;
  within1h: number;
  lagMin: number | null;
  lagMedian: number | null;
  lagP90: number | null;
  lagMax: number | null;
  queueMedian: number | null;
  dispatchQueueMedian: number | null;
  extraRuns: number;
}

export interface WorkflowReport {
  id: number;
  name: string;
  path: string;
  file: string;
  url: string;
  state: string;
  crons: { cron: string; timezone: string; error?: string }[];
  /** schedule changes inside the window */
  changes: { at: string; crons: string[] }[];
  hasDispatch: boolean;
  verdict: Verdict;
  headline: string;
  stats: Stats;
  slots: Slot[];
  findings: Finding[];
}

export interface Report {
  repo: string;
  repoUrl: string;
  from: string;
  now: string;
  days: number;
  workflows: WorkflowReport[];
  unscheduled: string[];
  verdict: Verdict | "NO SCHEDULES";
  findings: Finding[];
}

export function fmtDur(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "–";
  const neg = ms < 0;
  let m = Math.round(Math.abs(ms) / MIN);
  let s: string;
  if (m < 60) s = `${m}m`;
  else if (m < 48 * 60) s = `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  else s = `${Math.floor(m / 1440)}d${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}h`;
  if (Math.abs(ms) < MIN && ms !== 0) s = `${Math.round(Math.abs(ms) / 1000)}s`;
  return neg ? `-${s}` : s;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}

function median(xs: number[]): number | null {
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}

/**
 * Line scheduled runs up with the cron slots they belong to.
 * The REST API does not say which slot a run was for, so each run is tied to
 * the closest preceding unclaimed slot (within maxLag). For schedules more
 * frequent than the delay this makes lag a lower bound.
 */
export function attribute(slotTimes: { at: number; cron: string }[], runs: Run[], t: Thresholds) {
  const slots = [...slotTimes].sort((a, b) => a.at - b.at);
  const claimed = new Map<number, Run>();
  const extra: Run[] = [];
  const sortedRuns = [...runs].sort((a, b) => a.created - b.created);
  for (const r of sortedRuns) {
    // index of last slot <= created + early tolerance
    let lo = 0;
    let hi = slots.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (slots[mid].at <= r.created + t.earlyMs) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    let placed = false;
    for (let i = idx; i >= 0; i--) {
      if (r.created - slots[i].at > t.maxLagMs) break;
      if (!claimed.has(i)) {
        claimed.set(i, r);
        placed = true;
        break;
      }
    }
    if (!placed) extra.push(r);
  }
  return { slots, claimed, extra };
}

/**
 * The same minute field moved off minute 0 without changing how often it fires:
 * "0 6 * * *" → "37 6 * * *", "*\/5" → "3-59/5", "0,30" → "7,37".
 */
export function offMinute(minutes: number[], seed = 0): string {
  const picks = [7, 13, 17, 23, 37, 43, 47, 53];
  if (minutes.length <= 1) return String(picks[seed % picks.length]);
  const sorted = [...minutes].sort((a, b) => a - b);
  const k = sorted[1] - sorted[0];
  const evenly = sorted[0] === 0 && 60 % k === 0 && sorted.length === 60 / k && sorted.every((m, i) => m === i * k);
  if (evenly && k > 1 && sorted.length >= 4) return `${1 + (seed % (k - 1))}-59/${k}`;
  const off = picks.map((p) => p % 60).find((o) => sorted.every((m) => (m + o) % 60 !== 0)) ?? 1;
  return sorted.map((m) => (m + off) % 60).sort((a, b) => a - b).join(",");
}

export function analyzeWorkflow(w: WorkflowInput, snap: Snapshot, t: Thresholds = DEFAULTS): WorkflowReport {
  const findings: Finding[] = [];
  const file = w.path.split("/").pop() ?? w.path;
  const valid = w.schedules.filter((s) => s.parsed) as (ScheduleEntry & { parsed: Cron })[];
  const now = snap.now;

  // Slots: from window start minus maxLag (only for attribution), reported from window start.
  // If the cron changed inside the window, each version only produces slots while it was live.
  const slotTimes: { at: number; cron: string }[] = [];
  const seen = new Set<number>();
  const segs = w.timeline && w.timeline.length ? w.timeline : [{ since: -Infinity, schedules: w.schedules }];
  segs.forEach((seg, i) => {
    // A workflow cannot fire before GitHub registered it: a file added mid-window has no earlier slots.
    const start = Math.max(i === 0 ? (w.created ?? -Infinity) : seg.since, snap.from - t.maxLagMs);
    const end = Math.min(i + 1 < segs.length ? segs[i + 1].since : Infinity, now);
    if (end <= start) return;
    for (const s of seg.schedules) {
      if (!s.parsed) continue;
      for (const at of firesBetween(s.parsed, start, end)) {
        if (seen.has(at)) continue;
        seen.add(at);
        slotTimes.push({ at, cron: s.cron });
      }
    }
  });
  const { slots: allSlots, claimed, extra } = attribute(slotTimes, w.scheduleRuns, t);
  const slots: Slot[] = [];
  let lastClaimed = -1;
  for (const i of claimed.keys()) lastClaimed = Math.max(lastClaimed, i);
  allSlots.forEach((s, i) => {
    if (s.at < snap.from) return;
    const r = claimed.get(i);
    if (r) {
      const lag = Math.max(0, r.created - s.at);
      slots.push({
        at: s.at,
        cron: s.cron,
        status: lag <= t.onTimeMs ? "ontime" : lag <= t.lateMs ? "late" : "verylate",
        lagMs: lag,
        queueMs: r.started ? Math.max(0, r.started - r.created) : null,
        run: { id: r.id, number: r.number, url: r.url, created: r.created, conclusion: r.conclusion },
      });
    } else {
      const age = now - s.at;
      // Missed: older than maxLag, or a later slot already got its run (GitHub does not backfill).
      const missed = age > t.maxLagMs || i < lastClaimed;
      slots.push({ at: s.at, cron: s.cron, status: missed ? "missed" : age > t.onTimeMs ? "overdue" : "pending", lagMs: age });
    }
  });

  const lags = slots.filter((s) => s.run).map((s) => s.lagMs as number).sort((a, b) => a - b);
  const count = (st: SlotStatus) => slots.filter((s) => s.status === st).length;
  const stats: Stats = {
    due: slots.filter((s) => s.status !== "pending").length,
    ran: lags.length,
    missed: count("missed"),
    overdue: count("overdue"),
    pending: count("pending"),
    onTime: count("ontime"),
    late: count("late"),
    veryLate: count("verylate"),
    within1h: lags.filter((l) => l <= HOUR).length,
    lagMin: lags[0] ?? null,
    lagMedian: quantile(lags, 0.5),
    lagP90: quantile(lags, 0.9),
    lagMax: lags.length ? lags[lags.length - 1] : null,
    queueMedian: median(slots.filter((s) => s.queueMs != null).map((s) => s.queueMs as number)),
    dispatchQueueMedian: median(w.dispatchRuns.filter((r) => r.started).map((r) => (r.started as number) - r.created)),
    extraRuns: extra.filter((r) => r.created >= snap.from).length,
  };

  // ---- verdict
  let verdict: Verdict;
  let headline: string;
  if (w.state !== "active") {
    verdict = "DISABLED";
    headline = w.state === "disabled_inactivity" ? "GitHub disabled this workflow after 60 days without repository activity" : `workflow state is ${w.state}`;
  } else if (!valid.length) {
    verdict = "INVALID";
    headline = w.parseError ? `workflow file does not parse: ${w.parseError}` : "no valid cron expression";
  } else if (stats.due === 0) {
    verdict = "NO DATA";
    headline = "no cron slot has come due in this window yet";
  } else if (stats.ran === 0 && stats.missed + stats.overdue > 0) {
    verdict = "NOT FIRING";
    headline = `${stats.missed + stats.overdue} of ${stats.due} slots came due and no scheduled run was created`;
  } else if (stats.missed > 0) {
    verdict = "DROPPING";
    headline = `${stats.missed} of ${stats.due} slots never got a run`;
  } else if ((stats.lagMedian ?? 0) > t.lateMs || stats.veryLate / Math.max(1, stats.ran) >= 0.25) {
    verdict = "LATE";
    headline = `median run is created ${fmtDur(stats.lagMedian)} after its cron slot`;
  } else {
    verdict = "ON TIME";
    headline = `median lag ${fmtDur(stats.lagMedian)}`;
  }
  if (verdict === "DROPPING" && (stats.lagMedian ?? 0) > t.lateMs) headline += `, and the rest ran a median ${fmtDur(stats.lagMedian)} late`;
  // A disabled workflow is not expected to fire, so "overdue" adds nothing to the headline.
  if (stats.overdue && verdict !== "NOT FIRING" && verdict !== "DISABLED") headline += ` · ${stats.overdue} overdue now`;

  // ---- cause checks
  if (w.state === "disabled_inactivity") {
    findings.push({
      level: "error",
      code: "disabled-inactivity",
      message: "In public repos GitHub turns scheduled workflows off after 60 days with no repository activity.",
      fix: `gh workflow enable ${file} -R ${snap.repo.fullName}`,
    });
  } else if (w.state !== "active") {
    findings.push({ level: "error", code: "disabled", message: `Workflow is ${w.state}.`, fix: `gh workflow enable ${file} -R ${snap.repo.fullName}` });
  }
  if (snap.repo.archived) findings.push({ level: "error", code: "archived", message: "Repository is archived; scheduled workflows do not run." });
  if (w.parseError) findings.push({ level: "error", code: "yaml", message: `Workflow file does not parse: ${w.parseError}` });
  for (const s of w.schedules) {
    if (s.error) findings.push({ level: "error", code: "bad-cron", message: `cron "${s.cron}": ${s.error}` });
  }
  for (const s of valid) {
    const gap = minInterval(s.parsed, now);
    if (gap !== null && gap < 5 * MIN) {
      findings.push({
        level: "warn",
        code: "too-frequent",
        message: `"${s.cron}" asks for every ${fmtDur(gap)}; GitHub runs schedules at most every 5 minutes, and short intervals are the first to be delayed or skipped.`,
      });
    }
    if (s.parsed.minutes.includes(0) && s.parsed.minutes.length <= 12) {
      const hurt = verdict === "LATE" || verdict === "DROPPING";
      findings.push({
        level: hurt ? "warn" : "info",
        code: "top-of-hour",
        message: `"${s.cron}" fires at minute 0, GitHub's busiest minute (its docs recommend another one).${hurt ? " Moving it can help, though off-peak schedules were also hit in the Aug–Oct 2026 incidents." : ""}`,
        fix: `cron: '${[offMinute(s.parsed.minutes, w.id), ...s.cron.split(/\s+/).slice(1)].join(" ")}'`,
      });
    }
    if (s.timezone !== "UTC") findings.push({ level: "info", code: "timezone", message: `"${s.cron}" is evaluated in ${s.timezone}.` });
  }
  if (snap.repo.fork) {
    findings.push({ level: "info", code: "fork", message: "This is a fork: scheduled workflows stay off until Actions are enabled in the fork's Actions tab." });
  }
  if (!snap.repo.private && w.state === "active") {
    const idle = now - snap.repo.pushedAt;
    if (idle > 45 * DAY) {
      findings.push({
        level: "warn",
        code: "inactivity-soon",
        message: `No push for ${Math.floor(idle / DAY)} days. GitHub disables schedules in public repos after 60 days without activity${idle < 60 * DAY ? ` (about ${Math.ceil((60 * DAY - idle) / DAY)} days left)` : ""}.`,
        fix: "push any commit, or re-enable the workflow, before day 60",
      });
    }
  }
  // "not registered" only makes sense for an enabled workflow; a disabled one explains itself.
  if (w.fileChangedAt && valid.length && w.state === "active") {
    const since = slots.filter((s) => s.at > (w.fileChangedAt as number) && s.status !== "pending");
    const ranSince = w.scheduleRuns.some((r) => r.created > (w.fileChangedAt as number));
    if (since.length >= 2 && !ranSince && now - since[0].at > 2 * HOUR) {
      findings.push({
        level: "warn",
        code: "not-registered",
        message: `No scheduled run since this file last changed (${new Date(w.fileChangedAt).toISOString().slice(0, 16).replace("T", " ")} UTC), ${since.length} slots ago. Schedules register when the file lands on the default branch and can fail to register.`,
        fix: "re-register: push a commit that edits the cron line (e.g. move the minute), then watch the next slot",
      });
    }
  }
  if (!w.hasDispatch && valid.length && w.state === "active") {
    findings.push({
      level: verdict === "ON TIME" || verdict === "NO DATA" ? "info" : "warn",
      code: "no-dispatch",
      message: "No workflow_dispatch trigger, so missed slots can't be run by hand or by `cronlag catchup`.",
      fix: "add `workflow_dispatch:` under `on:`",
    });
  }
  if (["LATE", "DROPPING", "NOT FIRING"].includes(verdict)) {
    const dq = stats.dispatchQueueMedian;
    findings.push({
      level: "info",
      code: "scheduler-side",
      message:
        `Lag is measured from the cron slot to run creation, before any runner is involved — that part is GitHub's scheduler, not your jobs.` +
        (dq !== null && w.dispatchRuns.length ? ` Manual runs of this workflow start ${dq < 60_000 ? "within seconds of" : fmtDur(dq) + " after"} creation (n=${w.dispatchRuns.length}), so runners are fine.` : ""),
      fix: w.hasDispatch ? `run \`cronlag catchup ${snap.repo.fullName} --dispatch\` from an external cron every 10–15 min` : undefined,
    });
  }
  if (stats.queueMedian !== null && stats.queueMedian > 5 * MIN) {
    findings.push({
      level: "warn",
      code: "queued",
      message: `After creation, scheduled runs wait a median ${fmtDur(stats.queueMedian)} for a runner — that is runner capacity (self-hosted runners, concurrency groups), not the scheduler.`,
    });
  }

  return {
    id: w.id,
    name: w.name,
    path: w.path,
    file,
    url: w.url,
    state: w.state,
    crons: w.schedules.map((s) => ({ cron: s.cron, timezone: s.timezone, ...(s.error ? { error: s.error } : {}) })),
    changes: (w.timeline ?? []).slice(1).filter((c) => c.since >= snap.from).map((c) => ({ at: new Date(c.since).toISOString(), crons: c.schedules.map((x) => x.cron) })),
    hasDispatch: w.hasDispatch,
    verdict,
    headline,
    stats,
    slots,
    findings,
  };
}

/** Higher = worse. Used to sort workflows and org repos. */
export const VERDICT_RANK: Record<string, number> = { "NOT FIRING": 6, DISABLED: 5, INVALID: 5, DROPPING: 4, LATE: 3, "ON TIME": 1, "NO DATA": 0, "NO SCHEDULES": -1 };
const RANK = VERDICT_RANK;

export function analyze(snap: Snapshot, t: Thresholds = DEFAULTS): Report {
  const workflows = snap.workflows.map((w) => analyzeWorkflow(w, snap, t));
  workflows.sort((a, b) => (RANK[b.verdict] ?? 0) - (RANK[a.verdict] ?? 0) || a.file.localeCompare(b.file));
  const worst = workflows[0]?.verdict;
  return {
    repo: snap.repo.fullName,
    repoUrl: snap.repo.url,
    from: new Date(snap.from).toISOString(),
    now: new Date(snap.now).toISOString(),
    days: Math.round((snap.now - snap.from) / DAY),
    workflows,
    unscheduled: snap.unscheduled,
    verdict: worst ?? "NO SCHEDULES",
    findings: [],
  };
}

// ---------- catch-up planning

export interface CatchupStep {
  workflow: string;
  file: string;
  id: number;
  action: "dispatch" | "covered" | "skip";
  slot?: string;
  reason: string;
}

/** For each scheduled workflow: is the latest due slot (older than grace) still without a run? */
export function planCatchup(snap: Snapshot, graceMs = 15 * MIN, t: Thresholds = DEFAULTS): CatchupStep[] {
  const out: CatchupStep[] = [];
  for (const w of snap.workflows) {
    const file = w.path.split("/").pop() ?? w.path;
    const base = { workflow: w.name, file, id: w.id };
    const valid = w.schedules.filter((s) => s.parsed);
    if (!valid.length) continue;
    if (w.state !== "active") {
      out.push({ ...base, action: "skip", reason: `workflow is ${w.state}` });
      continue;
    }
    let latest: { at: number; cron: string } | null = null;
    for (const s of valid) {
      const p = prevFire(s.parsed as Cron, snap.now - graceMs);
      if (p !== null && (!latest || p > latest.at)) latest = { at: p, cron: s.cron };
    }
    if (!latest || snap.now - latest.at > t.maxLagMs) {
      out.push({ ...base, action: "skip", reason: "no slot due in the last 24h" });
      continue;
    }
    const slotIso = new Date(latest.at).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const dispatched = w.dispatchRuns.find((r) => r.created >= latest!.at - t.earlyMs);
    if (dispatched) {
      out.push({ ...base, action: "covered", slot: slotIso, reason: `workflow_dispatch run #${dispatched.number} already created after the slot` });
      continue;
    }
    // Was this slot claimed by a scheduled run?
    const slotTimes: { at: number; cron: string }[] = [];
    for (const s of valid) for (const at of firesBetween(s.parsed as Cron, latest.at - t.maxLagMs, latest.at + 1)) slotTimes.push({ at, cron: s.cron });
    const { slots, claimed } = attribute(slotTimes, w.scheduleRuns, t);
    const idx = slots.findIndex((s) => s.at === latest!.at);
    if (idx >= 0 && claimed.has(idx)) {
      const r = claimed.get(idx)!;
      out.push({ ...base, action: "covered", slot: slotIso, reason: `scheduled run #${r.number} created ${fmtDur(r.created - latest.at)} after the slot` });
      continue;
    }
    if (!w.hasDispatch) {
      out.push({ ...base, action: "skip", slot: slotIso, reason: "slot has no run, but the workflow has no workflow_dispatch trigger" });
      continue;
    }
    out.push({ ...base, action: "dispatch", slot: slotIso, reason: `${new Date(latest.at).toISOString().slice(11, 16)} UTC slot (${latest.cron}) has no run after ${fmtDur(snap.now - latest.at)}` });
  }
  return out;
}

// ---------- guard (inside a late scheduled run)

export interface GuardResult {
  skip: boolean;
  slot: string | null;
  lagMs: number | null;
  reason: string;
}

/** A scheduled run that arrives after catch-up already dispatched its slot should skip. */
export function guard(cron: Cron, runCreated: number, dispatchRuns: Run[], t: Thresholds = DEFAULTS): GuardResult {
  const slot = prevFire(cron, runCreated + t.earlyMs);
  if (slot === null) return { skip: false, slot: null, lagMs: null, reason: "no matching slot found" };
  const lag = Math.max(0, runCreated - slot);
  const iso = new Date(slot).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const cover = dispatchRuns.find((r) => r.created >= slot - t.earlyMs && r.created < runCreated);
  if (cover) return { skip: true, slot: iso, lagMs: lag, reason: `slot ${iso} was already run by workflow_dispatch run #${cover.number}` };
  return { skip: false, slot: iso, lagMs: lag, reason: `first run for slot ${iso} (${fmtDur(lag)} after the slot)` };
}
