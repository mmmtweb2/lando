-- Migration: 005_add_contact_links_and_form
-- Description: Add social links and lead-capture form flag to landing_pages

ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS facebook_url  VARCHAR,
  ADD COLUMN IF NOT EXISTS instagram_url VARCHAR,
  ADD COLUMN IF NOT EXISTS enable_form   BOOLEAN NOT NULL DEFAULT FALSE;
