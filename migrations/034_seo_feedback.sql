-- 034: feedback from customers/testers of the Google-promotion product.
--
-- One row per message sent from the dashboard's feedback form. Read only in /admin.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.
-- Deleting an account cascades to its feedback.

CREATE TABLE IF NOT EXISTS seo_feedback (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  kind        TEXT        NOT NULL DEFAULT 'other',
  message     TEXT        NOT NULL,
  page        TEXT,
  seen        BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seo_feedback DROP CONSTRAINT IF EXISTS seo_feedback_kind_check;
ALTER TABLE seo_feedback ADD CONSTRAINT seo_feedback_kind_check CHECK (kind IN ('bug', 'idea', 'other'));
CREATE INDEX IF NOT EXISTS idx_seo_feedback_created ON seo_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_feedback_email ON seo_feedback (email, created_at DESC);
ALTER TABLE seo_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_feedback FORCE ROW LEVEL SECURITY;
