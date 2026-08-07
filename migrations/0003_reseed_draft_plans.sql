-- Drop draft roster plans so they reseed from the corrected projection.
--
-- Plans seeded before D027 were built when the projection knew about no club
-- leaders at all, so every lead was placed by rank -- the UmaParty lead sat in
-- TwomaParty. A plan is stored once and then kept across re-projection (D022),
-- so the bad placement would have survived until someone pressed Reset.
--
-- Draft only. Finalised plans are the record of what was actually done in a
-- past month and must not be rewritten to match a projection made later.
--
-- Hand edits made to a draft this month go with it; there is no way to tell an
-- officer's deliberate move from a placement the old projection got wrong.
DELETE FROM roster_plan_entries
 WHERE plan_id IN (SELECT id FROM roster_plans WHERE status = 'draft');

DELETE FROM roster_plans WHERE status = 'draft';
