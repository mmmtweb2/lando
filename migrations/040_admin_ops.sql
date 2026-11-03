-- 040: admin operations (task #10).
--
--   seo_manual_premium  customers who get the manual "premium" treatment during the beta: the owner updates their
--                       Google card by hand (the Business Profile API has no quota yet), so this only TRACKS it:
--                       a simple status, the last date the card was updated, and a free-form monthly price
--                       (collected by hand; NOT connected to SUMIT and with no default value).
--   places_usage        Google Places calls per month and SKU, to see the free-cap usage on the admin health tab.
--   job_heartbeats      last run of every background sweep (digest, alerts, subscriptions, renewals).
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.

CREATE TABLE IF NOT EXISTS seo_manual_premium (
  email            TEXT          PRIMARY KEY REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  status           TEXT          NOT NULL DEFAULT 'active',
  last_card_update DATE,
  monthly_price    NUMERIC(10,2),
  note             TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE seo_manual_premium DROP CONSTRAINT IF EXISTS seo_manual_premium_status_check;
ALTER TABLE seo_manual_premium ADD CONSTRAINT seo_manual_premium_status_check CHECK (status IN ('active', 'paused', 'ended'));
ALTER TABLE seo_manual_premium DROP CONSTRAINT IF EXISTS seo_manual_premium_price_check;
ALTER TABLE seo_manual_premium ADD CONSTRAINT seo_manual_premium_price_check CHECK (monthly_price IS NULL OR (monthly_price >= 0 AND monthly_price <= 100000));
ALTER TABLE seo_manual_premium ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_manual_premium FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS places_usage (
  month TEXT   NOT NULL,
  sku   TEXT   NOT NULL,
  calls BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (month, sku)
);
ALTER TABLE places_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE places_usage FORCE ROW LEVEL SECURITY;

-- Atomic increment (one statement, no read-modify-write race between instances).
CREATE OR REPLACE FUNCTION bump_places_usage(p_month TEXT, p_sku TEXT) RETURNS VOID
LANGUAGE sql SECURITY INVOKER AS $$
  INSERT INTO places_usage (month, sku, calls) VALUES (p_month, p_sku, 1)
  ON CONFLICT (month, sku) DO UPDATE SET calls = places_usage.calls + 1;
$$;
REVOKE ALL ON FUNCTION bump_places_usage(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS job_heartbeats (
  job           TEXT        PRIMARY KEY,
  last_run_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at    TIMESTAMPTZ,
  last_error    TEXT,
  last_error_at TIMESTAMPTZ,
  runs          BIGINT      NOT NULL DEFAULT 0
);
ALTER TABLE job_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_heartbeats FORCE ROW LEVEL SECURITY;
