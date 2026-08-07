import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { useApi, type ClubSummary, type MemberDay, type Placement, type Stint } from "../lib/api.ts";
import { compactFans, fullFans, ymdLong } from "../lib/format.ts";
import { ClubChip, DirectionMark, ErrorNote, Spinner, StatPill } from "../components/Bits.tsx";
import { BarChart, LineChart } from "../components/Charts.tsx";

interface MemberResponse {
  member: { friend_viewer_id: number; name: string; fan_count: number; last_login_time: string };
  names: { name: string; first_seen_ymd: number }[];
  stints: Stint[];
  days: MemberDay[];
}

export function Member() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useApi<MemberResponse>(id ? `member/${id}` : null);
  const clubs = useApi<{ clubs: ClubSummary[] }>("clubs");
  const standings = useApi<{ placements: Placement[] }>("standings");

  const clubById = useMemo(
    () => new Map((clubs.data?.clubs ?? []).map((c) => [c.circle_id, c])),
    [clubs.data],
  );

  if (loading) return <Spinner label="Loading member" />;
  if (error) return <ErrorNote message={error} />;
  if (!data?.member) return <ErrorNote message="Member not found." />;

  const { member, names, stints, days } = data;
  const latest = days.at(-1);
  const currentClub = stints.find((s) => s.end_ymd === null) ?? stints.at(-1);
  const club = currentClub ? clubById.get(currentClub.circle_id) : undefined;

  const placement = standings.data?.placements.find(
    (p) => p.friendViewerId === member.friend_viewer_id,
  );
  const projectedClub = placement?.projectedCircleId
    ? clubById.get(placement.projectedCircleId)
    : undefined;

  // Only names they no longer use — the current one is already the heading.
  const formerNames = names.map((n) => n.name).filter((n) => n !== member.name);

  // The current month only, so the sparkline shows this month's shape.
  const thisMonth = latest ? Math.floor(latest.ymd / 100) : 0;
  const monthDays = days.filter((d) => Math.floor(d.ymd / 100) === thisMonth);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-3xl font-extrabold text-ink-900">{member.name}</h1>
          {club && <ClubChip name={club.name} slotOrder={club.slot_order} to={`/club/${club.circle_id}`} />}
        </div>

        {formerNames.length > 0 && (
          <p className="mt-1 text-sm text-ink-500">
            formerly{" "}
            <span className="text-ink-700">{formerNames.join(", ")}</span>
          </p>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatPill
          label="Fans / day"
          value={latest ? compactFans(latest.mtd_avg) : "—"}
          hint={latest ? fullFans(latest.mtd_avg) : undefined}
        />
        <StatPill label="In club" value={latest ? `#${latest.rank_in_club}` : "—"} />
        <StatPill
          label="Overall"
          value={placement ? `#${placement.rankOverall}` : latest?.rank_overall ? `#${latest.rank_overall}` : "—"}
        />
        <StatPill
          label="This month"
          value={latest ? compactFans(latest.mtd_cumulative) : "—"}
          hint={latest ? fullFans(latest.mtd_cumulative) : undefined}
        />
      </div>

      {placement && (
        <section className="card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink-700">Next reshuffle</span>
            <DirectionMark direction={placement.direction} />
            {projectedClub ? (
              <ClubChip name={projectedClub.name} slotOrder={projectedClub.slot_order} />
            ) : (
              <span className="text-sm text-ink-500">
                {placement.inPool ? "waitlisted" : "not in the reshuffle"}
              </span>
            )}
            {placement.onBubble && (
              <span className="capsule bg-lav-300 px-2 py-0.5 text-[11px] font-semibold text-ink-900">
                on the bubble
              </span>
            )}
            {placement.pinnedAs && (
              <span className="capsule bg-cream-300 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                {placement.pinnedAs === "leader" ? "club leader" : "held in place"}
              </span>
            )}
          </div>

          {placement.gapToNextClub !== null && placement.gapToNextClub > 0 && (
            <p className="mt-1 text-sm text-ink-500">
              <span className="tnum font-semibold text-teal-700">
                +{compactFans(placement.gapToNextClub)}
              </span>{" "}
              fans/day would reach the club above.
            </p>
          )}

        </section>
      )}

      {monthDays.length > 1 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="card px-4 py-4">
            <h2 className="mb-2 font-display text-lg font-bold text-ink-900">
              Average this month
            </h2>
            <LineChart
              valueLabel="Fans/day"
              points={monthDays.map((d) => ({ ymd: d.ymd, value: d.mtd_avg }))}
            />
          </section>

          <section className="card px-4 py-4">
            <h2 className="mb-2 font-display text-lg font-bold text-ink-900">Daily gain</h2>
            <BarChart
              valueLabel="Gained"
              points={monthDays.map((d) => {
                // A zeroed gain with a preserved observation means the game
                // wiped it on a club move; show the real figure, muted.
                const wiped = d.fan_gain === 0 && (d.fan_gain_observed ?? 0) > 0;
                return {
                  ymd: d.ymd,
                  value: wiped ? d.fan_gain_observed : d.fan_gain,
                  muted: wiped,
                };
              })}
            />
          </section>
        </div>
      )}

      {/* Only shown once we have actually observed a move.
          Before that there is exactly one stint, seeded from the API's
          join_time, and rendering it claims unbroken membership since that
          date -- which is not something chronogenesis knows and is often
          wrong. A section that asserts a falsehood is worse than no section,
          so it stays hidden until our own daily snapshots have recorded a
          real transfer. See D010, D028. */}
      {stints.length > 1 && (
        <section className="card px-4 py-4">
          <h2 className="mb-3 font-display text-lg font-bold text-ink-900">Club history</h2>
          <ol className="space-y-2">
            {[...stints].reverse().map((stint) => {
              const stintClub = clubById.get(stint.circle_id);
              return (
                <li key={`${stint.circle_id}-${stint.start_ymd}`} className="flex items-center gap-3">
                  <ClubChip
                    name={stint.club_name ?? String(stint.circle_id)}
                    slotOrder={stintClub?.slot_order}
                    to={`/club/${stint.circle_id}`}
                  />
                  <span className="tnum text-sm text-ink-500">
                    {ymdLong(stint.start_ymd)}
                    {stint.end_ymd ? ` → ${ymdLong(stint.end_ymd)}` : " → now"}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

    </div>
  );
}
