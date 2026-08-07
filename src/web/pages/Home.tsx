import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Search } from "lucide-react";

import { useApi, type ClubSummary, type Placement, type SearchHit } from "../lib/api.ts";
import { compactFans, fullFans, ymdLong } from "../lib/format.ts";
import { Button, ClubChip, Delta, ErrorNote, RankBadge, Spinner } from "../components/Bits.tsx";

interface StandingsResponse {
  ymd: number;
  placements: Placement[];
}

/** The tracking sheet, on one screen, clickable. */
export function Home() {
  const clubs = useApi<{ ymd: number; clubs: ClubSummary[] }>("clubs");
  const standings = useApi<StandingsResponse>("standings");
  const boardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Export the board as a PNG.
   *
   * This is the workflow the clubs already had -- screenshot the sheet, post it
   * in Discord -- so it stays available rather than being replaced by "just
   * send them the link".
   */
  async function savePng() {
    if (!boardRef.current) return;
    setSaving(true);
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(boardRef.current, {
        // 2x so the numbers stay legible after Discord recompresses it, and an
        // explicit background because the node itself is transparent.
        pixelRatio: 2,
        backgroundColor: "#fdfaf1",
        style: { padding: "16px" },
      });
      const day = standings.data?.ymd ?? "";
      const link = document.createElement("a");
      link.download = `umaparty-${day}.png`;
      link.href = url;
      link.click();
    } finally {
      setSaving(false);
    }
  }

  const byClub = useMemo(() => {
    const map = new Map<number, Placement[]>();
    for (const placement of standings.data?.placements ?? []) {
      const list = map.get(placement.currentCircleId);
      if (list) list.push(placement);
      else map.set(placement.currentCircleId, [placement]);
    }
    // Already ranked overall, so club order falls out for free.
    return map;
  }, [standings.data]);

  const loading = clubs.loading || standings.loading;
  const error = clubs.error ?? standings.error;

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h1 className="font-display text-4xl leading-none font-extrabold text-ink-900">
            Daily Dose of Data
          </h1>
          <div className="min-w-64 flex-1">
            <MemberSearch clubs={clubs.data?.clubs ?? []} />
          </div>
        </div>
      </section>

      {loading && <Spinner label="Loading the board" />}
      {error && <ErrorNote message={error} />}

      {clubs.data && standings.data && (
        <section>
          <div className="mb-2 flex items-center gap-3">
            <span className="text-xs text-ink-400">{ymdLong(standings.data.ymd)}</span>
            <Button
              tone="quiet"
              className="!px-2.5 !py-1 text-xs"
              disabled={saving}
              onClick={savePng}
            >
              <span className="flex items-center gap-1.5">
                <Download size={13} /> {saving ? "Saving…" : "Save as PNG"}
              </span>
            </Button>
          </div>

          {/* Scrolls horizontally rather than reflowing: the point is seeing the
              clubs side by side, the way the sheet does. */}
          <div className="-mx-5 overflow-x-auto px-5 pb-2">
            <div ref={boardRef} className="flex gap-3 bg-cream-100">
              {clubs.data.clubs.map((club) => (
                <ClubColumn
                  key={club.circle_id}
                  club={club}
                  members={byClub.get(club.circle_id) ?? []}
                />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Compact fans below `lg`, the full integer at desktop width, where there is
 * room for it and people read exact numbers off the board.
 */
const BOARD_COLS =
  "grid-cols-[2.25rem_1fr_4.5rem_4.25rem] lg:grid-cols-[2.25rem_1fr_6rem_4.25rem]";

function BoardFans({ value }: { value: number }) {
  return (
    <span
      className="tnum font-display text-right text-sm font-bold text-ink-900"
      title={fullFans(value)}
    >
      <span className="lg:hidden">{compactFans(value)}</span>
      <span className="hidden lg:inline">{fullFans(value)}</span>
    </span>
  );
}

function ClubColumn({ club, members }: { club: ClubSummary; members: Placement[] }) {
  const clubTotal = members.reduce((sum, m) => sum + m.mtdAvg, 0);

  return (
    <div className="card min-w-[17rem] flex-1 overflow-hidden lg:min-w-[19rem]">
      <div className="border-b-2 border-cream-300 bg-cream-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <Link to={`/club/${club.circle_id}`} className="hover:opacity-80">
            <ClubChip name={club.name} slotOrder={club.slot_order} />
          </Link>
          <span className="tnum ml-auto text-xs font-extrabold text-gold-700">
            {club.rank ? `#${club.rank}` : "—"}
          </span>
        </div>
        {club.leader_name && (
          <div className="mt-1 truncate text-[11px] text-ink-500">
            lead{" "}
            {club.leader_viewer_id ? (
              <Link
                to={`/m/${club.leader_viewer_id}`}
                className="font-semibold text-ink-700 hover:text-teal-700"
              >
                {club.leader_name}
              </Link>
            ) : (
              <span className="font-semibold text-ink-700">{club.leader_name}</span>
            )}
          </div>
        )}
      </div>

      <div
        className={`grid ${BOARD_COLS} gap-1 border-b border-cream-300 px-2 py-1.5 text-[11px] font-bold text-ink-500`}
      >
        <span>#</span>
        <span>Name</span>
        <span className="text-right">Fans/day</span>
        <span className="text-right">vs prev</span>
      </div>

      <ul>
        {members.map((member, index) => (
          <li key={member.friendViewerId}>
            <Link
              to={`/m/${member.friendViewerId}`}
              className={`grid ${BOARD_COLS} items-center gap-1 border-b border-cream-200 px-2 py-1 last:border-0 hover:bg-teal-50`}
            >
              <RankBadge rank={index + 1} />
              <span className="truncate text-sm font-semibold text-ink-900">{member.name}</span>
              <BoardFans value={member.mtdAvg} />
              <Delta value={member.mtdAvgDelta} className="text-right text-xs" />
            </Link>
          </li>
        ))}
        {members.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-ink-400">no data yet</li>
        )}
      </ul>

      <div className="flex items-center gap-2 border-t-2 border-cream-300 bg-cream-100 px-3 py-1.5 text-[11px] text-ink-500">
        <span>{members.length} members</span>
        <span className="tnum ml-auto font-bold text-ink-700" title={fullFans(clubTotal)}>
          <span className="lg:hidden">{compactFans(clubTotal)}</span>
          <span className="hidden lg:inline">{fullFans(clubTotal)}</span>
          /day
        </span>
      </div>
    </div>
  );
}

function MemberSearch({ clubs }: { clubs: ClubSummary[] }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  const { data } = useApi<{ results: SearchHit[] }>(
    debounced.length >= 2 ? `search?q=${encodeURIComponent(debounced)}` : null,
  );

  const clubById = useMemo(() => new Map(clubs.map((c) => [c.circle_id, c])), [clubs]);
  const results = data?.results ?? [];

  return (
    <div className="relative">
      <div className="card flex items-center gap-2 border-2 px-4 py-2.5 focus-within:border-teal-400">
        <Search size={18} className="shrink-0 text-teal-700" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              navigate(`/m/${results[0].friend_viewer_id}`);
            }
          }}
          placeholder="Search"
          aria-label="Search for a member by name"
          className="w-full bg-transparent text-base outline-none placeholder:text-ink-400"
        />
      </div>

      {debounced.length >= 2 && (
        <div className="absolute z-10 mt-2 w-full max-w-lg space-y-1">
          {results.length === 0 && (
            <p className="px-1 py-2 text-sm text-ink-500">
              Nobody matches “{debounced}”. Try part of the name, or a name you used before.
            </p>
          )}

          {results.map((hit) => {
            const club = hit.circle_id ? clubById.get(hit.circle_id) : undefined;
            return (
              <Link
                key={hit.friend_viewer_id}
                to={`/m/${hit.friend_viewer_id}`}
                className="card row-lift flex items-center gap-3 px-4 py-2.5"
              >
                <span className="font-semibold text-ink-900">{hit.current_name}</span>

                {/* Shown only when the hit came from a name they no longer use —
                    the payoff of keeping name history. */}
                {hit.matchedAlias && (
                  <span className="text-xs text-ink-400">
                    formerly <span className="text-ink-600">{hit.matchedAlias}</span>
                  </span>
                )}

                {club && (
                  <ClubChip name={club.name} slotOrder={club.slot_order} className="ml-auto" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
