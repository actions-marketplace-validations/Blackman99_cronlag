import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

test("explain prints next fires and flags minute 0", () => {
  const r = spawnSync(process.execPath, [CLI, "explain", "0 6 * * *", "-n", "2"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /06:00 UTC/);
  assert.match(r.stdout, /busiest minute/);
  const bad = spawnSync(process.execPath, [CLI, "explain", "@daily"], { encoding: "utf8" });
  assert.equal(bad.status, 2);
});

test("usage errors exit 2", () => {
  const r = spawnSync(process.execPath, [CLI, "not a repo!"], { encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: "" } });
  assert.equal(r.status, 2);
});

test("unknown options are rejected instead of silently ignored", () => {
  const r = spawnSync(process.execPath, [CLI, "o/r", "--until", "24h"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --until/);
  const t = spawnSync(process.execPath, [CLI, "explain", "17 * * * *", "--tzz=UTC"], { encoding: "utf8" });
  assert.equal(t.status, 2);
  const ok = spawnSync(process.execPath, [CLI, "explain", "17 * * * *", "--tz=Europe/Berlin", "-n", "1", "--no-color"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
});

test("MCP stdio: initialize, tools/list, cron_explain", async () => {
  const p = spawn(process.execPath, [CLI, "mcp"], { stdio: ["pipe", "pipe", "inherit"] });
  const lines: any[] = [];
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const send = (m: object) => p.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "cron_explain", arguments: { cron: "17 */6 * * *", count: 3 } } });
  p.stdin.end();
  await new Promise((r) => p.on("close", r));
  const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.equal(byId[1].result.serverInfo.name, "cronlag");
  assert.deepEqual(byId[2].result.tools.map((t: any) => t.name).sort(), ["catchup_plan", "cron_explain", "schedule_report"]);
  const out = JSON.parse(byId[3].result.content[0].text);
  assert.equal(out.next.length, 3);
  assert.equal(out.shortestInterval, "6h00");
});

test("--since / --days usage errors exit 2 before any API call", () => {
  const cases: [string[], RegExp][] = [
    [["--since", "2026-09-01", "--days", "3"], /either --days or --since, not both/],
    [["--since", "last tuesday"], /not a date — use 2026-09-01/],
    [["-s", "2099-01-01"], /in the future/],
    [["--since=15m"], /shortest window is 1h/],
    [["--since", "2020-01-01"], /longest window is 400 days/],
    [["--days", "0"], /not a positive number/],
    [["--days", "1000"], /longest window is 400 days/],
  ];
  for (const [args, re] of cases) {
    const r = spawnSync(process.execPath, [CLI, "o/r", ...args], { encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "x" } });
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, re);
  }
  const c = spawnSync(process.execPath, [CLI, "catchup", "o/r", "--since", "3d"], { encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "x" } });
  assert.equal(c.status, 2);
  assert.match(c.stderr, /catchup looks at the latest due slots only/);
});

test("help documents --since, --no-cache and the cache dir", () => {
  const r = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", env: { ...process.env, CRONLAG_CACHE_DIR: "/tmp/cronlag-help-test" } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /-s, --since <when>/);
  assert.match(r.stdout, /--no-cache/);
  assert.match(r.stdout, /max 400/);
  assert.match(r.stdout, /cronlag-help-test/);
});

test("large JSON output reaches a pipe in full (no 64 KiB cut-off on exit)", () => {
  const r = spawnSync(process.execPath, [CLI, "explain", "*/5 * * * *", "-n", "6000", "--format", "json"], { encoding: "utf8", maxBuffer: 1 << 24 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.length > 65536 * 2, `got ${r.stdout.length} bytes`);
  assert.equal(JSON.parse(r.stdout).next.length, 6000);
});
