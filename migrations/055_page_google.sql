-- 055: the business's landing page and its Google listing share reviews and photos (README part 143).
--
--   gbp_page_sync (one row per account that connected its Google listing)
--     location_name        the listing the cached data belongs to (another listing = the cache is ignored)
--     account_name         the v4 account that owns it ("accounts/…"), so the page does not look it up per refresh
--     reviews              what the page shows: overall rating, count and the few selected reviews (first names only),
--                          read from the owner's OWN listing with the Business Profile API (OAuth), refreshed every 24h
--     reviews_fetched_at   when Google was last read for it
--     sent_photos          page photos already added to the listing, and listing photos taken into the page:
--                          [{ "u": url, "h": sha256 of the bytes, "m": google media id, "o": "page"|"manual"|"google", "at": iso }]
--                          so a photo is never sent to Google twice and a Google photo is never sent back
--   seo_automation.photos_mode   'auto' (default) | 'ask' | 'off': new photos of the page go to the listing by themselves,
--                                wait for the owner's click in the dashboard, or never
--
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Safe to re-run; no rows are changed or
-- deleted. The code works before this has run: the page shows no Google reviews, photos are never sent automatically
-- (there is nowhere to remember what was sent), and the dashboard says the feature is not active yet.

CREATE TABLE IF NOT EXISTS gbp_page_sync (
  owner_email         TEXT        PRIMARY KEY,
  location_name       TEXT,
  account_name        TEXT,
  reviews             JSONB,
  reviews_fetched_at  TIMESTAMPTZ,
  sent_photos         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gbp_page_sync DROP CONSTRAINT IF EXISTS gbp_page_sync_sent_check;
ALTER TABLE gbp_page_sync ADD CONSTRAINT gbp_page_sync_sent_check CHECK (jsonb_typeof(sent_photos) = 'array');

ALTER TABLE gbp_page_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_page_sync FORCE ROW LEVEL SECURITY;

ALTER TABLE seo_automation ADD COLUMN IF NOT EXISTS photos_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE seo_automation DROP CONSTRAINT IF EXISTS seo_automation_photos_mode_check;
ALTER TABLE seo_automation ADD CONSTRAINT seo_automation_photos_mode_check CHECK (photos_mode IN ('auto', 'ask', 'off'));

-- PostgREST caches the schema; reload so the new table and column are usable right away.
NOTIFY pgrst, 'reload schema';
