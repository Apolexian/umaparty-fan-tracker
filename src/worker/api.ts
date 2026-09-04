// Public read API.
//
// Data changes once a day, so responses are cached hard at the edge. Members
// arrive in bursts from a Discord link, and the whole site is five or six
// queries — this keeps D1 reads near zero on the free tier.

import { buildPins, projectPromotion, type PromotionClub } from "./promotion.ts";
import type { Env } from "./types.ts";

// no browser cache, long edge cache. The edge is what keeps D1 reads near zero;
// a browser cache adds nothing for a site people open once or twice a day, and
// a stale bundle plus a stale response made every deploy look broken for five
// minutes. The edge entry is invalidated by the key below, not by expiry.
const CACHE_CONTROL = "public, max-age=0, must-revalidate, s-maxage=3600, stale-while-revalidate=86400";

// Bump when a response shape changes. The data-day in the cache key handles new
// data, but not a deploy that adds a field to an existing day — without this,
// entries cached before the deploy keep being served for up to an hour.
const CACHE_VERSION = 5;

export async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");

  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  // The cache key carries the newest data day, so an ingest that advances the
  // day invalidates every entry at once. Without this a response cached just
  // before the daily pull kept serving yesterday's numbers for a full hour --
  // which is exactly when people look, and how four clubs sat empty on the
  // board long after their data had landed.
  //
  // The extra lookup is MAX() on an indexed column, far cheaper than the
  // queries it saves.
  const cache = caches.default;
  const dataDay = await latestDay(env);
  const cacheKey = new Request(
    `${url.origin}${url.pathname}${url.search}${url.search ? "&" : "?"}__d=${dataDay}&__v=${CACHE_VERSION}`,
    { method: "GET" },
  );

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let response: Response;
  try {
    response = await route(path, url, env);
  } catch (error) {
    // Logged in full, returned as a generic message: this endpoint is public,
    // and a raw D1 error hands out table and column names.
    console.error("api error", path, error);
    return json({ error: "something went wrong" }, 500);
  }

  if (response.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

/** Path ids are always positive integers; anything else is a bad request. */
function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function route(path: string, url: URL, env: Env): Promise<Response> {
  const segments = path.split("/").filter(Boolean);

  switch (segments[0]) {
    case "clubs":
      return json(await getClubs(env));
    case "club": {
      const circleId = parseId(segments[1]);
      if (circleId === null) return json({ error: "invalid club id" }, 400);

      const monthRaw = url.searchParams.get("month");
      // YYYYMM or nothing — an unparsable month must not reach the query.
      const month = monthRaw && /^\d{6}$/.test(monthRaw) ? monthRaw : null;

      return json(await getClub(env, circleId, month));
    }
    case "member": {
      const viewerId = parseId(segments[1]);
      if (viewerId === null) return json({ error: "invalid member id" }, 400);

      const member = await getMember(env, viewerId);
      // A real 404, not a 200 carrying an error: only ok responses are cached,
      // so returning 200 here would pin "not found" at the edge for an hour —
      // including for a member who appears in tomorrow's ingest.
      return member ? json(member) : json({ error: "not found" }, 404);
    }
    case "search":
      return json(await search(env, url.searchParams.get("q") ?? ""));
    case "standings":
      return json(await getStandings(env));
    case "meta":
      return json(await getMeta(env));
    default:
      return json({ error: "not found" }, 404);
  }
}

/** The most recent day we have any member data for. */
async function latestDay(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT MAX(ymd) AS ymd FROM member_day").first<{
    ymd: number | null;
  }>();
  return row?.ymd ?? 0;
}

async function getClubs(env: Env) {
  const ymd = await latestDay(env);

  const { results } = await env.DB.prepare(
    `SELECT c.circle_id, c.name, c.slot_order, c.capacity, c.in_pool, c.rank, c.rank_diff,
            c.fan_count, c.member_num, c.comment, c.updated_at,
            -- Chrono leads; the officer pin is only a proposal (D027).
            c.leader_viewer_id_api AS leader_viewer_id,
            lm.name AS leader_name,
            pin.friend_viewer_id AS proposed_leader_viewer_id,
            pm.name AS proposed_leader_name,
            -- Both counts follow chrono's roster for the day, not our derived
            -- circle_id, which goes stale for anyone who has left (D034).
            (SELECT COUNT(*) FROM member_day md
              JOIN club_roster r ON r.circle_id = md.circle_id
                                AND r.ymd = md.ymd
                                AND r.friend_viewer_id = md.friend_viewer_id
              WHERE md.circle_id = c.circle_id AND md.ymd = ?) AS tracked_members,
            (SELECT SUM(md.mtd_avg) FROM member_day md
              JOIN club_roster r ON r.circle_id = md.circle_id
                                AND r.ymd = md.ymd
                                AND r.friend_viewer_id = md.friend_viewer_id
              WHERE md.circle_id = c.circle_id AND md.ymd = ?) AS club_daily_avg
       FROM clubs c
       LEFT JOIN member_pins pin
         ON pin.circle_id = c.circle_id AND pin.kind = 'leader' AND pin.unset_at IS NULL
       LEFT JOIN members pm ON pm.friend_viewer_id = pin.friend_viewer_id
       LEFT JOIN members lm ON lm.friend_viewer_id = c.leader_viewer_id_api
      WHERE c.is_active = 1
      ORDER BY c.slot_order`,
  )
    .bind(ymd, ymd)
    .all();

  return { ymd, clubs: results };
}

async function getClub(env: Env, circleId: number, month: string | null) {
  const ymd = month
    ? await lastDayOfMonth(env, circleId, Number(month))
    : await latestDay(env);

  const { results: leaderboard } = await env.DB.prepare(
    `SELECT md.friend_viewer_id, m.name, md.mtd_avg, md.mtd_avg_delta, md.mtd_cumulative,
            md.fan_gain, md.fan_gain_observed, md.days_active, md.rank_in_club,
            md.rank_overall, m.leader_chara_id, m.leader_chara_dress_id, m.last_login_time
       FROM member_day md
       JOIN members m ON m.friend_viewer_id = md.friend_viewer_id
       -- Chrono's roster for the day decides who is in the club. Our own
       -- circle_id keeps the old club for anyone who has left, which is how a
       -- 30-slot club came to list 33. (D034)
       JOIN club_roster r ON r.circle_id = md.circle_id
                         AND r.ymd = md.ymd
                         AND r.friend_viewer_id = md.friend_viewer_id
      WHERE md.circle_id = ? AND md.ymd = ?
      ORDER BY md.mtd_avg DESC`,
  )
    .bind(circleId, ymd)
    .all();

  const club = await env.DB.prepare(
    "SELECT * FROM clubs WHERE circle_id = ?",
  )
    .bind(circleId)
    .first();

  const { results: history } = await env.DB.prepare(
    "SELECT ymd, rank, rank_gain, fan_count, fan_gain FROM club_day WHERE circle_id = ? ORDER BY ymd",
  )
    .bind(circleId)
    .all();

  const { results: months } = await env.DB.prepare(
    `SELECT year_month, rank, rank_gain, fan_count, monthly_fan_gain
       FROM club_month WHERE circle_id = ? ORDER BY year_month DESC`,
  )
    .bind(circleId)
    .all();

  // Per-member cumulative progression across the month being shown, for the
  // multi-line chart. Restricted to the club's roster on the latest day so a
  // member who left mid-month does not trail off into a flat line.
  const yearMonth = Math.floor(ymd / 100);
  const { results: series } = await env.DB.prepare(
    `SELECT md.friend_viewer_id, m.name, md.ymd, md.mtd_cumulative, md.mtd_avg
       FROM member_day md
       JOIN members m ON m.friend_viewer_id = md.friend_viewer_id
      WHERE md.circle_id = ?
        AND md.ymd BETWEEN ? AND ?
        AND md.friend_viewer_id IN (
          SELECT friend_viewer_id FROM member_day WHERE circle_id = ? AND ymd = ?
        )
      ORDER BY md.friend_viewer_id, md.ymd`,
  )
    .bind(circleId, yearMonth * 100, yearMonth * 100 + 31, circleId, ymd)
    .all();

  return { ymd, club, leaderboard, history, months, series };
}

async function lastDayOfMonth(env: Env, circleId: number, yearMonth: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT MAX(ymd) AS ymd FROM member_day
      WHERE circle_id = ? AND ymd BETWEEN ? AND ?`,
  )
    .bind(circleId, yearMonth * 100, yearMonth * 100 + 31)
    .first<{ ymd: number | null }>();
  return row?.ymd ?? 0;
}

async function getMember(env: Env, viewerId: number) {
  const member = await env.DB.prepare(
    "SELECT * FROM members WHERE friend_viewer_id = ?",
  )
    .bind(viewerId)
    .first();

  if (!member) return null;

  // Every name they have gone by — the point of D004.
  const { results: names } = await env.DB.prepare(
    "SELECT name, first_seen_ymd FROM member_names WHERE friend_viewer_id = ? ORDER BY first_seen_ymd",
  )
    .bind(viewerId)
    .all();

  // Their club history, which exists nowhere else (D010).
  const { results: stints } = await env.DB.prepare(
    `SELECT s.circle_id, c.name AS club_name, s.start_ymd, s.end_ymd, s.join_time
       FROM club_stint s LEFT JOIN clubs c ON c.circle_id = s.circle_id
      WHERE s.friend_viewer_id = ? ORDER BY s.start_ymd`,
  )
    .bind(viewerId)
    .all();

  const { results: days } = await env.DB.prepare(
    `SELECT ymd, circle_id, fan_count, fan_gain, fan_gain_observed, mtd_cumulative,
            days_active, mtd_avg, mtd_avg_delta, rank_in_club, rank_overall
       FROM member_day WHERE friend_viewer_id = ? ORDER BY ymd`,
  )
    .bind(viewerId)
    .all();

  return { member, names, stints, days };
}

/**
 * Name search across current *and* past names, so a member who renamed can
 * still be found by what their club mates remember them as.
 */
async function search(env: Env, query: string) {
  const q = query.trim();
  if (q.length < 2) return { results: [] };

  // One row per member, not per matching name: a member with several old
  // names would otherwise appear once for each. `matched_name` reports which
  // name hit, so a search for an old name shows why it matched.
  const { results } = await env.DB.prepare(
    `SELECT m.friend_viewer_id,
            m.name AS current_name,
            MIN(CASE WHEN mn.name = m.name THEN NULL ELSE mn.name END) AS matched_alias,
            MAX(CASE WHEN mn.name = m.name THEN 1 ELSE 0 END) AS matched_current,
            m.leader_chara_id, m.leader_chara_dress_id,
            (SELECT md.circle_id FROM member_day md
              WHERE md.friend_viewer_id = m.friend_viewer_id
              ORDER BY md.ymd DESC LIMIT 1) AS circle_id
       FROM member_names mn
       JOIN members m ON m.friend_viewer_id = mn.friend_viewer_id
      WHERE mn.name LIKE ?
      GROUP BY m.friend_viewer_id
      ORDER BY matched_current DESC, LENGTH(m.name)
      LIMIT 25`,
  )
    .bind(`%${q}%`)
    .all<{
      friend_viewer_id: number;
      current_name: string;
      matched_alias: string | null;
      matched_current: number;
      circle_id: number | null;
    }>();

  return {
    results: results.map((r) => ({
      ...r,
      // Only surface the alias when it is not simply their current name.
      matchedAlias: r.matched_current === 1 ? null : r.matched_alias,
    })),
  };
}

/**
 * The full cross-club standings plus the reshuffle projection — the page
 * members actually come for.
 */
async function getStandings(env: Env) {
  const ymd = await latestDay(env);

  const { results: clubRows } = await env.DB.prepare(
    `SELECT circle_id, name, slot_order, capacity, in_pool, leader_viewer_id_api
       FROM clubs WHERE is_active = 1 ORDER BY slot_order`,
  ).all<{
    circle_id: number;
    name: string;
    slot_order: number;
    capacity: number;
    in_pool: number;
    leader_viewer_id_api: number | null;
  }>();

  const clubs: PromotionClub[] = clubRows.map((c) => ({
    circleId: c.circle_id,
    name: c.name,
    slotOrder: c.slot_order,
    capacity: c.capacity,
    inPool: c.in_pool === 1,
  }));

  const { results: memberRows } = await env.DB.prepare(
    `SELECT md.friend_viewer_id, m.name, md.circle_id, md.mtd_avg, md.mtd_avg_delta,
            md.days_active
       FROM member_day md
       JOIN members m ON m.friend_viewer_id = md.friend_viewer_id
       -- Someone who has left is not in next month's reshuffle and must not be
       -- dealt a seat another member earned (D034).
       JOIN club_roster r ON r.circle_id = md.circle_id
                         AND r.ymd = md.ymd
                         AND r.friend_viewer_id = md.friend_viewer_id
      WHERE md.ymd = ?`,
  )
    .bind(ymd)
    .all<{
      friend_viewer_id: number;
      name: string;
      circle_id: number;
      mtd_avg: number;
      mtd_avg_delta: number;
      days_active: number;
    }>();

  // Only manual pins: a 'leader' pin is the officers' proposal for the next
  // reshuffle and holds nobody (D027).
  const { results: pinRows } = await env.DB.prepare(
    "SELECT friend_viewer_id, circle_id FROM member_pins WHERE kind = 'manual' AND unset_at IS NULL",
  ).all<{ friend_viewer_id: number; circle_id: number }>();

  const pins = buildPins(
    clubRows.map((c) => ({ circleId: c.circle_id, leaderViewerId: c.leader_viewer_id_api })),
    pinRows.map((p) => ({ friendViewerId: p.friend_viewer_id, circleId: p.circle_id })),
  );

  const projection = projectPromotion(
    memberRows.map((r) => ({
      friendViewerId: r.friend_viewer_id,
      name: r.name,
      currentCircleId: r.circle_id,
      mtdAvg: r.mtd_avg,
    })),
    clubs,
    pins,
  );

  // Attach the numbers the UI needs alongside each placement.
  const extra = new Map(memberRows.map((r) => [r.friend_viewer_id, r]));
  const placements = projection.placements.map((p) => ({
    ...p,
    mtdAvg: extra.get(p.friendViewerId)?.mtd_avg ?? 0,
    mtdAvgDelta: extra.get(p.friendViewerId)?.mtd_avg_delta ?? 0,
    daysActive: extra.get(p.friendViewerId)?.days_active ?? 0,
  }));

  return {
    ymd,
    placements,
    clubs: projection.clubs.map((c) => ({
      circleId: c.circleId,
      name: c.name,
      slotOrder: c.slotOrder,
      capacity: c.capacity,
      entryThreshold: c.entryThreshold,
      size: c.members.length,
    })),
    waitlist: projection.waitlist.map((p) => p.friendViewerId),
    outOfPool: projection.outOfPool.map((p) => p.friendViewerId),
  };
}

async function getMeta(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT circle_id, kind, status, started_at, rows_written, error
       FROM ingest_runs
      WHERE id IN (SELECT MAX(id) FROM ingest_runs GROUP BY circle_id, kind)
      ORDER BY circle_id`,
  ).all();

  return { ymd: await latestDay(env), runs: results };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? CACHE_CONTROL : "no-store",
    },
  });
}
