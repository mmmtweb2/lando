-- 028: content plan for a promoted business (Stage 8.1/8.2).
--
--   seo_businesses gains what the customer tells us about the business — its type, the areas
--   it serves, the long-tail phrases it chose to target, and a free-text "facts" box. These are
--   the customer's own words (NOT Google Places content), and facts is the ONLY source the
--   content generator may draw claims from.
--   seo_content_kits holds the copy-ready content we generate for a phrase (for customers whose
--   site is outside Pagey). It is our own generated text, so storing it is fine.
--
-- Security: same pattern as 026/027 — RLS ENABLE + FORCE, zero policies, service-role only.
-- Re-runnable: idempotent. Deleting a business cascades to its kits.

ALTER TABLE seo_businesses ADD COLUMN IF NOT EXISTS business_type     TEXT;
ALTER TABLE seo_businesses ADD COLUMN IF NOT EXISTS service_areas     TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE seo_businesses ADD COLUMN IF NOT EXISTS long_tail_phrases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE seo_businesses ADD COLUMN IF NOT EXISTS facts             TEXT;

CREATE TABLE IF NOT EXISTS seo_content_kits (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        NOT NULL REFERENCES seo_businesses(id) ON DELETE CASCADE,
  phrase      TEXT        NOT NULL,
  kit         JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_content_kits_business ON seo_content_kits (business_id, created_at DESC);
ALTER TABLE seo_content_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_content_kits FORCE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
