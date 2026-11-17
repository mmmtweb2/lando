-- 052: customers rate Pagey (decision 17.11). A rating is shown on the public site only when the
-- customer agreed to it (consent_publish) AND an admin approved it. Approval is by policy (a real
-- customer, no abuse, no personal data), never by the number of stars.
--
--   customer_ratings          one rating per account per product ('pages' | 'seo'); the customer can
--                             update it, which sends it back to 'pending'.
--   customer_rating_prompts   when the dashboard last asked, and whether the customer said "not now",
--                             so the ask never nags.
--
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable. No deletes.
-- Deleting an account cascades.

CREATE TABLE IF NOT EXISTS customer_ratings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  product         TEXT        NOT NULL,
  stars           SMALLINT    NOT NULL,
  text            TEXT        NOT NULL DEFAULT '',
  display_name    TEXT        NOT NULL DEFAULT '',
  business_type   TEXT        NOT NULL DEFAULT '',
  consent_publish BOOLEAN     NOT NULL DEFAULT false,
  consent_text    TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ
);
ALTER TABLE customer_ratings DROP CONSTRAINT IF EXISTS customer_ratings_product_check;
ALTER TABLE customer_ratings ADD CONSTRAINT customer_ratings_product_check CHECK (product IN ('pages', 'seo'));
ALTER TABLE customer_ratings DROP CONSTRAINT IF EXISTS customer_ratings_stars_check;
ALTER TABLE customer_ratings ADD CONSTRAINT customer_ratings_stars_check CHECK (stars BETWEEN 1 AND 5);
ALTER TABLE customer_ratings DROP CONSTRAINT IF EXISTS customer_ratings_status_check;
ALTER TABLE customer_ratings ADD CONSTRAINT customer_ratings_status_check CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE customer_ratings DROP CONSTRAINT IF EXISTS customer_ratings_lengths_check;
ALTER TABLE customer_ratings ADD CONSTRAINT customer_ratings_lengths_check
  CHECK (char_length(text) <= 400 AND char_length(display_name) <= 40 AND char_length(business_type) <= 40);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_ratings_email_product ON customer_ratings (email, product);
CREATE INDEX IF NOT EXISTS idx_customer_ratings_public ON customer_ratings (product, status, consent_publish, created_at DESC);
ALTER TABLE customer_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_ratings FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS customer_rating_prompts (
  email        TEXT        NOT NULL REFERENCES user_profiles(email) ON DELETE CASCADE ON UPDATE CASCADE,
  product      TEXT        NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, product)
);
ALTER TABLE customer_rating_prompts DROP CONSTRAINT IF EXISTS customer_rating_prompts_product_check;
ALTER TABLE customer_rating_prompts ADD CONSTRAINT customer_rating_prompts_product_check CHECK (product IN ('pages', 'seo'));
ALTER TABLE customer_rating_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_rating_prompts FORCE ROW LEVEL SECURITY;
