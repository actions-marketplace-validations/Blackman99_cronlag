import { DEFAULTS, MIN, planCatchup, type CatchupStep, type Thresholds } from "./analyze.js";
import { collect } from "./collect.js";
import type { GitHub } from "./github.js";

export interface CatchupOptions {
  /** match by file name, path, name or id (same as -w) */
  workflows?: string[];
  /** a slot must be this old before it counts as missed (default 15 min) */
  graceMs?: number;
  /** actually call workflow_dispatch for the steps that need it */
  dispatch?: boolean;
  /** evaluation time (ms); default Date.now() */
  now?: number;
  thresholds?: Thresholds;
}

export interface CatchupStepResult extends CatchupStep {
  /** set when --dispatch was asked for and the dispatch call failed */
  error?: string;
}

export interface CatchupResult {
  repo: string;
  dispatched: boolean;
  steps: CatchupStepResult[];
}

/**
 * One catch-up pass: read the latest due slot of every scheduled workflow straight from the API
 * (never cached), and dispatch the ones with no run after the grace period. Shared by
 * `cronlag catchup` and the Cloudflare Worker printed by `cronlag worker`, so both decide alike.
 * A failed dispatch is recorded on its step and the remaining workflows still get their turn.
 */
export async function runCatchup(gh: GitHub, repo: string, o: CatchupOptions = {}): Promise<CatchupResult> {
  const snap = await collect(gh, repo, { days: 2, now: o.now, workflows: o.workflows, lite: true });
  const steps: CatchupStepResult[] = planCatchup(snap, o.graceMs ?? 15 * MIN, o.thresholds ?? DEFAULTS);
  if (o.dispatch) {
    for (const s of steps) {
      if (s.action !== "dispatch") continue;
      try {
        await gh.dispatch(snap.repo.fullName, s.id, snap.repo.defaultBranch);
      } catch (e) {
        s.error = (e as Error).message;
      }
    }
  }
  return { repo: snap.repo.fullName, dispatched: !!o.dispatch, steps };
}
