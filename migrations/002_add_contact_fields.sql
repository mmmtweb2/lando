-- Migration: 002_add_contact_fields
-- Description: Add email, address, and about_business columns for richer landing pages

BEGIN;

ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS email         VARCHAR,
  ADD COLUMN IF NOT EXISTS address       VARCHAR,
  ADD COLUMN IF NOT EXISTS about_business TEXT;

COMMIT;
