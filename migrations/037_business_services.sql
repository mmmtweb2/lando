-- 037: the list of services a business offers (up to 8 short names), kept per business.
--
-- Used by the review-request message: the owner picks which service the customer received and
-- the WhatsApp text mentions it, so reviews describe the actual service. Kept in its own table
-- (not a column on seo_businesses) so the businesses list keeps working before this migration runs.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.
-- Deleting a business or an account cascades.

CREATE TABLE IF NOT EXISTS seo_business_services (
  business_id UUID        PRIMARY KEY REFERENCES seo_businesses(id) ON DELETE CASCADE,
  services    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seo_business_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_business_services FORCE ROW LEVEL SECURITY;
