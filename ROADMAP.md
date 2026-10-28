# Roadmap

Core goal: see [GOAL.md](GOAL.md). Every item below must make that answer more accurate or easier to act on.

## v0.1 (2026-10-13) — shipped
- `cronlag [owner/repo]`: slot-by-slot report per scheduled workflow (lag min/median/p90/max, on-time and within-1h counts, missed/overdue), verdicts ON TIME / LATE / DROPPING / NOT FIRING / DISABLED / INVALID.
- GitHub cron semantics: lists, ranges, steps, names, DOM/DOW OR rule, IANA `timezone` with DST gap handling; cross-checked against cron-parser in CI.
- Cron history: slots follow the workflow file's commit history, so a schedule changed mid-window is not counted as "missed".
- Cause checks: disabled_inactivity, approaching 60-day inactivity, not registered since last change, minute 0, < 5 min, fork, archived, no workflow_dispatch, runner queueing vs. scheduler delay.
- `cronlag catchup [--dispatch]` and `cronlag guard` / Action `mode: guard` for idempotent catch-up.
- Output: text, JSON, Markdown; Action job summary + outputs; MCP stdio server (`schedule_report`, `catchup_plan`, `cron_explain`).

## v0.2 — reach the people who need it (v0.2.0 released 2026-10-21)
- [x] Org-wide scan (2026-10-14): `cronlag org <org>` and `cronlag --org <org>` — all non-archived repos with schedules, worst first; text/JSON/markdown; `--fail-on` across the org.
- [x] `--since <date>` and longer windows with caching of run pages (2026-10-21): `--since 2026-09-01` / `2026-09-01T06:00Z` / `30d`, windows up to 400 days read in full past the API's 1000-result cap, settled days cached on disk (`--no-cache`); CLI, `org`, Action `since` input, MCP `schedule_report.since`.
- Publish to npm (needs the user's npm account / Trusted Publishing).
- [x] Ready-made external schedulers for catch-up (2026-10-28): `cronlag worker` prints a Cloudflare Worker (cron trigger), a systemd timer + service or a crontab line, each running one `catchup --dispatch` pass.

## v0.3 — better attribution
- Use `github.event.schedule` recorded by `mode: guard` (job summary/artifact) to tie runs to the exact cron line when several lines overlap.
- Detect platform-wide incidents: compare lag across many public repos at the same minute ("is it everyone right now?").

## v1.0
- Stable JSON schema, documented exit codes, Marketplace listing, `v1` floating tag.
