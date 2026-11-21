-- 054: page languages for landing pages (README part 142).
--
-- A page written in Hebrew can be shown in more languages, each at its own address (/p/<slug>/fr,
-- <sub>.pagey.co.il/fr, /b/<sub>/fr). The Hebrew page (landing_pages.ai_content) stays the source; a
-- translation is a flat map of the page's texts, one row per page and language.
--
--   landing_translations
--     lang         'fr' | 'en' (enabled now) | 'ru' | 'ar' (accepted, switched on later by config only)
--     content      translated texts: { "<key>": "<text>" }, keys like "hero.title", "faq.0.answer", "img_alt:<url>"
--     source_hash  { "<key>": "<hash of the Hebrew text it was translated from>" }: a different hash = "not updated"
--     manual_keys  keys the owner rewrote by hand; never overwritten without an explicit confirmation
--     status       'draft' (a health page waits for the owner's approval) | 'published' (served to visitors)
--     approved_at  when the owner approved / it was published
--   leads.lang     the page language a visitor wrote from ('fr', 'en'; NULL = Hebrew, and every lead before this)
--
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Deleting a page deletes its
-- translations. Safe to re-run. No rows are changed or deleted. The code works before this has run: the
-- feature is hidden, its endpoints answer 503 {code:'not_migrated'}, and pages are served exactly as before.

CREATE TABLE IF NOT EXISTS landing_translations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      UUID        NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  lang         TEXT        NOT NULL,
  content      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_hash  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  manual_keys  TEXT[]      NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'draft',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ
);

ALTER TABLE landing_translations DROP CONSTRAINT IF EXISTS landing_translations_lang_check;
ALTER TABLE landing_translations ADD CONSTRAINT landing_translations_lang_check CHECK (lang IN ('fr', 'en', 'ru', 'ar'));
ALTER TABLE landing_translations DROP CONSTRAINT IF EXISTS landing_translations_status_check;
ALTER TABLE landing_translations ADD CONSTRAINT landing_translations_status_check CHECK (status IN ('draft', 'published'));
ALTER TABLE landing_translations DROP CONSTRAINT IF EXISTS landing_translations_content_check;
ALTER TABLE landing_translations ADD CONSTRAINT landing_translations_content_check
  CHECK (jsonb_typeof(content) = 'object' AND jsonb_typeof(source_hash) = 'object');
CREATE UNIQUE INDEX IF NOT EXISTS uq_landing_translations_page_lang ON landing_translations (page_id, lang);

ALTER TABLE landing_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE landing_translations FORCE ROW LEVEL SECURITY;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS lang TEXT;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_lang_check;
ALTER TABLE leads ADD CONSTRAINT leads_lang_check CHECK (lang IS NULL OR lang IN ('fr', 'en', 'ru', 'ar'));

-- PostgREST caches the schema; reload so the new table and column are usable right away.
NOTIFY pgrst, 'reload schema';
