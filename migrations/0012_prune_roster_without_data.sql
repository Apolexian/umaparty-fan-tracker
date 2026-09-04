-- Drop roster rows for days we hold no data on.
--
-- `0011` reconstructed history by expanding each `club_stint` across every day
-- in its span. A stint that ran 3 August to 2 September therefore produced a
-- roster row for every one of those days — including days the member has no
-- `member_day` row for, because chrono's window had already dropped them or the
-- ingest never ran that day.
--
-- The leaderboard joins `member_day`, so those rows were invisible there, but
-- `tracked_members` counts `club_roster` directly and so read 32 for UmaPaThree
-- on 1 September, and 31 on six older days. A 30-slot club cannot hold 32.
--
-- Rows written by the ingest itself are unaffected: those come straight from
-- `circle_user_array` on a day we did pull data, so a matching `member_day`
-- row exists by construction.
DELETE FROM club_roster
 WHERE NOT EXISTS (
   SELECT 1 FROM member_day md
    WHERE md.friend_viewer_id = club_roster.friend_viewer_id
      AND md.ymd = club_roster.ymd
      AND md.circle_id = club_roster.circle_id
 );

-- Trim any remaining day that still exceeds the club's capacity.
--
-- A handful of early days sit at 31. Those predate all of this: on 7 August
-- chrono's own `circle_user_array` held 28 for カック・サドル while
-- `club_friend_history` still carried 31, the extra three being members who had
-- already left. An early ingest wrote `member_day` rows for all 31, so both the
-- fallback arm of `0011` and the prune above keep them.
--
-- Chrono's roster for those days is long gone, so the only recoverable
-- definition of "who was really in the club" is by rank: keep the club's
-- capacity worth of members by month-to-date average, which is the same order
-- the leaderboard shows, and drop the overflow.
DELETE FROM club_roster
 WHERE rowid IN (
   SELECT r.rowid
     FROM club_roster r
     JOIN clubs c ON c.circle_id = r.circle_id
     JOIN member_day md
       ON md.friend_viewer_id = r.friend_viewer_id
      AND md.ymd = r.ymd
      AND md.circle_id = r.circle_id
    WHERE (
      SELECT COUNT(*)
        FROM club_roster peer
        JOIN member_day pmd
          ON pmd.friend_viewer_id = peer.friend_viewer_id
         AND pmd.ymd = peer.ymd
         AND pmd.circle_id = peer.circle_id
       WHERE peer.circle_id = r.circle_id
         AND peer.ymd = r.ymd
         AND (pmd.mtd_avg > md.mtd_avg
              OR (pmd.mtd_avg = md.mtd_avg
                  AND peer.friend_viewer_id < r.friend_viewer_id))
    ) >= c.capacity
 );
