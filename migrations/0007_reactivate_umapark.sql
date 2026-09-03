-- Put UmaPark back in the ingest: chrono now serves it.
--
-- 0005 deactivated circle 548045752 because every call returned 403. That was
-- chrono not having the club on our token, not a bad key (D031). It has since
-- been added, and both /club_profile and /club_data_by_month answer 200.
--
-- 0005 is left in place rather than edited: it had already been pushed, and
-- rewriting an applied migration desyncs any database that ran it. (D031)
UPDATE clubs SET is_active = 1 WHERE circle_id = 548045752;

-- Chrono reports a different lead than the one seeded in 0004. The ingest
-- overwrites `leader_viewer_id_api` from club_profile on every run anyway, so
-- this only avoids one run's worth of a stale value.
UPDATE clubs SET leader_viewer_id_api = 903460475258 WHERE circle_id = 548045752;
