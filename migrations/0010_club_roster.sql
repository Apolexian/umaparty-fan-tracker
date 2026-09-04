-- Chrono's own roster, stored rather than inferred.
--
-- `club_profile` returns `circle_user_array`: exactly who is in the club right
-- now, consistent with `member_num` and with nobody in two clubs at once. We
-- were using it to gate one loop at ingest and then discarding it, and deriving
-- "who is in this club" from `member_day.circle_id` instead.
--
-- That derivation is wrong the moment somebody leaves. Rows written on earlier
-- days keep the old `circle_id` and nothing revisits them, so a club that has
-- lost four members still lists 33 on the day they left — more than the game
-- allows. Every query then needed a `club_stint` correction bolted on to
-- undo the bad inference. (D034)
--
-- One row per club per day. `ymd` is the observation day, so the roster can be
-- read back for any past day rather than only for today.
CREATE TABLE club_roster (
  circle_id        INTEGER NOT NULL,
  ymd              INTEGER NOT NULL,
  friend_viewer_id INTEGER NOT NULL,
  PRIMARY KEY (circle_id, ymd, friend_viewer_id)
);

CREATE INDEX idx_club_roster_day    ON club_roster (ymd, circle_id);
CREATE INDEX idx_club_roster_member ON club_roster (friend_viewer_id, ymd);
