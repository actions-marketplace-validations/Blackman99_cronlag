// Generates site/docs/*.html. Edit content here, then: node scripts/build_docs.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://blackman99.github.io/cronlag";
const pages = [
  ["index", "Overview", "What cronlag answers and how it measures it."],
  ["install", "Install", "npx, global install, tokens and permissions."],
  ["usage", "Usage", "Report, org scan, catch-up, guard, explain, the GitHub Action and the MCP server."],
  ["configuration", "Configuration", "Every flag and Action input, thresholds and defaults."],
  ["reference", "Reference", "Verdicts, slot states, cause checks, JSON output, exit codes, MCP tools."],
  ["faq", "FAQ", "Why runs are late, attribution limits, double runs, private repos."],
];

const C = {
index: `
<p class="lead">cronlag tells you, slot by slot, whether your scheduled GitHub Actions workflows ran when their <code>cron:</code> said — how late, which slots never ran, and whether the cause is your setup or GitHub's scheduler. Then it runs the missed slots without double runs.</p>
<h2>Why</h2>
<p>Since late August 2026 many repos see scheduled runs created hours late or not at all (<a href="https://github.com/orgs/community/discussions/206019">community #206019</a>, <a href="https://github.com/orgs/community/discussions/206134">#206134</a>, <a href="https://github.com/orgs/community/discussions/210037">#210037</a>). Every thread rebuilds the same table by hand: list the schedule runs, work out which cron slot each belongs to, compute the lag, count the gaps, then walk a checklist of causes. The Actions tab shows none of this — and the REST API doesn't even say which slot a run was for.</p>
<h2>How it measures</h2>
<ol>
<li>Reads every workflow file on the default branch and its commit history, so each period is judged by the cron that was live then (cron changes mid-window are not "missed" slots). Slots before GitHub first registered the workflow are not counted either, so a workflow added two days ago is judged on two days.</li>
<li>Expands the cron with GitHub's rules: <code>* , - /</code>, month and day names, day-of-month/day-of-week OR rule, IANA <code>timezone:</code> with DST gaps moved to the next valid time.</li>
<li>Lists runs with <code>event=schedule</code> and ties each to the closest preceding unclaimed slot within 24 hours.</li>
<li>Lag = slot → run <em>creation</em>. That happens before any runner is involved, so it is the scheduler. Queue time (creation → start) is reported separately: that one is your runners.</li>
</ol>
<pre><code>npx github:Blackman99/cronlag owner/repo</code></pre>
<p>Next: <a href="install.html">Install</a> · <a href="usage.html">Usage</a></p>`,
install: `
<h2>Run without installing</h2>
<pre><code>npx github:Blackman99/cronlag owner/repo</code></pre>
<p>Requires Node.js 18.17 or newer. The package ships a single bundled file with no runtime dependencies, so <code>npx</code> from GitHub is quick. It is not on the npm registry yet; once it is, <code>npx cronlag</code> will work too.</p>
<h2>Install</h2>
<pre><code>npm install -g github:Blackman99/cronlag      # from git
npm install -g ./cronlag-0.1.0.tgz             # from the release tarball</code></pre>
<p>Release tarballs: <a href="https://github.com/Blackman99/cronlag/releases/latest">GitHub Releases</a>.</p>
<h2>Tokens</h2>
<p>cronlag looks for a token in <code>--token</code>, then <code>GITHUB_TOKEN</code>, then <code>GH_TOKEN</code>, then <code>gh auth token</code>.</p>
<table><tr><th>What</th><th>Needs</th></tr>
<tr><td>Report on a public repo</td><td>nothing (60 API calls/hour unauthenticated; a 7-day report uses about 2 + 3 per scheduled workflow; a first <code>--since 90d</code> on an hourly workflow about 25 more, a repeat one almost none)</td></tr>
<tr><td>Report on a private repo</td><td>fine-grained token with <b>Actions: read</b> and <b>Contents: read</b>, or classic <code>repo</code></td></tr>
<tr><td><code>catchup --dispatch</code>, <code>worker</code> schedulers</td><td><b>Actions: read and write</b></td></tr>
<tr><td>GitHub Action</td><td>the job's <code>GITHUB_TOKEN</code> with <code>actions: read</code> (default for most repos)</td></tr></table>`,
usage: `
<h2 id="report">Report</h2>
<pre><code>cronlag                                   # repo from the git remote of the current directory
cronlag owner/repo --days 14
cronlag owner/repo -w nightly.yml -f markdown   # paste into an issue</code></pre>
<p>One block per scheduled workflow: the cron line(s), a strip with one glyph per slot (bar height = lag, <code>✕</code> = no run, <code>?</code> = no run yet), lag min/median/p90/max, on-time and within-1-hour counts, a verdict, and the cause checks with the fix to apply.</p>
<h2 id="since">Longer windows: --since and the run cache</h2>
<pre><code>cronlag owner/repo --since 2026-08-15          # since a UTC date: before vs. during the incident
cronlag owner/repo --since 2026-08-15T06:00Z   # or a date-time (no zone = UTC)
cronlag owner/repo --since 90d                 # relative: 36h, 30d, 6w
cronlag org my-org --since 30d -f markdown</code></pre>
<p><code>--since</code> replaces <code>--days</code> (giving both is an error); either one goes up to <b>400 days</b>. Every run in the window is read: the window is split into UTC days and fetched as a few <code>created=</code> range queries, halved automatically wherever one would pass the API's 1000-result cap, so an every-5-minutes schedule over a year is complete too. Past about 3 lines the slot strip folds several consecutive slots into one mark, and the line under it says how many: <code>✕</code> when none of them ran, a small <code>x</code> when some ran and some didn't (a schedule GitHub is thinning out), otherwise the bar of the worst lag.</p>
<p><b>Run cache.</b> A workflow run's creation time never changes, so a UTC day that ended more than 6 hours ago and whose runs have all completed is final. cronlag keeps such days on disk, one small JSON file per repo + workflow + event + day, and the next report only asks the API for today, the last day or two and any day that still had a queued or running run. The second <code>--since 90d</code> on the same repo costs about as much as a 2-day report.</p>
<table><tr><th>Where</th><th>Path</th></tr>
<tr><td>Linux</td><td><code>$XDG_CACHE_HOME/cronlag</code> or <code>~/.cache/cronlag</code></td></tr>
<tr><td>macOS</td><td><code>~/Library/Caches/cronlag</code></td></tr>
<tr><td>Windows</td><td><code>%LOCALAPPDATA%\\cronlag\\Cache</code></td></tr>
<tr><td>anywhere</td><td><code>CRONLAG_CACHE_DIR</code> overrides</td></tr></table>
<p><code>--no-cache</code> (or <code>CRONLAG_NO_CACHE=1</code>) skips reading and writing it. Deleting the directory is always safe. It holds run ids, numbers, URLs, status and timestamps (no tokens, no logs), in files only your user can read. <code>catchup</code> and <code>guard</code> never use the cache: they decide what to dispatch or skip from the API's answer right now. The GitHub Action doesn't cache either (each job starts on a fresh runner). A run that is re-run later keeps its first attempt in the cache.</p>
<h2 id="org">Org-wide scan</h2>
<pre><code>cronlag org my-org
cronlag --org my-org --days 14 --fail-on late
cronlag org my-org --since 2026-09-01 -f markdown</code></pre>
<p>Lists every non-archived repo in the org, finds those with <code>on: schedule</code> workflows, runs the same report pipeline on each (in <code>--lite</code> mode for fewer API calls), and prints a compact summary sorted <b>worst first</b>. Text, JSON and Markdown are supported; <code>--fail-on</code> exits 1 if any scanned repo hits the threshold. Progress goes to stderr when the terminal is a TTY. Archived repos are skipped; non-archived forks are still scanned (the fork cause check explains why schedules never fire).</p>
<h2 id="catchup">Catch-up</h2>
<pre><code>cronlag catchup owner/repo              # dry run: what would be dispatched
cronlag catchup owner/repo --dispatch   # do it</code></pre>
<p>For each scheduled workflow, cronlag takes the latest slot older than the grace period (<code>--grace</code>, default 15m) and younger than 24h. If neither a scheduled run nor a <code>workflow_dispatch</code> run was created after it, <code>--dispatch</code> starts the workflow on the default branch. Running it again does nothing until the next slot is due, so call it every 10–15 minutes from a scheduler that isn't GitHub's: <a href="#worker"><code>cronlag worker</code></a> prints one ready to install. If one dispatch fails (say, a token without Actions: write), the others still go out and the command exits 3.</p>
<p>The workflow must have a <code>workflow_dispatch:</code> trigger.</p>
<h2 id="worker">cronlag worker: a scheduler that isn't GitHub's</h2>
<pre><code>cronlag worker owner/repo -o cronlag-cf                  # Cloudflare Worker: worker.js + wrangler.toml
cronlag worker owner/repo -t systemd -o units            # systemd .service + .timer
cronlag worker owner/repo -t crontab                     # one crontab line
cronlag worker owner/repo -w nightly.yml --every 15m --grace 20m</code></pre>
<p>It reads the repo's workflows once, keeps the scheduled ones that have <code>workflow_dispatch</code> (or the ones you name with <code>-w</code>), and prints a scheduler that runs exactly one <code>cronlag catchup --dispatch</code> pass every <code>--every</code> (default 10m, at minute 4 and every 10 after, off GitHub's busy :00). Same rules as above: only the latest slot past <code>--grace</code>, once, never inside the grace period. Without <code>-o</code> the file goes to stdout and a summary to stderr; <code>-o &lt;dir&gt;</code> writes the files. The token never goes into the output: it comes from a Worker secret, a root-only <code>EnvironmentFile</code>, or a <code>chmod 600</code> env file. Use a fine-grained token for that one repo with <b>Actions: read and write</b>.</p>
<table><tr><th>Target</th><th>What you get</th><th>Install</th></tr>
<tr><td><code>cloudflare</code> (default)</td><td><code>worker.js</code>: a short readable handler on top of cronlag's own catch-up code, bundled (no dependencies, no build step), plus <code>wrangler.toml</code> with the cron trigger</td><td><code>wrangler secret put GITHUB_TOKEN</code>, <code>wrangler deploy</code>. Deploy once with <code>DRY_RUN = "1"</code> and watch <code>wrangler tail</code>. A pass costs about 2 + 3 API calls per workflow, so the free plan's 50 subrequests cover about 15 workflows</td></tr>
<tr><td><code>systemd</code></td><td><code>&lt;name&gt;.service</code> (oneshot, <code>DynamicUser</code>, sandboxed, token from <code>/etc/cronlag/&lt;name&gt;.env</code>) and <code>&lt;name&gt;.timer</code> (<code>OnCalendar</code> in UTC, <code>Persistent=true</code>)</td><td>copy to <code>/etc/systemd/system/</code>, <code>systemctl enable --now &lt;name&gt;.timer</code></td></tr>
<tr><td><code>crontab</code></td><td>a <code>PATH</code> line and one entry that sources <code>~/.config/cronlag/&lt;name&gt;.env</code> and appends to <code>~/cronlag-catchup.log</code></td><td><code>crontab -e</code></td></tr></table>
<p>The workflow list is written into the output, so a workflow you add later is never dispatched by surprise: re-run <code>cronlag worker</code> when you add one or change a cron line. The summary warns about workflows that lack the <a href="#guard">guard</a> step (pair them, or GitHub's late run of a caught-up slot runs too), are disabled, or fire more often than <code>--every</code>. systemd and crontab call <code>npx -y github:Blackman99/cronlag#v0</code>; pass <code>--bin cronlag</code> (or a full path) after a global install. Use <code>-f json</code> to get the schedule and file contents for your own tooling.</p>
<h2 id="guard">Guard: no double runs</h2>
<p>When GitHub's late scheduled run finally arrives after catch-up already ran that slot, the guard tells it to skip:</p>
<pre><code>jobs:
  guard:
    runs-on: ubuntu-latest
    permissions: { actions: read, contents: read }
    outputs: { skip: \${{ steps.g.outputs.skip }} }
    steps:
      - id: g
        uses: Blackman99/cronlag@v0
        with: { mode: guard }
  work:
    needs: guard
    if: needs.guard.outputs.skip != 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo "the real job"</code></pre>
<p>On non-schedule events the guard always says <code>skip=false</code>. It also outputs <code>slot</code> and <code>lag-minutes</code> for this run.</p>
<h2 id="explain">Explain a cron line</h2>
<pre><code>cronlag explain "0 */6 * * *"
cronlag explain "30 5 * * 1-5" --tz America/New_York -n 10</code></pre>
<h2 id="github-action">GitHub Action (report)</h2>
<pre><code>on:
  schedule: [{ cron: "41 7 * * 1" }]   # weekly; yes, a schedule — it reports on all the others
  workflow_dispatch:
permissions: { actions: read, contents: read }
jobs:
  lag:
    runs-on: ubuntu-latest
    steps:
      - uses: Blackman99/cronlag@v0
        with:
          days: 7            # or since: 2026-09-01 / since: 30d
          fail-on: dropped</code></pre>
<p>Writes the Markdown report to the job summary and sets outputs <code>verdict</code>, <code>missed</code>, <code>median-lag-minutes</code>, <code>json</code>.</p>
<h2 id="mcp">MCP server</h2>
<pre><code>{
  "mcpServers": {
    "cronlag": { "command": "npx", "args": ["-y", "github:Blackman99/cronlag", "mcp"], "env": { "GITHUB_TOKEN": "…" } }
  }
}</code></pre>
<p>Tools (all read-only): <code>schedule_report</code> {repo, days?, since?, workflow?}, <code>catchup_plan</code> {repo, grace_minutes?}, <code>cron_explain</code> {cron, timezone?, count?}. The plan never dispatches; an agent that should act runs <code>cronlag catchup --dispatch</code> itself, under whatever approval you require.</p>`,
configuration: `
<h2>CLI flags</h2>
<table><tr><th>Flag</th><th>Default</th><th>Meaning</th></tr>
<tr><td><code>-d, --days</code></td><td>7</td><td>window to inspect, up to 400 days (fractions work: <code>0.5</code>)</td></tr>
<tr><td><code>-s, --since</code></td><td></td><td>window start instead of <code>--days</code>: <code>2026-09-01</code>, <code>2026-09-01T06:00Z</code> (UTC unless an offset is given) or relative <code>36h</code> / <code>30d</code> / <code>6w</code>; at least 1h, at most 400 days</td></tr>
<tr><td><code>--no-cache</code></td><td>off</td><td>don't read or write the <a href="usage.html#since">run cache</a></td></tr>
<tr><td><code>-w, --workflow</code></td><td>all</td><td>only this workflow: file name (<code>nightly.yml</code> or <code>nightly</code>), path, display name or id; repeatable</td></tr>
<tr><td><code>-f, --format</code></td><td>text</td><td><code>text</code>, <code>json</code>, <code>markdown</code></td></tr>
<tr><td><code>--org</code></td><td></td><td>org-wide scan (same as <code>cronlag org &lt;org&gt;</code>)</td></tr>
<tr><td><code>--fail-on</code></td><td>never</td><td><code>dropped</code>: exit 1 on DROPPING / NOT FIRING / DISABLED / INVALID; <code>late</code>: also LATE</td></tr>
<tr><td><code>--late</code></td><td>1h</td><td>lag above which a run is "very late" (also the LATE verdict threshold for the median)</td></tr>
<tr><td><code>--on-time</code></td><td>10m</td><td>lag still counted as on time</td></tr>
<tr><td><code>--lite</code></td><td>off</td><td>skip the workflow-file history lookup (fewer API calls; cron changes in the window are then not detected)</td></tr>
<tr><td><code>--grace</code></td><td>15m</td><td>catchup: how long after a slot before it counts as missed</td></tr>
<tr><td><code>--dispatch</code></td><td>off</td><td>catchup: actually dispatch</td></tr>
<tr><td><code>-t, --target</code></td><td>cloudflare</td><td>worker: <code>cloudflare</code>, <code>systemd</code> or <code>crontab</code></td></tr>
<tr><td><code>--every</code></td><td>10m</td><td>worker: how often the catch-up pass runs; 5m–1h dividing an hour, or 2h/3h/4h/6h/12h</td></tr>
<tr><td><code>-o, --out</code></td><td>stdout</td><td>worker: write the files into this directory</td></tr>
<tr><td><code>--bin</code></td><td>npx</td><td>worker (systemd, crontab): the command that runs cronlag</td></tr>
<tr><td><code>--tz</code>, <code>-n</code></td><td>UTC, 5</td><td>explain: timezone and number of fire times</td></tr>
<tr><td><code>--token</code></td><td>env / gh</td><td>GitHub token</td></tr>
<tr><td><code>--no-color</code></td><td>auto</td><td>plain output (<code>NO_COLOR</code> and <code>FORCE_COLOR</code> are honored)</td></tr></table>
<p>Durations accept <code>s</code>, <code>m</code>, <code>h</code>, <code>d</code> (<code>90m</code>, <code>2h</code>).</p>
<h2>Action inputs</h2>
<table><tr><th>Input</th><th>Default</th><th></th></tr>
<tr><td><code>mode</code></td><td>report</td><td><code>report</code> or <code>guard</code></td></tr>
<tr><td><code>repo</code></td><td>this repo</td><td>owner/repo</td></tr>
<tr><td><code>days</code></td><td>7</td><td>report window, up to 400</td></tr>
<tr><td><code>since</code></td><td></td><td>window start instead of <code>days</code> (same forms as <code>--since</code>); overrides <code>days</code></td></tr>
<tr><td><code>workflow</code></td><td></td><td>comma-separated file names</td></tr>
<tr><td><code>fail-on</code></td><td>never</td><td>as the CLI flag</td></tr>
<tr><td><code>token</code></td><td><code>github.token</code></td><td>needs actions:read</td></tr></table>
<h2>Fixed rules</h2>
<ul><li>A run is attributed to a slot at most 24 hours after it (GitHub drops scheduled events queued longer).</li>
<li>Runs created up to 2 minutes <em>before</em> a slot count for it (clock skew).</li>
<li>A slot with no run is <b>missed</b> once it is 24h old or a later slot already got its run; until then it is <b>overdue</b>.</li></ul>`,
reference: `
<h2>Verdicts</h2>
<table><tr><th>Verdict</th><th>When</th></tr>
<tr><td>ON TIME</td><td>runs exist, median lag ≤ <code>--late</code>, under 25% very late, nothing missed</td></tr>
<tr><td>LATE</td><td>median lag above <code>--late</code>, or ≥ 25% of runs very late</td></tr>
<tr><td>DROPPING</td><td>at least one slot missed</td></tr>
<tr><td>NOT FIRING</td><td>slots came due and no scheduled run was created at all</td></tr>
<tr><td>DISABLED</td><td>workflow state is not active (e.g. <code>disabled_inactivity</code>)</td></tr>
<tr><td>INVALID</td><td>no valid cron, or the file does not parse</td></tr>
<tr><td>NO DATA</td><td>no slot has come due in the window</td></tr></table>
<h2>Slot states</h2>
<p><code>ontime</code> (≤ on-time), <code>late</code> (≤ late), <code>verylate</code>, <code>overdue</code> (no run yet), <code>missed</code>, <code>pending</code> (not due yet).</p>
<h2>Cause checks</h2>
<table><tr><th>Code</th><th>Meaning</th></tr>
<tr><td><code>disabled-inactivity</code></td><td>GitHub disabled the workflow after 60 days without repo activity; fix prints <code>gh workflow enable</code></td></tr>
<tr><td><code>disabled</code></td><td>workflow disabled by hand</td></tr>
<tr><td><code>inactivity-soon</code></td><td>public repo with no push for 45+ days</td></tr>
<tr><td><code>not-registered</code></td><td>no scheduled run since the file last changed, 2+ slots ago</td></tr>
<tr><td><code>top-of-hour</code></td><td>cron fires at minute 0</td></tr>
<tr><td><code>too-frequent</code></td><td>interval under 5 minutes</td></tr>
<tr><td><code>bad-cron</code>, <code>yaml</code></td><td>invalid cron line / unparsable file</td></tr>
<tr><td><code>fork</code>, <code>archived</code></td><td>schedules off in forks until enabled; never in archived repos</td></tr>
<tr><td><code>no-dispatch</code></td><td>no <code>workflow_dispatch</code>, so missed slots can't be run</td></tr>
<tr><td><code>scheduler-side</code></td><td>lag happens before creation (GitHub), with the median start delay of manual runs as evidence</td></tr>
<tr><td><code>queued</code></td><td>runs wait 5+ minutes after creation: runner capacity</td></tr>
<tr><td><code>timezone</code></td><td>cron evaluated in an IANA timezone</td></tr></table>
<h2>JSON</h2>
<pre><code>{ "repo", "repoUrl", "from", "now", "days", "verdict",
  "workflows": [ { "file", "name", "path", "url", "state", "crons": [{ "cron", "timezone" }],
    "changes": [{ "at", "crons" }], "hasDispatch", "verdict", "headline",
    "stats": { "due", "ran", "missed", "overdue", "pending", "onTime", "late", "veryLate", "within1h",
               "lagMin", "lagMedian", "lagP90", "lagMax", "queueMedian", "dispatchQueueMedian", "extraRuns" },
    "slots": [ { "at", "cron", "status", "lagMs", "queueMs", "run": { "id", "number", "url", "created", "conclusion" } } ],
    "findings": [ { "level", "code", "message", "fix" } ] } ],
  "unscheduled": [ "ci.yml", … ] }</code></pre>
<p>Times are epoch milliseconds in <code>slots</code>, ISO strings at the top level. Durations are milliseconds.</p>
<h2>Exit codes</h2>
<p><code>0</code> ok (or nothing matched <code>--fail-on</code>) · <code>1</code> a workflow matched <code>--fail-on</code> · <code>2</code> usage error (an unknown option, a bad <code>--since</code> / <code>--days</code>) / invalid cron · <code>3</code> GitHub API error (rate limit, not found, auth), or a <code>catchup --dispatch</code> dispatch that failed.</p>
<h2>MCP tools</h2>
<p><code>schedule_report</code> returns the Markdown report plus compact JSON; <code>catchup_plan</code> returns the steps <code>catchup</code> would take (never dispatches); <code>cron_explain</code> returns next fire times, shortest interval and the minute-0 flag. All are annotated <code>readOnlyHint: true</code>.</p>`,
faq: `
<h2>Why are my scheduled runs late?</h2>
<p>GitHub documents that scheduled workflows can be delayed under load and dropped, especially at the start of the hour. Since late August 2026 the delays have been far larger than usual for many repos, including ones on quiet minutes. cronlag can't make GitHub's scheduler faster; it shows you exactly how late it is, rules out causes on your side, and gives you a catch-up path.</p>
<h2>How exact is the lag?</h2>
<p>The API doesn't say which cron slot a run belongs to. cronlag ties each run to the closest preceding unclaimed slot. For daily or few-times-a-day schedules that is exact in practice. For schedules more frequent than the delay (say hourly with 3-hour lag) a run may be tied to a later slot than it really served, so the lag is a <b>lower bound</b> and the missed count an upper bound. <code>mode: guard</code> reports the precise lag of the run it is in.</p>
<h2>Will catch-up cause double runs?</h2>
<p>Catch-up (and every <code>cronlag worker</code> scheduler) only dispatches a slot that has no run after the grace period, and never the same slot twice. If GitHub's delayed run arrives later anyway, add the guard job and it will skip. Without the guard, make the job idempotent (most refresh jobs already are) or use a <code>concurrency</code> group.</p>
<h2>Does moving off minute 0 help?</h2>
<p>Sometimes. GitHub recommends it, and cronlag suggests a quieter minute. But the 2026 threads show off-peak schedules (:15, :23, :38, :47) failing too, so measure before and after with <code>cronlag --since</code> the day you moved it.</p>
<h2>Private repos? GitHub Enterprise?</h2>
<p>Private repos work with a token that has Actions: read. GHES: point the library's <code>GitHub</code> client at your API base (<code>apiBase</code>); a CLI flag is on the roadmap.</p>
<h2>Is anything sent anywhere?</h2>
<p>No. The CLI, Action and MCP server talk only to the GitHub API. The landing page's live check runs in your browser against the public API.</p>`,
};

const head = (slug, title, desc) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — cronlag docs</title><meta name="description" content="${desc}">
<link rel="canonical" href="${BASE}/docs/${slug === "index" ? "" : slug + ".html"}"><link rel="icon" href="../favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#2e1a12">
<meta property="og:type" content="article"><meta property="og:site_name" content="cronlag"><meta property="og:url" content="${BASE}/docs/${slug === "index" ? "" : slug + ".html"}">
<meta property="og:title" content="cronlag docs — ${title}"><meta property="og:description" content="${desc}">
<meta property="og:image" content="${BASE}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="cronlag: a carved cuckoo clock whose dial shows late and missing cron runs">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="cronlag docs — ${title}"><meta name="twitter:description" content="${desc}"><meta name="twitter:image" content="${BASE}/og.png">
<link rel="stylesheet" href="docs.css"></head><body>`;

mkdirSync("site/docs", { recursive: true });
for (const [slug, title, desc] of pages) {
  const nav = pages.map(([s, t]) => `<a href="${s === "index" ? "./" : s + ".html"}"${s === slug ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  writeFileSync(`site/docs/${slug}.html`, `${head(slug, title, desc)}
<header class="bar"><a class="home" href="../"><img src="../logo.svg" alt="" width="40" height="40"><span>cronlag</span></a><nav>${nav}</nav></header>
<main class="doc"><h1>${title}</h1>${C[slug]}</main>
<footer class="dfoot"><a href="https://github.com/Blackman99/cronlag">GitHub</a> · <a href="https://github.com/Blackman99/cronlag/issues">Issues</a> · MIT</footer>
</body></html>
`);
}
console.log(`wrote ${pages.length} docs pages`);
