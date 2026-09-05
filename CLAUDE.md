# UmaParty Fan Tracker

Public site where members of five Umamusume clubs check their fan progress,
their standing, and where they would land in next month's reshuffle. Replaces a
Google Sheet that members never had access to.

**Read `docs/DECISIONS.md` before changing any metric or rule.** Every
assumption this project runs on is numbered there with its rationale. If a rule
seems arbitrary, it is probably load-bearing and explained.

## Stack

Single Cloudflare Worker: static assets (Vite/React) + `/api/*` + a daily cron,
with D1 for history. Not Pages — Pages cannot run Cron Triggers (D011).

## Non-obvious things that will bite you

- **The fan metric is derived, not fetched.** `mtd_avg =
  adjusted_fan_gain_cumulative / days_active_in_current_club`. The API *has* a
  `daily_average` field — it is a different window and ranks members
  differently. Do not use it. (D002, D016)
- **The denominator is days active in the club, not day-of-month.** A mid-month
  club move resets that month's count. Using day-of-month is correct for 25 of
  30 members and 16–21% wrong for the five who moved. `tests/derive.test.ts`
  guards this with an error threshold that sits between the two. (D016)
- **`daily_diff` from the API is `0` for everyone.** Dead field. (D003)
- **`actual_date` is a day-of-month integer (1–31), not a date.** Resolved to
  `ymd` (YYYYMMDD) once at ingest.
- **Identity is `friend_viewer_id`, never name.** Players rename constantly and
  the old sheet lost people to it. (D004)
- **Chrono re-attributes a member's whole month to their current club and
  zeroes their pre-move days.** Hence `member_day` is keyed by
  `(viewer_id, ymd)` with `circle_id` as an attribute. (D009, D017)
- **Chrono keeps no cross-club movement history at all.** A mover is purged
  from their old club's records. `club_stint` is ours and only ours — if the
  daily ingest misses a reshuffle day, that history is gone forever. (D010)
- **Ingest must never overwrite a non-zero `fan_gain` with a `0`.** That zero
  is chrono wiping a mover's history. (D017)
- **`adjusted_fan_gain_cumulative` counts from the 1st, across clubs.** The
  denominator is stint days, so the numerator is cut to the same window —
  otherwise a mover's old club's fans inflate their average. Chrono usually
  zeroes pre-move days, but not always, and that is exactly when it breaks.
  (D035)

## API

`https://api.chronogenesis.net`, FastAPI, **public spec at `/openapi.json`** —
check it rather than guessing shapes. Auth is `Authorization: <raw-token>` with
**no `Bearer` prefix**, plus a browser `User-Agent`. Never call `GET /rotate`.

Data refreshes once daily after 10:00 UTC; on the 1st of a month the member
tables land at 10 UTC and the club tables at 15 UTC. Don't exceed 1 req/sec.

## Conventions

npm; ESM; TS strict; semicolons; double quotes; 2-space indent; trailing
commas; `node:` prefixed builtins; vitest; Conventional Commits.

**Commits carry no Claude co-author trailer** (D014).

## Commands

```
npm test                  # vitest — includes the sheet-parity guard
npm run dev               # wrangler dev (Worker + assets)
npm run migrate:local     # apply migrations to the local D1
npm run backfill          # one-time historical import, 14 months x 5 clubs
npm run repair:month -- --month 2026-09 [--remote]   # re-derive a month with stints
```
