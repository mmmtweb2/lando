-- 026: lead_events — one row per inquiry click on a published page (WhatsApp, call,
-- email) or outbound-link click, so the owner's leads feed can show every inquiry,
-- not only contact-form submissions.
--   whatsapp / call / email  = an inquiry (counted as a lead)
--   link                     = an external link out (donation, purchase): NOT an
--                              inquiry, shown in its own card only
--   form                     = allowed but unused (forms already land in `leads`)
-- Rows with source_url = 'smoke-test' are post-deploy smoke-test events: stored, but
-- excluded server-side from the feed and every lead count (see getMyLeads).
-- Security: same pattern as site_visits / funnel_events (021/022): RLS ENABLE + FORCE,
-- zero policies — reached only through the backend's service-role key.
-- Re-runnable: if an earlier version of this table exists, only the CHECK is replaced.
CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  landing_page_id UUID NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('whatsapp','call','email','link','form')),
  source_url TEXT,
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_event_type_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_event_type_check
  CHECK (event_type IN ('whatsapp','call','email','link','form'));
CREATE INDEX IF NOT EXISTS idx_lead_events_page_created ON lead_events (landing_page_id, created_at DESC);
ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_events FORCE ROW LEVEL SECURITY;
NOTIFY pgrst, 'reload schema';
