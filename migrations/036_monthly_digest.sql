-- 036: monthly summary email to customers of the Google-promotion product.
--
--   seo_email_prefs   one row per account that changed its email preference. No row = default (on).
--   seo_digest_log    one row per (account, month) that was sent; the primary key is the guard
--                     that makes a month's email go out at most once, even if the server restarts.
-- Nothing is sent until MONTHLY_DIGEST_ENABLED=true (and DIGEST_SECRET + RESEND_API_KEY exist).
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.
-- Deleting an account cascades.

CREATE TABLE IF NOT EXISTS seo_email_prefs (
  email           TEXT        PRIMARY KEY REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  monthly_digest  BOOLEAN     NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seo_email_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_email_prefs FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS seo_digest_log (
  email     TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  month     TEXT        NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, month)
);
ALTER TABLE seo_digest_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_digest_log FORCE ROW LEVEL SECURITY;
