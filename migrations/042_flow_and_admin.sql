-- 042: flow and admin fixes (README part 72). Only ADD COLUMN IF NOT EXISTS, nothing existing changes. Re-runnable.
--   seo_journey.business_linked_at  the moment the business picked in /start was copied into seo_businesses (the table
--                                   the dashboard reads). Set once, so a business the customer later removes is never
--                                   silently re-added.
--   audit_leads.handled_at          the owner marked the public-Audit lead as handled (admin "what to do today" block).
--                                   NULL = not handled yet.
-- No Google content is stored by this migration (place_id only, as before).
ALTER TABLE seo_journey ADD COLUMN IF NOT EXISTS business_linked_at TIMESTAMPTZ;
ALTER TABLE audit_leads ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;
