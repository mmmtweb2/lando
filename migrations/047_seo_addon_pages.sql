-- 047: the landing page that comes with a "with page" promotion plan (task #30, docs/billing-spec.md).
--
-- A subscriber on monthly_page / annual_page may publish ONE landing page without spending a page
-- credit, for as long as the subscription is active. This table records which page it is (one per
-- account). While the subscription is not active the page is FROZEN (offline, content and leads kept),
-- and it comes back when the subscription does. The renewal sweeps skip these pages: they are not
-- renewed for 99 and not auto-deleted after 12 months.
-- Re-runnable. New table: RLS ENABLE + FORCE, no policies (server access only, service role).

CREATE TABLE IF NOT EXISTS seo_addon_pages (
  email           TEXT PRIMARY KEY,
  page_id         UUID NOT NULL,
  subscription_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seo_addon_pages_page_idx ON seo_addon_pages (page_id);

ALTER TABLE seo_addon_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_addon_pages FORCE ROW LEVEL SECURITY;
