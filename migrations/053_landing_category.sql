-- 053: a category for every landing page (README part 141).
--
-- One visual brand, category-specific parameters: the category decides the order of the sections, the
-- call to action, the trust elements, the tone of the text and the kind of stock photos. It is detected
-- from the business description when the page is created and is never asked from the customer. The
-- owner can change it quietly from the editor; a manual change is never re-detected.
--
--   category         'general' | 'health' | 'professional' | 'nonprofit' | 'arts_events' | 'food' | 'beauty' | 'trades'
--                    NULL = a page created before this migration = the general template. Existing pages are NOT
--                    re-categorised: the column stays NULL until the owner changes it.
--   category_source  'auto' (detected at creation) | 'manual' (chosen by the owner). NULL for old pages.
--
-- Safe to re-run. No rows are changed or deleted. The code works before this has run: a missing column is
-- treated as NULL (general), the page is created without it, and changing the category answers "available soon".

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS category_source TEXT;

ALTER TABLE landing_pages DROP CONSTRAINT IF EXISTS landing_pages_category_check;
ALTER TABLE landing_pages ADD CONSTRAINT landing_pages_category_check
  CHECK (category IS NULL OR category IN ('general', 'health', 'professional', 'nonprofit', 'arts_events', 'food', 'beauty', 'trades'));

ALTER TABLE landing_pages DROP CONSTRAINT IF EXISTS landing_pages_category_source_check;
ALTER TABLE landing_pages ADD CONSTRAINT landing_pages_category_source_check
  CHECK (category_source IS NULL OR category_source IN ('auto', 'manual'));

-- PostgREST caches the table's shape; ask it to reload so the new columns are usable right away.
NOTIFY pgrst, 'reload schema';
