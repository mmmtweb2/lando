-- 041: a business with no Google profile yet (task #12).
--   A customer may continue the setup while the Google profile is being created or verified.
--   profile_state = 'pending_verification' means "no place_id yet, the owner is working on it"; it is cleared
--   when the business is picked later. pending_name is the business name the owner typed (public business
--   name, max 80 characters). Only ADD COLUMN: nothing existing changes. Re-runnable.
ALTER TABLE seo_journey ADD COLUMN IF NOT EXISTS profile_state TEXT;
ALTER TABLE seo_journey ADD COLUMN IF NOT EXISTS pending_name TEXT;
ALTER TABLE seo_journey ADD COLUMN IF NOT EXISTS profile_pending_at TIMESTAMPTZ;
ALTER TABLE seo_journey DROP CONSTRAINT IF EXISTS seo_journey_profile_state_check;
ALTER TABLE seo_journey ADD CONSTRAINT seo_journey_profile_state_check CHECK (profile_state IS NULL OR profile_state = 'pending_verification');
ALTER TABLE seo_journey DROP CONSTRAINT IF EXISTS seo_journey_pending_name_check;
ALTER TABLE seo_journey ADD CONSTRAINT seo_journey_pending_name_check CHECK (pending_name IS NULL OR char_length(pending_name) <= 80);
