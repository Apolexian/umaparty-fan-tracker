-- Ticks on the kick/invite checklist (D041). One row per ticked line; unticking
-- deletes it. Keyed by club and kind because a member who moves A -> B has two
-- lines, a kick in A and an invite in B, done by different officers.

CREATE TABLE roster_report_checks (
  plan_id          INTEGER NOT NULL,
  friend_viewer_id INTEGER NOT NULL,
  circle_id        INTEGER NOT NULL,
  kind             TEXT    NOT NULL,  -- 'kick' | 'invite'
  checked_by       INTEGER NOT NULL,
  checked_at       TEXT    NOT NULL,
  PRIMARY KEY (plan_id, friend_viewer_id, circle_id, kind)
);
