-- 050: full sync with the customer's Google Business Profile (docs/gbp-sync-spec.md).
--
--   business_truth.google_state   what Google showed at the last read: the parsed listing, which
--                                 fields Google is still reviewing (pendingMask), which differ from
--                                 what the owner set (diffMask), the last error per field, when read.
--   seo_automation.website_mode   what happens to the listing's website when the business's own
--                                 landing page is published: 'auto' (set it when Google has none),
--                                 'ask' (only suggest), 'off'.
--
-- Security: no new tables; both tables already have RLS ENABLE + FORCE with zero policies (048).
-- Re-runnable. No deletes.

ALTER TABLE business_truth ADD COLUMN IF NOT EXISTS google_state JSONB;

ALTER TABLE seo_automation ADD COLUMN IF NOT EXISTS website_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE seo_automation DROP CONSTRAINT IF EXISTS seo_automation_website_mode_check;
ALTER TABLE seo_automation ADD CONSTRAINT seo_automation_website_mode_check CHECK (website_mode IN ('auto', 'ask', 'off'));
