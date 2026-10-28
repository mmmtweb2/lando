-- 032: one-time setup checklist of the Google-promotion product (dashboard v2.1).
--
-- Some setup steps are done by the customer OUTSIDE Pagey (completing the Google profile,
-- verifying it, sending the first review link), so we cannot detect them: the customer ticks
-- them. One row = one ticked step for one account. No Google content is stored here.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only).
-- Re-runnable.

CREATE TABLE IF NOT EXISTS seo_setup_steps (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL,
  step_key   TEXT        NOT NULL,
  done_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, step_key)
);
ALTER TABLE seo_setup_steps DROP CONSTRAINT IF EXISTS seo_setup_steps_key_check;
ALTER TABLE seo_setup_steps ADD CONSTRAINT seo_setup_steps_key_check CHECK (
  step_key IN ('first_check', 'profile_details', 'profile_verified', 'review_link_shared', 'tracking_ready', 'phase2_ack')
);
CREATE INDEX IF NOT EXISTS idx_seo_setup_steps_email ON seo_setup_steps (email);
ALTER TABLE seo_setup_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_setup_steps FORCE ROW LEVEL SECURITY;
