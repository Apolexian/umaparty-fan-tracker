import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";

import { useApi, type ClubSummary, type SearchHit } from "../lib/api.ts";
import { compactFans, ymdLong } from "../lib/format.ts";
import { ClubChip, ErrorNote, Spinner } from "../components/Bits.tsx";

/**
 * Most people arrive from a Discord link, on a phone, to answer one question:
 * where do I stand? So this page leads with the search box and their own row,
 * not a dashboard. (DESIGN.md)
 */
export function Home() {
  const { data, error, loading } = useApi<{ ymd: number; clubs: ClubSummary[] }>("clubs");

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-3xl leading-tight font-extrabold text-ink-900">
          Find yourself
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Search by your current name — or one you used to go by.
        </p>
        <MemberSearch clubs={data?.clubs ?? []} />
      </section>

      {loading && <Spinner label="Loading clubs" />}
      {error && <ErrorNote message={error} />}

      {data && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-bold text-ink-900">The clubs</h2>
            <span className="text-xs text-ink-400">Data to {ymdLong(data.ymd)}</span>
          </div>

          <div className="space-y-2">
            {data.clubs.map((club) => (
              <ClubCard key={club.circle_id} club={club} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ClubCard({ club }: { club: ClubSummary }) {
  return (
    <Link
      to={`/club/${club.circle_id}`}
      className="card row-lift flex items-center gap-3 px-4 py-3"
    >
      <ClubChip name={club.name} slotOrder={club.slot_order} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink-500">{club.comment || " "}</div>
      </div>

      <div className="text-right">
        <div className="tnum font-display text-lg leading-none font-bold text-ink-900">
          {club.club_daily_avg ? compactFans(club.club_daily_avg) : "—"}
        </div>
        <div className="text-[11px] text-ink-400">fans / day</div>
      </div>

      <div className="w-16 text-right">
        <div className="tnum text-sm font-semibold text-ink-700">
          {club.rank ? `#${club.rank}` : "—"}
        </div>
        <div className="text-[11px] text-ink-400">{club.tracked_members} members</div>
      </div>
    </Link>
  );
}

function MemberSearch({ clubs }: { clubs: ClubSummary[] }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(id);
  }, [query]);

  const { data } = useApi<{ results: SearchHit[] }>(
    debounced.length >= 2 ? `search?q=${encodeURIComponent(debounced)}` : null,
  );

  const clubById = useMemo(
    () => new Map(clubs.map((c) => [c.circle_id, c])),
    [clubs],
  );

  const results = data?.results ?? [];

  return (
    <div className="mt-4">
      <div className="card flex items-center gap-2 px-4 py-3 focus-within:border-teal-400">
        <Search size={18} className="shrink-0 text-teal-700" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              navigate(`/m/${results[0].friend_viewer_id}`);
            }
          }}
          placeholder="Your trainer name"
          aria-label="Search for a member by name"
          className="w-full bg-transparent text-base outline-none placeholder:text-ink-400"
        />
      </div>

      {debounced.length >= 2 && (
        <div className="mt-2 space-y-1">
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
                  <ClubChip
                    name={club.name}
                    slotOrder={club.slot_order}
                    className="ml-auto"
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
