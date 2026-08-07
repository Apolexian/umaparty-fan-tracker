// Daily ingestion.
//
// Two things here are irreversible if they go wrong, so they get the care:
//
//  1. Movement detection (D010). Chronogenesis keeps no record of a member
//     moving between clubs — a mover is purged from their old club entirely.
//     If this does not run on the day of a reshuffle, that history is gone
//     for good. It is reconstructed by diffing rosters day over day.
//
//  2. Gain preservation (D017). When a member moves, chrono rewrites their
//     earlier daily gains to 0. If we already recorded the real number, ours
//     is the only surviving copy, so a zero must never overwrite it.

import { ChronoClient, ChronoError, REQUEST_GAP_MS, sleep } from "./chrono.ts";
import { deriveMemberDays, toYmd, ymdToYearMonth } from "./derive.ts";
import type { ClubProfileResponse, Env } from "./types.ts";

export interface ClubRow {
  circle_id: number;
  name: string;
  slot_order: number;
  capacity: number;
  in_pool: number;
}

export interface IngestSummary {
  circleId: number;
  status: "ok" | "error";
  rowsWritten: number;
  error?: string;
  httpStatus?: number;
}

const nowIso = () => new Date().toISOString();

/** YYYYMMDD for a Date, in UTC — chrono's data day is UTC-based. */
export function ymdOf(date: Date): number {
  return toYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/**
 * Run a full daily ingest across every club in the `clubs` table.
 *
 * Clubs are read from the database rather than a constant so officers can add
 * one ad-hoc without a deploy (D020). One club failing must not abort the
 * others — each is independent and its outcome is recorded in `ingest_runs`.
 */
export async function ingestAll(env: Env, now = new Date()): Promise<IngestSummary[]> {
  const client = new ChronoClient(env.CHRONO_TOKEN);

  const { results } = await env.DB.prepare(
    "SELECT circle_id, name, slot_order, capacity, in_pool FROM clubs WHERE is_active = 1 ORDER BY slot_order",
  ).all<ClubRow>();

  const summaries: IngestSummary[] = [];

  for (const [index, club] of results.entries()) {
    // Chrono asks for no more than one request per second.
    if (index > 0) await sleep(REQUEST_GAP_MS);

    const startedAt = nowIso();
    try {
      const profile = await client.clubProfile(club.circle_id);
      const rowsWritten = await ingestClubProfile(env, club.circle_id, profile, now);

      await recordRun(env, startedAt, club.circle_id, "daily", "ok", null, rowsWritten, null);
      summaries.push({ circleId: club.circle_id, status: "ok", rowsWritten });
    } catch (error) {
      const chrono = error instanceof ChronoError ? error : null;
      const message = error instanceof Error ? error.message : String(error);

      await recordRun(
        env,
        startedAt,
        club.circle_id,
        "daily",
        "error",
        chrono?.status ?? null,
        0,
        message,
      );
      summaries.push({
        circleId: club.circle_id,
        status: "error",
        rowsWritten: 0,
        error: message,
        httpStatus: chrono?.status,
      });
    }
  }

  // On the first days of a month, re-read the previous month so its final
  // values are locked in before they fall out of club_profile's window (D-#7).
  if (now.getUTCDate() <= 3) {
    await backfillPreviousMonth(env, client, results, now);
  }

  return summaries;
}

/** Normalise and persist one club's profile response. */
export async function ingestClubProfile(
  env: Env,
  circleId: number,
  profile: ClubProfileResponse,
  now: Date,
): Promise<number> {
  const club = profile.club[0];
  if (!club) throw new Error(`club_profile for ${circleId} contained no club row`);

  const ymd = ymdOf(now);
  const year = Math.floor(ymd / 10000);
  const month = Math.floor(ymd / 100) % 100;
  const statements: D1PreparedStatement[] = [];

  // ---------------------------------------------------------------- club ----

  statements.push(
    env.DB.prepare(
      `UPDATE clubs SET name = ?, comment = ?, member_num = ?, policy = ?, join_style = ?,
         leader_viewer_id_api = ?, make_time = ?, rank = ?, rank_diff = ?, fan_count = ?,
         daily_average = ?, monthly_average = ?, is_active = ?, updated_at = ?
       WHERE circle_id = ?`,
    ).bind(
      club.name,
      club.comment,
      club.member_num,
      club.policy,
      club.join_style,
      club.leader_viewer_id,
      club.make_time,
      club.rank,
      club.rank_diff,
      club.fan_count,
      club.daily_average,
      club.monthly_average,
      club.is_active ? 1 : 0,
      club.updated_at,
      circleId,
    ),
  );

  for (const day of profile.club_daily_history) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO club_day (circle_id, ymd, rank, rank_gain, fan_count, fan_gain)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (circle_id, ymd) DO UPDATE SET
           rank = excluded.rank, rank_gain = excluded.rank_gain,
           fan_count = excluded.fan_count, fan_gain = excluded.fan_gain`,
      ).bind(
        circleId,
        toYmd(year, month, day.actual_date),
        day.rank,
        day.rank_gain,
        day.interpolated_fan_count,
        day.interpolated_fan_gain,
      ),
    );
  }

  for (const entry of profile.club_monthly_history) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO club_month (circle_id, year_month, rank, rank_gain, fan_count, monthly_fan_gain)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (circle_id, year_month) DO UPDATE SET
           rank = excluded.rank, rank_gain = excluded.rank_gain,
           fan_count = excluded.fan_count, monthly_fan_gain = excluded.monthly_fan_gain`,
      ).bind(
        circleId,
        entry.year_month,
        entry.rank,
        entry.rank_gain,
        entry.fan_count,
        entry.monthly_fan_gain,
      ),
    );
  }

  // ------------------------------------------------------------- members ----

  const roster = new Set(club.circle_user_array);

  for (const member of profile.club_friend_profile) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO members (friend_viewer_id, name, leader_chara_id, leader_chara_dress_id,
           honor_id, support_card_id, team_evaluation_point, fan_count, last_login_time,
           first_seen_ymd, last_seen_ymd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (friend_viewer_id) DO UPDATE SET
           name = excluded.name,
           leader_chara_id = excluded.leader_chara_id,
           leader_chara_dress_id = excluded.leader_chara_dress_id,
           honor_id = excluded.honor_id,
           support_card_id = excluded.support_card_id,
           team_evaluation_point = excluded.team_evaluation_point,
           fan_count = excluded.fan_count,
           last_login_time = excluded.last_login_time,
           last_seen_ymd = excluded.last_seen_ymd,
           updated_at = excluded.updated_at`,
      ).bind(
        member.friend_viewer_id,
        member.name,
        member.leader_chara_id,
        member.leader_chara_dress_id,
        member.honor_id,
        member.support_card_id,
        member.team_evaluation_point,
        member.fan_count,
        member.last_login_time,
        ymd,
        ymd,
        member.updated_at,
      ),
    );

    // Every name we have ever seen stays searchable (D004).
    const names = new Set<string>([member.name, ...(member.names ?? [])]);
    for (const name of names) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO member_names (friend_viewer_id, name, first_seen_ymd)
           VALUES (?, ?, ?) ON CONFLICT (friend_viewer_id, name) DO NOTHING`,
        ).bind(member.friend_viewer_id, name, ymd),
      );
    }
  }

  // ---------------------------------------------------------- member days ----

  const stintStarts = await currentStintStarts(env, circleId, year, month);

  const derived = deriveMemberDays(
    profile.club_friend_history.filter((r) => roster.has(r.friend_viewer_id)),
    { year, month, circleId, stintStarts },
  );

  for (const row of derived) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO member_day (friend_viewer_id, ymd, circle_id, fan_count, fan_gain,
           fan_gain_observed, mtd_cumulative, days_active, mtd_avg, mtd_avg_delta,
           rank_in_club, rank_overall)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (friend_viewer_id, ymd) DO UPDATE SET
           circle_id = excluded.circle_id,
           fan_count = excluded.fan_count,
           fan_gain = excluded.fan_gain,
           -- D017: a later 0 is chrono wiping a mover's history. Keep the
           -- first real number we saw; ours is the only surviving copy.
           fan_gain_observed = CASE
             WHEN COALESCE(member_day.fan_gain_observed, 0) > 0 THEN member_day.fan_gain_observed
             ELSE excluded.fan_gain_observed
           END,
           mtd_cumulative = excluded.mtd_cumulative,
           days_active = excluded.days_active,
           mtd_avg = excluded.mtd_avg,
           mtd_avg_delta = excluded.mtd_avg_delta,
           rank_in_club = excluded.rank_in_club`,
      ).bind(
        row.friendViewerId,
        row.ymd,
        row.circleId,
        row.fanCount,
        row.fanGain,
        row.fanGain,
        row.mtdCumulative,
        row.daysActive,
        row.mtdAvg,
        row.mtdAvgDelta,
        row.rankInClub,
      ),
    );
  }

  // ------------------------------------------------------------- movement ----

  statements.push(...(await stintStatements(env, circleId, profile, ymd)));

  await env.DB.batch(statements);
  return statements.length;
}

/**
 * Day a stint began: the API's `join_time` when it is usable, else the day we
 * first observed the member.
 *
 * `join_time` is only trusted when it parses and is not in the future — it is
 * the club's own record of when they joined, which we cannot otherwise know
 * for anyone who was already a member before this project existed.
 */
export function startYmdFor(joinTime: string | null, observedYmd: number): number {
  if (!joinTime) return observedYmd;

  const parsed = new Date(`${joinTime}Z`);
  if (Number.isNaN(parsed.getTime())) return observedYmd;

  const joinYmd = ymdOf(parsed);
  return joinYmd > 0 && joinYmd <= observedYmd ? joinYmd : observedYmd;
}

/**
 * Reconstruct club membership changes by diffing today's roster against the
 * stints we currently believe are open.
 *
 * This is the only record of the monthly reshuffle that will ever exist (D010).
 */
async function stintStatements(
  env: Env,
  circleId: number,
  profile: ClubProfileResponse,
  ymd: number,
): Promise<D1PreparedStatement[]> {
  const club = profile.club[0]!;
  const roster = new Set(club.circle_user_array);
  const joinTimes = new Map(
    profile.club_friend_profile.map((p) => [p.friend_viewer_id, p.join_time]),
  );
  const memberships = new Map(
    profile.club_friend_profile.map((p) => [p.friend_viewer_id, p.membership]),
  );

  const { results: open } = await env.DB.prepare(
    "SELECT friend_viewer_id FROM club_stint WHERE circle_id = ? AND end_ymd IS NULL",
  )
    .bind(circleId)
    .all<{ friend_viewer_id: number }>();

  const openIds = new Set(open.map((r) => r.friend_viewer_id));
  const statements: D1PreparedStatement[] = [];

  // Joined: in the roster with no open stint here.
  for (const viewerId of roster) {
    if (openIds.has(viewerId)) continue;
    const joinTime = joinTimes.get(viewerId) ?? null;
    statements.push(
      env.DB.prepare(
        `INSERT INTO club_stint (friend_viewer_id, circle_id, join_time, start_ymd, membership)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        viewerId,
        circleId,
        joinTime,
        // Prefer the API's join_time over "the day we first noticed". On the
        // first ever ingest every member is new to us, and dating all 147
        // stints to deploy day would throw away history the API is handing us.
        startYmdFor(joinTime, ymd),
        memberships.get(viewerId) ?? null,
      ),
    );
  }

  // Left: an open stint here but no longer in the roster.
  for (const viewerId of openIds) {
    if (roster.has(viewerId)) continue;
    statements.push(
      env.DB.prepare(
        `UPDATE club_stint SET end_ymd = ?
         WHERE friend_viewer_id = ? AND circle_id = ? AND end_ymd IS NULL`,
      ).bind(ymd, viewerId, circleId),
    );
  }

  return statements;
}

/**
 * Day-of-month each member's current stint in this club began, for members
 * whose stint started during the month being ingested.
 *
 * Our own records beat the leading-zeros heuristic in `derive.ts`, which cannot
 * tell a mover apart from a member who simply gained nothing that day (D017).
 */
async function currentStintStarts(
  env: Env,
  circleId: number,
  year: number,
  month: number,
): Promise<Map<number, number>> {
  const monthStart = toYmd(year, month, 1);
  const monthEnd = toYmd(year, month, 31);

  const { results } = await env.DB.prepare(
    `SELECT friend_viewer_id, MIN(start_ymd) AS start_ymd
       FROM club_stint
      WHERE circle_id = ? AND end_ymd IS NULL AND start_ymd BETWEEN ? AND ?
      GROUP BY friend_viewer_id`,
  )
    .bind(circleId, monthStart, monthEnd)
    .all<{ friend_viewer_id: number; start_ymd: number }>();

  return new Map(results.map((r) => [r.friend_viewer_id, r.start_ymd % 100]));
}

/**
 * Re-read the previous month once it has closed.
 *
 * `club_profile` only carries the current month, so without this the last days
 * of every month would be lost as soon as the month ticks over.
 */
async function backfillPreviousMonth(
  env: Env,
  client: ChronoClient,
  clubs: ClubRow[],
  now: Date,
): Promise<void> {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = previous.getUTCFullYear();
  const month = previous.getUTCMonth() + 1;
  const sdate = `${year}-${String(month).padStart(2, "0")}-01`;

  for (const club of clubs) {
    await sleep(REQUEST_GAP_MS);
    const startedAt = nowIso();

    try {
      const data = await client.clubMonth(club.circle_id, sdate);
      const statements: D1PreparedStatement[] = [];

      for (const day of data.club_daily_history) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO club_day (circle_id, ymd, rank, rank_gain, fan_count, fan_gain)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (circle_id, ymd) DO UPDATE SET
               rank = excluded.rank, rank_gain = excluded.rank_gain,
               fan_count = excluded.fan_count, fan_gain = excluded.fan_gain`,
          ).bind(
            club.circle_id,
            toYmd(year, month, day.actual_date),
            day.rank,
            day.rank_gain,
            day.interpolated_fan_count,
            day.interpolated_fan_gain,
          ),
        );
      }

      const derived = deriveMemberDays(data.club_friend_history, {
        year,
        month,
        circleId: club.circle_id,
      });

      for (const row of derived) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO member_day (friend_viewer_id, ymd, circle_id, fan_count, fan_gain,
               fan_gain_observed, mtd_cumulative, days_active, mtd_avg, mtd_avg_delta, rank_in_club)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (friend_viewer_id, ymd) DO UPDATE SET
               fan_count = excluded.fan_count,
               fan_gain = excluded.fan_gain,
               fan_gain_observed = CASE
                 WHEN COALESCE(member_day.fan_gain_observed, 0) > 0 THEN member_day.fan_gain_observed
                 ELSE excluded.fan_gain_observed
               END,
               mtd_cumulative = excluded.mtd_cumulative,
               days_active = excluded.days_active,
               mtd_avg = excluded.mtd_avg,
               mtd_avg_delta = excluded.mtd_avg_delta,
               rank_in_club = excluded.rank_in_club`,
          ).bind(
            row.friendViewerId,
            row.ymd,
            row.circleId,
            row.fanCount,
            row.fanGain,
            row.fanGain,
            row.mtdCumulative,
            row.daysActive,
            row.mtdAvg,
            row.mtdAvgDelta,
            row.rankInClub,
          ),
        );
      }

      if (statements.length > 0) await env.DB.batch(statements);
      await recordRun(
        env,
        startedAt,
        club.circle_id,
        "month",
        "ok",
        null,
        statements.length,
        null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof ChronoError ? error.status : null;
      await recordRun(env, startedAt, club.circle_id, "month", "error", status, 0, message);
    }
  }
}

/**
 * The most recent day we actually hold member data for.
 *
 * This is NOT today's date: chrono publishes a day in arrears, so on the 7th
 * the newest data is for the 6th. Ranking by wall-clock date silently updates
 * an empty day and leaves `rank_overall` null.
 */
export async function latestDataYmd(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT MAX(ymd) AS ymd FROM member_day").first<{
    ymd: number | null;
  }>();
  return row?.ymd ?? 0;
}

/**
 * Recompute `rank_overall` for a day across every club in the pool.
 *
 * Kept separate from the per-club ingest because it can only be correct once
 * every club for that day has landed.
 */
export async function recomputeOverallRanks(env: Env, ymd: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE member_day
        SET rank_overall = (
          SELECT COUNT(*) + 1 FROM member_day AS peer
           WHERE peer.ymd = member_day.ymd
             AND peer.mtd_avg > member_day.mtd_avg
        )
      WHERE ymd = ?`,
  )
    .bind(ymd)
    .run();
}

async function recordRun(
  env: Env,
  startedAt: string,
  circleId: number | null,
  kind: string,
  status: string,
  httpStatus: number | null,
  rowsWritten: number,
  error: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ingest_runs (started_at, circle_id, kind, status, http_status, rows_written, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(startedAt, circleId, kind, status, httpStatus, rowsWritten, error?.slice(0, 1000) ?? null)
    .run();
}

export { ymdToYearMonth };
