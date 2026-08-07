import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CLUBS } from "../src/worker/chrono.ts";
import { deriveMemberDays, latestYmd, leaderboardForDay } from "../src/worker/derive.ts";
import {
  CLUB_CAPACITY,
  projectPromotion,
  type PromotionCandidate,
  type PromotionClub,
  type Pin,
} from "../src/worker/promotion.ts";
import type { ClubProfileResponse } from "../src/worker/types.ts";

const clubs: PromotionClub[] = CLUBS.map((c) => ({
  circleId: c.circleId,
  name: c.name,
  slotOrder: c.slotOrder,
}));

/** Build the real ~147-member candidate list from all five club fixtures. */
function loadCandidates(): PromotionCandidate[] {
  const candidates: PromotionCandidate[] = [];

  for (const club of CLUBS) {
    const profile: ClubProfileResponse = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(`./fixtures/club_profile_${club.circleId}_20260807.json`, import.meta.url),
        ),
        "utf8",
      ),
    );

    const roster = new Set(profile.club[0]!.circle_user_array);
    const names = new Map(profile.club_friend_profile.map((p) => [p.friend_viewer_id, p.name]));

    const rows = deriveMemberDays(
      profile.club_friend_history.filter((r) => roster.has(r.friend_viewer_id)),
      { year: 2026, month: 8, circleId: club.circleId },
    );

    for (const row of leaderboardForDay(rows, latestYmd(rows))) {
      candidates.push({
        friendViewerId: row.friendViewerId,
        name: names.get(row.friendViewerId) ?? String(row.friendViewerId),
        currentCircleId: club.circleId,
        mtdAvg: row.mtdAvg,
      });
    }
  }

  return candidates;
}

const candidates = loadCandidates();
const UMAPARTY = CLUBS[0].circleId;
const TWOMA = CLUBS[1].circleId;
const KAKKU = CLUBS[4].circleId;

describe("real roster", () => {
  it("loads all five clubs", () => {
    expect(candidates).toHaveLength(147);
    expect(new Set(candidates.map((c) => c.currentCircleId)).size).toBe(5);
  });

  it("has no member in two clubs at once", () => {
    const ids = candidates.map((c) => c.friendViewerId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("projectPromotion", () => {
  it("fills clubs in slot order, 30 at a time", () => {
    const result = projectPromotion(candidates, clubs);
    const sizes = result.clubs.map((c) => c.members.length);

    // 147 members into 30-slot clubs: 30/30/30/30/27.
    expect(sizes).toEqual([30, 30, 30, 30, 27]);
    expect(result.waitlist).toHaveLength(0);
  });

  it("puts the highest averages in the top club", () => {
    const result = projectPromotion(candidates, clubs);
    const top = result.clubs[0]!;
    const second = result.clubs[1]!;

    const lowestInTop = Math.min(...top.members.map((m) => m.rankOverall));
    expect(lowestInTop).toBe(1);
    expect(top.entryThreshold!).toBeGreaterThan(second.entryThreshold!);
  });

  it("ranks every member exactly once", () => {
    const result = projectPromotion(candidates, clubs);
    const ranks = result.placements.map((p) => p.rankOverall).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: candidates.length }, (_, i) => i + 1));
  });

  // D006: leaders are pinned but still occupy their rank, so a low-ranked
  // leader displaces someone who earned the slot.
  it("keeps a low-ranked leader in their club and cascades the displaced member down", () => {
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const lowRanked = ranked[100]!; // deep in the fourth club by rank

    const noLeaders = projectPromotion(candidates, clubs);
    const displaced = noLeaders.clubs[0]!.members.at(-1)!;

    const withLeader = projectPromotion(
      candidates,
      clubs,
      [{ friendViewerId: lowRanked.friendViewerId, circleId: UMAPARTY, kind: "leader" }],
    );

    const leaderPlacement = withLeader.placements.find(
      (p) => p.friendViewerId === lowRanked.friendViewerId,
    )!;
    expect(leaderPlacement.projectedCircleId).toBe(UMAPARTY);
    expect(leaderPlacement.pinnedAs).toBe("leader");

    // UmaParty is still full, and the member who previously held the last slot
    // has been pushed into the next club down.
    expect(withLeader.clubs[0]!.members).toHaveLength(CLUB_CAPACITY);
    const displacedNow = withLeader.placements.find(
      (p) => p.friendViewerId === displaced.friendViewerId,
    )!;
    expect(displacedNow.projectedCircleId).toBe(TWOMA);
  });

  it("excludes leaders from the entry threshold", () => {
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const lowRanked = ranked[100]!;

    const result = projectPromotion(
      candidates,
      clubs,
      [{ friendViewerId: lowRanked.friendViewerId, circleId: UMAPARTY, kind: "leader" }],
    );

    // The pinned leader's average is far below everyone else in the club; the
    // threshold must reflect what it actually takes to earn a place.
    expect(result.clubs[0]!.entryThreshold!).toBeGreaterThan(lowRanked.mtdAvg);
  });

  it("waitlists overflow rather than dropping people", () => {
    const extra: PromotionCandidate[] = Array.from({ length: 5 }, (_, i) => ({
      friendViewerId: 900000000 + i,
      name: `filler${i}`,
      currentCircleId: KAKKU,
      mtdAvg: 1, // last by a mile
    }));

    const result = projectPromotion([...candidates, ...extra], clubs);

    expect(result.waitlist).toHaveLength(2); // 152 members, 150 slots
    expect(result.placements).toHaveLength(152);
    for (const placement of result.waitlist) {
      expect(placement.projectedCircleId).toBeNull();
    }
  });

  it("reports direction of movement against the current club", () => {
    const result = projectPromotion(candidates, clubs);

    for (const placement of result.placements) {
      const from = clubs.find((c) => c.circleId === placement.currentCircleId)!.slotOrder;
      const to = clubs.find((c) => c.circleId === placement.projectedCircleId)?.slotOrder;
      if (to === undefined) continue;

      const expected = to === from ? "same" : to < from ? "up" : "down";
      expect(placement.direction).toBe(expected);
    }
  });

  it("quotes a gap that would actually clear the club above", () => {
    const result = projectPromotion(candidates, clubs);

    const second = result.clubs[1]!;
    const topEntry = result.clubs[0]!.entryThreshold!;

    for (const member of second.members) {
      if (member.gapToNextClub === null) continue;
      const candidate = candidates.find((c) => c.friendViewerId === member.friendViewerId)!;
      expect(candidate.mtdAvg + member.gapToNextClub).toBeGreaterThan(topEntry);
    }
  });

  it("gives the top club no gap to quote", () => {
    const result = projectPromotion(candidates, clubs);
    for (const member of result.clubs[0]!.members) {
      expect(member.gapToNextClub).toBeNull();
    }
  });

  it("flags members sitting near a club boundary", () => {
    const result = projectPromotion(candidates, clubs);
    const bubble = result.placements.filter((p) => p.onBubble).map((p) => p.rankOverall);

    // Boundaries at 30/60/90/120, three places either side, inclusive.
    expect(bubble).toContain(30);
    expect(bubble).toContain(31);
    expect(bubble).toContain(60);
    expect(bubble).not.toContain(1);
    expect(bubble).not.toContain(45);
  });

  it("is deterministic when averages tie", () => {
    const tied: PromotionCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      friendViewerId: 1000 + i,
      name: `tied${i}`,
      currentCircleId: UMAPARTY,
      mtdAvg: 5000,
    }));

    const a = projectPromotion(tied, clubs);
    const b = projectPromotion([...tied].reverse(), clubs);

    expect(a.placements.map((p) => p.friendViewerId)).toEqual(
      b.placements.map((p) => p.friendViewerId),
    );
  });

  // D021: officers can hold any member in place, not just leaders. Behaves
  // identically to a leader pin — consumes a slot and displaces by rank.
  it("honours a manual officer pin", () => {
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const wouldBeTop = ranked[0]!;

    const result = projectPromotion(candidates, clubs, [
      { friendViewerId: wouldBeTop.friendViewerId, circleId: KAKKU, kind: "manual" },
    ]);

    const placement = result.placements.find(
      (p) => p.friendViewerId === wouldBeTop.friendViewerId,
    )!;

    // Still ranked first overall, but held in the club the officer chose.
    expect(placement.rankOverall).toBe(1);
    expect(placement.projectedCircleId).toBe(KAKKU);
    expect(placement.pinnedAs).toBe("manual");

    // Their vacated slot at the top is taken by the next member up.
    expect(result.clubs[0]!.members).toHaveLength(CLUB_CAPACITY);
    expect(result.clubs[0]!.members.map((m) => m.friendViewerId)).not.toContain(
      wouldBeTop.friendViewerId,
    );
  });

  it("excludes manual pins from the entry threshold too", () => {
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const lowRanked = ranked[120]!;

    const result = projectPromotion(candidates, clubs, [
      { friendViewerId: lowRanked.friendViewerId, circleId: UMAPARTY, kind: "manual" },
    ]);

    expect(result.clubs[0]!.entryThreshold!).toBeGreaterThan(lowRanked.mtdAvg);
  });

  it("ignores a pin naming a club outside the pool", () => {
    const poolOfFour: PromotionClub[] = clubs.map((c) => ({
      ...c,
      inPool: c.circleId !== KAKKU,
    }));
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);

    const result = projectPromotion(candidates, poolOfFour, [
      { friendViewerId: ranked[0]!.friendViewerId, circleId: KAKKU, kind: "manual" },
    ]);

    const placement = result.placements.find(
      (p) => p.friendViewerId === ranked[0]!.friendViewerId,
    )!;
    expect(placement.pinnedAs).toBeNull();
    expect(placement.projectedCircleId).toBe(UMAPARTY);
  });

  // D020: the running order is officer-editable, and whether カック・サドル
  // belongs in the pool at all is still open.
  describe("configurable pool and slot order", () => {
    it("leaves out-of-pool members ranked but unplaced", () => {
      const poolOfFour: PromotionClub[] = clubs.map((c) => ({
        ...c,
        inPool: c.circleId !== KAKKU,
      }));

      const result = projectPromotion(candidates, poolOfFour);

      expect(result.clubs).toHaveLength(4);
      expect(result.outOfPool).toHaveLength(28);
      for (const placement of result.outOfPool) {
        expect(placement.projectedCircleId).toBeNull();
        expect(placement.currentCircleId).toBe(KAKKU);
        // Still ranked against everyone, so they can see where they stand.
        expect(placement.rankOverall).toBeGreaterThan(0);
      }

      // 119 pooled members into 4 clubs of 30.
      expect(result.clubs.map((c) => c.members.length)).toEqual([30, 30, 30, 29]);
    });

    it("respects a reordered slot order", () => {
      // Move カック・サドル from last to third.
      const reordered: PromotionClub[] = clubs.map((c) => {
        if (c.circleId === KAKKU) return { ...c, slotOrder: 3 };
        if (c.slotOrder === 3) return { ...c, slotOrder: 4 };
        if (c.slotOrder === 4) return { ...c, slotOrder: 5 };
        return c;
      });

      const result = projectPromotion(candidates, reordered);

      expect(result.clubs.map((c) => c.name)).toEqual([
        "UmaParty",
        "TwomaParty",
        "カック・サドル",
        "UmaPaThree",
        "UmaFourty",
      ]);
      // Third-best band of members now lands in カック・サドル.
      expect(result.clubs[2]!.members).toHaveLength(CLUB_CAPACITY);
    });

    it("supports an ad-hoc sixth club", () => {
      const withNewClub: PromotionClub[] = [
        ...clubs,
        { circleId: 111111111, name: "UmaPaSix", slotOrder: 6 },
      ];

      const result = projectPromotion(candidates, withNewClub);

      expect(result.clubs).toHaveLength(6);
      // 147 members, 180 slots: the new club sits empty until people move.
      expect(result.clubs.map((c) => c.members.length)).toEqual([30, 30, 30, 30, 27, 0]);
      expect(result.clubs[5]!.entryThreshold).toBeNull();
      expect(result.waitlist).toHaveLength(0);
    });

    it("respects a per-club capacity override", () => {
      const smallTop: PromotionClub[] = clubs.map((c) =>
        c.circleId === UMAPARTY ? { ...c, capacity: 10 } : c,
      );

      const result = projectPromotion(candidates, smallTop);
      expect(result.clubs[0]!.members).toHaveLength(10);
      expect(result.clubs[1]!.members).toHaveLength(CLUB_CAPACITY);
    });
  });

  // D019: no minimum-days guard. A member with a single strong day outranks
  // one who has ground all month, and that is the intended behaviour --
  // considered and declined, not overlooked. This test exists so a guard
  // cannot be added later as a "fairness fix" without the decision being
  // revisited deliberately.
  it("ranks a one-day member on their rate, with no minimum-days threshold", () => {
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const brandNew: PromotionCandidate = {
      friendViewerId: 999999999,
      name: "joined yesterday",
      currentCircleId: KAKKU,
      mtdAvg: ranked[0]!.mtdAvg + 1,
    };

    const result = projectPromotion([...candidates, brandNew], clubs);
    const placement = result.placements.find(
      (p) => p.friendViewerId === brandNew.friendViewerId,
    )!;

    expect(placement.rankOverall).toBe(1);
    expect(placement.projectedCircleId).toBe(UMAPARTY);
    expect(placement.direction).toBe("up");
  });

  it("handles a leader whose club is already full of leaders", () => {
    // Defensive: two leaders nominated for one club should not overfill it.
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const pins: Pin[] = [
      { friendViewerId: ranked[50]!.friendViewerId, circleId: UMAPARTY, kind: "leader" },
    ];

    const result = projectPromotion(candidates, clubs, pins);
    expect(result.clubs[0]!.members).toHaveLength(CLUB_CAPACITY);
  });
});
