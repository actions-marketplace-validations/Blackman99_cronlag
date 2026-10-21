// Minimal MCP server (JSON-RPC 2.0, newline-delimited over stdio). Read-only tools.
import { createInterface } from "node:readline";
import { analyze, DAY, fmtDur, planCatchup } from "./analyze.js";
import { collect } from "./collect.js";
import { CronError, minInterval, nextFires, parseCron } from "./cron.js";
import { formatMarkdown } from "./format.js";
import type { GitHub } from "./github.js";
import { VERSION } from "./version.js";
import { resolveWindow, WindowError } from "./window.js";

const TOOLS = [
  {
    name: "schedule_report",
    description:
      "Slot-by-slot report for a GitHub repo's scheduled (cron) workflows: which cron slots got a run, how late each run was created, which slots never ran, and likely causes (disabled after 60 days, schedule not registered, minute 0, no workflow_dispatch, runner queueing vs. GitHub scheduler delay). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/repo" },
        days: { type: "number", description: "window in days (default 7, max 400)" },
        since: { type: "string", description: "window start instead of days: UTC date '2026-09-01', date-time '2026-09-01T06:00Z', or relative '36h' / '30d' / '6w'" },
        workflow: { type: "string", description: "optional: only this workflow (file name, path, name or id)" },
      },
      required: ["repo"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "catchup_plan",
    description:
      "For each scheduled workflow, say whether its latest due cron slot (older than the grace period) still has no run, i.e. what `cronlag catchup --dispatch` would dispatch. Read-only: it never dispatches.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/repo" },
        grace_minutes: { type: "number", description: "how long after a slot to wait before calling it missed (default 15)" },
      },
      required: ["repo"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "cron_explain",
    description: "Next fire times (UTC) of a GitHub Actions cron expression, its shortest interval, and whether it uses the busy minute 0. Pure computation, no network.",
    inputSchema: {
      type: "object",
      properties: {
        cron: { type: "string", description: "five-field cron, e.g. '17 */6 * * *'" },
        timezone: { type: "string", description: "IANA timezone (default UTC), as in on.schedule[].timezone" },
        count: { type: "number", description: "how many fire times (default 5, max 50)" },
      },
      required: ["cron"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

type Json = Record<string, any>;

export async function callTool(name: string, args: Json, gh: () => GitHub): Promise<{ text: string; isError?: boolean }> {
  if (name === "cron_explain") {
    try {
      const c = parseCron(String(args.cron ?? ""), args.timezone ? String(args.timezone) : "UTC");
      const n = Math.min(50, Math.max(1, Number(args.count ?? 5)));
      const fires = nextFires(c, Date.now(), n).map((t) => new Date(t).toISOString());
      const gap = minInterval(c, Date.now());
      return {
        text: JSON.stringify({ cron: c.source, timezone: c.timezone, next: fires, shortestInterval: fmtDur(gap), minuteZero: c.minutes.includes(0), belowGitHubMinimum: gap !== null && gap < 5 * 60_000 }, null, 2),
      };
    } catch (e) {
      if (e instanceof CronError) return { text: `invalid cron: ${e.message}`, isError: true };
      throw e;
    }
  }
  const repo = String(args.repo ?? "").replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { text: "repo must be owner/repo", isError: true };
  if (name === "schedule_report") {
    let from: number;
    try {
      from = resolveWindow({ days: args.days ?? undefined, since: args.since ? String(args.since) : undefined }).from;
    } catch (e) {
      if (e instanceof WindowError) return { text: e.message.replace(/--(days|since)/g, "$1"), isError: true };
      throw e;
    }
    const snap = await collect(gh(), repo, { from, workflows: args.workflow ? [String(args.workflow)] : undefined });
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
        recentSlots: w.slots.slice(-12).map((s) => ({ slot: new Date(s.at).toISOString(), status: s.status, lag: fmtDur(s.lagMs), run: s.run?.url })),
      })),
      unscheduled: r.unscheduled,
    };
    return { text: formatMarkdown(r) + "\n\n```json\n" + JSON.stringify(compact, null, 2) + "\n```" };
  }
  if (name === "catchup_plan") {
    const grace = Math.max(1, Number(args.grace_minutes ?? 15)) * 60_000;
    const snap = await collect(gh(), repo, { days: 2, lite: true });
    void DAY;
    return { text: JSON.stringify({ repo: snap.repo.fullName, note: "read-only plan; run `cronlag catchup <repo> --dispatch` yourself to act on it", steps: planCatchup(snap, grace) }, null, 2) };
  }
  return { text: `unknown tool ${name}`, isError: true };
}

export async function runMcp(gh: () => GitHub): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  const send = (m: Json) => process.stdout.write(JSON.stringify(m) + "\n");
  let client: GitHub | null = null;
  const lazy = () => (client ??= gh());
  const pending: Promise<unknown>[] = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }
    const { id, method, params } = msg;
    if (id === undefined || id === null) continue; // notification
    const reply = (result: Json) => send({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
    if (method === "initialize") {
      reply({
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "cronlag", version: VERSION },
        instructions: "Use schedule_report to check whether a repo's scheduled GitHub Actions workflows ran on time, catchup_plan to see which due slots have no run, cron_explain for cron math.",
      });
    } else if (method === "ping") reply({});
    else if (method === "tools/list") reply({ tools: TOOLS });
    else if (method === "tools/call") {
      pending.push(
        callTool(params?.name, params?.arguments ?? {}, lazy).then(
          (r) => reply({ content: [{ type: "text", text: r.text }], isError: !!r.isError }),
          (e) => reply({ content: [{ type: "text", text: `error: ${(e as Error).message}` }], isError: true }),
        ),
      );
    } else fail(-32601, `method not found: ${method}`);
  }
  await Promise.all(pending);
}
