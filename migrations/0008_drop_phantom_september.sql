-- Delete the phantom 4-30 September rows: August's month, written twice.
--
-- On the 1st, chrono lands the member tables at 10 UTC but the club tables not
-- until 15 UTC, so the 10:15 run still saw August's member history.
-- `ingestClubProfile` stamps rows with *today's* year and month, so the whole
-- of August was written a second time as September. The 10:15 runs wrote
-- ~1,050-1,095 rows per club where a normal daily run writes ~180. (D033)
--
-- Verified before deleting: every day from the 4th to the 30th holds rows whose
-- `fan_count` matches the same member's August row exactly (e.g. 20260930 and
-- 20260830 both 1,830,883,003 for viewer 700494191843). The four rows with no
-- August twin are members who joined mid-August, carry mtd_avg = 0, and are
-- equally phantom.
--
-- The 1st to the 3rd are genuine and are left alone: their row counts vary
-- (167/179/133) the way real ingest days do, rather than tracking August's.
--
-- Day 31 was already removed by 0006 for being a date September does not have.
-- This is the same incident, on the days that happen to exist in both months.
DELETE FROM member_day WHERE ymd BETWEEN 20260904 AND 20260930;

DELETE FROM club_day WHERE ymd BETWEEN 20260904 AND 20260930;
