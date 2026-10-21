import { analyze, DAY, VERDICT_RANK, type Report, type Thresholds } from "./analyze.js";
import { collect } from "./collect.js";
import { MAX_WINDOW_DAYS } from "./window.js";
import { GitHub, GitHubError, type OrgRepoListItem } from "./github.js";

export interface OrgWorkflowSummary {
  file: string;
  name: string;
  verdict: string;
  headline: string;
  lagMedian: number | null;
  lagP90: number | null;
  lagMax: number | null;
  missed: number;
  overdue: number;
  due: number;
  ran: number;
  within1h: number;
}

export interface OrgRepoSummary {
  repo: string;
  repoUrl: string;
  private: boolean;
  fork: boolean;
  verdict: Report["verdict"];
  workflowCount: number;
  worst?: OrgWorkflowSummary;
  workflows: OrgWorkflowSummary[];
  /** Full per-repo report when available (omitted on error). */
  report?: Report;
  error?: string;
}

export interface OrgReport {
  org: string;
  from: string;
  now: string;
  days: number;
  scanned: number;
  withSchedules: number;
  skippedArchived: number;
  errors: number;
  repos: OrgRepoSummary[];
}

export interface ScanOrgOptions {
  days?: number;
  /** window start (ms), e.g. from `--since`; overrides days */
  from?: number;
  now?: number;
  workflows?: string[];
  thresholds?: Thresholds;
  /** Concurrent repo scans (default 2). */
  concurrency?: number;
  /** Skip archived repos (default true). */
  skipArchived?: boolean;
  onProgress?: (msg: string) => void;
}

function summarizeWorkflow(w: Report["workflows"][number]): OrgWorkflowSummary {
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
    within1h: s.within1h,
  };
}

export function sortOrgRepos(repos: OrgRepoSummary[]): OrgRepoSummary[] {
  return [...repos].sort(
    (a, b) =>
      (VERDICT_RANK[b.verdict] ?? 0) - (VERDICT_RANK[a.verdict] ?? 0) ||
      (b.worst?.missed ?? 0) - (a.worst?.missed ?? 0) ||
      (b.worst?.lagMedian ?? 0) - (a.worst?.lagMedian ?? 0) ||
      a.repo.localeCompare(b.repo),
  );
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** Scan every non-archived repo in an org that has `on: schedule` workflows. Worst first. */
export async function scanOrg(gh: GitHub, org: string, o: ScanOrgOptions = {}): Promise<OrgReport> {
  const now = o.now ?? Date.now();
  const from = o.from ?? now - Math.min(MAX_WINDOW_DAYS, Math.max(1 / 24, o.days ?? 7)) * DAY;
  const days = Math.round((now - from) / DAY);
  const skipArchived = o.skipArchived !== false;
  const concurrency = o.concurrency ?? 2;

  o.onProgress?.(`listing repos for ${org}`);
  // Fetch including archived so we can report how many we skipped; filter after.
  const all = await gh.orgRepos(org, { includeArchived: true });
  const skippedArchived = all.filter((r) => r.archived).length;
  const targets: OrgRepoListItem[] = skipArchived ? all.filter((r) => !r.archived) : all;

  const scanned = targets.length;
  const summaries: OrgRepoSummary[] = [];
  let errors = 0;

  await mapPool(targets, concurrency, async (repo, i) => {
    o.onProgress?.(`scanning ${i + 1}/${targets.length} ${repo.fullName}`);
    try {
      const snap = await collect(gh, repo.fullName, {
        from,
        now,
        workflows: o.workflows,
        lite: true,
      });
      if (!snap.workflows.length) return; // no schedules — omit from summary
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
        report,
      });
    } catch (e) {
      errors++;
      const msg = e instanceof GitHubError ? e.message : e instanceof Error ? e.message : String(e);
      // 404 on Actions (disabled) or empty — treat as skip unless it's a hard failure
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
        error: msg,
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
    repos,
  };
}

export function exitForOrg(r: OrgReport, failOn: string): number {
  if (failOn === "never") return 0;
  const bad =
    failOn === "late"
      ? ["LATE", "DROPPING", "NOT FIRING", "DISABLED", "INVALID"]
      : ["DROPPING", "NOT FIRING", "DISABLED", "INVALID"];
  return r.repos.some((repo) => bad.includes(repo.verdict)) ? 1 : 0;
}
