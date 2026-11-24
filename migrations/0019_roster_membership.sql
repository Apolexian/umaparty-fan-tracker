-- Chrono's club role per member per day (D044): 1 member, 2 officer, 3 leader,
-- from club_friend_profile.membership. Stored on the daily roster because a
-- role changes without the member moving, and club_stint only records it on
-- the day a stint starts. Additive.

ALTER TABLE club_roster ADD COLUMN membership INTEGER;

-- Existing rows: the open stint's role is the best we have until the next
-- ingest writes chrono's current answer.
UPDATE club_roster
   SET membership = (
     SELECT s.membership FROM club_stint s
      WHERE s.friend_viewer_id = club_roster.friend_viewer_id
        AND s.circle_id = club_roster.circle_id
        AND s.end_ymd IS NULL
      ORDER BY s.id DESC
      LIMIT 1
   );
