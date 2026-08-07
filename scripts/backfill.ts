// One-time historical import.
//
//   npm run backfill              # local D1
//   npm run backfill -- --remote  # production D1
//   npm run backfill -- --months 3
//
// Pulls every month chronogenesis still holds for every club and writes it
// through `wrangler d1 execute`. Roughly 70 requests at 1.5s apart, so a couple
// of minutes.
//
// Safe to re-run: every statement is an idempotent upsert, and it will never
// overwrite an observed non-zero gain with a zero (D017).
//
// Stop `wrangler dev` first — it holds a lock on the local D1 file and
// `d1 execute --local` will block behind it indefinitely.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChronoClient, REQUEST_GAP_MS, sleep } from "../src/worker/chrono.ts";
import { deriveMemberDays, toYmd } from "../src/worker/derive.ts";

interface ClubRow {
  circle_id: number;
  name: string;
}

// wrangler is invoked through its JS entry point rather than the `npx` or
// `wrangler.cmd` shims: on Windows, Node refuses to spawn a .cmd without a
// shell, and a shell mangles arguments containing spaces — which every
// --command here does. Going straight to the .js sidesteps both.
const WRANGLER = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");

// D1 rejects an oversized batch with SQLITE_TOOBIG. One club-month is ~1000
// statements, comfortably over the limit, so batches are chunked.
const CHUNK_SIZE = 200;

const args = process.argv.slice(2);
const REMOTE = args.includes("--remote");
const MONTH_LIMIT = Number(args[args.indexOf("--months") + 1]) || Infinity;
const target = REMOTE ? "--remote" : "--local";

function wrangler(args: string[], opts: { capture: boolean }): string {
  return execFileSync(process.execPath, [WRANGLER, ...args], {
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "inherit"],
  });
}

function executeSql(statements: string[]): void {
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const dir = mkdtempSync(join(tmpdir(), "umaparty-backfill-"));
    const file = join(dir, "batch.sql");
    writeFileSync(file, statements.slice(i, i + CHUNK_SIZE).join("\n"), "utf8");
    wrangler(["d1", "execute", "umaparty", target, "--yes", `--file=${file}`], {
      capture: false,
    });
  }
}

function query<T>(sql: string): T[] {
  const out = wrangler(["d1", "execute", "umaparty", target, "--json", `--command=${sql}`], {
    capture: true,
  });
  // wrangler prints a banner before the JSON on some versions.
  return JSON.parse(out.slice(out.indexOf("[")))[0].results as T[];
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "NULL" : String(value);
}

function str(value: string | null | undefined): string {
  return value === null || value === undefined ? "NULL" : `'${value.replaceAll("'", "''")}'`;
}

function readDevVar(key: string): string | undefined {
  try {
    for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
      const [k, ...rest] = line.split("=");
      if (k?.trim() === key) return rest.join("=").trim();
    }
  } catch {
    // no .dev.vars; caller falls back to the environment
  }
  return undefined;
}

async function main(): Promise<void> {
  const token = process.env.CHRONO_TOKEN ?? readDevVar("CHRONO_TOKEN");
  if (!token) {
    console.error("CHRONO_TOKEN not set. Put it in .dev.vars or export it before running.");
    process.exit(1);
  }

  console.log(`Backfilling ${REMOTE ? "REMOTE" : "local"} D1.\n`);

  const clubs = query<ClubRow>(
    "SELECT circle_id, name FROM clubs WHERE is_active = 1 ORDER BY slot_order",
  );
  if (clubs.length === 0) {
    console.error("No clubs found. Run the migrations first.");
    process.exit(1);
  }

  const client = new ChronoClient(token);
  let totalStatements = 0;
  let failures = 0;
  let requests = 0;

  for (const club of clubs) {
    // month_filter lists exactly which months chrono still holds for this club.
    if (requests++ > 0) await sleep(REQUEST_GAP_MS);
    const profile = await client.clubProfile(club.circle_id);
    const months = profile.month_filter.map((m) => m.sdate).slice(0, MONTH_LIMIT);

    console.log(`${club.name} (${club.circle_id}) — ${months.length} months`);

    for (const sdate of months) {
      await sleep(REQUEST_GAP_MS);
      const year = Number(sdate.slice(0, 4));
      const month = Number(sdate.slice(5, 7));

      try {
        const data = await client.clubMonth(club.circle_id, sdate);
        const statements = buildMonthStatements(club.circle_id, year, month, data);

        if (statements.length > 0) {
          executeSql(statements);
          totalStatements += statements.length;
        }
        console.log(`  ${sdate}  ${String(statements.length).padStart(5)} statements`);
      } catch (error) {
        failures++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ${sdate}  FAILED: ${message.split("\n")[0]}`);
      }
    }
  }

  // rank_overall spans clubs, so it can only be right once every club is in.
  console.log("\nRecomputing overall ranks across all clubs...");
  executeSql([
    `UPDATE member_day SET rank_overall = (
       SELECT COUNT(*) + 1 FROM member_day AS peer
        WHERE peer.ymd = member_day.ymd AND peer.mtd_avg > member_day.mtd_avg
     );`,
  ]);

  console.log(`\nDone. ${totalStatements} statements applied, ${failures} month(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

function buildMonthStatements(
  circleId: number,
  year: number,
  month: number,
  data: { club_daily_history: unknown[]; club_friend_history: unknown[] },
): string[] {
  const daily = data.club_daily_history as {
    actual_date: number;
    rank: number;
    rank_gain: number;
    interpolated_fan_count: number;
    interpolated_fan_gain: number;
  }[];
  const history = data.club_friend_history as {
    friend_viewer_id: number;
    friend_name: string;
    actual_date: number;
    interpolated_fan_count: number;
    adjusted_interpolated_fan_gain: number;
    adjusted_fan_gain_cumulative: number;
  }[];

  const statements: string[] = [];

  for (const day of daily) {
    statements.push(
      `INSERT INTO club_day (circle_id, ymd, rank, rank_gain, fan_count, fan_gain) VALUES (${circleId}, ${toYmd(year, month, day.actual_date)}, ${num(day.rank)}, ${num(day.rank_gain)}, ${num(day.interpolated_fan_count)}, ${num(day.interpolated_fan_gain)}) ON CONFLICT (circle_id, ymd) DO UPDATE SET rank = excluded.rank, rank_gain = excluded.rank_gain, fan_count = excluded.fan_count, fan_gain = excluded.fan_gain;`,
    );
  }

  // club_data_by_month carries no member profiles, so identities are seeded
  // from the names attached to the history rows; the daily ingest enriches them.
  const seen = new Map<number, string>();
  for (const row of history) {
    if (!seen.has(row.friend_viewer_id)) seen.set(row.friend_viewer_id, row.friend_name);
  }

  const monthStart = toYmd(year, month, 1);
  for (const [viewerId, name] of seen) {
    statements.push(
      `INSERT INTO members (friend_viewer_id, name, first_seen_ymd, last_seen_ymd) VALUES (${viewerId}, ${str(name)}, ${monthStart}, ${monthStart}) ON CONFLICT (friend_viewer_id) DO UPDATE SET first_seen_ymd = MIN(members.first_seen_ymd, excluded.first_seen_ymd);`,
    );
    statements.push(
      `INSERT INTO member_names (friend_viewer_id, name, first_seen_ymd) VALUES (${viewerId}, ${str(name)}, ${monthStart}) ON CONFLICT (friend_viewer_id, name) DO NOTHING;`,
    );
  }

  for (const row of deriveMemberDays(history, { year, month, circleId })) {
    statements.push(
      `INSERT INTO member_day (friend_viewer_id, ymd, circle_id, fan_count, fan_gain, fan_gain_observed, mtd_cumulative, days_active, mtd_avg, mtd_avg_delta, rank_in_club) VALUES (${row.friendViewerId}, ${row.ymd}, ${row.circleId}, ${num(row.fanCount)}, ${num(row.fanGain)}, ${num(row.fanGain)}, ${num(row.mtdCumulative)}, ${row.daysActive}, ${row.mtdAvg}, ${row.mtdAvgDelta}, ${row.rankInClub}) ON CONFLICT (friend_viewer_id, ymd) DO UPDATE SET fan_count = excluded.fan_count, fan_gain = excluded.fan_gain, fan_gain_observed = CASE WHEN COALESCE(member_day.fan_gain_observed, 0) > 0 THEN member_day.fan_gain_observed ELSE excluded.fan_gain_observed END, mtd_cumulative = excluded.mtd_cumulative, days_active = excluded.days_active, mtd_avg = excluded.mtd_avg, mtd_avg_delta = excluded.mtd_avg_delta, rank_in_club = excluded.rank_in_club;`,
    );
  }

  return statements;
}

await main();
