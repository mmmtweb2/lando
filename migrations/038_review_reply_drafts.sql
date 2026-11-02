-- 038: unanswered-review alerts (task #8.4). One row per Google review that waited 5+ days
-- without a reply: the draft we prepared and what happened to it.
--
-- Pagey never publishes a reply by itself: status moves pending -> published only when the
-- owner presses the approve button in the dashboard. We keep NO review text and no reviewer
-- surname: only the review id, the star rating, the reviewer's first name (for the draft's greeting),
-- the date and our draft. The review itself is fetched live from Google when the owner opens it.
-- The unique key (owner_email, review_id) makes the alert idempotent: one alert per review, ever.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.
-- Deleting an account cascades.

CREATE TABLE IF NOT EXISTS review_reply_drafts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email       TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  review_id         TEXT        NOT NULL,
  location_name     TEXT        NOT NULL,
  rating            SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  reviewer_first    TEXT,
  review_created_at TIMESTAMPTZ NOT NULL,
  draft             TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  notified_at       TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE review_reply_drafts DROP CONSTRAINT IF EXISTS review_reply_drafts_status_check;
ALTER TABLE review_reply_drafts ADD CONSTRAINT review_reply_drafts_status_check CHECK (status IN ('pending', 'published', 'dismissed'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_reply_drafts_review ON review_reply_drafts (owner_email, review_id);
CREATE INDEX IF NOT EXISTS idx_review_reply_drafts_owner_status ON review_reply_drafts (owner_email, status);
ALTER TABLE review_reply_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_reply_drafts FORCE ROW LEVEL SECURITY;
