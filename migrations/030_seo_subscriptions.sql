-- 030: monthly subscription for the Google-promotion product (seo_autopilot) — Stage 9.2.
--
--   seo_subscriptions        one row per account: the subscription's state as WE track it.
--                            Entitlement itself still lives in user_products (migration 027);
--                            this table feeds it (source = 'sumit').
--   seo_subscription_events  one row per SUMIT payment we processed. The UNIQUE index on
--                            sumit_payment_id is the replay guard: a payment id can extend
--                            access once, ever, for any account.
--
-- Nothing here charges anyone: the feature is off until SEO_SUBSCRIPTION_ENABLED=true.
-- Security: RLS ENABLE + FORCE, zero policies (same pattern as 021/022/026/027).
-- Re-runnable: idempotent.

CREATE TABLE IF NOT EXISTS seo_subscriptions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   TEXT          NOT NULL UNIQUE REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  status                  TEXT          NOT NULL DEFAULT 'pending',
  amount                  NUMERIC(10,2) NOT NULL,
  sumit_customer_id       TEXT,
  sumit_recurring_item_id TEXT,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN       NOT NULL DEFAULT false,
  -- true when the customer cancelled here but SUMIT's cancel call failed: a human must stop
  -- the standing order in the SUMIT dashboard, or the customer keeps being charged.
  needs_manual_cancel     BOOLEAN       NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE seo_subscriptions DROP CONSTRAINT IF EXISTS seo_subscriptions_status_check;
ALTER TABLE seo_subscriptions ADD CONSTRAINT seo_subscriptions_status_check
  CHECK (status IN ('pending','active','past_due','canceled'));
ALTER TABLE seo_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_subscriptions FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS seo_subscription_events (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID          NOT NULL REFERENCES seo_subscriptions(id) ON DELETE CASCADE,
  kind              TEXT          NOT NULL,
  sumit_payment_id  TEXT,
  amount            NUMERIC(10,2),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
ALTER TABLE seo_subscription_events DROP CONSTRAINT IF EXISTS seo_subscription_events_kind_check;
ALTER TABLE seo_subscription_events ADD CONSTRAINT seo_subscription_events_kind_check
  CHECK (kind IN ('charge_ok','charge_failed','canceled'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_sub_events_payment
  ON seo_subscription_events (sumit_payment_id) WHERE sumit_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_seo_sub_events_sub ON seo_subscription_events (subscription_id, created_at DESC);
ALTER TABLE seo_subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_subscription_events FORCE ROW LEVEL SECURITY;
