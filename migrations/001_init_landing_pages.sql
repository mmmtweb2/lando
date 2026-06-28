-- Migration: 001_init_landing_pages
-- Description: Initialize landing_pages table for automated landing page builder

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS landing_pages (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR     NOT NULL UNIQUE,
    business_name   VARCHAR     NOT NULL,
    phone_number    VARCHAR     NOT NULL,
    logo_url        VARCHAR,
    user_images     JSONB,
    tier            VARCHAR     NOT NULL CHECK (tier IN ('text_only', 'stock_images', 'ai_images')),
    ai_content      JSONB       NOT NULL,
    user_provided_text TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_landing_pages_slug ON landing_pages (slug);

COMMIT;
