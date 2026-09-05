// Re-derive one month's member_day rows with the stint-aware metric (D035).
//
//   npm run repair:month -- --month 2026-09              # local D1
//   npm run repair:month -- --month 2026-09 --remote     # production D1
//   npm run repair:month -- --month 2026-09 --dry-run    # print, change nothing
//
// Why this exists rather than `npm run backfill`: backfill derives without
// stint data, so it falls back to the leading-zeros heuristic (D026). For a
// mover chrono did NOT wipe there are no leading zeros — the heuristic returns
// day 1 and reproduces exactly the bug being repaired. This reads the real
// stint starts out of club_stint and passes them in.
//
// Safe to re-run. Reads chrono, rewrites the month, recomputes both ranks.
//
// Stop `wrangler dev` first — it locks the local D1 file.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChronoClient, REQUEST_GAP_MS, sleep } from "../src/worker/chrono.ts";
import {
  deriveMemberDays,
  firstCountedDay,
  preStintCarryover,
  toYmd,
} from "../src/worker/derive.ts";
import type { ClubFriendHistoryOut } from "../src/worker/types.ts";

const WRANGLER = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const CHUNK_BYTES = 40_000;

const args = process.argv.slice(2);
const REMOTE = args.includes("--remote");
const DRY_RUN = args.includes("--dry-run");
const target = REMOTE ? "--remote" : "--local";

const monthArg = args[args.indexOf("--month") + 1];
if (!monthArg || !/^\d{4}-\d{2}$/.test(monthArg)) {
  console.error("Pass --month YYYY-MM, e.g. --month 2026-09");
  process.exit(1);
}
const YEAR = Number(monthArg.slice(0, 4));
const MONTH = Number(monthArg.slice(5, 7));

function wrangler(argv: string[], opts: { capture: boolean }): string {
  return execFileSync(process.execPath, [WRANGLER, ...argv], {
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : ["ignore", "ignore", "inherit"],
  });
}

function executeSql(statements: string[]): void {
  if (DRY_RUN) {
    console.log(`  [dry-run] ${statements.length} statements withheld`);
    return;
  }
  let batch: string[] = [];
  let bytes = 0;

  const flush = () => {
    if (batch.length === 0) return;
    const dir = mkdtempSync(join(tmpdir(), "umaparty-repair-"));
    const file = join(dir, "batch.sql");
    writeFileSync(file, batch.join("\n"), "utf8");
    wrangler(["d1", "execute", "umaparty", target, "--yes", `--file=${file}`], {
      capture: false,
    });
    batch = [];
    bytes = 0;
  };

  for (const statement of statements) {
    if (bytes > 0 && bytes + statement.length > CHUNK_BYTES) flush();
    batch.push(statement);
    bytes += statement.length + 1;
  }
  flush();
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

/**
 * Stint start day-of-month per member for this club and month.
 *
 * Mirrors `currentStintStarts` in the worker: a stint that opened before this
 * month means the member was here from the 1st.
 */
function stintStartsFor(circleId: number): Map<number, number> {
  const monthStart = toYmd(YEAR, MONTH, 1);
  const monthEnd = toYmd(YEAR, MONTH, 31);
  const rows = query<{ friend_viewer_id: number; start_ymd: number }>(
    `SELECT friend_viewer_id, MIN(start_ymd) AS start_ymd FROM club_stint
      WHERE circle_id = ${circleId} AND end_ymd IS NULL AND start_ymd <= ${monthEnd}
      GROUP BY friend_viewer_id`,
  );
  return new Map(
    rows.map((r) => [r.friend_viewer_id, r.start_ymd < monthStart ? 1 : r.start_ymd % 100]),
  );
}

async function main(): Promise<void> {
  const token = process.env.CHRONO_TOKEN ?? readDevVar("CHRONO_TOKEN");
  if (!token) {
    console.error("CHRONO_TOKEN not set. Put it in .dev.vars or export it before running.");
    process.exit(1);
  }

  console.log(
    `Repairing ${monthArg} on ${REMOTE ? "REMOTE" : "local"} D1${DRY_RUN ? " (dry run)" : ""}.\n`,
  );

  const clubs = query<{ circle_id: number; name: string }>(
    "SELECT circle_id, name FROM clubs WHERE is_active = 1 ORDER BY slot_order",
  );
  if (clubs.length === 0) {
    console.error("No clubs found. Run the migrations first.");
    process.exit(1);
  }

  const client = new ChronoClient(token);
  const sdate = `${YEAR}-${String(MONTH).padStart(2, "0")}-01`;
  let totalStatements = 0;
  let totalCarryover = 0;
  let failures = 0;
  let requests = 0;

  for (const club of clubs) {
    if (requests++ > 0) await sleep(REQUEST_GAP_MS);

    try {
      const data = await client.clubMonth(club.circle_id, sdate);
      const history = data.club_friend_history as ClubFriendHistoryOut[];
      const stintStarts = stintStartsFor(club.circle_id);

      const carryover = preStintCarryover(history, { year: YEAR, month: MONTH, stintStarts });
      totalCarryover += carryover;

      const statements: string[] = [];

      // Pre-stint days belong to the club the member left, and the join day is
      // split between both. Chrono purges the former and derive skips both, so
      // nothing else will ever clear them. (D035, D036)
      for (const [viewerId, startDay] of stintStarts) {
        const counted = firstCountedDay(startDay);
        if (counted <= 1) continue;
        statements.push(
          `DELETE FROM member_day WHERE friend_viewer_id = ${viewerId} AND circle_id = ${club.circle_id} AND ymd >= ${toYmd(YEAR, MONTH, 1)} AND ymd < ${toYmd(YEAR, MONTH, counted)};`,
        );
      }

      for (const row of deriveMemberDays(history, {
        year: YEAR,
        month: MONTH,
        circleId: club.circle_id,
        stintStarts,
      })) {
        statements.push(
          `INSERT INTO member_day (friend_viewer_id, ymd, circle_id, fan_count, fan_gain, fan_gain_observed, mtd_cumulative, days_active, mtd_avg, mtd_avg_delta, rank_in_club) VALUES (${row.friendViewerId}, ${row.ymd}, ${row.circleId}, ${num(row.fanCount)}, ${num(row.fanGain)}, ${num(row.fanGain)}, ${num(row.mtdCumulative)}, ${row.daysActive}, ${row.mtdAvg}, ${row.mtdAvgDelta}, ${row.rankInClub}) ON CONFLICT (friend_viewer_id, ymd) DO UPDATE SET circle_id = excluded.circle_id, fan_count = excluded.fan_count, fan_gain = excluded.fan_gain, fan_gain_observed = CASE WHEN COALESCE(member_day.fan_gain_observed, 0) > 0 THEN member_day.fan_gain_observed ELSE excluded.fan_gain_observed END, mtd_cumulative = excluded.mtd_cumulative, days_active = excluded.days_active, mtd_avg = excluded.mtd_avg, mtd_avg_delta = excluded.mtd_avg_delta, rank_in_club = excluded.rank_in_club;`,
        );
      }

      if (statements.length > 0) executeSql(statements);
      totalStatements += statements.length;
      console.log(
        `  ${club.name.padEnd(14)} ${String(statements.length).padStart(5)} statements, ${carryover} un-wiped mover(s)`,
      );
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${club.name}  FAILED: ${message.split("\n")[0]}`);
    }
  }

  // rank_overall spans clubs, so it is only right once every club is in.
  console.log("\nRecomputing overall ranks...");
  executeSql([
    `UPDATE member_day SET rank_overall = (
       SELECT COUNT(*) + 1 FROM member_day AS peer
        WHERE peer.ymd = member_day.ymd AND peer.mtd_avg > member_day.mtd_avg
     ) WHERE ymd >= ${toYmd(YEAR, MONTH, 1)} AND ymd <= ${toYmd(YEAR, MONTH, 31)};`,
  ]);

  console.log(
    `\nDone. ${totalStatements} statements, ${totalCarryover} un-wiped mover(s), ${failures} club(s) failed.`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
