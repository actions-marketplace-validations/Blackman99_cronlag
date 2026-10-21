import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.ts";
import { sortOrgRepos, exitForOrg, type OrgReport, type OrgRepoSummary } from "../src/org.ts";
import { formatOrgText, formatOrgMarkdown } from "../src/format.ts";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("parseArgs recognizes org subcommand and --org flag", () => {
  const a = parseArgs(["org", "acme", "--days", "3"]);
  assert.equal(a.cmd, "org");
  assert.deepEqual(a.pos, ["acme"]);
  assert.deepEqual(a.flags.days, ["3"]);

  const b = parseArgs(["--org", "acme", "-f", "json"]);
  assert.equal(b.cmd, "report");
  assert.deepEqual(b.flags.org, ["acme"]);
  assert.deepEqual(b.flags.format, ["json"]);

  const c = parseArgs(["--org=widgets"]);
  assert.deepEqual(c.flags.org, ["widgets"]);
});

test("cronlag org without a name exits 2", () => {
  const r = spawnSync(process.execPath, [CLI, "org"], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /org needs a name/);
});

test("CLI runs when invoked through a symlinked bin (npm/npx install)", { skip: process.platform === "win32" }, () => {
  const link = join(mkdtempSync(join(tmpdir(), "cronlag-bin-")), "cronlag");
  symlinkSync(CLI, link);
  const r = spawnSync(process.execPath, [link, "--version"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\d+\.\d+\.\d+/);
});

test("help mentions org", () => {
  const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /cronlag org <org>/);
  assert.match(r.stdout, /--org <org>/);
});

test("org accepts --since and rejects it together with --days", () => {
  const a = parseArgs(["org", "acme", "--since", "2026-09-01"]);
  assert.deepEqual(a.flags.since, ["2026-09-01"]);
  const r = spawnSync(process.execPath, [CLI, "org", "acme", "--since", "30d", "--days", "3"], { encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "x" } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /either --days or --since/);
});

function repo(partial: Partial<OrgRepoSummary> & Pick<OrgRepoSummary, "repo" | "verdict">): OrgRepoSummary {
  return {
    repoUrl: `https://github.com/${partial.repo}`,
    private: false,
    fork: false,
    workflowCount: partial.workflowCount ?? 1,
    workflows: partial.workflows ?? [],
    ...partial,
  };
}

test("sortOrgRepos orders worst first", () => {
  const sorted = sortOrgRepos([
    repo({ repo: "o/on-time", verdict: "ON TIME", worst: { file: "a.yml", name: "a", verdict: "ON TIME", headline: "", lagMedian: 60_000, lagP90: null, lagMax: null, missed: 0, overdue: 0, due: 7, ran: 7, within1h: 7 } }),
    repo({ repo: "o/dropping", verdict: "DROPPING", worst: { file: "b.yml", name: "b", verdict: "DROPPING", headline: "", lagMedian: 3_600_000, lagP90: null, lagMax: null, missed: 10, overdue: 0, due: 20, ran: 10, within1h: 2 } }),
    repo({ repo: "o/late", verdict: "LATE", worst: { file: "c.yml", name: "c", verdict: "LATE", headline: "", lagMedian: 6 * 3_600_000, lagP90: null, lagMax: null, missed: 0, overdue: 0, due: 7, ran: 7, within1h: 0 } }),
    repo({ repo: "o/not-firing", verdict: "NOT FIRING", worst: { file: "d.yml", name: "d", verdict: "NOT FIRING", headline: "", lagMedian: null, lagP90: null, lagMax: null, missed: 7, overdue: 0, due: 7, ran: 0, within1h: 0 } }),
  ]);
  assert.deepEqual(
    sorted.map((r) => r.repo),
    ["o/not-firing", "o/dropping", "o/late", "o/on-time"],
  );
});

test("exitForOrg respects --fail-on", () => {
  const report: OrgReport = {
    org: "acme",
    from: new Date().toISOString(),
    now: new Date().toISOString(),
    days: 7,
    scanned: 2,
    withSchedules: 2,
    skippedArchived: 0,
    errors: 0,
    repos: [
      repo({ repo: "acme/a", verdict: "LATE" }),
      repo({ repo: "acme/b", verdict: "ON TIME" }),
    ],
  };
  assert.equal(exitForOrg(report, "never"), 0);
  assert.equal(exitForOrg(report, "dropped"), 0);
  assert.equal(exitForOrg(report, "late"), 1);
  report.repos[0].verdict = "DROPPING";
  assert.equal(exitForOrg(report, "dropped"), 1);
});

test("formatOrgText and formatOrgMarkdown render a compact summary", () => {
  const report: OrgReport = {
    org: "acme",
    from: "2026-10-07T00:00:00.000Z",
    now: "2026-10-14T00:00:00.000Z",
    days: 7,
    scanned: 10,
    withSchedules: 1,
    skippedArchived: 2,
    errors: 0,
    repos: [
      repo({
        repo: "acme/late-one",
        verdict: "LATE",
        worst: {
          file: "nightly.yml",
          name: "nightly",
          verdict: "LATE",
          headline: "median 2h",
          lagMedian: 2 * 3_600_000,
          lagP90: 3 * 3_600_000,
          lagMax: 4 * 3_600_000,
          missed: 1,
          overdue: 0,
          due: 7,
          ran: 6,
          within1h: 0,
        },
        workflows: [],
      }),
    ],
  };
  const text = formatOrgText(report, { color: false });
  assert.match(text, /org\/acme/);
  assert.match(text, /LATE/);
  assert.match(text, /acme\/late-one/);
  assert.match(text, /1 missed/);
  const md = formatOrgMarkdown(report);
  assert.match(md, /org\/acme/);
  assert.match(md, /acme\/late-one/);
  assert.match(md, /\*\*LATE\*\*/);
});
