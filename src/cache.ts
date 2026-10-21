// On-disk cache of settled days of workflow runs (Node only; the browser bundle never imports this).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Run, RunCache } from "./github.js";

const SCHEMA = 1;

/** $CRONLAG_CACHE_DIR, else $XDG_CACHE_HOME/cronlag, else the platform's user cache dir. */
export function defaultCacheDir(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.CRONLAG_CACHE_DIR) return env.CRONLAG_CACHE_DIR;
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, "cronlag");
  const home = homedir();
  if (platform === "darwin") return join(home, "Library", "Caches", "cronlag");
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "cronlag", "Cache");
  return join(home, ".cache", "cronlag");
}

/** Shorten the home directory to ~ for messages. */
export function tildify(p: string): string {
  const home = homedir();
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

const safe = (part: string) => part.replace(/[^\w.@-]+/g, "_");

/**
 * One small JSON file per repo + workflow + event + UTC day:
 *   <dir>/runs/v1/<api host>/<owner>/<repo>/<workflow id>/<event>/<YYYY-MM-DD>.json
 * Only days that ended more than 6h ago with every run completed are written (see GitHub.runsWindow),
 * so a cached day never needs refetching. Delete the directory to clear it; nothing else reads it.
 */
export class DiskRunCache implements RunCache {
  readonly location: string;
  constructor(private dir: string = defaultCacheDir()) {
    this.location = tildify(dir);
  }

  private path(key: string): string {
    return join(this.dir, "runs", `v${SCHEMA}`, ...key.split("/").map(safe)) + ".json";
  }

  async get(key: string): Promise<Run[] | undefined> {
    try {
      const data = JSON.parse(await readFile(this.path(key), "utf8"));
      if (data?.v !== SCHEMA || !Array.isArray(data.runs)) return undefined;
      return data.runs as Run[];
    } catch {
      return undefined;
    }
  }

  async set(key: string, runs: Run[]): Promise<void> {
    const file = this.path(key);
    try {
      await mkdir(join(file, ".."), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ v: SCHEMA, key, runs }), { mode: 0o600 });
      await rename(tmp, file);
    } catch {
      /* read-only or full disk: the cache is an optimisation, never an error */
    }
  }
}
