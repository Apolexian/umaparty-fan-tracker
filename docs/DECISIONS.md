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
**2026-08-07 · Ivan · ACTIVE**

Leaders keep their seat through the reshuffle. They are **not** removed from the
sorted list first — they count against their club's 30 slots, so a low-ranked
leader displaces someone who earned the slot, and that person cascades down.

---

## D007 — Club slot order and capacity
**2026-08-07 · Ivan (sheet, left to right) · ACTIVE**

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

| denominator | mean abs error | worst |
|---|---|---|
| ÷ day-of-month | 5.85% | **20.6%** (every mover) |
| ÷ days active | **2.86%** | 7.0% |

The residual ~3% is chrono re-interpolating since the snapshot and affects
movers and non-movers alike.

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

## D018 — Club capacity is exactly 30 <a id="d018"></a>
**OPEN — assumed, not confirmed**

Current counts are 30/30/30/29/28. The code treats 30 as the cap and routes
anything past 150 to a flagged waitlist rather than dropping people. Needs
confirming with Ivan.

---

## D019 — Minimum-days guard on the promotion ranking
**OPEN — deliberately not decided**

Dividing by days-active (D016) means someone who joined yesterday with one
strong day can outrank a member who has ground all month. Harmless today (all
five current movers have 5 of 6 days) but it will bite on a reshuffle day.

Suggestion, not implemented: rank members with fewer than ~3 active days on
their previous month's average, flagged provisional. This is a fairness rule
for the community, not a technical call — Ivan's to make.
