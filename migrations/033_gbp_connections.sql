-- 033: Google Business Profile connection of a customer (Stage 6.3).
--
-- One row per account. The refresh token is stored ENCRYPTED (AES-256-GCM, key =
-- GBP_TOKEN_ENCRYPTION_KEY) and is never returned by any API. No Business Profile metrics are
-- stored: they are fetched live when the customer opens the dashboard.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.

CREATE TABLE IF NOT EXISTS gbp_connections (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT        NOT NULL UNIQUE,
  refresh_token_enc  TEXT        NOT NULL,
  scope              TEXT,
  location_name      TEXT,
  status             TEXT        NOT NULL DEFAULT 'active',
  last_error         TEXT,
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE gbp_connections DROP CONSTRAINT IF EXISTS gbp_connections_status_check;
ALTER TABLE gbp_connections ADD CONSTRAINT gbp_connections_status_check CHECK (status IN ('active', 'needs_reconnect'));
ALTER TABLE gbp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_connections FORCE ROW LEVEL SECURITY;
