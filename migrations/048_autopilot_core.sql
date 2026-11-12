-- 048: the automatic product (docs/mvp-plan.md, part A). Four things, all per account (the Google
-- connection is one per account, migration 033):
--
--   business_truth   the business facts every automation writes from ("כרטיס האמת"): read from the
--                    customer's Google Business Profile, completed and approved once by the customer.
--                    Nothing is published for an account before approved_at is set.
--   seo_automation   what the customer lets us do by ourselves (posts, review replies) and when they agreed.
--   gbp_posts        one weekly post per account: text, when it may go out, what happened to it.
--   seo_activity     the log the dashboard and the monthly report show ("מה עשינו בשבילך").
--
-- Also: review_reply_drafts.auto marks a reply that was published without the owner pressing a button
-- (4-5 star reviews, only when the customer agreed).
--
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable. No deletes.
-- Deleting an account cascades.

CREATE TABLE IF NOT EXISTS business_truth (
  owner_email   TEXT        PRIMARY KEY REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  location_name TEXT,
  card          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  fetched_at    TIMESTAMPTZ,
  approved_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE business_truth ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_truth FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS seo_automation (
  owner_email  TEXT        PRIMARY KEY REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  posts_mode   TEXT        NOT NULL DEFAULT 'auto',
  replies_mode TEXT        NOT NULL DEFAULT 'auto_positive',
  consent_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE seo_automation DROP CONSTRAINT IF EXISTS seo_automation_posts_mode_check;
ALTER TABLE seo_automation ADD CONSTRAINT seo_automation_posts_mode_check CHECK (posts_mode IN ('auto', 'approve', 'off'));
ALTER TABLE seo_automation DROP CONSTRAINT IF EXISTS seo_automation_replies_mode_check;
ALTER TABLE seo_automation ADD CONSTRAINT seo_automation_replies_mode_check CHECK (replies_mode IN ('auto_positive', 'approve', 'off'));
ALTER TABLE seo_automation ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_automation FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS gbp_posts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email   TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  location_name TEXT        NOT NULL,
  week_key      TEXT        NOT NULL,
  topic         TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  cta           TEXT,
  status        TEXT        NOT NULL DEFAULT 'scheduled',
  edited        BOOLEAN     NOT NULL DEFAULT false,
  approved      BOOLEAN     NOT NULL DEFAULT false,
  publish_after TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ,
  google_name   TEXT,
  attempts      SMALLINT    NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE gbp_posts DROP CONSTRAINT IF EXISTS gbp_posts_status_check;
ALTER TABLE gbp_posts ADD CONSTRAINT gbp_posts_status_check CHECK (status IN ('scheduled', 'publishing', 'published', 'skipped', 'failed'));
ALTER TABLE gbp_posts DROP CONSTRAINT IF EXISTS gbp_posts_cta_check;
ALTER TABLE gbp_posts ADD CONSTRAINT gbp_posts_cta_check CHECK (cta IS NULL OR cta IN ('CALL', 'LEARN_MORE'));
-- One post per account per week: creating the weekly post is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gbp_posts_owner_week ON gbp_posts (owner_email, week_key);
CREATE INDEX IF NOT EXISTS idx_gbp_posts_due ON gbp_posts (status, publish_after);
ALTER TABLE gbp_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_posts FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS seo_activity (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  kind        TEXT        NOT NULL,
  title       TEXT        NOT NULL,
  detail      TEXT,
  ref         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seo_activity_owner_time ON seo_activity (owner_email, created_at DESC);
-- The same event is logged once (ref = the post id, the review id...). Rows without a ref are free.
CREATE UNIQUE INDEX IF NOT EXISTS uq_seo_activity_ref ON seo_activity (owner_email, kind, ref) WHERE ref IS NOT NULL;
ALTER TABLE seo_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_activity FORCE ROW LEVEL SECURITY;

ALTER TABLE review_reply_drafts ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT false;
