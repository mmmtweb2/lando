-- Migration: 006_consolidate_schema
-- Description: Single source-of-truth for the schema, reconciled against the
--   LIVE Supabase schema (provided 28/06/2026). Until now `user_profiles` and
--   `leads` had no migration file, and 6 `landing_pages` columns were added via
--   the dashboard without a migration. This file documents the real schema.
--
-- ✅ This matches the live DB. Idempotent + non-destructive (safe to run).
--
-- ⚠️  TWO CODE↔DB MISMATCHES that this file does NOT paper over — they are fixed
--     in the code, not here:
--       1. `user_profiles.ai_image_credits` DOES NOT EXIST in the DB, but the
--          code still references it (user.controller SELECT/insert,
--          landing.controller AI-image gate, ClientPortal). Those paths error
--          against the real DB. Fix = remove ai_image_credits from code and use
--          the single `credits` column (task 2.1.2).
--       2. `leads` real column is `landing_page_id`, but Dashboard.tsx queries
--          `page_id`. Fix = align Dashboard to `landing_page_id` (task 2.1.1).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. user_profiles   (PK = email; NO `id`, NO `ai_image_credits`)
--    credits is the ONE wallet balance, NOT NULL DEFAULT 10 (new users get 10).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
    email             VARCHAR     NOT NULL,
    affiliate_code    VARCHAR     UNIQUE,
    referred_by_code  VARCHAR,
    created_at        TIMESTAMPTZ DEFAULT timezone('utc', now()),
    earned_coupons    INTEGER     NOT NULL DEFAULT 0,
    signup_discount   BOOLEAN     NOT NULL DEFAULT FALSE,
    is_admin          BOOLEAN     DEFAULT FALSE,
    credits           INTEGER     NOT NULL DEFAULT 10,
    CONSTRAINT user_profiles_pkey PRIMARY KEY (email)
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_affiliate_code ON user_profiles (affiliate_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. leads   (FK landing_page_id → landing_pages.id; phone is nullable in DB)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
    id               UUID        NOT NULL DEFAULT gen_random_uuid(),
    landing_page_id  UUID,
    name             TEXT        NOT NULL,
    phone            TEXT,
    email            TEXT,
    message          TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT leads_pkey PRIMARY KEY (id),
    CONSTRAINT leads_landing_page_id_fkey FOREIGN KEY (landing_page_id)
        REFERENCES landing_pages(id)
);

CREATE INDEX IF NOT EXISTS idx_leads_landing_page_id ON leads (landing_page_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. landing_pages — the 6 columns that exist in the DB but had no migration.
--    (For a fresh DB; on the live DB these already exist, so these are no-ops.)
--    NOTE: `vibe` is intentionally NOT a column — it is wizard input only;
--    og.controller wrongly selects it (BUG-6, fixed in task 1.1.4).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS owner_email   VARCHAR;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS status        VARCHAR DEFAULT 'draft';
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS external_link TEXT;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS page_goal     TEXT DEFAULT 'lead_gen';

CREATE INDEX IF NOT EXISTS idx_landing_pages_owner_email ON landing_pages (owner_email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Row Level Security — INTENTIONALLY NOT SET HERE (deferred to pre-launch
--    security pass). Today the browser uses the public anon key directly on
--    these tables. Before launch: lock anon to deny-all + move privileged writes
--    behind the server's service-role key. New money features are built
--    server-side from the start so the lock-down won't require a rewrite.
-- ─────────────────────────────────────────────────────────────────────────────

COMMIT;
