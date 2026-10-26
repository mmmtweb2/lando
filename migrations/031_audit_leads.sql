-- 031: leads captured on the PUBLIC Audit page (/audit) — task #1 (Avi, 2026-10-26).
--
-- A visitor who is not signed in runs an Audit and may leave a name + Israeli mobile number,
-- ONLY after ticking an unticked consent box. Without consent nothing is stored (enforced in
-- code and by the NOT NULL columns below). consent_text is the exact wording the server showed,
-- consent_at when it was given — the proof Section 30A of the Communications Law asks for.
--
-- Places terms: business_name and score are only the sales context the visitor just saw; no
-- other Google content is stored (place_id is the only Places value kept).
-- ip_hash is a salted SHA-256 of the IP (abuse review), never the IP itself.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only).
-- Re-runnable.

CREATE TABLE IF NOT EXISTS audit_leads (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  phone         TEXT        NOT NULL,
  place_id      TEXT        NOT NULL,
  business_name TEXT,
  score         SMALLINT,
  consent_at    TIMESTAMPTZ NOT NULL,
  consent_text  TEXT        NOT NULL,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  ip_hash       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_leads DROP CONSTRAINT IF EXISTS audit_leads_score_check;
ALTER TABLE audit_leads ADD CONSTRAINT audit_leads_score_check CHECK (score IS NULL OR (score >= 0 AND score <= 100));
CREATE INDEX IF NOT EXISTS idx_audit_leads_phone_place ON audit_leads (phone, place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_leads_created ON audit_leads (created_at DESC);
ALTER TABLE audit_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_leads FORCE ROW LEVEL SECURITY;
