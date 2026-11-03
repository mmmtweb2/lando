-- Migration: 003_rename_tier_to_image_source
-- Description: Replace the 'tier' column with 'image_source' and update its allowed values
-- Idempotent: safe to run again (or on a database where the column is already renamed).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'landing_pages' AND column_name = 'tier'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'landing_pages' AND column_name = 'image_source'
  ) THEN
    ALTER TABLE landing_pages RENAME COLUMN tier TO image_source;
  END IF;
END $$;

-- Drop old check constraint (PostgreSQL default name from the inline definition)
ALTER TABLE landing_pages DROP CONSTRAINT IF EXISTS landing_pages_tier_check;

-- Add updated constraint with new values (drop first so a re-run does not fail)
ALTER TABLE landing_pages DROP CONSTRAINT IF EXISTS landing_pages_image_source_check;
ALTER TABLE landing_pages
  ADD CONSTRAINT landing_pages_image_source_check
  CHECK (image_source IN ('none', 'upload', 'stock', 'ai'));

COMMIT;
