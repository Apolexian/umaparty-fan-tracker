-- Seed club_roster for the days already stored.
--
-- The table is written by the ingest from chrono's `circle_user_array`, so it
-- only covers days from the next run onward. Every historical day would join to
-- nothing and render an empty club, so past days are reconstructed from
-- `club_stint`, which is our own record of who was in a club and when (D010).
--
-- A member belongs to a club on a day when their stint had started by then and
-- had not yet ended. `end_ymd` is the day they were last seen there, so a stint
-- ending on the 2nd does not include the 2nd — that is exactly the four members
-- who made カック・サドル show 33.
INSERT OR IGNORE INTO club_roster (circle_id, ymd, friend_viewer_id)
SELECT s.circle_id, d.ymd, s.friend_viewer_id
  FROM club_stint s
  JOIN (SELECT DISTINCT ymd FROM member_day) d
    ON d.ymd >= s.start_ymd
   AND (s.end_ymd IS NULL OR d.ymd < s.end_ymd);

-- Any member_day row with no stint covering it still needs a roster entry, or
-- the day it belongs to loses that member entirely. Falls back to the club the
-- row itself names, which is correct for everyone who never moved.
--
-- The second condition is the one that matters: a member whose stint here has
-- *ended* must not be re-added by this fallback. Without it the four who left
-- カック・サドル on the 2nd came straight back and the club still read 33 —
-- arm one correctly excluded them, and this arm undid that.
INSERT OR IGNORE INTO club_roster (circle_id, ymd, friend_viewer_id)
SELECT md.circle_id, md.ymd, md.friend_viewer_id
  FROM member_day md
 WHERE NOT EXISTS (
   SELECT 1 FROM club_stint s
    WHERE s.friend_viewer_id = md.friend_viewer_id
      AND s.start_ymd <= md.ymd
      AND (s.end_ymd IS NULL OR s.end_ymd > md.ymd)
 )
   AND NOT EXISTS (
   SELECT 1 FROM club_stint s
    WHERE s.friend_viewer_id = md.friend_viewer_id
      AND s.circle_id = md.circle_id
      AND s.end_ymd IS NOT NULL
      AND s.end_ymd <= md.ymd
 );
