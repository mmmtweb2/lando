-- Migration: 003_rename_tier_to_image_source
-- Description: Replace the 'tier' column with 'image_source' and update its allowed values

BEGIN;

ALTER TABLE landing_pages RENAME COLUMN tier TO image_source;

-- Drop old check constraint (PostgreSQL default name from the inline definition)
ALTER TABLE landing_pages DROP CONSTRAINT IF EXISTS landing_pages_tier_check;

-- Add updated constraint with new values
ALTER TABLE landing_pages
  ADD CONSTRAINT landing_pages_image_source_check
  CHECK (image_source IN ('none', 'upload', 'stock', 'ai'));

COMMIT;
