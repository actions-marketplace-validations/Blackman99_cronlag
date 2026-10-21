import { DAY, type Snapshot, type WorkflowInput } from "./analyze.js";
import { GitHub } from "./github.js";
import { readTriggers, type ScheduleEntry } from "./workflow.js";

const key = (s: ScheduleEntry[]) => s.map((x) => `${x.cron}@${x.timezone}`).sort().join("|");

export interface CollectOptions {
  /** window length in days (default 7); ignored when `from` is set */
  days?: number;
  /** window start (ms), e.g. from `--since` */
  from?: number;
  now?: number;
  /** match by file name, path, name or id */
  workflows?: string[];
  /** skip the per-workflow "last changed" commit lookup (saves API calls) */
  lite?: boolean;
  onProgress?: (msg: string) => void;
}

export function matchesFilter(w: { id: number; name: string; path: string }, filters?: string[]): boolean {
  if (!filters || !filters.length) return true;
  const file = w.path.split("/").pop() ?? "";
  return filters.some((f) => f === String(w.id) || f === w.name || f === w.path || f === file || f === file.replace(/\.ya?ml$/, ""));
}

export async function collect(gh: GitHub, fullName: string, o: CollectOptions = {}): Promise<Snapshot> {
  const now = o.now ?? Date.now();
  const from = o.from ?? now - (o.days ?? 7) * DAY;
  const repo = await gh.repo(fullName);
  o.onProgress?.(`${repo.fullName}: listing workflows`);
  const all = (await gh.workflows(repo.fullName)).filter((w) => matchesFilter(w, o.workflows));
  const out: WorkflowInput[] = [];
  const unscheduled: string[] = [];
  // Only workflow files that live in .github/workflows (dynamic ones like Pages/Dependabot have no file).
  const files = all.filter((w) => w.path.startsWith(".github/workflows/"));
  const texts = await Promise.all(
    files.map(async (w) => {
      try {
        return await gh.file(repo.fullName, w.path, repo.defaultBranch);
      } catch {
        return null;
      }
    }),
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
      o.lite ? Promise.resolve(null) : gh.fileHistory(repo.fullName, w.path, repo.defaultBranch).catch(() => null),
    ]);
    let timeline: WorkflowInput["timeline"];
    if (history && history.length) {
      // Versions that were live during the window: every commit inside it, plus the one before it.
      const asc = [...history].sort((a, b) => a.date - b.date);
      const startIdx = Math.max(0, asc.findIndex((c) => c.date >= from - DAY) - 1);
      const relevant = asc.findIndex((c) => c.date >= from - DAY) === -1 ? asc.slice(-1) : asc.slice(startIdx);
      const head = relevant[relevant.length - 1];
      timeline = await Promise.all(
        relevant.map(async (c) => {
          const t = c === head ? trig : readTriggers(await gh.file(repo.fullName, w.path, c.sha).catch(() => ""));
          return { since: c.date, sha: c.sha, schedules: t.schedules };
        }),
      );
      // Only keep points where the schedule actually changed.
      timeline = timeline.filter((seg, i, arr) => i === 0 || key(seg.schedules) !== key(arr[i - 1].schedules));
    }
    out.push({
      ...w,
      schedules: trig.schedules,
      hasDispatch: trig.hasDispatch,
      parseError: trig.parseError,
      fileChangedAt: history?.[0]?.date ?? null,
      timeline,
      scheduleRuns,
      dispatchRuns,
    });
  }
  return { repo, from, now, workflows: out, unscheduled };
}
