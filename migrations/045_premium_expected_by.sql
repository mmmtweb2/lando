-- 045: expected date of the manual card update (guided setup, premium "בטיפול אצלנו").
--
-- For a manual-premium customer the owner fills in the Google card himself. This column holds the
-- date by which he expects to finish, so the customer sees "בטיפול אצלנו, צפוי עד ..." in the
-- guided setup and only has to approve. Tracking/display only: nothing is sent anywhere.
-- Re-runnable. No new table, so no RLS change (seo_manual_premium already has RLS ENABLE + FORCE).

ALTER TABLE seo_manual_premium ADD COLUMN IF NOT EXISTS expected_by DATE;
