-- 035: review requests (stage 7) — the owner's list of customers to ask for a Google review.
--
-- One row per (business, customer phone). The OWNER sends every message from their own WhatsApp
-- with one tap (a wa.me link); Pagey sends nothing and only remembers who was asked and when, so
-- nobody is asked twice by mistake. First name + phone only, at most 200 people per business, and
-- the owner can delete a person at any time. Deleting a business or an account cascades.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.

CREATE TABLE IF NOT EXISTS review_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email      TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  business_id      UUID        NOT NULL REFERENCES seo_businesses(id) ON DELETE CASCADE,
  first_name       TEXT        NOT NULL,
  phone            TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'new',
  sent_at          TIMESTAMPTZ,
  followup_sent_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE review_requests DROP CONSTRAINT IF EXISTS review_requests_status_check;
ALTER TABLE review_requests ADD CONSTRAINT review_requests_status_check CHECK (status IN ('new', 'sent', 'reviewed'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_requests_person ON review_requests (business_id, phone);
CREATE INDEX IF NOT EXISTS idx_review_requests_owner ON review_requests (owner_email, business_id);
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_requests FORCE ROW LEVEL SECURITY;
