// The monthly reshuffle, projected.
//
// Every month the clubs redistribute: everyone is sorted into one big list by
// average daily fans and dealt out across the five clubs in order. This module
// answers "where would I land if that happened today", which is the question
// members actually open the site to ask.
//
// It projects only — the real moves happen in-game. See D005-D008.

/** Slots per club. Assumed, not confirmed — see D018. */
export const CLUB_CAPACITY = 30;

/** How close to a boundary counts as "on the bubble", in places. */
const BUBBLE_DISTANCE = 3;

export interface PromotionClub {
  circleId: number;
  name: string;
  /** 1 = UmaParty (top), 5 = カック・サドル. */
  slotOrder: number;
  capacity?: number;
}

export interface PromotionCandidate {
  friendViewerId: number;
  name: string;
  /** Club they are in today. */
  currentCircleId: number;
  /** Month-to-date average daily fans — the sort key. See D005, D016. */
  mtdAvg: number;
}

export interface PromotionPlacement {
  friendViewerId: number;
  name: string;
  rankOverall: number;
  currentCircleId: number;
  /** Null only when they overflow past every club's capacity. */
  projectedCircleId: number | null;
  /** True when they hold their seat because they lead the club. */
  isLeader: boolean;
  /** Moving up a club, down a club, or staying put. */
  direction: "up" | "down" | "same";
  /**
   * Extra average daily fans needed to reach the next club up, or null if
   * already in the top club (or unranked).
   */
  gapToNextClub: number | null;
  /** Within a few places of a club boundary — worth watching. */
  onBubble: boolean;
  /** Beyond total capacity; surfaced to officers rather than dropped. */
  waitlisted: boolean;
}

export interface PromotionResult {
  placements: PromotionPlacement[];
  /** Per club: who lands there and the average needed to get in. */
  clubs: {
    circleId: number;
    name: string;
    slotOrder: number;
    capacity: number;
    members: PromotionPlacement[];
    /** Lowest mtdAvg placed here by rank; null if the club took only its leader. */
    entryThreshold: number | null;
  }[];
  waitlist: PromotionPlacement[];
}

/**
 * Project next month's club assignment.
 *
 * Leaders are pinned to their club but still occupy a slot in it, so a
 * low-ranked leader displaces someone who earned the place and that person
 * cascades down (D006). Everyone else fills clubs in `slotOrder`.
 *
 * @param leaders circleId -> friend_viewer_id of that club's current leader
 */
export function projectPromotion(
  candidates: PromotionCandidate[],
  clubs: PromotionClub[],
  leaders: Map<number, number>,
): PromotionResult {
  const ordered = [...clubs].sort((a, b) => a.slotOrder - b.slotOrder);

  const remaining = new Map<number, number>();
  for (const club of ordered) {
    remaining.set(club.circleId, club.capacity ?? CLUB_CAPACITY);
  }

  // Rank everyone first; ties broken by viewer id so the result is stable.
  const ranked = [...candidates].sort(
    (a, b) => b.mtdAvg - a.mtdAvg || a.friendViewerId - b.friendViewerId,
  );
  const rankOf = new Map(ranked.map((c, i) => [c.friendViewerId, i + 1]));

  const leaderOfClub = new Map<number, number>();
  for (const [circleId, viewerId] of leaders) {
    leaderOfClub.set(viewerId, circleId);
  }

  const assigned = new Map<number, number>();

  // Pass 1: leaders keep their seat, consuming a slot in their own club.
  for (const candidate of ranked) {
    const led = leaderOfClub.get(candidate.friendViewerId);
    if (led === undefined) continue;
    const free = remaining.get(led);
    if (free === undefined || free <= 0) continue; // club unknown or already full
    remaining.set(led, free - 1);
    assigned.set(candidate.friendViewerId, led);
  }

  // Pass 2: everyone else, in rank order, into the highest club with a slot.
  const waitlisted = new Set<number>();
  for (const candidate of ranked) {
    if (assigned.has(candidate.friendViewerId)) continue;

    const club = ordered.find((c) => (remaining.get(c.circleId) ?? 0) > 0);
    if (!club) {
      waitlisted.add(candidate.friendViewerId);
      continue;
    }
    remaining.set(club.circleId, remaining.get(club.circleId)! - 1);
    assigned.set(candidate.friendViewerId, club.circleId);
  }

  // Entry thresholds: the lowest average that earned a place in each club,
  // ignoring leaders (who did not earn theirs by rank).
  const thresholds = new Map<number, number | null>();
  for (const club of ordered) {
    const earned = ranked.filter(
      (c) =>
        assigned.get(c.friendViewerId) === club.circleId &&
        !leaderOfClub.has(c.friendViewerId),
    );
    thresholds.set(club.circleId, earned.length > 0 ? earned[earned.length - 1]!.mtdAvg : null);
  }

  const slotOf = new Map(ordered.map((c) => [c.circleId, c.slotOrder]));

  const placements: PromotionPlacement[] = ranked.map((candidate) => {
    const projectedCircleId = assigned.get(candidate.friendViewerId) ?? null;
    const isLeader = leaderOfClub.has(candidate.friendViewerId);

    const fromSlot = slotOf.get(candidate.currentCircleId);
    const toSlot = projectedCircleId === null ? undefined : slotOf.get(projectedCircleId);

    let direction: PromotionPlacement["direction"] = "same";
    if (fromSlot !== undefined && toSlot !== undefined && fromSlot !== toSlot) {
      // Lower slotOrder is a better club, so a decrease is a promotion.
      direction = toSlot < fromSlot ? "up" : "down";
    }

    return {
      friendViewerId: candidate.friendViewerId,
      name: candidate.name,
      rankOverall: rankOf.get(candidate.friendViewerId)!,
      currentCircleId: candidate.currentCircleId,
      projectedCircleId,
      isLeader,
      direction,
      gapToNextClub: gapToNextClub(candidate, toSlot, ordered, thresholds),
      onBubble: false, // filled in below
      waitlisted: waitlisted.has(candidate.friendViewerId),
    };
  });

  markBubbles(placements, ordered);

  return {
    placements,
    clubs: ordered.map((club) => ({
      circleId: club.circleId,
      name: club.name,
      slotOrder: club.slotOrder,
      capacity: club.capacity ?? CLUB_CAPACITY,
      members: placements.filter((p) => p.projectedCircleId === club.circleId),
      entryThreshold: thresholds.get(club.circleId) ?? null,
    })),
    waitlist: placements.filter((p) => p.waitlisted),
  };
}

/**
 * How much more average daily fans this member needs to reach the club one slot
 * above the one they are projected into.
 */
function gapToNextClub(
  candidate: PromotionCandidate,
  toSlot: number | undefined,
  ordered: PromotionClub[],
  thresholds: Map<number, number | null>,
): number | null {
  if (toSlot === undefined || toSlot <= 1) return null;

  const above = ordered.find((c) => c.slotOrder === toSlot - 1);
  if (!above) return null;

  const threshold = thresholds.get(above.circleId);
  if (threshold === null || threshold === undefined) return null;

  // They must beat the last member who earned a place there.
  return Math.max(0, threshold - candidate.mtdAvg + 1);
}

/** Flag anyone sitting within a few places of a club boundary. */
function markBubbles(placements: PromotionPlacement[], ordered: PromotionClub[]): void {
  const boundaries: number[] = [];
  let running = 0;
  for (const club of ordered.slice(0, -1)) {
    running += club.capacity ?? CLUB_CAPACITY;
    boundaries.push(running);
  }

  for (const placement of placements) {
    placement.onBubble = boundaries.some(
      (b) => Math.abs(placement.rankOverall - b) <= BUBBLE_DISTANCE,
    );
  }
}
