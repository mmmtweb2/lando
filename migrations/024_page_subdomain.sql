-- ─────────────────────────────────────────────────────────────────────────────
-- 024_page_subdomain.sql — a readable subdomain per published page
--                          (run in the Supabase SQL editor, same as 009-023)
--
-- Published pages get a human-readable subdomain, e.g. cafe-dani.pagey.co.il
-- (assigned at publish time by src/services/subdomain.service.ts; existing
-- published pages are backfilled by the periodic sweep). NULL = no subdomain
-- (drafts, and published pages not yet backfilled) — those keep working at
-- /p/<slug>, which stays valid forever.
--
-- Stored lowercase. The partial unique index is what makes assignment race-safe:
-- two pages can never hold the same subdomain, and the app retries with a
-- suffix on a unique-violation.
--
-- SAFE / RE-RUNNABLE: IF NOT EXISTS, additive only.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS subdomain TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_landing_pages_subdomain
  ON landing_pages (subdomain) WHERE subdomain IS NOT NULL;

NOTIFY pgrst, 'reload schema';
