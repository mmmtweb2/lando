-- 051: two decisions of 17.11.2026.
--
--   seo_refund_requests            A Google-promotion customer who cancels within 14 days of the FIRST
--                                  payment gets a full refund. SUMIT's refund API is not verified, so the
--                                  server never refunds by itself: it ends the subscription, stops the
--                                  standing order and records a request here; Moshe refunds in the SUMIT
--                                  dashboard and marks it in the admin panel. One per account, ever.
--   landing_pages.renewal_opt_out_at
--                                  The owner chose not to renew a Pagey page (renewal is never automatic;
--                                  this only stops the reminder emails and says what will happen).
--                                  Reversible: set back to NULL.
--
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable. No deletes.

CREATE TABLE IF NOT EXISTS seo_refund_requests (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT          NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  subscription_id  UUID          REFERENCES seo_subscriptions(id) ON DELETE SET NULL,
  sumit_payment_id TEXT,
  amount           NUMERIC(10,2) NOT NULL,
  requested_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  status           TEXT          NOT NULL DEFAULT 'pending',
  handled_at       TIMESTAMPTZ,
  note             TEXT
);
ALTER TABLE seo_refund_requests DROP CONSTRAINT IF EXISTS seo_refund_requests_status_check;
ALTER TABLE seo_refund_requests ADD CONSTRAINT seo_refund_requests_status_check CHECK (status IN ('pending', 'refunded', 'rejected'));
-- One refund per account, ever: a subscribe-cancel-subscribe loop gets the window once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_refund_requests_email ON seo_refund_requests (email);
CREATE INDEX IF NOT EXISTS idx_seo_refund_requests_status ON seo_refund_requests (status, requested_at DESC);
ALTER TABLE seo_refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_refund_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS renewal_opt_out_at TIMESTAMPTZ;
