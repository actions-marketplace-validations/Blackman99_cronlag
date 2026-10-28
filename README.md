<p align="center"><img src="site/logo.svg" width="120" alt="cronlag logo: a carved cuckoo clock house with its bird out"></p>
<h1 align="center">cronlag</h1>
<p align="center"><b>Your cron said 06:00. GitHub ran it at 11:50.</b><br>Slot-by-slot lag for scheduled GitHub Actions workflows, the cause checks, and a catch-up that doesn't double-run.</p>
<p align="center"><a href="https://blackman99.github.io/cronlag/">Live check in your browser</a> · <a href="https://blackman99.github.io/cronlag/docs/">Docs</a> · <a href="https://github.com/Blackman99/cronlag/releases/latest">Release</a></p>

## The problem

Since late August 2026, `on: schedule` workflows across many repos have been created hours late or skipped entirely ([community #206019](https://github.com/orgs/community/discussions/206019), [#206134](https://github.com/orgs/community/discussions/206134), [#210037](https://github.com/orgs/community/discussions/210037)). The Actions tab doesn't show which cron slot a run was for, so every thread rebuilds the same table by hand: which slots ran, how late, which never ran, and whether it's your setup (disabled after 60 days, bad cron, minute 0, fork, wrong branch) or GitHub's scheduler.

cronlag does that for every scheduled workflow in a repo. It reads the workflow file **and its commit history** (so a cron you changed mid-week, or a workflow you added mid-week, isn't counted as missed), expands the cron with GitHub's rules (DOM/DOW OR rule, `timezone:`, DST gaps), ties each run to its slot, and reports lag from slot to run creation, before any runner is involved.

## Install

```sh
npx github:Blackman99/cronlag owner/repo        # Node 18.17+, no install
npm i -g github:Blackman99/cronlag              # or the .tgz from Releases
```

No token is needed for public repos. For private repos it uses `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token` (Actions: read).

## Example

```sh
npx github:Blackman99/cronlag robhunter/agentdeals -w reverify.yml
```

![cronlag reporting a daily 06:00 workflow created within the hour until 26 August and hours late since, then catch-up showing a missed every-2h slot would run, then `cronlag worker` writing a Cloudflare Worker that runs that catch-up every 10 minutes](site/demo.gif)

`cronlag catchup owner/repo --dispatch` (from any non-GitHub cron) runs the latest missed slot via `workflow_dispatch`. `cronlag worker owner/repo` prints that cron for you: a self-contained Cloudflare Worker with a cron trigger (`-t systemd` for a timer + service, `-t crontab` for one line), token from a secret, never in the file. Add `uses: Blackman99/cronlag@v0` with `mode: guard` to your workflow and GitHub's late run skips itself when that slot is already covered. `--since 2026-08-15` (or `30d`, up to 400 days) looks further back; settled days of runs are cached on disk, so the second long report only fetches the last day or so (`--no-cache` to skip). `cronlag org <org>` (or `--org`) scans every non-archived repo in an organization and lists those with schedules, worst first. The [docs](https://blackman99.github.io/cronlag/docs/) cover the Action, the MCP server (`cronlag mcp`), Markdown/JSON output and every flag.

MIT · [Contributing](CONTRIBUTING.md) · [Roadmap](ROADMAP.md)
