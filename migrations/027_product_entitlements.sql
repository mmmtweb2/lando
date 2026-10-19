-- 027: product entitlements — the layer that lets Pagey sell more than one product
-- on the same accounts (Stage 5.5.1).
--
--   user_products   which paid products an account holds. Only 'seo_autopilot'
--                   (Google promotion) gets a row. Every existing user is treated as
--                   owning 'pagey_pages' IMPLICITLY, with no row — so there is NO
--                   backfill and existing customers are untouched.
--   seo_businesses  a business a seo_autopilot customer promotes. It may be linked to a
--                   Pagey page, to an external website only, or to both.
--   lead_events    now also holds events from an EXTERNAL website (via a future snippet):
--                   landing_page_id becomes nullable, business_id is added, and a CHECK
--                   requires exactly one of the two.
--
-- Security: same pattern as 021/022/026 — RLS ENABLE + FORCE, zero policies; reached only
-- through the backend's service-role key.
-- Re-runnable: every statement is idempotent (IF NOT EXISTS / DROP ... IF EXISTS first).
-- Deleting an account (user_profiles row) cascades to user_products and seo_businesses
-- (and from there to lead_events.business_id), so deleteAccount needs no extra code.

-- ─── user_products ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_products (
  email              TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  product            TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'active',
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ,
  source             TEXT        NOT NULL DEFAULT 'manual',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, product)
);
ALTER TABLE user_products DROP CONSTRAINT IF EXISTS user_products_product_check;
ALTER TABLE user_products ADD CONSTRAINT user_products_product_check
  CHECK (product IN ('seo_autopilot'));
ALTER TABLE user_products DROP CONSTRAINT IF EXISTS user_products_status_check;
ALTER TABLE user_products ADD CONSTRAINT user_products_status_check
  CHECK (status IN ('active','trialing','canceled','past_due'));
ALTER TABLE user_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_products FORCE ROW LEVEL SECURITY;

-- ─── seo_businesses ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_businesses (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email     TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  name            TEXT        NOT NULL,
  google_place_id TEXT,
  website_url     TEXT,
  -- A deleted Pagey page must not delete the business (it may have an external site).
  landing_page_id UUID        REFERENCES landing_pages(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_businesses_owner ON seo_businesses (owner_email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_businesses_owner_place
  ON seo_businesses (owner_email, google_place_id) WHERE google_place_id IS NOT NULL;
ALTER TABLE seo_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_businesses FORCE ROW LEVEL SECURITY;

-- ─── lead_events: events from an external website ────────────────────────────
ALTER TABLE lead_events ALTER COLUMN landing_page_id DROP NOT NULL;
ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS business_id UUID
  REFERENCES seo_businesses(id) ON DELETE CASCADE;
ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_target_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_target_check
  CHECK ((landing_page_id IS NOT NULL)::int + (business_id IS NOT NULL)::int = 1);
CREATE INDEX IF NOT EXISTS idx_lead_events_business_created
  ON lead_events (business_id, created_at DESC) WHERE business_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
