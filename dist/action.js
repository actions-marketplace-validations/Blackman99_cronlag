import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cron.ts
function parseField(raw, min, max, names, nameBase = 0) {
  const out = /* @__PURE__ */ new Set();
  for (const part of raw.split(",")) {
    if (part === "") throw new CronError(`empty list item in "${raw}"`);
    let [range, stepRaw] = part.split("/");
    if (part.split("/").length > 2) throw new CronError(`bad step in "${part}"`);
    let step = 1;
    if (stepRaw !== void 0) {
      if (!/^\d+$/.test(stepRaw) || Number(stepRaw) === 0) throw new CronError(`bad step "${stepRaw}"`);
      step = Number(stepRaw);
    }
    let lo;
    let hi;
    const val = (s) => {
      const up = s.toUpperCase();
      if (names) {
        const i = names.indexOf(up);
        if (i >= 0) return i + nameBase;
      }
      if (!/^\d+$/.test(s)) throw new CronError(`"${s}" is not a number`);
      return Number(s);
    };
    if (range === "*" || range === "?") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b, ...rest] = range.split("-");
      if (rest.length) throw new CronError(`bad range "${range}"`);
      lo = val(a);
      hi = val(b);
      if (hi < lo) throw new CronError(`range "${range}" runs backwards`);
    } else {
      lo = val(range);
      hi = stepRaw !== void 0 ? max : lo;
    }
    if (lo < min || hi > max) throw new CronError(`"${part}" is outside ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}
function parseCron(source, timezone = "UTC") {
  const fields = source.trim().split(/\s+/);
  if (fields[0]?.startsWith("@")) throw new CronError(`GitHub Actions does not support "${fields[0]}"`);
  if (fields.length !== 5) throw new CronError(`expected 5 fields, got ${fields.length}`);
  if (!isValidTimeZone(timezone)) throw new CronError(`unknown timezone "${timezone}"`);
  const [m, h, dom, mon, dow] = fields;
  const weekdays = new Set(parseField(dow, 0, 7, DAYS).map((d) => d === 7 ? 0 : d));
  return {
    source: source.trim(),
    timezone,
    minutes: parseField(m, 0, 59),
    hours: parseField(h, 0, 23),
    days: new Set(parseField(dom, 1, 31)),
    months: new Set(parseField(mon, 1, 12, MONTHS, 1)),
    weekdays,
    domStar: dom === "*" || dom === "?" || dom === "*/1",
    dowStar: dow === "*" || dow === "?" || dow === "*/1"
  };
}
function fmt(tz) {
  let f = tzCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    tzCache.set(tz, f);
  }
  return f;
}
function isValidTimeZone(tz) {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}
function tzOffset(t, tz) {
  if (tz === "UTC" || tz === "Etc/UTC") return 0;
  const p = {};
  for (const part of fmt(tz).formatToParts(new Date(t))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(t / 1e3) * 1e3;
}
function localToInstant(y, mo, d, h, mi, tz) {
  const wall = Date.UTC(y, mo, d, h, mi);
  if (tz === "UTC" || tz === "Etc/UTC") return wall;
  const before = tzOffset(wall - 432e5, tz);
  const offs = /* @__PURE__ */ new Set([before, tzOffset(wall, tz), tzOffset(wall + 432e5, tz)]);
  const cands = [...offs].map((o) => wall - o).sort((a, b) => a - b);
  for (const t of cands) if (t + tzOffset(t, tz) === wall) return t;
  let lo = wall - before - 3 * 36e5;
  let hi = wall - before;
  while (hi - lo > 6e4) {
    const mid = Math.floor((lo + hi) / 12e4) * 6e4;
    if (tzOffset(mid, tz) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}
function matchesDay(c, l) {
  if (!c.months.has(l.mo + 1)) return false;
  const dow = new Date(Date.UTC(l.y, l.mo, l.d)).getUTCDay();
  const domOk = c.days.has(l.d);
  const dowOk = c.weekdays.has(dow);
  if (c.domStar || c.dowStar) return domOk && dowOk;
  return domOk || dowOk;
}
function firesBetween(c, from, to, limit = 2e5) {
  const out = [];
  const startWall = from + tzOffset(from, c.timezone) - 864e5;
  const endWall = to + tzOffset(to, c.timezone) + 864e5;
  const seen = /* @__PURE__ */ new Set();
  for (let day = Math.floor(startWall / 864e5) * 864e5; day <= endWall; day += 864e5) {
    const dt = new Date(day);
    const l = { y: dt.getUTCFullYear(), mo: dt.getUTCMonth(), d: dt.getUTCDate() };
    if (!matchesDay(c, l)) continue;
    for (const h of c.hours) {
      for (const m of c.minutes) {
        const t = localToInstant(l.y, l.mo, l.d, h, m, c.timezone);
        if (t < from || t >= to || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
        if (out.length >= limit) return out.sort((a, b) => a - b);
      }
    }
  }
  return out.sort((a, b) => a - b);
}
function nextFires(c, after, n = 5) {
  const out = [];
  let from = Math.floor(after / 6e4) * 6e4 + 6e4;
  for (let span = 864e5 * 2; out.length < n && span < 864e5 * 366 * 30; span *= 2) {
    const got = firesBetween(c, from, from + span, n - out.length);
    out.push(...got);
    from += span;
  }
  return out.slice(0, n);
}
function minInterval(c, at) {
  const f = firesBetween(c, at, at + 864e5 * 8, 2e4);
  if (f.length < 2) return null;
  let best = Infinity;
  for (let i = 1; i < f.length; i++) best = Math.min(best, f[i] - f[i - 1]);
  return best;
}
function prevFire(c, t, maxBack = 864e5 * 40) {
  for (let span = 36e5 * 2; span <= maxBack * 2; span *= 4) {
    const f = firesBetween(c, t - span, t + 1);
    if (f.length) return f[f.length - 1];
  }
  return null;
}
var CronError, MONTHS, DAYS, tzCache;
var init_cron = __esm({
  "src/cron.ts"() {
    "use strict";
    CronError = class extends Error {
    };
    MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    tzCache = /* @__PURE__ */ new Map();
  }
});

// src/analyze.ts
function fmtDur(ms) {
  if (ms === null || ms === void 0 || !Number.isFinite(ms)) return "\u2013";
  const neg = ms < 0;
  let m = Math.round(Math.abs(ms) / MIN);
  let s;
  if (m < 60) s = `${m}m`;
  else if (m < 48 * 60) s = `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  else s = `${Math.floor(m / 1440)}d${String(Math.floor(m % 1440 / 60)).padStart(2, "0")}h`;
  if (Math.abs(ms) < MIN && ms !== 0) s = `${Math.round(Math.abs(ms) / 1e3)}s`;
  return neg ? `-${s}` : s;
}
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}
function median(xs) {
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}
function attribute(slotTimes, runs, t) {
  const slots = [...slotTimes].sort((a, b) => a.at - b.at);
  const claimed = /* @__PURE__ */ new Map();
  const extra = [];
  const sortedRuns = [...runs].sort((a, b) => a.created - b.created);
  for (const r of sortedRuns) {
    let lo = 0;
    let hi = slots.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = lo + hi >> 1;
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
function offMinute(minutes, seed = 0) {
  const picks = [7, 13, 17, 23, 37, 43, 47, 53];
  if (minutes.length <= 1) return String(picks[seed % picks.length]);
  const sorted = [...minutes].sort((a, b) => a - b);
  const k = sorted[1] - sorted[0];
  const evenly = sorted[0] === 0 && 60 % k === 0 && sorted.length === 60 / k && sorted.every((m, i) => m === i * k);
  if (evenly && k > 1 && sorted.length >= 4) return `${1 + seed % (k - 1)}-59/${k}`;
  const off = picks.map((p) => p % 60).find((o) => sorted.every((m) => (m + o) % 60 !== 0)) ?? 1;
  return sorted.map((m) => (m + off) % 60).sort((a, b) => a - b).join(",");
}
function analyzeWorkflow(w, snap, t = DEFAULTS) {
  const findings = [];
  const file = w.path.split("/").pop() ?? w.path;
  const valid = w.schedules.filter((s) => s.parsed);
  const now = snap.now;
  const slotTimes = [];
  const seen = /* @__PURE__ */ new Set();
  const segs = w.timeline && w.timeline.length ? w.timeline : [{ since: -Infinity, schedules: w.schedules }];
  segs.forEach((seg, i) => {
    const start = Math.max(i === 0 ? w.created ?? -Infinity : seg.since, snap.from - t.maxLagMs);
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
  const slots = [];
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
        run: { id: r.id, number: r.number, url: r.url, created: r.created, conclusion: r.conclusion }
      });
    } else {
      const age = now - s.at;
      const missed = age > t.maxLagMs || i < lastClaimed;
      slots.push({ at: s.at, cron: s.cron, status: missed ? "missed" : age > t.onTimeMs ? "overdue" : "pending", lagMs: age });
    }
  });
  const lags = slots.filter((s) => s.run).map((s) => s.lagMs).sort((a, b) => a - b);
  const count = (st) => slots.filter((s) => s.status === st).length;
  const stats = {
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
    queueMedian: median(slots.filter((s) => s.queueMs != null).map((s) => s.queueMs)),
    dispatchQueueMedian: median(w.dispatchRuns.filter((r) => r.started).map((r) => r.started - r.created)),
    extraRuns: extra.filter((r) => r.created >= snap.from).length
  };
  let verdict;
  let headline;
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
  if (stats.overdue && verdict !== "NOT FIRING" && verdict !== "DISABLED") headline += ` \xB7 ${stats.overdue} overdue now`;
  if (w.state === "disabled_inactivity") {
    findings.push({
      level: "error",
      code: "disabled-inactivity",
      message: "In public repos GitHub turns scheduled workflows off after 60 days with no repository activity.",
      fix: `gh workflow enable ${file} -R ${snap.repo.fullName}`
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
        message: `"${s.cron}" asks for every ${fmtDur(gap)}; GitHub runs schedules at most every 5 minutes, and short intervals are the first to be delayed or skipped.`
      });
    }
    if (s.parsed.minutes.includes(0) && s.parsed.minutes.length <= 12) {
      const hurt = verdict === "LATE" || verdict === "DROPPING";
      findings.push({
        level: hurt ? "warn" : "info",
        code: "top-of-hour",
        message: `"${s.cron}" fires at minute 0, GitHub's busiest minute (its docs recommend another one).${hurt ? " Moving it can help, though off-peak schedules were also hit in the Aug\u2013Oct 2026 incidents." : ""}`,
        fix: `cron: '${[offMinute(s.parsed.minutes, w.id), ...s.cron.split(/\s+/).slice(1)].join(" ")}'`
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
        fix: "push any commit, or re-enable the workflow, before day 60"
      });
    }
  }
  if (w.fileChangedAt && valid.length && w.state === "active") {
    const since = slots.filter((s) => s.at > w.fileChangedAt && s.status !== "pending");
    const ranSince = w.scheduleRuns.some((r) => r.created > w.fileChangedAt);
    if (since.length >= 2 && !ranSince && now - since[0].at > 2 * HOUR) {
      findings.push({
        level: "warn",
        code: "not-registered",
        message: `No scheduled run since this file last changed (${new Date(w.fileChangedAt).toISOString().slice(0, 16).replace("T", " ")} UTC), ${since.length} slots ago. Schedules register when the file lands on the default branch and can fail to register.`,
        fix: "re-register: push a commit that edits the cron line (e.g. move the minute), then watch the next slot"
      });
    }
  }
  if (!w.hasDispatch && valid.length && w.state === "active") {
    findings.push({
      level: verdict === "ON TIME" || verdict === "NO DATA" ? "info" : "warn",
      code: "no-dispatch",
      message: "No workflow_dispatch trigger, so missed slots can't be run by hand or by `cronlag catchup`.",
      fix: "add `workflow_dispatch:` under `on:`"
    });
  }
  if (["LATE", "DROPPING", "NOT FIRING"].includes(verdict)) {
    const dq = stats.dispatchQueueMedian;
    findings.push({
      level: "info",
      code: "scheduler-side",
      message: `Lag is measured from the cron slot to run creation, before any runner is involved \u2014 that part is GitHub's scheduler, not your jobs.` + (dq !== null && w.dispatchRuns.length ? ` Manual runs of this workflow start ${dq < 6e4 ? "within seconds of" : fmtDur(dq) + " after"} creation (n=${w.dispatchRuns.length}), so runners are fine.` : ""),
      fix: w.hasDispatch ? `catch up from outside GitHub: \`cronlag worker ${snap.repo.fullName}\`` : void 0
    });
  }
  if (stats.queueMedian !== null && stats.queueMedian > 5 * MIN) {
    findings.push({
      level: "warn",
      code: "queued",
      message: `After creation, scheduled runs wait a median ${fmtDur(stats.queueMedian)} for a runner \u2014 that is runner capacity (self-hosted runners, concurrency groups), not the scheduler.`
    });
  }
  return {
    id: w.id,
    name: w.name,
    path: w.path,
    file,
    url: w.url,
    state: w.state,
    crons: w.schedules.map((s) => ({ cron: s.cron, timezone: s.timezone, ...s.error ? { error: s.error } : {} })),
    changes: (w.timeline ?? []).slice(1).filter((c) => c.since >= snap.from).map((c) => ({ at: new Date(c.since).toISOString(), crons: c.schedules.map((x) => x.cron) })),
    hasDispatch: w.hasDispatch,
    verdict,
    headline,
    stats,
    slots,
    findings
  };
}
function analyze(snap, t = DEFAULTS) {
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
    findings: []
  };
}
function planCatchup(snap, graceMs = 15 * MIN, t = DEFAULTS) {
  const out = [];
  for (const w of snap.workflows) {
    const file = w.path.split("/").pop() ?? w.path;
    const base = { workflow: w.name, file, id: w.id };
    const valid = w.schedules.filter((s) => s.parsed);
    if (!valid.length) continue;
    if (w.state !== "active") {
      out.push({ ...base, action: "skip", reason: `workflow is ${w.state}` });
      continue;
    }
    let latest = null;
    for (const s of valid) {
      const p = prevFire(s.parsed, snap.now - graceMs);
      if (p !== null && (!latest || p > latest.at)) latest = { at: p, cron: s.cron };
    }
    if (!latest || snap.now - latest.at > t.maxLagMs) {
      out.push({ ...base, action: "skip", reason: "no slot due in the last 24h" });
      continue;
    }
    const slotIso = new Date(latest.at).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const dispatched = w.dispatchRuns.find((r) => r.created >= latest.at - t.earlyMs);
    if (dispatched) {
      out.push({ ...base, action: "covered", slot: slotIso, reason: `workflow_dispatch run #${dispatched.number} already created after the slot` });
      continue;
    }
    const slotTimes = [];
    for (const s of valid) for (const at of firesBetween(s.parsed, latest.at - t.maxLagMs, latest.at + 1)) slotTimes.push({ at, cron: s.cron });
    const { slots, claimed } = attribute(slotTimes, w.scheduleRuns, t);
    const idx = slots.findIndex((s) => s.at === latest.at);
    if (idx >= 0 && claimed.has(idx)) {
      const r = claimed.get(idx);
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
function guard(cron, runCreated, dispatchRuns, t = DEFAULTS) {
  const slot = prevFire(cron, runCreated + t.earlyMs);
  if (slot === null) return { skip: false, slot: null, lagMs: null, reason: "no matching slot found" };
  const lag = Math.max(0, runCreated - slot);
  const iso = new Date(slot).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const cover = dispatchRuns.find((r) => r.created >= slot - t.earlyMs && r.created < runCreated);
  if (cover) return { skip: true, slot: iso, lagMs: lag, reason: `slot ${iso} was already run by workflow_dispatch run #${cover.number}` };
  return { skip: false, slot: iso, lagMs: lag, reason: `first run for slot ${iso} (${fmtDur(lag)} after the slot)` };
}
var MIN, HOUR, DAY, DEFAULTS, VERDICT_RANK, RANK;
var init_analyze = __esm({
  "src/analyze.ts"() {
    "use strict";
    init_cron();
    MIN = 6e4;
    HOUR = 60 * MIN;
    DAY = 24 * HOUR;
    DEFAULTS = { onTimeMs: 10 * MIN, lateMs: HOUR, maxLagMs: DAY, earlyMs: 2 * MIN };
    VERDICT_RANK = { "NOT FIRING": 6, DISABLED: 5, INVALID: 5, DROPPING: 4, LATE: 3, "ON TIME": 1, "NO DATA": 0, "NO SCHEDULES": -1 };
    RANK = VERDICT_RANK;
  }
});

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = Symbol.for("yaml.alias");
    var DOC = Symbol.for("yaml.document");
    var MAP = Symbol.for("yaml.map");
    var PAIR = Symbol.for("yaml.pair");
    var SCALAR = Symbol.for("yaml.scalar");
    var SEQ = Symbol.for("yaml.seq");
    var NODE_TYPE = Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key2, node, visitor, path) {
      const ctrl = callVisitor(key2, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key2, path, ctrl);
        return visit_(key2, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key2, node, visitor, path) {
      const ctrl = await callVisitor(key2, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key2, path, ctrl);
        return visitAsync_(key2, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key2, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key2, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key2, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key2, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key2, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key2, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key2, node, path);
      return void 0;
    }
    function replaceNode(key2, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key2] = node;
      } else if (identity.isPair(parent)) {
        if (key2 === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key2, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key2, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key2, ...rest] = path;
          const node = this.get(key2, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key2, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key2}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key2, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key2);
        const node = this.get(key2, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key2}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key2, ...rest] = path;
        const node = this.get(key2, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key2, ...rest] = path;
        if (rest.length === 0)
          return this.has(key2);
        const node = this.get(key2, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key2, ...rest] = path;
        if (rest.length === 0) {
          this.set(key2, value);
        } else {
          const node = this.get(key2, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key2, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key2}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key: key2, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key2) && key2.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key2) || !identity.isNode(key2) && typeof key2 === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key2 || keyComment && value == null && !ctx.inFlow || identity.isCollection(key2) || (identity.isScalar(key2) ? key2.type === Scalar.Scalar.BLOCK_FOLDED || key2.type === Scalar.Scalar.BLOCK_LITERAL : typeof key2 === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key2, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key2) => (merge.identify(key2) || identity.isScalar(key2) && (!key2.type || key2.type === Scalar.Scalar.PLAIN) && merge.identify(key2.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key2, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key2))
            map.set(key2, value2);
        } else if (map instanceof Set) {
          map.add(key2);
        } else if (!Object.prototype.hasOwnProperty.call(map, key2)) {
          Object.defineProperty(map, key2, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key: key2, value }) {
      if (identity.isNode(key2) && key2.addToJSMap)
        key2.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key2))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key2, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key2, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key2, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key2) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key2.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key2, value, ctx) {
      const k = createNode.createNode(key2, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key2, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key2;
        this.value = value;
      }
      clone(schema) {
        let { key: key2, value } = this;
        if (identity.isNode(key2))
          key2 = key2.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key2, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key2) {
      const k = identity.isScalar(key2) ? key2.value : key2;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key2 || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key2, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key2, value);
          else if (Array.isArray(replacer) && !replacer.includes(key2))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key2, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key2, value] of obj)
            add(key2, value);
        } else if (obj && typeof obj === "object") {
          for (const key2 of Object.keys(obj))
            add(key2, obj[key2]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key2) {
        const it = findPair(this.items, key2);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key2, keepScalar) {
        const it = findPair(this.items, key2);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key2) {
        return !!findPair(this.items, key2);
      }
      set(key2, value) {
        this.add(new Pair.Pair(key2, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key2) {
        const idx = asItemIndex(key2);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key2, keepScalar) {
        const idx = asItemIndex(key2);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key2) {
        const idx = asItemIndex(key2);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key2, value) {
        const idx = asItemIndex(key2);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key2}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key2 = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key2, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key2) {
      let idx = identity.isScalar(key2) ? key2.value : key2;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key2, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key2 = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key2 = keys[0];
              value = it[key2];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key2 = it;
          }
          pairs2.items.push(Pair.createPair(key2, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key2, value;
          if (identity.isPair(pair)) {
            key2 = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key2, ctx);
          } else {
            key2 = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key2))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key2, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key: key2 } of pairs$1.items) {
          if (identity.isScalar(key2)) {
            if (seenKeys.includes(key2.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key2.value}`);
            } else {
              seenKeys.push(key2.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key2) {
        let pair;
        if (identity.isPair(key2))
          pair = key2;
        else if (key2 && typeof key2 === "object" && "key" in key2 && "value" in key2 && key2.value === null)
          pair = new Pair.Pair(key2.key, null);
        else
          pair = new Pair.Pair(key2, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key2, keepPair) {
        const pair = YAMLMap.findPair(this.items, key2);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key2, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key2);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key2));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key2) => key2 !== "yaml11").map((key2) => JSON.stringify(key2)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key2) => JSON.stringify(key2)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key2, value, options = {}) {
        const k = this.createNode(key2, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key2) {
        return assertCollection(this.contents) ? this.contents.delete(key2) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key2, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key2, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key2) {
        return identity.isCollection(this.contents) ? this.contents.has(key2) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key2, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key2], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key2, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key2) {
      if (!key2)
        return null;
      switch (key2.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key2.source.includes("\n"))
            return true;
          if (key2.end) {
            for (const st of key2.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key2.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key: key2, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key2 ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key2) {
            if (key2.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key2 && key2.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key2)) {
            onError(key2 ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key2 ? composeNode(ctx, key2, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key2, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key2 || key2.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key: key2, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key2 ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key2))
            onError(
              key2,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key2 ? composeNode(ctx, key2, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key2))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key2 of Object.keys(token))
          if (key2 !== "type" && key2 !== "offset")
            delete token[key2];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key2 of Object.keys(token))
            if (key2 !== "type" && key2 !== "offset")
              delete token[key2];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key: key2, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key2)
        res += stringifyToken(key2);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field, index] of path) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field = path[path.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key2 = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key: key2, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse2(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse2;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// src/workflow.ts
function readTriggers(text) {
  let doc;
  try {
    doc = (0, import_yaml.parse)(text, { version: "1.2", uniqueKeys: false });
  } catch (e) {
    return { schedules: [], hasDispatch: false, parseError: e.message.split("\n")[0] };
  }
  if (!doc || typeof doc !== "object") return { schedules: [], hasDispatch: false, parseError: "workflow file is empty" };
  const d = doc;
  const on = d.on ?? d["true"] ?? d[1];
  const out = { schedules: [], hasDispatch: false };
  if (typeof on === "string") {
    out.hasDispatch = on === "workflow_dispatch";
    return out;
  }
  if (Array.isArray(on)) {
    out.hasDispatch = on.includes("workflow_dispatch");
    return out;
  }
  if (!on || typeof on !== "object") return out;
  const o = on;
  out.hasDispatch = "workflow_dispatch" in o;
  const sched = o.schedule;
  if (Array.isArray(sched)) {
    for (const item of sched) {
      if (!item || typeof item !== "object") continue;
      const it = item;
      if (typeof it.cron !== "string") continue;
      const tz = typeof it.timezone === "string" && it.timezone ? it.timezone : "UTC";
      const e = { cron: it.cron.trim(), timezone: tz };
      try {
        e.parsed = parseCron(e.cron, tz);
      } catch (err) {
        e.error = err instanceof CronError ? err.message : String(err);
      }
      out.schedules.push(e);
    }
  }
  return out;
}
var import_yaml;
var init_workflow = __esm({
  "src/workflow.ts"() {
    "use strict";
    import_yaml = __toESM(require_dist(), 1);
    init_cron();
  }
});

// src/collect.ts
function matchesFilter(w, filters) {
  if (!filters || !filters.length) return true;
  const file = w.path.split("/").pop() ?? "";
  return filters.some((f) => f === String(w.id) || f === w.name || f === w.path || f === file || f === file.replace(/\.ya?ml$/, ""));
}
async function collect(gh, fullName, o = {}) {
  const now = o.now ?? Date.now();
  const from = o.from ?? now - (o.days ?? 7) * DAY;
  const repo = await gh.repo(fullName);
  o.onProgress?.(`${repo.fullName}: listing workflows`);
  const all = (await gh.workflows(repo.fullName)).filter((w) => matchesFilter(w, o.workflows));
  const out = [];
  const unscheduled = [];
  const files = all.filter((w) => w.path.startsWith(".github/workflows/"));
  const texts = await Promise.all(
    files.map(async (w) => {
      try {
        return await gh.file(repo.fullName, w.path, repo.defaultBranch);
      } catch {
        return null;
      }
    })
  );
  for (let i = 0; i < files.length; i++) {
    const w = files[i];
    const text = texts[i];
    if (text === null) continue;
    const trig = readTriggers(text);
    if (!trig.schedules.length && !trig.parseError) {
      unscheduled.push(w.path.split("/").pop() ?? w.path);
      continue;
    }
    if (!trig.schedules.length && !/^\s*schedule\s*:/m.test(text)) continue;
    o.onProgress?.(`${w.path}: reading runs`);
    const [scheduleRuns, dispatchRuns, history] = await Promise.all([
      gh.runsWindow(repo.fullName, w.id, { event: "schedule", since: from - DAY, now }),
      trig.hasDispatch ? gh.runsWindow(repo.fullName, w.id, { event: "workflow_dispatch", since: from - DAY, now }) : Promise.resolve([]),
      o.lite ? Promise.resolve(null) : gh.fileHistory(repo.fullName, w.path, repo.defaultBranch).catch(() => null)
    ]);
    let timeline;
    if (history && history.length) {
      const asc = [...history].sort((a, b) => a.date - b.date);
      const startIdx = Math.max(0, asc.findIndex((c) => c.date >= from - DAY) - 1);
      const relevant = asc.findIndex((c) => c.date >= from - DAY) === -1 ? asc.slice(-1) : asc.slice(startIdx);
      const head = relevant[relevant.length - 1];
      timeline = await Promise.all(
        relevant.map(async (c) => {
          const t = c === head ? trig : readTriggers(await gh.file(repo.fullName, w.path, c.sha).catch(() => ""));
          return { since: c.date, sha: c.sha, schedules: t.schedules };
        })
      );
      timeline = timeline.filter((seg, i2, arr) => i2 === 0 || key(seg.schedules) !== key(arr[i2 - 1].schedules));
    }
    out.push({
      ...w,
      schedules: trig.schedules,
      hasDispatch: trig.hasDispatch,
      parseError: trig.parseError,
      fileChangedAt: history?.[0]?.date ?? null,
      timeline,
      scheduleRuns,
      dispatchRuns
    });
  }
  return { repo, from, now, workflows: out, unscheduled };
}
var key;
var init_collect = __esm({
  "src/collect.ts"() {
    "use strict";
    init_analyze();
    init_workflow();
    key = (s) => s.map((x) => `${x.cron}@${x.timezone}`).sort().join("|");
  }
});

// src/window.ts
function parseSince(input2, now = Date.now()) {
  const s = input2.trim();
  const rel = s.match(/^(\d+(?:\.\d+)?)\s*(h|hours?|d|days?|w|weeks?)$/i);
  let from;
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2][0].toLowerCase();
    from = now - n * (u === "h" ? HOUR2 : u === "w" ? 7 * DAY2 : DAY2);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    from = Date.parse(`${s}T00:00:00Z`);
    if (!Number.isFinite(from) || new Date(from).toISOString().slice(0, 10) !== s) throw new WindowError(`--since ${s} is not a real calendar date`);
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.test(s)) {
    const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
    from = Date.parse(s.replace(" ", "T") + (zoned ? "" : "Z"));
    if (!Number.isFinite(from)) throw new WindowError(`--since ${s} is not a valid date-time`);
  } else if (/^\d+\s*(m|min|mins|minutes?)$/i.test(s)) {
    throw new WindowError(`--since ${s}: the shortest window is 1h \u2014 use hours, days or weeks (36h, 30d, 6w)`);
  } else {
    throw new WindowError(`--since "${s}" is not a date \u2014 use 2026-09-01, 2026-09-01T06:00Z, or a relative 36h / 30d / 6w`);
  }
  if (from > now) throw new WindowError(`--since ${iso16(from)} UTC is in the future`);
  const span = now - from;
  if (span < HOUR2) throw new WindowError(`--since ${s} is less than an hour ago; the shortest window is 1h`);
  if (span > MAX_WINDOW_DAYS * DAY2 + (rel ? 0 : DAY2)) {
    throw new WindowError(`--since ${s} is ${Math.floor(span / DAY2)} days back; the longest window is ${MAX_WINDOW_DAYS} days (try --since ${MAX_WINDOW_DAYS}d)`);
  }
  return Math.max(from, now - (MAX_WINDOW_DAYS + 1) * DAY2);
}
function parseDays(input2) {
  const n = typeof input2 === "number" ? input2 : Number(String(input2).trim());
  if (!Number.isFinite(n) || n <= 0) throw new WindowError(`--days ${input2} is not a positive number of days`);
  if (n > MAX_WINDOW_DAYS) throw new WindowError(`--days ${input2} is too long; the longest window is ${MAX_WINDOW_DAYS} days`);
  return n;
}
function resolveWindow(o, now = Date.now()) {
  const hasDays = o.days !== void 0 && o.days !== "";
  const hasSince = o.since !== void 0 && o.since !== "";
  if (hasDays && hasSince) throw new WindowError("use either --days or --since, not both");
  if (hasSince) {
    const from = parseSince(o.since, now);
    return { from, days: (now - from) / DAY2, since: true };
  }
  const days = hasDays ? parseDays(o.days) : DEFAULT_WINDOW_DAYS;
  return { from: now - days * DAY2, days, since: false };
}
function windowLabel(fromIso, nowIso) {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  const span = now - from;
  const whole = (unit) => Math.abs(span / unit - Math.round(span / unit)) < 1e-6;
  if (span < 2 * DAY2 && whole(HOUR2)) return `last ${Math.round(span / HOUR2)}h`;
  if (whole(DAY2)) {
    const d = Math.round(span / DAY2);
    return `last ${d} day${d === 1 ? "" : "s"}`;
  }
  const days = span / DAY2;
  return `since ${iso16(from)} (${days < 10 ? days.toFixed(1) : Math.round(days)} days)`;
}
var HOUR2, DAY2, MAX_WINDOW_DAYS, DEFAULT_WINDOW_DAYS, WindowError, iso16;
var init_window = __esm({
  "src/window.ts"() {
    "use strict";
    HOUR2 = 36e5;
    DAY2 = 24 * HOUR2;
    MAX_WINDOW_DAYS = 400;
    DEFAULT_WINDOW_DAYS = 7;
    WindowError = class extends Error {
    };
    iso16 = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
  }
});

// src/format.ts
function slotGlyph(s) {
  switch (s.status) {
    case "missed":
      return { ch: "\u2715", tone: "magenta" };
    case "overdue":
      return { ch: "?", tone: "magenta" };
    case "pending":
      return { ch: "\xB7", tone: "gray" };
    default: {
      const m = (s.lagMs ?? 0) / 6e4;
      const steps = [2, 10, 30, 60, 180, 360, 720];
      let i = steps.findIndex((x) => m <= x);
      if (i < 0) i = 7;
      return { ch: BARS[i], tone: s.status === "ontime" ? "green" : s.status === "late" ? "yellow" : "red" };
    }
  }
}
function compactSlots(slots, max) {
  if (slots.length <= max) return { marks: slots.map((slot) => ({ slot })), per: 1 };
  const per = Math.ceil(slots.length / max);
  const marks = [];
  for (let i = 0; i < slots.length; i += per) {
    const group = slots.slice(i, i + per);
    const worst = group.reduce((w, s) => {
      const d = SEVERITY[s.status] - SEVERITY[w.status];
      return d > 0 || d === 0 && (s.lagMs ?? 0) > (w.lagMs ?? 0) ? s : w;
    });
    const missed = group.filter((s) => s.status === "missed").length;
    marks.push(missed && missed < group.length && group.some((s) => s.run) ? { slot: worst, someMissed: true } : { slot: worst });
  }
  return { marks, per };
}
function markGlyph(m) {
  return m.someMissed ? { ch: "x", tone: "magenta" } : slotGlyph(m.slot);
}
function wrap(text, width) {
  const out = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if (cur && cur.length + 1 + word.length > width) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}
function formatText(r, o) {
  const c = (k, s) => o.color ? C[k] + s + C.reset : s;
  const width = Math.max(40, Math.min(o.width ?? 100, 120));
  const lines = [];
  lines.push(`${c("bold", "cronlag")}  ${r.repo}  ${c("dim", `\xB7 ${windowLabel(r.from, r.now)} \xB7 times UTC`)}`);
  if (!r.workflows.length) {
    lines.push("");
    lines.push(`No scheduled workflows found${r.unscheduled.length ? ` (${r.unscheduled.length} workflows without \`on: schedule\`)` : ""}.`);
    return lines.join("\n");
  }
  const perLine = Math.max(20, width - 4);
  let folded = false;
  for (const w of r.workflows) {
    lines.push("");
    const crons = w.crons.map((x) => `${x.cron}${x.timezone !== "UTC" ? ` (${x.timezone})` : ""}`).join("  |  ");
    lines.push(`${c("bold", w.file)}  ${c("dim", `"${w.name}"`)}  ${c("cyan", crons)}`);
    for (const ch of w.changes) lines.push(`  ${c("dim", `schedule changed ${ch.at.slice(0, 16).replace("T", " ")} \u2192 ${ch.crons.join(", ") || "(none)"}; earlier slots use the old cron`)}`);
    const strip = compactSlots(w.slots, perLine * 3);
    if (strip.per > 1) folded = true;
    for (let i = 0; i < strip.marks.length; i += perLine) {
      const chunk = strip.marks.slice(i, i + perLine);
      lines.push("  " + chunk.map((m) => {
        const g = markGlyph(m);
        return c(g.tone, g.ch);
      }).join(""));
    }
    const s = w.stats;
    if (w.slots.length) {
      lines.push(`  ${s.due} slots${strip.per > 1 ? c("dim", ` (1 mark = worst of ${strip.per})`) : ""} \xB7 ${s.ran} ran \xB7 ${s.missed ? c("magenta", `${s.missed} missed`) : "0 missed"}${s.overdue ? ` \xB7 ${c("magenta", `${s.overdue} overdue`)}` : ""}${s.ran ? `   on time ${s.onTime}/${s.ran} \xB7 within 1h ${s.within1h}/${s.ran}` : ""}`);
      if (s.ran) lines.push(`  lag  min ${fmtDur(s.lagMin)} \xB7 median ${c("bold", fmtDur(s.lagMedian))} \xB7 p90 ${fmtDur(s.lagP90)} \xB7 max ${fmtDur(s.lagMax)}${s.queueMedian !== null && s.queueMedian > 6e4 ? `   queue ${fmtDur(s.queueMedian)}` : ""}`);
    }
    const tone = TONE[w.verdict] ?? "gray";
    lines.push(`  ${c(tone, c("bold", w.verdict.padEnd(10)))} ${w.headline}`);
    for (const f of w.findings) {
      const mark = f.level === "error" ? c("red", "\u2717") : f.level === "warn" ? c("yellow", "!") : c("dim", "\xB7");
      wrap(f.message, width - 4).forEach((ln, i) => lines.push(`  ${i ? " " : mark} ${f.level === "info" ? c("dim", ln) : ln}`));
      if (f.fix) wrap(f.fix, width - 6).forEach((ln, i) => lines.push(`    ${i ? " " : c("dim", "\u2192")} ${ln}`));
    }
  }
  if (r.unscheduled.length) {
    lines.push("");
    lines.push(c("dim", `${r.unscheduled.length} other workflow${r.unscheduled.length === 1 ? "" : "s"} without a schedule: ${r.unscheduled.slice(0, 8).join(", ")}${r.unscheduled.length > 8 ? ", \u2026" : ""}`));
  }
  lines.push("");
  lines.push(c("dim", `bar = lag  \u2581\u22642m \u2582\u226410m \u2583\u226430m \u2584\u22641h \u2585\u22643h \u2586\u22646h \u2587\u226412h \u2588>12h   \u2715 no run${folded ? "   x some missed" : ""}   ? not yet`));
  return lines.join("\n");
}
function mdSlotRow(w) {
  const strip = compactSlots(w.slots, 240);
  return "`" + strip.marks.map((m) => markGlyph(m).ch).join("") + "`" + (strip.per > 1 ? ` <sub>each mark = ${strip.per} slots: \u2715 none ran, x some missed, else the worst lag</sub>` : "");
}
function formatMarkdown(r) {
  const out = [];
  out.push(`### cronlag \u2014 ${r.repo} \xB7 ${windowLabel(r.from, r.now)} \xB7 UTC`);
  out.push("");
  if (!r.workflows.length) {
    out.push("No scheduled workflows found.");
    return out.join("\n");
  }
  out.push("| Workflow | Cron | Verdict | Slots | Ran | Missed | Median lag | p90 | Max | Within 1h |");
  out.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const w of r.workflows) {
    const s = w.stats;
    out.push(
      `| [${w.file}](${w.url}) | ${w.crons.map((x) => "`" + x.cron + "`").join("<br>")} | **${w.verdict}** | ${s.due} | ${s.ran} | ${s.missed}${s.overdue ? ` (+${s.overdue} overdue)` : ""} | ${fmtDur(s.lagMedian)} | ${fmtDur(s.lagP90)} | ${fmtDur(s.lagMax)} | ${s.ran ? `${s.within1h}/${s.ran}` : "\u2013"} |`
    );
  }
  for (const w of r.workflows) {
    out.push("");
    out.push(`**${w.file}** \u2014 ${w.verdict}: ${w.headline}`);
    if (w.slots.length) out.push("", mdSlotRow(w));
    for (const f of w.findings) out.push(`- ${f.level === "error" ? "\u2717" : f.level === "warn" ? "\u26A0\uFE0F" : "\xB7"} ${f.message}${f.fix ? ` \u2192 ${f.fix.includes("`") ? f.fix : "`" + f.fix + "`"}` : ""}`);
    const late = w.slots.filter((s) => s.status !== "ontime" && s.status !== "pending").slice(-8);
    if (late.length) {
      out.push("", "<details><summary>Recent slots that were late or missed</summary>", "", "| Slot (UTC) | Run created | Lag |", "|---|---|---:|");
      for (const s of late) {
        out.push(`| ${new Date(s.at).toISOString().slice(0, 16).replace("T", " ")} | ${s.run ? `[#${s.run.number}](${s.run.url}) ${new Date(s.run.created).toISOString().slice(0, 16).replace("T", " ")}` : s.status === "missed" ? "**no run**" : "_none yet_"} | ${s.run ? fmtDur(s.lagMs) : `${fmtDur(s.lagMs)}+`} |`);
      }
      out.push("", "</details>");
    }
  }
  out.push("", `<sub>Lag = cron slot \u2192 run creation. Generated by [cronlag](https://github.com/Blackman99/cronlag).</sub>`);
  return out.join("\n");
}
function formatCatchup(steps, dispatched, color) {
  const c = (k, s) => color ? C[k] + s + C.reset : s;
  if (!steps.length) return "No scheduled workflows.";
  return steps.map((s) => {
    if (s.error) return `${c("red", "FAILED    ")} ${s.file.padEnd(24)} ${s.reason} \u2014 dispatch failed: ${s.error}`;
    const tag = s.action === "dispatch" ? c("yellow", dispatched ? "DISPATCHED" : "WOULD RUN ") : s.action === "covered" ? c("green", "COVERED   ") : c("dim", "SKIP      ");
    return `${tag} ${s.file.padEnd(24)} ${s.reason}`;
  }).join("\n");
}
function formatOrgText(r, o) {
  const c = (k, s) => o.color ? C[k] + s + C.reset : s;
  const lines = [];
  lines.push(
    `${c("bold", "cronlag")}  org/${r.org}  ${c("dim", `\xB7 ${windowLabel(r.from, r.now)} \xB7 ${r.withSchedules} of ${r.scanned} repos have schedules${r.skippedArchived ? ` \xB7 ${r.skippedArchived} archived skipped` : ""} \xB7 times UTC`)}`
  );
  if (!r.repos.length) {
    lines.push("");
    lines.push("No scheduled workflows found in this org.");
    return lines.join("\n");
  }
  lines.push("");
  const nameW = Math.min(40, Math.max(16, ...r.repos.map((x) => x.repo.length)));
  for (const repo of r.repos) {
    if (repo.error && !repo.workflowCount) {
      lines.push(`  ${c("gray", "ERROR".padEnd(10))} ${repo.repo.padEnd(nameW)}  ${c("dim", repo.error)}`);
      continue;
    }
    const tone = TONE[repo.verdict] ?? "gray";
    const w = repo.worst;
    const stats = w ? `${w.missed ? `${w.missed} missed` : "0 missed"}${w.ran ? ` \xB7 median ${fmtDur(w.lagMedian)}` : ""}${repo.workflowCount > 1 ? ` \xB7 ${repo.workflowCount} workflows` : w ? ` \xB7 ${w.file}` : ""}` : "";
    lines.push(`  ${c(tone, c("bold", repo.verdict.padEnd(10)))} ${repo.repo.padEnd(nameW)}  ${stats}`);
    if (repo.workflowCount > 1) {
      for (const wf of repo.workflows.slice(0, 8)) {
        const wt = TONE[wf.verdict] ?? "gray";
        lines.push(
          `             ${c("dim", "\xB7")} ${c(wt, wf.verdict.padEnd(10))} ${wf.file.padEnd(22)} ${wf.missed ? c("magenta", `${wf.missed} missed`) : "0 missed"}${wf.ran ? ` \xB7 median ${fmtDur(wf.lagMedian)}` : ""}`
        );
      }
      if (repo.workflows.length > 8) lines.push(`             ${c("dim", `\xB7 \u2026 ${repo.workflows.length - 8} more`)}`);
    }
  }
  lines.push("");
  lines.push(c("dim", "worst first \xB7 org scan uses --lite (no mid-window cron-history lookup)"));
  return lines.join("\n");
}
function formatOrgMarkdown(r) {
  const out = [];
  out.push(`### cronlag \u2014 org/${r.org} \xB7 ${windowLabel(r.from, r.now)} \xB7 UTC`);
  out.push("");
  out.push(`${r.withSchedules} of ${r.scanned} repos have schedules${r.skippedArchived ? `; ${r.skippedArchived} archived skipped` : ""}.`);
  out.push("");
  if (!r.repos.length) {
    out.push("No scheduled workflows found.");
    return out.join("\n");
  }
  out.push("| Repo | Verdict | Workflows | Missed | Median lag | Worst workflow |");
  out.push("|---|---|---:|---:|---:|---|");
  for (const repo of r.repos) {
    if (repo.error && !repo.workflowCount) {
      out.push(`| [${repo.repo}](${repo.repoUrl}) | **ERROR** | \u2013 | \u2013 | \u2013 | ${repo.error.replace(/\|/g, "")} |`);
      continue;
    }
    const w = repo.worst;
    out.push(
      `| [${repo.repo}](${repo.repoUrl}) | **${repo.verdict}** | ${repo.workflowCount} | ${w?.missed ?? "\u2013"}${w?.overdue ? ` (+${w.overdue} overdue)` : ""} | ${fmtDur(w?.lagMedian ?? null)} | ${w ? `\`${w.file}\`` : "\u2013"} |`
    );
  }
  out.push("", `<sub>Worst first. Generated by [cronlag](https://github.com/Blackman99/cronlag) org scan.</sub>`);
  return out.join("\n");
}
var C, BARS, SEVERITY, TONE;
var init_format = __esm({
  "src/format.ts"() {
    "use strict";
    init_analyze();
    init_window();
    C = {
      reset: "\x1B[0m",
      dim: "\x1B[2m",
      bold: "\x1B[1m",
      green: "\x1B[32m",
      yellow: "\x1B[33m",
      red: "\x1B[31m",
      magenta: "\x1B[35m",
      cyan: "\x1B[36m",
      gray: "\x1B[90m"
    };
    BARS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];
    SEVERITY = { pending: 0, ontime: 1, late: 2, verylate: 3, overdue: 4, missed: 5 };
    TONE = { "ON TIME": "green", LATE: "yellow", DROPPING: "red", "NOT FIRING": "red", DISABLED: "red", INVALID: "red", "NO DATA": "gray", "NO SCHEDULES": "gray" };
  }
});

// src/github.ts
async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}
function toRun(x) {
  return {
    id: x.id,
    number: x.run_number,
    event: x.event,
    status: x.status,
    conclusion: x.conclusion ?? null,
    created: Date.parse(x.created_at),
    started: x.run_started_at ? Date.parse(x.run_started_at) : null,
    url: x.html_url
  };
}
var GitHubError, SETTLE_MS, DAY_MS, QUERY_CAP, GitHub;
var init_github = __esm({
  "src/github.ts"() {
    "use strict";
    GitHubError = class extends Error {
      constructor(message, status = 0) {
        super(message);
        this.status = status;
      }
    };
    SETTLE_MS = 6 * 36e5;
    DAY_MS = 864e5;
    QUERY_CAP = 1e3;
    GitHub = class {
      token;
      api;
      raw;
      f;
      ua;
      cache;
      calls = 0;
      runStats = { pages: 0, cachedDays: 0, days: 0, truncated: false };
      constructor(o = {}) {
        this.token = o.token || void 0;
        this.api = (o.apiBase ?? "https://api.github.com").replace(/\/$/, "");
        this.raw = (o.rawBase ?? "https://raw.githubusercontent.com").replace(/\/$/, "");
        this.f = o.fetch ?? fetch.bind(globalThis);
        this.ua = o.userAgent;
        this.cache = o.cache;
      }
      get cacheLocation() {
        return this.cache?.location;
      }
      get apiHost() {
        try {
          return new URL(this.api).host;
        } catch {
          return "api";
        }
      }
      get authenticated() {
        return !!this.token;
      }
      headers(accept = "application/vnd.github+json") {
        const h = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
        if (this.token) h.Authorization = `Bearer ${this.token}`;
        if (this.ua) h["User-Agent"] = this.ua;
        return h;
      }
      async request(path, init = {}) {
        this.calls++;
        const res = await this.f(path.startsWith("http") ? path : this.api + path, {
          method: init.method ?? "GET",
          headers: { ...this.headers(init.accept), ...init.body ? { "Content-Type": "application/json" } : {} },
          body: init.body ? JSON.stringify(init.body) : void 0
        });
        if (!res.ok) {
          let msg = "";
          try {
            msg = (await res.json()).message ?? "";
          } catch {
          }
          if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
            const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1e3;
            const when = reset ? ` (resets ${new Date(reset).toISOString().slice(11, 16)} UTC)` : "";
            throw new GitHubError(
              `GitHub API rate limit reached${when}. ${this.token ? "" : "Unauthenticated requests get 60/hour \u2014 set GITHUB_TOKEN or run `gh auth login`."}`.trim(),
              res.status
            );
          }
          if (res.status === 404) throw new GitHubError(`not found: ${path.replace(this.api, "")}${this.token ? "" : " (private repo? set GITHUB_TOKEN)"}`, 404);
          throw new GitHubError(`GitHub API ${res.status} on ${path.replace(this.api, "")}: ${msg}`, res.status);
        }
        return res;
      }
      async json(path) {
        return await (await this.request(path)).json();
      }
      async repo(full) {
        const r = await this.json(`/repos/${full}`);
        return {
          fullName: r.full_name,
          defaultBranch: r.default_branch,
          fork: !!r.fork,
          archived: !!r.archived,
          private: !!r.private,
          pushedAt: Date.parse(r.pushed_at),
          url: r.html_url
        };
      }
      async workflows(full) {
        const out = [];
        for (let page = 1; page <= 10; page++) {
          const r = await this.json(
            `/repos/${full}/actions/workflows?per_page=100&page=${page}`
          );
          for (const w of r.workflows) out.push({ id: w.id, name: w.name, path: w.path, state: w.state, url: w.html_url, created: w.created_at ? Date.parse(w.created_at) : null });
          if (out.length >= r.total_count || r.workflows.length < 100) break;
        }
        return out;
      }
      async file(full, path, ref) {
        if (!this.token) {
          this.calls++;
          const res2 = await this.f(`${this.raw}/${full}/${encodeURIComponent(ref)}/${path}`);
          if (res2.ok) return await res2.text();
        }
        const res = await this.request(`/repos/${full}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
          accept: "application/vnd.github.raw+json"
        });
        return await res.text();
      }
      async runs(full, workflowId, opts) {
        const out = [];
        const since = new Date(opts.since).toISOString().replace(/\.\d{3}Z$/, "Z");
        for (let page = 1; page <= (opts.maxPages ?? 5); page++) {
          const q = new URLSearchParams({ per_page: "100", page: String(page), created: `>=${since}`, exclude_pull_requests: "true" });
          if (opts.event) q.set("event", opts.event);
          const r = await this.json(
            `/repos/${full}/actions/workflows/${workflowId}/runs?${q}`
          );
          for (const x of r.workflow_runs) out.push(toRun(x));
          if (r.workflow_runs.length < 100) break;
        }
        return out.sort((a, b) => a.created - b.created);
      }
      /**
       * All runs of one event created in [since, now], however long the window.
       * The window is split into UTC days: settled days come from the cache when there is one,
       * the rest is fetched as few contiguous `created=` range queries as possible (one for a
       * fresh short window, same API cost as before), halved whenever a range exceeds the API's
       * 1000-result cap. Days that are settled and fully completed are written back to the cache.
       */
      async runsWindow(full, workflowId, opts) {
        const now = opts.now ?? Date.now();
        const first = Math.floor(opts.since / DAY_MS) * DAY_MS;
        const settled = (d) => d + DAY_MS <= now - SETTLE_MS;
        const key2 = (d) => `${this.apiHost}/${full.toLowerCase()}/${workflowId}/${opts.event}/${new Date(d).toISOString().slice(0, 10)}`;
        const out = [];
        const todo = [];
        for (let d = first; d < now; d += DAY_MS) {
          this.runStats.days++;
          if (this.cache && settled(d)) {
            const hit = await this.cache.get(key2(d)).catch(() => void 0);
            if (hit) {
              this.runStats.cachedDays++;
              out.push(...hit);
              continue;
            }
          }
          todo.push(d);
        }
        const ranges = [];
        for (const d of todo) {
          const last = ranges[ranges.length - 1];
          if (last && last[1] === d) last[1] = d + DAY_MS;
          else ranges.push([d, d + DAY_MS]);
        }
        for (const [a, b] of ranges) {
          const { runs, complete } = await this.runsRange(full, workflowId, opts.event, a, Math.min(b, now), b >= now);
          out.push(...runs);
          if (!this.cache) continue;
          for (let d = a; d < b; d += DAY_MS) {
            if (!settled(d) || !complete.has(d)) continue;
            const day = runs.filter((r) => r.created >= d && r.created < d + DAY_MS);
            if (day.some((r) => r.status !== "completed")) continue;
            await this.cache.set(key2(d), day).catch(() => void 0);
          }
        }
        const seen = /* @__PURE__ */ new Set();
        return out.filter((r) => r.created >= opts.since && r.created <= now && !seen.has(r.id) && (seen.add(r.id), true)).sort((x, y) => x.created - y.created);
      }
      /** Runs created in [a, b) (b open-ended when `open`), splitting at day boundaries past the result cap. */
      async runsRange(full, workflowId, event, a, b, open) {
        const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
        const created = open ? `>=${iso(a)}` : `${iso(a)}..${iso(b - 1e3)}`;
        const page = async (n) => {
          const q = new URLSearchParams({ per_page: "100", page: String(n), created, event, exclude_pull_requests: "true" });
          this.runStats.pages++;
          return this.json(`/repos/${full}/actions/workflows/${workflowId}/runs?${q}`);
        };
        const days = Math.max(1, Math.ceil((b - a) / DAY_MS));
        const split = async (parts) => {
          const bounds = [];
          for (let i = 0; i < parts; i++) bounds.push(a + Math.floor(days * i / parts) * DAY_MS);
          bounds.push(b);
          const pieces = await pool(
            bounds.slice(0, -1).map((lo, i) => () => this.runsRange(full, workflowId, event, lo, bounds[i + 1], open && i === parts - 1)),
            3
          );
          return { runs: pieces.flatMap((p) => p.runs), complete: new Set(pieces.flatMap((p) => [...p.complete])) };
        };
        const p1 = await page(1);
        const total = p1.total_count ?? p1.workflow_runs.length;
        if (total >= QUERY_CAP && days > 1) return split(Math.min(days, Math.ceil(total / 800)));
        const runs = p1.workflow_runs.map(toRun);
        const pages = Math.min(Math.ceil(total / 100), QUERY_CAP / 100);
        const rest = await pool(
          Array.from({ length: Math.max(0, pages - 1) }, (_, i) => () => page(i + 2)),
          4
        );
        for (const r of rest) runs.push(...r.workflow_runs.map(toRun));
        let last = rest.length ? rest[rest.length - 1].workflow_runs.length : p1.workflow_runs.length;
        for (let n = Math.max(pages, 1) + 1; last === 100 && n <= QUERY_CAP / 100; n++) {
          const r = await page(n);
          runs.push(...r.workflow_runs.map(toRun));
          last = r.workflow_runs.length;
        }
        const capped = total >= QUERY_CAP || runs.length >= QUERY_CAP;
        if (capped && days > 1) return split(2);
        const complete = /* @__PURE__ */ new Set();
        if (!capped) for (let d = a; d < b; d += DAY_MS) complete.add(d);
        else this.runStats.truncated = true;
        return { runs, complete };
      }
      async run(full, runId) {
        return toRun(await this.json(`/repos/${full}/actions/runs/${runId}`));
      }
      /** Most recent commits touching `path` on `ref`, newest first. */
      async fileHistory(full, path, ref, n = 20) {
        const r = await this.json(
          `/repos/${full}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=${n}`
        );
        return r.map((c) => ({ sha: c.sha, date: Date.parse(c.commit?.committer?.date ?? c.commit?.author?.date) })).filter((c) => Number.isFinite(c.date));
      }
      async dispatch(full, workflowId, ref) {
        await this.request(`/repos/${full}/actions/workflows/${workflowId}/dispatches`, { method: "POST", body: { ref } });
      }
      /** Paginated org repos. Includes private repos the token can see; skip archived by default. */
      async orgRepos(org, opts = {}) {
        const out = [];
        for (let page = 1; page <= 50; page++) {
          const r = await this.json(
            `/orgs/${encodeURIComponent(org)}/repos?per_page=100&page=${page}&type=all&sort=full_name`
          );
          for (const x of r) {
            const item = {
              fullName: x.full_name,
              name: x.name,
              private: !!x.private,
              fork: !!x.fork,
              archived: !!x.archived,
              defaultBranch: x.default_branch,
              url: x.html_url,
              pushedAt: Date.parse(x.pushed_at)
            };
            if (item.archived && !opts.includeArchived) continue;
            out.push(item);
          }
          if (r.length < 100) break;
        }
        return out;
      }
    };
  }
});

// src/catchup.ts
async function runCatchup(gh, repo, o = {}) {
  const snap = await collect(gh, repo, { days: 2, now: o.now, workflows: o.workflows, lite: true });
  const steps = planCatchup(snap, o.graceMs ?? 15 * MIN, o.thresholds ?? DEFAULTS);
  if (o.dispatch) {
    for (const s of steps) {
      if (s.action !== "dispatch") continue;
      try {
        await gh.dispatch(snap.repo.fullName, s.id, snap.repo.defaultBranch);
      } catch (e) {
        s.error = e.message;
      }
    }
  }
  return { repo: snap.repo.fullName, dispatched: !!o.dispatch, steps };
}
var init_catchup = __esm({
  "src/catchup.ts"() {
    "use strict";
    init_analyze();
    init_collect();
  }
});

// src/org.ts
function summarizeWorkflow(w) {
  const s = w.stats;
  return {
    file: w.file,
    name: w.name,
    verdict: w.verdict,
    headline: w.headline,
    lagMedian: s.lagMedian,
    lagP90: s.lagP90,
    lagMax: s.lagMax,
    missed: s.missed,
    overdue: s.overdue,
    due: s.due,
    ran: s.ran,
    within1h: s.within1h
  };
}
function sortOrgRepos(repos) {
  return [...repos].sort(
    (a, b) => (VERDICT_RANK[b.verdict] ?? 0) - (VERDICT_RANK[a.verdict] ?? 0) || (b.worst?.missed ?? 0) - (a.worst?.missed ?? 0) || (b.worst?.lagMedian ?? 0) - (a.worst?.lagMedian ?? 0) || a.repo.localeCompare(b.repo)
  );
}
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (; ; ) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
async function scanOrg(gh, org, o = {}) {
  const now = o.now ?? Date.now();
  const from = o.from ?? now - Math.min(MAX_WINDOW_DAYS, Math.max(1 / 24, o.days ?? 7)) * DAY;
  const days = Math.round((now - from) / DAY);
  const skipArchived = o.skipArchived !== false;
  const concurrency = o.concurrency ?? 2;
  o.onProgress?.(`listing repos for ${org}`);
  const all = await gh.orgRepos(org, { includeArchived: true });
  const skippedArchived = all.filter((r) => r.archived).length;
  const targets = skipArchived ? all.filter((r) => !r.archived) : all;
  const scanned = targets.length;
  const summaries = [];
  let errors = 0;
  await mapPool(targets, concurrency, async (repo, i) => {
    o.onProgress?.(`scanning ${i + 1}/${targets.length} ${repo.fullName}`);
    try {
      const snap = await collect(gh, repo.fullName, {
        from,
        now,
        workflows: o.workflows,
        lite: true
      });
      if (!snap.workflows.length) return;
      const report = analyze(snap, o.thresholds);
      const workflows = report.workflows.map(summarizeWorkflow);
      const worst = workflows[0];
      summaries.push({
        repo: report.repo,
        repoUrl: report.repoUrl,
        private: snap.repo.private,
        fork: snap.repo.fork,
        verdict: report.verdict,
        workflowCount: workflows.length,
        worst,
        workflows,
        report
      });
    } catch (e) {
      errors++;
      const msg = e instanceof GitHubError ? e.message : e instanceof Error ? e.message : String(e);
      if (e instanceof GitHubError && (e.status === 404 || e.status === 403)) {
        o.onProgress?.(`skip ${repo.fullName}: ${msg}`);
        return;
      }
      summaries.push({
        repo: repo.fullName,
        repoUrl: repo.url,
        private: repo.private,
        fork: repo.fork,
        verdict: "NO DATA",
        workflowCount: 0,
        workflows: [],
        error: msg
      });
    }
  });
  const repos = sortOrgRepos(summaries);
  return {
    org,
    from: new Date(from).toISOString(),
    now: new Date(now).toISOString(),
    days,
    scanned,
    withSchedules: repos.filter((r) => r.workflowCount > 0).length,
    skippedArchived,
    errors,
    repos
  };
}
function exitForOrg(r, failOn) {
  if (failOn === "never") return 0;
  const bad = failOn === "late" ? ["LATE", "DROPPING", "NOT FIRING", "DISABLED", "INVALID"] : ["DROPPING", "NOT FIRING", "DISABLED", "INVALID"];
  return r.repos.some((repo) => bad.includes(repo.verdict)) ? 1 : 0;
}
var init_org = __esm({
  "src/org.ts"() {
    "use strict";
    init_analyze();
    init_collect();
    init_window();
    init_github();
  }
});

// src/version.ts
var VERSION;
var init_version = __esm({
  "src/version.ts"() {
    "use strict";
    VERSION = "0.2.0";
  }
});

// src/mcp.ts
import { createInterface } from "node:readline";
async function callTool(name, args, gh) {
  if (name === "cron_explain") {
    try {
      const c = parseCron(String(args.cron ?? ""), args.timezone ? String(args.timezone) : "UTC");
      const n = Math.min(50, Math.max(1, Number(args.count ?? 5)));
      const fires = nextFires(c, Date.now(), n).map((t) => new Date(t).toISOString());
      const gap = minInterval(c, Date.now());
      return {
        text: JSON.stringify({ cron: c.source, timezone: c.timezone, next: fires, shortestInterval: fmtDur(gap), minuteZero: c.minutes.includes(0), belowGitHubMinimum: gap !== null && gap < 5 * 6e4 }, null, 2)
      };
    } catch (e) {
      if (e instanceof CronError) return { text: `invalid cron: ${e.message}`, isError: true };
      throw e;
    }
  }
  const repo = String(args.repo ?? "").replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { text: "repo must be owner/repo", isError: true };
  if (name === "schedule_report") {
    let from;
    try {
      from = resolveWindow({ days: args.days ?? void 0, since: args.since ? String(args.since) : void 0 }).from;
    } catch (e) {
      if (e instanceof WindowError) return { text: e.message.replace(/--(days|since)/g, "$1"), isError: true };
      throw e;
    }
    const snap = await collect(gh(), repo, { from, workflows: args.workflow ? [String(args.workflow)] : void 0 });
    const r = analyze(snap);
    const compact = {
      repo: r.repo,
      window: { from: r.from, to: r.now },
      workflows: r.workflows.map((w) => ({
        file: w.file,
        name: w.name,
        crons: w.crons,
        verdict: w.verdict,
        headline: w.headline,
        stats: { ...w.stats, lagMedian: fmtDur(w.stats.lagMedian), lagP90: fmtDur(w.stats.lagP90), lagMax: fmtDur(w.stats.lagMax), lagMin: fmtDur(w.stats.lagMin) },
        findings: w.findings,
        recentSlots: w.slots.slice(-12).map((s) => ({ slot: new Date(s.at).toISOString(), status: s.status, lag: fmtDur(s.lagMs), run: s.run?.url }))
      })),
      unscheduled: r.unscheduled
    };
    return { text: formatMarkdown(r) + "\n\n```json\n" + JSON.stringify(compact, null, 2) + "\n```" };
  }
  if (name === "catchup_plan") {
    const grace = Math.max(1, Number(args.grace_minutes ?? 15)) * 6e4;
    const snap = await collect(gh(), repo, { days: 2, lite: true });
    void DAY;
    return { text: JSON.stringify({ repo: snap.repo.fullName, note: "read-only plan; run `cronlag catchup <repo> --dispatch` yourself to act on it", steps: planCatchup(snap, grace) }, null, 2) };
  }
  return { text: `unknown tool ${name}`, isError: true };
}
async function runMcp(gh) {
  const rl = createInterface({ input: process.stdin });
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  let client = null;
  const lazy = () => client ??= gh();
  const pending = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }
    const { id, method, params } = msg;
    if (id === void 0 || id === null) continue;
    const reply = (result) => send({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
    if (method === "initialize") {
      reply({
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cronlag", version: VERSION },
        instructions: "Use schedule_report to check whether a repo's scheduled GitHub Actions workflows ran on time, catchup_plan to see which due slots have no run, cron_explain for cron math."
      });
    } else if (method === "ping") reply({});
    else if (method === "tools/list") reply({ tools: TOOLS });
    else if (method === "tools/call") {
      pending.push(
        callTool(params?.name, params?.arguments ?? {}, lazy).then(
          (r) => reply({ content: [{ type: "text", text: r.text }], isError: !!r.isError }),
          (e) => reply({ content: [{ type: "text", text: `error: ${e.message}` }], isError: true })
        )
      );
    } else fail(-32601, `method not found: ${method}`);
  }
  await Promise.all(pending);
}
var TOOLS;
var init_mcp = __esm({
  "src/mcp.ts"() {
    "use strict";
    init_analyze();
    init_collect();
    init_cron();
    init_format();
    init_version();
    init_window();
    TOOLS = [
      {
        name: "schedule_report",
        description: "Slot-by-slot report for a GitHub repo's scheduled (cron) workflows: which cron slots got a run, how late each run was created, which slots never ran, and likely causes (disabled after 60 days, schedule not registered, minute 0, no workflow_dispatch, runner queueing vs. GitHub scheduler delay). Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/repo" },
            days: { type: "number", description: "window in days (default 7, max 400)" },
            since: { type: "string", description: "window start instead of days: UTC date '2026-09-01', date-time '2026-09-01T06:00Z', or relative '36h' / '30d' / '6w'" },
            workflow: { type: "string", description: "optional: only this workflow (file name, path, name or id)" }
          },
          required: ["repo"]
        },
        annotations: { readOnlyHint: true, openWorldHint: true }
      },
      {
        name: "catchup_plan",
        description: "For each scheduled workflow, say whether its latest due cron slot (older than the grace period) still has no run, i.e. what `cronlag catchup --dispatch` would dispatch. Read-only: it never dispatches.",
        inputSchema: {
          type: "object",
          properties: {
            repo: { type: "string", description: "owner/repo" },
            grace_minutes: { type: "number", description: "how long after a slot to wait before calling it missed (default 15)" }
          },
          required: ["repo"]
        },
        annotations: { readOnlyHint: true, openWorldHint: true }
      },
      {
        name: "cron_explain",
        description: "Next fire times (UTC) of a GitHub Actions cron expression, its shortest interval, and whether it uses the busy minute 0. Pure computation, no network.",
        inputSchema: {
          type: "object",
          properties: {
            cron: { type: "string", description: "five-field cron, e.g. '17 */6 * * *'" },
            timezone: { type: "string", description: "IANA timezone (default UTC), as in on.schedule[].timezone" },
            count: { type: "number", description: "how many fire times (default 5, max 50)" }
          },
          required: ["cron"]
        },
        annotations: { readOnlyHint: true, openWorldHint: false }
      }
    ];
  }
});

// src/token.ts
import { execFileSync } from "node:child_process";
function findToken(explicit) {
  if (explicit) return explicit;
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  try {
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5e3 }).trim();
    return t || void 0;
  } catch {
    return void 0;
  }
}
function repoFromGit(cwd = process.cwd()) {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?\/?$/);
    return m?.[1];
  } catch {
    return void 0;
  }
}
var init_token = __esm({
  "src/token.ts"() {
    "use strict";
  }
});

// src/cache.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
function defaultCacheDir(env = process.env, platform = process.platform) {
  if (env.CRONLAG_CACHE_DIR) return env.CRONLAG_CACHE_DIR;
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, "cronlag");
  const home = homedir();
  if (platform === "darwin") return join(home, "Library", "Caches", "cronlag");
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "cronlag", "Cache");
  return join(home, ".cache", "cronlag");
}
function tildify(p) {
  const home = homedir();
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}
var SCHEMA, safe, DiskRunCache;
var init_cache = __esm({
  "src/cache.ts"() {
    "use strict";
    SCHEMA = 1;
    safe = (part) => part.replace(/[^\w.@-]+/g, "_");
    DiskRunCache = class {
      constructor(dir = defaultCacheDir()) {
        this.dir = dir;
        this.location = tildify(dir);
      }
      location;
      path(key2) {
        return join(this.dir, "runs", `v${SCHEMA}`, ...key2.split("/").map(safe)) + ".json";
      }
      async get(key2) {
        try {
          const data = JSON.parse(await readFile(this.path(key2), "utf8"));
          if (data?.v !== SCHEMA || !Array.isArray(data.runs)) return void 0;
          return data.runs;
        } catch {
          return void 0;
        }
      }
      async set(key2, runs) {
        const file = this.path(key2);
        try {
          await mkdir(join(file, ".."), { recursive: true, mode: 448 });
          const tmp = `${file}.${process.pid}.tmp`;
          await writeFile(tmp, JSON.stringify({ v: SCHEMA, key: key2, runs }), { mode: 384 });
          await rename(tmp, file);
        } catch {
        }
      }
    };
  }
});

// src/worker/engine.generated.ts
var ENGINE;
var init_engine_generated = __esm({
  "src/worker/engine.generated.ts"() {
    "use strict";
    ENGINE = 'var cronlag=(()=>{var Kt=Object.defineProperty;var vn=Object.getOwnPropertyDescriptor;var In=Object.getOwnPropertyNames;var En=Object.prototype.hasOwnProperty;var Cn=(n,e)=>{for(var t in e)Kt(n,t,{get:e[t],enumerable:!0})},Mn=(n,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let i of In(e))!En.call(n,i)&&i!==t&&Kt(n,i,{get:()=>e[i],enumerable:!(s=vn(e,i))||s.enumerable});return n};var Ln=n=>Mn(Kt({},"__esModule",{value:!0}),n);var wi={};Cn(wi,{GitHub:()=>Ut,VERSION:()=>Tn,formatCatchup:()=>On,runCatchup:()=>$n});var B=class extends Error{},_n=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"],Dn=["SUN","MON","TUE","WED","THU","FRI","SAT"];function xe(n,e,t,s,i=0){let r=new Set;for(let o of n.split(",")){if(o==="")throw new B(`empty list item in "${n}"`);let[a,l]=o.split("/");if(o.split("/").length>2)throw new B(`bad step in "${o}"`);let c=1;if(l!==void 0){if(!/^\\d+$/.test(l)||Number(l)===0)throw new B(`bad step "${l}"`);c=Number(l)}let d,u,f=p=>{let g=p.toUpperCase();if(s){let h=s.indexOf(g);if(h>=0)return h+i}if(!/^\\d+$/.test(p))throw new B(`"${p}" is not a number`);return Number(p)};if(a==="*"||a==="?")d=e,u=t;else if(a.includes("-")){let[p,g,...h]=a.split("-");if(h.length)throw new B(`bad range "${a}"`);if(d=f(p),u=f(g),u<d)throw new B(`range "${a}" runs backwards`)}else d=f(a),u=l!==void 0?t:d;if(d<e||u>t)throw new B(`"${o}" is outside ${e}-${t}`);for(let p=d;p<=u;p+=c)r.add(p)}return[...r].sort((o,a)=>o-a)}function Os(n,e="UTC"){let t=n.trim().split(/\\s+/);if(t[0]?.startsWith("@"))throw new B(`GitHub Actions does not support "${t[0]}"`);if(t.length!==5)throw new B(`expected 5 fields, got ${t.length}`);if(!xn(e))throw new B(`unknown timezone "${e}"`);let[s,i,r,o,a]=t,l=new Set(xe(a,0,7,Dn).map(c=>c===7?0:c));return{source:n.trim(),timezone:e,minutes:xe(s,0,59),hours:xe(i,0,23),days:new Set(xe(r,1,31)),months:new Set(xe(o,1,12,_n,1)),weekdays:l,domStar:r==="*"||r==="?"||r==="*/1",dowStar:a==="*"||a==="?"||a==="*/1"}}var As=new Map;function Ts(n){let e=As.get(n);return e||(e=new Intl.DateTimeFormat("en-US",{timeZone:n,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric",second:"numeric"}),As.set(n,e)),e}function xn(n){try{return Ts(n),!0}catch{return!1}}function be(n,e){if(e==="UTC"||e==="Etc/UTC")return 0;let t={};for(let i of Ts(e).formatToParts(new Date(n)))i.type!=="literal"&&(t[i.type]=Number(i.value));return Date.UTC(t.year,t.month-1,t.day,t.hour,t.minute,t.second)-Math.floor(n/1e3)*1e3}function Rn(n,e,t,s,i,r){let o=Date.UTC(n,e,t,s,i);if(r==="UTC"||r==="Etc/UTC")return o;let a=be(o-432e5,r),c=[...new Set([a,be(o,r),be(o+432e5,r)])].map(f=>o-f).sort((f,p)=>f-p);for(let f of c)if(f+be(f,r)===o)return f;let d=o-a-3*36e5,u=o-a;for(;u-d>6e4;){let f=Math.floor((d+u)/12e4)*6e4;be(f,r)===a?d=f:u=f}return u}function Pn(n,e){if(!n.months.has(e.mo+1))return!1;let t=new Date(Date.UTC(e.y,e.mo,e.d)).getUTCDay(),s=n.days.has(e.d),i=n.weekdays.has(t);return n.domStar||n.dowStar?s&&i:s||i}function qt(n,e,t,s=2e5){let i=[],r=e+be(e,n.timezone)-864e5,o=t+be(t,n.timezone)+864e5,a=new Set;for(let l=Math.floor(r/864e5)*864e5;l<=o;l+=864e5){let c=new Date(l),d={y:c.getUTCFullYear(),mo:c.getUTCMonth(),d:c.getUTCDate()};if(Pn(n,d))for(let u of n.hours)for(let f of n.minutes){let p=Rn(d.y,d.mo,d.d,u,f,n.timezone);if(!(p<e||p>=t||a.has(p))&&(a.add(p),i.push(p),i.length>=s))return i.sort((g,h)=>g-h)}}return i.sort((l,c)=>l-c)}function vs(n,e,t=864e5*40){for(let s=36e5*2;s<=t*2;s*=4){let i=qt(n,e-s,e+1);if(i.length)return i[i.length-1]}return null}var fe=6e4,Vt=60*fe,we=24*Vt,Wt={onTimeMs:10*fe,lateMs:Vt,maxLagMs:we,earlyMs:2*fe};function Ft(n){if(n==null||!Number.isFinite(n))return"\\u2013";let e=n<0,t=Math.round(Math.abs(n)/fe),s;return t<60?s=`${t}m`:t<2880?s=`${Math.floor(t/60)}h${String(t%60).padStart(2,"0")}`:s=`${Math.floor(t/1440)}d${String(Math.floor(t%1440/60)).padStart(2,"0")}h`,Math.abs(n)<fe&&n!==0&&(s=`${Math.round(Math.abs(n)/1e3)}s`),e?`-${s}`:s}function Bn(n,e,t){let s=[...n].sort((a,l)=>a.at-l.at),i=new Map,r=[],o=[...e].sort((a,l)=>a.created-l.created);for(let a of o){let l=0,c=s.length-1,d=-1;for(;l<=c;){let f=l+c>>1;s[f].at<=a.created+t.earlyMs?(d=f,l=f+1):c=f-1}let u=!1;for(let f=d;f>=0&&!(a.created-s[f].at>t.maxLagMs);f--)if(!i.has(f)){i.set(f,a),u=!0;break}u||r.push(a)}return{slots:s,claimed:i,extra:r}}function Is(n,e=15*fe,t=Wt){let s=[];for(let i of n.workflows){let r=i.path.split("/").pop()??i.path,o={workflow:i.name,file:r,id:i.id},a=i.schedules.filter(h=>h.parsed);if(!a.length)continue;if(i.state!=="active"){s.push({...o,action:"skip",reason:`workflow is ${i.state}`});continue}let l=null;for(let h of a){let m=vs(h.parsed,n.now-e);m!==null&&(!l||m>l.at)&&(l={at:m,cron:h.cron})}if(!l||n.now-l.at>t.maxLagMs){s.push({...o,action:"skip",reason:"no slot due in the last 24h"});continue}let c=new Date(l.at).toISOString().slice(0,16).replace("T"," ")+" UTC",d=i.dispatchRuns.find(h=>h.created>=l.at-t.earlyMs);if(d){s.push({...o,action:"covered",slot:c,reason:`workflow_dispatch run #${d.number} already created after the slot`});continue}let u=[];for(let h of a)for(let m of qt(h.parsed,l.at-t.maxLagMs,l.at+1))u.push({at:m,cron:h.cron});let{slots:f,claimed:p}=Bn(u,i.scheduleRuns,t),g=f.findIndex(h=>h.at===l.at);if(g>=0&&p.has(g)){let h=p.get(g);s.push({...o,action:"covered",slot:c,reason:`scheduled run #${h.number} created ${Ft(h.created-l.at)} after the slot`});continue}if(!i.hasDispatch){s.push({...o,action:"skip",slot:c,reason:"slot has no run, but the workflow has no workflow_dispatch trigger"});continue}s.push({...o,action:"dispatch",slot:c,reason:`${new Date(l.at).toISOString().slice(11,16)} UTC slot (${l.cron}) has no run after ${Ft(n.now-l.at)}`})}return s}var it=Symbol.for("yaml.alias"),rt=Symbol.for("yaml.document"),q=Symbol.for("yaml.map"),Yt=Symbol.for("yaml.pair"),U=Symbol.for("yaml.scalar"),re=Symbol.for("yaml.seq"),P=Symbol.for("yaml.node.type"),F=n=>!!n&&typeof n=="object"&&n[P]===it,z=n=>!!n&&typeof n=="object"&&n[P]===rt,V=n=>!!n&&typeof n=="object"&&n[P]===q,v=n=>!!n&&typeof n=="object"&&n[P]===Yt,T=n=>!!n&&typeof n=="object"&&n[P]===U,W=n=>!!n&&typeof n=="object"&&n[P]===re;function E(n){if(n&&typeof n=="object")switch(n[P]){case q:case re:return!0}return!1}function I(n){if(n&&typeof n=="object")switch(n[P]){case it:case q:case U:case re:return!0}return!1}var ot=n=>(T(n)||E(n))&&!!n.anchor;var j=Symbol("break visit"),Es=Symbol("skip children"),Z=Symbol("remove node");function ee(n,e){let t=Cs(e);z(n)?Ae(null,n.contents,t,Object.freeze([n]))===Z&&(n.contents=null):Ae(null,n,t,Object.freeze([]))}ee.BREAK=j;ee.SKIP=Es;ee.REMOVE=Z;function Ae(n,e,t,s){let i=Ms(n,e,t,s);if(I(i)||v(i))return Ls(n,s,i),Ae(n,i,t,s);if(typeof i!="symbol"){if(E(e)){s=Object.freeze(s.concat(e));for(let r=0;r<e.items.length;++r){let o=Ae(r,e.items[r],t,s);if(typeof o=="number")r=o-1;else{if(o===j)return j;o===Z&&(e.items.splice(r,1),r-=1)}}}else if(v(e)){s=Object.freeze(s.concat(e));let r=Ae("key",e.key,t,s);if(r===j)return j;r===Z&&(e.key=null);let o=Ae("value",e.value,t,s);if(o===j)return j;o===Z&&(e.value=null)}}return i}async function at(n,e){let t=Cs(e);z(n)?await Oe(null,n.contents,t,Object.freeze([n]))===Z&&(n.contents=null):await Oe(null,n,t,Object.freeze([]))}at.BREAK=j;at.SKIP=Es;at.REMOVE=Z;async function Oe(n,e,t,s){let i=await Ms(n,e,t,s);if(I(i)||v(i))return Ls(n,s,i),Oe(n,i,t,s);if(typeof i!="symbol"){if(E(e)){s=Object.freeze(s.concat(e));for(let r=0;r<e.items.length;++r){let o=await Oe(r,e.items[r],t,s);if(typeof o=="number")r=o-1;else{if(o===j)return j;o===Z&&(e.items.splice(r,1),r-=1)}}}else if(v(e)){s=Object.freeze(s.concat(e));let r=await Oe("key",e.key,t,s);if(r===j)return j;r===Z&&(e.key=null);let o=await Oe("value",e.value,t,s);if(o===j)return j;o===Z&&(e.value=null)}}return i}function Cs(n){return typeof n=="object"&&(n.Collection||n.Node||n.Value)?Object.assign({Alias:n.Node,Map:n.Node,Scalar:n.Node,Seq:n.Node},n.Value&&{Map:n.Value,Scalar:n.Value,Seq:n.Value},n.Collection&&{Map:n.Collection,Seq:n.Collection},n):n}function Ms(n,e,t,s){if(typeof t=="function")return t(n,e,s);if(V(e))return t.Map?.(n,e,s);if(W(e))return t.Seq?.(n,e,s);if(v(e))return t.Pair?.(n,e,s);if(T(e))return t.Scalar?.(n,e,s);if(F(e))return t.Alias?.(n,e,s)}function Ls(n,e,t){let s=e[e.length-1];if(E(s))s.items[n]=t;else if(v(s))n==="key"?s.key=t:s.value=t;else if(z(s))s.contents=t;else{let i=F(s)?"alias":"scalar";throw new Error(`Cannot replace node with ${i} parent`)}}var jn={"!":"%21",",":"%2C","[":"%5B","]":"%5D","{":"%7B","}":"%7D"},Un=n=>n.replace(/[!,[\\]{}]/g,e=>jn[e]),te=class n{constructor(e,t){this.docStart=null,this.docEnd=!1,this.yaml=Object.assign({},n.defaultYaml,e),this.tags=Object.assign({},n.defaultTags,t)}clone(){let e=new n(this.yaml,this.tags);return e.docStart=this.docStart,e}atDocument(){let e=new n(this.yaml,this.tags);switch(this.yaml.version){case"1.1":this.atNextDocument=!0;break;case"1.2":this.atNextDocument=!1,this.yaml={explicit:n.defaultYaml.explicit,version:"1.2"},this.tags=Object.assign({},n.defaultTags);break}return e}add(e,t){this.atNextDocument&&(this.yaml={explicit:n.defaultYaml.explicit,version:"1.1"},this.tags=Object.assign({},n.defaultTags),this.atNextDocument=!1);let s=e.trim().split(/[ \\t]+/),i=s.shift();switch(i){case"%TAG":{if(s.length!==2&&(t(0,"%TAG directive should contain exactly two parts"),s.length<2))return!1;let[r,o]=s;return this.tags[r]=o,!0}case"%YAML":{if(this.yaml.explicit=!0,s.length!==1)return t(0,"%YAML directive should contain exactly one part"),!1;let[r]=s;if(r==="1.1"||r==="1.2")return this.yaml.version=r,!0;{let o=/^\\d+\\.\\d+$/.test(r);return t(6,`Unsupported YAML version ${r}`,o),!1}}default:return t(0,`Unknown directive ${i}`,!0),!1}}tagName(e,t){if(e==="!")return"!";if(e[0]!=="!")return t(`Not a valid tag: ${e}`),null;if(e[1]==="<"){let o=e.slice(2,-1);return o==="!"||o==="!!"?(t(`Verbatim tags aren\'t resolved, so ${e} is invalid.`),null):(e[e.length-1]!==">"&&t("Verbatim tags must end with a >"),o)}let[,s,i]=e.match(/^(.*!)([^!]*)$/s);i||t(`The ${e} tag has no suffix`);let r=this.tags[s];if(r)try{return r+decodeURIComponent(i)}catch(o){return t(String(o)),null}return s==="!"?e:(t(`Could not resolve tag: ${e}`),null)}tagString(e){for(let[t,s]of Object.entries(this.tags))if(e.startsWith(s))return t+Un(e.substring(s.length));return e[0]==="!"?e:`!<${e}>`}toString(e){let t=this.yaml.explicit?[`%YAML ${this.yaml.version||"1.2"}`]:[],s=Object.entries(this.tags),i;if(e&&s.length>0&&I(e.contents)){let r={};ee(e.contents,(o,a)=>{I(a)&&a.tag&&(r[a.tag]=!0)}),i=Object.keys(r)}else i=[];for(let[r,o]of s)r==="!!"&&o==="tag:yaml.org,2002:"||(!e||i.some(a=>a.startsWith(o)))&&t.push(`%TAG ${r} ${o}`);return t.join(`\n`)}};te.defaultYaml={explicit:!1,version:"1.2"};te.defaultTags={"!!":"tag:yaml.org,2002:"};function lt(n){if(/[\\x00-\\x19\\s,[\\]{}]/.test(n)){let t=`Anchor must not contain whitespace or control characters: ${JSON.stringify(n)}`;throw new Error(t)}return!0}function Gt(n){let e=new Set;return ee(n,{Value(t,s){s.anchor&&e.add(s.anchor)}}),e}function Ht(n,e){for(let t=1;;++t){let s=`${n}${t}`;if(!e.has(s))return s}}function _s(n,e){let t=[],s=new Map,i=null;return{onAnchor:r=>{t.push(r),i??(i=Gt(n));let o=Ht(e,i);return i.add(o),o},setAnchors:()=>{for(let r of t){let o=s.get(r);if(typeof o=="object"&&o.anchor&&(T(o.node)||E(o.node)))o.node.anchor=o.anchor;else{let a=new Error("Failed to resolve repeated object (this should not happen)");throw a.source=r,a}}},sourceObjects:s}}function ue(n,e,t,s){if(s&&typeof s=="object")if(Array.isArray(s))for(let i=0,r=s.length;i<r;++i){let o=s[i],a=ue(n,s,String(i),o);a===void 0?delete s[i]:a!==o&&(s[i]=a)}else if(s instanceof Map)for(let i of Array.from(s.keys())){let r=s.get(i),o=ue(n,s,i,r);o===void 0?s.delete(i):o!==r&&s.set(i,o)}else if(s instanceof Set)for(let i of Array.from(s)){let r=ue(n,s,i,i);r===void 0?s.delete(i):r!==i&&(s.delete(i),s.add(r))}else for(let[i,r]of Object.entries(s)){let o=ue(n,s,i,r);o===void 0?delete s[i]:o!==r&&(s[i]=o)}return n.call(e,t,s)}function D(n,e,t){if(Array.isArray(n))return n.map((s,i)=>D(s,String(i),t));if(n&&typeof n.toJSON=="function"){if(!t||!ot(n))return n.toJSON(e,t);let s={aliasCount:0,count:1,res:void 0};t.anchors.set(n,s),t.onCreate=r=>{s.res=r,delete t.onCreate};let i=n.toJSON(e,t);return t.onCreate&&t.onCreate(i),i}return typeof n=="bigint"&&!t?.keep?Number(n):n}var he=class{constructor(e){Object.defineProperty(this,P,{value:e})}clone(){let e=Object.create(Object.getPrototypeOf(this),Object.getOwnPropertyDescriptors(this));return this.range&&(e.range=this.range.slice()),e}toJS(e,{mapAsMap:t,maxAliasCount:s,onAnchor:i,reviver:r}={}){if(!z(e))throw new TypeError("A document argument is required");let o={anchors:new Map,doc:e,keep:!0,mapAsMap:t===!0,mapKeyWarned:!1,maxAliasCount:typeof s=="number"?s:100},a=D(this,"",o);if(typeof i=="function")for(let{count:l,res:c}of o.anchors.values())i(c,l);return typeof r=="function"?ue(r,{"":a},"",a):a}};var oe=class extends he{constructor(e){super(it),this.source=e,Object.defineProperty(this,"tag",{set(){throw new Error("Alias nodes cannot have tags")}})}resolve(e,t){if(t?.maxAliasCount===0)throw new ReferenceError("Alias resolution is disabled");let s;t?.aliasResolveCache?s=t.aliasResolveCache:(s=[],ee(e,{Node:(r,o)=>{(F(o)||ot(o))&&s.push(o)}}),t&&(t.aliasResolveCache=s));let i;for(let r of s){if(r===this)break;r.anchor===this.source&&(i=r)}if(i&&t){let{anchors:r,doc:o,maxAliasCount:a}=t,l=r.get(i);if(l||(D(i,null,t),l=r.get(i)),l?.res===void 0){let c="This should not happen: Alias anchor was not resolved?";throw new ReferenceError(c)}if(a>=0&&(l.count+=1,l.aliasCount===0&&(l.aliasCount=ct(o,i,r)),l.count*l.aliasCount>a)){let c="Excessive alias count indicates a resource exhaustion attack";throw new ReferenceError(c)}}return i}toJSON(e,t){if(!t)return{source:this.source};let s=this.resolve(t.doc,t);if(!s){let i=`Unresolved alias (the anchor must be set before the alias): ${this.source}`;throw new ReferenceError(i)}return t.anchors.get(s).res}toString(e,t,s){let i=`*${this.source}`;if(e){if(lt(this.source),e.options.verifyAliasOrder&&!e.anchors.has(this.source)){let r=`Unresolved alias (the anchor must be set before the alias): ${this.source}`;throw new Error(r)}if(e.implicitKey)return`${i} `}return i}};function ct(n,e,t){if(F(e)){let s=e.resolve(n),i=t&&s&&t.get(s);return i?i.count*i.aliasCount:0}else if(E(e)){let s=0;for(let i of e.items){let r=ct(n,i,t);r>s&&(s=r)}return s}else if(v(e)){let s=ct(n,e.key,t),i=ct(n,e.value,t);return Math.max(s,i)}return 1}var ft=n=>!n||typeof n!="function"&&typeof n!="object",k=class extends he{constructor(e){super(U),this.value=e}toJSON(e,t){return t?.keep?this.value:D(this.value,e,t)}toString(){return String(this.value)}};k.BLOCK_FOLDED="BLOCK_FOLDED";k.BLOCK_LITERAL="BLOCK_LITERAL";k.PLAIN="PLAIN";k.QUOTE_DOUBLE="QUOTE_DOUBLE";k.QUOTE_SINGLE="QUOTE_SINGLE";var Kn="tag:yaml.org,2002:";function qn(n,e,t){if(e){let s=t.filter(r=>r.tag===e),i=s.find(r=>!r.format)??s[0];if(!i)throw new Error(`Tag ${e} not found`);return i}return t.find(s=>s.identify?.(n)&&!s.format)}function ae(n,e,t){if(z(n)&&(n=n.contents),I(n))return n;if(v(n)){let u=t.schema[q].createNode?.(t.schema,null,t);return u.items.push(n),u}(n instanceof String||n instanceof Number||n instanceof Boolean||typeof BigInt<"u"&&n instanceof BigInt)&&(n=n.valueOf());let{aliasDuplicateObjects:s,onAnchor:i,onTagObj:r,schema:o,sourceObjects:a}=t,l;if(s&&n&&typeof n=="object"){if(l=a.get(n),l)return l.anchor??(l.anchor=i(n)),new oe(l.anchor);l={anchor:null,node:null},a.set(n,l)}e?.startsWith("!!")&&(e=Kn+e.slice(2));let c=qn(n,e,o.tags);if(!c){if(n&&typeof n.toJSON=="function"&&(n=n.toJSON()),!n||typeof n!="object"){let u=new k(n);return l&&(l.node=u),u}c=n instanceof Map?o[q]:Symbol.iterator in Object(n)?o[re]:o[q]}r&&(r(c),delete t.onTagObj);let d=c?.createNode?c.createNode(t.schema,n,t):typeof c?.nodeClass?.from=="function"?c.nodeClass.from(t.schema,n,t):new k(n);return e?d.tag=e:c.default||(d.tag=c.tag),l&&(l.node=d),d}function Re(n,e,t){let s=t;for(let i=e.length-1;i>=0;--i){let r=e[i];if(typeof r=="number"&&Number.isInteger(r)&&r>=0){let o=[];o[r]=s,s=o}else s=new Map([[r,s]])}return ae(s,void 0,{aliasDuplicateObjects:!1,keepUndefined:!1,onAnchor:()=>{throw new Error("This should not happen, please report a bug.")},schema:n,sourceObjects:new Map})}var ve=n=>n==null||typeof n=="object"&&!!n[Symbol.iterator]().next().done,Te=class extends he{constructor(e,t){super(e),Object.defineProperty(this,"schema",{value:t,configurable:!0,enumerable:!1,writable:!0})}clone(e){let t=Object.create(Object.getPrototypeOf(this),Object.getOwnPropertyDescriptors(this));return e&&(t.schema=e),t.items=t.items.map(s=>I(s)||v(s)?s.clone(e):s),this.range&&(t.range=this.range.slice()),t}addIn(e,t){if(ve(e))this.add(t);else{let[s,...i]=e,r=this.get(s,!0);if(E(r))r.addIn(i,t);else if(r===void 0&&this.schema)this.set(s,Re(this.schema,i,t));else throw new Error(`Expected YAML collection at ${s}. Remaining path: ${i}`)}}deleteIn(e){let[t,...s]=e;if(s.length===0)return this.delete(t);let i=this.get(t,!0);if(E(i))return i.deleteIn(s);throw new Error(`Expected YAML collection at ${t}. Remaining path: ${s}`)}getIn(e,t){let[s,...i]=e,r=this.get(s,!0);return i.length===0?!t&&T(r)?r.value:r:E(r)?r.getIn(i,t):void 0}hasAllNullValues(e){return this.items.every(t=>{if(!v(t))return!1;let s=t.value;return s==null||e&&T(s)&&s.value==null&&!s.commentBefore&&!s.comment&&!s.tag})}hasIn(e){let[t,...s]=e;if(s.length===0)return this.has(t);let i=this.get(t,!0);return E(i)?i.hasIn(s):!1}setIn(e,t){let[s,...i]=e;if(i.length===0)this.set(s,t);else{let r=this.get(s,!0);if(E(r))r.setIn(i,t);else if(r===void 0&&this.schema)this.set(s,Re(this.schema,i,t));else throw new Error(`Expected YAML collection at ${s}. Remaining path: ${i}`)}}};var Ds=n=>n.replace(/^(?!$)(?: $)?/gm,"#");function K(n,e){return/^\\n+$/.test(n)?n.substring(1):e?n.replace(/^(?! *$)/gm,e):n}var se=(n,e,t)=>n.endsWith(`\n`)?K(t,e):t.includes(`\n`)?`\n`+K(t,e):(n.endsWith(" ")?"":" ")+t;var Jt="flow",ut="block",Pe="quoted";function Be(n,e,t="flow",{indentAtStart:s,lineWidth:i=80,minContentWidth:r=20,onFold:o,onOverflow:a}={}){if(!i||i<0)return n;i<r&&(r=0);let l=Math.max(1+r,1+i-e.length);if(n.length<=l)return n;let c=[],d={},u=i-e.length;typeof s=="number"&&(s>i-Math.max(2,r)?c.push(0):u=i-s);let f,p,g=!1,h=-1,m=-1,w=-1;t===ut&&(h=xs(n,h,e.length),h!==-1&&(u=h+l));for(let N;N=n[h+=1];){if(t===Pe&&N==="\\\\"){switch(m=h,n[h+1]){case"x":h+=3;break;case"u":h+=5;break;case"U":h+=9;break;default:h+=1}w=h}if(N===`\n`)t===ut&&(h=xs(n,h,e.length)),u=h+e.length+l,f=void 0;else{if(N===" "&&p&&p!==" "&&p!==`\n`&&p!=="	"){let S=n[h+1];S&&S!==" "&&S!==`\n`&&S!=="	"&&(f=h)}if(h>=u)if(f)c.push(f),u=f+l,f=void 0;else if(t===Pe){for(;p===" "||p==="	";)p=N,N=n[h+=1],g=!0;let S=h>w+1?h-2:m-1;if(d[S])return n;c.push(S),d[S]=!0,u=S+l,f=void 0}else g=!0}p=N}if(g&&a&&a(),c.length===0)return n;o&&o();let y=n.slice(0,c[0]);for(let N=0;N<c.length;++N){let S=c[N],$=c[N+1]||n.length;S===0?y=`\n${e}${n.slice(0,$)}`:(t===Pe&&d[S]&&(y+=`${n[S]}\\\\`),y+=`\n${e}${n.slice(S+1,$)}`)}return y}function xs(n,e,t){let s=e,i=e+1,r=n[i];for(;r===" "||r==="	";)if(e<i+t)r=n[++e];else{do r=n[++e];while(r&&r!==`\n`);s=e,i=e+1,r=n[i]}return s}var dt=(n,e)=>({indentAtStart:e?n.indent.length:n.indentAtStart,lineWidth:n.options.lineWidth,minContentWidth:n.options.minContentWidth}),pt=n=>/^(%|---|\\.\\.\\.)/m.test(n);function Fn(n,e,t){if(!e||e<0)return!1;let s=e-t,i=n.length;if(i<=s)return!1;for(let r=0,o=0;r<i;++r)if(n[r]===`\n`){if(r-o>s)return!0;if(o=r+1,i-o<=s)return!1}return!0}function je(n,e){let t=JSON.stringify(n);if(e.options.doubleQuotedAsJSON)return t;let{implicitKey:s}=e,i=e.options.doubleQuotedMinMultiLineLength,r=e.indent||(pt(n)?"  ":""),o="",a=0;for(let l=0,c=t[l];c;c=t[++l])if(c===" "&&t[l+1]==="\\\\"&&t[l+2]==="n"&&(o+=t.slice(a,l)+"\\\\ ",l+=1,a=l,c="\\\\"),c==="\\\\")switch(t[l+1]){case"u":{o+=t.slice(a,l);let d=t.substr(l+2,4);switch(d){case"0000":o+="\\\\0";break;case"0007":o+="\\\\a";break;case"000b":o+="\\\\v";break;case"001b":o+="\\\\e";break;case"0085":o+="\\\\N";break;case"00a0":o+="\\\\_";break;case"2028":o+="\\\\L";break;case"2029":o+="\\\\P";break;default:d.substr(0,2)==="00"?o+="\\\\x"+d.substr(2):o+=t.substr(l,6)}l+=5,a=l+1}break;case"n":if(s||t[l+2]===\'"\'||t.length<i)l+=1;else{for(o+=t.slice(a,l)+`\n\n`;t[l+2]==="\\\\"&&t[l+3]==="n"&&t[l+4]!==\'"\';)o+=`\n`,l+=2;o+=r,t[l+2]===" "&&(o+="\\\\"),l+=1,a=l+1}break;default:l+=1}return o=a?o+t.slice(a):t,s?o:Be(o,r,Pe,dt(e,!1))}function Qt(n,e){if(e.options.singleQuote===!1||e.implicitKey&&n.includes(`\n`)||/[ \\t]\\n|\\n[ \\t]/.test(n))return je(n,e);let t=e.indent||(pt(n)?"  ":""),s="\'"+n.replace(/\'/g,"\'\'").replace(/\\n+/g,`$&\n${t}`)+"\'";return e.implicitKey?s:Be(s,t,Jt,dt(e,!1))}function Ie(n,e){let{singleQuote:t}=e.options,s;if(t===!1)s=je;else{let i=n.includes(\'"\'),r=n.includes("\'");i&&!r?s=Qt:r&&!i?s=je:s=t?Qt:je}return s(n,e)}var Xt;try{Xt=new RegExp(`(^|(?<!\n))\n+(?!\n|$)`,"g")}catch{Xt=/\\n+(?!\\n|$)/g}function ht({comment:n,type:e,value:t},s,i,r){let{blockQuote:o,commentString:a,lineWidth:l}=s.options;if(!o||/\\n[\\t ]+$/.test(t))return Ie(t,s);let c=s.indent||(s.forceBlockIndent||pt(t)?"  ":""),d=o==="literal"?!0:o==="folded"||e===k.BLOCK_FOLDED?!1:e===k.BLOCK_LITERAL?!0:!Fn(t,l,c.length);if(!t)return d?`|\n`:`>\n`;let u,f;for(f=t.length;f>0;--f){let $=t[f-1];if($!==`\n`&&$!=="	"&&$!==" ")break}let p=t.substring(f),g=p.indexOf(`\n`);g===-1?u="-":t===p||g!==p.length-1?(u="+",r&&r()):u="",p&&(t=t.slice(0,-p.length),p[p.length-1]===`\n`&&(p=p.slice(0,-1)),p=p.replace(Xt,`$&${c}`));let h=!1,m,w=-1;for(m=0;m<t.length;++m){let $=t[m];if($===" ")h=!0;else if($===`\n`)w=m;else break}let y=t.substring(0,w<m?w+1:m);y&&(t=t.substring(y.length),y=y.replace(/\\n+/g,`$&${c}`));let S=(h?c?"2":"1":"")+u;if(n&&(S+=" "+a(n.replace(/ ?[\\r\\n]+/g," ")),i&&i()),!d){let $=t.replace(/\\n+/g,`\n$&`).replace(/(?:^|\\n)([\\t ].*)(?:([\\n\\t ]*)\\n(?![\\n\\t ]))?/g,"$1$2").replace(/\\n+/g,`$&${c}`),O=!1,A=dt(s,!0);o!=="folded"&&e!==k.BLOCK_FOLDED&&(A.onOverflow=()=>{O=!0});let b=Be(`${y}${$}${p}`,c,ut,A);if(!O)return`>${S}\n${c}${b}`}return t=t.replace(/\\n+/g,`$&${c}`),`|${S}\n${c}${y}${t}${p}`}function Vn(n,e,t,s){let{type:i,value:r}=n,{actualString:o,implicitKey:a,indent:l,indentStep:c,inFlow:d}=e;if(a&&r.includes(`\n`)||d&&/[[\\]{},]/.test(r))return Ie(r,e);if(/^[\\n\\t ,[\\]{}#&*!|>\'"%@`]|^[?-]$|^[?-][ \\t]|[\\n:][ \\t]|[ \\t]\\n|[\\n\\t ]#|[\\n\\t :]$/.test(r))return a||d||!r.includes(`\n`)?Ie(r,e):ht(n,e,t,s);if(!a&&!d&&i!==k.PLAIN&&r.includes(`\n`))return ht(n,e,t,s);if(pt(r)){if(l==="")return e.forceBlockIndent=!0,ht(n,e,t,s);if(a&&l===c)return Ie(r,e)}let u=r.replace(/\\n+/g,`$&\n${l}`);if(o){let f=h=>h.default&&h.tag!=="tag:yaml.org,2002:str"&&h.test?.test(u),{compat:p,tags:g}=e.doc.schema;if(g.some(f)||p?.some(f))return Ie(r,e)}return a?u:Be(u,l,Jt,dt(e,!1))}function Se(n,e,t,s){let{implicitKey:i,inFlow:r}=e,o=typeof n.value=="string"?n:Object.assign({},n,{value:String(n.value)}),{type:a}=n;a!==k.QUOTE_DOUBLE&&/[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f\\u{D800}-\\u{DFFF}]/u.test(o.value)&&(a=k.QUOTE_DOUBLE);let l=d=>{switch(d){case k.BLOCK_FOLDED:case k.BLOCK_LITERAL:return i||r?Ie(o.value,e):ht(o,e,t,s);case k.QUOTE_DOUBLE:return je(o.value,e);case k.QUOTE_SINGLE:return Qt(o.value,e);case k.PLAIN:return Vn(o,e,t,s);default:return null}},c=l(a);if(c===null){let{defaultKeyType:d,defaultStringType:u}=e.options,f=i&&d||u;if(c=l(f),c===null)throw new Error(`Unsupported default string type ${f}`)}return c}function mt(n,e){let t=Object.assign({blockQuote:!0,commentString:Ds,defaultKeyType:null,defaultStringType:"PLAIN",directives:null,doubleQuotedAsJSON:!1,doubleQuotedMinMultiLineLength:40,falseStr:"false",flowCollectionPadding:!0,indentSeq:!0,lineWidth:80,minContentWidth:20,nullStr:"null",simpleKeys:!1,singleQuote:null,trailingComma:!1,trueStr:"true",verifyAliasOrder:!0},n.schema.toStringOptions,e),s;switch(t.collectionStyle){case"block":s=!1;break;case"flow":s=!0;break;default:s=null}return{anchors:new Set,doc:n,flowCollectionPadding:t.flowCollectionPadding?" ":"",indent:"",indentStep:typeof t.indent=="number"?" ".repeat(t.indent):"  ",inFlow:s,options:t}}function Wn(n,e){if(e.tag){let i=n.filter(r=>r.tag===e.tag);if(i.length>0)return i.find(r=>r.format===e.format)??i[0]}let t,s;if(T(e)){s=e.value;let i=n.filter(r=>r.identify?.(s));if(i.length>1){let r=i.filter(o=>o.test);r.length>0&&(i=r)}t=i.find(r=>r.format===e.format)??i.find(r=>!r.format)}else s=e,t=n.find(i=>i.nodeClass&&s instanceof i.nodeClass);if(!t){let i=s?.constructor?.name??(s===null?"null":typeof s);throw new Error(`Tag not resolved for ${i} value`)}return t}function Yn(n,e,{anchors:t,doc:s}){if(!s.directives)return"";let i=[],r=(T(n)||E(n))&&n.anchor;r&&lt(r)&&(t.add(r),i.push(`&${r}`));let o=n.tag??(e.default?null:e.tag);return o&&i.push(s.directives.tagString(o)),i.join(" ")}function le(n,e,t,s){if(v(n))return n.toString(e,t,s);if(F(n)){if(e.doc.directives)return n.toString(e);if(e.resolvedAliases?.has(n))throw new TypeError("Cannot stringify circular structure without alias nodes");e.resolvedAliases?e.resolvedAliases.add(n):e.resolvedAliases=new Set([n]),n=n.resolve(e.doc)}let i,r=I(n)?n:e.doc.createNode(n,{onTagObj:l=>i=l});i??(i=Wn(e.doc.schema.tags,r));let o=Yn(r,i,e);o.length>0&&(e.indentAtStart=(e.indentAtStart??0)+o.length+1);let a=typeof i.stringify=="function"?i.stringify(r,e,t,s):T(r)?Se(r,e,t,s):r.toString(e,t,s);return o?T(r)||a[0]==="{"||a[0]==="["?`${o} ${a}`:`${o}\n${e.indent}${a}`:a}function Rs({key:n,value:e},t,s,i){let{allNullValues:r,doc:o,indent:a,indentStep:l,options:{commentString:c,indentSeq:d,simpleKeys:u}}=t,f=I(n)&&n.comment||null;if(u){if(f)throw new Error("With simple keys, key nodes cannot have comments");if(E(n)||!I(n)&&typeof n=="object"){let A="With simple keys, collection cannot be used as a key value";throw new Error(A)}}let p=!u&&(!n||f&&e==null&&!t.inFlow||E(n)||(T(n)?n.type===k.BLOCK_FOLDED||n.type===k.BLOCK_LITERAL:typeof n=="object"));t=Object.assign({},t,{allNullValues:!1,implicitKey:!p&&(u||!r),indent:a+l});let g=!1,h=!1,m=le(n,t,()=>g=!0,()=>h=!0);if(!p&&!t.inFlow&&m.length>1024){if(u)throw new Error("With simple keys, single line scalar must not span more than 1024 characters");p=!0}if(t.inFlow){if(r||e==null)return g&&s&&s(),m===""?"?":p?`? ${m}`:m}else if(r&&!u||e==null&&p)return m=`? ${m}`,f&&!g?m+=se(m,t.indent,c(f)):h&&i&&i(),m;g&&(f=null),p?(f&&(m+=se(m,t.indent,c(f))),m=`? ${m}\n${a}:`):(m=`${m}:`,f&&(m+=se(m,t.indent,c(f))));let w,y,N;I(e)?(w=!!e.spaceBefore,y=e.commentBefore,N=e.comment):(w=!1,y=null,N=null,e&&typeof e=="object"&&(e=o.createNode(e))),t.implicitKey=!1,!p&&!f&&T(e)&&(t.indentAtStart=m.length+1),h=!1,!d&&l.length>=2&&!t.inFlow&&!p&&W(e)&&!e.flow&&!e.tag&&!e.anchor&&(t.indent=t.indent.substring(2));let S=!1,$=le(e,t,()=>S=!0,()=>h=!0),O=" ";if(f||w||y){if(O=w?`\n`:"",y){let A=c(y);O+=`\n${K(A,t.indent)}`}$===""&&!t.inFlow?O===`\n`&&N&&(O=`\n\n`):O+=`\n${t.indent}`}else if(!p&&E(e)){let A=$[0],b=$.indexOf(`\n`),M=b!==-1,ce=t.inFlow??e.flow??e.items.length===0;if(M||!ce){let Ne=!1;if(M&&(A==="&"||A==="!")){let _=$.indexOf(" ");A==="&"&&_!==-1&&_<b&&$[_+1]==="!"&&(_=$.indexOf(" ",_+1)),(_===-1||b<_)&&(Ne=!0)}Ne||(O=`\n${t.indent}`)}}else($===""||$[0]===`\n`)&&(O="");return m+=O+$,t.inFlow?S&&s&&s():N&&!S?m+=se(m,t.indent,c(N)):h&&i&&i(),m}function gt(n,e){(n==="debug"||n==="warn")&&console.warn(e)}var yt="<<",Y={identify:n=>n===yt||typeof n=="symbol"&&n.description===yt,default:"key",tag:"tag:yaml.org,2002:merge",test:/^<<$/,resolve:()=>Object.assign(new k(Symbol(yt)),{addToJSMap:Zt}),stringify:()=>yt},Ps=(n,e)=>(Y.identify(e)||T(e)&&(!e.type||e.type===k.PLAIN)&&Y.identify(e.value))&&n?.doc.schema.tags.some(t=>t.tag===Y.tag&&t.default);function Zt(n,e,t){let s=Bs(n,t);if(W(s))for(let i of s.items)zt(n,e,i);else if(Array.isArray(s))for(let i of s)zt(n,e,i);else zt(n,e,s)}function zt(n,e,t){let s=Bs(n,t);if(!V(s))throw new Error("Merge sources must be maps or map aliases");let i=s.toJSON(null,n,Map);for(let[r,o]of i)e instanceof Map?e.has(r)||e.set(r,o):e instanceof Set?e.add(r):Object.prototype.hasOwnProperty.call(e,r)||Object.defineProperty(e,r,{value:o,writable:!0,enumerable:!0,configurable:!0});return e}function Bs(n,e){return n&&F(e)?e.resolve(n.doc,n):e}function bt(n,e,{key:t,value:s}){if(I(t)&&t.addToJSMap)t.addToJSMap(n,e,s);else if(Ps(n,t))Zt(n,e,s);else{let i=D(t,"",n);if(e instanceof Map)e.set(i,D(s,i,n));else if(e instanceof Set)e.add(i);else{let r=Gn(t,i,n),o=D(s,r,n);r in e?Object.defineProperty(e,r,{value:o,writable:!0,enumerable:!0,configurable:!0}):e[r]=o}}return e}function Gn(n,e,t){if(e===null)return"";if(typeof e!="object")return String(e);if(I(n)&&t?.doc){let s=mt(t.doc,{});s.anchors=new Set;for(let r of t.anchors.keys())s.anchors.add(r.anchor);s.inFlow=!0,s.inStringifyKey=!0;let i=n.toString(s);if(!t.mapKeyWarned){let r=JSON.stringify(i);r.length>40&&(r=r.substring(0,36)+\'..."\'),gt(t.doc.options.logLevel,`Keys with collection values will be stringified due to JS Object restrictions: ${r}. Set mapAsMap: true to use object keys.`),t.mapKeyWarned=!0}return i}return JSON.stringify(e)}function Ee(n,e,t){let s=ae(n,void 0,t),i=ae(e,void 0,t);return new C(s,i)}var C=class n{constructor(e,t=null){Object.defineProperty(this,P,{value:Yt}),this.key=e,this.value=t}clone(e){let{key:t,value:s}=this;return I(t)&&(t=t.clone(e)),I(s)&&(s=s.clone(e)),new n(t,s)}toJSON(e,t){let s=t?.mapAsMap?new Map:{};return bt(t,s,this)}toString(e,t,s){return e?.doc?Rs(this,e,t,s):JSON.stringify(this)}};function St(n,e,t){return(e.inFlow??n.flow?Jn:Hn)(n,e,t)}function Hn({comment:n,items:e},t,{blockItemPrefix:s,flowChars:i,itemIndent:r,onChompKeep:o,onComment:a}){let{indent:l,options:{commentString:c}}=t,d=Object.assign({},t,{indent:r,type:null}),u=!1,f=[];for(let g=0;g<e.length;++g){let h=e[g],m=null;if(I(h))!u&&h.spaceBefore&&f.push(""),wt(t,f,h.commentBefore,u),h.comment&&(m=h.comment);else if(v(h)){let y=I(h.key)?h.key:null;y&&(!u&&y.spaceBefore&&f.push(""),wt(t,f,y.commentBefore,u))}u=!1;let w=le(h,d,()=>m=null,()=>u=!0);m&&(w+=se(w,r,c(m))),u&&m&&(u=!1),f.push(s+w)}let p;if(f.length===0)p=i.start+i.end;else{p=f[0];for(let g=1;g<f.length;++g){let h=f[g];p+=h?`\n${l}${h}`:`\n`}}return n?(p+=`\n`+K(c(n),l),a&&a()):u&&o&&o(),p}function Jn({items:n},e,{flowChars:t,itemIndent:s}){let{indent:i,indentStep:r,flowCollectionPadding:o,options:{commentString:a}}=e;s+=r;let l=Object.assign({},e,{indent:s,inFlow:!0,type:null}),c=!1,d=0,u=[];for(let g=0;g<n.length;++g){let h=n[g],m=null;if(I(h))h.spaceBefore&&u.push(""),wt(e,u,h.commentBefore,!1),h.comment&&(m=h.comment);else if(v(h)){let y=I(h.key)?h.key:null;y&&(y.spaceBefore&&u.push(""),wt(e,u,y.commentBefore,!1),y.comment&&(c=!0));let N=I(h.value)?h.value:null;N?(N.comment&&(m=N.comment),N.commentBefore&&(c=!0)):h.value==null&&y?.comment&&(m=y.comment)}m&&(c=!0);let w=le(h,l,()=>m=null);c||(c=u.length>d||w.includes(`\n`)),g<n.length-1?w+=",":e.options.trailingComma&&(e.options.lineWidth>0&&(c||(c=u.reduce((y,N)=>y+N.length+2,2)+(w.length+2)>e.options.lineWidth)),c&&(w+=",")),m&&(w+=se(w,s,a(m))),u.push(w),d=u.length}let{start:f,end:p}=t;if(u.length===0)return f+p;if(!c){let g=u.reduce((h,m)=>h+m.length+2,2);c=e.options.lineWidth>0&&g>e.options.lineWidth}if(c){let g=f;for(let h of u)g+=h?`\n${r}${i}${h}`:`\n`;return`${g}\n${i}${p}`}else return`${f}${o}${u.join(" ")}${o}${p}`}function wt({indent:n,options:{commentString:e}},t,s,i){if(s&&i&&(s=s.replace(/^\\n+/,"")),s){let r=K(e(s),n);t.push(r.trimStart())}}function de(n,e){let t=T(e)?e.value:e;for(let s of n)if(v(s)&&(s.key===e||s.key===t||T(s.key)&&s.key.value===t))return s}var L=class extends Te{static get tagName(){return"tag:yaml.org,2002:map"}constructor(e){super(q,e),this.items=[]}static from(e,t,s){let{keepUndefined:i,replacer:r}=s,o=new this(e),a=(l,c)=>{if(typeof r=="function")c=r.call(t,l,c);else if(Array.isArray(r)&&!r.includes(l))return;(c!==void 0||i)&&o.items.push(Ee(l,c,s))};if(t instanceof Map)for(let[l,c]of t)a(l,c);else if(t&&typeof t=="object")for(let l of Object.keys(t))a(l,t[l]);return typeof e.sortMapEntries=="function"&&o.items.sort(e.sortMapEntries),o}add(e,t){let s;v(e)?s=e:!e||typeof e!="object"||!("key"in e)?s=new C(e,e?.value):s=new C(e.key,e.value);let i=de(this.items,s.key),r=this.schema?.sortMapEntries;if(i){if(!t)throw new Error(`Key ${s.key} already set`);T(i.value)&&ft(s.value)?i.value.value=s.value:i.value=s.value}else if(r){let o=this.items.findIndex(a=>r(s,a)<0);o===-1?this.items.push(s):this.items.splice(o,0,s)}else this.items.push(s)}delete(e){let t=de(this.items,e);return t?this.items.splice(this.items.indexOf(t),1).length>0:!1}get(e,t){let i=de(this.items,e)?.value;return(!t&&T(i)?i.value:i)??void 0}has(e){return!!de(this.items,e)}set(e,t){this.add(new C(e,t),!0)}toJSON(e,t,s){let i=s?new s:t?.mapAsMap?new Map:{};t?.onCreate&&t.onCreate(i);for(let r of this.items)bt(t,i,r);return i}toString(e,t,s){if(!e)return JSON.stringify(this);for(let i of this.items)if(!v(i))throw new Error(`Map items must all be pairs; found ${JSON.stringify(i)} instead`);return!e.allNullValues&&this.hasAllNullValues(!1)&&(e=Object.assign({},e,{allNullValues:!0})),St(this,e,{blockItemPrefix:"",flowChars:{start:"{",end:"}"},itemIndent:e.indent||"",onChompKeep:s,onComment:t})}};var G={collection:"map",default:!0,nodeClass:L,tag:"tag:yaml.org,2002:map",resolve(n,e){return V(n)||e("Expected a mapping for this tag"),n},createNode:(n,e,t)=>L.from(n,e,t)};var x=class extends Te{static get tagName(){return"tag:yaml.org,2002:seq"}constructor(e){super(re,e),this.items=[]}add(e){this.items.push(e)}delete(e){let t=kt(e);return typeof t!="number"?!1:this.items.splice(t,1).length>0}get(e,t){let s=kt(e);if(typeof s!="number")return;let i=this.items[s];return!t&&T(i)?i.value:i}has(e){let t=kt(e);return typeof t=="number"&&t<this.items.length}set(e,t){let s=kt(e);if(typeof s!="number")throw new Error(`Expected a valid index, not ${e}.`);let i=this.items[s];T(i)&&ft(t)?i.value=t:this.items[s]=t}toJSON(e,t){let s=[];t?.onCreate&&t.onCreate(s);let i=0;for(let r of this.items)s.push(D(r,String(i++),t));return s}toString(e,t,s){return e?St(this,e,{blockItemPrefix:"- ",flowChars:{start:"[",end:"]"},itemIndent:(e.indent||"")+"  ",onChompKeep:s,onComment:t}):JSON.stringify(this)}static from(e,t,s){let{replacer:i}=s,r=new this(e);if(t&&Symbol.iterator in Object(t)){let o=0;for(let a of t){if(typeof i=="function"){let l=t instanceof Set?a:String(o++);a=i.call(t,l,a)}r.items.push(ae(a,void 0,s))}}return r}};function kt(n){let e=T(n)?n.value:n;return e&&typeof e=="string"&&(e=Number(e)),typeof e=="number"&&Number.isInteger(e)&&e>=0?e:null}var H={collection:"seq",default:!0,nodeClass:x,tag:"tag:yaml.org,2002:seq",resolve(n,e){return W(n)||e("Expected a sequence for this tag"),n},createNode:(n,e,t)=>x.from(n,e,t)};var pe={identify:n=>typeof n=="string",default:!0,tag:"tag:yaml.org,2002:str",resolve:n=>n,stringify(n,e,t,s){return e=Object.assign({actualString:!0},e),Se(n,e,t,s)}};var ke={identify:n=>n==null,createNode:()=>new k(null),default:!0,tag:"tag:yaml.org,2002:null",test:/^(?:~|[Nn]ull|NULL)?$/,resolve:()=>new k(null),stringify:({source:n},e)=>typeof n=="string"&&ke.test.test(n)?n:e.options.nullStr};var Ue={identify:n=>typeof n=="boolean",default:!0,tag:"tag:yaml.org,2002:bool",test:/^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,resolve:n=>new k(n[0]==="t"||n[0]==="T"),stringify({source:n,value:e},t){if(n&&Ue.test.test(n)){let s=n[0]==="t"||n[0]==="T";if(e===s)return n}return e?t.options.trueStr:t.options.falseStr}};function R({format:n,minFractionDigits:e,tag:t,value:s}){if(typeof s=="bigint")return String(s);let i=typeof s=="number"?s:Number(s);if(!isFinite(i))return isNaN(i)?".nan":i<0?"-.inf":".inf";let r=Object.is(s,-0)?"-0":JSON.stringify(s);if(!n&&e&&(!t||t==="tag:yaml.org,2002:float")&&/^-?\\d/.test(r)&&!r.includes("e")){let o=r.indexOf(".");o<0&&(o=r.length,r+=".");let a=e-(r.length-o-1);for(;a-- >0;)r+="0"}return r}var $t={identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",test:/^(?:[-+]?\\.(?:inf|Inf|INF)|\\.nan|\\.NaN|\\.NAN)$/,resolve:n=>n.slice(-3).toLowerCase()==="nan"?NaN:n[0]==="-"?Number.NEGATIVE_INFINITY:Number.POSITIVE_INFINITY,stringify:R},Nt={identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",format:"EXP",test:/^[-+]?(?:\\.[0-9]+|[0-9]+(?:\\.[0-9]*)?)[eE][-+]?[0-9]+$/,resolve:n=>parseFloat(n),stringify(n){let e=Number(n.value);return isFinite(e)?e.toExponential():R(n)}},At={identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",test:/^[-+]?(?:\\.[0-9]+|[0-9]+\\.[0-9]*)$/,resolve(n){let e=new k(parseFloat(n)),t=n.indexOf(".");return t!==-1&&n[n.length-1]==="0"&&(e.minFractionDigits=n.length-t-1),e},stringify:R};var Ot=n=>typeof n=="bigint"||Number.isInteger(n),es=(n,e,t,{intAsBigInt:s})=>s?BigInt(n):parseInt(n.substring(e),t);function js(n,e,t){let{value:s}=n;return Ot(s)&&s>=0?t+s.toString(e):R(n)}var Tt={identify:n=>Ot(n)&&n>=0,default:!0,tag:"tag:yaml.org,2002:int",format:"OCT",test:/^0o[0-7]+$/,resolve:(n,e,t)=>es(n,2,8,t),stringify:n=>js(n,8,"0o")},vt={identify:Ot,default:!0,tag:"tag:yaml.org,2002:int",test:/^[-+]?[0-9]+$/,resolve:(n,e,t)=>es(n,0,10,t),stringify:R},It={identify:n=>Ot(n)&&n>=0,default:!0,tag:"tag:yaml.org,2002:int",format:"HEX",test:/^0x[0-9a-fA-F]+$/,resolve:(n,e,t)=>es(n,2,16,t),stringify:n=>js(n,16,"0x")};var Us=[G,H,pe,ke,Ue,Tt,vt,It,$t,Nt,At];function Ks(n){return typeof n=="bigint"||Number.isInteger(n)}var Et=({value:n})=>JSON.stringify(n),Qn=[{identify:n=>typeof n=="string",default:!0,tag:"tag:yaml.org,2002:str",resolve:n=>n,stringify:Et},{identify:n=>n==null,createNode:()=>new k(null),default:!0,tag:"tag:yaml.org,2002:null",test:/^null$/,resolve:()=>null,stringify:Et},{identify:n=>typeof n=="boolean",default:!0,tag:"tag:yaml.org,2002:bool",test:/^true$|^false$/,resolve:n=>n==="true",stringify:Et},{identify:Ks,default:!0,tag:"tag:yaml.org,2002:int",test:/^-?(?:0|[1-9][0-9]*)$/,resolve:(n,e,{intAsBigInt:t})=>t?BigInt(n):parseInt(n,10),stringify:({value:n})=>Ks(n)?n.toString():JSON.stringify(n)},{identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",test:/^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,resolve:n=>parseFloat(n),stringify:Et}],Xn={default:!0,tag:"",test:/^/,resolve(n,e){return e(`Unresolved plain scalar ${JSON.stringify(n)}`),n}},qs=[G,H].concat(Qn,Xn);var Ke={identify:n=>n instanceof Uint8Array,default:!1,tag:"tag:yaml.org,2002:binary",resolve(n,e){if(typeof atob=="function"){let t=atob(n.replace(/[\\n\\r]/g,"")),s=new Uint8Array(t.length);for(let i=0;i<t.length;++i)s[i]=t.charCodeAt(i);return s}else return e("This environment does not support reading binary tags; either Buffer or atob is required"),n},stringify({comment:n,type:e,value:t},s,i,r){if(!t)return"";let o=t,a;if(typeof btoa=="function"){let l="";for(let c=0;c<o.length;++c)l+=String.fromCharCode(o[c]);a=btoa(l)}else throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");if(e??(e=k.BLOCK_LITERAL),e!==k.QUOTE_DOUBLE){let l=Math.max(s.options.lineWidth-s.indent.length,s.options.minContentWidth),c=Math.ceil(a.length/l),d=new Array(c);for(let u=0,f=0;u<c;++u,f+=l)d[u]=a.substr(f,l);a=d.join(e===k.BLOCK_LITERAL?`\n`:" ")}return Se({comment:n,type:e,value:a},s,i,r)}};function ts(n,e){if(W(n))for(let t=0;t<n.items.length;++t){let s=n.items[t];if(!v(s)){if(V(s)){s.items.length>1&&e("Each pair must have its own sequence indicator");let i=s.items[0]||new C(new k(null));if(s.commentBefore&&(i.key.commentBefore=i.key.commentBefore?`${s.commentBefore}\n${i.key.commentBefore}`:s.commentBefore),s.comment){let r=i.value??i.key;r.comment=r.comment?`${s.comment}\n${r.comment}`:s.comment}s=i}n.items[t]=v(s)?s:new C(s)}}else e("Expected a sequence for this tag");return n}function ss(n,e,t){let{replacer:s}=t,i=new x(n);i.tag="tag:yaml.org,2002:pairs";let r=0;if(e&&Symbol.iterator in Object(e))for(let o of e){typeof s=="function"&&(o=s.call(e,String(r++),o));let a,l;if(Array.isArray(o))if(o.length===2)a=o[0],l=o[1];else throw new TypeError(`Expected [key, value] tuple: ${o}`);else if(o&&o instanceof Object){let c=Object.keys(o);if(c.length===1)a=c[0],l=o[a];else throw new TypeError(`Expected tuple with one key, not ${c.length} keys`)}else a=o;i.items.push(Ee(a,l,t))}return i}var qe={collection:"seq",default:!1,tag:"tag:yaml.org,2002:pairs",resolve:ts,createNode:ss};var Ce=class n extends x{constructor(){super(),this.add=L.prototype.add.bind(this),this.delete=L.prototype.delete.bind(this),this.get=L.prototype.get.bind(this),this.has=L.prototype.has.bind(this),this.set=L.prototype.set.bind(this),this.tag=n.tag}toJSON(e,t){if(!t)return super.toJSON(e);let s=new Map;t?.onCreate&&t.onCreate(s);for(let i of this.items){let r,o;if(v(i)?(r=D(i.key,"",t),o=D(i.value,r,t)):r=D(i,"",t),s.has(r))throw new Error("Ordered maps must not include duplicate keys");s.set(r,o)}return s}static from(e,t,s){let i=ss(e,t,s),r=new this;return r.items=i.items,r}};Ce.tag="tag:yaml.org,2002:omap";var Fe={collection:"seq",identify:n=>n instanceof Map,nodeClass:Ce,default:!1,tag:"tag:yaml.org,2002:omap",resolve(n,e){let t=ts(n,e),s=[];for(let{key:i}of t.items)T(i)&&(s.includes(i.value)?e(`Ordered maps must not include duplicate keys: ${i.value}`):s.push(i.value));return Object.assign(new Ce,t)},createNode:(n,e,t)=>Ce.from(n,e,t)};function Fs({value:n,source:e},t){return e&&(n?ns:is).test.test(e)?e:n?t.options.trueStr:t.options.falseStr}var ns={identify:n=>n===!0,default:!0,tag:"tag:yaml.org,2002:bool",test:/^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,resolve:()=>new k(!0),stringify:Fs},is={identify:n=>n===!1,default:!0,tag:"tag:yaml.org,2002:bool",test:/^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,resolve:()=>new k(!1),stringify:Fs};var Vs={identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",test:/^(?:[-+]?\\.(?:inf|Inf|INF)|\\.nan|\\.NaN|\\.NAN)$/,resolve:n=>n.slice(-3).toLowerCase()==="nan"?NaN:n[0]==="-"?Number.NEGATIVE_INFINITY:Number.POSITIVE_INFINITY,stringify:R},Ws={identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",format:"EXP",test:/^[-+]?(?:[0-9][0-9_]*)?(?:\\.[0-9_]*)?[eE][-+]?[0-9]+$/,resolve:n=>parseFloat(n.replace(/_/g,"")),stringify(n){let e=Number(n.value);return isFinite(e)?e.toExponential():R(n)}},Ys={identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",test:/^[-+]?(?:[0-9][0-9_]*)?\\.[0-9_]*$/,resolve(n){let e=new k(parseFloat(n.replace(/_/g,""))),t=n.indexOf(".");if(t!==-1){let s=n.substring(t+1).replace(/_/g,"");s[s.length-1]==="0"&&(e.minFractionDigits=s.length)}return e},stringify:R};var Ve=n=>typeof n=="bigint"||Number.isInteger(n);function Ct(n,e,t,{intAsBigInt:s}){let i=n[0];if((i==="-"||i==="+")&&(e+=1),n=n.substring(e).replace(/_/g,""),s){switch(t){case 2:n=`0b${n}`;break;case 8:n=`0o${n}`;break;case 16:n=`0x${n}`;break}let o=BigInt(n);return i==="-"?BigInt(-1)*o:o}let r=parseInt(n,t);return i==="-"?-1*r:r}function rs(n,e,t){let{value:s}=n;if(Ve(s)){let i=s.toString(e);return s<0?"-"+t+i.substr(1):t+i}return R(n)}var Gs={identify:Ve,default:!0,tag:"tag:yaml.org,2002:int",format:"BIN",test:/^[-+]?0b[0-1_]+$/,resolve:(n,e,t)=>Ct(n,2,2,t),stringify:n=>rs(n,2,"0b")},Hs={identify:Ve,default:!0,tag:"tag:yaml.org,2002:int",format:"OCT",test:/^[-+]?0[0-7_]+$/,resolve:(n,e,t)=>Ct(n,1,8,t),stringify:n=>rs(n,8,"0")},Js={identify:Ve,default:!0,tag:"tag:yaml.org,2002:int",test:/^[-+]?[0-9][0-9_]*$/,resolve:(n,e,t)=>Ct(n,0,10,t),stringify:R},Qs={identify:Ve,default:!0,tag:"tag:yaml.org,2002:int",format:"HEX",test:/^[-+]?0x[0-9a-fA-F_]+$/,resolve:(n,e,t)=>Ct(n,2,16,t),stringify:n=>rs(n,16,"0x")};var Me=class n extends L{constructor(e){super(e),this.tag=n.tag}add(e){let t;v(e)?t=e:e&&typeof e=="object"&&"key"in e&&"value"in e&&e.value===null?t=new C(e.key,null):t=new C(e,null),de(this.items,t.key)||this.items.push(t)}get(e,t){let s=de(this.items,e);return!t&&v(s)?T(s.key)?s.key.value:s.key:s}set(e,t){if(typeof t!="boolean")throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof t}`);let s=de(this.items,e);s&&!t?this.items.splice(this.items.indexOf(s),1):!s&&t&&this.items.push(new C(e))}toJSON(e,t){return super.toJSON(e,t,Set)}toString(e,t,s){if(!e)return JSON.stringify(this);if(this.hasAllNullValues(!0))return super.toString(Object.assign({},e,{allNullValues:!0}),t,s);throw new Error("Set items must all have null values")}static from(e,t,s){let{replacer:i}=s,r=new this(e);if(t&&Symbol.iterator in Object(t))for(let o of t)typeof i=="function"&&(o=i.call(t,o,o)),r.items.push(Ee(o,null,s));return r}};Me.tag="tag:yaml.org,2002:set";var We={collection:"map",identify:n=>n instanceof Set,nodeClass:Me,default:!1,tag:"tag:yaml.org,2002:set",createNode:(n,e,t)=>Me.from(n,e,t),resolve(n,e){if(V(n)){if(n.hasAllNullValues(!0))return Object.assign(new Me,n);e("Set items must all have null values")}else e("Expected a mapping for this tag");return n}};function os(n,e){let t=n[0],s=t==="-"||t==="+"?n.substring(1):n,i=o=>e?BigInt(o):Number(o),r=s.replace(/_/g,"").split(":").reduce((o,a)=>o*i(60)+i(a),i(0));return t==="-"?i(-1)*r:r}function Xs(n){let{value:e}=n,t=o=>o;if(typeof e=="bigint")t=o=>BigInt(o);else if(isNaN(e)||!isFinite(e))return R(n);let s="";e<0&&(s="-",e*=t(-1));let i=t(60),r=[e%i];return e<60?r.unshift(0):(e=(e-r[0])/i,r.unshift(e%i),e>=60&&(e=(e-r[0])/i,r.unshift(e))),s+r.map(o=>String(o).padStart(2,"0")).join(":").replace(/000000\\d*$/,"")}var Mt={identify:n=>typeof n=="bigint"||Number.isInteger(n),default:!0,tag:"tag:yaml.org,2002:int",format:"TIME",test:/^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,resolve:(n,e,{intAsBigInt:t})=>os(n,t),stringify:Xs},Lt={identify:n=>typeof n=="number",default:!0,tag:"tag:yaml.org,2002:float",format:"TIME",test:/^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\\.[0-9_]*$/,resolve:n=>os(n,!1),stringify:Xs},Le={identify:n=>n instanceof Date,default:!0,tag:"tag:yaml.org,2002:timestamp",test:RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\\\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\\\.[0-9]+)?)(?:[ \\\\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),resolve(n){let e=n.match(Le.test);if(!e)throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");let[,t,s,i,r,o,a]=e.map(Number),l=e[7]?Number((e[7]+"00").substr(1,3)):0,c=Date.UTC(t,s-1,i,r||0,o||0,a||0,l),d=e[8];if(d&&d!=="Z"){let u=os(d,!1);Math.abs(u)<30&&(u*=60),c-=6e4*u}return new Date(c)},stringify:({value:n})=>n?.toISOString().replace(/(T00:00:00)?\\.000Z$/,"")??""};var as=[G,H,pe,ke,ns,is,Gs,Hs,Js,Qs,Vs,Ws,Ys,Ke,Y,Fe,qe,We,Mt,Lt,Le];var zs=new Map([["core",Us],["failsafe",[G,H,pe]],["json",qs],["yaml11",as],["yaml-1.1",as]]),Zs={binary:Ke,bool:Ue,float:At,floatExp:Nt,floatNaN:$t,floatTime:Lt,int:vt,intHex:It,intOct:Tt,intTime:Mt,map:G,merge:Y,null:ke,omap:Fe,pairs:qe,seq:H,set:We,timestamp:Le},en={"tag:yaml.org,2002:binary":Ke,"tag:yaml.org,2002:merge":Y,"tag:yaml.org,2002:omap":Fe,"tag:yaml.org,2002:pairs":qe,"tag:yaml.org,2002:set":We,"tag:yaml.org,2002:timestamp":Le};function _t(n,e,t){let s=zs.get(e);if(s&&!n)return t&&!s.includes(Y)?s.concat(Y):s.slice();let i=s;if(!i)if(Array.isArray(n))i=[];else{let r=Array.from(zs.keys()).filter(o=>o!=="yaml11").map(o=>JSON.stringify(o)).join(", ");throw new Error(`Unknown schema "${e}"; use one of ${r} or define customTags array`)}if(Array.isArray(n))for(let r of n)i=i.concat(r);else typeof n=="function"&&(i=n(i.slice()));return t&&(i=i.concat(Y)),i.reduce((r,o)=>{let a=typeof o=="string"?Zs[o]:o;if(!a){let l=JSON.stringify(o),c=Object.keys(Zs).map(d=>JSON.stringify(d)).join(", ");throw new Error(`Unknown custom tag ${l}; use one of ${c}`)}return r.includes(a)||r.push(a),r},[])}var zn=(n,e)=>n.key<e.key?-1:n.key>e.key?1:0,Ye=class n{constructor({compat:e,customTags:t,merge:s,resolveKnownTags:i,schema:r,sortMapEntries:o,toStringDefaults:a}){this.compat=Array.isArray(e)?_t(e,"compat"):e?_t(null,e):null,this.name=typeof r=="string"&&r||"core",this.knownTags=i?en:{},this.tags=_t(t,this.name,s),this.toStringOptions=a??null,Object.defineProperty(this,q,{value:G}),Object.defineProperty(this,U,{value:pe}),Object.defineProperty(this,re,{value:H}),this.sortMapEntries=typeof o=="function"?o:o===!0?zn:null}clone(){let e=Object.create(n.prototype,Object.getOwnPropertyDescriptors(this));return e.tags=this.tags.slice(),e}};function tn(n,e){let t=[],s=e.directives===!0;if(e.directives!==!1&&n.directives){let l=n.directives.toString(n);l?(t.push(l),s=!0):n.directives.docStart&&(s=!0)}s&&t.push("---");let i=mt(n,e),{commentString:r}=i.options;if(n.commentBefore){t.length!==1&&t.unshift("");let l=r(n.commentBefore);t.unshift(K(l,""))}let o=!1,a=null;if(n.contents){if(I(n.contents)){if(n.contents.spaceBefore&&s&&t.push(""),n.contents.commentBefore){let d=r(n.contents.commentBefore);t.push(K(d,""))}i.forceBlockIndent=!!n.comment,a=n.contents.comment}let l=a?void 0:()=>o=!0,c=le(n.contents,i,()=>a=null,l);a&&(c+=se(c,"",r(a))),(c[0]==="|"||c[0]===">")&&t[t.length-1]==="---"?t[t.length-1]=`--- ${c}`:t.push(c)}else t.push(le(n.contents,i));if(n.directives?.docEnd)if(n.comment){let l=r(n.comment);l.includes(`\n`)?(t.push("..."),t.push(K(l,""))):t.push(`... ${l}`)}else t.push("...");else{let l=n.comment;l&&o&&(l=l.replace(/^\\n+/,"")),l&&((!o||a)&&t[t.length-1]!==""&&t.push(""),t.push(K(r(l),"")))}return t.join(`\n`)+`\n`}var me=class n{constructor(e,t,s){this.commentBefore=null,this.comment=null,this.errors=[],this.warnings=[],Object.defineProperty(this,P,{value:rt});let i=null;typeof t=="function"||Array.isArray(t)?i=t:s===void 0&&t&&(s=t,t=void 0);let r=Object.assign({intAsBigInt:!1,keepSourceTokens:!1,logLevel:"warn",prettyErrors:!0,strict:!0,stringKeys:!1,uniqueKeys:!0,version:"1.2"},s);this.options=r;let{version:o}=r;s?._directives?(this.directives=s._directives.atDocument(),this.directives.yaml.explicit&&(o=this.directives.yaml.version)):this.directives=new te({version:o}),this.setSchema(o,s),this.contents=e===void 0?null:this.createNode(e,i,s)}clone(){let e=Object.create(n.prototype,{[P]:{value:rt}});return e.commentBefore=this.commentBefore,e.comment=this.comment,e.errors=this.errors.slice(),e.warnings=this.warnings.slice(),e.options=Object.assign({},this.options),this.directives&&(e.directives=this.directives.clone()),e.schema=this.schema.clone(),e.contents=I(this.contents)?this.contents.clone(e.schema):this.contents,this.range&&(e.range=this.range.slice()),e}add(e){_e(this.contents)&&this.contents.add(e)}addIn(e,t){_e(this.contents)&&this.contents.addIn(e,t)}createAlias(e,t){if(!e.anchor){let s=Gt(this);e.anchor=!t||s.has(t)?Ht(t||"a",s):t}return new oe(e.anchor)}createNode(e,t,s){let i;if(typeof t=="function")e=t.call({"":e},"",e),i=t;else if(Array.isArray(t)){let m=y=>typeof y=="number"||y instanceof String||y instanceof Number,w=t.filter(m).map(String);w.length>0&&(t=t.concat(w)),i=t}else s===void 0&&t&&(s=t,t=void 0);let{aliasDuplicateObjects:r,anchorPrefix:o,flow:a,keepUndefined:l,onTagObj:c,tag:d}=s??{},{onAnchor:u,setAnchors:f,sourceObjects:p}=_s(this,o||"a"),g={aliasDuplicateObjects:r??!0,keepUndefined:l??!1,onAnchor:u,onTagObj:c,replacer:i,schema:this.schema,sourceObjects:p},h=ae(e,d,g);return a&&E(h)&&(h.flow=!0),f(),h}createPair(e,t,s={}){let i=this.createNode(e,null,s),r=this.createNode(t,null,s);return new C(i,r)}delete(e){return _e(this.contents)?this.contents.delete(e):!1}deleteIn(e){return ve(e)?this.contents==null?!1:(this.contents=null,!0):_e(this.contents)?this.contents.deleteIn(e):!1}get(e,t){return E(this.contents)?this.contents.get(e,t):void 0}getIn(e,t){return ve(e)?!t&&T(this.contents)?this.contents.value:this.contents:E(this.contents)?this.contents.getIn(e,t):void 0}has(e){return E(this.contents)?this.contents.has(e):!1}hasIn(e){return ve(e)?this.contents!==void 0:E(this.contents)?this.contents.hasIn(e):!1}set(e,t){this.contents==null?this.contents=Re(this.schema,[e],t):_e(this.contents)&&this.contents.set(e,t)}setIn(e,t){ve(e)?this.contents=t:this.contents==null?this.contents=Re(this.schema,Array.from(e),t):_e(this.contents)&&this.contents.setIn(e,t)}setSchema(e,t={}){typeof e=="number"&&(e=String(e));let s;switch(e){case"1.1":this.directives?this.directives.yaml.version="1.1":this.directives=new te({version:"1.1"}),s={resolveKnownTags:!1,schema:"yaml-1.1"};break;case"1.2":case"next":this.directives?this.directives.yaml.version=e:this.directives=new te({version:e}),s={resolveKnownTags:!0,schema:"core"};break;case null:this.directives&&delete this.directives,s=null;break;default:{let i=JSON.stringify(e);throw new Error(`Expected \'1.1\', \'1.2\' or null as first argument, but found: ${i}`)}}if(t.schema instanceof Object)this.schema=t.schema;else if(s)this.schema=new Ye(Object.assign(s,t));else throw new Error("With a null YAML version, the { schema: Schema } option is required")}toJS({json:e,jsonArg:t,mapAsMap:s,maxAliasCount:i,onAnchor:r,reviver:o}={}){let a={anchors:new Map,doc:this,keep:!e,mapAsMap:s===!0,mapKeyWarned:!1,maxAliasCount:typeof i=="number"?i:100},l=D(this.contents,t??"",a);if(typeof r=="function")for(let{count:c,res:d}of a.anchors.values())r(d,c);return typeof o=="function"?ue(o,{"":l},"",l):l}toJSON(e,t){return this.toJS({json:!0,jsonArg:e,mapAsMap:!1,onAnchor:t})}toString(e={}){if(this.errors.length>0)throw new Error("Document with errors cannot be stringified");if("indent"in e&&(!Number.isInteger(e.indent)||Number(e.indent)<=0)){let t=JSON.stringify(e.indent);throw new Error(`"indent" option must be a positive integer, not ${t}`)}return tn(this,e)}};function _e(n){if(E(n))return!0;throw new Error("Expected a YAML collection as document contents")}var Ge=class extends Error{constructor(e,t,s,i){super(),this.name=e,this.code=s,this.message=i,this.pos=t}},J=class extends Ge{constructor(e,t,s){super("YAMLParseError",e,t,s)}},He=class extends Ge{constructor(e,t,s){super("YAMLWarning",e,t,s)}},ls=(n,e)=>t=>{if(t.pos[0]===-1)return;t.linePos=t.pos.map(a=>e.linePos(a));let{line:s,col:i}=t.linePos[0];t.message+=` at line ${s}, column ${i}`;let r=i-1,o=n.substring(e.lineStarts[s-1],e.lineStarts[s]).replace(/[\\n\\r]+$/,"");if(r>=60&&o.length>80){let a=Math.min(r-39,o.length-79);o="\\u2026"+o.substring(a),r-=a-1}if(o.length>80&&(o=o.substring(0,79)+"\\u2026"),s>1&&/^ *$/.test(o.substring(0,r))){let a=n.substring(e.lineStarts[s-2],e.lineStarts[s-1]);a.length>80&&(a=a.substring(0,79)+`\\u2026\n`),o=a+o}if(/[^ ]/.test(o)){let a=1,l=t.linePos[1];l?.line===s&&l.col>i&&(a=Math.max(1,Math.min(l.col-i,80-r)));let c=" ".repeat(r)+"^".repeat(a);t.message+=`:\n\n${o}\n${c}\n`}};function ne(n,{flow:e,indicator:t,next:s,offset:i,onError:r,parentIndent:o,startOnNewline:a}){let l=!1,c=a,d=a,u="",f="",p=!1,g=!1,h=null,m=null,w=null,y=null,N=null,S=null,$=null;for(let b of n)switch(g&&(b.type!=="space"&&b.type!=="newline"&&b.type!=="comma"&&r(b.offset,"MISSING_CHAR","Tags and anchors must be separated from the next token by white space"),g=!1),h&&(c&&b.type!=="comment"&&b.type!=="newline"&&r(h,"TAB_AS_INDENT","Tabs are not allowed as indentation"),h=null),b.type){case"space":!e&&(t!=="doc-start"||s?.type!=="flow-collection")&&b.source.includes("	")&&(h=b),d=!0;break;case"comment":{d||r(b,"MISSING_CHAR","Comments must be separated from other tokens by white space characters");let M=b.source.substring(1)||" ";u?u+=f+M:u=M,f="",c=!1;break}case"newline":c?u?u+=b.source:(!S||t!=="seq-item-ind")&&(l=!0):f+=b.source,c=!0,p=!0,(m||w)&&(y=b),d=!0;break;case"anchor":m&&r(b,"MULTIPLE_ANCHORS","A node can have at most one anchor"),b.source.endsWith(":")&&r(b.offset+b.source.length-1,"BAD_ALIAS","Anchor ending in : is ambiguous",!0),m=b,$??($=b.offset),c=!1,d=!1,g=!0;break;case"tag":{w&&r(b,"MULTIPLE_TAGS","A node can have at most one tag"),w=b,$??($=b.offset),c=!1,d=!1,g=!0;break}case t:(m||w)&&r(b,"BAD_PROP_ORDER",`Anchors and tags must be after the ${b.source} indicator`),S&&r(b,"UNEXPECTED_TOKEN",`Unexpected ${b.source} in ${e??"collection"}`),S=b,c=t==="seq-item-ind"||t==="explicit-key-ind",d=!1;break;case"comma":if(e){N&&r(b,"UNEXPECTED_TOKEN",`Unexpected , in ${e}`),N=b,c=!1,d=!1;break}default:r(b,"UNEXPECTED_TOKEN",`Unexpected ${b.type} token`),c=!1,d=!1}let O=n[n.length-1],A=O?O.offset+O.source.length:i;return g&&s&&s.type!=="space"&&s.type!=="newline"&&s.type!=="comma"&&(s.type!=="scalar"||s.source!=="")&&r(s.offset,"MISSING_CHAR","Tags and anchors must be separated from the next token by white space"),h&&(c&&h.indent<=o||s?.type==="block-map"||s?.type==="block-seq")&&r(h,"TAB_AS_INDENT","Tabs are not allowed as indentation"),{comma:N,found:S,spaceBefore:l,comment:u,hasNewline:p,anchor:m,tag:w,newlineAfterProp:y,end:A,start:$??A}}function ge(n){if(!n)return null;switch(n.type){case"alias":case"scalar":case"double-quoted-scalar":case"single-quoted-scalar":if(n.source.includes(`\n`))return!0;if(n.end){for(let e of n.end)if(e.type==="newline")return!0}return!1;case"flow-collection":for(let e of n.items){for(let t of e.start)if(t.type==="newline")return!0;if(e.sep){for(let t of e.sep)if(t.type==="newline")return!0}if(ge(e.key)||ge(e.value))return!0}return!1;default:return!0}}function Je(n,e,t){if(e?.type==="flow-collection"){let s=e.end[0];s.indent===n&&(s.source==="]"||s.source==="}")&&ge(e)&&t(s,"BAD_INDENT","Flow end indicator should be more indented than parent",!0)}}function Dt(n,e,t){let{uniqueKeys:s}=n.options;if(s===!1)return!1;let i=typeof s=="function"?s:(r,o)=>r===o||T(r)&&T(o)&&r.value===o.value;return e.some(r=>i(r.key,t))}var sn="All mapping items must start at the same column";function nn({composeNode:n,composeEmptyNode:e},t,s,i,r){let o=r?.nodeClass??L,a=new o(t.schema);t.atRoot&&(t.atRoot=!1);let l=s.offset,c=null;for(let d of s.items){let{start:u,key:f,sep:p,value:g}=d,h=ne(u,{indicator:"explicit-key-ind",next:f??p?.[0],offset:l,onError:i,parentIndent:s.indent,startOnNewline:!0}),m=!h.found;if(m){if(f&&(f.type==="block-seq"?i(l,"BLOCK_AS_IMPLICIT_KEY","A block sequence may not be used as an implicit map key"):"indent"in f&&f.indent!==s.indent&&i(l,"BAD_INDENT",sn)),!h.anchor&&!h.tag&&!p){c=h.end,h.comment&&(a.comment?a.comment+=`\n`+h.comment:a.comment=h.comment);continue}(h.newlineAfterProp||ge(f))&&i(f??u[u.length-1],"MULTILINE_IMPLICIT_KEY","Implicit keys need to be on a single line")}else h.found?.indent!==s.indent&&i(l,"BAD_INDENT",sn);t.atKey=!0;let w=h.end,y=f?n(t,f,h,i):e(t,w,u,null,h,i);t.schema.compat&&Je(s.indent,f,i),t.atKey=!1,Dt(t,a.items,y)&&i(w,"DUPLICATE_KEY","Map keys must be unique");let N=ne(p??[],{indicator:"map-value-ind",next:g,offset:y.range[2],onError:i,parentIndent:s.indent,startOnNewline:!f||f.type==="block-scalar"});if(l=N.end,N.found){m&&(g?.type==="block-map"&&!N.hasNewline&&i(l,"BLOCK_AS_IMPLICIT_KEY","Nested mappings are not allowed in compact mappings"),t.options.strict&&h.start<N.found.offset-1024&&i(y.range,"KEY_OVER_1024_CHARS","The : indicator must be at most 1024 chars after the start of an implicit block mapping key"));let S=g?n(t,g,N,i):e(t,l,p,null,N,i);t.schema.compat&&Je(s.indent,g,i),l=S.range[2];let $=new C(y,S);t.options.keepSourceTokens&&($.srcToken=d),a.items.push($)}else{m&&i(y.range,"MISSING_CHAR","Implicit map keys need to be followed by map values"),N.comment&&(y.comment?y.comment+=`\n`+N.comment:y.comment=N.comment);let S=new C(y);t.options.keepSourceTokens&&(S.srcToken=d),a.items.push(S)}}return c&&c<l&&i(c,"IMPOSSIBLE","Map comment with trailing content"),a.range=[s.offset,l,c??l],a}function rn({composeNode:n,composeEmptyNode:e},t,s,i,r){let o=r?.nodeClass??x,a=new o(t.schema);t.atRoot&&(t.atRoot=!1),t.atKey&&(t.atKey=!1);let l=s.offset,c=null;for(let{start:d,value:u}of s.items){let f=ne(d,{indicator:"seq-item-ind",next:u,offset:l,onError:i,parentIndent:s.indent,startOnNewline:!0});if(!f.found)if(f.anchor||f.tag||u)u?.type==="block-seq"?i(f.end,"BAD_INDENT","All sequence items must start at the same column"):i(l,"MISSING_CHAR","Sequence item without - indicator");else{c=f.end,f.comment&&(a.comment=f.comment);continue}let p=u?n(t,u,f,i):e(t,f.end,d,null,f,i);t.schema.compat&&Je(s.indent,u,i),l=p.range[2],a.items.push(p)}return a.range=[s.offset,l,c??l],a}function ie(n,e,t,s){let i="";if(n){let r=!1,o="";for(let a of n){let{source:l,type:c}=a;switch(c){case"space":r=!0;break;case"comment":{t&&!r&&s(a,"MISSING_CHAR","Comments must be separated from other tokens by white space characters");let d=l.substring(1)||" ";i?i+=o+d:i=d,o="";break}case"newline":i&&(o+=l),r=!0;break;default:s(a,"UNEXPECTED_TOKEN",`Unexpected ${c} at node end`)}e+=l.length}}return{comment:i,offset:e}}var cs="Block collections are not allowed within flow collections",fs=n=>n&&(n.type==="block-map"||n.type==="block-seq");function on({composeNode:n,composeEmptyNode:e},t,s,i,r){let o=s.start.source==="{",a=o?"flow map":"flow sequence",l=r?.nodeClass??(o?L:x),c=new l(t.schema);c.flow=!0;let d=t.atRoot;d&&(t.atRoot=!1),t.atKey&&(t.atKey=!1);let u=s.offset+s.start.source.length;for(let m=0;m<s.items.length;++m){let w=s.items[m],{start:y,key:N,sep:S,value:$}=w,O=ne(y,{flow:a,indicator:"explicit-key-ind",next:N??S?.[0],offset:u,onError:i,parentIndent:s.indent,startOnNewline:!1});if(!O.found){if(!O.anchor&&!O.tag&&!S&&!$){m===0&&O.comma?i(O.comma,"UNEXPECTED_TOKEN",`Unexpected , in ${a}`):m<s.items.length-1&&i(O.start,"UNEXPECTED_TOKEN",`Unexpected empty item in ${a}`),O.comment&&(c.comment?c.comment+=`\n`+O.comment:c.comment=O.comment),u=O.end;continue}!o&&t.options.strict&&ge(N)&&i(N,"MULTILINE_IMPLICIT_KEY","Implicit keys of flow sequence pairs need to be on a single line")}if(m===0)O.comma&&i(O.comma,"UNEXPECTED_TOKEN",`Unexpected , in ${a}`);else if(O.comma||i(O.start,"MISSING_CHAR",`Missing , between ${a} items`),O.comment){let A="";e:for(let b of y)switch(b.type){case"comma":case"space":break;case"comment":A=b.source.substring(1);break e;default:break e}if(A){let b=c.items[c.items.length-1];v(b)&&(b=b.value??b.key),b.comment?b.comment+=`\n`+A:b.comment=A,O.comment=O.comment.substring(A.length+1)}}if(!o&&!S&&!O.found){let A=$?n(t,$,O,i):e(t,O.end,S,null,O,i);c.items.push(A),u=A.range[2],fs($)&&i(A.range,"BLOCK_IN_FLOW",cs)}else{t.atKey=!0;let A=O.end,b=N?n(t,N,O,i):e(t,A,y,null,O,i);fs(N)&&i(b.range,"BLOCK_IN_FLOW",cs),t.atKey=!1;let M=ne(S??[],{flow:a,indicator:"map-value-ind",next:$,offset:b.range[2],onError:i,parentIndent:s.indent,startOnNewline:!1});if(M.found){if(!o&&!O.found&&t.options.strict){if(S)for(let _ of S){if(_===M.found)break;if(_.type==="newline"){i(_,"MULTILINE_IMPLICIT_KEY","Implicit keys of flow sequence pairs need to be on a single line");break}}O.start<M.found.offset-1024&&i(M.found,"KEY_OVER_1024_CHARS","The : indicator must be at most 1024 chars after the start of an implicit flow sequence key")}}else $&&("source"in $&&$.source?.[0]===":"?i($,"MISSING_CHAR",`Missing space after : in ${a}`):i(M.start,"MISSING_CHAR",`Missing , or : between ${a} items`));let ce=$?n(t,$,M,i):M.found?e(t,M.end,S,null,M,i):null;ce?fs($)&&i(ce.range,"BLOCK_IN_FLOW",cs):M.comment&&(b.comment?b.comment+=`\n`+M.comment:b.comment=M.comment);let Ne=new C(b,ce);if(t.options.keepSourceTokens&&(Ne.srcToken=w),o){let _=c;Dt(t,_.items,b)&&i(A,"DUPLICATE_KEY","Map keys must be unique"),_.items.push(Ne)}else{let _=new L(t.schema);_.flow=!0,_.items.push(Ne);let Ns=(ce??b).range;_.range=[b.range[0],Ns[1],Ns[2]],c.items.push(_)}u=ce?ce.range[2]:M.end}}let f=o?"}":"]",[p,...g]=s.end,h=u;if(p?.source===f)h=p.offset+p.source.length;else{let m=a[0].toUpperCase()+a.substring(1),w=d?`${m} must end with a ${f}`:`${m} in block collection must be sufficiently indented and end with a ${f}`;i(u,d?"MISSING_CHAR":"BAD_INDENT",w),p&&p.source.length!==1&&g.unshift(p)}if(g.length>0){let m=ie(g,h,t.options.strict,i);m.comment&&(c.comment?c.comment+=`\n`+m.comment:c.comment=m.comment),c.range=[s.offset,h,m.offset]}else c.range=[s.offset,h,h];return c}function us(n,e,t,s,i,r){let o=t.type==="block-map"?nn(n,e,t,s,r):t.type==="block-seq"?rn(n,e,t,s,r):on(n,e,t,s,r),a=o.constructor;return i==="!"||i===a.tagName?(o.tag=a.tagName,o):(i&&(o.tag=i),o)}function an(n,e,t,s,i){let r=s.tag,o=r?e.directives.tagName(r.source,f=>i(r,"TAG_RESOLVE_FAILED",f)):null;if(t.type==="block-seq"){let{anchor:f,newlineAfterProp:p}=s,g=f&&r?f.offset>r.offset?f:r:f??r;g&&(!p||p.offset<g.offset)&&i(g,"MISSING_CHAR","Missing newline after block sequence props")}let a=t.type==="block-map"?"map":t.type==="block-seq"?"seq":t.start.source==="{"?"map":"seq";if(!r||!o||o==="!"||o===L.tagName&&a==="map"||o===x.tagName&&a==="seq")return us(n,e,t,i,o);let l=e.schema.tags.find(f=>f.tag===o&&f.collection===a);if(!l){let f=e.schema.knownTags[o];if(f?.collection===a)e.schema.tags.push(Object.assign({},f,{default:!1})),l=f;else return f?i(r,"BAD_COLLECTION_TYPE",`${f.tag} used for ${a} collection, but expects ${f.collection??"scalar"}`,!0):i(r,"TAG_RESOLVE_FAILED",`Unresolved tag: ${o}`,!0),us(n,e,t,i,o)}let c=us(n,e,t,i,o,l),d=l.resolve?.(c,f=>i(r,"TAG_RESOLVE_FAILED",f),e.options)??c,u=I(d)?d:new k(d);return u.range=c.range,u.tag=o,l?.format&&(u.format=l.format),u}function hs(n,e,t){let s=e.offset,i=Zn(e,n.options.strict,t);if(!i)return{value:"",type:null,comment:"",range:[s,s,s]};let r=i.mode===">"?k.BLOCK_FOLDED:k.BLOCK_LITERAL,o=e.source?ei(e.source):[],a=o.length;for(let h=o.length-1;h>=0;--h){let m=o[h][1];if(m===""||m==="\\r")a=h;else break}if(a===0){let h=i.chomp==="+"&&o.length>0?`\n`.repeat(Math.max(1,o.length-1)):"",m=s+i.length;return e.source&&(m+=e.source.length),{value:h,type:r,comment:i.comment,range:[s,m,m]}}let l=e.indent+i.indent,c=e.offset+i.length,d=0;for(let h=0;h<a;++h){let[m,w]=o[h];if(w===""||w==="\\r")i.indent===0&&m.length>l&&(l=m.length);else{m.length<l&&t(c+m.length,"MISSING_CHAR","Block scalars with more-indented leading empty lines must use an explicit indentation indicator"),i.indent===0&&(l=m.length),d=h,l===0&&!n.atRoot&&t(c,"BAD_INDENT","Block scalar values in collections must be indented");break}c+=m.length+w.length+1}for(let h=o.length-1;h>=a;--h)o[h][0].length>l&&(a=h+1);let u="",f="",p=!1;for(let h=0;h<d;++h)u+=o[h][0].slice(l)+`\n`;for(let h=d;h<a;++h){let[m,w]=o[h];c+=m.length+w.length+1;let y=w[w.length-1]==="\\r";if(y&&(w=w.slice(0,-1)),w&&m.length<l){let S=`Block scalar lines must not be less indented than their ${i.indent?"explicit indentation indicator":"first line"}`;t(c-w.length-(y?2:1),"BAD_INDENT",S),m=""}r===k.BLOCK_LITERAL?(u+=f+m.slice(l)+w,f=`\n`):m.length>l||w[0]==="	"?(f===" "?f=`\n`:!p&&f===`\n`&&(f=`\n\n`),u+=f+m.slice(l)+w,f=`\n`,p=!0):w===""?f===`\n`?u+=`\n`:f=`\n`:(u+=f+w,f=" ",p=!1)}switch(i.chomp){case"-":break;case"+":for(let h=a;h<o.length;++h)u+=`\n`+o[h][0].slice(l);u[u.length-1]!==`\n`&&(u+=`\n`);break;default:u+=`\n`}let g=s+i.length+e.source.length;return{value:u,type:r,comment:i.comment,range:[s,g,g]}}function Zn({offset:n,props:e},t,s){if(e[0].type!=="block-scalar-header")return s(e[0],"IMPOSSIBLE","Block scalar header not found"),null;let{source:i}=e[0],r=i[0],o=0,a="",l=-1;for(let f=1;f<i.length;++f){let p=i[f];if(!a&&(p==="-"||p==="+"))a=p;else{let g=Number(p);!o&&g?o=g:l===-1&&(l=n+f)}}l!==-1&&s(l,"UNEXPECTED_TOKEN",`Block scalar header includes extra characters: ${i}`);let c=!1,d="",u=i.length;for(let f=1;f<e.length;++f){let p=e[f];switch(p.type){case"space":c=!0;case"newline":u+=p.source.length;break;case"comment":t&&!c&&s(p,"MISSING_CHAR","Comments must be separated from other tokens by white space characters"),u+=p.source.length,d=p.source.substring(1);break;case"error":s(p,"UNEXPECTED_TOKEN",p.message),u+=p.source.length;break;default:{let g=`Unexpected token in block scalar header: ${p.type}`;s(p,"UNEXPECTED_TOKEN",g);let h=p.source;h&&typeof h=="string"&&(u+=h.length)}}}return{mode:r,indent:o,chomp:a,comment:d,length:u}}function ei(n){let e=n.split(/\\n( *)/),t=e[0],s=t.match(/^( *)/),r=[s?.[1]?[s[1],t.slice(s[1].length)]:["",t]];for(let o=1;o<e.length;o+=2)r.push([e[o],e[o+1]]);return r}function ds(n,e,t){let{offset:s,type:i,source:r,end:o}=n,a,l,c=(f,p,g)=>t(s+f,p,g);switch(i){case"scalar":a=k.PLAIN,l=ti(r,c);break;case"single-quoted-scalar":a=k.QUOTE_SINGLE,l=si(r,c);break;case"double-quoted-scalar":a=k.QUOTE_DOUBLE,l=ni(r,c);break;default:return t(n,"UNEXPECTED_TOKEN",`Expected a flow scalar value, but found: ${i}`),{value:"",type:null,comment:"",range:[s,s+r.length,s+r.length]}}let d=s+r.length,u=ie(o,d,e,t);return{value:l,type:a,comment:u.comment,range:[s,d,u.offset]}}function ti(n,e){let t="";switch(n[0]){case"	":t="a tab character";break;case",":t="flow indicator character ,";break;case"%":t="directive indicator character %";break;case"|":case">":{t=`block scalar indicator ${n[0]}`;break}case"@":case"`":{t=`reserved character ${n[0]}`;break}}return t&&e(0,"BAD_SCALAR_START",`Plain value cannot start with ${t}`),ln(n)}function si(n,e){return(n[n.length-1]!=="\'"||n.length===1)&&e(n.length,"MISSING_CHAR","Missing closing \'quote"),ln(n.slice(1,-1)).replace(/\'\'/g,"\'")}function ln(n){let e=/(.*?)\\r?\\n/sy,t=e.exec(n);if(!t)return n;let s,i;try{s=new RegExp("(?<![ 	])[ 	]+$"),i=new RegExp("^[ 	]+|(?<![ 	])[ 	]+$","g")}catch{s=/[ \\t]+$/,i=/^[ \\t]+|[ \\t]+$/g}let r=t[1].replace(s,""),o=" ",a=e.lastIndex;for(;t=e.exec(n);){let c=t[1].replace(i,"");c===""?o===`\n`?r+=o:o=`\n`:(r+=o+c,o=" "),a=e.lastIndex}let l=/[ \\t]*(.*)/sy;return l.lastIndex=a,t=l.exec(n),r+o+(t?.[1]??"")}function ni(n,e){let t="";for(let s=1;s<n.length-1;++s){let i=n[s];if(!(i==="\\r"&&n[s+1]===`\n`))if(i===`\n`){let{fold:r,offset:o}=ii(n,s);t+=r,s=o}else if(i==="\\\\"){let r=n[++s],o=ri[r];if(o)t+=o;else if(r===`\n`)for(r=n[s+1];r===" "||r==="	";)r=n[++s+1];else if(r==="\\r"&&n[s+1]===`\n`)for(r=n[++s+1];r===" "||r==="	";)r=n[++s+1];else if(r==="x"||r==="u"||r==="U"){let a=r==="x"?2:r==="u"?4:8;t+=oi(n,s+1,a,e),s+=a}else{let a=n.substr(s-1,2);e(s-1,"BAD_DQ_ESCAPE",`Invalid escape sequence ${a}`),t+=a}}else if(i===" "||i==="	"){let r=s,o=n[s+1];for(;o===" "||o==="	";)o=n[++s+1];o!==`\n`&&!(o==="\\r"&&n[s+2]===`\n`)&&(t+=s>r?n.slice(r,s+1):i)}else t+=i}return(n[n.length-1]!==\'"\'||n.length===1)&&e(n.length,"MISSING_CHAR",\'Missing closing "quote\'),t}function ii(n,e){let t="",s=n[e+1];for(;(s===" "||s==="	"||s===`\n`||s==="\\r")&&!(s==="\\r"&&n[e+2]!==`\n`);)s===`\n`&&(t+=`\n`),e+=1,s=n[e+1];return t||(t=" "),{fold:t,offset:e}}var ri={0:"\\0",a:"\\x07",b:"\\b",e:"\\x1B",f:"\\f",n:`\n`,r:"\\r",t:"	",v:"\\v",N:"\\x85",_:"\\xA0",L:"\\u2028",P:"\\u2029"," ":" ",\'"\':\'"\',"/":"/","\\\\":"\\\\","	":"	"};function oi(n,e,t,s){let i=n.substr(e,t),o=i.length===t&&/^[0-9a-fA-F]+$/.test(i)?parseInt(i,16):NaN;try{return String.fromCodePoint(o)}catch{let a=n.substr(e-2,t+2);return s(e-2,"BAD_DQ_ESCAPE",`Invalid escape sequence ${a}`),a}}function ps(n,e,t,s){let{value:i,type:r,comment:o,range:a}=e.type==="block-scalar"?hs(n,e,s):ds(e,n.options.strict,s),l=t?n.directives.tagName(t.source,u=>s(t,"TAG_RESOLVE_FAILED",u)):null,c;n.options.stringKeys&&n.atKey?c=n.schema[U]:l?c=ai(n.schema,i,l,t,s):e.type==="scalar"?c=li(n,i,e,s):c=n.schema[U];let d;try{let u=c.resolve(i,f=>s(t??e,"TAG_RESOLVE_FAILED",f),n.options);d=T(u)?u:new k(u)}catch(u){let f=u instanceof Error?u.message:String(u);s(t??e,"TAG_RESOLVE_FAILED",f),d=new k(i)}return d.range=a,d.source=i,r&&(d.type=r),l&&(d.tag=l),c.format&&(d.format=c.format),o&&(d.comment=o),d}function ai(n,e,t,s,i){if(t==="!")return n[U];let r=[];for(let a of n.tags)if(!a.collection&&a.tag===t)if(a.default&&a.test)r.push(a);else return a;for(let a of r)if(a.test?.test(e))return a;let o=n.knownTags[t];return o&&!o.collection?(n.tags.push(Object.assign({},o,{default:!1,test:void 0})),o):(i(s,"TAG_RESOLVE_FAILED",`Unresolved tag: ${t}`,t!=="tag:yaml.org,2002:str"),n[U])}function li({atKey:n,directives:e,schema:t},s,i,r){let o=t.tags.find(a=>(a.default===!0||n&&a.default==="key")&&a.test?.test(s))||t[U];if(t.compat){let a=t.compat.find(l=>l.default&&l.test?.test(s))??t[U];if(o.tag!==a.tag){let l=e.tagString(o.tag),c=e.tagString(a.tag),d=`Value may be parsed as either ${l} or ${c}`;r(i,"TAG_RESOLVE_FAILED",d,!0)}}return o}function cn(n,e,t){if(e){t??(t=e.length);for(let s=t-1;s>=0;--s){let i=e[s];switch(i.type){case"space":case"comment":case"newline":n-=i.source.length;continue}for(i=e[++s];i?.type==="space";)n+=i.source.length,i=e[++s];break}}return n}var ci={composeNode:ms,composeEmptyNode:xt};function ms(n,e,t,s){let i=n.atKey,{spaceBefore:r,comment:o,anchor:a,tag:l}=t,c,d=!0;switch(e.type){case"alias":c=fi(n,e,s),(a||l)&&s(e,"ALIAS_PROPS","An alias node must not specify any properties");break;case"scalar":case"single-quoted-scalar":case"double-quoted-scalar":case"block-scalar":c=ps(n,e,l,s),a&&(c.anchor=a.source.substring(1));break;case"block-map":case"block-seq":case"flow-collection":try{c=an(ci,n,e,t,s),a&&(c.anchor=a.source.substring(1))}catch(u){let f=u instanceof Error?u.message:String(u);s(e,"RESOURCE_EXHAUSTION",f)}break;default:{let u=e.type==="error"?e.message:`Unsupported token (type: ${e.type})`;s(e,"UNEXPECTED_TOKEN",u),d=!1}}return c??(c=xt(n,e.offset,void 0,null,t,s)),a&&c.anchor===""&&s(a,"BAD_ALIAS","Anchor cannot be an empty string"),i&&n.options.stringKeys&&(!T(c)||typeof c.value!="string"||c.tag&&c.tag!=="tag:yaml.org,2002:str")&&s(l??e,"NON_STRING_KEY","With stringKeys, all keys must be strings"),r&&(c.spaceBefore=!0),o&&(e.type==="scalar"&&e.source===""?c.comment=o:c.commentBefore=o),n.options.keepSourceTokens&&d&&(c.srcToken=e),c}function xt(n,e,t,s,{spaceBefore:i,comment:r,anchor:o,tag:a,end:l},c){let d={type:"scalar",offset:cn(e,t,s),indent:-1,source:""},u=ps(n,d,a,c);return o&&(u.anchor=o.source.substring(1),u.anchor===""&&c(o,"BAD_ALIAS","Anchor cannot be an empty string")),i&&(u.spaceBefore=!0),r&&(u.comment=r,u.range[2]=l),u}function fi({options:n},{offset:e,source:t,end:s},i){let r=new oe(t.substring(1));r.source===""&&i(e,"BAD_ALIAS","Alias cannot be an empty string"),r.source.endsWith(":")&&i(e+t.length-1,"BAD_ALIAS","Alias ending in : is ambiguous",!0);let o=e+t.length,a=ie(s,o,n.strict,i);return r.range=[e,o,a.offset],a.comment&&(r.comment=a.comment),r}function fn(n,e,{offset:t,start:s,value:i,end:r},o){let a=Object.assign({_directives:e},n),l=new me(void 0,a),c={atKey:!1,atRoot:!0,directives:l.directives,options:l.options,schema:l.schema},d=ne(s,{indicator:"doc-start",next:i??r?.[0],offset:t,onError:o,parentIndent:0,startOnNewline:!0});d.found&&(l.directives.docStart=!0,i&&(i.type==="block-map"||i.type==="block-seq")&&!d.hasNewline&&o(d.end,"MISSING_CHAR","Block collection cannot start on same line with directives-end marker")),l.contents=i?ms(c,i,d,o):xt(c,d.end,s,null,d,o);let u=l.contents.range[2],f=ie(r,u,!1,o);return f.comment&&(l.comment=f.comment),l.range=[t,u,f.offset],l}function Qe(n){if(typeof n=="number")return[n,n+1];if(Array.isArray(n))return n.length===2?n:[n[0],n[1]];let{offset:e,source:t}=n;return[e,e+(typeof t=="string"?t.length:1)]}function un(n){let e="",t=!1,s=!1;for(let i=0;i<n.length;++i){let r=n[i];switch(r[0]){case"#":e+=(e===""?"":s?`\n\n`:`\n`)+(r.substring(1)||" "),t=!0,s=!1;break;case"%":n[i+1]?.[0]!=="#"&&(i+=1),t=!1;break;default:t||(s=!0),t=!1}}return{comment:e,afterEmptyLine:s}}var Xe=class{constructor(e={}){this.doc=null,this.atDirectives=!1,this.prelude=[],this.errors=[],this.warnings=[],this.onError=(t,s,i,r)=>{let o=Qe(t);r?this.warnings.push(new He(o,s,i)):this.errors.push(new J(o,s,i))},this.directives=new te({version:e.version||"1.2"}),this.options=e}decorate(e,t){let{comment:s,afterEmptyLine:i}=un(this.prelude);if(s){let r=e.contents;if(t)e.comment=e.comment?`${e.comment}\n${s}`:s;else if(i||e.directives.docStart||!r)e.commentBefore=s;else if(E(r)&&!r.flow&&r.items.length>0){let o=r.items[0];v(o)&&(o=o.key);let a=o.commentBefore;o.commentBefore=a?`${s}\n${a}`:s}else{let o=r.commentBefore;r.commentBefore=o?`${s}\n${o}`:s}}if(t){for(let r=0;r<this.errors.length;++r)e.errors.push(this.errors[r]);for(let r=0;r<this.warnings.length;++r)e.warnings.push(this.warnings[r])}else e.errors=this.errors,e.warnings=this.warnings;this.prelude=[],this.errors=[],this.warnings=[]}streamInfo(){return{comment:un(this.prelude).comment,directives:this.directives,errors:this.errors,warnings:this.warnings}}*compose(e,t=!1,s=-1){for(let i of e)yield*this.next(i);yield*this.end(t,s)}*next(e){switch(e.type){case"directive":this.directives.add(e.source,(t,s,i)=>{let r=Qe(e);r[0]+=t,this.onError(r,"BAD_DIRECTIVE",s,i)}),this.prelude.push(e.source),this.atDirectives=!0;break;case"document":{let t=fn(this.options,this.directives,e,this.onError);this.atDirectives&&!t.directives.docStart&&this.onError(e,"MISSING_CHAR","Missing directives-end/doc-start indicator line"),this.decorate(t,!1),this.doc&&(yield this.doc),this.doc=t,this.atDirectives=!1;break}case"byte-order-mark":case"space":break;case"comment":case"newline":this.prelude.push(e.source);break;case"error":{let t=e.source?`${e.message}: ${JSON.stringify(e.source)}`:e.message,s=new J(Qe(e),"UNEXPECTED_TOKEN",t);this.atDirectives||!this.doc?this.errors.push(s):this.doc.errors.push(s);break}case"doc-end":{if(!this.doc){let s="Unexpected doc-end without preceding document";this.errors.push(new J(Qe(e),"UNEXPECTED_TOKEN",s));break}this.doc.directives.docEnd=!0;let t=ie(e.end,e.offset+e.source.length,this.doc.options.strict,this.onError);if(this.decorate(this.doc,!0),t.comment){let s=this.doc.comment;this.doc.comment=s?`${s}\n${t.comment}`:t.comment}this.doc.range[2]=t.offset;break}default:this.errors.push(new J(Qe(e),"UNEXPECTED_TOKEN",`Unsupported token ${e.type}`))}}*end(e=!1,t=-1){if(this.doc)this.decorate(this.doc,!0),yield this.doc,this.doc=null;else if(e){let s=Object.assign({_directives:this.directives},this.options),i=new me(void 0,s);this.atDirectives&&this.onError(t,"MISSING_CHAR","Missing directives-end indicator line"),i.range=[0,t,t],this.decorate(i,!1),yield i}}};var gs=Symbol("break visit"),ui=Symbol("skip children"),hn=Symbol("remove item");function $e(n,e){"type"in n&&n.type==="document"&&(n={start:n.start,value:n.value}),dn(Object.freeze([]),n,e)}$e.BREAK=gs;$e.SKIP=ui;$e.REMOVE=hn;$e.itemAtPath=(n,e)=>{let t=n;for(let[s,i]of e){let r=t?.[s];if(r&&"items"in r)t=r.items[i];else return}return t};$e.parentCollection=(n,e)=>{let t=$e.itemAtPath(n,e.slice(0,-1)),s=e[e.length-1][0],i=t?.[s];if(i&&"items"in i)return i;throw new Error("Parent collection not found")};function dn(n,e,t){let s=t(e,n);if(typeof s=="symbol")return s;for(let i of["key","value"]){let r=e[i];if(r&&"items"in r){for(let o=0;o<r.items.length;++o){let a=dn(Object.freeze(n.concat([[i,o]])),r.items[o],t);if(typeof a=="number")o=a-1;else{if(a===gs)return gs;a===hn&&(r.items.splice(o,1),o-=1)}}typeof s=="function"&&i==="key"&&(s=s(e,n))}}return typeof s=="function"?s(e,n):s}var ys="\\uFEFF",bs="",ws="",Rt="";function pn(n){switch(n){case ys:return"byte-order-mark";case bs:return"doc-mode";case ws:return"flow-error-end";case Rt:return"scalar";case"---":return"doc-start";case"...":return"doc-end";case"":case`\n`:case`\\r\n`:return"newline";case"-":return"seq-item-ind";case"?":return"explicit-key-ind";case":":return"map-value-ind";case"{":return"flow-map-start";case"}":return"flow-map-end";case"[":return"flow-seq-start";case"]":return"flow-seq-end";case",":return"comma"}switch(n[0]){case" ":case"	":return"space";case"#":return"comment";case"%":return"directive-line";case"*":return"alias";case"&":return"anchor";case"!":return"tag";case"\'":return"single-quoted-scalar";case\'"\':return"double-quoted-scalar";case"|":case">":return"block-scalar-header"}return null}function Q(n){switch(n){case void 0:case" ":case`\n`:case"\\r":case"	":return!0;default:return!1}}var mn=new Set("0123456789ABCDEFabcdef"),di=new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*\'()"),Pt=new Set(",[]{}"),pi=new Set(` ,[]{}\n\\r	`),Ss=n=>!n||pi.has(n),ze=class{constructor(){this.atEnd=!1,this.blockScalarIndent=-1,this.blockScalarKeep=!1,this.buffer="",this.flowKey=!1,this.flowLevel=0,this.indentNext=0,this.indentValue=0,this.lineEndPos=null,this.next=null,this.pos=0}*lex(e,t=!1){if(e){if(typeof e!="string")throw TypeError("source is not a string");this.buffer=this.buffer?this.buffer+e:e,this.lineEndPos=null}this.atEnd=!t;let s=this.next??"stream";for(;s&&(t||this.hasChars(1));)s=yield*this.parseNext(s)}atLineEnd(){let e=this.pos,t=this.buffer[e];for(;t===" "||t==="	";)t=this.buffer[++e];return!t||t==="#"||t===`\n`?!0:t==="\\r"?this.buffer[e+1]===`\n`:!1}charAt(e){return this.buffer[this.pos+e]}continueScalar(e){let t=this.buffer[e];if(this.indentNext>0){let s=0;for(;t===" ";)t=this.buffer[++s+e];if(t==="\\r"){let i=this.buffer[s+e+1];if(i===`\n`||!i&&!this.atEnd)return e+s+1}return t===`\n`||s>=this.indentNext||!t&&!this.atEnd?e+s:-1}if(t==="-"||t==="."){let s=this.buffer.substr(e,3);if((s==="---"||s==="...")&&Q(this.buffer[e+3]))return-1}return e}getLine(){let e=this.lineEndPos;return(typeof e!="number"||e!==-1&&e<this.pos)&&(e=this.buffer.indexOf(`\n`,this.pos),this.lineEndPos=e),e===-1?this.atEnd?this.buffer.substring(this.pos):null:(this.buffer[e-1]==="\\r"&&(e-=1),this.buffer.substring(this.pos,e))}hasChars(e){return this.pos+e<=this.buffer.length}setNext(e){return this.buffer=this.buffer.substring(this.pos),this.pos=0,this.lineEndPos=null,this.next=e,null}peek(e){return this.buffer.substr(this.pos,e)}*parseNext(e){switch(e){case"stream":return yield*this.parseStream();case"line-start":return yield*this.parseLineStart();case"block-start":return yield*this.parseBlockStart();case"doc":return yield*this.parseDocument();case"flow":return yield*this.parseFlowCollection();case"quoted-scalar":return yield*this.parseQuotedScalar();case"block-scalar":return yield*this.parseBlockScalar();case"plain-scalar":return yield*this.parsePlainScalar()}}*parseStream(){let e=this.getLine();if(e===null)return this.setNext("stream");if(e[0]===ys&&(yield*this.pushCount(1),e=e.substring(1)),e[0]==="%"){let t=e.length,s=e.indexOf("#");for(;s!==-1;){let r=e[s-1];if(r===" "||r==="	"){t=s-1;break}else s=e.indexOf("#",s+1)}for(;;){let r=e[t-1];if(r===" "||r==="	")t-=1;else break}let i=(yield*this.pushCount(t))+(yield*this.pushSpaces(!0));return yield*this.pushCount(e.length-i),this.pushNewline(),"stream"}if(this.atLineEnd()){let t=yield*this.pushSpaces(!0);return yield*this.pushCount(e.length-t),yield*this.pushNewline(),"stream"}return yield bs,yield*this.parseLineStart()}*parseLineStart(){let e=this.charAt(0);if(!e&&!this.atEnd)return this.setNext("line-start");if(e==="-"||e==="."){if(!this.atEnd&&!this.hasChars(4))return this.setNext("line-start");let t=this.peek(3);if((t==="---"||t==="...")&&Q(this.charAt(3)))return yield*this.pushCount(3),this.indentValue=0,this.indentNext=0,t==="---"?"doc":"stream"}return this.indentValue=yield*this.pushSpaces(!1),this.indentNext>this.indentValue&&!Q(this.charAt(1))&&(this.indentNext=this.indentValue),yield*this.parseBlockStart()}*parseBlockStart(){let[e,t]=this.peek(2);if(!t&&!this.atEnd)return this.setNext("block-start");if((e==="-"||e==="?"||e===":")&&Q(t)){let s=(yield*this.pushCount(1))+(yield*this.pushSpaces(!0));return this.indentNext=this.indentValue+1,this.indentValue+=s,"block-start"}return"doc"}*parseDocument(){yield*this.pushSpaces(!0);let e=this.getLine();if(e===null)return this.setNext("doc");let t=yield*this.pushIndicators();switch(e[t]){case"#":yield*this.pushCount(e.length-t);case void 0:return yield*this.pushNewline(),yield*this.parseLineStart();case"{":case"[":return yield*this.pushCount(1),this.flowKey=!1,this.flowLevel=1,"flow";case"}":case"]":return yield*this.pushCount(1),"doc";case"*":return yield*this.pushUntil(Ss),"doc";case\'"\':case"\'":return yield*this.parseQuotedScalar();case"|":case">":return t+=yield*this.parseBlockScalarHeader(),t+=yield*this.pushSpaces(!0),yield*this.pushCount(e.length-t),yield*this.pushNewline(),yield*this.parseBlockScalar();default:return yield*this.parsePlainScalar()}}*parseFlowCollection(){let e,t,s=-1;do e=yield*this.pushNewline(),e>0?(t=yield*this.pushSpaces(!1),this.indentValue=s=t):t=0,t+=yield*this.pushSpaces(!0);while(e+t>0);let i=this.getLine();if(i===null)return this.setNext("flow");if((s!==-1&&s<this.indentNext&&i[0]!=="#"||s===0&&(i.startsWith("---")||i.startsWith("..."))&&Q(i[3]))&&!(s===this.indentNext-1&&this.flowLevel===1&&(i[0]==="]"||i[0]==="}")))return this.flowLevel=0,yield ws,yield*this.parseLineStart();let r=0;for(;i[r]===",";)r+=yield*this.pushCount(1),r+=yield*this.pushSpaces(!0),this.flowKey=!1;switch(r+=yield*this.pushIndicators(),i[r]){case void 0:return"flow";case"#":return yield*this.pushCount(i.length-r),"flow";case"{":case"[":return yield*this.pushCount(1),this.flowKey=!1,this.flowLevel+=1,"flow";case"}":case"]":return yield*this.pushCount(1),this.flowKey=!0,this.flowLevel-=1,this.flowLevel?"flow":"doc";case"*":return yield*this.pushUntil(Ss),"flow";case\'"\':case"\'":return this.flowKey=!0,yield*this.parseQuotedScalar();case":":{let o=this.charAt(1);if(this.flowKey||Q(o)||o===",")return this.flowKey=!1,yield*this.pushCount(1),yield*this.pushSpaces(!0),"flow"}default:return this.flowKey=!1,yield*this.parsePlainScalar()}}*parseQuotedScalar(){let e=this.charAt(0),t=this.buffer.indexOf(e,this.pos+1);if(e==="\'")for(;t!==-1&&this.buffer[t+1]==="\'";)t=this.buffer.indexOf("\'",t+2);else for(;t!==-1;){let r=0;for(;this.buffer[t-1-r]==="\\\\";)r+=1;if(r%2===0)break;t=this.buffer.indexOf(\'"\',t+1)}let s=this.buffer.substring(0,t),i=s.indexOf(`\n`,this.pos);if(i!==-1){for(;i!==-1;){let r=this.continueScalar(i+1);if(r===-1)break;i=s.indexOf(`\n`,r)}i!==-1&&(t=i-(s[i-1]==="\\r"?2:1))}if(t===-1){if(!this.atEnd)return this.setNext("quoted-scalar");t=this.buffer.length}return yield*this.pushToIndex(t+1,!1),this.flowLevel?"flow":"doc"}*parseBlockScalarHeader(){this.blockScalarIndent=-1,this.blockScalarKeep=!1;let e=this.pos;for(;;){let t=this.buffer[++e];if(t==="+")this.blockScalarKeep=!0;else if(t>"0"&&t<="9")this.blockScalarIndent=Number(t)-1;else if(t!=="-")break}return yield*this.pushUntil(t=>Q(t)||t==="#")}*parseBlockScalar(){let e=this.pos-1,t=0,s;e:for(let r=this.pos;s=this.buffer[r];++r)switch(s){case" ":t+=1;break;case`\n`:e=r,t=0;break;case"\\r":{let o=this.buffer[r+1];if(!o&&!this.atEnd)return this.setNext("block-scalar");if(o===`\n`)break}default:break e}if(!s&&!this.atEnd)return this.setNext("block-scalar");if(t>=this.indentNext){this.blockScalarIndent===-1?this.indentNext=t:this.indentNext=this.blockScalarIndent+(this.indentNext===0?1:this.indentNext);do{let r=this.continueScalar(e+1);if(r===-1)break;e=this.buffer.indexOf(`\n`,r)}while(e!==-1);if(e===-1){if(!this.atEnd)return this.setNext("block-scalar");e=this.buffer.length}}let i=e+1;for(s=this.buffer[i];s===" ";)s=this.buffer[++i];if(s==="	"){for(;s==="	"||s===" "||s==="\\r"||s===`\n`;)s=this.buffer[++i];e=i-1}else if(!this.blockScalarKeep)do{let r=e-1,o=this.buffer[r];o==="\\r"&&(o=this.buffer[--r]);let a=r;for(;o===" ";)o=this.buffer[--r];if(o===`\n`&&r>=this.pos&&r+1+t>a)e=r;else break}while(!0);return yield Rt,yield*this.pushToIndex(e+1,!0),yield*this.parseLineStart()}*parsePlainScalar(){let e=this.flowLevel>0,t=this.pos-1,s=this.pos-1,i;for(;i=this.buffer[++s];)if(i===":"){let r=this.buffer[s+1];if(Q(r)||e&&Pt.has(r))break;t=s}else if(Q(i)){let r=this.buffer[s+1];if(i==="\\r"&&(r===`\n`?(s+=1,i=`\n`,r=this.buffer[s+1]):t=s),r==="#"||e&&Pt.has(r))break;if(i===`\n`){let o=this.continueScalar(s+1);if(o===-1)break;s=Math.max(s,o-2)}}else{if(e&&Pt.has(i))break;t=s}return!i&&!this.atEnd?this.setNext("plain-scalar"):(yield Rt,yield*this.pushToIndex(t+1,!0),e?"flow":"doc")}*pushCount(e){return e>0?(yield this.buffer.substr(this.pos,e),this.pos+=e,e):0}*pushToIndex(e,t){let s=this.buffer.slice(this.pos,e);return s?(yield s,this.pos+=s.length,s.length):(t&&(yield""),0)}*pushIndicators(){let e=0;e:for(;;){switch(this.charAt(0)){case"!":e+=yield*this.pushTag(),e+=yield*this.pushSpaces(!0);continue e;case"&":e+=yield*this.pushUntil(Ss),e+=yield*this.pushSpaces(!0);continue e;case"-":case"?":case":":{let t=this.flowLevel>0,s=this.charAt(1);if(Q(s)||t&&Pt.has(s)){t?this.flowKey&&(this.flowKey=!1):this.indentNext=this.indentValue+1,e+=yield*this.pushCount(1),e+=yield*this.pushSpaces(!0);continue e}}}break e}return e}*pushTag(){if(this.charAt(1)==="<"){let e=this.pos+2,t=this.buffer[e];for(;!Q(t)&&t!==">";)t=this.buffer[++e];return yield*this.pushToIndex(t===">"?e+1:e,!1)}else{let e=this.pos+1,t=this.buffer[e];for(;t;)if(di.has(t))t=this.buffer[++e];else if(t==="%"&&mn.has(this.buffer[e+1])&&mn.has(this.buffer[e+2]))t=this.buffer[e+=3];else break;return yield*this.pushToIndex(e,!1)}}*pushNewline(){let e=this.buffer[this.pos];return e===`\n`?yield*this.pushCount(1):e==="\\r"&&this.charAt(1)===`\n`?yield*this.pushCount(2):0}*pushSpaces(e){let t=this.pos-1,s;do s=this.buffer[++t];while(s===" "||e&&s==="	");let i=t-this.pos;return i>0&&(yield this.buffer.substr(this.pos,i),this.pos=t),i}*pushUntil(e){let t=this.pos,s=this.buffer[t];for(;!e(s);)s=this.buffer[++t];return yield*this.pushToIndex(t,!1)}};var Ze=class{constructor(){this.lineStarts=[],this.addNewLine=e=>this.lineStarts.push(e),this.linePos=e=>{let t=0,s=this.lineStarts.length;for(;t<s;){let r=t+s>>1;this.lineStarts[r]<e?t=r+1:s=r}if(this.lineStarts[t]===e)return{line:t+1,col:1};if(t===0)return{line:0,col:e};let i=this.lineStarts[t-1];return{line:t,col:e-i+1}}}};function ye(n,e){for(let t=0;t<n.length;++t)if(n[t].type===e)return!0;return!1}function gn(n){for(let e=0;e<n.length;++e)switch(n[e].type){case"space":case"comment":case"newline":break;default:return e}return-1}function bn(n){switch(n?.type){case"alias":case"scalar":case"single-quoted-scalar":case"double-quoted-scalar":case"flow-collection":return!0;default:return!1}}function Bt(n){switch(n.type){case"document":return n.start;case"block-map":{let e=n.items[n.items.length-1];return e.sep??e.start}case"block-seq":return n.items[n.items.length-1].start;default:return[]}}function De(n){if(n.length===0)return[];let e=n.length;e:for(;--e>=0;)switch(n[e].type){case"doc-start":case"explicit-key-ind":case"map-value-ind":case"seq-item-ind":case"newline":break e}for(;n[++e]?.type==="space";);return n.splice(e,n.length)}function jt(n,e){if(e.length<1e5)Array.prototype.push.apply(n,e);else for(let t=0;t<e.length;++t)n.push(e[t])}function yn(n){if(n.start.type==="flow-seq-start")for(let e of n.items)e.sep&&!e.value&&!ye(e.start,"explicit-key-ind")&&!ye(e.sep,"map-value-ind")&&(e.key&&(e.value=e.key),delete e.key,bn(e.value)?e.value.end?jt(e.value.end,e.sep):e.value.end=e.sep:jt(e.start,e.sep),delete e.sep)}var et=class{constructor(e){this.atNewLine=!0,this.atScalar=!1,this.indent=0,this.offset=0,this.onKeyLine=!1,this.stack=[],this.source="",this.type="",this.lexer=new ze,this.onNewLine=e}*parse(e,t=!1){this.onNewLine&&this.offset===0&&this.onNewLine(0);for(let s of this.lexer.lex(e,t))yield*this.next(s);t||(yield*this.end())}*next(e){if(this.source=e,this.atScalar){this.atScalar=!1,yield*this.step(),this.offset+=e.length;return}let t=pn(e);if(t)if(t==="scalar")this.atNewLine=!1,this.atScalar=!0,this.type="scalar";else{switch(this.type=t,yield*this.step(),t){case"newline":this.atNewLine=!0,this.indent=0,this.onNewLine&&this.onNewLine(this.offset+e.length);break;case"space":this.atNewLine&&e[0]===" "&&(this.indent+=e.length);break;case"explicit-key-ind":case"map-value-ind":case"seq-item-ind":this.atNewLine&&(this.indent+=e.length);break;case"doc-mode":case"flow-error-end":return;default:this.atNewLine=!1}this.offset+=e.length}else{let s=`Not a YAML token: ${e}`;yield*this.pop({type:"error",offset:this.offset,message:s,source:e}),this.offset+=e.length}}*end(){for(;this.stack.length>0;)yield*this.pop()}get sourceToken(){return{type:this.type,offset:this.offset,indent:this.indent,source:this.source}}*step(){let e=this.peek(1);if(this.type==="doc-end"&&e?.type!=="doc-end"){for(;this.stack.length>0;)yield*this.pop();this.stack.push({type:"doc-end",offset:this.offset,source:this.source});return}if(!e)return yield*this.stream();switch(e.type){case"document":return yield*this.document(e);case"alias":case"scalar":case"single-quoted-scalar":case"double-quoted-scalar":return yield*this.scalar(e);case"block-scalar":return yield*this.blockScalar(e);case"block-map":return yield*this.blockMap(e);case"block-seq":return yield*this.blockSequence(e);case"flow-collection":return yield*this.flowCollection(e);case"doc-end":return yield*this.documentEnd(e)}yield*this.pop()}peek(e){return this.stack[this.stack.length-e]}*pop(e){let t=e??this.stack.pop();if(!t)yield{type:"error",offset:this.offset,source:"",message:"Tried to pop an empty stack"};else if(this.stack.length===0)yield t;else{let s=this.peek(1);switch(t.type==="block-scalar"?t.indent="indent"in s?s.indent:0:t.type==="flow-collection"&&s.type==="document"&&(t.indent=0),t.type==="flow-collection"&&yn(t),s.type){case"document":s.value=t;break;case"block-scalar":s.props.push(t);break;case"block-map":{let i=s.items[s.items.length-1];if(i.value){s.items.push({start:[],key:t,sep:[]}),this.onKeyLine=!0;return}else if(i.sep)i.value=t;else{Object.assign(i,{key:t,sep:[]}),this.onKeyLine=!i.explicitKey;return}break}case"block-seq":{let i=s.items[s.items.length-1];i.value?s.items.push({start:[],value:t}):i.value=t;break}case"flow-collection":{let i=s.items[s.items.length-1];!i||i.value?s.items.push({start:[],key:t,sep:[]}):i.sep?i.value=t:Object.assign(i,{key:t,sep:[]});return}default:yield*this.pop(),yield*this.pop(t)}if((s.type==="document"||s.type==="block-map"||s.type==="block-seq")&&(t.type==="block-map"||t.type==="block-seq")){let i=t.items[t.items.length-1];i&&!i.sep&&!i.value&&i.start.length>0&&gn(i.start)===-1&&(t.indent===0||i.start.every(r=>r.type!=="comment"||r.indent<t.indent))&&(s.type==="document"?s.end=i.start:s.items.push({start:i.start}),t.items.splice(-1,1))}}}*stream(){switch(this.type){case"directive-line":yield{type:"directive",offset:this.offset,source:this.source};return;case"byte-order-mark":case"space":case"comment":case"newline":yield this.sourceToken;return;case"doc-mode":case"doc-start":{let e={type:"document",offset:this.offset,start:[]};this.type==="doc-start"&&e.start.push(this.sourceToken),this.stack.push(e);return}}yield{type:"error",offset:this.offset,message:`Unexpected ${this.type} token in YAML stream`,source:this.source}}*document(e){if(e.value)return yield*this.lineEnd(e);switch(this.type){case"doc-start":{gn(e.start)!==-1?(yield*this.pop(),yield*this.step()):e.start.push(this.sourceToken);return}case"anchor":case"tag":case"space":case"comment":case"newline":e.start.push(this.sourceToken);return}let t=this.startBlockValue(e);t?this.stack.push(t):yield{type:"error",offset:this.offset,message:`Unexpected ${this.type} token in YAML document`,source:this.source}}*scalar(e){if(this.type==="map-value-ind"){let t=Bt(this.peek(2)),s=De(t),i;e.end?(i=e.end,i.push(this.sourceToken),delete e.end):i=[this.sourceToken];let r={type:"block-map",offset:e.offset,indent:e.indent,items:[{start:s,key:e,sep:i}]};this.onKeyLine=!0,this.stack[this.stack.length-1]=r}else yield*this.lineEnd(e)}*blockScalar(e){switch(this.type){case"space":case"comment":case"newline":e.props.push(this.sourceToken);return;case"scalar":if(e.source=this.source,this.atNewLine=!0,this.indent=0,this.onNewLine){let t=this.source.indexOf(`\n`)+1;for(;t!==0;)this.onNewLine(this.offset+t),t=this.source.indexOf(`\n`,t)+1}yield*this.pop();break;default:yield*this.pop(),yield*this.step()}}*blockMap(e){let t=e.items[e.items.length-1];switch(this.type){case"newline":if(this.onKeyLine=!1,t.value){let s="end"in t.value?t.value.end:void 0;(Array.isArray(s)?s[s.length-1]:void 0)?.type==="comment"?s?.push(this.sourceToken):e.items.push({start:[this.sourceToken]})}else t.sep?t.sep.push(this.sourceToken):t.start.push(this.sourceToken);return;case"space":case"comment":if(t.value)e.items.push({start:[this.sourceToken]});else if(t.sep)t.sep.push(this.sourceToken);else{if(this.atIndentedComment(t.start,e.indent)){let i=e.items[e.items.length-2]?.value?.end;if(Array.isArray(i)){jt(i,t.start),i.push(this.sourceToken),e.items.pop();return}}t.start.push(this.sourceToken)}return}if(this.indent>=e.indent){let s=!this.onKeyLine&&this.indent===e.indent,i=s&&(t.sep||t.explicitKey)&&this.type!=="seq-item-ind",r=[];if(i&&t.sep&&!t.value){let o=[];for(let a=0;a<t.sep.length;++a){let l=t.sep[a];switch(l.type){case"newline":o.push(a);break;case"space":break;case"comment":l.indent>e.indent&&(o.length=0);break;default:o.length=0}}o.length>=2&&(r=t.sep.splice(o[1]))}switch(this.type){case"anchor":case"tag":i||t.value?(r.push(this.sourceToken),e.items.push({start:r}),this.onKeyLine=!0):t.sep?t.sep.push(this.sourceToken):t.start.push(this.sourceToken);return;case"explicit-key-ind":!t.sep&&!t.explicitKey?(t.start.push(this.sourceToken),t.explicitKey=!0):i||t.value?(r.push(this.sourceToken),e.items.push({start:r,explicitKey:!0})):this.stack.push({type:"block-map",offset:this.offset,indent:this.indent,items:[{start:[this.sourceToken],explicitKey:!0}]}),this.onKeyLine=!0;return;case"map-value-ind":if(t.explicitKey)if(t.sep)if(t.value)e.items.push({start:[],key:null,sep:[this.sourceToken]});else if(ye(t.sep,"map-value-ind"))this.stack.push({type:"block-map",offset:this.offset,indent:this.indent,items:[{start:r,key:null,sep:[this.sourceToken]}]});else if(bn(t.key)&&!ye(t.sep,"newline")){let o=De(t.start),a=t.key,l=t.sep;l.push(this.sourceToken),delete t.key,delete t.sep,this.stack.push({type:"block-map",offset:this.offset,indent:this.indent,items:[{start:o,key:a,sep:l}]})}else r.length>0?t.sep=t.sep.concat(r,this.sourceToken):t.sep.push(this.sourceToken);else if(ye(t.start,"newline"))Object.assign(t,{key:null,sep:[this.sourceToken]});else{let o=De(t.start);this.stack.push({type:"block-map",offset:this.offset,indent:this.indent,items:[{start:o,key:null,sep:[this.sourceToken]}]})}else t.sep?t.value||i?e.items.push({start:r,key:null,sep:[this.sourceToken]}):ye(t.sep,"map-value-ind")?this.stack.push({type:"block-map",offset:this.offset,indent:this.indent,items:[{start:[],key:null,sep:[this.sourceToken]}]}):t.sep.push(this.sourceToken):Object.assign(t,{key:null,sep:[this.sourceToken]});this.onKeyLine=!0;return;case"alias":case"scalar":case"single-quoted-scalar":case"double-quoted-scalar":{let o=this.flowScalar(this.type);i||t.value?(e.items.push({start:r,key:o,sep:[]}),this.onKeyLine=!0):t.sep?this.stack.push(o):(Object.assign(t,{key:o,sep:[]}),this.onKeyLine=!0);return}default:{let o=this.startBlockValue(e);if(o){if(o.type==="block-seq"){if(!t.explicitKey&&t.sep&&!ye(t.sep,"newline")){yield*this.pop({type:"error",offset:this.offset,message:"Unexpected block-seq-ind on same line with key",source:this.source});return}}else s&&e.items.push({start:r});this.stack.push(o);return}}}}yield*this.pop(),yield*this.step()}*blockSequence(e){let t=e.items[e.items.length-1];switch(this.type){case"newline":if(t.value){let s="end"in t.value?t.value.end:void 0;(Array.isArray(s)?s[s.length-1]:void 0)?.type==="comment"?s?.push(this.sourceToken):e.items.push({start:[this.sourceToken]})}else t.start.push(this.sourceToken);return;case"space":case"comment":if(t.value)e.items.push({start:[this.sourceToken]});else{if(this.atIndentedComment(t.start,e.indent)){let i=e.items[e.items.length-2]?.value?.end;if(Array.isArray(i)){jt(i,t.start),i.push(this.sourceToken),e.items.pop();return}}t.start.push(this.sourceToken)}return;case"anchor":case"tag":if(t.value||this.indent<=e.indent)break;t.start.push(this.sourceToken);return;case"seq-item-ind":if(this.indent!==e.indent)break;t.value||ye(t.start,"seq-item-ind")?e.items.push({start:[this.sourceToken]}):t.start.push(this.sourceToken);return}if(this.indent>e.indent){let s=this.startBlockValue(e);if(s){this.stack.push(s);return}}yield*this.pop(),yield*this.step()}*flowCollection(e){let t=e.items[e.items.length-1];if(this.type==="flow-error-end"){let s;do yield*this.pop(),s=this.peek(1);while(s?.type==="flow-collection")}else if(e.end.length===0){switch(this.type){case"comma":case"explicit-key-ind":!t||t.sep?e.items.push({start:[this.sourceToken]}):t.start.push(this.sourceToken);return;case"map-value-ind":!t||t.value?e.items.push({start:[],key:null,sep:[this.sourceToken]}):t.sep?t.sep.push(this.sourceToken):Object.assign(t,{key:null,sep:[this.sourceToken]});return;case"space":case"comment":case"newline":case"anchor":case"tag":!t||t.value?e.items.push({start:[this.sourceToken]}):t.sep?t.sep.push(this.sourceToken):t.start.push(this.sourceToken);return;case"alias":case"scalar":case"single-quoted-scalar":case"double-quoted-scalar":{let i=this.flowScalar(this.type);!t||t.value?e.items.push({start:[],key:i,sep:[]}):t.sep?this.stack.push(i):Object.assign(t,{key:i,sep:[]});return}case"flow-map-end":case"flow-seq-end":e.end.push(this.sourceToken);return}let s=this.startBlockValue(e);s?this.stack.push(s):(yield*this.pop(),yield*this.step())}else{let s=this.peek(2);if(s.type==="block-map"&&(this.type==="map-value-ind"&&s.indent===e.indent||this.type==="newline"&&!s.items[s.items.length-1].sep))yield*this.pop(),yield*this.step();else if(this.type==="map-value-ind"&&s.type!=="flow-collection"){let i=Bt(s),r=De(i);yn(e);let o=e.end.splice(1,e.end.length);o.push(this.sourceToken);let a={type:"block-map",offset:e.offset,indent:e.indent,items:[{start:r,key:e,sep:o}]};this.onKeyLine=!0,this.stack[this.stack.length-1]=a}else yield*this.lineEnd(e)}}flowScalar(e){if(this.onNewLine){let t=this.source.indexOf(`\n`)+1;for(;t!==0;)this.onNewLine(this.offset+t),t=this.source.indexOf(`\n`,t)+1}return{type:e,offset:this.offset,indent:this.indent,source:this.source}}startBlockValue(e){switch(this.type){case"alias":case"scalar":case"single-quoted-scalar":case"double-quoted-scalar":return this.flowScalar(this.type);case"block-scalar-header":return{type:"block-scalar",offset:this.offset,indent:this.indent,props:[this.sourceToken],source:""};case"flow-map-start":case"flow-seq-start":return{type:"flow-collection",offset:this.offset,indent:this.indent,start:this.sourceToken,items:[],end:[]};case"seq-item-ind":return{type:"block-seq",offset:this.offset,indent:this.indent,items:[{start:[this.sourceToken]}]};case"explicit-key-ind":{this.onKeyLine=!0;let t=Bt(e),s=De(t);return s.push(this.sourceToken),{type:"block-map",offset:this.offset,indent:this.indent,items:[{start:s,explicitKey:!0}]}}case"map-value-ind":{this.onKeyLine=!0;let t=Bt(e),s=De(t);return{type:"block-map",offset:this.offset,indent:this.indent,items:[{start:s,key:null,sep:[this.sourceToken]}]}}}return null}atIndentedComment(e,t){return this.type!=="comment"||this.indent<=t?!1:e.every(s=>s.type==="newline"||s.type==="space")}*documentEnd(e){this.type!=="doc-mode"&&(e.end?e.end.push(this.sourceToken):e.end=[this.sourceToken],this.type==="newline"&&(yield*this.pop()))}*lineEnd(e){switch(this.type){case"comma":case"doc-start":case"doc-end":case"flow-seq-end":case"flow-map-end":case"map-value-ind":yield*this.pop(),yield*this.step();break;case"newline":this.onKeyLine=!1;case"space":case"comment":default:e.end?e.end.push(this.sourceToken):e.end=[this.sourceToken],this.type==="newline"&&(yield*this.pop())}}};function mi(n){let e=n.prettyErrors!==!1;return{lineCounter:n.lineCounter||e&&new Ze||null,prettyErrors:e}}function wn(n,e={}){let{lineCounter:t,prettyErrors:s}=mi(e),i=new et(t?.addNewLine),r=new Xe(e),o=null;for(let a of r.compose(i.parse(n),!0,n.length))if(!o)o=a;else if(o.options.logLevel!=="silent"){o.errors.push(new J(a.range.slice(0,2),"MULTIPLE_DOCS","Source contains multiple documents; please use YAML.parseAllDocuments()"));break}return s&&t&&(o.errors.forEach(ls(n,t)),o.warnings.forEach(ls(n,t))),o}function ks(n,e,t){let s;typeof e=="function"?s=e:t===void 0&&e&&typeof e=="object"&&(t=e);let i=wn(n,t);if(!i)return null;if(i.warnings.forEach(r=>gt(i.options.logLevel,r)),i.errors.length>0){if(i.options.logLevel!=="silent")throw i.errors[0];i.errors=[]}return i.toJS(Object.assign({reviver:s},t))}function $s(n){let e;try{e=ks(n,{version:"1.2",uniqueKeys:!1})}catch(a){return{schedules:[],hasDispatch:!1,parseError:a.message.split(`\n`)[0]}}if(!e||typeof e!="object")return{schedules:[],hasDispatch:!1,parseError:"workflow file is empty"};let t=e,s=t.on??t.true??t[1],i={schedules:[],hasDispatch:!1};if(typeof s=="string")return i.hasDispatch=s==="workflow_dispatch",i;if(Array.isArray(s))return i.hasDispatch=s.includes("workflow_dispatch"),i;if(!s||typeof s!="object")return i;let r=s;i.hasDispatch="workflow_dispatch"in r;let o=r.schedule;if(Array.isArray(o))for(let a of o){if(!a||typeof a!="object")continue;let l=a;if(typeof l.cron!="string")continue;let c=typeof l.timezone=="string"&&l.timezone?l.timezone:"UTC",d={cron:l.cron.trim(),timezone:c};try{d.parsed=Os(d.cron,c)}catch(u){d.error=u instanceof B?u.message:String(u)}i.schedules.push(d)}return i}var Sn=n=>n.map(e=>`${e.cron}@${e.timezone}`).sort().join("|");function yi(n,e){if(!e||!e.length)return!0;let t=n.path.split("/").pop()??"";return e.some(s=>s===String(n.id)||s===n.name||s===n.path||s===t||s===t.replace(/\\.ya?ml$/,""))}async function kn(n,e,t={}){let s=t.now??Date.now(),i=t.from??s-(t.days??7)*we,r=await n.repo(e);t.onProgress?.(`${r.fullName}: listing workflows`);let o=(await n.workflows(r.fullName)).filter(u=>yi(u,t.workflows)),a=[],l=[],c=o.filter(u=>u.path.startsWith(".github/workflows/")),d=await Promise.all(c.map(async u=>{try{return await n.file(r.fullName,u.path,r.defaultBranch)}catch{return null}}));for(let u=0;u<c.length;u++){let f=c[u],p=d[u];if(p===null)continue;let g=$s(p);if(!g.schedules.length&&!g.parseError){l.push(f.path.split("/").pop()??f.path);continue}if(!g.schedules.length&&!/^\\s*schedule\\s*:/m.test(p))continue;t.onProgress?.(`${f.path}: reading runs`);let[h,m,w]=await Promise.all([n.runsWindow(r.fullName,f.id,{event:"schedule",since:i-we,now:s}),g.hasDispatch?n.runsWindow(r.fullName,f.id,{event:"workflow_dispatch",since:i-we,now:s}):Promise.resolve([]),t.lite?Promise.resolve(null):n.fileHistory(r.fullName,f.path,r.defaultBranch).catch(()=>null)]),y;if(w&&w.length){let N=[...w].sort((A,b)=>A.date-b.date),S=Math.max(0,N.findIndex(A=>A.date>=i-we)-1),$=N.findIndex(A=>A.date>=i-we)===-1?N.slice(-1):N.slice(S),O=$[$.length-1];y=await Promise.all($.map(async A=>{let b=A===O?g:$s(await n.file(r.fullName,f.path,A.sha).catch(()=>""));return{since:A.date,sha:A.sha,schedules:b.schedules}})),y=y.filter((A,b,M)=>b===0||Sn(A.schedules)!==Sn(M[b-1].schedules))}a.push({...f,schedules:g.schedules,hasDispatch:g.hasDispatch,parseError:g.parseError,fileChangedAt:w?.[0]?.date??null,timeline:y,scheduleRuns:h,dispatchRuns:m})}return{repo:r,from:i,now:s,workflows:a,unscheduled:l}}async function $n(n,e,t={}){let s=await kn(n,e,{days:2,now:t.now,workflows:t.workflows,lite:!0}),i=Is(s,t.graceMs??15*fe,t.thresholds??Wt);if(t.dispatch){for(let r of i)if(r.action==="dispatch")try{await n.dispatch(s.repo.fullName,r.id,s.repo.defaultBranch)}catch(o){r.error=o.message}}return{repo:s.repo.fullName,dispatched:!!t.dispatch,steps:i}}var nt=class extends Error{constructor(t,s=0){super(t);this.status=s}},bi=6*36e5,X=864e5,tt=1e3,Ut=class{token;api;raw;f;ua;cache;calls=0;runStats={pages:0,cachedDays:0,days:0,truncated:!1};constructor(e={}){this.token=e.token||void 0,this.api=(e.apiBase??"https://api.github.com").replace(/\\/$/,""),this.raw=(e.rawBase??"https://raw.githubusercontent.com").replace(/\\/$/,""),this.f=e.fetch??fetch.bind(globalThis),this.ua=e.userAgent,this.cache=e.cache}get cacheLocation(){return this.cache?.location}get apiHost(){try{return new URL(this.api).host}catch{return"api"}}get authenticated(){return!!this.token}headers(e="application/vnd.github+json"){let t={Accept:e,"X-GitHub-Api-Version":"2022-11-28"};return this.token&&(t.Authorization=`Bearer ${this.token}`),this.ua&&(t["User-Agent"]=this.ua),t}async request(e,t={}){this.calls++;let s=await this.f(e.startsWith("http")?e:this.api+e,{method:t.method??"GET",headers:{...this.headers(t.accept),...t.body?{"Content-Type":"application/json"}:{}},body:t.body?JSON.stringify(t.body):void 0});if(!s.ok){let i="";try{i=(await s.json()).message??""}catch{}if((s.status===403||s.status===429)&&s.headers.get("x-ratelimit-remaining")==="0"){let r=Number(s.headers.get("x-ratelimit-reset")??0)*1e3,o=r?` (resets ${new Date(r).toISOString().slice(11,16)} UTC)`:"";throw new nt(`GitHub API rate limit reached${o}. ${this.token?"":"Unauthenticated requests get 60/hour \\u2014 set GITHUB_TOKEN or run `gh auth login`."}`.trim(),s.status)}throw s.status===404?new nt(`not found: ${e.replace(this.api,"")}${this.token?"":" (private repo? set GITHUB_TOKEN)"}`,404):new nt(`GitHub API ${s.status} on ${e.replace(this.api,"")}: ${i}`,s.status)}return s}async json(e){return await(await this.request(e)).json()}async repo(e){let t=await this.json(`/repos/${e}`);return{fullName:t.full_name,defaultBranch:t.default_branch,fork:!!t.fork,archived:!!t.archived,private:!!t.private,pushedAt:Date.parse(t.pushed_at),url:t.html_url}}async workflows(e){let t=[];for(let s=1;s<=10;s++){let i=await this.json(`/repos/${e}/actions/workflows?per_page=100&page=${s}`);for(let r of i.workflows)t.push({id:r.id,name:r.name,path:r.path,state:r.state,url:r.html_url,created:r.created_at?Date.parse(r.created_at):null});if(t.length>=i.total_count||i.workflows.length<100)break}return t}async file(e,t,s){if(!this.token){this.calls++;let r=await this.f(`${this.raw}/${e}/${encodeURIComponent(s)}/${t}`);if(r.ok)return await r.text()}return await(await this.request(`/repos/${e}/contents/${t}?ref=${encodeURIComponent(s)}`,{accept:"application/vnd.github.raw+json"})).text()}async runs(e,t,s){let i=[],r=new Date(s.since).toISOString().replace(/\\.\\d{3}Z$/,"Z");for(let o=1;o<=(s.maxPages??5);o++){let a=new URLSearchParams({per_page:"100",page:String(o),created:`>=${r}`,exclude_pull_requests:"true"});s.event&&a.set("event",s.event);let l=await this.json(`/repos/${e}/actions/workflows/${t}/runs?${a}`);for(let c of l.workflow_runs)i.push(st(c));if(l.workflow_runs.length<100)break}return i.sort((o,a)=>o.created-a.created)}async runsWindow(e,t,s){let i=s.now??Date.now(),r=Math.floor(s.since/X)*X,o=f=>f+X<=i-bi,a=f=>`${this.apiHost}/${e.toLowerCase()}/${t}/${s.event}/${new Date(f).toISOString().slice(0,10)}`,l=[],c=[];for(let f=r;f<i;f+=X){if(this.runStats.days++,this.cache&&o(f)){let p=await this.cache.get(a(f)).catch(()=>{});if(p){this.runStats.cachedDays++,l.push(...p);continue}}c.push(f)}let d=[];for(let f of c){let p=d[d.length-1];p&&p[1]===f?p[1]=f+X:d.push([f,f+X])}for(let[f,p]of d){let{runs:g,complete:h}=await this.runsRange(e,t,s.event,f,Math.min(p,i),p>=i);if(l.push(...g),!!this.cache)for(let m=f;m<p;m+=X){if(!o(m)||!h.has(m))continue;let w=g.filter(y=>y.created>=m&&y.created<m+X);w.some(y=>y.status!=="completed")||await this.cache.set(a(m),w).catch(()=>{})}}let u=new Set;return l.filter(f=>f.created>=s.since&&f.created<=i&&!u.has(f.id)&&(u.add(f.id),!0)).sort((f,p)=>f.created-p.created)}async runsRange(e,t,s,i,r,o){let a=S=>new Date(S).toISOString().replace(/\\.\\d{3}Z$/,"Z"),l=o?`>=${a(i)}`:`${a(i)}..${a(r-1e3)}`,c=async S=>{let $=new URLSearchParams({per_page:"100",page:String(S),created:l,event:s,exclude_pull_requests:"true"});return this.runStats.pages++,this.json(`/repos/${e}/actions/workflows/${t}/runs?${$}`)},d=Math.max(1,Math.ceil((r-i)/X)),u=async S=>{let $=[];for(let A=0;A<S;A++)$.push(i+Math.floor(d*A/S)*X);$.push(r);let O=await Nn($.slice(0,-1).map((A,b)=>()=>this.runsRange(e,t,s,A,$[b+1],o&&b===S-1)),3);return{runs:O.flatMap(A=>A.runs),complete:new Set(O.flatMap(A=>[...A.complete]))}},f=await c(1),p=f.total_count??f.workflow_runs.length;if(p>=tt&&d>1)return u(Math.min(d,Math.ceil(p/800)));let g=f.workflow_runs.map(st),h=Math.min(Math.ceil(p/100),tt/100),m=await Nn(Array.from({length:Math.max(0,h-1)},(S,$)=>()=>c($+2)),4);for(let S of m)g.push(...S.workflow_runs.map(st));let w=m.length?m[m.length-1].workflow_runs.length:f.workflow_runs.length;for(let S=Math.max(h,1)+1;w===100&&S<=tt/100;S++){let $=await c(S);g.push(...$.workflow_runs.map(st)),w=$.workflow_runs.length}let y=p>=tt||g.length>=tt;if(y&&d>1)return u(2);let N=new Set;if(y)this.runStats.truncated=!0;else for(let S=i;S<r;S+=X)N.add(S);return{runs:g,complete:N}}async run(e,t){return st(await this.json(`/repos/${e}/actions/runs/${t}`))}async fileHistory(e,t,s,i=20){return(await this.json(`/repos/${e}/commits?path=${encodeURIComponent(t)}&sha=${encodeURIComponent(s)}&per_page=${i}`)).map(o=>({sha:o.sha,date:Date.parse(o.commit?.committer?.date??o.commit?.author?.date)})).filter(o=>Number.isFinite(o.date))}async dispatch(e,t,s){await this.request(`/repos/${e}/actions/workflows/${t}/dispatches`,{method:"POST",body:{ref:s}})}async orgRepos(e,t={}){let s=[];for(let i=1;i<=50;i++){let r=await this.json(`/orgs/${encodeURIComponent(e)}/repos?per_page=100&page=${i}&type=all&sort=full_name`);for(let o of r){let a={fullName:o.full_name,name:o.name,private:!!o.private,fork:!!o.fork,archived:!!o.archived,defaultBranch:o.default_branch,url:o.html_url,pushedAt:Date.parse(o.pushed_at)};a.archived&&!t.includeArchived||s.push(a)}if(r.length<100)break}return s}};async function Nn(n,e){let t=new Array(n.length),s=0,i=async()=>{for(;s<n.length;){let r=s++;t[r]=await n[r]()}};return await Promise.all(Array.from({length:Math.min(e,n.length)},i)),t}function st(n){return{id:n.id,number:n.run_number,event:n.event,status:n.status,conclusion:n.conclusion??null,created:Date.parse(n.created_at),started:n.run_started_at?Date.parse(n.run_started_at):null,url:n.html_url}}var An={reset:"\\x1B[0m",dim:"\\x1B[2m",bold:"\\x1B[1m",green:"\\x1B[32m",yellow:"\\x1B[33m",red:"\\x1B[31m",magenta:"\\x1B[35m",cyan:"\\x1B[36m",gray:"\\x1B[90m"};function On(n,e,t){let s=(i,r)=>t?An[i]+r+An.reset:r;return n.length?n.map(i=>i.error?`${s("red","FAILED    ")} ${i.file.padEnd(24)} ${i.reason} \\u2014 dispatch failed: ${i.error}`:`${i.action==="dispatch"?s("yellow",e?"DISPATCHED":"WOULD RUN "):i.action==="covered"?s("green","COVERED   "):s("dim","SKIP      ")} ${i.file.padEnd(24)} ${i.reason}`).join(`\n`):"No scheduled workflows."}var Tn="0.2.0";return Ln(wi);})();\n';
  }
});

// src/worker.ts
function tickFor(everyMs) {
  const m = everyMs / MIN;
  const label = fmtEvery(everyMs);
  if (Number.isInteger(m) && m >= 5 && m < 60 && 60 % m === 0) {
    const mins = [];
    for (let x = OFFSET % m; x < 60; x += m) mins.push(x);
    return { ms: everyMs, label, cron: `${mins.join(",")} * * * *`, onCalendar: `*-*-* *:${pad(OFFSET % m)}/${m}:00 UTC` };
  }
  const h = everyMs / HOUR;
  if (Number.isInteger(h) && h >= 1 && h <= 12 && 24 % h === 0) {
    return h === 1 ? { ms: everyMs, label, cron: `${OFFSET} * * * *`, onCalendar: `*-*-* *:${pad(OFFSET)}:00 UTC` } : { ms: everyMs, label, cron: `${OFFSET} */${h} * * *`, onCalendar: `*-*-* 00/${h}:${pad(OFFSET)}:00 UTC` };
  }
  if (everyMs < 5 * MIN) {
    throw new WorkerSpecError(`--every ${label} is too often: catch-up only acts on a slot older than --grace, so 5m is the useful minimum`);
  }
  throw new WorkerSpecError(`--every ${label} doesn't divide an hour or a day evenly; use 5m, 10m, 15m, 20m, 30m, 1h, 2h, 3h, 4h, 6h or 12h`);
}
function human(ms) {
  const h = ms / HOUR;
  if (Number.isInteger(h)) return h === 1 ? "hour" : `${h} hours`;
  return `${Math.round(ms / MIN)} minutes`;
}
function fmtEvery(ms) {
  if (ms % HOUR === 0) return `${ms / HOUR}h`;
  if (ms % MIN === 0) return `${ms / MIN}m`;
  return `${Math.round(ms / 1e3)}s`;
}
async function selectWorkflows(gh, repo, filters) {
  const info = await gh.repo(repo);
  const all = (await gh.workflows(info.fullName)).filter((w) => w.path.startsWith(".github/workflows/"));
  if (filters?.length) {
    const unknown = filters.filter((f) => !all.some((w) => matchesFilter(w, [f])));
    if (unknown.length) {
      const known = all.map((w) => w.path.split("/").pop()).join(", ") || "none";
      throw new WorkerSpecError(`no workflow matches ${unknown.map((u) => `"${u}"`).join(", ")} in ${info.fullName} (workflows: ${known})`);
    }
  }
  const picked = all.filter((w) => matchesFilter(w, filters));
  const texts = await Promise.all(picked.map((w) => gh.file(info.fullName, w.path, info.defaultBranch).catch(() => null)));
  const out = { workflows: [], noDispatch: [] };
  picked.forEach((w, i) => {
    const text = texts[i];
    if (text === null) return;
    const t = readTriggers(text);
    const valid = t.schedules.filter((s) => s.parsed);
    if (!valid.length) {
      if (filters?.length) throw new WorkerSpecError(`${w.path.split("/").pop()} has no valid on: schedule cron, so there is nothing to catch up`);
      return;
    }
    const gap = shortestGap(valid.map((s) => s.parsed), Date.now());
    const ww = {
      file: w.path.split("/").pop() ?? w.path,
      path: w.path,
      name: w.name,
      id: w.id,
      state: w.state,
      schedules: valid.map((s) => ({ cron: s.cron, timezone: s.timezone })),
      hasDispatch: t.hasDispatch,
      guarded: (GUARD_USES.test(text) || LOCAL_USES.test(text)) && GUARD_MODE.test(text),
      minIntervalMs: gap
    };
    (t.hasDispatch ? out.workflows : out.noDispatch).push(ww);
  });
  return { repo: info.fullName, ...out };
}
function shortestGap(crons, at) {
  const all = [...new Set(crons.flatMap((c) => firesBetween(c, at, at + 8 * 864e5, 5e3)))].sort((a, b) => a - b);
  if (all.length < 2) return null;
  let best = Infinity;
  for (let i = 1; i < all.length; i++) best = Math.min(best, all[i] - all[i - 1]);
  return best;
}
function slug(repo) {
  const s = `cronlag-catchup-${repo.replace("/", "-")}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "");
  return s.slice(0, 63).replace(/-$/, "");
}
function catchupArgs(spec) {
  const a = ["catchup", spec.repo];
  for (const w of spec.workflows) a.push("-w", w.file);
  a.push("--grace", fmtEvery(spec.graceMs), "--dispatch");
  return a;
}
function workflowLines(spec, prefix) {
  const crons = (x) => x.schedules.map((s) => s.cron + (s.timezone !== "UTC" ? ` (${s.timezone})` : "")).join(" \xB7 ");
  const fw = Math.max(...spec.workflows.map((x) => x.file.length));
  const cw = Math.max(...spec.workflows.map((x) => crons(x).length));
  return spec.workflows.map((x) => `${prefix}   ${x.file.padEnd(fw)}  ${x.guarded ? crons(x) : `${crons(x).padEnd(cw)}   \u2190 no mode: guard step yet`}`.trimEnd());
}
function semantics(spec, p) {
  return [
    `${p}Every ${human(spec.tick.ms)}, one \`cronlag catchup --dispatch\` pass: for each workflow below, take the latest`,
    `${p}cron slot that is at least ${fmtEvery(spec.graceMs)} old (and under 24h old). If neither a scheduled run nor a`,
    `${p}workflow_dispatch run was created after it, start the workflow once via workflow_dispatch on the`,
    `${p}default branch. The next pass sees that run and leaves the slot alone: a slot is dispatched at most once.`,
    `${p}Add \`mode: guard\` to each workflow so GitHub's own late run skips itself: ${DOCS}#guard`
  ];
}
function renderCloudflare(spec) {
  const name = slug(spec.repo);
  const toml = [
    `name = "${name}"`,
    `main = "worker.js"`,
    `compatibility_date = "${spec.generated}"`,
    `workers_dev = false   # cron only: no public URL`,
    ``,
    `[triggers]`,
    `crons = ["${spec.tick.cron}"]   # every ${spec.tick.label}, UTC`,
    ``,
    `# First deploy as a dry run (logs what it would dispatch, dispatches nothing), then delete these two lines:`,
    `# [vars]`,
    `# DRY_RUN = "1"`
  ];
  const head = [
    `// cronlag catch-up worker for ${spec.repo}`,
    `// Generated by \`cronlag worker\` (cronlag ${VERSION}) on ${spec.generated}. Cloudflare Worker, cron trigger, no dependencies.`,
    `//`,
    ...semantics(spec, "// "),
    `//`,
    `// Workflows (re-run \`cronlag worker\` if you add one or change a cron line):`,
    ...workflowLines(spec, "//"),
    `//`,
    `// Deploy with wrangler \u2014 save this file as worker.js, and next to it wrangler.toml:`,
    ...toml.map((l) => l ? `//     ${l}` : "//"),
    `//   then:`,
    `//     wrangler secret put GITHUB_TOKEN   # fine-grained token: only ${spec.repo}, Actions: read and write`,
    `//     wrangler deploy                    # wrangler tail  shows each pass`,
    `// Or in the dashboard: Workers & Pages \u2192 Create \u2192 Hello World \u2192 Edit code, paste this file and deploy;`,
    `// then Settings \u2192 Trigger events \u2192 Cron "${spec.tick.cron}", and Settings \u2192 Variables and Secrets \u2192 secret GITHUB_TOKEN.`,
    `//`,
    `// The token is read from the GITHUB_TOKEN secret at run time and is never written into this file.`,
    `// Each pass makes about ${2 + 3 * spec.workflows.length} GitHub API calls (2 + 3 per workflow) and uses a few ms of CPU:`,
    `// a handful of workflows fits the Workers free plan (50 subrequests, 10 ms CPU per run).`,
    `// Below the handler is cronlag's own catch-up code (workflow reader, GitHub cron expansion, slot`,
    `// attribution, planCatchup), bundled from cronlag ${VERSION} \u2014 the code \`cronlag catchup\` runs.`,
    `// It includes the yaml parser by Eemeli Aro (ISC license).`,
    ``,
    `const CONFIG = {`,
    `  repo: ${JSON.stringify(spec.repo)},`,
    `  workflows: ${JSON.stringify(spec.workflows.map((w) => w.file)).replace(/","/g, '", "')},`,
    `  graceMinutes: ${spec.graceMs / MIN},`,
    `};`,
    ``,
    `export default {`,
    `  async scheduled(controller, env) {`,
    `    await catchUp(env);`,
    `  },`,
    `};`,
    ``,
    `async function catchUp(env) {`,
    `  const token = env.GITHUB_TOKEN;`,
    `  if (!token) throw new Error("GITHUB_TOKEN is not set: run \`wrangler secret put GITHUB_TOKEN\` (Actions: read and write on " + CONFIG.repo + ")");`,
    `  const dryRun = /^(1|true|yes)$/i.test(String(env.DRY_RUN ?? ""));`,
    `  const gh = new cronlag.GitHub({ token, userAgent: "cronlag-worker/" + cronlag.VERSION });`,
    `  const r = await cronlag.runCatchup(gh, CONFIG.repo, {`,
    `    workflows: CONFIG.workflows,`,
    `    graceMs: CONFIG.graceMinutes * 60_000,`,
    `    dispatch: !dryRun,`,
    `  });`,
    `  console.log("cronlag catchup " + r.repo + (dryRun ? " (DRY_RUN: nothing dispatched)" : "") + "\\n" + cronlag.formatCatchup(r.steps, r.dispatched, false));`,
    `  const failed = r.steps.filter((s) => s.error);`,
    `  // Throwing marks this invocation as failed in the Cloudflare dashboard; the next tick retries.`,
    `  if (failed.length) throw new Error("dispatch failed: " + failed.map((s) => s.file + ": " + s.error).join("; "));`,
    `  return r;`,
    `}`,
    ``,
    `// ---- cronlag ${VERSION} catch-up engine (generated from src/worker/engine.ts; do not edit) ----`,
    ENGINE.trim(),
    ``
  ];
  return [
    { name: "worker.js", text: head.join("\n") },
    { name: "wrangler.toml", text: toml.join("\n") + "\n" }
  ];
}
function renderSystemd(spec) {
  const name = slug(spec.repo);
  const env = `/etc/cronlag/${name}.env`;
  const bin = splitBin(spec.bin);
  const cmd = [...bin[0]?.startsWith("/") ? [] : ["/usr/bin/env"], ...bin, ...catchupArgs(spec)].map(sdq).join(" ");
  const common = (title) => [
    `# ${title}`,
    `# Generated by \`cronlag worker --target systemd\` (cronlag ${VERSION}) on ${spec.generated}.`,
    `#`,
    ...semantics(spec, "# "),
    `#`,
    `# Workflows (re-run \`cronlag worker\` if you add one or change a cron line):`,
    ...workflowLines(spec, "#"),
    `#`
  ];
  const service = [
    ...common(`${name}.service \u2014 one catch-up pass for ${spec.repo}`),
    `# Token: ${env}, readable by root only (systemd reads it, the service never prints it):`,
    `#     GITHUB_TOKEN=github_pat_\u2026        # fine-grained: only ${spec.repo}, Actions: read and write`,
    `#   sudo install -d -m 700 /etc/cronlag && sudoedit ${env} && sudo chmod 600 ${env}`,
    `# Needs Node 18.17+ (npx) on the PATH below; with nvm, put the full path to npx in ExecStart.`,
    `# Faster starts: npm i -g github:Blackman99/cronlag#v0 and re-run \`cronlag worker --bin cronlag\`.`,
    ``,
    `[Unit]`,
    `Description=cronlag catch-up for ${spec.repo} (dispatch missed scheduled-workflow slots)`,
    `Documentation=${DOCS}#worker`,
    `Wants=network-online.target`,
    `After=network-online.target`,
    ``,
    `[Service]`,
    `Type=oneshot`,
    `EnvironmentFile=${env}`,
    `Environment=PATH=/usr/local/bin:/usr/bin:/bin`,
    `Environment=NO_COLOR=1`,
    `# npx needs a writable home for its cache`,
    `DynamicUser=yes`,
    `CacheDirectory=cronlag`,
    `Environment=HOME=%C/cronlag`,
    `ExecStart=${cmd}`,
    `TimeoutStartSec=5min`,
    `NoNewPrivileges=yes`,
    `ProtectSystem=strict`,
    `ProtectHome=yes`,
    `PrivateTmp=yes`,
    ``
  ];
  const timer = [
    ...common(`${name}.timer \u2014 runs ${name}.service every ${spec.tick.label}`),
    `# Install both files into /etc/systemd/system/, then:`,
    `#   sudo systemctl daemon-reload && sudo systemctl enable --now ${name}.timer`,
    `#   systemctl list-timers ${name}.timer     journalctl -u ${name}.service`,
    `# Dry run first: sudo systemctl edit ${name}.service, and in the override drop --dispatch:`,
    `#   [Service]`,
    `#   ExecStart=`,
    `#   ExecStart=${cmd.replace(/ --dispatch$/, "")}`,
    ``,
    `[Unit]`,
    `Description=cronlag catch-up for ${spec.repo} every ${spec.tick.label}`,
    `Documentation=${DOCS}#worker`,
    ``,
    `[Timer]`,
    `OnCalendar=${spec.tick.onCalendar}`,
    `AccuracySec=30s`,
    `Persistent=true`,
    ``,
    `[Install]`,
    `WantedBy=timers.target`,
    ``
  ];
  return [
    { name: `${name}.service`, text: service.join("\n") },
    { name: `${name}.timer`, text: timer.join("\n") }
  ];
}
function renderCrontab(spec) {
  const name = slug(spec.repo);
  const env = `$HOME/.config/cronlag/${name}.env`;
  const cmd = [...splitBin(spec.bin), ...catchupArgs(spec)].map(shq).join(" ").replace(/%/g, "\\%");
  const lines = [
    `# cronlag catch-up for ${spec.repo}`,
    `# Generated by \`cronlag worker --target crontab\` (cronlag ${VERSION}) on ${spec.generated}.`,
    `#`,
    ...semantics(spec, "# "),
    `#`,
    `# Workflows (re-run \`cronlag worker\` if you add one or change a cron line):`,
    ...workflowLines(spec, "#"),
    `#`,
    `# Token: ${env}, chmod 600, one line:`,
    `#     export GITHUB_TOKEN=github_pat_\u2026   # fine-grained: only ${spec.repo}, Actions: read and write`,
    `# Install: crontab -e and paste these lines. cron's PATH is minimal: if \`command -v npx\` is not in`,
    `# /usr/local/bin or /usr/bin, change the PATH line. Dry run first: drop --dispatch from the end.`,
    `PATH=/usr/local/bin:/usr/bin:/bin`,
    `${spec.tick.cron}  . "${env}" && NO_COLOR=1 ${cmd} >> "$HOME/cronlag-catchup.log" 2>&1`,
    ``
  ];
  return [{ name: "crontab", text: lines.join("\n") }];
}
function splitBin(bin) {
  return bin.trim().split(/\s+/).filter(Boolean);
}
function render(spec) {
  if (!spec.workflows.length) throw new WorkerSpecError("no workflows to catch up");
  return spec.target === "cloudflare" ? renderCloudflare(spec) : spec.target === "systemd" ? renderSystemd(spec) : renderCrontab(spec);
}
function notes(spec, sel) {
  const out = [];
  const list = (xs) => xs.map((w) => w.file).join(", ");
  const unguarded = spec.workflows.filter((w) => !w.guarded);
  if (unguarded.length) {
    const who = unguarded.length === 1 ? `${unguarded[0].file} has no` : unguarded.length === spec.workflows.length ? "none of these workflows has a" : `${list(unguarded)} have no`;
    out.push({ level: "warn", text: `${who} \`mode: guard\` step yet, so if GitHub's late run still arrives after a catch-up, that slot runs twice. Add the guard job: ${DOCS}#guard` });
  }
  for (const w of spec.workflows) {
    if (w.state !== "active") out.push({ level: "warn", text: `${w.file} is ${w.state.replace(/_/g, " ")}: catch-up skips it until you enable it again` });
  }
  const busy = spec.workflows.filter((w) => w.minIntervalMs !== null && w.minIntervalMs < spec.tick.ms);
  if (busy.length) {
    out.push({ level: "info", text: `${list(busy)} fire${busy.length === 1 ? "s" : ""} more often than every ${spec.tick.label}: each pass runs only the latest missed slot (as catchup does); a shorter --every catches more` });
  }
  if (spec.target === "cloudflare" && spec.workflows.length > 15) {
    out.push({ level: "warn", text: `${spec.workflows.length} workflows need about ${2 + 3 * spec.workflows.length} GitHub API calls per pass; Cloudflare's free plan allows 50 subrequests per run. Split with -w or use a paid plan` });
  }
  if (sel.noDispatch.length) {
    out.push({ level: "info", text: `left out (no workflow_dispatch trigger, so a missed slot can't be started): ${list(sel.noDispatch)}` });
  }
  return out;
}
var TARGETS, DEFAULT_BIN, DOCS, WorkerSpecError, OFFSET, pad, GUARD_USES, LOCAL_USES, GUARD_MODE, shq, sdq;
var init_worker = __esm({
  "src/worker.ts"() {
    "use strict";
    init_cron();
    init_analyze();
    init_collect();
    init_workflow();
    init_version();
    init_engine_generated();
    TARGETS = ["cloudflare", "systemd", "crontab"];
    DEFAULT_BIN = "npx -y github:Blackman99/cronlag#v0";
    DOCS = "https://blackman99.github.io/cronlag/docs/usage.html";
    WorkerSpecError = class extends Error {
    };
    OFFSET = 4;
    pad = (n) => String(n).padStart(2, "0");
    GUARD_USES = /uses:\s*["']?blackman99\/cronlag@/i;
    LOCAL_USES = /uses:\s*["']?\.\/?["']?\s*$/m;
    GUARD_MODE = /mode:\s*["']?guard\b/;
    shq = (s) => /^[\w@%+=:,./#-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
    sdq = (s) => {
      const e = s.replace(/%/g, "%%").replace(/\$/g, "$$$$");
      return /^[\w@%+=:,./#-]+$/.test(e) ? e : `"${e.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    };
  }
});

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  exitFor: () => exitFor,
  parseArgs: () => parseArgs,
  parseDur: () => parseDur
});
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join as join2, resolve as resolvePath } from "node:path";
function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) {
      let [k, v] = a.replace(/^--?/, "").split(/=(.*)/s, 2);
      if (!a.startsWith("--")) k = SHORT[k] ?? k;
      if (!BOOL.has(k) && !VALUED.has(k)) throw new UsageError(`unknown option ${a.split("=")[0]}`);
      if (BOOL.has(k)) {
        (flags[k] ??= []).push("true");
        continue;
      }
      if (v === void 0) v = argv[++i];
      if (v === void 0) throw new UsageError(`--${k} needs a value`);
      (flags[k] ??= []).push(v);
    } else pos.push(a);
  }
  const cmds = ["catchup", "guard", "explain", "mcp", "org", "report", "worker"];
  const cmd = pos.length && cmds.includes(pos[0]) ? pos.shift() : "report";
  return { cmd, pos, flags };
}
function parseDur(s) {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|min|h|d)?$/i);
  if (!m) throw new UsageError(`bad duration "${s}" (try 15m, 1h, 2d)`);
  const n = Number(m[1]);
  const u = (m[2] ?? "m").toLowerCase();
  return n * (u === "s" ? 1e3 : u === "h" ? HOUR : u === "d" ? DAY : MIN);
}
function one(a, k) {
  const v = a.flags[k];
  return v ? v[v.length - 1] : void 0;
}
function thresholds(a) {
  return {
    ...DEFAULTS,
    lateMs: one(a, "late") ? parseDur(one(a, "late")) : DEFAULTS.lateMs,
    onTimeMs: one(a, "on-time") ? parseDur(one(a, "on-time")) : DEFAULTS.onTimeMs
  };
}
function resolveRepo(a) {
  const r = a.pos[0] ?? process.env.GITHUB_REPOSITORY ?? repoFromGit();
  if (!r) throw new UsageError("which repo? pass owner/repo (or run inside a git clone with a GitHub origin)");
  const m = r.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new UsageError(`"${r}" is not owner/repo`);
  return m[1];
}
function exitFor(r, failOn) {
  if (failOn === "never") return 0;
  const bad = failOn === "late" ? ["LATE", "DROPPING", "NOT FIRING", "DISABLED", "INVALID"] : ["DROPPING", "NOT FIRING", "DISABLED", "INVALID"];
  return r.workflows.some((w) => bad.includes(w.verdict)) ? 1 : 0;
}
async function main(argv) {
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
  const cache = useCache ? new DiskRunCache() : void 0;
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
      console.log(JSON.stringify({ cron: c.source, timezone: tz, next: fires.map((t2) => new Date(t2).toISOString()), minIntervalMs: gap, minuteZero: c.minutes.includes(0) }, null, 2));
      return 0;
    }
    console.log(`${c.source}${tz !== "UTC" ? `  (${tz})` : ""}`);
    for (const t2 of fires) console.log(`  ${new Date(t2).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    if (gap !== null) console.log(`  shortest interval ${fmtDur(gap)}${gap < 5 * MIN ? " \u2014 below GitHub's 5-minute minimum" : ""}`);
    if (c.minutes.includes(0)) console.log("  ! minute 0 is GitHub's busiest minute; pick another (e.g. 7 or 43)");
    return 0;
  }
  if (a.cmd === "worker") return await workerCmd(a);
  const token = findToken(one(a, "token"));
  const live = a.cmd === "catchup" || a.cmd === "guard";
  const gh = new GitHub({ token, userAgent: `cronlag/${VERSION}`, cache: live ? void 0 : cache });
  if (live && (one(a, "since") || one(a, "days"))) throw new UsageError(`${a.cmd} looks at the latest due slots only; --since / --days apply to reports`);
  if (a.cmd === "guard") {
    const repo2 = process.env.GITHUB_REPOSITORY;
    const runId = Number(process.env.GITHUB_RUN_ID);
    const event = process.env.GITHUB_EVENT_NAME;
    const out = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}
`);
    if (event !== "schedule") {
      console.log(`cronlag guard: event is ${event ?? "unknown"}, not schedule \u2014 nothing to guard (skip=false)`);
      out("skip", "false");
      return 0;
    }
    if (!repo2 || !runId) throw new UsageError("guard runs inside GitHub Actions (needs GITHUB_REPOSITORY and GITHUB_RUN_ID)");
    const ev = process.env.GITHUB_EVENT_PATH ? JSON.parse((await import("node:fs")).readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
    const cronStr = ev.schedule ?? one(a, "cron");
    if (!cronStr) throw new UsageError("could not read github.event.schedule");
    const run = await gh.run(repo2, runId);
    const wfPath = process.env.GITHUB_WORKFLOW_REF?.split("@")[0].split("/").slice(2).join("/");
    let tz = one(a, "tz") ?? "UTC";
    let wfId;
    const wfs = await gh.workflows(repo2);
    const wf = wfs.find((w) => w.path === wfPath) ?? wfs.find((w) => w.name === process.env.GITHUB_WORKFLOW);
    if (wf) {
      wfId = wf.id;
      try {
        const repoInfo = await gh.repo(repo2);
        const t2 = readTriggers(await gh.file(repo2, wf.path, repoInfo.defaultBranch));
        tz = t2.schedules.find((s) => s.cron === cronStr.trim())?.timezone ?? tz;
      } catch {
      }
    }
    const dispatchRuns = wfId ? await gh.runs(repo2, wfId, { event: "workflow_dispatch", since: run.created - 2 * DAY, maxPages: 1 }) : [];
    const g = guard(parseCron(cronStr, tz), run.created, dispatchRuns);
    console.log(`cronlag guard: ${g.skip ? "SKIP" : "RUN"} \u2014 ${g.reason}`);
    out("skip", String(g.skip));
    out("slot", g.slot ?? "");
    out("lag-minutes", g.lagMs === null ? "" : String(Math.round(g.lagMs / MIN)));
    return 0;
  }
  let win;
  try {
    win = resolveWindow({ days: one(a, "days"), since: one(a, "since") });
  } catch (e) {
    if (e instanceof WindowError) throw new UsageError(e.message);
    throw e;
  }
  const t = thresholds(a);
  if (!token && process.stderr.isTTY) {
    console.error(
      win.days > 30 ? `(no GitHub token found \u2014 public repos only, 60 API calls/hour; a ${Math.round(win.days)}-day window can need more on the first run)` : "(no GitHub token found \u2014 public repos only, 60 API calls/hour)"
    );
  }
  const runNote = () => {
    const st = gh.runStats;
    if (st.truncated) console.error("cronlag: warning \u2014 a single day had more than 1000 runs of one workflow; GitHub's API returns at most 1000, so some runs (and lag numbers) are missing");
    if (!process.stderr.isTTY || !st.days) return;
    const note = (msg) => console.error(color ? `\x1B[2m${msg}\x1B[0m` : msg);
    if (st.cachedDays) note(`(cached: ${st.cachedDays} of ${st.days} days of runs from ${gh.cacheLocation} \xB7 ${st.pages} API request${st.pages === 1 ? "" : "s"} for the rest)`);
    else if (win.days > 7 && cache) note(`(${st.pages} API requests for runs; finished days are now cached in ${gh.cacheLocation}, so the next run reuses them)`);
  };
  const orgName = a.cmd === "org" ? a.pos[0] : one(a, "org");
  if (a.cmd === "org" || orgName) {
    if (!orgName) throw new UsageError("org needs a name, e.g. cronlag org github");
    const progress = process.stderr.isTTY ? (msg) => console.error(msg) : void 0;
    const report2 = await scanOrg(gh, orgName, {
      from: win.from,
      workflows: a.flags.workflow,
      thresholds: t,
      onProgress: progress
    });
    const format2 = one(a, "format") ?? (a.flags.json ? "json" : "text");
    if (format2 === "json") console.log(JSON.stringify(report2, null, 2));
    else if (format2 === "markdown" || format2 === "md") console.log(formatOrgMarkdown(report2));
    else console.log(formatOrgText(report2, { color, width: process.stdout.columns }));
    runNote();
    return exitForOrg(report2, one(a, "fail-on") ?? "never");
  }
  const repo = resolveRepo(a);
  if (a.cmd === "catchup") {
    const r = await runCatchup(gh, repo, { workflows: a.flags.workflow, graceMs: parseDur(one(a, "grace") ?? "15m"), dispatch: !!a.flags.dispatch, thresholds: t });
    if (one(a, "format") === "json") console.log(JSON.stringify(r, null, 2));
    else {
      console.log(formatCatchup(r.steps, r.dispatched, color));
      if (!r.dispatched && r.steps.some((s) => s.action === "dispatch")) console.log("\n(dry run \u2014 add --dispatch to run the slots above via workflow_dispatch)");
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
async function workerCmd(a) {
  for (const k of ["since", "days", "dispatch"]) {
    if (a.flags[k]) throw new UsageError(k === "dispatch" ? "worker always prints a recipe that dispatches; each one explains its dry run" : `worker runs catch-up on the latest due slots only; --${k} applies to reports`);
  }
  const target = (one(a, "target") ?? "cloudflare").toLowerCase();
  if (!TARGETS.includes(target)) throw new UsageError(`--target must be one of ${TARGETS.join(", ")} (got "${target}")`);
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
      sel.noDispatch.length ? `${sel.repo}: no scheduled workflow has a workflow_dispatch trigger (${sel.noDispatch.map((w) => w.file).join(", ")}); add \`workflow_dispatch:\` under \`on:\` so catch-up can start them` : `${sel.repo} has no workflows with on: schedule, so there is nothing to catch up`
    );
  }
  const spec = { repo: sel.repo, target, workflows: sel.workflows, graceMs, tick, bin, generated: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) };
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
    const wrote = [];
    for (const f of files) {
      const p = join2(outDir, f.name);
      writeFileSync(p, f.text);
      wrote.push(`${p}  (${f.text.length >= 1e4 ? `${Math.round(f.text.length / 1024)} KB` : `${f.text.split("\n").length} lines`})`);
    }
    console.log(workerSummary(spec, sel, { color: !a.flags["no-color"] && !process.env.NO_COLOR && (process.stdout.isTTY || !!process.env.FORCE_COLOR), wrote, outDir }));
    return 0;
  }
  if (target === "systemd") {
    console.log(files.map((f) => `# ===== /etc/systemd/system/${f.name} =====
${f.text}`).join("\n"));
  } else {
    process.stdout.write(files[0].text.endsWith("\n") ? files[0].text : files[0].text + "\n");
  }
  console.error("\n" + workerSummary(spec, sel, { color: errColor }));
  return 0;
}
function workerSummary(spec, sel, o) {
  const C2 = { dim: "\x1B[2m", bold: "\x1B[1m", green: "\x1B[32m", yellow: "\x1B[33m", cyan: "\x1B[36m", reset: "\x1B[0m" };
  const c = (k, s) => o.color ? C2[k] + s + C2.reset : s;
  const width = Math.max(60, Math.min(process.stderr.columns || 100, 120));
  const what = spec.target === "cloudflare" ? "Cloudflare Worker" : spec.target === "systemd" ? "systemd timer + service" : "crontab line";
  const when = spec.target === "systemd" ? `OnCalendar=${spec.tick.onCalendar}` : `${spec.tick.cron} UTC`;
  const L = [];
  L.push(`${c("bold", "cronlag worker")}  ${spec.repo} ${c("dim", "\u2192")} ${what}`);
  L.push(c("dim", `  every ${spec.tick.label} (${when}) \xB7 grace ${fmtDur(spec.graceMs)} \xB7 latest due slot, once`));
  L.push("");
  const w = Math.max(...spec.workflows.map((x) => x.file.length));
  const cw = Math.max(...spec.workflows.map((x) => x.schedules.map((s) => s.cron).join(" \xB7 ").length));
  for (const x of spec.workflows) {
    const guard2 = x.guarded ? c("green", "guard \u2713") : c("yellow", "no guard");
    L.push(`  ${x.file.padEnd(w)}  ${c("cyan", x.schedules.map((s) => s.cron).join(" \xB7 ").padEnd(cw))}  ${guard2}`);
  }
  const ns = notes(spec, sel);
  if (ns.length) {
    L.push("");
    for (const n of ns) {
      wrap(n.text, width - 4).forEach((ln, i) => L.push(`  ${i ? " " : n.level === "warn" ? c("yellow", "!") : c("dim", "\xB7")} ${n.level === "info" ? c("dim", ln) : ln}`));
    }
  }
  L.push("");
  if (o.wrote) {
    for (const p of o.wrote) L.push(`  ${c("green", "wrote")} ${p}`);
    L.push("");
  }
  const steps = [];
  const name = slug(spec.repo);
  const cd = o.outDir && o.outDir !== "." ? `cd ${o.outDir} && ` : "";
  if (spec.target === "cloudflare") {
    if (!o.wrote) steps.push("save it as worker.js (-o <dir> also writes wrangler.toml)");
    steps.push(`${cd}wrangler secret put GITHUB_TOKEN && wrangler deploy`);
    steps.push(c("dim", "# token: fine-grained, this repo only, Actions read and write"));
  } else if (spec.target === "systemd") {
    steps.push(o.wrote ? `sudo cp ${o.outDir}/${name}.{service,timer} /etc/systemd/system/` : "-o <dir> writes both unit files; copy them to /etc/systemd/system/");
    steps.push(`put GITHUB_TOKEN=\u2026 in /etc/cronlag/${name}.env ${c("dim", "(root only, chmod 600)")}`);
    steps.push(`sudo systemctl daemon-reload && sudo systemctl enable --now ${name}.timer`);
  } else {
    steps.push(`put \`export GITHUB_TOKEN=\u2026\` in ~/.config/cronlag/${name}.env ${c("dim", "(chmod 600)")}`);
    steps.push(`crontab -e and paste the lines${o.wrote ? ` from ${o.wrote[0]}` : ""}`);
  }
  steps.forEach((st, i) => L.push(`  ${i ? "     " : c("bold", "next:")} ${st}`));
  return L.join("\n");
}
function isEntryPoint() {
  const arg = process.argv[1];
  if (!arg) return false;
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const norm = (p) => process.platform === "win32" ? p.toLowerCase() : p;
  return norm(real(fileURLToPath(import.meta.url))) === norm(real(resolvePath(arg)));
}
var HELP, SHORT, BOOL, VALUED, UsageError, isDirect;
var init_cli = __esm({
  "src/cli.ts"() {
    "use strict";
    init_analyze();
    init_collect();
    init_catchup();
    init_cron();
    init_format();
    init_org();
    init_github();
    init_mcp();
    init_token();
    init_version();
    init_cache();
    init_window();
    init_workflow();
    init_worker();
    HELP = `cronlag ${VERSION} \u2014 is your scheduled GitHub Actions workflow late, dropped, or broken?

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
    SHORT = { t: "target", o: "out", s: "since", d: "days", w: "workflow", f: "format", h: "help", v: "version", n: "count" };
    BOOL = /* @__PURE__ */ new Set(["help", "version", "no-color", "no-cache", "dispatch", "lite", "json"]);
    VALUED = /* @__PURE__ */ new Set(["days", "since", "workflow", "format", "count", "fail-on", "late", "on-time", "token", "grace", "tz", "cron", "org", "target", "every", "out", "bin"]);
    UsageError = class extends Error {
    };
    isDirect = isEntryPoint();
    if (isDirect) {
      main(process.argv.slice(2)).then(
        (code) => {
          process.exitCode = code;
        },
        (e) => {
          if (e instanceof UsageError) {
            console.error(`cronlag: ${e.message}
Run \`cronlag --help\` for usage.`);
            process.exitCode = 2;
          } else if (e instanceof GitHubError) {
            console.error(`cronlag: ${e.message}`);
            process.exitCode = 3;
          } else {
            console.error(e);
            process.exitCode = 3;
          }
        }
      );
    }
  }
});

// src/action.ts
init_analyze();
init_collect();
init_format();
init_github();
init_window();
import { appendFileSync as appendFileSync2 } from "node:fs";
var input = (k, d = "") => (process.env[`INPUT_${k.replace(/ /g, "_").toUpperCase()}`] ?? d).trim() || d;
var setOut = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync2(process.env.GITHUB_OUTPUT, `${k}=${v}
`);
async function main2() {
  const mode = input("mode", "report");
  const token = input("token") || process.env.GITHUB_TOKEN || "";
  if (mode === "guard") {
    process.env.GITHUB_TOKEN = token;
    process.argv = [process.argv[0], process.argv[1], "guard"];
    await Promise.resolve().then(() => (init_cli(), cli_exports));
    return;
  }
  const repo = input("repo") || process.env.GITHUB_REPOSITORY || "";
  const since = input("since");
  const win = resolveWindow(since ? { since } : { days: input("days", "7") });
  const wf = input("workflow");
  const failOn = input("fail-on", "never");
  const gh = new GitHub({ token: token || void 0, userAgent: "cronlag-action" });
  const snap = await collect(gh, repo, { from: win.from, workflows: wf ? wf.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : void 0 });
  const r = analyze(snap);
  console.log(formatText(r, { color: true, width: 110 }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync2(process.env.GITHUB_STEP_SUMMARY, formatMarkdown(r) + "\n");
  const worst = r.workflows[0];
  setOut("verdict", r.verdict);
  setOut("missed", String(r.workflows.reduce((n, w) => n + w.stats.missed, 0)));
  setOut("median-lag-minutes", worst?.stats.lagMedian != null ? String(Math.round(worst.stats.lagMedian / MIN)) : "");
  setOut("json", JSON.stringify({ verdict: r.verdict, workflows: r.workflows.map((w) => ({ file: w.file, verdict: w.verdict, missed: w.stats.missed, medianLag: fmtDur(w.stats.lagMedian) })) }));
  const bad = failOn === "late" ? ["LATE", "DROPPING", "NOT FIRING", "DISABLED", "INVALID"] : failOn === "dropped" ? ["DROPPING", "NOT FIRING", "DISABLED", "INVALID"] : [];
  const hit = r.workflows.filter((w) => bad.includes(w.verdict));
  if (hit.length) {
    for (const w of hit) console.log(`::error title=cronlag ${w.verdict}::${w.file}: ${w.headline}`);
    process.exitCode = 1;
  }
}
main2().catch((e) => {
  console.log(`::error title=cronlag::${e.message}`);
  process.exitCode = 1;
});
