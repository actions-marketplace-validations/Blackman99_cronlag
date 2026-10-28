import { fmtDur, HOUR, type Report, type Slot, type WorkflowReport, type CatchupStep } from "./analyze.js";
import type { OrgReport } from "./org.js";
import { windowLabel } from "./window.js";

export interface TextOptions {
  color: boolean;
  width?: number;
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** One glyph per slot: bar height ~ log(lag); ✕ missed, ? overdue, · pending. */
export function slotGlyph(s: Slot): { ch: string; tone: "green" | "yellow" | "red" | "magenta" | "gray" } {
  switch (s.status) {
    case "missed":
      return { ch: "✕", tone: "magenta" };
    case "overdue":
      return { ch: "?", tone: "magenta" };
    case "pending":
      return { ch: "·", tone: "gray" };
    default: {
      const m = (s.lagMs ?? 0) / 60_000;
      const steps = [2, 10, 30, 60, 180, 360, 720];
      let i = steps.findIndex((x) => m <= x);
      if (i < 0) i = 7;
      return { ch: BARS[i], tone: s.status === "ontime" ? "green" : s.status === "late" ? "yellow" : "red" };
    }
  }
}

const SEVERITY: Record<string, number> = { pending: 0, ontime: 1, late: 2, verylate: 3, overdue: 4, missed: 5 };

/** A strip mark: one slot, or (in a folded strip) the worst of several, flagged when only some of them missed. */
export interface StripMark {
  slot: Slot;
  /** folded mark whose slots were partly missed and partly ran */
  someMissed?: boolean;
}

/**
 * Long windows would print pages of glyphs; past `max` slots, each mark stands for `per`
 * consecutive slots. A mark is ✕ only when every slot in it missed; when some ran and some
 * didn't it is a small x, so a thinned-out schedule doesn't read as "nothing ran". Otherwise it
 * shows the worst lag.
 */
export function compactSlots(slots: Slot[], max: number): { marks: StripMark[]; per: number } {
  if (slots.length <= max) return { marks: slots.map((slot) => ({ slot })), per: 1 };
  const per = Math.ceil(slots.length / max);
  const marks: StripMark[] = [];
  for (let i = 0; i < slots.length; i += per) {
    const group = slots.slice(i, i + per);
    const worst = group.reduce((w, s) => {
      const d = SEVERITY[s.status] - SEVERITY[w.status];
      return d > 0 || (d === 0 && (s.lagMs ?? 0) > (w.lagMs ?? 0)) ? s : w;
    });
    const missed = group.filter((s) => s.status === "missed").length;
    marks.push(missed && missed < group.length && group.some((s) => s.run) ? { slot: worst, someMissed: true } : { slot: worst });
  }
  return { marks, per };
}

export function markGlyph(m: StripMark): ReturnType<typeof slotGlyph> {
  return m.someMissed ? { ch: "x", tone: "magenta" } : slotGlyph(m.slot);
}

export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
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

const TONE: Record<string, string> = { "ON TIME": "green", LATE: "yellow", DROPPING: "red", "NOT FIRING": "red", DISABLED: "red", INVALID: "red", "NO DATA": "gray", "NO SCHEDULES": "gray" };

export function formatText(r: Report, o: TextOptions): string {
  const c = (k: keyof typeof C, s: string) => (o.color ? C[k] + s + C.reset : s);
  const width = Math.max(40, Math.min(o.width ?? 100, 120));
  const lines: string[] = [];
  lines.push(`${c("bold", "cronlag")}  ${r.repo}  ${c("dim", `· ${windowLabel(r.from, r.now)} · times UTC`)}`);
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
    for (const ch of w.changes) lines.push(`  ${c("dim", `schedule changed ${ch.at.slice(0, 16).replace("T", " ")} → ${ch.crons.join(", ") || "(none)"}; earlier slots use the old cron`)}`);
    // strip: at most 3 lines; longer windows fold several slots into one glyph
    const strip = compactSlots(w.slots, perLine * 3);
    if (strip.per > 1) folded = true;
    for (let i = 0; i < strip.marks.length; i += perLine) {
      const chunk = strip.marks.slice(i, i + perLine);
      lines.push("  " + chunk.map((m) => { const g = markGlyph(m); return c(g.tone, g.ch); }).join(""));
    }
    const s = w.stats;
    if (w.slots.length) {
      lines.push(`  ${s.due} slots${strip.per > 1 ? c("dim", ` (1 mark = worst of ${strip.per})`) : ""} · ${s.ran} ran · ${s.missed ? c("magenta", `${s.missed} missed`) : "0 missed"}${s.overdue ? ` · ${c("magenta", `${s.overdue} overdue`)}` : ""}${s.ran ? `   on time ${s.onTime}/${s.ran} · within 1h ${s.within1h}/${s.ran}` : ""}`);
      if (s.ran) lines.push(`  lag  min ${fmtDur(s.lagMin)} · median ${c("bold", fmtDur(s.lagMedian))} · p90 ${fmtDur(s.lagP90)} · max ${fmtDur(s.lagMax)}${s.queueMedian !== null && s.queueMedian > 60_000 ? `   queue ${fmtDur(s.queueMedian)}` : ""}`);
    }
    const tone = (TONE[w.verdict] ?? "gray") as keyof typeof C;
    lines.push(`  ${c(tone, c("bold", w.verdict.padEnd(10)))} ${w.headline}`);
    for (const f of w.findings) {
      const mark = f.level === "error" ? c("red", "✗") : f.level === "warn" ? c("yellow", "!") : c("dim", "·");
      wrap(f.message, width - 4).forEach((ln, i) => lines.push(`  ${i ? " " : mark} ${f.level === "info" ? c("dim", ln) : ln}`));
      if (f.fix) wrap(f.fix, width - 6).forEach((ln, i) => lines.push(`    ${i ? " " : c("dim", "→")} ${ln}`));
    }
  }
  if (r.unscheduled.length) {
    lines.push("");
    lines.push(c("dim", `${r.unscheduled.length} other workflow${r.unscheduled.length === 1 ? "" : "s"} without a schedule: ${r.unscheduled.slice(0, 8).join(", ")}${r.unscheduled.length > 8 ? ", …" : ""}`));
  }
  lines.push("");
  lines.push(c("dim", `bar = lag  ▁≤2m ▂≤10m ▃≤30m ▄≤1h ▅≤3h ▆≤6h ▇≤12h █>12h   ✕ no run${folded ? "   x some missed" : ""}   ? not yet`));
  return lines.join("\n");
}

function mdSlotRow(w: WorkflowReport): string {
  const strip = compactSlots(w.slots, 240);
  return "`" + strip.marks.map((m) => markGlyph(m).ch).join("") + "`" + (strip.per > 1 ? ` <sub>each mark = ${strip.per} slots: ✕ none ran, x some missed, else the worst lag</sub>` : "");
}

export function formatMarkdown(r: Report): string {
  const out: string[] = [];
  out.push(`### cronlag — ${r.repo} · ${windowLabel(r.from, r.now)} · UTC`);
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
      `| [${w.file}](${w.url}) | ${w.crons.map((x) => "`" + x.cron + "`").join("<br>")} | **${w.verdict}** | ${s.due} | ${s.ran} | ${s.missed}${s.overdue ? ` (+${s.overdue} overdue)` : ""} | ${fmtDur(s.lagMedian)} | ${fmtDur(s.lagP90)} | ${fmtDur(s.lagMax)} | ${s.ran ? `${s.within1h}/${s.ran}` : "–"} |`,
    );
  }
  for (const w of r.workflows) {
    out.push("");
    out.push(`**${w.file}** — ${w.verdict}: ${w.headline}`);
    if (w.slots.length) out.push("", mdSlotRow(w));
    for (const f of w.findings) out.push(`- ${f.level === "error" ? "✗" : f.level === "warn" ? "⚠️" : "·"} ${f.message}${f.fix ? ` → ${f.fix.includes("`") ? f.fix : "`" + f.fix + "`"}` : ""}`);
    const late = w.slots.filter((s) => s.status !== "ontime" && s.status !== "pending").slice(-8);
    if (late.length) {
      out.push("", "<details><summary>Recent slots that were late or missed</summary>", "", "| Slot (UTC) | Run created | Lag |", "|---|---|---:|");
      for (const s of late) {
        out.push(`| ${new Date(s.at).toISOString().slice(0, 16).replace("T", " ")} | ${s.run ? `[#${s.run.number}](${s.run.url}) ${new Date(s.run.created).toISOString().slice(0, 16).replace("T", " ")}` : s.status === "missed" ? "**no run**" : "_none yet_"} | ${s.run ? fmtDur(s.lagMs) : `${fmtDur(s.lagMs)}+`} |`);
      }
      out.push("", "</details>");
    }
  }
  out.push("", `<sub>Lag = cron slot → run creation. Generated by [cronlag](https://github.com/Blackman99/cronlag).</sub>`);
  return out.join("\n");
}

export function formatCatchup(steps: (CatchupStep & { error?: string })[], dispatched: boolean, color: boolean): string {
  const c = (k: keyof typeof C, s: string) => (color ? C[k] + s + C.reset : s);
  if (!steps.length) return "No scheduled workflows.";
  return steps
    .map((s) => {
      if (s.error) return `${c("red", "FAILED    ")} ${s.file.padEnd(24)} ${s.reason} — dispatch failed: ${s.error}`;
      const tag = s.action === "dispatch" ? c("yellow", dispatched ? "DISPATCHED" : "WOULD RUN ") : s.action === "covered" ? c("green", "COVERED   ") : c("dim", "SKIP      ");
      return `${tag} ${s.file.padEnd(24)} ${s.reason}`;
    })
    .join("\n");
}

export function isLateHour(ms: number | null): boolean {
  return (ms ?? 0) > HOUR;
}


export function formatOrgText(r: OrgReport, o: TextOptions): string {
  const c = (k: keyof typeof C, s: string) => (o.color ? C[k] + s + C.reset : s);
  const lines: string[] = [];
  lines.push(
    `${c("bold", "cronlag")}  org/${r.org}  ${c("dim", `· ${windowLabel(r.from, r.now)} · ${r.withSchedules} of ${r.scanned} repos have schedules${r.skippedArchived ? ` · ${r.skippedArchived} archived skipped` : ""} · times UTC`)}`,
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
    const tone = (TONE[repo.verdict] ?? "gray") as keyof typeof C;
    const w = repo.worst;
    const stats = w
      ? `${w.missed ? `${w.missed} missed` : "0 missed"}${w.ran ? ` · median ${fmtDur(w.lagMedian)}` : ""}${repo.workflowCount > 1 ? ` · ${repo.workflowCount} workflows` : w ? ` · ${w.file}` : ""}`
      : "";
    lines.push(`  ${c(tone, c("bold", repo.verdict.padEnd(10)))} ${repo.repo.padEnd(nameW)}  ${stats}`);
    if (repo.workflowCount > 1) {
      for (const wf of repo.workflows.slice(0, 8)) {
        const wt = (TONE[wf.verdict] ?? "gray") as keyof typeof C;
        lines.push(
          `             ${c("dim", "·")} ${c(wt, wf.verdict.padEnd(10))} ${wf.file.padEnd(22)} ${wf.missed ? c("magenta", `${wf.missed} missed`) : "0 missed"}${wf.ran ? ` · median ${fmtDur(wf.lagMedian)}` : ""}`,
        );
      }
      if (repo.workflows.length > 8) lines.push(`             ${c("dim", `· … ${repo.workflows.length - 8} more`)}`);
    }
  }
  lines.push("");
  lines.push(c("dim", "worst first · org scan uses --lite (no mid-window cron-history lookup)"));
  return lines.join("\n");
}

export function formatOrgMarkdown(r: OrgReport): string {
  const out: string[] = [];
  out.push(`### cronlag — org/${r.org} · ${windowLabel(r.from, r.now)} · UTC`);
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
      out.push(`| [${repo.repo}](${repo.repoUrl}) | **ERROR** | – | – | – | ${repo.error.replace(/\|/g, "")} |`);
      continue;
    }
    const w = repo.worst;
    out.push(
      `| [${repo.repo}](${repo.repoUrl}) | **${repo.verdict}** | ${repo.workflowCount} | ${w?.missed ?? "–"}${w?.overdue ? ` (+${w.overdue} overdue)` : ""} | ${fmtDur(w?.lagMedian ?? null)} | ${w ? `\`${w.file}\`` : "–"} |`,
    );
  }
  out.push("", `<sub>Worst first. Generated by [cronlag](https://github.com/Blackman99/cronlag) org scan.</sub>`);
  return out.join("\n");
}
