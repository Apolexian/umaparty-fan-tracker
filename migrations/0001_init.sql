-- UmaParty Fan Tracker — initial schema
--
-- Dates are stored as INTEGER YYYYMMDD ("ymd"). The chronogenesis API returns
-- `actual_date` as a bare day-of-month (1..31), which is resolved against the
-- month context once at ingest so nothing downstream has to think about it.

-- ---------------------------------------------------------------- clubs ----

-- Officers add, remove, reorder and resize clubs at runtime, so this table is
-- the source of truth for which clubs exist — the ingest iterates it rather
-- than any hardcoded list. The rows below are only a starting point. (D020)
CREATE TABLE clubs (
  circle_id            INTEGER PRIMARY KEY,
  name                 TEXT    NOT NULL,
  slot_order           INTEGER NOT NULL,  -- 1 = top club; officer-editable
  capacity             INTEGER NOT NULL DEFAULT 30,
  in_pool              INTEGER NOT NULL DEFAULT 1,  -- 0 = tracked, not reshuffled
  added_by             INTEGER,           -- officer who added it, NULL for seed
  added_at             TEXT,
  comment              TEXT,
  member_num           INTEGER,
  policy               INTEGER,
  join_style           INTEGER,
  leader_viewer_id_api INTEGER,           -- chrono's idea of the leader; may lag
  make_time            TEXT,
  rank                 INTEGER,
  rank_diff            INTEGER,
  fan_count            INTEGER,
  daily_average        INTEGER,           -- chrono's own field; NOT our metric
  monthly_average      INTEGER,
  is_active            INTEGER NOT NULL DEFAULT 1,
  updated_at           TEXT
);

CREATE TABLE club_day (
  circle_id  INTEGER NOT NULL,
  ymd        INTEGER NOT NULL,
  rank       INTEGER,
  rank_gain  INTEGER,
  fan_count  INTEGER,
  fan_gain   INTEGER,
  PRIMARY KEY (circle_id, ymd)
);

CREATE TABLE club_month (
  circle_id        INTEGER NOT NULL,
  year_month       INTEGER NOT NULL,  -- YYYYMM
  rank             INTEGER,
  rank_gain        INTEGER,
  fan_count        INTEGER,
  monthly_fan_gain INTEGER,
  PRIMARY KEY (circle_id, year_month)
);

-- -------------------------------------------------------------- members ----

CREATE TABLE members (
  friend_viewer_id      INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  leader_chara_id       INTEGER,
  leader_chara_dress_id INTEGER,
  honor_id              INTEGER,
  support_card_id       INTEGER,
  team_evaluation_point INTEGER,
  fan_count             INTEGER,
  last_login_time       TEXT,
  first_seen_ymd        INTEGER,
  last_seen_ymd         INTEGER,
  updated_at            TEXT
);

-- Players rename, and the sheet lost people to it. Identity is the viewer id;
-- every name we have ever seen stays searchable.
CREATE TABLE member_names (
  friend_viewer_id INTEGER NOT NULL,
  name             TEXT    NOT NULL,
  first_seen_ymd   INTEGER NOT NULL,
  PRIMARY KEY (friend_viewer_id, name)
);

-- Keyed on (viewer_id, ymd) and NOT on circle_id: when a member moves club,
-- chrono re-attributes their whole month to the new club, so a club-keyed
-- table would grow duplicate rows for the same day.
CREATE TABLE member_day (
  friend_viewer_id  INTEGER NOT NULL,
  ymd               INTEGER NOT NULL,
  circle_id         INTEGER NOT NULL,  -- club they were observed in that day
  fan_count         INTEGER,
  fan_gain          INTEGER,           -- official; a move can reset this to 0
  fan_gain_observed INTEGER,           -- first non-zero we saw; never overwritten
  mtd_cumulative    INTEGER,
  days_active       INTEGER,           -- days in THIS club this month
  mtd_avg           INTEGER,           -- mtd_cumulative / days_active
  mtd_avg_delta     INTEGER,           -- vs previous day
  rank_in_club      INTEGER,
  rank_overall      INTEGER,
  PRIMARY KEY (friend_viewer_id, ymd)
);

-- The movement history chronogenesis does not keep. Verified: a member who
-- moves is purged from their old club's records entirely, so unless we write
-- this down daily the monthly reshuffle leaves no trace anywhere.
CREATE TABLE club_stint (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  friend_viewer_id INTEGER NOT NULL,
  circle_id        INTEGER NOT NULL,
  join_time        TEXT,
  start_ymd        INTEGER NOT NULL,
  end_ymd          INTEGER,            -- NULL = currently in this club
  membership       INTEGER
);

CREATE TABLE ingest_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT    NOT NULL,
  circle_id    INTEGER,
  kind         TEXT    NOT NULL,       -- 'daily' | 'month' | 'backfill'
  status       TEXT    NOT NULL,       -- 'ok' | 'error'
  http_status  INTEGER,
  rows_written INTEGER,
  error        TEXT
);

-- --------------------------------------------------------- officer admin ----

CREATE TABLE officers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  pw_hash       TEXT    NOT NULL,      -- PBKDF2-SHA256, base64
  pw_salt       TEXT    NOT NULL,      -- base64
  pw_iters      INTEGER NOT NULL,      -- per-row so it can be raised later
  role          TEXT    NOT NULL DEFAULT 'officer',  -- 'admin' | 'officer'
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  created_by    INTEGER,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,         -- SHA-256 of the cookie value
  officer_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

-- Members held in a club through the reshuffle regardless of rank.
--
-- 'leader' pins are the club leaders; 'manual' pins are anyone else officers
-- choose to hold in place — someone who asked to stay put, an alt account, a
-- member mid-negotiation. Both consume a slot and displace by rank, so they
-- share one table rather than special-casing leaders. (D006, D021)
--
-- Kept as history (unset_at) so a past month's projection stays reproducible.
CREATE TABLE member_pins (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id        INTEGER NOT NULL,
  friend_viewer_id INTEGER NOT NULL,
  kind             TEXT    NOT NULL DEFAULT 'manual',  -- 'leader' | 'manual'
  reason           TEXT,
  set_by           INTEGER NOT NULL,
  set_at           TEXT    NOT NULL,
  unset_at         TEXT
);

-- The reshuffle plan officers actually execute.
--
-- Seeded from the projection, then hand-edited by drag and drop: the algorithm
-- proposes, officers dispose. Overrides are persisted per member so a plan
-- survives the nightly re-projection, and `source` records whether a placement
-- came from the algorithm or from a human. (D022)
CREATE TABLE roster_plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  year_month   INTEGER NOT NULL,          -- YYYYMM the plan is for
  status       TEXT    NOT NULL DEFAULT 'draft',  -- 'draft' | 'final'
  note         TEXT,
  created_by   INTEGER NOT NULL,
  created_at   TEXT    NOT NULL,
  finalised_by INTEGER,
  finalised_at TEXT,
  UNIQUE (year_month)
);

CREATE TABLE roster_plan_entries (
  plan_id          INTEGER NOT NULL,
  friend_viewer_id INTEGER NOT NULL,
  circle_id        INTEGER,              -- NULL = waitlisted / unplaced
  position         INTEGER NOT NULL DEFAULT 0,   -- order within the club
  source           TEXT    NOT NULL DEFAULT 'projected',  -- 'projected' | 'manual'
  /** Where the algorithm put them, kept so the UI can show what was changed. */
  projected_circle_id INTEGER,
  moved_by         INTEGER,
  moved_at         TEXT,
  PRIMARY KEY (plan_id, friend_viewer_id)
);

CREATE TABLE notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  body       TEXT    NOT NULL,
  author_id  INTEGER NOT NULL,
  circle_id  INTEGER,                  -- NULL = applies to all clubs
  created_at TEXT    NOT NULL,
  done_at    TEXT,                     -- non-NULL = archived, never deleted
  done_by    INTEGER
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  officer_id  INTEGER,
  action      TEXT NOT NULL,
  detail_json TEXT,
  at          TEXT NOT NULL
);

CREATE TABLE login_attempts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  key      TEXT    NOT NULL,           -- ip|username
  at       TEXT    NOT NULL,
  ok       INTEGER NOT NULL
);

-- -------------------------------------------------------------- indexes ----

CREATE INDEX idx_member_day_rank    ON member_day (ymd, mtd_avg DESC);
CREATE INDEX idx_member_day_member  ON member_day (friend_viewer_id, ymd);
CREATE INDEX idx_member_day_club    ON member_day (circle_id, ymd);
CREATE INDEX idx_members_name       ON members (name);
CREATE INDEX idx_member_names_name  ON member_names (name);
CREATE INDEX idx_stint_member       ON club_stint (friend_viewer_id, start_ymd);
CREATE INDEX idx_stint_open         ON club_stint (circle_id, end_ymd);
CREATE INDEX idx_notices_open       ON notices (done_at, created_at);
CREATE INDEX idx_plan_entries_club  ON roster_plan_entries (plan_id, circle_id, position);
CREATE INDEX idx_sessions_expiry    ON sessions (expires_at);
CREATE INDEX idx_ingest_recent      ON ingest_runs (circle_id, started_at);
CREATE INDEX idx_pins_current       ON member_pins (unset_at, circle_id);
CREATE INDEX idx_pins_member        ON member_pins (friend_viewer_id, unset_at);
CREATE INDEX idx_clubs_pool         ON clubs (in_pool, slot_order);
CREATE INDEX idx_login_attempts     ON login_attempts (key, at);

-- ------------------------------------------------------------- club seed ----
-- Starting order, left-to-right as in the tracking sheet. Officers can
-- reorder, resize, add and remove clubs from the admin area; nothing else in
-- the codebase hardcodes this list.
--
-- カック・サドル's position is explicitly NOT settled. Its members span overall
-- ranks 3-147 with no banding, while the other four band cleanly (medians
-- 22/50/86/116), which is what a fans-sorted reshuffle produces. Its club rank
-- (1016) also beats UmaFourty's (1385) despite sitting below it. It is seeded
-- in the pool at slot 5 pending a decision. (D020)

INSERT INTO clubs (circle_id, name, slot_order, capacity, in_pool, is_active) VALUES
  (665160774, 'UmaParty',      1, 30, 1, 1),
  (720848953, 'TwomaParty',    2, 30, 1, 1),
  (928261417, 'UmaPaThree',    3, 30, 1, 1),
  (201002484, 'UmaFourty',     4, 30, 1, 1),
  (877539742, 'カック・サドル', 5, 30, 1, 1);
