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
    const result = projectPromotion(candidates, clubs, new Map());
    const sizes = result.clubs.map((c) => c.members.length);

    // 147 members into 30-slot clubs: 30/30/30/30/27.
    expect(sizes).toEqual([30, 30, 30, 30, 27]);
    expect(result.waitlist).toHaveLength(0);
  });

  it("puts the highest averages in the top club", () => {
    const result = projectPromotion(candidates, clubs, new Map());
    const top = result.clubs[0]!;
    const second = result.clubs[1]!;

    const lowestInTop = Math.min(...top.members.map((m) => m.rankOverall));
    expect(lowestInTop).toBe(1);
    expect(top.entryThreshold!).toBeGreaterThan(second.entryThreshold!);
  });

  it("ranks every member exactly once", () => {
    const result = projectPromotion(candidates, clubs, new Map());
    const ranks = result.placements.map((p) => p.rankOverall).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: candidates.length }, (_, i) => i + 1));
  });

  // D006: leaders are pinned but still occupy their rank, so a low-ranked
  // leader displaces someone who earned the slot.
  it("keeps a low-ranked leader in their club and cascades the displaced member down", () => {
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const lowRanked = ranked[100]!; // deep in the fourth club by rank

    const noLeaders = projectPromotion(candidates, clubs, new Map());
    const displaced = noLeaders.clubs[0]!.members.at(-1)!;

    const withLeader = projectPromotion(
      candidates,
      clubs,
      new Map([[UMAPARTY, lowRanked.friendViewerId]]),
    );

    const leaderPlacement = withLeader.placements.find(
      (p) => p.friendViewerId === lowRanked.friendViewerId,
    )!;
    expect(leaderPlacement.projectedCircleId).toBe(UMAPARTY);
    expect(leaderPlacement.isLeader).toBe(true);

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
      new Map([[UMAPARTY, lowRanked.friendViewerId]]),
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

    const result = projectPromotion([...candidates, ...extra], clubs, new Map());

    expect(result.waitlist).toHaveLength(2); // 152 members, 150 slots
    expect(result.placements).toHaveLength(152);
    for (const placement of result.waitlist) {
      expect(placement.projectedCircleId).toBeNull();
    }
  });

  it("reports direction of movement against the current club", () => {
    const result = projectPromotion(candidates, clubs, new Map());

    for (const placement of result.placements) {
      const from = clubs.find((c) => c.circleId === placement.currentCircleId)!.slotOrder;
      const to = clubs.find((c) => c.circleId === placement.projectedCircleId)?.slotOrder;
      if (to === undefined) continue;

      const expected = to === from ? "same" : to < from ? "up" : "down";
      expect(placement.direction).toBe(expected);
    }
  });

  it("quotes a gap that would actually clear the club above", () => {
    const result = projectPromotion(candidates, clubs, new Map());

    const second = result.clubs[1]!;
    const topEntry = result.clubs[0]!.entryThreshold!;

    for (const member of second.members) {
      if (member.gapToNextClub === null) continue;
      const candidate = candidates.find((c) => c.friendViewerId === member.friendViewerId)!;
      expect(candidate.mtdAvg + member.gapToNextClub).toBeGreaterThan(topEntry);
    }
  });

  it("gives the top club no gap to quote", () => {
    const result = projectPromotion(candidates, clubs, new Map());
    for (const member of result.clubs[0]!.members) {
      expect(member.gapToNextClub).toBeNull();
    }
  });

  it("flags members sitting near a club boundary", () => {
    const result = projectPromotion(candidates, clubs, new Map());
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

    const a = projectPromotion(tied, clubs, new Map());
    const b = projectPromotion([...tied].reverse(), clubs, new Map());

    expect(a.placements.map((p) => p.friendViewerId)).toEqual(
      b.placements.map((p) => p.friendViewerId),
    );
  });

  it("handles a leader whose club is already full of leaders", () => {
    // Defensive: two leaders nominated for one club should not overfill it.
    const ranked = [...candidates].sort((a, b) => b.mtdAvg - a.mtdAvg);
    const leaders = new Map([[UMAPARTY, ranked[50]!.friendViewerId]]);

    const result = projectPromotion(candidates, clubs, leaders);
    expect(result.clubs[0]!.members).toHaveLength(CLUB_CAPACITY);
  });
});
