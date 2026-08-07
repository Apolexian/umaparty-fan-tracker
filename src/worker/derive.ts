// The metric layer. Everything the leaderboard and the promotion projection
// rank on is computed here — none of it comes straight off the API.
//
// See docs/DECISIONS.md D002, D003, D016, D017.

import type { ClubFriendHistoryOut, MemberDayRow } from "./types.ts";

/** Compose a YYYYMMDD integer from a month context and a day-of-month. */
export function toYmd(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day;
}

export function ymdToParts(ymd: number): { year: number; month: number; day: number } {
  return {
    year: Math.floor(ymd / 10000),
    month: Math.floor(ymd / 100) % 100,
    day: ymd % 100,
  };
}

/** YYYYMM for grouping. */
export function ymdToYearMonth(ymd: number): number {
  return Math.floor(ymd / 100);
}

/**
 * The first day of the month this member actually started accruing in their
 * current club.
 *
 * Chrono zeroes the daily gains for any day before a mid-month club move, so
 * the first non-zero entry marks when their stint began. This is a *heuristic*:
 * a member who simply gained nothing on day 1 looks identical to one who moved.
 * Prefer `club_stint` data when we have it — see `daysActiveFor`.
 */
export function firstAccrualDay(rows: ClubFriendHistoryOut[]): number {
  const firstNonZero = rows.find((r) => r.adjusted_interpolated_fan_gain > 0);
  if (firstNonZero) return firstNonZero.actual_date;
  // Never accrued anything this month; fall back to the earliest row present.
  return rows.length > 0 ? rows[0]!.actual_date : 1;
}

/**
 * Days this member has been active in their current club, as of `upToDay`.
 *
 * This is the denominator of the headline metric, and getting it wrong is the
 * single easiest way to break this project: dividing by day-of-month instead
 * produces correct numbers for members who stayed put and numbers ~20% too low
 * for anyone who moved mid-month. See D016.
 *
 * @param stintStartDay day-of-month the member's stint in this club began, if
 *   known from our own `club_stint` records. Authoritative when present.
 */
export function daysActiveFor(
  rows: ClubFriendHistoryOut[],
  upToDay: number,
  stintStartDay?: number,
): number {
  const start = stintStartDay ?? firstAccrualDay(rows);
  return Math.max(1, upToDay - start + 1);
}

/**
 * Month-to-date average daily fans — the number the tracking sheet shows and
 * the number the promotion reshuffle sorts on.
 */
export function mtdAverage(cumulative: number, daysActive: number): number {
  if (daysActive <= 0) return 0;
  return Math.round(cumulative / daysActive);
}

export interface DeriveOptions {
  /** Month these rows belong to. */
  year: number;
  month: number;
  circleId: number;
  /** Latest fan_count per member, from club_friend_profile, if available. */
  fanCounts?: Map<number, number>;
  /** Stint start day-of-month per member, from our own club_stint records. */
  stintStarts?: Map<number, number>;
}

/**
 * Turn one club's `club_friend_history` into per-member, per-day rows with the
 * derived metric attached.
 *
 * Returns rows for every day present in the input, so a backfilled month yields
 * the whole month and a live pull yields month-to-date.
 */
export function deriveMemberDays(
  history: ClubFriendHistoryOut[],
  opts: DeriveOptions,
): MemberDayRow[] {
  const byMember = new Map<number, ClubFriendHistoryOut[]>();
  for (const row of history) {
    let rows = byMember.get(row.friend_viewer_id);
    if (!rows) {
      rows = [];
      byMember.set(row.friend_viewer_id, rows);
    }
    rows.push(row);
  }

  const out: MemberDayRow[] = [];

  for (const [friendViewerId, rawRows] of byMember) {
    const rows = [...rawRows].sort((a, b) => a.actual_date - b.actual_date);
    const stintStart = opts.stintStarts?.get(friendViewerId);
    const start = stintStart ?? firstAccrualDay(rows);

    let prevAvg: number | null = null;

    for (const row of rows) {
      // Days before the stint began carry no meaningful average.
      if (row.actual_date < start) continue;

      const daysActive = Math.max(1, row.actual_date - start + 1);
      const mtdAvg = mtdAverage(row.adjusted_fan_gain_cumulative, daysActive);

      out.push({
        friendViewerId,
        ymd: toYmd(opts.year, opts.month, row.actual_date),
        circleId: opts.circleId,
        fanCount: row.interpolated_fan_count,
        fanGain: row.adjusted_interpolated_fan_gain,
        mtdCumulative: row.adjusted_fan_gain_cumulative,
        daysActive,
        mtdAvg,
        mtdAvgDelta: prevAvg === null ? 0 : mtdAvg - prevAvg,
        rankInClub: 0, // assigned below
      });

      prevAvg = mtdAvg;
    }
  }

  assignRanks(out);
  return out;
}

/**
 * Assign `rankInClub` within each (club, day) group, ordered by mtdAvg desc.
 * Mutates in place.
 */
export function assignRanks(rows: MemberDayRow[]): void {
  const groups = new Map<string, MemberDayRow[]>();
  for (const row of rows) {
    const key = `${row.circleId}:${row.ymd}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(row);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => b.mtdAvg - a.mtdAvg);
    group.forEach((row, i) => {
      row.rankInClub = i + 1;
    });
  }
}

/**
 * The leaderboard for a single day: one row per member, highest average first.
 * This is the sheet, reproduced.
 */
export function leaderboardForDay(rows: MemberDayRow[], ymd: number): MemberDayRow[] {
  return rows.filter((r) => r.ymd === ymd).sort((a, b) => b.mtdAvg - a.mtdAvg);
}

/** The most recent day present in a set of rows. */
export function latestYmd(rows: MemberDayRow[]): number {
  return rows.reduce((max, r) => (r.ymd > max ? r.ymd : max), 0);
}
