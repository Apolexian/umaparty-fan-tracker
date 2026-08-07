import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { useApi, type ClubSummary, type MemberDay, type Placement, type Stint } from "../lib/api.ts";
import { compactFans, fullFans, ymdLabel, ymdLong } from "../lib/format.ts";
import { ClubChip, Delta, DirectionMark, ErrorNote, Spinner, StatPill } from "../components/Bits.tsx";
import { Sparkline } from "../components/Sparkline.tsx";

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

          <p className="mt-2 text-xs text-ink-400">
            A projection from today's averages, not a decision. Officers set the final roster.
          </p>
        </section>
      )}

      {monthDays.length > 1 && (
        <section className="card px-4 py-4">
          <h2 className="mb-3 font-display text-lg font-bold text-ink-900">
            Average this month
          </h2>
          <Sparkline
            points={monthDays.map((d) => ({ x: d.ymd, y: d.mtd_avg }))}
            label={(p) => `${ymdLabel(p.x)} · ${fullFans(p.y)} fans/day`}
          />

          <h2 className="mt-6 mb-3 font-display text-lg font-bold text-ink-900">Daily gain</h2>
          <Bars days={monthDays} />
        </section>
      )}

      {stints.length > 0 && (
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
          <p className="mt-3 text-xs text-ink-400">
            Chronogenesis does not keep club moves — this history exists only because we
            record it daily.
          </p>
        </section>
      )}
    </div>
  );
}

function Bars({ days }: { days: MemberDay[] }) {
  const max = Math.max(...days.map((d) => Math.max(d.fan_gain, d.fan_gain_observed ?? 0)), 1);

  return (
    <div className="flex items-end gap-1" style={{ height: 96 }}>
      {days.map((day) => {
        // A zeroed gain with a preserved observation means the game wiped it
        // when they moved club. Showing what really happened is the point of
        // keeping both numbers.
        const wiped = day.fan_gain === 0 && (day.fan_gain_observed ?? 0) > 0;
        const value = wiped ? day.fan_gain_observed : day.fan_gain;
        return (
          <div
            key={day.ymd}
            className="group relative flex-1"
            title={
              wiped
                ? `${ymdLabel(day.ymd)} · ${fullFans(value)} earned, reset to 0 by a club move`
                : `${ymdLabel(day.ymd)} · ${fullFans(value)}`
            }
          >
            <div
              className={`capsule w-full ${wiped ? "bg-cream-300" : "bg-teal-400"}`}
              style={{ height: Math.max(2, (value / max) * 96) }}
            />
          </div>
        );
      })}
    </div>
  );
}
