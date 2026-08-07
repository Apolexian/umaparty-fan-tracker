# Umaparty Fan Tracker

A public site where members of the Umaparty clubs can see their own fan
progress, their standing, and where they would land in next month's reshuffle.
Replaces a Google Sheet that members never had access to.

No login for members. Officers get a private area to run the reshuffle.

- **Deploying:** [`docs/DEPLOY.md`](docs/DEPLOY.md)
- **Why anything is the way it is:** [`docs/DECISIONS.md`](docs/DECISIONS.md)
- **Visual rules:** [`DESIGN.md`](DESIGN.md)
- **For future Claude sessions:** [`CLAUDE.md`](CLAUDE.md)

## What it does

| Page | For |
|---|---|
| `/` | Search yourself by current *or* former name |
| `/club/:id` | The old sheet, sortable, with month history |
| `/m/:viewerId` | Your averages, daily gains, rank, name history, club history |
| `/standings` | Everyone ranked together with the club cutoffs drawn in |
| `/officers` | Login, noticeboard, drag-and-drop roster editor |

## Stack

A single Cloudflare Worker serving the React build, the API, and a daily cron,
with D1 for history. Not Pages — Pages cannot run Cron Triggers.

## Working on it

```bash
npm install
npm run migrate:local     # create the local tables
npm run dev               # Worker + assets on :8787
curl localhost:8787/api/__ingest   # pull today's data into local D1

npm test                  # includes the sheet-parity guard
npm run typecheck
```

`wrangler dev` holds a lock on the local D1 file — stop it before running the
backfill, `seed-admin --local`, or any `d1 execute --local`.

## The one thing to know

The headline metric is **derived, not fetched**:

```
fans/day = adjusted_fan_gain_cumulative / days_active_in_current_club
```

The API has its own `daily_average` field. It is a different window and ranks
members differently. The denominator is days active **in the club**, not
day-of-month, because a mid-month club move resets that month's count.

That distinction is easy to get wrong and hard to notice: against the reference
sheet, the day-of-month denominator is correct for the 25 members who stayed put
and 16–21% wrong for the 5 who moved — i.e. wrong for exactly the people the
reshuffle feature exists to serve. `tests/derive.test.ts` guards it, and a
companion test forces the wrong denominator and asserts it breaches the bounds,
so the guard cannot quietly stop discriminating.

See [D002](docs/DECISIONS.md) and D016.
