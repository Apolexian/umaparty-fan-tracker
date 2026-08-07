import { handleAdmin } from "./admin.ts";
import { handleApi } from "./api.ts";
import { handleDevTrigger } from "./dev-trigger.ts";
import { ingestAll, latestDataYmd, recomputeOverallRanks } from "./ingest.ts";
import type { Env } from "./types.ts";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Under /api/ so the assets binding's run_worker_first rule catches it;
    // anything outside /api/ is served as a static asset first.
    if (url.pathname === "/api/__ingest") {
      return handleDevTrigger(env);
    }

    // Officer routes are checked before the public ones: they mutate, require
    // a session, and must never be served from the edge cache.
    if (url.pathname.startsWith("/api/admin")) {
      return handleAdmin(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, ctx);
    }

    // Anything else is served from the static assets binding, which is
    // configured with single-page-application fallback for client routing.
    return env.ASSETS
      ? env.ASSETS.fetch(request)
      : new Response("Not found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runIngest(env, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;

async function runIngest(env: Env, now: Date): Promise<void> {
  const summaries = await ingestAll(env, now);

  // Overall ranks span clubs, so they can only be computed once every club for
  // the day has landed. Ranked against the newest day we actually hold, not
  // today's date — chrono publishes a day in arrears.
  await recomputeOverallRanks(env, await latestDataYmd(env));

  const failed = summaries.filter((s) => s.status === "error");
  if (failed.length > 0) {
    console.error(
      `ingest: ${failed.length}/${summaries.length} clubs failed`,
      failed.map((f) => `${f.circleId}: ${f.error}`).join("; "),
    );
  } else {
    console.log(`ingest: ${summaries.length} clubs ok`);
  }
}
