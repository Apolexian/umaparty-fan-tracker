-- What a roster plan was built from (D040): 'projection' — the algorithm's
-- proposal, as every plan was until now — or 'chrono', each member's current
-- club as chrono reports it. Additive, so safe to run before the deploy.

ALTER TABLE roster_plans ADD COLUMN baseline TEXT NOT NULL DEFAULT 'projection';
