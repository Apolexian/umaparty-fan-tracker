-- Delete rows stamped with a date the month does not have.
--
-- `club_profile` covers a rolling window, so on the 1st-3rd it still carries
-- the previous month's tail. Those rows were stamped with the *current* month,
-- producing 20260931 (September has 30 days) for what is really 31 August.
-- The site reads its "data as of" from MAX(ymd), so a single such row made
-- every page claim to be a month stale. (D032)
--
-- Only impossible dates are removed. The real 31 August rows are already
-- stored correctly under 20260831 by the month-rollover pass, so nothing is
-- lost here.
DELETE FROM member_day
 WHERE ymd % 100 > CAST(
   strftime('%d', date(
     substr(CAST(ymd AS TEXT), 1, 4) || '-' || substr(CAST(ymd AS TEXT), 5, 2) || '-01',
     '+1 month', '-1 day'
   )) AS INTEGER
 );

DELETE FROM club_day
 WHERE ymd % 100 > CAST(
   strftime('%d', date(
     substr(CAST(ymd AS TEXT), 1, 4) || '-' || substr(CAST(ymd AS TEXT), 5, 2) || '-01',
     '+1 month', '-1 day'
   )) AS INTEGER
 );
