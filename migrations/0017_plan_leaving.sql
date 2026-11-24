-- Members an officer has marked as leaving their club this month (D042).
-- circle_id stays NULL for them, as for unplaced; this flag is what tells the
-- two apart: unplaced is "not decided", leaving is "decided — kick". Additive.

ALTER TABLE roster_plan_entries ADD COLUMN leaving INTEGER NOT NULL DEFAULT 0;
