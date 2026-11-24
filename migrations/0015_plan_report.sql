-- The kick/invite report generated when a plan is finalised (D041). Stored as
-- JSON so it stays the instruction list officers were given, even as chrono's
-- roster moves on underneath it. Additive.

ALTER TABLE roster_plans ADD COLUMN report_json TEXT;
