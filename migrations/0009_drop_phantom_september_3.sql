-- The 3rd of September was phantom too; 0008 started one day too late.
--
-- Same incident as D033: the 10:15 run on the 1st, and again on the 3rd, saw
-- August's member history and wrote it under September. 0008 deleted the 4th
-- to the 30th, having verified those against August, but stopped short of the
-- 3rd because the 1st-3rd looked genuine on row counts alone (167/179/133).
--
-- The 3rd is not genuine. All 133 of its rows carry a `fan_count` identical to
-- the same member's 3 August row — including the pre-reshuffle `circle_id`,
-- which is why members showed in the wrong clubs. Viewer 700494191843 holds
-- 1,347,269,148 on both 20260803 and 20260903, and that is *lower* than its own
-- 20260902 value of 1,888,717,185: fan counts only ever rise, so the row is
-- incoherent as September data.
--
-- The 1st and 2nd are genuine and stay: only 9 and 7 of their rows coincide
-- with August, which is ordinary noise rather than a copied month. Chrono also
-- still serves exactly days 1 and 2 for every club, matching what we hold.
DELETE FROM member_day WHERE ymd = 20260903;

DELETE FROM club_day WHERE ymd = 20260903;
