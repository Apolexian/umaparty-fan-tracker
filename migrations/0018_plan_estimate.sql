-- An officer's fans/day estimate for a plan member chrono has no data on yet
-- (D043) — someone added by trainer ID from outside our clubs. Used for
-- placement until the ingest supplies a real average. Never written to
-- member_day, whose only writer is the ingest (D030). Additive.

ALTER TABLE roster_plan_entries ADD COLUMN est_mtd_avg INTEGER;
