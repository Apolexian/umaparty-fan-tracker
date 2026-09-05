import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  daysActiveFor,
  deriveMemberDays,
  firstAccrualDay,
  isImpossibleDay,
  latestYmd,
  leaderboardForDay,
  mtdAverage,
  preStintCarryover,
  stintCumulative,
  toYmd,
} from "../src/worker/derive.ts";
import type { ClubProfileResponse } from "../src/worker/types.ts";
import { AUGUST_MOVERS, SHEET_UMAPARTY_20260806 } from "./sheet-snapshot.ts";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );

const profile: ClubProfileResponse = fixture("club_profile_665160774_20260807.json");
const UMAPARTY = 665160774;

const currentRoster = new Set(profile.club[0]!.circle_user_array);

/**
 * Resolve a sheet row to a member by exact current name, restricted to the
 * current roster. Deliberately strict — a fuzzy matcher was tried first and
 * silently resolved several sheet names to ex-members.
 */
function findMember(entry: { currentName: string }) {
  return profile.club_friend_profile.find(
    (p) => currentRoster.has(p.friend_viewer_id) && p.name === entry.currentName,
  );
}

const derived = deriveMemberDays(
  profile.club_friend_history.filter((r) => currentRoster.has(r.friend_viewer_id)),
  { year: 2026, month: 8, circleId: UMAPARTY },
);

const latest = latestYmd(derived);
const board = leaderboardForDay(derived, latest);
const byMember = new Map(board.map((r) => [r.friendViewerId, r]));

describe("ymd helpers", () => {
  it("composes YYYYMMDD from a month context and a day-of-month", () => {
    expect(toYmd(2026, 8, 6)).toBe(20260806);
    expect(toYmd(2026, 12, 31)).toBe(20261231);
  });
});

describe("mtdAverage", () => {
  it("divides cumulative by days active", () => {
    expect(mtdAverage(63193363, 5)).toBe(12638673);
  });

  it("never divides by zero", () => {
    expect(mtdAverage(1000, 0)).toBe(0);
  });
});

describe("firstAccrualDay", () => {
  it("skips the zeroed days a mid-month move leaves behind", () => {
    const rows = [
      { actual_date: 1, adjusted_interpolated_fan_gain: 0 },
      { actual_date: 2, adjusted_interpolated_fan_gain: 12474241 },
      { actual_date: 3, adjusted_interpolated_fan_gain: 14105707 },
    ] as never;
    expect(firstAccrualDay(rows)).toBe(2);
  });

  it("falls back to the earliest row when nothing was ever accrued", () => {
    const rows = [
      { actual_date: 3, adjusted_interpolated_fan_gain: 0 },
      { actual_date: 4, adjusted_interpolated_fan_gain: 0 },
    ] as never;
    expect(firstAccrualDay(rows)).toBe(3);
  });

  it("prefers an explicit stint start over the heuristic", () => {
    // A member who genuinely gained nothing on day 1 but never moved: the
    // heuristic would wrongly shrink their denominator to 5.
    const rows = [
      { actual_date: 1, adjusted_interpolated_fan_gain: 0 },
      { actual_date: 2, adjusted_interpolated_fan_gain: 500 },
      { actual_date: 6, adjusted_interpolated_fan_gain: 700 },
    ] as never;
    expect(daysActiveFor(rows, 6)).toBe(5);
    expect(daysActiveFor(rows, 6, 1)).toBe(6);
  });
});

const nameOf = (viewerId: number) =>
  profile.club_friend_profile.find((x) => x.friend_viewer_id === viewerId)?.name;

describe("sheet parity (D002 / D016)", () => {
  it("agrees with the sheet on the clear leaders", () => {
    // Only the top two are asserted by position. Ranks 3-5 sit within 3% of
    // each other, close enough that a day of chrono re-interpolation reorders
    // them legitimately; ordering there is covered by the displacement test.
    expect(board.slice(0, 2).map((r) => nameOf(r.friendViewerId))).toEqual([
      "Haru no Owari",
      "Jin",
    ]);
  });

  it("resolves every sheet row to exactly one current member", () => {
    // Fails loudly if someone renames and the fixture is not updated, rather
    // than quietly dropping them the way the name-keyed sheet does.
    for (const entry of SHEET_UMAPARTY_20260806) {
      expect(findMember(entry), `unresolved: "${entry.sheetName}"`).toBeDefined();
    }
  });

  it("returns one row per current member", () => {
    expect(board).toHaveLength(currentRoster.size);
  });

  it("keeps every member within a few places of their sheet rank", () => {
    const displacements = SHEET_UMAPARTY_20260806.map((entry) => {
      const member = findMember(entry)!;
      const derivedRank = board.findIndex((r) => r.friendViewerId === member.friend_viewer_id) + 1;
      return { name: entry.sheetName, delta: Math.abs(derivedRank - entry.rank) };
    });

    const worst = displacements.reduce((a, b) => (a.delta > b.delta ? a : b));
    const mean = displacements.reduce((s, d) => s + d.delta, 0) / displacements.length;

    // With the day-of-month denominator the movers shift by 10+ places, so
    // these bounds fail hard if the wrong divisor comes back.
    expect(worst.delta, `worst was ${worst.name}, off by ${worst.delta}`).toBeLessThanOrEqual(5);
    expect(mean, `mean displacement ${mean.toFixed(2)}`).toBeLessThan(2);
  });

  // The regression guard for D016. Measured against the 08/06 sheet:
  //
  //                    mean    p90     worst
  //   ÷ days active    3.23%   6.57%   13.97%
  //   ÷ day-of-month   6.46%  18.97%   20.61%
  //
  // Thresholds sit between the two so reintroducing the wrong divisor fails
  // loudly instead of looking "close enough".
  //
  // p90 rather than worst, deliberately: FineMo＠Aclone ("Aclone" in the sheet)
  // is 14% off under *both* denominators — chrono revised their day-6 figure
  // between the 08/06 snapshot and the fixture pull, so that one member's
  // error carries no signal about the formula. A max-based bound would be
  // dominated by it; p90 is not, and still separates the two cases by 3x.
  it("stays within tolerance of the 2026/08/06 sheet", () => {
    const errors = SHEET_UMAPARTY_20260806.map((entry) => {
      const member = findMember(entry)!;
      const row = byMember.get(member.friend_viewer_id);
      expect(row, `no derived row for "${entry.sheetName}"`).toBeDefined();
      return {
        name: entry.sheetName,
        pct: (Math.abs(row!.mtdAvg - entry.avg) / entry.avg) * 100,
      };
    });

    const pcts = errors.map((e) => e.pct).sort((a, b) => a - b);
    const mean = pcts.reduce((sum, p) => sum + p, 0) / pcts.length;
    const p90 = pcts[Math.floor(pcts.length * 0.9)]!;

    expect(mean, `mean abs error ${mean.toFixed(2)}%`).toBeLessThan(4.5);
    expect(p90, `p90 abs error ${p90.toFixed(2)}%`).toBeLessThan(10);
  });

  // Same fixture, forced to the wrong denominator. If this ever passes the
  // bounds above, the guard has stopped discriminating and needs retuning.
  it("would fail those bounds with the day-of-month denominator", () => {
    const everyoneFromDayOne = new Map(
      profile.club_friend_history.map((r) => [r.friend_viewer_id, 1]),
    );
    const wrong = deriveMemberDays(
      profile.club_friend_history.filter((r) => currentRoster.has(r.friend_viewer_id)),
      { year: 2026, month: 8, circleId: UMAPARTY, stintStarts: everyoneFromDayOne },
    );
    const wrongBoard = new Map(
      leaderboardForDay(wrong, latestYmd(wrong)).map((r) => [r.friendViewerId, r]),
    );

    const pcts = SHEET_UMAPARTY_20260806.map((entry) => {
      const row = wrongBoard.get(findMember(entry)!.friend_viewer_id)!;
      return (Math.abs(row.mtdAvg - entry.avg) / entry.avg) * 100;
    }).sort((a, b) => a - b);

    const mean = pcts.reduce((sum, p) => sum + p, 0) / pcts.length;
    const p90 = pcts[Math.floor(pcts.length * 0.9)]!;

    expect(mean).toBeGreaterThan(4.5);
    expect(p90).toBeGreaterThan(10);
  });

  it("handles the members who moved clubs mid-month", () => {
    for (const currentName of AUGUST_MOVERS) {
      const entry = SHEET_UMAPARTY_20260806.find((e) => e.currentName === currentName)!;
      const member = findMember(entry)!;
      const row = byMember.get(member.friend_viewer_id);
      expect(row, `no derived row for mover "${currentName}"`).toBeDefined();

      // They joined on the 2nd or 3rd, so they have fewer active days than the
      // day-of-month. If this ever equals the day-of-month, the denominator
      // has regressed to the wrong one.
      expect(row!.daysActive, `${currentName} daysActive`).toBeLessThan(row!.ymd % 100);

      const pct = (Math.abs(row!.mtdAvg - entry.avg) / entry.avg) * 100;
      expect(pct, `${currentName} off by ${pct.toFixed(2)}%`).toBeLessThan(5);
    }
  });
});

describe("day-over-day change (D003)", () => {
  it("computes deltas rather than trusting the API's daily_diff", () => {
    // Every member's daily_diff is 0 in the response; ours must not be.
    const apiDiffs = profile.club_friend_profile.map((p) => p.daily_diff);
    expect(apiDiffs.every((d) => d === 0)).toBe(true);

    const ourDeltas = board.filter((r) => r.mtdAvgDelta !== 0);
    expect(ourDeltas.length).toBeGreaterThan(board.length / 2);
  });
});

describe("ranking", () => {
  it("assigns dense sequential ranks within the club", () => {
    const ranks = board.map((r) => r.rankInClub);
    expect(ranks).toEqual(Array.from({ length: board.length }, (_, i) => i + 1));
  });
});

describe("impossible days — chrono's rolling window (D032)", () => {
  it("knows which days a month cannot have", () => {
    expect(isImpossibleDay(2026, 9, 31)).toBe(true); // September has 30
    expect(isImpossibleDay(2026, 9, 30)).toBe(false);
    expect(isImpossibleDay(2026, 8, 31)).toBe(false); // August has 31
    expect(isImpossibleDay(2026, 2, 29)).toBe(true); // 2026 is not a leap year
    expect(isImpossibleDay(2024, 2, 29)).toBe(false); // 2024 is
    expect(isImpossibleDay(2026, 9, 0)).toBe(true);
  });

  it("drops last month's tail instead of minting a date that cannot exist", () => {
    // What club_profile looks like on 1 September: August 31 is still in the
    // window. Stamped with the current month it becomes 20260931, which then
    // wins MAX(ymd) and makes the whole site read a month stale.
    const rows = [
      {
        friend_viewer_id: 1,
        friend_name: "m",
        actual_date: 31,
        interpolated_fan_count: 900,
        adjusted_interpolated_fan_gain: 100,
        adjusted_fan_gain_cumulative: 900,
      },
      {
        friend_viewer_id: 1,
        friend_name: "m",
        actual_date: 1,
        interpolated_fan_count: 1000,
        adjusted_interpolated_fan_gain: 100,
        adjusted_fan_gain_cumulative: 100,
      },
    ];

    const out = deriveMemberDays(rows, { year: 2026, month: 9, circleId: 1 });

    expect(out.map((r) => r.ymd)).toEqual([20260901]);
    expect(out.every((r) => r.ymd !== 20260931)).toBe(true);
  });

  it("keeps day 31 when the month really has one", () => {
    const rows = [
      {
        friend_viewer_id: 1,
        friend_name: "m",
        actual_date: 31,
        interpolated_fan_count: 900,
        adjusted_interpolated_fan_gain: 100,
        adjusted_fan_gain_cumulative: 900,
      },
    ];

    const out = deriveMemberDays(rows, { year: 2026, month: 8, circleId: 1 });
    expect(out.map((r) => r.ymd)).toEqual([20260831]);
  });
});

describe("pre-stint carryover — the un-wiped mover (D035)", () => {
  // moo, 211980162466, as chrono served them on 4 September 2026. Moved
  // TwomaParty -> UmaParty on the 2nd, and chrono did NOT zero the 1st, so the
  // cumulative still carries 7,852,303 fans earned in the old club.
  const moo = [
    { actual_date: 1, gain: 7852303, cum: 7852303 },
    { actual_date: 2, gain: 11045603, cum: 18897906 },
    { actual_date: 3, gain: 11441240, cum: 30339146 },
    { actual_date: 4, gain: 12464211, cum: 42803357 },
  ].map((r) => ({
    friend_viewer_id: 211980162466,
    friend_name: "moo",
    actual_date: r.actual_date,
    interpolated_fan_count: 0,
    adjusted_interpolated_fan_gain: r.gain,
    adjusted_fan_gain_cumulative: r.cum,
  }));

  const stintStarts = new Map([[211980162466, 2]]);

  it("subtracts fans earned in the previous club and the split join day", () => {
    const out = deriveMemberDays(moo, {
      year: 2026,
      month: 9,
      circleId: 665160774,
      stintStarts,
    });

    // Joined on the 2nd, so the 2nd is split and the metric starts on the 3rd.
    expect(out.map((r) => r.ymd)).toEqual([20260903, 20260904]);

    const day4 = out.find((r) => r.ymd === 20260904)!;
    expect(day4.daysActive).toBe(2);
    // 42,803,357 - 18,897,906 (through the join day) = 23,905,451 over 2 days.
    expect(day4.mtdCumulative).toBe(23905451);
    expect(day4.mtdAvg).toBe(11952726);
  });

  it("no longer reports the inflated average that shipped", () => {
    const out = deriveMemberDays(moo, {
      year: 2026,
      month: 9,
      circleId: 665160774,
      stintStarts,
    });

    // What the site served on 4 September: the whole month's fans over the
    // stint's days. ~22% too high, and it out-ranked members who never moved.
    expect(out.find((r) => r.ymd === 20260904)!.mtdAvg).not.toBe(14267786);
    // Nor the intermediate D035 value, which still counted the split join day.
    expect(out.find((r) => r.ymd === 20260904)!.mtdAvg).not.toBe(11650351);
  });

  it("leaves a member chrono did wipe untouched", () => {
    // The usual case: pre-move days zeroed, so the cumulative already starts
    // at the stint and there is nothing to subtract.
    const wiped = moo.map((r) =>
      r.actual_date < 2
        ? { ...r, adjusted_interpolated_fan_gain: 0, adjusted_fan_gain_cumulative: 0 }
        : {
            ...r,
            adjusted_fan_gain_cumulative: r.adjusted_fan_gain_cumulative - 7852303,
          },
    );

    const out = deriveMemberDays(wiped, {
      year: 2026,
      month: 9,
      circleId: 665160774,
      stintStarts,
    });

    const day4 = out.find((r) => r.ymd === 20260904)!;
    expect(day4.mtdCumulative).toBe(23905451);
    expect(day4.mtdAvg).toBe(11952726);
  });

  it("leaves a member who never moved untouched", () => {
    const out = deriveMemberDays(moo, {
      year: 2026,
      month: 9,
      circleId: 665160774,
      stintStarts: new Map([[211980162466, 1]]),
    });

    // A stint that predates the month has no split join day to drop.
    const day4 = out.find((r) => r.ymd === 20260904)!;
    expect(day4.daysActive).toBe(4);
    expect(day4.mtdCumulative).toBe(42803357);
    expect(day4.mtdAvg).toBe(10700839);
  });

  it("keeps the heuristic's first day when we have no real join date", () => {
    // Without club_stint we only have leading zeros (D026), which mark the
    // first day chrono reported a gain — not a join date. Dropping a day on
    // that basis would delete real history.
    const out = deriveMemberDays(moo, { year: 2026, month: 9, circleId: 665160774 });
    expect(out.map((r) => r.ymd)).toEqual([20260901, 20260902, 20260903, 20260904]);
    expect(out.find((r) => r.ymd === 20260904)!.daysActive).toBe(4);
  });

  it("counts the un-wiped movers so chrono changing behaviour is visible", () => {
    expect(preStintCarryover(moo, { year: 2026, month: 9, stintStarts })).toBe(1);

    const wiped = moo.map((r) =>
      r.actual_date < 2 ? { ...r, adjusted_fan_gain_cumulative: 0 } : r,
    );
    expect(preStintCarryover(wiped, { year: 2026, month: 9, stintStarts })).toBe(0);

    // Never moved, so there is no pre-stint window to carry anything.
    expect(
      preStintCarryover(moo, {
        year: 2026,
        month: 9,
        stintStarts: new Map([[211980162466, 1]]),
      }),
    ).toBe(0);
  });

  it("never returns a negative numerator", () => {
    expect(stintCumulative(100, 500)).toBe(0);
  });
});
