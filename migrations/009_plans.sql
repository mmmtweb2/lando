-- ─────────────────────────────────────────────────────────────────────────────
-- 009_plans.sql — prepaid renewable subscription plans
--
-- Adds a "plan" layer on top of the existing pay-per-page model:
--   • Free users keep paying 249₪ per published page (unchanged).
--   • Plan holders (freelancer / agency) prepay a yearly plan that covers
--     publishing up to `maxActivePages` live pages, with a monthly page-creation
--     cap and a monthly AI-credit refill. All limits live in code (config/plans.ts).
--
-- Columns:
--   plan                  — 'free' | 'freelancer' | 'agency'  (limits derived in code)
--   plan_expires_at       — when the prepaid plan lapses (NULL for free)
--   pages_created_period  — pages created in the current monthly window
--   period_key            — 'YYYY-MM' the counter belongs to; a new month resets it
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS plan                 TEXT        NOT NULL DEFAULT 'free';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS plan_expires_at      TIMESTAMPTZ;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS pages_created_period INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS period_key           TEXT;

-- Quick lookup of active plans (e.g. an expiry sweep / admin view).
CREATE INDEX IF NOT EXISTS idx_user_profiles_plan_expires ON user_profiles (plan_expires_at);
