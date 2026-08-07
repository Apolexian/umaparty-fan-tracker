import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useApi, type ClubSummary, type Placement } from "../lib/api.ts";
import { compactFans, fullFans, ymdLong } from "../lib/format.ts";
import { ClubChip, Delta, DirectionMark, ErrorNote, RankBadge, Ribbon, Spinner } from "../components/Bits.tsx";

/**
 * The "Now → next" cell holds two nowrap club chips and an arrow, which a fixed
 * 7rem track could not contain -- it overflowed and painted over Fans / day.
 * The slack now goes to that column instead of to the name, which had it and
 * did not need it.
 */
const STANDINGS_COLS =
  "grid-cols-[2.5rem_1fr_5.5rem_4.5rem] sm:grid-cols-[2.5rem_minmax(9rem,20rem)_1fr_6rem_5.75rem]";

interface StandingsResponse {
  ymd: number;
  placements: Placement[];
  clubs: {
    circleId: number;
    name: string;
    slotOrder: number;
    capacity: number;
    entryThreshold: number | null;
    size: number;
  }[];
  waitlist: number[];
  outOfPool: number[];
}

/**
 * Everyone, ranked together, with the club cutoffs drawn in — the reshuffle
 * made visible all month instead of landing as a surprise.
 */
export function Standings() {
  const { data, error, loading } = useApi<StandingsResponse>("standings");
  const clubs = useApi<{ clubs: ClubSummary[] }>("clubs");
  const [filter, setFilter] = useState("");

  const clubById = useMemo(
    () => new Map((clubs.data?.clubs ?? []).map((c) => [c.circle_id, c])),
    [clubs.data],
  );

  const cutoffAfterRank = useMemo(() => {
    if (!data) return new Map<number, string>();
    const map = new Map<number, string>();
    let running = 0;
    for (const club of [...data.clubs].sort((a, b) => a.slotOrder - b.slotOrder).slice(0, -1)) {
      running += club.capacity;
      const next = data.clubs.find((c) => c.slotOrder === club.slotOrder + 1);
      if (next) map.set(running, next.name);
    }
    return map;
  }, [data]);

  if (loading) return <Spinner label="Working out the standings" />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const query = filter.trim().toLowerCase();
  const rows = query
    ? data.placements.filter((p) => p.name.toLowerCase().includes(query))
    : data.placements;

  const movers = data.placements.filter((p) => p.direction !== "same").length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Ribbon>Standings</Ribbon>
        <span className="tnum text-sm text-ink-600">
          <span className="font-bold text-ink-900">{movers}</span>/{data.placements.length} would
          change club
        </span>
        <span className="ml-auto text-xs text-ink-400">{ymdLong(data.ymd)}</span>
      </header>

      <div className="flex flex-wrap gap-2">
        {[...data.clubs]
          .sort((a, b) => a.slotOrder - b.slotOrder)
          .map((club) => (
            <div key={club.circleId} className="card px-3 py-2">
              <ClubChip name={club.name} slotOrder={club.slotOrder} to={`/club/${club.circleId}`} />
              <div className="tnum mt-1 text-xs text-ink-500">
                {club.size}/{club.capacity} ·{" "}
                {club.entryThreshold ? `${compactFans(club.entryThreshold)} to enter` : "open"}
              </div>
            </div>
          ))}
      </div>

      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter by name"
        aria-label="Filter standings by name"
        className="card w-full bg-cream-50 px-4 py-2.5 text-sm outline-none placeholder:text-ink-400 focus:border-teal-400"
      />

      <div className="card overflow-hidden">
        <div
          className={`grid ${STANDINGS_COLS} items-center gap-2 border-b border-cream-300 px-3 py-2 text-xs font-semibold text-ink-500`}
        >
          <span>#</span>
          <span>Name</span>
          <span className="hidden text-left sm:block">Now → next</span>
          <span className="text-right">Fans / day</span>
          <span className="text-right">vs prev</span>
        </div>

        <ul>
          {rows.map((placement) => {
            const current = clubById.get(placement.currentCircleId);
            const projected = placement.projectedCircleId
              ? clubById.get(placement.projectedCircleId)
              : undefined;
            const cutoff = !query ? cutoffAfterRank.get(placement.rankOverall) : undefined;

            return (
              <Fragment key={placement.friendViewerId}>
                <li>
                  <Link
                    to={`/m/${placement.friendViewerId}`}
                    className={`grid ${STANDINGS_COLS} items-center gap-2 border-b border-cream-200 px-3 py-2 hover:bg-cream-100 ${
                      placement.onBubble ? "bg-lav-50" : ""
                    }`}
                  >
                    <RankBadge rank={placement.rankOverall} />

                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-semibold text-ink-900">{placement.name}</span>
                      {placement.pinnedAs && (
                        <span
                          className="capsule shrink-0 bg-cream-300 px-1.5 text-[10px] font-semibold text-ink-600"
                          title={
                            placement.pinnedAs === "leader"
                              ? "Club leader — keeps their seat"
                              : "Held in place by officers"
                          }
                        >
                          {placement.pinnedAs === "leader" ? "leader" : "held"}
                        </span>
                      )}
                    </span>

                    <span className="hidden min-w-0 flex-wrap items-center gap-1 sm:flex">
                      {current && <ClubChip name={current.name} slotOrder={current.slot_order} />}
                      {projected && projected.circle_id !== placement.currentCircleId && (
                        <>
                          <DirectionMark direction={placement.direction} />
                          <ClubChip name={projected.name} slotOrder={projected.slot_order} />
                        </>
                      )}
                    </span>

                    <span
                      className="tnum text-right font-display text-base font-bold text-ink-900"
                      title={fullFans(placement.mtdAvg)}
                    >
                      {compactFans(placement.mtdAvg)}
                    </span>

                    <Delta value={placement.mtdAvgDelta} className="text-right text-sm" />
                  </Link>
                </li>

                {/* The line people are actually watching. */}
                {cutoff && (
                  <li
                    aria-hidden
                    className="flex items-center gap-2 bg-cream-200 px-3 py-1 text-[11px] font-semibold text-ink-500"
                  >
                    <span className="h-px flex-1 bg-teal-300" />
                    {cutoff} cutoff
                    <span className="h-px flex-1 bg-teal-300" />
                  </li>
                )}
              </Fragment>
            );
          })}
        </ul>
      </div>

      <p className="text-xs text-ink-400">Projection only. Officers set the final roster.</p>
    </div>
  );
}
