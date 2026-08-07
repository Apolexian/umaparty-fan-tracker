-- Discord handles, entered by hand.
--
-- Nothing upstream carries them: chronogenesis knows the in-game account and
-- Discord knows the person, and only officers know which is which. Keyed on
-- friend_viewer_id like everything else (D004) so a rename on either side
-- leaves the mapping intact.
--
-- One row per member, not per handle: a member has one Discord account, and
-- keeping it in `members` would mean the daily ingest had to preserve a column
-- it knows nothing about.
CREATE TABLE member_discord (
  friend_viewer_id INTEGER PRIMARY KEY,
  discord_username TEXT    NOT NULL,
  note             TEXT,
  set_by           INTEGER NOT NULL,
  set_at           TEXT    NOT NULL
);

CREATE INDEX idx_member_discord_name ON member_discord (discord_username);
