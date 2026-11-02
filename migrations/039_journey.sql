-- 039: the customer journey of the Google-promotion product (task #9).
--
--   seo_journey     one row per account that started the journey (registered -> setup -> ready_to_activate).
--                   "active_beta" / "active" are NOT stored here: they are derived from the entitlement
--                   (user_products), so flipping the payment gate never needs a data change.
--                   Only the Google place_id is kept (Places terms): after sign-up the audit is re-run
--                   from it, no score or Google content is saved.
--   journey_events  operational funnel log (server-side). Not the same as funnel_events (022), which
--                   tracks the landing-page product. Marketing tags (GTM) stay separate and need consent.
--                   No names, phones or emails inside props; `email` is the account, null for anonymous visitors.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.
-- Deleting an account cascades (journey and its events).

CREATE TABLE IF NOT EXISTS seo_journey (
  email                   TEXT        PRIMARY KEY REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  stage                   TEXT        NOT NULL DEFAULT 'registered',
  place_id                TEXT,
  anon_id                 TEXT,
  source                  TEXT,
  utm_source              TEXT,
  utm_medium              TEXT,
  utm_campaign            TEXT,
  registered_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  setup_at                TIMESTAMPTZ,
  ready_at                TIMESTAMPTZ,
  activation_requested_at TIMESTAMPTZ,
  beta_activated_at       TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seo_journey DROP CONSTRAINT IF EXISTS seo_journey_stage_check;
ALTER TABLE seo_journey ADD CONSTRAINT seo_journey_stage_check CHECK (stage IN ('registered', 'setup', 'ready_to_activate'));
ALTER TABLE seo_journey ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_journey FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS journey_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event        TEXT        NOT NULL,
  email        TEXT        REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  anon_id      TEXT,
  props        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source       TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_events_event_time ON journey_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_events_email ON journey_events (email, created_at DESC) WHERE email IS NOT NULL;
-- Milestones happen once per account, ever (the insert of a second one is simply ignored).
CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_milestones ON journey_events (email, event)
  WHERE email IS NOT NULL AND event IN ('signup', 'setup_completed', 'activation_requested', 'activated_beta', 'payment_succeeded', 'day7_active', 'day30_active');
ALTER TABLE journey_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_events FORCE ROW LEVEL SECURITY;
