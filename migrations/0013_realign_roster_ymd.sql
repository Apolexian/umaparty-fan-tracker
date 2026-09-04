-- Move roster rows onto the day their member data actually landed on.
--
-- The roster was written under `ymd` — our wall clock — while `member_day` rows
-- are dated by chrono's `actual_date`. Those differ whenever the ingest runs
-- before chrono's 10:00 refresh: on 4 September the newest data chrono had was
-- the 3rd, so 172 roster rows landed on 20260904 and 172 member rows on
-- 20260903. Every club page joins the two, matched nothing, and rendered
-- "0 members". (D034)
--
-- Drop any roster day that has no member_day rows at all, then re-seed it from
-- the member rows for the newest day we hold. Safe to re-run: the insert
-- ignores conflicts, and a correctly-dated roster day is never touched because
-- it has matching member rows.
DELETE FROM club_roster
 WHERE ymd NOT IN (SELECT DISTINCT ymd FROM member_day);

INSERT OR IGNORE INTO club_roster (circle_id, ymd, friend_viewer_id)
SELECT md.circle_id, md.ymd, md.friend_viewer_id
  FROM member_day md
 WHERE md.ymd = (SELECT MAX(ymd) FROM member_day)
   AND NOT EXISTS (
     SELECT 1 FROM club_roster r
      WHERE r.ymd = md.ymd
        AND r.circle_id = md.circle_id
        AND r.friend_viewer_id = md.friend_viewer_id
   );
