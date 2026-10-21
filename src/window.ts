// Report window: `--days <n>` or `--since <date | relative>`. No Node APIs (shared with the browser bundle).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Longest window cronlag will scan. A year of an hourly schedule is ~90 API pages on the first run. */
export const MAX_WINDOW_DAYS = 400;
export const DEFAULT_WINDOW_DAYS = 7;

export class WindowError extends Error {}

const iso16 = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/**
 * Parse `--since`: a UTC date `2026-09-01`, a date-time `2026-09-01T06:00Z` / `2026-09-01T06:00+02:00`
 * (no zone = UTC, like every time cronlag prints), or relative `36h`, `30d`, `6w`.
 * Returns the window start in ms.
 */
export function parseSince(input: string, now = Date.now()): number {
  const s = input.trim();
  const rel = s.match(/^(\d+(?:\.\d+)?)\s*(h|hours?|d|days?|w|weeks?)$/i);
  let from: number;
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2][0].toLowerCase();
    from = now - n * (u === "h" ? HOUR : u === "w" ? 7 * DAY : DAY);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    from = Date.parse(`${s}T00:00:00Z`);
    if (!Number.isFinite(from) || new Date(from).toISOString().slice(0, 10) !== s) throw new WindowError(`--since ${s} is not a real calendar date`);
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.test(s)) {
    const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
    from = Date.parse(s.replace(" ", "T") + (zoned ? "" : "Z"));
    if (!Number.isFinite(from)) throw new WindowError(`--since ${s} is not a valid date-time`);
  } else if (/^\d+\s*(m|min|mins|minutes?)$/i.test(s)) {
    throw new WindowError(`--since ${s}: the shortest window is 1h — use hours, days or weeks (36h, 30d, 6w)`);
  } else {
    throw new WindowError(`--since "${s}" is not a date — use 2026-09-01, 2026-09-01T06:00Z, or a relative 36h / 30d / 6w`);
  }
  if (from > now) throw new WindowError(`--since ${iso16(from)} UTC is in the future`);
  const span = now - from;
  if (span < HOUR) throw new WindowError(`--since ${s} is less than an hour ago; the shortest window is 1h`);
  // A calendar date may sit a few hours past the cap (it starts at 00:00 UTC); a relative window may not.
  if (span > MAX_WINDOW_DAYS * DAY + (rel ? 0 : DAY)) {
    throw new WindowError(`--since ${s} is ${Math.floor(span / DAY)} days back; the longest window is ${MAX_WINDOW_DAYS} days (try --since ${MAX_WINDOW_DAYS}d)`);
  }
  return Math.max(from, now - (MAX_WINDOW_DAYS + 1) * DAY);
}

/** Validate `--days`. */
export function parseDays(input: string | number): number {
  const n = typeof input === "number" ? input : Number(String(input).trim());
  if (!Number.isFinite(n) || n <= 0) throw new WindowError(`--days ${input} is not a positive number of days`);
  if (n > MAX_WINDOW_DAYS) throw new WindowError(`--days ${input} is too long; the longest window is ${MAX_WINDOW_DAYS} days`);
  return n;
}

/** Window start from `days` / `since` (mutually exclusive). */
export function resolveWindow(o: { days?: string | number; since?: string }, now = Date.now()): { from: number; days: number; since: boolean } {
  const hasDays = o.days !== undefined && o.days !== "";
  const hasSince = o.since !== undefined && o.since !== "";
  if (hasDays && hasSince) throw new WindowError("use either --days or --since, not both");
  if (hasSince) {
    const from = parseSince(o.since as string, now);
    return { from, days: (now - from) / DAY, since: true };
  }
  const days = hasDays ? parseDays(o.days as string | number) : DEFAULT_WINDOW_DAYS;
  return { from: now - days * DAY, days, since: false };
}

/** Human label for a window: "last 7 days", "last 36h", or "since 2026-09-01 00:00 (50 days)". */
export function windowLabel(fromIso: string, nowIso: string): string {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  const span = now - from;
  const whole = (unit: number) => Math.abs(span / unit - Math.round(span / unit)) < 1e-6;
  if (span < 2 * DAY && whole(HOUR)) return `last ${Math.round(span / HOUR)}h`;
  if (whole(DAY)) {
    const d = Math.round(span / DAY);
    return `last ${d} day${d === 1 ? "" : "s"}`;
  }
  const days = span / DAY;
  return `since ${iso16(from)} (${days < 10 ? days.toFixed(1) : Math.round(days)} days)`;
}
