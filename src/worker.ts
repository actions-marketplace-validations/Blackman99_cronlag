// `cronlag worker`: print a ready-made external scheduler that runs one `cronlag catchup --dispatch`
// pass every few minutes — a Cloudflare Worker (cron trigger), a systemd timer + service, or a crontab line.
import { firesBetween, type Cron } from "./cron.js";
import { HOUR, MIN } from "./analyze.js";
import { matchesFilter } from "./collect.js";
import type { GitHub } from "./github.js";
import { readTriggers } from "./workflow.js";
import { VERSION } from "./version.js";
import { ENGINE } from "./worker/engine.generated.js";

export const TARGETS = ["cloudflare", "systemd", "crontab"] as const;
export type Target = (typeof TARGETS)[number];
export const DEFAULT_BIN = "npx -y github:Blackman99/cronlag#v0";
const DOCS = "https://blackman99.github.io/cronlag/docs/usage.html";

export class WorkerSpecError extends Error {}

/** A scheduler tick: cron (Cloudflare, crontab) and systemd OnCalendar for the same instants, off minute 0. */
export interface Tick {
  ms: number;
  label: string;
  cron: string;
  onCalendar: string;
}

const OFFSET = 4; // :04, :14, … — never minute 0, and a few minutes past slots on round minutes

export function tickFor(everyMs: number): Tick {
  const m = everyMs / MIN;
  const label = fmtEvery(everyMs);
  if (Number.isInteger(m) && m >= 5 && m < 60 && 60 % m === 0) {
    const mins: number[] = [];
    for (let x = OFFSET % m; x < 60; x += m) mins.push(x);
    return { ms: everyMs, label, cron: `${mins.join(",")} * * * *`, onCalendar: `*-*-* *:${pad(OFFSET % m)}/${m}:00 UTC` };
  }
  const h = everyMs / HOUR;
  if (Number.isInteger(h) && h >= 1 && h <= 12 && 24 % h === 0) {
    return h === 1
      ? { ms: everyMs, label, cron: `${OFFSET} * * * *`, onCalendar: `*-*-* *:${pad(OFFSET)}:00 UTC` }
      : { ms: everyMs, label, cron: `${OFFSET} */${h} * * *`, onCalendar: `*-*-* 00/${h}:${pad(OFFSET)}:00 UTC` };
  }
  if (everyMs < 5 * MIN) {
    throw new WorkerSpecError(`--every ${label} is too often: catch-up only acts on a slot older than --grace, so 5m is the useful minimum`);
  }
  throw new WorkerSpecError(`--every ${label} doesn't divide an hour or a day evenly; use 5m, 10m, 15m, 20m, 30m, 1h, 2h, 3h, 4h, 6h or 12h`);
}

function human(ms: number): string {
  const h = ms / HOUR;
  if (Number.isInteger(h)) return h === 1 ? "hour" : `${h} hours`;
  return `${Math.round(ms / MIN)} minutes`;
}

const pad = (n: number) => String(n).padStart(2, "0");
function fmtEvery(ms: number): string {
  if (ms % HOUR === 0) return `${ms / HOUR}h`;
  if (ms % MIN === 0) return `${ms / MIN}m`;
  return `${Math.round(ms / 1000)}s`;
}

export interface WorkerWorkflow {
  file: string;
  path: string;
  name: string;
  id: number;
  state: string;
  schedules: { cron: string; timezone: string }[];
  hasDispatch: boolean;
  /** the file has a `uses: Blackman99/cronlag@…` step with `mode: guard` */
  guarded: boolean;
  /** shortest gap between this workflow's slots (ms), across all its cron lines */
  minIntervalMs: number | null;
}

export interface WorkerSpec {
  repo: string;
  target: Target;
  /** workflow files catch-up will consider (always explicit, so a workflow added later never gets dispatched by surprise) */
  workflows: WorkerWorkflow[];
  graceMs: number;
  tick: Tick;
  /** command that runs cronlag (systemd/crontab) */
  bin: string;
  /** ISO date the recipe was generated */
  generated: string;
}

export interface Selection {
  /** selected: scheduled, with workflow_dispatch */
  workflows: WorkerWorkflow[];
  /** scheduled but cannot be caught up (no workflow_dispatch) */
  noDispatch: WorkerWorkflow[];
}

const GUARD_USES = /uses:\s*["']?blackman99\/cronlag@/i;
// cronlag's own repo (and forks of it) use the action from the checkout.
const LOCAL_USES = /uses:\s*["']?\.\/?["']?\s*$/m;
const GUARD_MODE = /mode:\s*["']?guard\b/;

/** Read the repo's scheduled workflows (live, from the default branch) and pick the ones catch-up can run. */
export async function selectWorkflows(gh: GitHub, repo: string, filters?: string[]): Promise<Selection & { repo: string }> {
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
  const out: Selection = { workflows: [], noDispatch: [] };
  picked.forEach((w, i) => {
    const text = texts[i];
    if (text === null) return;
    const t = readTriggers(text);
    const valid = t.schedules.filter((s) => s.parsed);
    if (!valid.length) {
      if (filters?.length) throw new WorkerSpecError(`${w.path.split("/").pop()} has no valid on: schedule cron, so there is nothing to catch up`);
      return;
    }
    const gap = shortestGap(valid.map((s) => s.parsed as Cron), Date.now());
    const ww: WorkerWorkflow = {
      file: w.path.split("/").pop() ?? w.path,
      path: w.path,
      name: w.name,
      id: w.id,
      state: w.state,
      schedules: valid.map((s) => ({ cron: s.cron, timezone: s.timezone })),
      hasDispatch: t.hasDispatch,
      guarded: (GUARD_USES.test(text) || LOCAL_USES.test(text)) && GUARD_MODE.test(text),
      minIntervalMs: gap,
    };
    (t.hasDispatch ? out.workflows : out.noDispatch).push(ww);
  });
  return { repo: info.fullName, ...out };
}

/** Shortest gap between consecutive slots of all of a workflow's cron lines together (ms), or null. */
function shortestGap(crons: Cron[], at: number): number | null {
  const all = [...new Set(crons.flatMap((c) => firesBetween(c, at, at + 8 * 864e5, 5000)))].sort((a, b) => a - b);
  if (all.length < 2) return null;
  let best = Infinity;
  for (let i = 1; i < all.length; i++) best = Math.min(best, all[i] - all[i - 1]);
  return best;
}

// ---------- rendering

export interface RenderedFile {
  name: string;
  text: string;
}

export function slug(repo: string): string {
  const s = `cronlag-catchup-${repo.replace("/", "-")}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-$/, "");
  return s.slice(0, 63).replace(/-$/, "");
}

/** The `cronlag catchup` invocation the timer/crontab runs (no token: that comes from the environment). */
export function catchupArgs(spec: WorkerSpec): string[] {
  const a = ["catchup", spec.repo];
  for (const w of spec.workflows) a.push("-w", w.file);
  a.push("--grace", fmtEvery(spec.graceMs), "--dispatch");
  return a;
}

const shq = (s: string) => (/^[\w@%+=:,./#-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
// systemd: quote words with spaces; `%` is a specifier, `$` an expansion.
const sdq = (s: string) => {
  const e = s.replace(/%/g, "%%").replace(/\$/g, "$$$$");
  return /^[\w@%+=:,./#-]+$/.test(e) ? e : `"${e.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

function workflowLines(spec: WorkerSpec, prefix: string): string[] {
  const crons = (x: WorkerWorkflow) => x.schedules.map((s) => s.cron + (s.timezone !== "UTC" ? ` (${s.timezone})` : "")).join(" · ");
  const fw = Math.max(...spec.workflows.map((x) => x.file.length));
  const cw = Math.max(...spec.workflows.map((x) => crons(x).length));
  return spec.workflows.map((x) => `${prefix}   ${x.file.padEnd(fw)}  ${x.guarded ? crons(x) : `${crons(x).padEnd(cw)}   ← no mode: guard step yet`}`.trimEnd());
}

function semantics(spec: WorkerSpec, p: string): string[] {
  return [
    `${p}Every ${human(spec.tick.ms)}, one \`cronlag catchup --dispatch\` pass: for each workflow below, take the latest`,
    `${p}cron slot that is at least ${fmtEvery(spec.graceMs)} old (and under 24h old). If neither a scheduled run nor a`,
    `${p}workflow_dispatch run was created after it, start the workflow once via workflow_dispatch on the`,
    `${p}default branch. The next pass sees that run and leaves the slot alone: a slot is dispatched at most once.`,
    `${p}Add \`mode: guard\` to each workflow so GitHub's own late run skips itself: ${DOCS}#guard`,
  ];
}

export function renderCloudflare(spec: WorkerSpec): RenderedFile[] {
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
    `# DRY_RUN = "1"`,
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
    `// Deploy with wrangler — save this file as worker.js, and next to it wrangler.toml:`,
    ...toml.map((l) => (l ? `//     ${l}` : "//")),
    `//   then:`,
    `//     wrangler secret put GITHUB_TOKEN   # fine-grained token: only ${spec.repo}, Actions: read and write`,
    `//     wrangler deploy                    # wrangler tail  shows each pass`,
    `// Or in the dashboard: Workers & Pages → Create → Hello World → Edit code, paste this file and deploy;`,
    `// then Settings → Trigger events → Cron "${spec.tick.cron}", and Settings → Variables and Secrets → secret GITHUB_TOKEN.`,
    `//`,
    `// The token is read from the GITHUB_TOKEN secret at run time and is never written into this file.`,
    `// Each pass makes about ${2 + 3 * spec.workflows.length} GitHub API calls (2 + 3 per workflow) and uses a few ms of CPU:`,
    `// a handful of workflows fits the Workers free plan (50 subrequests, 10 ms CPU per run).`,
    `// Below the handler is cronlag's own catch-up code (workflow reader, GitHub cron expansion, slot`,
    `// attribution, planCatchup), bundled from cronlag ${VERSION} — the code \`cronlag catchup\` runs.`,
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
    ``,
  ];
  return [
    { name: "worker.js", text: head.join("\n") },
    { name: "wrangler.toml", text: toml.join("\n") + "\n" },
  ];
}

export function renderSystemd(spec: WorkerSpec): RenderedFile[] {
  const name = slug(spec.repo);
  const env = `/etc/cronlag/${name}.env`;
  const bin = splitBin(spec.bin);
  // ExecStart wants an absolute path; /usr/bin/env looks the command up on the PATH set below.
  const cmd = [...(bin[0]?.startsWith("/") ? [] : ["/usr/bin/env"]), ...bin, ...catchupArgs(spec)].map(sdq).join(" ");
  const common = (title: string) => [
    `# ${title}`,
    `# Generated by \`cronlag worker --target systemd\` (cronlag ${VERSION}) on ${spec.generated}.`,
    `#`,
    ...semantics(spec, "# "),
    `#`,
    `# Workflows (re-run \`cronlag worker\` if you add one or change a cron line):`,
    ...workflowLines(spec, "#"),
    `#`,
  ];
  const service = [
    ...common(`${name}.service — one catch-up pass for ${spec.repo}`),
    `# Token: ${env}, readable by root only (systemd reads it, the service never prints it):`,
    `#     GITHUB_TOKEN=github_pat_…        # fine-grained: only ${spec.repo}, Actions: read and write`,
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
    ``,
  ];
  const timer = [
    ...common(`${name}.timer — runs ${name}.service every ${spec.tick.label}`),
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
    ``,
  ];
  return [
    { name: `${name}.service`, text: service.join("\n") },
    { name: `${name}.timer`, text: timer.join("\n") },
  ];
}

export function renderCrontab(spec: WorkerSpec): RenderedFile[] {
  const name = slug(spec.repo);
  const env = `$HOME/.config/cronlag/${name}.env`;
  // `%` ends the command in crontab: escape it.
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
    `#     export GITHUB_TOKEN=github_pat_…   # fine-grained: only ${spec.repo}, Actions: read and write`,
    `# Install: crontab -e and paste these lines. cron's PATH is minimal: if \`command -v npx\` is not in`,
    `# /usr/local/bin or /usr/bin, change the PATH line. Dry run first: drop --dispatch from the end.`,
    `PATH=/usr/local/bin:/usr/bin:/bin`,
    `${spec.tick.cron}  . "${env}" && NO_COLOR=1 ${cmd} >> "$HOME/cronlag-catchup.log" 2>&1`,
    ``,
  ];
  return [{ name: "crontab", text: lines.join("\n") }];
}

function splitBin(bin: string): string[] {
  return bin.trim().split(/\s+/).filter(Boolean);
}

export function render(spec: WorkerSpec): RenderedFile[] {
  if (!spec.workflows.length) throw new WorkerSpecError("no workflows to catch up");
  return spec.target === "cloudflare" ? renderCloudflare(spec) : spec.target === "systemd" ? renderSystemd(spec) : renderCrontab(spec);
}

/** Notes for stderr: what to fix in the repo for the recipe to do its job. */
export function notes(spec: WorkerSpec, sel: Selection): { level: "warn" | "info"; text: string }[] {
  const out: { level: "warn" | "info"; text: string }[] = [];
  const list = (xs: WorkerWorkflow[]) => xs.map((w) => w.file).join(", ");
  const unguarded = spec.workflows.filter((w) => !w.guarded);
  if (unguarded.length) {
    const who =
      unguarded.length === 1 ? `${unguarded[0].file} has no` : unguarded.length === spec.workflows.length ? "none of these workflows has a" : `${list(unguarded)} have no`;
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
