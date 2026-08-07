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
**2026-08-07 · Ivan · ACTIVE**

Not total monthly gain (punishes anyone who joined late) and not lifetime
`fan_count` (favours veterans regardless of current activity).

---

## D006 — Leaders are pinned to their club but still occupy their rank
**2026-08-07 · Ivan · ACTIVE — generalised by [D021](#d021)**

Leaders keep their seat through the reshuffle. They are **not** removed from the
sorted list first — they count against their club's 30 slots, so a low-ranked
leader displaces someone who earned the slot, and that person cascades down.

The displacement mechanic here is unchanged; D021 extends it to non-leaders.

---

## D007 — Club slot order and capacity
**2026-08-07 · Ivan (sheet, left to right) · SUPERSEDED BY [D020](#d020)**

The order below was the starting point. It is no longer fixed in code: clubs,
their order, their capacity and their pool membership are officer-editable data
(D020), and カック・サドル's position specifically is unresolved.

| slot | circle_id | name |
|---|---|---|
| 1 | 665160774 | UmaParty |
| 2 | 720848953 | TwomaParty |
| 3 | 928261417 | UmaPaThree |
| 4 | 201002484 | UmaFourty |
| 5 | 877539742 | カック・サドル |

30 slots each (150 total). Current membership is 30/30/30/29/28 = 147.
**Capacity of exactly 30 is assumed, not confirmed** — see [D018](#d018).

---

## D008 — The promotion projection is live and public
**2026-08-07 · Ivan · ACTIVE**

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
**2026-08-07 · Ivan · ACTIVE**

Member-facing pages are fully public with no gate. Anyone with the URL sees
every member name and fan count — the same data chronogenesis.net already
exposes, but the link will travel beyond the clubs' Discord.

Officers authenticate with a username and password stored in D1 (PBKDF2-SHA256,
per-user salt). No self-signup; admins create accounts.

---

## D013 — React here, though `umaguide` is Vue/VitePress
**2026-08-07 · Ivan · ACTIVE**

Standalone app, no shared code. Chart stack still mirrors `umaguide`
(chart.js + `chartjs-plugin-crosshair`) to keep one charting idiom.

---

## D014 — Commits carry no Claude co-author trailer
**2026-08-07 · Ivan · ACTIVE**

Conventional Commits, no trailers.

---

## D015 — Backfill from the API only
**2026-08-07 · Ivan · ACTIVE**

`month_filter` exposes 14 months per club via `club_data_by_month`, which
predates the sheet. No Google Sheets import.

---

## D016 — The MTD denominator is days active in the club <a id="d016"></a>
**2026-08-07 · KoYu1 (Discord), relayed by Ivan · verified · ACTIVE**

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

## D018 — Club capacity defaults to 30, per club <a id="d018"></a>
**2026-08-07 · ACTIVE**

Current counts are 30/30/30/29/28. Capacity is a per-club column defaulting to
30, editable by officers, and anything past total capacity is routed to a
flagged waitlist rather than dropped.

---

## D019 — Minimum-days guard on the promotion ranking
**OPEN — deliberately not decided**

Dividing by days-active (D016) means someone who joined yesterday with one
strong day can outrank a member who has ground all month. Harmless today (all
current movers have 5 of 6 days) but it will bite on a reshuffle day.

Suggestion, not implemented: rank members with fewer than ~3 active days on
their previous month's average, flagged provisional. This is a fairness rule
for the community, not a technical call — Ivan's to make.

---

## D020 — Clubs are data, not code: officers add, reorder and resize them <a id="d020"></a>
**2026-08-07 · Ivan · ACTIVE**

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
42 of 119 (35%). Seeded in the pool at slot 5 pending Ivan's decision.

---

## D021 — Officers can pin any member, not just leaders <a id="d021"></a>
**2026-08-07 · Ivan · ACTIVE**

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
**2026-08-07 · Ivan · ACTIVE**

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
