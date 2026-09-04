# Decision log

Append-only. Every assumption and rule this project runs on, with who decided it
and why. If one turns out to be wrong, point at its number — say "D016 is wrong"
— and it can be traced to everything that depends on it.

**Never edit a decision in place.** Add a new entry that supersedes it and mark
the old one `SUPERSEDED BY Dxxx`, so the reasoning trail survives.

Statuses: `ACTIVE` · `SUPERSEDED BY Dxxx` · `OPEN` (not yet decided)

---

## D001 — API auth is `Authorization: <raw-token>`, no `Bearer`
**2026-08-07 · verified against the live API · ACTIVE**

`Authorization: <token>` works. `Authorization: Bearer <token>` returns 403.
No header at all returns 422 `{"detail":"Error"}`. A browser `User-Agent`
header is also required. Spec is public at `/openapi.json`.

Token lives in the `CHRONO_TOKEN` Worker secret. Never in this repo.

Do **not** call `GET /rotate` — the name implies it invalidates the key.

---

## D002 — "Average Daily Fans" is derived, not the API's `daily_average`
**2026-08-07 · verified against the 08/06 sheet · ACTIVE**
**Superseded in part by [D016](#d016) — see there for the denominator.**

The tracking sheet's "Average Daily Fans" column is **not** the API's
`daily_average` field. It is derived from `club_friend_history`:

```
mtd_avg = adjusted_fan_gain_cumulative / days_active_in_current_club
```

The API's own `daily_average` uses a different, longer window and produces a
**different ordering**, so using it would silently yield a wrong leaderboard and
a wrong promotion list.

---

## D003 — Compute day-over-day change ourselves; `daily_diff` is dead
**2026-08-07 · verified · ACTIVE**

The sheet's "Change since Prev Day" = today's `mtd_avg` − yesterday's.
The API returns `daily_diff = 0` for every single member. Unusable.

---

## D004 — Identity is `friend_viewer_id`; names are display-only
**2026-08-07 · verified · ACTIVE**

Players rename, and the sheet has already lost people to it. In the 08/06
screenshot: `yp loves curren` is now **YPurren Chan**, `Lumi@UrWall` is now
**P＠Ball** (five past names on record), `Aclone` is now **FineMo＠Aclone**.

Every name ever seen is kept in `member_names` and stays searchable, so a
member who renamed can still find themselves.

---

## D005 — Promotion sorts on MTD average daily fans
**2026-08-07 · ACTIVE**

Not total monthly gain (punishes anyone who joined late) and not lifetime
`fan_count` (favours veterans regardless of current activity).

---

## D006 — Leaders are pinned to their club but still occupy their rank
**2026-08-07 · ACTIVE — generalised by [D021](#d021)**

Leaders keep their seat through the reshuffle. They are **not** removed from the
sorted list first — they count against their club's 30 slots, so a low-ranked
leader displaces someone who earned the slot, and that person cascades down.

The displacement mechanic here is unchanged; D021 extends it to non-leaders.

---

## D007 — Club slot order and capacity
**2026-08-07 · from the sheet, left to right · SUPERSEDED BY [D020](#d020)**

The order below was the starting point. It is no longer fixed in code: clubs,
their order, their capacity and their pool membership are officer-editable data
(D020). カック・サドル's slot has since moved (see D020); its place in the pool
at all is still unresolved.

| slot | circle_id | name |
|---|---|---|
| 1 | 665160774 | UmaParty |
| 2 | 720848953 | TwomaParty |
| 3 | 928261417 | UmaPaThree |
| 4 | 877539742 | カック・サドル |
| 5 | 201002484 | UmaFourty |

30 slots each (150 total). Current membership is 30/30/30/29/28 = 147.
Capacity of 30 confirmed — see [D018](#d018).

---

## D008 — The promotion projection is live and public
**2026-08-07 · ACTIVE**

Every member sees where they would land if the reshuffle happened today,
updated daily — not officer-only, not a month-end snapshot.

The site **projects**; it never executes. Real moves happen in-game.

---

## D009 — `member_day` is keyed `(friend_viewer_id, ymd)`, not by club
**2026-08-07 · verified · ACTIVE**

Chrono re-attributes a member's **entire month** to whichever club they are in
now. Nine members who joined UmaParty on Aug 2–3 all carry rows for days 1–6.
A club-keyed table would therefore grow duplicate rows for the same day when
someone moves. `circle_id` is an attribute: the club observed that day.

---

## D010 — We record `club_stint` ourselves
**2026-08-07 · verified · ACTIVE**

Zero of 273 distinct viewer ids appear in more than one club's
`club_friend_profile`: a member who moves is **purged** from their old club's
records. Combined with D009, chronogenesis retains no record of cross-club
movement whatsoever.

Our daily snapshot is the only place that history can exist. Movement detection
must run **every day** or a reshuffle is lost permanently.

---

## D011 — Cloudflare Worker, not Pages
**2026-08-07 · ACTIVE**

Pages does not support Cron Triggers and this project needs scheduled
ingestion. One Worker serves static assets, the API, and the cron.

---

## D012 — Members unauthenticated; officers use username + password
**2026-08-07 · ACTIVE**

Member-facing pages are fully public with no gate. Anyone with the URL sees
every member name and fan count — the same data chronogenesis.net already
exposes, but the link will travel beyond the clubs' Discord.

Officers authenticate with a username and password stored in D1 (PBKDF2-SHA256,
per-user salt). No self-signup; admins create accounts.

---

## D013 — React here, though `umaguide` is Vue/VitePress
**2026-08-07 · ACTIVE**

Standalone app, no shared code. Chart stack still mirrors `umaguide`
(chart.js + `chartjs-plugin-crosshair`) to keep one charting idiom.

---

## D014 — Commits carry no Claude co-author trailer
**2026-08-07 · ACTIVE**

Conventional Commits, no trailers.

---

## D015 — Backfill from the API only
**2026-08-07 · ACTIVE**

`month_filter` exposes 14 months per club via `club_data_by_month`, which
predates the sheet. No Google Sheets import.

---

## D016 — The MTD denominator is days active in the club <a id="d016"></a>
**2026-08-07 · KoYu1 (Discord), relayed from Discord · verified · ACTIVE**

> "It counts from the day the data start… it runs a check to see where the
> first entry is, and last entry, and takes that as the date range."
> "\[If they moved on day 3\] their count is reset… only their time in threema
> counts towards our metric. So if they were in threema for 20 days, then their
> avg is taken over a 20 day period." — KoYu1

So the denominator is **days active in the current club**, not day-of-month.
A mid-month move resets that month's count.

Validated across all 30 UmaParty members against the 08/06 sheet:

| denominator | mean | p90 | worst |
|---|---|---|---|
| ÷ day-of-month | 6.46% | 18.97% | 20.61% |
| ÷ days active | **3.23%** | **6.57%** | 13.97% |

Per-mover, the difference is stark: cluegi 2.9% vs 19.1%, rennnnnnnnnnnko 4.7%
vs 20.6%, vae 0.7% vs 16.1%, spadez 0.0% vs 16.6%, Lia 0.3% vs 16.9%.

The residual ~3% is chrono re-interpolating since the snapshot and affects
movers and non-movers alike. The 13.97% worst case is **FineMo＠Aclone, who is
equally wrong under both denominators** — chrono revised their day-6 figure
after the sheet snapshot, so that member carries no signal about the formula.
`tests/derive.test.ts` therefore bounds mean and p90 rather than max.

This matters because the wrong divisor is **correct for 25 of 30 members** and
wrong only for the five who moved clubs — it would have passed a casual eyeball
check while mis-ranking exactly the people the promotion feature exists for.

---

## D017 — Keep both the official and the originally-observed daily gain
**2026-08-07 · ACTIVE**

When a member moves, chrono rewrites their earlier days to `0`. If we
snapshotted the real value the day before, ours is the only surviving copy.

`member_day.fan_gain` holds the official (post-wipe) number used for ranking.
`member_day.fan_gain_observed` holds the first non-zero we ever saw and is
**never overwritten by a later zero**.

Secondary reason: the wipe is **not uniform** — P＠Ball (8.1M), Universeman42
(3.4M) and Laco (0.29M) all joined 08-02 but kept a non-zero day 1, while six
others were zeroed. So leading zeros alone cannot distinguish a mover from a
genuinely inactive member, and `club_stint` (D010) is the authoritative source
for `days_active` once we have history. First-non-zero is only the bootstrap
heuristic for backfilled months.

---

## D018 — Club capacity is 30 <a id="d018"></a>
**2026-08-07 · CONFIRMED**

Confirmed: 30 slots per club. Current counts are 30/30/30/29/28 = 147
against 150.

Still stored as a per-club column rather than a constant, so officers can
resize a club without a deploy, but 30 is the answer rather than an assumption.
Anything past total capacity is routed to a flagged waitlist rather than
dropped.

---

## D019 — No minimum-days guard
**2026-08-07 · DECIDED — no guard**

Dividing by days-active (D016) means someone who joined yesterday with one
strong day can outrank a member who has ground all month.

Decision: **leave it.** No minimum-days threshold, no provisional flag, no
fallback to last month's average. A member is ranked on the rate they have
actually achieved in their current club, however few days that covers.

Do not add one later "for fairness" without asking — it was considered and
declined, not overlooked.

---

## D020 — Clubs are data, not code: officers add, reorder and resize them <a id="d020"></a>
**2026-08-07 · ACTIVE**

The `clubs` table is the source of truth for which clubs exist, their running
order, their capacity, and whether they take part in the reshuffle at all
(`in_pool`). The ingest iterates that table; nothing hardcodes the club list.
Officers can add a club ad-hoc by circle id.

**カック・サドル's position is not final.** Evidence that it may not belong in
the reshuffle pool at all:

- its members span overall ranks **3–147** with no banding, while the other
  four band cleanly at medians 22 / 50 / 86 / 116 — which is what a
  fans-sorted reshuffle actually produces
- its top member (oxateu) ranks **#3 of 147**, sitting in the bottom club
- its club rank (1016) beats UmaFourty's (1385) despite sitting below it
- it was created 2025-08-03, a day *before* UmaFourty, so it is not simply the
  most recent addition

With it in the pool, 72 of 147 members (49%) would change club; with it out,
42 of 119 (35%). Seeded in the pool at slot 5, then moved to slot 4 by
officers on 2026-08-14 (between UmaPaThree and UmaFourty) pending a decision
on whether it belongs in the pool at all.

**This question answers itself at the next reshuffle.** `club_stint` records
every cross-club move from go-live onward, so after the first reshuffle we
observe, a single query settles it: if members move between カック・サドル and the
UmaPa clubs, it is in the pool; if movement only ever happens among the four,
it is not. Until then the evidence above is circumstantial, and the seeded
value is a guess that officers can change in the admin area at any time.

---

## D021 — Officers can pin any member, not just leaders <a id="d021"></a>
**2026-08-07 · ACTIVE**

Leaders were a special case of a more general need: holding a member in a club
through the reshuffle regardless of rank — someone who asked to stay put, an
alt account, a member mid-negotiation.

One `member_pins` table with `kind` of `leader` or `manual`. Both behave
identically: the pin consumes a slot in its club and therefore displaces
someone who out-ranked them, who cascades down (D006). Pins are excluded from
a club's entry threshold, since a pinned member did not earn their place by
rank and their average says nothing about what it takes to get in.

Kept as history (`unset_at`) so past projections stay reproducible.


---

## D022 — Officers hand-edit the roster; the algorithm only proposes <a id="d022"></a>
**2026-08-07 · ACTIVE**

The promotion projection is a **proposal**, not a verdict. Officers get a
drag-and-drop roster editor and can move any member into any club before the
reshuffle is executed in-game.

- A `roster_plans` row per month, seeded from `projectPromotion`, then edited.
- `roster_plan_entries.source` records `projected` vs `manual`, and
  `projected_circle_id` keeps the algorithm's original choice, so the UI can
  always show exactly what a human changed and offer a reset.
- Hand edits persist across the nightly re-projection — re-running the
  algorithm must never silently undo an officer's decision.
- Capacity is enforced as a *warning*, not a hard block: officers are allowed
  to knowingly overfill a club, since the game is the real constraint and they
  may be mid-negotiation.
- A plan is `draft` until finalised, then frozen as the record of what was
  actually done that month.

This differs from pinning (D021): a pin is a standing rule that survives into
future months' projections, whereas a plan edit is a one-off override for a
single month. Both exist because they answer different questions — "always keep
this person here" versus "this month, do it differently".

---

## D023 — Stints start from the API's `join_time`, not first observation
**2026-08-07 · verified · ACTIVE**

When a member is first seen, their `club_stint.start_ymd` is taken from
`club_friend_profile.join_time` where it parses and is not in the future,
falling back to the day we observed them.

Without this, the first ever ingest dates all 147 stints to deploy day, which
would be plainly false and would corrupt the `days_active` denominator (D016)
for anyone who joined earlier in the month.

It recovered far more than expected. Start dates cluster hard on the 2nd and
3rd of each month — 19 on 2 Aug, 36 on 3 Aug, 7 on 2 Jun, 7 on 2 May, 6 on
2 Jul, 6 on 3 Jul — which is the signature of past reshuffles. D010 assumed
cross-club movement before deploy day was unrecoverable; the *dates* of past
moves turn out to be partially recoverable this way, though not which club
someone moved from.

---

## D024 — Rank against the newest day held, not today's date
**2026-08-07 · found by running it · ACTIVE**

Chronogenesis publishes a day in arrears: on the 7th, the newest member data is
for the 6th. `rank_overall` was being computed for the wall-clock date, so it
updated a day with no rows and left the column null for every member.

Anything that ranks or reads "the current standings" resolves the day with
`SELECT MAX(ymd) FROM member_day` rather than `new Date()`.

---

## D025 — Officers can overfill a club; capacity is a warning
**2026-08-07 · ACTIVE**

The roster editor (D022) shows a club's count against its capacity and marks it
red when over, but does not block the drop.

The game is the real constraint, not this site, and officers are often
mid-negotiation when they arrange a roster. A hard block would make the tool
lie about what they intend to do.

---

## D026 — Backfilled months use the heuristic denominator; live days use stints
**2026-08-07 · ACTIVE — known limitation**

`days_active` (D016) comes from our own `club_stint` records where we have them,
and otherwise from the leading-zeros heuristic in `derive.ts`.

Backfilled history predates any stint records, so every month before go-live
uses the heuristic. That is correct for genuine mid-month movers — the zeros are
exactly the signal — but wrong by one day for a member who was in the club all
month and happened to gain nothing on the 1st: their denominator shrinks and
their average is slightly overstated.

Not worth correcting: the affected case is rare, the error is one day out of a
month, and historical months are read-only context rather than anything the
reshuffle acts on. Live data, which *is* what the reshuffle acts on, uses stints
and is exact.

Worth knowing before treating a pre-go-live month as ground truth.

**Heuristic accuracy, measured 2026-08-07:** on the current August data the
leading-zeros heuristic flags exactly six members as mid-month movers — cluegi,
rennnnnnnnnnnko, YPurren Chan, vae, spadez and Lia — and all six genuinely
joined in August according to `join_time`. Zero false positives. So the
backfill's denominator is accurate in practice today; the stint path guards a
case that has not yet occurred rather than one currently going wrong.

---

## D027 — Historical club views show the current roster, not the historical one
**2026-08-07 · verified · ACTIVE — known limitation**

`member_day.circle_id` for any backfilled day is the club the member is in
**now**, not the club they were in on that day.

This falls straight out of D009: chronogenesis re-attributes a member's whole
month to their current club, so backfilling UmaParty's July writes
`circle_id = UmaParty` for the July days of everyone currently in UmaParty —
including days they actually spent elsewhere.

Measured on 15 July 2026: each club's row count for that day equals its
*current* member count (30 / 30 / 30 / 29), not its July roster.

Not fixable from the API — chronogenesis holds no historical roster either, and
its own month view behaves the same way. `club_stint` will make it correct for
every day from go-live onward, but nothing can recover it for earlier months.

Consequence for the UI: the club page's month picker must not claim to show who
was in the club that month. It shows today's members with that month's numbers,
and says so.

Member pages are unaffected — a member's own history is theirs regardless of
which club it is attributed to, and `club_stint` gives them a real club timeline
from go-live.

---

## D028 — Club history is hidden until we have observed a real move
**2026-08-07 · ACTIVE**

The member page had a "Club history" section from day one. With a fresh
database every member has exactly one stint, seeded from the API's `join_time`
(D023), so it rendered as e.g. "UmaParty · 2 September 2025 → now".

That is an assertion of unbroken membership since that date, which
chronogenesis does not actually know and which is often wrong in practice —
`join_time` is the club's own record and does not survive the moves we care
about. \*"club history seems to just be incorrect or incomplete… if we
can't derive this from chrono then no point having it."*

The section now renders only when a member has **more than one** stint, i.e.
when our own daily snapshots have recorded an actual transfer.

`club_stint` keeps being written every day regardless. The data collection is
the valuable part (D010 — chronogenesis retains no movement history at all, so
if we stop recording, nothing anywhere will have it) and it costs nothing. What
changed is only that we no longer display a single inferred stint as though it
were history.

Expect the section to start appearing after the first reshuffle we observe.

---

## D027 — Chrono owns who leads a club; an officer's lead pick is a proposal <a id="d027"></a>
**2026-08-07 · ACTIVE — inverts part of [D006](#d006)/[D021](#d021)**

A leader keeps their seat through the reshuffle (D006), but until now the
projection only knew about leaders an officer had explicitly pinned. Nobody had
pinned any, so every club lead was being projected as a normal member and shown
a demotion that would never happen — the site said the UmaParty lead drops to
TwomaParty while chrono had them leading UmaParty all along.

Chronogenesis reports the leader in `club_friend_profile`, stored as
`clubs.leader_viewer_id_api`. That is the game's own record, so it is now the
source the projection pins on. A lead keeps their seat whether or not an
officer got round to recording it.

- `buildPins()` synthesises a `leader` pin per club from
  `clubs.leader_viewer_id_api`, then adds `manual` pins from `member_pins`.
  Chrono wins a collision: a lead cannot also be manually pinned elsewhere.
- `member_pins` rows with `kind = 'leader'` no longer hold anyone. They are
  **proposals** — who the officers intend to make lead at the next reshuffle —
  and are shown as such in the officers area.
- `kind = 'manual'` pins are unchanged and still hold (D021).
- The clubs API returns chrono's lead as `leader_viewer_id` / `leader_name`,
  and the officers' pick separately as `proposed_leader_*`. It used to
  `COALESCE` them, which made a proposal indistinguishable from a fact.

The known cost is that chrono's leader field lags a real in-game handover by up
to a day, so for that day the projection holds the previous lead. That is
strictly better than holding nobody, which is what it did before.

---

## D029 — "Fill clubs" re-deals the unlocked; hand placements are locked <a id="d029"></a>
**2026-09-03 · ACTIVE**

Officers wanted a button that takes the manual moves they have already made and
fills the remaining seats to capacity by rank. `fillClubs()` is that button.

- **Locked** = anyone an officer has dragged this month
  (`roster_plan_entries.source = 'manual'`) **plus** the standing pins from
  D021/D027. Everyone else is re-dealt by `mtd_avg`.
- A hand placement beats a pin. Moving someone this month is a deliberate
  override of where their pin would otherwise put them.
- Locked members are seated first and stop at capacity, so a club an officer
  has knowingly overfilled (D025) comes back to capacity by spilling its
  lowest-ranked *unlocked* members into the next club down. That is the
  intended way to undo an overfill.
- **Idempotent**: pressing it twice changes nothing, so it is safe to press
  after each round of edits.
- Distinct from *Redo projection* (D022), which discards every hand edit and
  reseeds. Fill preserves them. Both exist because they answer different
  questions — "keep my decisions and tidy the rest" versus "start over".

It shares one placement pass with `projectPromotion`, so capacity, cascade,
thresholds and bubbles cannot drift between the two.

A member added by hand (D030) has no `member_day` row yet, so they enter the
fill with `mtdAvg = 0` and sort last. An unplaced one is anchored to the first
pooled club for the purposes of the run — a club id of `0` would read as
out-of-pool and strand them unplaced permanently.

---

## D030 — Members are added by trainer ID, resolved from ingested data <a id="d030"></a>
**2026-09-03 · ACTIVE**

Officers can add someone to the plan by trainer ID, for a member who has joined
but whom the ingest has not picked up yet.

**Chronogenesis has no working per-member lookup.** `GET /profile?friend_viewer_id=`
is in the public spec and looks like exactly the right call, but it answers
`422 {"detail":"Error"}` for every id — a real live one, a nonexistent one, and
every variation tried — while the same token gets `200` from `club_profile` in
the same session. `GET /friend_search` answers `500`. Verified 2026-09-03
against a real id taken from a live `club_profile` response. So this is not
auth, and not our request shape.

Resolution therefore goes:

1. `members` table — anyone the ingest has ever seen, including ex-members.
2. Otherwise the officer types the name, and the member is added with no
   average until the next ingest picks them up.

If `/profile` is ever fixed, step 2 gains a network fallback and nothing else
about this changes.

Added members are `source = 'manual'`, so a later fill (D029) never quietly
evicts someone an officer just placed. Adding to the plan does **not** write
`member_day`; the daily ingest remains its only writer.

---

## D031 — UmaPark was deactivated while chrono 403'd it <a id="d031"></a>
**2026-09-03 · RESOLVED same day — chrono added the club to our token**

Every ingest call for circle `548045752` (UmaPark) returns
`403 {"detail":"Error"}`, on both `/club_profile` and `/club_data_by_month`.

**It is not the token.** Checked on 2026-09-03: the other five clubs answer
`200` on the same key in the same session, and a deliberately nonexistent
`circle_id` returns exactly the same `403`. On this API a 403 means "no such
club for this key", so chrono has no record of UmaPark yet — plausibly because
it is new. Its leader (`702530333287`) appears in none of the five tracked
clubs, so the club is real; chrono just is not serving it.

- `is_active = 0` drops it from the ingest loop, the projection and the public
  clubs list, which all filter on that column. The row and its `slot_order`
  survive, so re-enabling is a one-line update when chrono catches up.
- Nothing else was affected while it was failing: the ingest already isolates
  each club, so the other five wrote their ~180 rows a day as normal. The only
  real cost was two error rows per day in `ingest_runs`.
- The 403 message used to read "bad token, or a Bearer prefix crept in", which
  sent us looking at auth for a club-availability problem. It now names both
  causes.

**Resolved the same day.** Chrono added circle `548045752` to our token, and
both `/club_profile` and `/club_data_by_month` now return 200. `0007` re-enables
the club and corrects its lead, which chrono reports as `903460475258` rather
than the `702530333287` seeded in `0004`.

`0005` is deliberately left in the migration list rather than edited or
reverted: it had already been pushed, and rewriting an applied migration
desyncs any database that ran it. The pair reads as a record of what happened.

The lasting change is the 403 message, which no longer blames the token for
what turned out to be a club-availability problem.

---

## D032 — Days the month does not have are dropped at ingest <a id="d032"></a>
**2026-09-03 · ACTIVE**

`club_profile` covers a rolling window, so for the first days of a month it
still carries the tail of the previous one. `ingestClubProfile` took the year
and month from *today* and stamped them onto whatever `actual_date` chrono
returned, so on 1 September the row for 31 August was written as **20260931** —
a date September does not have.

That one row poisoned the whole site. "Data as of" and every leaderboard read
`MAX(ymd) FROM member_day`, and 20260931 sorts above every real September day,
so the site served a snapshot taken *before the monthly reshuffle*: the date
read "31 September 2026", and members showed in the clubs they were in during
August. Chrono itself was correct throughout — two members visibly in
UmaPaThree there were shown in UmaParty by us.

- `isImpossibleDay(year, month, day)` rejects any day past the real length of
  that month, leap years included.
- Both writers skip such rows: the `club_day` loop in `ingestClubProfile`, and
  the per-member loop in `deriveMemberDays`.
- Nothing is lost. The genuine 31 August rows are written under 20260831 by the
  month-rollover pass (`backfillPreviousMonth`), which derives its year and
  month from the month being read rather than from today.
- `0006_drop_impossible_days.sql` deletes the rows already stored, in
  `member_day` and `club_day`.

The bug only fires in the first days of a month, which is exactly when the
reshuffle makes the club column matter most.

---

## D033 — A payload's month comes from chrono, not from our clock <a id="d033"></a>
**2026-09-04 · ACTIVE**

`ingestClubProfile` dated rows by `now`, stamping today's year and month onto
whatever `club_profile` returned. On the 1st that is wrong.

Chrono lands the member tables at 10 UTC but the club tables not until 15 UTC,
so the 10:15 run on 1 September still saw **August's** member history — and
wrote all of it again as September. The 10:15 runs wrote 1,026-1,095 rows per
club where a daily run writes ~180.

The result was a phantom 4-30 September, byte-identical to August: viewer
700494191843 held 1,830,883,003 fans on both 20260830 and 20260930. Because the
site takes its day from `MAX(ymd)`, it served that phantom month — the header
read a September date and members appeared in their pre-reshuffle clubs.

- `payloadMonth()` reads `month_filter[0].sdate`, which is chrono's own
  statement of the month a payload covers (newest first, verified). The clock
  is used only if `month_filter` is absent.
- Observation dates keep using `now`: `first_seen_ymd`, `last_seen_ymd`,
  `member_names.first_seen_ymd` and the stint diff all mean "when did we see
  this", which is a different question from "what month is this data".
- `0008` deletes the phantom rows. Verified first: every day from the 4th to
  the 30th matched the same member's August `fan_count` exactly, and the four
  rows without an August twin were mid-August joiners carrying `mtd_avg = 0`.
  The 1st-3rd are genuine and were left alone — their row counts vary
  (167/179/133) the way real ingest days do.

D032 was the same incident seen through a narrower lens: it caught only the
31st, which stood out by being a date September does not have. The days that
exist in both months needed this fix.

**The 3rd was phantom too, and `0008` stopped one day short of it.** Row counts
alone made the 1st-3rd look genuine (167/179/133), so the delete began at the
4th. It should have begun at the 3rd: all 133 of its rows carry a `fan_count`
identical to the same member's 3 August row, pre-reshuffle `circle_id`
included. Viewer 700494191843 holds 1,347,269,148 on both 20260803 and
20260903 — *lower* than its own 20260902 value, which is impossible for a
cumulative count. `0009` removes it. The 1st and 2nd are genuine: 9 and 7
incidental matches, and chrono still serves exactly days 1 and 2 per club.

The lesson for next month: verify a suspect day against the previous month's
same day, rather than trusting that varying row counts mean real data.

---

## D034 — Club membership is chrono's roster, stored, not our derived one <a id="d034"></a>
**2026-09-04 · ACTIVE**

`club_profile` returns `circle_user_array`: exactly who is in a club, matching
`member_num`, with nobody in two clubs at once. We used it to gate one loop at
ingest and then discarded it, deriving "who is in this club" from
`member_day.circle_id` instead.

That derivation is wrong the moment somebody leaves. Rows written on earlier
days keep the old `circle_id` and nothing revisits them, so カック・サドル listed
**33 members** on the day four of them left — more than the game permits.

- `club_roster (circle_id, ymd, friend_viewer_id)` stores the array as given,
  one row per club per day, so any past day can be read back.
- The ingest also deletes roster rows for members no longer in the array, since
  someone who leaves during the day is gone from it.
- `/api/clubs`, `/api/club/:id` and `/api/standings` join it instead of trusting
  `member_day.circle_id`. Standings matters most: a departed member was being
  ranked and dealt a seat another member had earned.
- `0011` reconstructs history from `club_stint`. Its fallback arm — for rows no
  stint covers — must also exclude members whose stint *ended*, or the four who
  left come straight back and the club reads 33 again.

The general lesson, and the reason this had to be fixed twice: **when chrono
states a fact, store the fact.** Deriving it and then correcting the derivation
in SQL is how we got a phantom month (D033) and a 33-member club from the same
underlying habit. `member_num`, `circle_user_array` and `month_filter` are all
chrono telling us plainly; each one we ignored became a bug.
