// Tiny GitHub REST client on global fetch: works in Node >= 18 and in browsers.

export interface Run {
  id: number;
  number: number;
  event: string;
  status: string;
  conclusion: string | null;
  created: number;
  started: number | null;
  url: string;
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  pushedAt: number;
  url: string;
}

export interface WorkflowInfo {
  id: number;
  name: string;
  path: string;
  state: string;
  url: string;
  /** when GitHub first registered this workflow (ms); no slot can fire before it */
  created?: number | null;
}

export class GitHubError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

/**
 * Storage for settled days of workflow runs (one entry per repo + workflow + event + UTC day).
 * Run creation times never change, so a UTC day that ended a while ago and whose runs are all
 * completed will not gain or change runs: it is safe to keep. The Node CLI uses an on-disk cache
 * (src/cache.ts); the browser bundle and the Action run without one.
 */
export interface RunCache {
  get(key: string): Promise<Run[] | undefined>;
  set(key: string, runs: Run[]): Promise<void>;
  /** where it lives, for messages */
  location?: string;
}

/** A day counts as settled (cacheable) this long after it ends: late-created scheduled runs and queued runs land first. */
export const SETTLE_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
/** The runs endpoint returns at most 1000 results for a filtered query. */
const QUERY_CAP = 1000;

export interface RunFetchStats {
  /** API pages of runs fetched */
  pages: number;
  /** UTC days served from the cache */
  cachedDays: number;
  /** UTC days in the requested windows */
  days: number;
  /** a day had more runs than one query can return; some runs may be missing */
  truncated: boolean;
}

export interface ClientOptions {
  cache?: RunCache;
  token?: string;
  apiBase?: string;
  rawBase?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

export class GitHub {
  private token?: string;
  private api: string;
  private raw: string;
  private f: typeof fetch;
  private ua?: string;
  private cache?: RunCache;
  calls = 0;
  runStats: RunFetchStats = { pages: 0, cachedDays: 0, days: 0, truncated: false };

  constructor(o: ClientOptions = {}) {
    this.token = o.token || undefined;
    this.api = (o.apiBase ?? "https://api.github.com").replace(/\/$/, "");
    this.raw = (o.rawBase ?? "https://raw.githubusercontent.com").replace(/\/$/, "");
    this.f = o.fetch ?? fetch.bind(globalThis);
    this.ua = o.userAgent;
    this.cache = o.cache;
  }

  get cacheLocation(): string | undefined {
    return this.cache?.location;
  }

  get apiHost(): string {
    try {
      return new URL(this.api).host;
    } catch {
      return "api";
    }
  }

  get authenticated(): boolean {
    return !!this.token;
  }

  private headers(accept = "application/vnd.github+json"): Record<string, string> {
    const h: Record<string, string> = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.ua) h["User-Agent"] = this.ua;
    return h;
  }

  async request(path: string, init: { method?: string; body?: unknown; accept?: string } = {}): Promise<Response> {
    this.calls++;
    const res = await this.f(path.startsWith("http") ? path : this.api + path, {
      method: init.method ?? "GET",
      headers: { ...this.headers(init.accept), ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      let msg = "";
      try {
        msg = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        /* ignore */
      }
      if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
        const when = reset ? ` (resets ${new Date(reset).toISOString().slice(11, 16)} UTC)` : "";
        throw new GitHubError(
          `GitHub API rate limit reached${when}. ${this.token ? "" : "Unauthenticated requests get 60/hour — set GITHUB_TOKEN or run `gh auth login`."}`.trim(),
          res.status,
        );
      }
      if (res.status === 404) throw new GitHubError(`not found: ${path.replace(this.api, "")}${this.token ? "" : " (private repo? set GITHUB_TOKEN)"}`, 404);
      throw new GitHubError(`GitHub API ${res.status} on ${path.replace(this.api, "")}: ${msg}`, res.status);
    }
    return res;
  }

  async json<T>(path: string): Promise<T> {
    return (await (await this.request(path)).json()) as T;
  }

  async repo(full: string): Promise<RepoInfo> {
    const r = await this.json<Record<string, any>>(`/repos/${full}`);
    return {
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      fork: !!r.fork,
      archived: !!r.archived,
      private: !!r.private,
      pushedAt: Date.parse(r.pushed_at),
      url: r.html_url,
    };
  }

  async workflows(full: string): Promise<WorkflowInfo[]> {
    const out: WorkflowInfo[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await this.json<{ workflows: Record<string, any>[]; total_count: number }>(
        `/repos/${full}/actions/workflows?per_page=100&page=${page}`,
      );
      for (const w of r.workflows) out.push({ id: w.id, name: w.name, path: w.path, state: w.state, url: w.html_url, created: w.created_at ? Date.parse(w.created_at) : null });
      if (out.length >= r.total_count || r.workflows.length < 100) break;
    }
    return out;
  }

  async file(full: string, path: string, ref: string): Promise<string> {
    if (!this.token) {
      // Public repos: raw.githubusercontent.com is not rate-limited like the API.
      this.calls++;
      const res = await this.f(`${this.raw}/${full}/${encodeURIComponent(ref)}/${path}`);
      if (res.ok) return await res.text();
    }
    const res = await this.request(`/repos/${full}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
      accept: "application/vnd.github.raw+json",
    });
    return await res.text();
  }

  async runs(full: string, workflowId: number, opts: { event?: string; since: number; maxPages?: number }): Promise<Run[]> {
    const out: Run[] = [];
    const since = new Date(opts.since).toISOString().replace(/\.\d{3}Z$/, "Z");
    for (let page = 1; page <= (opts.maxPages ?? 5); page++) {
      const q = new URLSearchParams({ per_page: "100", page: String(page), created: `>=${since}`, exclude_pull_requests: "true" });
      if (opts.event) q.set("event", opts.event);
      const r = await this.json<{ workflow_runs: Record<string, any>[] }>(
        `/repos/${full}/actions/workflows/${workflowId}/runs?${q}`,
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
  async runsWindow(full: string, workflowId: number, opts: { event: string; since: number; now?: number }): Promise<Run[]> {
    const now = opts.now ?? Date.now();
    const first = Math.floor(opts.since / DAY_MS) * DAY_MS;
    const settled = (d: number) => d + DAY_MS <= now - SETTLE_MS;
    const key = (d: number) => `${this.apiHost}/${full.toLowerCase()}/${workflowId}/${opts.event}/${new Date(d).toISOString().slice(0, 10)}`;
    const out: Run[] = [];
    const todo: number[] = [];
    for (let d = first; d < now; d += DAY_MS) {
      this.runStats.days++;
      if (this.cache && settled(d)) {
        const hit = await this.cache.get(key(d)).catch(() => undefined);
        if (hit) {
          this.runStats.cachedDays++;
          out.push(...hit);
          continue;
        }
      }
      todo.push(d);
    }
    // Contiguous runs of uncached days → one range each; the range touching now stays open-ended.
    const ranges: [number, number][] = [];
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
        await this.cache.set(key(d), day).catch(() => undefined);
      }
    }
    const seen = new Set<number>();
    return out
      .filter((r) => r.created >= opts.since && r.created <= now && !seen.has(r.id) && (seen.add(r.id), true))
      .sort((x, y) => x.created - y.created);
  }

  /** Runs created in [a, b) (b open-ended when `open`), splitting at day boundaries past the result cap. */
  private async runsRange(full: string, workflowId: number, event: string, a: number, b: number, open: boolean): Promise<{ runs: Run[]; complete: Set<number> }> {
    const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
    const created = open ? `>=${iso(a)}` : `${iso(a)}..${iso(b - 1000)}`;
    const page = async (n: number) => {
      const q = new URLSearchParams({ per_page: "100", page: String(n), created, event, exclude_pull_requests: "true" });
      this.runStats.pages++;
      return this.json<{ total_count: number; workflow_runs: Record<string, any>[] }>(`/repos/${full}/actions/workflows/${workflowId}/runs?${q}`);
    };
    const days = Math.max(1, Math.ceil((b - a) / DAY_MS));
    const split = async (parts: number) => {
      const bounds: number[] = [];
      for (let i = 0; i < parts; i++) bounds.push(a + Math.floor((days * i) / parts) * DAY_MS);
      bounds.push(b);
      const pieces = await pool(
        bounds.slice(0, -1).map((lo, i) => () => this.runsRange(full, workflowId, event, lo, bounds[i + 1], open && i === parts - 1)),
        3,
      );
      return { runs: pieces.flatMap((p) => p.runs), complete: new Set(pieces.flatMap((p) => [...p.complete])) };
    };
    const p1 = await page(1);
    const total = p1.total_count ?? p1.workflow_runs.length;
    // Over the cap: split straight into pieces of ~800 runs instead of halving level by level.
    if (total >= QUERY_CAP && days > 1) return split(Math.min(days, Math.ceil(total / 800)));
    const runs = p1.workflow_runs.map(toRun);
    const pages = Math.min(Math.ceil(total / 100), QUERY_CAP / 100);
    const rest = await pool(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) => () => page(i + 2)),
      4,
    );
    for (const r of rest) runs.push(...r.workflow_runs.map(toRun));
    // total_count can undercount: keep going while pages come back full.
    let last = rest.length ? rest[rest.length - 1].workflow_runs.length : p1.workflow_runs.length;
    for (let n = Math.max(pages, 1) + 1; last === 100 && n <= QUERY_CAP / 100; n++) {
      const r = await page(n);
      runs.push(...r.workflow_runs.map(toRun));
      last = r.workflow_runs.length;
    }
    // total_count is only an estimate on big repos: a full 1000 results means the cap hit, whatever it said.
    const capped = total >= QUERY_CAP || runs.length >= QUERY_CAP;
    if (capped && days > 1) return split(2);
    const complete = new Set<number>();
    if (!capped) for (let d = a; d < b; d += DAY_MS) complete.add(d);
    else this.runStats.truncated = true;
    return { runs, complete };
  }

  async run(full: string, runId: number): Promise<Run> {
    return toRun(await this.json<Record<string, any>>(`/repos/${full}/actions/runs/${runId}`));
  }

  /** Most recent commits touching `path` on `ref`, newest first. */
  async fileHistory(full: string, path: string, ref: string, n = 20): Promise<{ sha: string; date: number }[]> {
    const r = await this.json<Record<string, any>[]>(
      `/repos/${full}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=${n}`,
    );
    return r
      .map((c) => ({ sha: c.sha as string, date: Date.parse(c.commit?.committer?.date ?? c.commit?.author?.date) }))
      .filter((c) => Number.isFinite(c.date));
  }

  async dispatch(full: string, workflowId: number, ref: string): Promise<void> {
    await this.request(`/repos/${full}/actions/workflows/${workflowId}/dispatches`, { method: "POST", body: { ref } });
  }

  /** Paginated org repos. Includes private repos the token can see; skip archived by default. */
  async orgRepos(org: string, opts: { includeArchived?: boolean } = {}): Promise<OrgRepoListItem[]> {
    const out: OrgRepoListItem[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await this.json<Record<string, any>[]>(
        `/orgs/${encodeURIComponent(org)}/repos?per_page=100&page=${page}&type=all&sort=full_name`,
      );
      for (const x of r) {
        const item: OrgRepoListItem = {
          fullName: x.full_name,
          name: x.name,
          private: !!x.private,
          fork: !!x.fork,
          archived: !!x.archived,
          defaultBranch: x.default_branch,
          url: x.html_url,
          pushedAt: Date.parse(x.pushed_at),
        };
        if (item.archived && !opts.includeArchived) continue;
        out.push(item);
      }
      if (r.length < 100) break;
    }
    return out;
  }
}

export interface OrgRepoListItem {
  fullName: string;
  name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  url: string;
  pushedAt: number;
}

/** Run async tasks with at most `n` in flight; results keep their order. */
async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
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

function toRun(x: Record<string, any>): Run {
  return {
    id: x.id,
    number: x.run_number,
    event: x.event,
    status: x.status,
    conclusion: x.conclusion ?? null,
    created: Date.parse(x.created_at),
    started: x.run_started_at ? Date.parse(x.run_started_at) : null,
    url: x.html_url,
  };
}
