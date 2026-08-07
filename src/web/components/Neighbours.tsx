import { Link } from "react-router-dom";

import { compactFans, fullFans } from "../lib/format.ts";
import type { ClubSummary, Placement } from "../lib/api.ts";
import { ClubChip } from "./Bits.tsx";

/**
 * The people immediately above and below you in the standings.
 *
 * A rank on its own does not tell you whether you are 2% or 40% off the person
 * ahead. The bars are drawn relative to the range across this slice, not from
 * zero, because everyone here is within a few percent of each other and a
 * zero-based bar would make them all look identical.
 */
export function Neighbours({
  placements,
  clubs,
  viewerId,
  span = 5,
}: {
  placements: Placement[];
  clubs: ClubSummary[];
  viewerId: number;
  span?: number;
}) {
  const clubOf = new Map(clubs.map((c) => [c.circle_id, c]));
  const index = placements.findIndex((p) => p.friendViewerId === viewerId);
  if (index === -1) return null;

  const slice = placements.slice(Math.max(0, index - span), index + span + 1);
  if (slice.length < 2) return null;

  const values = slice.map((p) => p.mtdAvg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span01 = max - min || 1;

  return (
    <ul className="space-y-1">
      {slice.map((peer) => {
        const you = peer.friendViewerId === viewerId;
        const gap = peer.mtdAvg - placements[index]!.mtdAvg;
        // 12% floor so the smallest bar is still a bar.
        const width = 12 + ((peer.mtdAvg - min) / span01) * 88;

        return (
          <li key={peer.friendViewerId}>
            <Link
              to={`/m/${peer.friendViewerId}`}
              className={`grid grid-cols-[2.5rem_8rem_6rem_1fr_5rem] items-center gap-2 rounded-[6px] px-2 py-1 ${
                you ? "bg-lav-200" : "hover:bg-cream-100"
              }`}
            >
              <span className="tnum text-xs text-ink-500">#{peer.rankOverall}</span>

              <span
                className={`truncate text-sm ${you ? "font-extrabold text-ink-900" : "font-semibold text-ink-700"}`}
              >
                {peer.name}
              </span>

              <span className="min-w-0">
                {clubOf.get(peer.currentCircleId) && (
                  <ClubChip
                    name={clubOf.get(peer.currentCircleId)!.name}
                    slotOrder={clubOf.get(peer.currentCircleId)!.slot_order}
                  />
                )}
              </span>

              <span className="h-3.5 w-full">
                <span
                  className="block h-full rounded-[3px]"
                  style={{
                    width: `${width}%`,
                    background: you ? "var(--color-teal-600)" : "var(--color-teal-300)",
                  }}
                />
              </span>

              <span className="text-right">
                <span className="tnum block text-xs font-bold text-ink-900" title={fullFans(peer.mtdAvg)}>
                  {compactFans(peer.mtdAvg)}
                </span>
                {!you && (
                  <span
                    className={`tnum block text-[10px] ${gap > 0 ? "text-coral-700" : "text-teal-700"}`}
                  >
                    {gap > 0 ? "+" : "−"}
                    {compactFans(Math.abs(gap))}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Distance to the club above and the cushion above the drop line.
 *
 * The two numbers a member checks: what it takes to go up, and how much room
 * they have before going down.
 */
export function PromotionGauge({
  placement,
  clubs,
}: {
  placement: Placement;
  clubs: { circleId: number; name: string; slotOrder: number; entryThreshold: number | null }[];
}) {
  const here = clubs.find((c) => c.circleId === placement.projectedCircleId);
  if (!here) return null;

  const above = clubs.find((c) => c.slotOrder === here.slotOrder - 1);
  const toPromote = above?.entryThreshold != null ? above.entryThreshold - placement.mtdAvg + 1 : null;
  // Cushion: how far above this club's own entry line they are sitting.
  const cushion = here.entryThreshold != null ? placement.mtdAvg - here.entryThreshold : null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="card px-4 py-3">
        <div className="text-xs font-medium text-ink-500">
          {above ? `To reach ${above.name}` : "Already in the top club"}
        </div>
        <div className="tnum font-display text-2xl leading-tight font-bold text-teal-700">
          {toPromote != null && toPromote > 0 ? `+${compactFans(toPromote)}` : "—"}
        </div>
        {toPromote != null && toPromote > 0 && (
          <div className="text-[11px] text-ink-400">more fans per day</div>
        )}
      </div>

      <div className="card px-4 py-3">
        <div className="text-xs font-medium text-ink-500">Clear of the {here.name} drop line by</div>
        <div
          className={`tnum font-display text-2xl leading-tight font-bold ${
            cushion != null && cushion < 0 ? "text-coral-700" : "text-ink-900"
          }`}
        >
          {cushion != null ? compactFans(Math.abs(cushion)) : "—"}
        </div>
        <div className="text-[11px] text-ink-400">
          {cushion != null && cushion < 0 ? "below the line" : "fans per day"}
        </div>
      </div>
    </div>
  );
}
