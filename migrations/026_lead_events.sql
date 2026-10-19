-- 026: lead_events — one row per WhatsApp / call click on a published page, so the
-- owner's leads feed can show every inquiry, not only contact-form submissions.
-- (Form submissions already land in `leads`; 'form' is allowed here but unused, to
-- avoid double counting.)
-- Security: same pattern as site_visits / funnel_events (021/022): RLS ENABLE + FORCE,
-- zero policies — reached only through the backend's service-role key.
CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landing_page_id UUID NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('whatsapp','call','form')),
  source_url TEXT,
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_events_page_created ON lead_events (landing_page_id, created_at DESC);
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events FORCE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
