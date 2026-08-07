// Officer-only API.
//
// Everything here mutates, so nothing is cached, every route requires a valid
// session, and every change is written to audit_log.

import { audit, currentOfficer, hashPassword, login, logout, type Officer } from "./auth.ts";
import { ingestAll, latestDataYmd, recomputeOverallRanks } from "./ingest.ts";
import { projectPromotion, type Pin, type PromotionClub } from "./promotion.ts";
import type { Env } from "./types.ts";

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");

  // Login is the only unauthenticated route.
  if (path === "login" && request.method === "POST") {
    const body = await readJson<{ username?: string; password?: string }>(request);
    if (!body?.username || !body?.password) {
      return json({ error: "username and password required" }, 400);
    }
    const result = await login(env, body.username, body.password, request);
    if ("error" in result) return json({ error: result.error }, result.status);
    return json({ officer: result.officer }, 200, { "set-cookie": result.cookie });
  }

  const officer = await currentOfficer(env, request);
  if (!officer) return json({ error: "not signed in" }, 401);

  if (path === "logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": await logout(env, request) });
  }

  if (path === "me") return json({ officer });

  try {
    switch (path) {
      case "notices":
        return await notices(request, env, officer);
      case "pins":
        return await pins(request, env, officer);
      case "clubs":
        return await adminClubs(request, env, officer);
      case "roster":
        return await roster(request, env, officer, url);
      case "officers":
        return await officers(request, env, officer);
      case "ingest":
        return await manualIngest(request, env, officer);
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// -------------------------------------------------------------- notices ----

async function notices(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method === "GET") {
    // Nothing is deleted: done notices move to the archive and stay readable.
    const { results } = await env.DB.prepare(
      `SELECT n.id, n.body, n.circle_id, n.created_at, n.done_at,
              a.display_name AS author, d.display_name AS done_by_name
         FROM notices n
         LEFT JOIN officers a ON a.id = n.author_id
         LEFT JOIN officers d ON d.id = n.done_by
        ORDER BY n.done_at IS NOT NULL, n.created_at DESC`,
    ).all();
    return json({ notices: results });
  }

  if (request.method === "POST") {
    const body = await readJson<{ body?: string; circleId?: number | null }>(request);
    if (!body?.body?.trim()) return json({ error: "body required" }, 400);

    const result = await env.DB.prepare(
      "INSERT INTO notices (body, author_id, circle_id, created_at) VALUES (?, ?, ?, ?)",
    )
      .bind(body.body.trim(), officer.id, body.circleId ?? null, new Date().toISOString())
      .run();

    await audit(env, officer.id, "notice.create", { id: result.meta.last_row_id });
    return json({ ok: true, id: result.meta.last_row_id });
  }

  if (request.method === "PATCH") {
    const body = await readJson<{ id?: number; done?: boolean }>(request);
    if (!body?.id) return json({ error: "id required" }, 400);

    const done = body.done !== false;
    await env.DB.prepare("UPDATE notices SET done_at = ?, done_by = ? WHERE id = ?")
      .bind(done ? new Date().toISOString() : null, done ? officer.id : null, body.id)
      .run();

    await audit(env, officer.id, done ? "notice.done" : "notice.reopen", { id: body.id });
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

// ----------------------------------------------------------------- pins ----

async function pins(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.friend_viewer_id, p.circle_id, p.kind, p.reason, p.set_at,
              m.name, o.display_name AS set_by_name
         FROM member_pins p
         LEFT JOIN members m ON m.friend_viewer_id = p.friend_viewer_id
         LEFT JOIN officers o ON o.id = p.set_by
        WHERE p.unset_at IS NULL
        ORDER BY p.circle_id, m.name`,
    ).all();
    return json({ pins: results });
  }

  if (request.method === "POST") {
    const body = await readJson<{
      friendViewerId?: number;
      circleId?: number;
      kind?: string;
      reason?: string;
    }>(request);
    if (!body?.friendViewerId || !body?.circleId) {
      return json({ error: "friendViewerId and circleId required" }, 400);
    }

    // A member can only be pinned to one club; replace rather than stack.
    await env.DB.prepare(
      "UPDATE member_pins SET unset_at = ? WHERE friend_viewer_id = ? AND unset_at IS NULL",
    )
      .bind(new Date().toISOString(), body.friendViewerId)
      .run();

    await env.DB.prepare(
      `INSERT INTO member_pins (circle_id, friend_viewer_id, kind, reason, set_by, set_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.circleId,
        body.friendViewerId,
        body.kind === "leader" ? "leader" : "manual",
        body.reason ?? null,
        officer.id,
        new Date().toISOString(),
      )
      .run();

    await audit(env, officer.id, "pin.set", body);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const body = await readJson<{ friendViewerId?: number }>(request);
    if (!body?.friendViewerId) return json({ error: "friendViewerId required" }, 400);

    // Kept as history so past projections stay reproducible.
    await env.DB.prepare(
      "UPDATE member_pins SET unset_at = ? WHERE friend_viewer_id = ? AND unset_at IS NULL",
    )
      .bind(new Date().toISOString(), body.friendViewerId)
      .run();

    await audit(env, officer.id, "pin.clear", body);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

// ---------------------------------------------------------------- clubs ----

async function adminClubs(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT circle_id, name, slot_order, capacity, in_pool, is_active FROM clubs ORDER BY slot_order",
    ).all();
    return json({ clubs: results });
  }

  // Add a club ad-hoc by circle id (D020).
  if (request.method === "POST") {
    const body = await readJson<{ circleId?: number; name?: string; slotOrder?: number }>(request);
    if (!body?.circleId) return json({ error: "circleId required" }, 400);

    const next = await env.DB.prepare("SELECT COALESCE(MAX(slot_order), 0) + 1 AS n FROM clubs")
      .first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO clubs (circle_id, name, slot_order, added_by, added_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (circle_id) DO UPDATE SET is_active = 1`,
    )
      .bind(
        body.circleId,
        body.name ?? `Club ${body.circleId}`,
        body.slotOrder ?? next?.n ?? 1,
        officer.id,
        new Date().toISOString(),
      )
      .run();

    await audit(env, officer.id, "club.add", body);
    // The next ingest picks it up; no deploy needed.
    return json({ ok: true });
  }

  if (request.method === "PATCH") {
    const body = await readJson<{
      clubs?: { circleId: number; slotOrder?: number; capacity?: number; inPool?: boolean; isActive?: boolean }[];
    }>(request);
    if (!body?.clubs?.length) return json({ error: "clubs required" }, 400);

    await env.DB.batch(
      body.clubs.map((club) =>
        env.DB.prepare(
          `UPDATE clubs SET
             slot_order = COALESCE(?, slot_order),
             capacity   = COALESCE(?, capacity),
             in_pool    = COALESCE(?, in_pool),
             is_active  = COALESCE(?, is_active)
           WHERE circle_id = ?`,
        ).bind(
          club.slotOrder ?? null,
          club.capacity ?? null,
          club.inPool === undefined ? null : club.inPool ? 1 : 0,
          club.isActive === undefined ? null : club.isActive ? 1 : 0,
          club.circleId,
        ),
      ),
    );

    await audit(env, officer.id, "club.update", body.clubs);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

// --------------------------------------------------------------- roster ----

/**
 * The hand-editable reshuffle plan (D022).
 *
 * GET seeds a draft from the projection the first time it is opened, then
 * always returns the stored plan — so officer edits survive the nightly
 * re-projection instead of being silently overwritten.
 */
async function roster(request: Request, env: Env, officer: Officer, url: URL): Promise<Response> {
  const yearMonth = Number(url.searchParams.get("month")) || currentYearMonth();

  if (request.method === "GET") {
    let plan = await env.DB.prepare("SELECT * FROM roster_plans WHERE year_month = ?")
      .bind(yearMonth)
      .first<{ id: number; status: string; note: string | null }>();

    if (!plan) {
      const seeded = await seedPlan(env, officer, yearMonth);
      plan = seeded;
    }

    const { results: entries } = await env.DB.prepare(
      `SELECT e.friend_viewer_id, e.circle_id, e.position, e.source, e.projected_circle_id,
              m.name, md.mtd_avg
         FROM roster_plan_entries e
         LEFT JOIN members m ON m.friend_viewer_id = e.friend_viewer_id
         LEFT JOIN member_day md
           ON md.friend_viewer_id = e.friend_viewer_id
          AND md.ymd = (SELECT MAX(ymd) FROM member_day)
        WHERE e.plan_id = ?
        ORDER BY e.circle_id, e.position`,
    )
      .bind(plan.id)
      .all();

    const { results: clubs } = await env.DB.prepare(
      "SELECT circle_id, name, slot_order, capacity, in_pool FROM clubs WHERE is_active = 1 ORDER BY slot_order",
    ).all();

    return json({ plan, entries, clubs, yearMonth });
  }

  // Drag-and-drop result: a full new placement for the members that moved.
  if (request.method === "PUT") {
    const body = await readJson<{
      planId?: number;
      moves?: { friendViewerId: number; circleId: number | null; position: number }[];
    }>(request);
    if (!body?.planId || !body?.moves) return json({ error: "planId and moves required" }, 400);

    const now = new Date().toISOString();
    await env.DB.batch(
      body.moves.map((move) =>
        env.DB.prepare(
          `UPDATE roster_plan_entries
              SET circle_id = ?, position = ?,
                  source = CASE WHEN circle_id IS ? THEN source ELSE 'manual' END,
                  moved_by = ?, moved_at = ?
            WHERE plan_id = ? AND friend_viewer_id = ?`,
        ).bind(
          move.circleId,
          move.position,
          move.circleId,
          officer.id,
          now,
          body.planId,
          move.friendViewerId,
        ),
      ),
    );

    await audit(env, officer.id, "roster.move", { planId: body.planId, count: body.moves.length });
    return json({ ok: true });
  }

  // Reset back to the algorithm's proposal, or finalise the plan.
  if (request.method === "POST") {
    const body = await readJson<{ action?: string }>(request);

    if (body?.action === "reset") {
      await env.DB.prepare("DELETE FROM roster_plans WHERE year_month = ?").bind(yearMonth).run();
      await env.DB.prepare(
        "DELETE FROM roster_plan_entries WHERE plan_id NOT IN (SELECT id FROM roster_plans)",
      ).run();
      await seedPlan(env, officer, yearMonth);
      await audit(env, officer.id, "roster.reset", { yearMonth });
      return json({ ok: true });
    }

    if (body?.action === "finalise") {
      await env.DB.prepare(
        "UPDATE roster_plans SET status = 'final', finalised_by = ?, finalised_at = ? WHERE year_month = ?",
      )
        .bind(officer.id, new Date().toISOString(), yearMonth)
        .run();
      await audit(env, officer.id, "roster.finalise", { yearMonth });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  }

  return json({ error: "method not allowed" }, 405);
}

async function seedPlan(
  env: Env,
  officer: Officer,
  yearMonth: number,
): Promise<{ id: number; status: string; note: string | null }> {
  const ymd = (
    await env.DB.prepare("SELECT MAX(ymd) AS ymd FROM member_day").first<{ ymd: number }>()
  )?.ymd;

  const { results: clubRows } = await env.DB.prepare(
    "SELECT circle_id, name, slot_order, capacity, in_pool FROM clubs WHERE is_active = 1",
  ).all<{ circle_id: number; name: string; slot_order: number; capacity: number; in_pool: number }>();

  const { results: memberRows } = await env.DB.prepare(
    `SELECT md.friend_viewer_id, m.name, md.circle_id, md.mtd_avg
       FROM member_day md JOIN members m ON m.friend_viewer_id = md.friend_viewer_id
      WHERE md.ymd = ?`,
  )
    .bind(ymd ?? 0)
    .all<{ friend_viewer_id: number; name: string; circle_id: number; mtd_avg: number }>();

  const { results: pinRows } = await env.DB.prepare(
    "SELECT friend_viewer_id, circle_id, kind FROM member_pins WHERE unset_at IS NULL",
  ).all<{ friend_viewer_id: number; circle_id: number; kind: string }>();

  const clubs: PromotionClub[] = clubRows.map((c) => ({
    circleId: c.circle_id,
    name: c.name,
    slotOrder: c.slot_order,
    capacity: c.capacity,
    inPool: c.in_pool === 1,
  }));

  const pins: Pin[] = pinRows.map((p) => ({
    friendViewerId: p.friend_viewer_id,
    circleId: p.circle_id,
    kind: p.kind === "leader" ? "leader" : "manual",
  }));

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

  const created = await env.DB.prepare(
    "INSERT INTO roster_plans (year_month, status, created_by, created_at) VALUES (?, 'draft', ?, ?)",
  )
    .bind(yearMonth, officer.id, new Date().toISOString())
    .run();

  const planId = created.meta.last_row_id as number;
  const positions = new Map<number, number>();

  await env.DB.batch(
    projection.placements.map((placement) => {
      const key = placement.projectedCircleId ?? 0;
      const position = (positions.get(key) ?? 0) + 1;
      positions.set(key, position);

      return env.DB.prepare(
        `INSERT INTO roster_plan_entries
           (plan_id, friend_viewer_id, circle_id, position, source, projected_circle_id)
         VALUES (?, ?, ?, ?, 'projected', ?)`,
      ).bind(
        planId,
        placement.friendViewerId,
        placement.projectedCircleId,
        position,
        placement.projectedCircleId,
      );
    }),
  );

  return { id: planId, status: "draft", note: null };
}

// --------------------------------------------------------- manual ingest ----

/**
 * Force a data refresh without waiting for the cron.
 *
 * Needed on day one — the cron does not fire until 10:15 UTC, and the
 * unauthenticated dev trigger is denied in production — but it earns its place
 * beyond that: officers will want to pull fresh numbers after a reshuffle
 * rather than wait a day to see whether it landed.
 *
 * Rate limited to once every 10 minutes across all officers, because it makes
 * one upstream request per club and chronogenesis asked us not to hammer it.
 */
async function manualIngest(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const recent = await env.DB.prepare(
    `SELECT started_at FROM ingest_runs
      WHERE kind IN ('daily', 'manual') AND started_at > ?
      ORDER BY started_at DESC LIMIT 1`,
  )
    .bind(new Date(Date.now() - 10 * 60_000).toISOString())
    .first<{ started_at: string }>();

  if (recent) {
    return json(
      { error: `Data was refreshed at ${recent.started_at}. Try again in a few minutes.` },
      429,
    );
  }

  const summaries = await ingestAll(env);
  await recomputeOverallRanks(env, await latestDataYmd(env));
  await audit(env, officer.id, "ingest.manual", { clubs: summaries.length });

  return json({
    ok: summaries.every((s) => s.status === "ok"),
    summaries,
  });
}

// ------------------------------------------------------------- officers ----

async function officers(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, username, display_name, role, is_active, created_at, last_login_at FROM officers ORDER BY username",
    ).all();
    return json({ officers: results });
  }

  // No self-signup: only an admin creates accounts (D012).
  if (request.method === "POST") {
    if (officer.role !== "admin") return json({ error: "admin only" }, 403);

    const body = await readJson<{
      username?: string;
      displayName?: string;
      password?: string;
      role?: string;
    }>(request);
    if (!body?.username || !body?.password) {
      return json({ error: "username and password required" }, 400);
    }
    if (body.password.length < 12) {
      return json({ error: "password must be at least 12 characters" }, 400);
    }

    const { hash, salt, iterations } = await hashPassword(body.password);

    await env.DB.prepare(
      `INSERT INTO officers (username, display_name, pw_hash, pw_salt, pw_iters, role, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.username.trim().toLowerCase(),
        body.displayName ?? body.username,
        hash,
        salt,
        iterations,
        body.role === "admin" ? "admin" : "officer",
        new Date().toISOString(),
        officer.id,
      )
      .run();

    await audit(env, officer.id, "officer.create", { username: body.username });
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

// ---------------------------------------------------------------- utils ----

function currentYearMonth(): number {
  const now = new Date();
  return now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}
