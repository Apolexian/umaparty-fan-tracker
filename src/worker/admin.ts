// Officer-only API.
//
// Everything here mutates, so nothing is cached, every route requires a valid
// session, and every change is written to audit_log.

import {
  audit,
  currentOfficer,
  fromBase64,
  hashPassword,
  login,
  logout,
  type Officer,
} from "./auth.ts";
import { ingestAll, latestDataYmd, recomputeOverallRanks } from "./ingest.ts";
import {
  buildPins,
  fillClubs,
  projectPromotion,
  type Pin,
  type PromotionCandidate,
  type PromotionClub,
} from "./promotion.ts";
import type { Env } from "./types.ts";

export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "").replace(/\/$/, "");

  // Everything is inside the try, including login and the session lookup. They
  // were outside it originally, so when login exceeded the Worker CPU limit the
  // exception escaped as a bare Cloudflare 1101 page with nothing to debug from.
  try {
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
      case "password":
        return await changePassword(request, env, officer);
      case "discord":
        return await discord(request, env, officer);
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (error) {
    // Logged in full; returned generically. Admin errors can carry SQL.
    console.error("admin error", path, error);
    return json({ error: "something went wrong" }, 500);
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
    const kind = body.kind === "leader" ? "leader" : "manual";

    // A member can only be pinned to one club per kind; replace rather than
    // stack. Scoped to the kind because a lead proposal (D027) and a lock
    // (D021) answer different questions — locking someone must not silently
    // withdraw them as a proposed lead, and vice versa.
    await env.DB.prepare(
      "UPDATE member_pins SET unset_at = ? WHERE friend_viewer_id = ? AND kind = ? AND unset_at IS NULL",
    )
      .bind(new Date().toISOString(), body.friendViewerId, kind)
      .run();

    await env.DB.prepare(
      `INSERT INTO member_pins (circle_id, friend_viewer_id, kind, reason, set_by, set_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        body.circleId,
        body.friendViewerId,
        kind,
        body.reason ?? null,
        officer.id,
        new Date().toISOString(),
      )
      .run();

    await audit(env, officer.id, "pin.set", body);
    return json({ ok: true });
  }

  if (request.method === "DELETE") {
    const body = await readJson<{ friendViewerId?: number; kind?: string }>(request);
    if (!body?.friendViewerId) return json({ error: "friendViewerId required" }, 400);
    const kind = body.kind === "leader" ? "leader" : "manual";

    // Kept as history so past projections stay reproducible.
    await env.DB.prepare(
      "UPDATE member_pins SET unset_at = ? WHERE friend_viewer_id = ? AND kind = ? AND unset_at IS NULL",
    )
      .bind(new Date().toISOString(), body.friendViewerId, kind)
      .run();

    await audit(env, officer.id, "pin.clear", body);
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

// ---------------------------------------------------------------- clubs ----

async function adminClubs(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method === "GET") {
    // What officers order clubs by (D039): the club's own daily fan gain from
    // chrono, averaged over the month so far, with chrono's club rank beside it
    // as a cross-check. Both are chrono's facts, not sums we derive.
    const ymd = await latestDataYmd(env);
    const monthStart = Math.floor(ymd / 100) * 100 + 1;
    const { results } = await env.DB.prepare(
      `SELECT c.circle_id, c.name, c.slot_order, c.capacity, c.in_pool, c.is_active,
              (SELECT CAST(AVG(d.fan_gain) AS INTEGER) FROM club_day d
                WHERE d.circle_id = c.circle_id AND d.ymd BETWEEN ? AND ?) AS avg_daily_gain,
              (SELECT d.rank FROM club_day d
                WHERE d.circle_id = c.circle_id AND d.ymd <= ?
                ORDER BY d.ymd DESC LIMIT 1) AS club_rank
         FROM clubs c
        ORDER BY c.slot_order`,
    )
      .bind(monthStart, ymd, ymd)
      .all();
    return json({ clubs: results, dataYmd: ymd });
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

  // A new running order (D039): every club id, top first. Renumbered 1..n in
  // one batch, because placement finds "the club above" as slotOrder - 1 and a
  // gap or a duplicate would break the cascade.
  if (request.method === "PUT") {
    const body = await readJson<{ order?: number[] }>(request);
    const order = body?.order;
    if (!order?.length) return json({ error: "order required" }, 400);

    const { results: existing } = await env.DB.prepare("SELECT circle_id FROM clubs")
      .all<{ circle_id: number }>();
    const ids = new Set(existing.map((c) => c.circle_id));
    if (
      order.length !== ids.size ||
      new Set(order).size !== order.length ||
      !order.every((id) => ids.has(id))
    ) {
      return json({ error: "order must list every club exactly once" }, 400);
    }

    await env.DB.batch(
      order.map((circleId, index) =>
        env.DB.prepare("UPDATE clubs SET slot_order = ? WHERE circle_id = ?").bind(index + 1, circleId),
      ),
    );

    await audit(env, officer.id, "club.reorder", { order });
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
    const findPlan = () =>
      env.DB.prepare(
        `SELECT id, year_month, status, note, baseline, finalised_at, report_json
           FROM roster_plans WHERE year_month = ?`,
      )
        .bind(yearMonth)
        .first<{ id: number; status: string; note: string | null; baseline: string; report_json: string | null }>();

    let plan = await findPlan();
    if (!plan) {
      await rebuildPlan(env, officer, yearMonth, "projection");
      plan = await findPlan();
      if (!plan) return json({ error: "could not create a plan" }, 500);
    }

    const dataYmd = await latestDataYmd(env);

    // `actual_circle_id` is where chrono has them today, against which a
    // finalised plan is checked. Nothing here moves anyone: the reshuffle is
    // done by hand in-game, so the plan and reality can diverge silently.
    // Read from chrono's roster, not `member_day.circle_id`, which goes stale
    // for anyone who has left (D034).
    const { results: entries } = await env.DB.prepare(
      `SELECT e.friend_viewer_id, e.circle_id, e.position, e.source, e.projected_circle_id,
              e.leaving, e.est_mtd_avg, m.name, md.mtd_avg, r.circle_id AS actual_circle_id,
              r.membership AS chrono_role
         FROM roster_plan_entries e
         LEFT JOIN members m ON m.friend_viewer_id = e.friend_viewer_id
         LEFT JOIN member_day md
           ON md.friend_viewer_id = e.friend_viewer_id
          AND md.ymd = ?
         LEFT JOIN club_roster r
           ON r.friend_viewer_id = e.friend_viewer_id
          AND r.ymd = ?
          AND r.circle_id IN (SELECT circle_id FROM clubs WHERE is_active = 1)
        WHERE e.plan_id = ?
        ORDER BY e.circle_id, e.position`,
    )
      .bind(dataYmd, dataYmd, plan.id)
      .all();

    const { results: clubs } = await env.DB.prepare(
      "SELECT circle_id, name, slot_order, capacity, in_pool FROM clubs WHERE is_active = 1 ORDER BY slot_order",
    ).all();

    const { report_json, ...planFields } = plan;
    const report = report_json ? (JSON.parse(report_json) as ReshuffleReport) : null;

    const { results: checks } = report
      ? await env.DB.prepare(
          `SELECT k.friend_viewer_id, k.circle_id, k.kind, o.display_name AS checked_by_name
             FROM roster_report_checks k
             LEFT JOIN officers o ON o.id = k.checked_by
            WHERE k.plan_id = ?`,
        )
          .bind(plan.id)
          .all()
      : { results: [] };

    return json({ plan: planFields, report, checks, entries, clubs, yearMonth, dataYmd });
  }

  // Drag-and-drop result: a full new placement for the members that moved.
  if (request.method === "PUT") {
    const body = await readJson<{
      planId?: number;
      moves?: { friendViewerId: number; circleId: number | null; position: number; leaving?: boolean }[];
    }>(request);
    if (!body?.planId || !body?.moves) return json({ error: "planId and moves required" }, 400);

    // Chrono's club leads stay in their club (D044). Enforced here as well as
    // in the editor, so no client can move one by accident. Officers move
    // like anyone else.
    if (body.moves.length > 0) {
      const ids = body.moves.map((m) => m.friendViewerId);
      const { results: held } = await env.DB.prepare(
        `SELECT r.friend_viewer_id, r.circle_id, r.membership, COALESCE(m.name, '') AS name
           FROM club_roster r
           JOIN clubs c ON c.circle_id = r.circle_id AND c.is_active = 1
           LEFT JOIN members m ON m.friend_viewer_id = r.friend_viewer_id
          WHERE r.ymd = ? AND r.membership = 3
            AND r.friend_viewer_id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(await latestDataYmd(env), ...ids)
        .all<{ friend_viewer_id: number; circle_id: number; membership: number; name: string }>();

      for (const h of held) {
        const move = body.moves.find((m) => m.friendViewerId === h.friend_viewer_id)!;
        if (move.leaving === true || move.circleId !== h.circle_id) {
          return json({ error: `${h.name || h.friend_viewer_id} is a club lead and stays in their club` }, 409);
        }
      }
    }

    const now = new Date().toISOString();
    await env.DB.batch(
      body.moves.map((move) => {
        // Leaving (D042) has no club; a member in a club is never leaving.
        const leaving = move.leaving === true ? 1 : 0;
        const circleId = leaving ? null : move.circleId;
        return env.DB.prepare(
          `UPDATE roster_plan_entries
              SET circle_id = ?, position = ?, leaving = ?,
                  source = CASE WHEN circle_id IS ? AND leaving = ? THEN source ELSE 'manual' END,
                  moved_by = ?, moved_at = ?
            WHERE plan_id = ? AND friend_viewer_id = ?`,
        ).bind(
          circleId,
          move.position,
          leaving,
          circleId,
          leaving,
          officer.id,
          now,
          body.planId,
          move.friendViewerId,
        );
      }),
    );

    await audit(env, officer.id, "roster.move", { planId: body.planId, count: body.moves.length });
    return json({ ok: true });
  }

  // Reset back to the algorithm's proposal, or finalise the plan.
  if (request.method === "POST") {
    const body = await readJson<{
      action?: string;
      friendViewerId?: number;
      name?: string;
      circleId?: number | null;
      kind?: string;
      checked?: boolean;
      estMtdAvg?: number | null;
    }>(request);

    if (body?.action === "fill") {
      return await fillPlan(env, officer, yearMonth);
    }

    if (body?.action === "add") {
      return await addPlanMember(env, officer, yearMonth, body);
    }

    // Set or clear an officer's fans/day estimate on one entry (D043).
    if (body?.action === "estimate") {
      const est = parseEstimate(body.estMtdAvg);
      if (est === undefined) return json({ error: "fans/day must be a whole number, 0 or more" }, 400);

      const result = await env.DB.prepare(
        `UPDATE roster_plan_entries SET est_mtd_avg = ?
          WHERE plan_id = (SELECT id FROM roster_plans WHERE year_month = ?) AND friend_viewer_id = ?`,
      )
        .bind(est, yearMonth, Number(body.friendViewerId))
        .run();
      if (result.meta.changes === 0) return json({ error: "not in the plan" }, 404);

      await audit(env, officer.id, "roster.estimate", { friendViewerId: body.friendViewerId, est });
      return json({ ok: true });
    }

    // Remove someone from the plan entirely (D042). Only from Leaving: the
    // server refuses anyone else, so a slip in a club column cannot delete a
    // member — they have to be deliberately moved to Leaving first.
    if (body?.action === "remove") {
      const friendViewerId = Number(body.friendViewerId);
      const plan = await env.DB.prepare("SELECT id FROM roster_plans WHERE year_month = ?")
        .bind(yearMonth)
        .first<{ id: number }>();
      if (!plan) return json({ error: "no plan for this month" }, 404);

      const entry = await env.DB.prepare(
        "SELECT leaving FROM roster_plan_entries WHERE plan_id = ? AND friend_viewer_id = ?",
      )
        .bind(plan.id, friendViewerId)
        .first<{ leaving: number }>();
      if (!entry) return json({ error: "not in the plan" }, 404);
      // Club leads cannot reach Leaving (D044), so this also keeps them in.
      if (entry.leaving !== 1) {
        return json({ error: "only members in Leaving can be removed" }, 409);
      }

      await env.DB.batch([
        env.DB.prepare("DELETE FROM roster_plan_entries WHERE plan_id = ? AND friend_viewer_id = ?")
          .bind(plan.id, friendViewerId),
        env.DB.prepare("DELETE FROM roster_report_checks WHERE plan_id = ? AND friend_viewer_id = ?")
          .bind(plan.id, friendViewerId),
      ]);
      await audit(env, officer.id, "roster.remove", { planId: plan.id, friendViewerId });
      return json({ ok: true });
    }

    if (body?.action === "reset") {
      await rebuildPlan(env, officer, yearMonth, "projection");
      await audit(env, officer.id, "roster.reset", { yearMonth });
      return json({ ok: true });
    }

    if (body?.action === "chrono") {
      await rebuildPlan(env, officer, yearMonth, "chrono");
      await audit(env, officer.id, "roster.match_chrono", { yearMonth });
      return json({ ok: true });
    }

    // Tick or untick one line of the kick/invite checklist (D041).
    if (body?.action === "check") {
      const plan = await env.DB.prepare("SELECT id FROM roster_plans WHERE year_month = ?")
        .bind(yearMonth)
        .first<{ id: number }>();
      if (!plan) return json({ error: "no plan for this month" }, 404);

      const friendViewerId = Number(body.friendViewerId);
      const circleId = Number(body.circleId);
      const kind = body.kind === "kick" || body.kind === "invite" ? body.kind : null;
      if (!friendViewerId || !circleId || !kind) {
        return json({ error: "friendViewerId, circleId and kind required" }, 400);
      }

      await env.DB.prepare(
        body.checked
          ? `INSERT OR IGNORE INTO roster_report_checks
               (plan_id, friend_viewer_id, circle_id, kind, checked_by, checked_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          : `DELETE FROM roster_report_checks
              WHERE plan_id = ? AND friend_viewer_id = ? AND circle_id = ? AND kind = ?`,
      )
        .bind(
          ...(body.checked
            ? [plan.id, friendViewerId, circleId, kind, officer.id, new Date().toISOString()]
            : [plan.id, friendViewerId, circleId, kind]),
        )
        .run();

      await audit(env, officer.id, body.checked ? "report.check" : "report.uncheck", {
        planId: plan.id,
        friendViewerId,
        circleId,
        kind,
      });
      return json({ ok: true });
    }

    if (body?.action === "finalise") {
      const plan = await env.DB.prepare("SELECT id FROM roster_plans WHERE year_month = ?")
        .bind(yearMonth)
        .first<{ id: number }>();
      if (!plan) return json({ error: "no plan for this month" }, 404);

      const report = await buildReshuffleReport(env, plan.id);
      await env.DB.prepare(
        `UPDATE roster_plans SET status = 'final', finalised_by = ?, finalised_at = ?, report_json = ?
          WHERE id = ?`,
      )
        .bind(officer.id, report.generatedAt, JSON.stringify(report), plan.id)
        .run();
      await audit(env, officer.id, "roster.finalise", {
        yearMonth,
        kicks: report.clubs.reduce((n, c) => n + c.kick.length, 0),
        invites: report.clubs.reduce((n, c) => n + c.invite.length, 0),
      });
      return json({ ok: true, report });
    }

    return json({ error: "unknown action" }, 400);
  }

  return json({ error: "method not allowed" }, 405);
}

interface ReportMember {
  friendViewerId: number;
  name: string;
  /** Kick: the club they are going to. Invite: the club they are coming from. null = none of ours. */
  otherCircleId: number | null;
  otherClub: string | null;
}

interface ReshuffleReport {
  generatedAt: string;
  /** The chrono day the "current club" side was read from. */
  dataYmd: number;
  clubs: { circleId: number; name: string; kick: ReportMember[]; invite: ReportMember[] }[];
  /** In a club now, but the plan leaves them unplaced — no action is listed for them. */
  unplaced: ReportMember[];
  /** On chrono's roster, but not in the plan at all (joined after it was built). */
  notInPlan: ReportMember[];
}

/**
 * What each club has to do in-game to carry out a plan (D041): who to kick
 * and who to invite, diffed against chrono's roster for the site's day.
 *
 * A member moving A → B is a kick in A and an invite in B. Someone not in any
 * of our clubs now (added by hand, D030) is only an invite. Unplaced members
 * and members missing from the plan are reported, never turned into kicks —
 * an unfinished plan must not tell anyone to remove a member.
 */
async function buildReshuffleReport(env: Env, planId: number): Promise<ReshuffleReport> {
  const dataYmd = await latestDataYmd(env);

  const { results: clubs } = await env.DB.prepare(
    "SELECT circle_id, name FROM clubs WHERE is_active = 1 ORDER BY slot_order",
  ).all<{ circle_id: number; name: string }>();
  const clubName = new Map(clubs.map((c) => [c.circle_id, c.name]));

  const { results: entries } = await env.DB.prepare(
    `SELECT e.friend_viewer_id, e.circle_id AS planned, r.circle_id AS current, e.leaving,
            COALESCE(m.name, CAST(e.friend_viewer_id AS TEXT)) AS name
       FROM roster_plan_entries e
       LEFT JOIN members m ON m.friend_viewer_id = e.friend_viewer_id
       LEFT JOIN club_roster r
         ON r.friend_viewer_id = e.friend_viewer_id AND r.ymd = ?
        AND r.circle_id IN (SELECT circle_id FROM clubs WHERE is_active = 1)
      WHERE e.plan_id = ?
      ORDER BY name COLLATE NOCASE`,
  )
    .bind(dataYmd, planId)
    .all<{
      friend_viewer_id: number;
      planned: number | null;
      current: number | null;
      leaving: number;
      name: string;
    }>();

  const { results: missing } = await env.DB.prepare(
    `SELECT r.friend_viewer_id, r.circle_id,
            COALESCE(m.name, CAST(r.friend_viewer_id AS TEXT)) AS name
       FROM club_roster r
       JOIN clubs c ON c.circle_id = r.circle_id AND c.is_active = 1
       LEFT JOIN members m ON m.friend_viewer_id = r.friend_viewer_id
      WHERE r.ymd = ?
        AND r.friend_viewer_id NOT IN (SELECT friend_viewer_id FROM roster_plan_entries WHERE plan_id = ?)
      ORDER BY c.slot_order, name COLLATE NOCASE`,
  )
    .bind(dataYmd, planId)
    .all<{ friend_viewer_id: number; circle_id: number; name: string }>();

  const member = (friendViewerId: number, name: string, other: number | null): ReportMember => ({
    friendViewerId,
    name,
    otherCircleId: other,
    otherClub: other === null ? null : (clubName.get(other) ?? `Club ${other}`),
  });

  const report: ReshuffleReport = {
    generatedAt: new Date().toISOString(),
    dataYmd,
    clubs: clubs.map((c) => ({ circleId: c.circle_id, name: c.name, kick: [], invite: [] })),
    unplaced: [],
    notInPlan: missing.map((m) => member(m.friend_viewer_id, m.name, m.circle_id)),
  };
  const section = new Map(report.clubs.map((c) => [c.circleId, c]));

  for (const e of entries) {
    // Leaving (D042) is a decision, so it is a kick — with nowhere to go. A
    // leaver chrono already shows outside our clubs needs nothing.
    if (e.leaving === 1) {
      if (e.current !== null) section.get(e.current)?.kick.push(member(e.friend_viewer_id, e.name, null));
      continue;
    }
    if (e.planned === null) {
      if (e.current !== null) report.unplaced.push(member(e.friend_viewer_id, e.name, e.current));
      continue;
    }
    if (e.planned === e.current) continue;
    if (e.current !== null) {
      section.get(e.current)?.kick.push(member(e.friend_viewer_id, e.name, e.planned));
    }
    section.get(e.planned)?.invite.push(member(e.friend_viewer_id, e.name, e.current));
  }

  return report;
}

/**
 * Fill every club to capacity by rank, leaving hand placements alone (D029).
 *
 * Locked = members an officer has dragged (`source = 'manual'`) plus the
 * standing pins, so a fill respects both the one-off overrides of D022 and the
 * standing rules of D021. Everyone else is re-dealt, which is what pulls an
 * overfilled club back down to capacity.
 *
 * Only the rows that actually change are written, so `moved_at` keeps meaning
 * "when a human last touched this" and a fill that moves nobody is a no-op.
 */
async function fillPlan(env: Env, officer: Officer, yearMonth: number): Promise<Response> {
  const plan = await env.DB.prepare("SELECT id, status FROM roster_plans WHERE year_month = ?")
    .bind(yearMonth)
    .first<{ id: number; status: string }>();
  if (!plan) return json({ error: "no plan for this month" }, 404);

  const { results: allEntries } = await env.DB.prepare(
    `SELECT friend_viewer_id, circle_id, source, leaving, est_mtd_avg
       FROM roster_plan_entries WHERE plan_id = ?`,
  )
    .bind(plan.id)
    .all<{
      friend_viewer_id: number;
      circle_id: number | null;
      source: string;
      leaving: number;
      est_mtd_avg: number | null;
    }>();

  // Leavers (D042) are out of the deal entirely: not seated, not locked, not
  // written. Otherwise a fill would quietly put them back in a club.
  const leavers = new Set(allEntries.filter((e) => e.leaving === 1).map((e) => e.friend_viewer_id));
  const entries = allEntries.filter((e) => !leavers.has(e.friend_viewer_id));

  const inputs = await loadPlacementInputs(env);
  const clubs = inputs.clubs;
  const candidates = inputs.candidates.filter((c) => !leavers.has(c.friendViewerId));
  const pins = inputs.pins.filter((p) => !leavers.has(p.friendViewerId));

  // A member added by hand has no `member_day` row yet, so they are missing
  // from `candidates` — carry them in on the officer's estimate (D043), or
  // with no average, which sorts them last.
  const known = new Set(candidates.map((c) => c.friendViewerId));
  const extra = entries.filter((e) => !known.has(e.friend_viewer_id));
  if (extra.length > 0) {
    const names = new Map(
      (
        await env.DB.prepare(
          `SELECT friend_viewer_id, name FROM members
            WHERE friend_viewer_id IN (${extra.map(() => "?").join(",")})`,
        )
          .bind(...extra.map((e) => e.friend_viewer_id))
          .all<{ friend_viewer_id: number; name: string }>()
      ).results.map((r) => [r.friend_viewer_id, r.name] as const),
    );

    // An unplaced member has no club to call "current". Anchoring them to the
    // first pooled club keeps them inside the pool so the fill deals them a
    // seat; a club id of 0 would read as out-of-pool and leave them unplaced
    // for good.
    const fallbackCircleId = clubs.find((c) => c.inPool !== false)?.circleId ?? 0;

    for (const entry of extra) {
      candidates.push({
        friendViewerId: entry.friend_viewer_id,
        name: names.get(entry.friend_viewer_id) ?? String(entry.friend_viewer_id),
        currentCircleId: entry.circle_id ?? fallbackCircleId,
        mtdAvg: entry.est_mtd_avg ?? 0,
      });
    }
  }

  // Hand placements outrank the standing locks: an officer moving someone this
  // month is a deliberate override of where a lock would put them. Chrono's
  // club leads are the exception — nothing moves them (D044), so a hand
  // placement left over from before that rule cannot either.
  const chronoHeld = new Set(
    pins.filter((p) => p.kind !== "manual").map((p) => p.friendViewerId),
  );
  const locked: Pin[] = pins.filter(
    (pin) =>
      chronoHeld.has(pin.friendViewerId) ||
      entries.every((e) => e.friend_viewer_id !== pin.friendViewerId || e.source !== "manual"),
  );
  for (const entry of entries) {
    if (chronoHeld.has(entry.friend_viewer_id)) continue;
    if (entry.source === "manual" && entry.circle_id !== null) {
      locked.push({
        friendViewerId: entry.friend_viewer_id,
        circleId: entry.circle_id,
        kind: "manual",
      });
    }
  }

  const result = fillClubs(candidates, clubs, locked);

  const was = new Map(entries.map((e) => [e.friend_viewer_id, e.circle_id]));
  const positions = new Map<number, number>();
  const writes = [];

  for (const placement of result.placements) {
    const key = placement.projectedCircleId ?? 0;
    const position = (positions.get(key) ?? 0) + 1;
    positions.set(key, position);

    if (!was.has(placement.friendViewerId)) continue;
    if (was.get(placement.friendViewerId) === placement.projectedCircleId) continue;

    writes.push(
      env.DB.prepare(
        `UPDATE roster_plan_entries SET circle_id = ?, position = ?
          WHERE plan_id = ? AND friend_viewer_id = ?`,
      ).bind(placement.projectedCircleId, position, plan.id, placement.friendViewerId),
    );
  }

  if (writes.length > 0) await env.DB.batch(writes);

  await audit(env, officer.id, "roster.fill", { planId: plan.id, moved: writes.length });
  return json({ ok: true, moved: writes.length });
}

/**
 * Add someone to the plan by viewer id.
 *
 * Chrono has no working per-member lookup — `GET /profile` answers 422 for
 * every id, valid or not, and `/friend_search` 500s — so a name is resolved
 * from what the ingest has already stored, and the officer types one when even
 * that comes up empty (D030).
 *
 * The new entry is `manual`, so a later fill will not quietly evict someone an
 * officer just added.
 */
async function addPlanMember(
  env: Env,
  officer: Officer,
  yearMonth: number,
  body: { friendViewerId?: number; name?: string; circleId?: number | null; estMtdAvg?: number | null },
): Promise<Response> {
  const friendViewerId = Number(body.friendViewerId);
  if (!Number.isSafeInteger(friendViewerId) || friendViewerId <= 0) {
    return json({ error: "a numeric friendViewerId is required" }, 400);
  }
  const est = parseEstimate(body.estMtdAvg);
  if (est === undefined) return json({ error: "fans/day must be a whole number, 0 or more" }, 400);

  const plan = await env.DB.prepare("SELECT id FROM roster_plans WHERE year_month = ?")
    .bind(yearMonth)
    .first<{ id: number }>();
  if (!plan) return json({ error: "no plan for this month" }, 404);

  const already = await env.DB.prepare(
    "SELECT 1 AS hit FROM roster_plan_entries WHERE plan_id = ? AND friend_viewer_id = ?",
  )
    .bind(plan.id, friendViewerId)
    .first<{ hit: number }>();
  if (already) return json({ error: "already in the plan" }, 409);

  const known = await env.DB.prepare("SELECT name FROM members WHERE friend_viewer_id = ?")
    .bind(friendViewerId)
    .first<{ name: string }>();

  const name = known?.name ?? body.name?.trim();
  if (!name) return json({ error: "unknown id — a name is required", needsName: true }, 404);

  const now = new Date().toISOString();

  // Members the ingest has never seen need a row of their own, or the plan
  // would join to nothing and show a blank name.
  if (!known) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO members (friend_viewer_id, name, updated_at) VALUES (?, ?, ?)",
    )
      .bind(friendViewerId, name, now)
      .run();
  }

  const circleId = body.circleId ?? null;
  const next = await env.DB.prepare(
    "SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM roster_plan_entries WHERE plan_id = ? AND circle_id IS ?",
  )
    .bind(plan.id, circleId)
    .first<{ pos: number }>();

  await env.DB.prepare(
    `INSERT INTO roster_plan_entries
       (plan_id, friend_viewer_id, circle_id, position, source, projected_circle_id, moved_by, moved_at, est_mtd_avg)
     VALUES (?, ?, ?, ?, 'manual', NULL, ?, ?, ?)`,
  )
    .bind(plan.id, friendViewerId, circleId, next?.pos ?? 1, officer.id, now, est)
    .run();

  await audit(env, officer.id, "roster.add", { planId: plan.id, friendViewerId, name, est });
  return json({ ok: true, friendViewerId, name });
}

/**
 * Everything a placement run needs: today's members, the clubs, and the pins.
 * Shared by the initial seed and by "fill clubs", so the two can never drift
 * apart on which members or capacities they see.
 */
async function loadPlacementInputs(env: Env): Promise<{
  candidates: PromotionCandidate[];
  clubs: PromotionClub[];
  pins: Pin[];
}> {
  // The site's day, not MAX(ymd): on a day one club lands late, MAX(ymd) has
  // no rows for that club and its members would drop out of the plan (D038).
  const ymd = await latestDataYmd(env);

  const { results: clubRows } = await env.DB.prepare(
    `SELECT circle_id, name, slot_order, capacity, in_pool, leader_viewer_id_api
       FROM clubs WHERE is_active = 1`,
  ).all<{
    circle_id: number;
    name: string;
    slot_order: number;
    capacity: number;
    in_pool: number;
    leader_viewer_id_api: number | null;
  }>();

  const { results: memberRows } = await env.DB.prepare(
    `SELECT md.friend_viewer_id, m.name, md.circle_id, md.mtd_avg
       FROM member_day md JOIN members m ON m.friend_viewer_id = md.friend_viewer_id
      WHERE md.ymd = ?`,
  )
    .bind(ymd ?? 0)
    .all<{ friend_viewer_id: number; name: string; circle_id: number; mtd_avg: number }>();

  // Manual pins only — a 'leader' pin is a proposal and holds nobody (D027).
  const { results: pinRows } = await env.DB.prepare(
    "SELECT friend_viewer_id, circle_id FROM member_pins WHERE kind = 'manual' AND unset_at IS NULL",
  ).all<{ friend_viewer_id: number; circle_id: number }>();

  return {
    candidates: memberRows.map((r) => ({
      friendViewerId: r.friend_viewer_id,
      name: r.name,
      currentCircleId: r.circle_id,
      mtdAvg: r.mtd_avg,
    })),
    clubs: clubRows.map((c) => ({
      circleId: c.circle_id,
      name: c.name,
      slotOrder: c.slot_order,
      capacity: c.capacity,
      inPool: c.in_pool === 1,
    })),
    pins: buildPins(
      clubRows.map((c) => ({ circleId: c.circle_id, leaderViewerId: c.leader_viewer_id_api })),
      pinRows.map((p) => ({ friendViewerId: p.friend_viewer_id, circleId: p.circle_id })),
    ),
  };
}

type PlanBaseline = "projection" | "chrono";

/**
 * Build a month's plan from scratch, replacing any plan already there.
 *
 * - `projection`: the algorithm's proposal (D022) — "Redo projection".
 * - `chrono`: everyone in the club chrono has them in today (D040) — "Match
 *   chrono". Every entry's reference club is then their current club, so a
 *   drag shows as a move away from where they actually are.
 *
 * One `batch`, which D1 runs as a single transaction. It used to be four
 * separate steps (delete plan, delete entries, insert plan, insert entries),
 * and an interrupted run left a plan with no entries next to entries with no
 * plan. Entry rows find their plan by `year_month` (unique) rather than by a
 * `last_row_id` read between statements. Orphaned entries from any earlier
 * interrupted run are swept in the same transaction.
 */
async function rebuildPlan(
  env: Env,
  officer: Officer,
  yearMonth: number,
  baseline: PlanBaseline,
): Promise<void> {
  let rows: { friendViewerId: number; circleId: number | null }[];

  if (baseline === "chrono") {
    // Chrono's roster for the site's day (D034, D038), top club first and
    // ranked within each so the columns read like the leaderboard.
    const ymd = await latestDataYmd(env);
    const { results } = await env.DB.prepare(
      `SELECT r.friend_viewer_id, r.circle_id
         FROM club_roster r
         JOIN clubs c ON c.circle_id = r.circle_id AND c.is_active = 1
         LEFT JOIN member_day md ON md.friend_viewer_id = r.friend_viewer_id AND md.ymd = r.ymd
        WHERE r.ymd = ?
        ORDER BY c.slot_order, md.mtd_avg IS NULL, md.mtd_avg DESC`,
    )
      .bind(ymd)
      .all<{ friend_viewer_id: number; circle_id: number }>();
    if (results.length === 0) throw new Error(`no chrono roster stored for ${ymd}`);
    rows = results.map((r) => ({ friendViewerId: r.friend_viewer_id, circleId: r.circle_id }));
  } else {
    const { candidates, clubs, pins } = await loadPlacementInputs(env);
    rows = projectPromotion(candidates, clubs, pins).placements.map((p) => ({
      friendViewerId: p.friendViewerId,
      circleId: p.projectedCircleId,
    }));
  }

  const positions = new Map<number, number>();
  const planIdOf = "(SELECT id FROM roster_plans WHERE year_month = ?)";

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM roster_plan_entries
        WHERE plan_id IN ${planIdOf}
           OR plan_id NOT IN (SELECT id FROM roster_plans)`,
    ).bind(yearMonth),
    env.DB.prepare(
      `DELETE FROM roster_report_checks
        WHERE plan_id IN ${planIdOf}
           OR plan_id NOT IN (SELECT id FROM roster_plans)`,
    ).bind(yearMonth),
    env.DB.prepare("DELETE FROM roster_plans WHERE year_month = ?").bind(yearMonth),
    env.DB.prepare(
      `INSERT INTO roster_plans (year_month, status, baseline, created_by, created_at)
       VALUES (?, 'draft', ?, ?, ?)`,
    ).bind(yearMonth, baseline, officer.id, new Date().toISOString()),
    ...rows.map((row) => {
      const key = row.circleId ?? 0;
      const position = (positions.get(key) ?? 0) + 1;
      positions.set(key, position);

      return env.DB.prepare(
        `INSERT INTO roster_plan_entries
           (plan_id, friend_viewer_id, circle_id, position, source, projected_circle_id)
         VALUES (${planIdOf}, ?, ?, ?, 'projected', ?)`,
      ).bind(yearMonth, row.friendViewerId, row.circleId, position, row.circleId);
    }),
  ]);
}

// ------------------------------------------------------- change password ----

/**
 * Change your own password.
 *
 * Without this a bootstrap credential can never be rotated, which matters
 * because the first admin's password is necessarily created outside the app.
 *
 * Requires the current password even though the session already proves
 * identity: it stops someone who walks up to an unlocked machine from locking
 * the real officer out, and every other session is revoked on success.
 */
async function changePassword(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await readJson<{ current?: string; next?: string }>(request);
  if (!body?.current || !body?.next) {
    return json({ error: "current and next password required" }, 400);
  }
  if (body.next.length < 12) {
    return json({ error: "new password must be at least 12 characters" }, 400);
  }

  const row = await env.DB.prepare(
    "SELECT pw_hash, pw_salt, pw_iters FROM officers WHERE id = ?",
  )
    .bind(officer.id)
    .first<{ pw_hash: string; pw_salt: string; pw_iters: number }>();

  if (!row) return json({ error: "officer not found" }, 404);

  const check = await hashPassword(body.current, fromBase64(row.pw_salt), row.pw_iters);
  if (check.hash !== row.pw_hash) {
    return json({ error: "current password is wrong" }, 401);
  }

  // Rehashed at the current iteration count, so changing a password also
  // upgrades an account created under a weaker one.
  const { hash, salt, iterations } = await hashPassword(body.next);

  await env.DB.prepare(
    "UPDATE officers SET pw_hash = ?, pw_salt = ?, pw_iters = ? WHERE id = ?",
  )
    .bind(hash, salt, iterations, officer.id)
    .run();

  // Every session is dropped, including this one: if the old password leaked,
  // any session opened with it dies here.
  await env.DB.prepare("DELETE FROM sessions WHERE officer_id = ?").bind(officer.id).run();
  await audit(env, officer.id, "officer.password_changed", null);

  return json({ ok: true, signedOut: true });
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

// -------------------------------------------------------------- discord ----

/**
 * Map a member to their Discord handle.
 *
 * Entered by hand: nothing upstream carries it. GET returns every tracked
 * member so the officer can work down the list and see what is still missing,
 * rather than searching for names one at a time.
 */
async function discord(request: Request, env: Env, officer: Officer): Promise<Response> {
  if (request.method === "GET") {
    const ymd = await latestDataYmd(env);
    const { results } = await env.DB.prepare(
      `SELECT m.friend_viewer_id, m.name, md.circle_id, c.name AS club_name, c.slot_order,
              d.discord_username, d.note, d.set_at, o.display_name AS set_by_name
         FROM members m
         LEFT JOIN member_day md ON md.friend_viewer_id = m.friend_viewer_id AND md.ymd = ?
         LEFT JOIN clubs c ON c.circle_id = md.circle_id
         LEFT JOIN member_discord d ON d.friend_viewer_id = m.friend_viewer_id
         LEFT JOIN officers o ON o.id = d.set_by
        WHERE md.friend_viewer_id IS NOT NULL
        ORDER BY c.slot_order, m.name COLLATE NOCASE`,
    )
      .bind(ymd)
      .all();
    return json({ members: results });
  }

  if (request.method === "POST") {
    const body = await readJson<{
      friendViewerId?: number;
      discordUsername?: string;
      note?: string;
    }>(request);
    if (!body?.friendViewerId) return json({ error: "friendViewerId required" }, 400);

    const username = body.discordUsername?.trim() ?? "";

    // An empty handle clears the mapping rather than storing a blank row.
    if (!username) {
      await env.DB.prepare("DELETE FROM member_discord WHERE friend_viewer_id = ?")
        .bind(body.friendViewerId)
        .run();
      await audit(env, officer.id, "discord.clear", { friendViewerId: body.friendViewerId });
      return json({ ok: true, cleared: true });
    }

    if (username.length > 64) {
      return json({ error: "that does not look like a Discord username" }, 400);
    }

    await env.DB.prepare(
      `INSERT INTO member_discord (friend_viewer_id, discord_username, note, set_by, set_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (friend_viewer_id) DO UPDATE SET
         discord_username = excluded.discord_username,
         note             = excluded.note,
         set_by           = excluded.set_by,
         set_at           = excluded.set_at`,
    )
      .bind(
        body.friendViewerId,
        username,
        body.note?.trim() || null,
        officer.id,
        new Date().toISOString(),
      )
      .run();

    await audit(env, officer.id, "discord.set", { friendViewerId: body.friendViewerId, username });
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
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

    const username = body.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
      return json({ error: "username must be 2-32 characters: a-z 0-9 . _ -" }, 400);
    }

    const { hash, salt, iterations } = await hashPassword(body.password);

    try {
      await env.DB.prepare(
        `INSERT INTO officers (username, display_name, pw_hash, pw_salt, pw_iters, role, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          username,
          body.displayName?.trim() || username,
          hash,
          salt,
          iterations,
          body.role === "admin" ? "admin" : "officer",
          new Date().toISOString(),
          officer.id,
        )
        .run();
    } catch (error) {
      // Otherwise the unique index escapes as a generic 500 and the form says
      // "something went wrong" for a name that is merely taken.
      if (String(error).includes("UNIQUE")) {
        return json({ error: `username "${username}" is already taken` }, 409);
      }
      throw error;
    }

    await audit(env, officer.id, "officer.create", { username });
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

// ---------------------------------------------------------------- utils ----

/** An estimate from the client: null/absent clears it; undefined means invalid. */
function parseEstimate(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

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
