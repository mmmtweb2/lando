-- 025: child pages (SEO sub-pages) hang off a parent landing page.
-- Children live in the same table, inherit status/expiry from the parent at
-- read time, and are excluded from quotas, owner page lists and lifecycle sweeps.
ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES landing_pages(id) ON DELETE CASCADE;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS target_keyword TEXT;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS sub_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_landing_pages_parent_sub_slug
  ON landing_pages (parent_id, sub_slug) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_landing_pages_parent_id
  ON landing_pages (parent_id) WHERE parent_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE landing_pages ADD CONSTRAINT landing_pages_child_requires_sub_slug
    CHECK ((parent_id IS NULL AND sub_slug IS NULL) OR (parent_id IS NOT NULL AND sub_slug IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
NOTIFY pgrst, 'reload schema';
