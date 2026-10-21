// GitHub Action entry (runs.using: node24). Modes: report | guard.
import { appendFileSync } from "node:fs";
import { analyze, fmtDur, MIN } from "./analyze.js";
import { collect } from "./collect.js";
import { formatMarkdown, formatText } from "./format.js";
import { GitHub } from "./github.js";
import { resolveWindow } from "./window.js";

const input = (k: string, d = "") => (process.env[`INPUT_${k.replace(/ /g, "_").toUpperCase()}`] ?? d).trim() || d;
const setOut = (k: string, v: string) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);

async function main() {
  const mode = input("mode", "report");
  const token = input("token") || process.env.GITHUB_TOKEN || "";
  if (mode === "guard") {
    // Reuse the CLI's guard implementation.
    process.env.GITHUB_TOKEN = token;
    process.argv = [process.argv[0], process.argv[1], "guard"];
    await import("./cli.js");
    return;
  }
  const repo = input("repo") || process.env.GITHUB_REPOSITORY || "";
  // `since` wins over `days` (days has a default, so "both set" can't be told apart from "since only").
  const since = input("since");
  const win = resolveWindow(since ? { since } : { days: input("days", "7") });
  const wf = input("workflow");
  const failOn = input("fail-on", "never");
  const gh = new GitHub({ token: token || undefined, userAgent: "cronlag-action" });
  const snap = await collect(gh, repo, { from: win.from, workflows: wf ? wf.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : undefined });
  const r = analyze(snap);
  console.log(formatText(r, { color: true, width: 110 }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatMarkdown(r) + "\n");
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

main().catch((e) => {
  console.log(`::error title=cronlag::${(e as Error).message}`);
  process.exitCode = 1;
});
