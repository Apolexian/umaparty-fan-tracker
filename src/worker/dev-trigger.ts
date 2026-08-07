// Dev-only ingest trigger.
//
// `wrangler dev --test-scheduled` exposes /__scheduled, but it does not report
// what the run actually did. This route runs the same code path and returns a
// summary, which is what makes a local ingest verifiable.
//
// Guarded on ENVIRONMENT so it cannot be reached in production.

import { ingestAll, latestDataYmd, recomputeOverallRanks, ymdOf } from "./ingest.ts";
import type { Env } from "./types.ts";

export async function handleDevTrigger(env: Env): Promise<Response> {
  if (env.ENVIRONMENT === "production") {
    return new Response("not found", { status: 404 });
  }

  const now = new Date();
  const started = Date.now();
  const summaries = await ingestAll(env, now);
  const dataYmd = await latestDataYmd(env);
  await recomputeOverallRanks(env, dataYmd);

  const counts = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM member_day"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM members"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM member_names"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM club_stint"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM club_day"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM club_month"),
  ]);

  return Response.json({
    ymd: ymdOf(now),
    dataYmd,
    elapsedMs: Date.now() - started,
    summaries,
    rowCounts: {
      member_day: (counts[0]!.results[0] as { n: number }).n,
      members: (counts[1]!.results[0] as { n: number }).n,
      member_names: (counts[2]!.results[0] as { n: number }).n,
      club_stint: (counts[3]!.results[0] as { n: number }).n,
      club_day: (counts[4]!.results[0] as { n: number }).n,
      club_month: (counts[5]!.results[0] as { n: number }).n,
    },
  });
}
