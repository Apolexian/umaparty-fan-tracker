import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useApi, type ClubSummary, type LeaderboardRow } from "../lib/api.ts";
import { compactFans, fullFans, ymdLong } from "../lib/format.ts";
import { ClubChip, Delta, ErrorNote, RankBadge, Spinner, StatPill } from "../components/Bits.tsx";

interface ClubResponse {
  ymd: number;
  club: ClubSummary & { name: string };
  leaderboard: LeaderboardRow[];
  history: { ymd: number; rank: number; fan_count: number; fan_gain: number }[];
  months: { year_month: number; rank: number; fan_count: number; monthly_fan_gain: number }[];
}

type SortKey = "rank" | "name" | "avg" | "delta" | "total";

export function Club() {
  const { id } = useParams<{ id: string }>();
  const [month, setMonth] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("rank");
  const [desc, setDesc] = useState(false);

  const { data, error, loading } = useApi<ClubResponse>(
    id ? `club/${id}${month ? `?month=${month}` : ""}` : null,
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.leaderboard];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "avg":
          return b.mtd_avg - a.mtd_avg;
        case "delta":
          return b.mtd_avg_delta - a.mtd_avg_delta;
        case "total":
          return b.mtd_cumulative - a.mtd_cumulative;
        default:
          return a.rank_in_club - b.rank_in_club;
      }
    });
    return desc ? sorted.reverse() : sorted;
  }, [data, sort, desc]);

  if (loading) return <Spinner label="Loading club" />;
  if (error) return <ErrorNote message={error} />;
  if (!data?.club) return <ErrorNote message="Club not found." />;

  const clubTotal = data.leaderboard.reduce((sum, r) => sum + r.mtd_avg, 0);

  function toggleSort(key: SortKey) {
    if (sort === key) setDesc((value) => !value);
    else {
      setSort(key);
      setDesc(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <ClubChip name={data.club.name} slotOrder={data.club.slot_order} />
        <h1 className="font-display text-2xl font-extrabold text-ink-900">{data.club.name}</h1>
        <span className="text-xs text-ink-400">{ymdLong(data.ymd)}</span>

        {data.months.length > 0 && (
          <select
            value={month ?? ""}
            onChange={(event) => setMonth(event.target.value || null)}
            className="capsule ml-auto border border-cream-300 bg-cream-50 px-3 py-1.5 text-sm text-ink-700"
            aria-label="Month"
          >
            <option value="">Current month</option>
            {data.months.map((m) => (
              <option key={m.year_month} value={m.year_month}>
                {monthLabel(m.year_month)}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* D027: chrono re-attributes a member's whole month to their current
          club, so a past month lists today's members with that month's
          numbers — not whoever was actually in the club back then. Saying so
          is cheaper than letting people draw the wrong conclusion. */}
      {month && (
        <p className="card bg-lav-100 px-4 py-2.5 text-sm text-ink-600">
          Showing <span className="font-semibold">today's members</span> with their{" "}
          {monthLabel(Number(month))} numbers. Chronogenesis keeps no record of who was
          in a club in a past month, so this is not the roster as it stood then.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill label="Club rank" value={data.club.rank ? `#${data.club.rank}` : "—"} />
        <StatPill label="Members" value={String(data.leaderboard.length)} />
        <StatPill
          label="Club fans / day"
          value={compactFans(clubTotal)}
          hint={fullFans(clubTotal)}
        />
        <StatPill
          label="Total fans"
          value={data.club.fan_count ? compactFans(data.club.fan_count) : "—"}
          hint={data.club.fan_count ? fullFans(data.club.fan_count) : undefined}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[2.5rem_1fr_5.5rem_5rem] items-center gap-2 border-b border-cream-300 px-3 py-2 text-xs font-semibold text-ink-500 sm:grid-cols-[2.5rem_1fr_6rem_6rem_5rem]">
          <button onClick={() => toggleSort("rank")} className="text-left hover:text-teal-700">
            #
          </button>
          <button onClick={() => toggleSort("name")} className="text-left hover:text-teal-700">
            Name
          </button>
          <button onClick={() => toggleSort("avg")} className="text-right hover:text-teal-700">
            Fans / day
          </button>
          <button onClick={() => toggleSort("delta")} className="text-right hover:text-teal-700">
            vs prev
          </button>
          <button
            onClick={() => toggleSort("total")}
            className="hidden text-right hover:text-teal-700 sm:block"
          >
            Month
          </button>
        </div>

        <ul>
          {rows.map((row) => (
            <li key={row.friend_viewer_id}>
              <Link
                to={`/m/${row.friend_viewer_id}`}
                className="grid grid-cols-[2.5rem_1fr_5.5rem_5rem] items-center gap-2 border-b border-cream-200 px-3 py-2 last:border-0 hover:bg-cream-100 sm:grid-cols-[2.5rem_1fr_6rem_6rem_5rem]"
              >
                <RankBadge rank={row.rank_in_club} />

                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink-900">{row.name}</span>
                  {/* Surfaced because it changes how their average is read:
                      the denominator is days in this club, not days elapsed. */}
                  {row.days_active > 0 && row.days_active < (data.ymd % 100) && (
                    <span className="text-[11px] text-ink-400">
                      {row.days_active} days in club
                    </span>
                  )}
                </span>

                <span
                  className="tnum text-right font-display text-base font-bold text-ink-900"
                  title={fullFans(row.mtd_avg)}
                >
                  {compactFans(row.mtd_avg)}
                </span>

                <Delta value={row.mtd_avg_delta} className="text-right text-sm" />

                <span
                  className="tnum hidden text-right text-sm text-ink-500 sm:block"
                  title={fullFans(row.mtd_cumulative)}
                >
                  {compactFans(row.mtd_cumulative)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function monthLabel(yearMonth: number): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[(yearMonth % 100) - 1] ?? "?"} ${Math.floor(yearMonth / 100)}`;
}
