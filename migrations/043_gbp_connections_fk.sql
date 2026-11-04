-- 043: gbp_connections.email -> user_profiles.email ON DELETE CASCADE.
--
-- Why: a customer's encrypted Google refresh token (gbp_connections) must not outlive the account.
-- Account deletion now revokes the token and deletes the row explicitly (user.controller.ts), and
-- this foreign key is the database-level backstop: deleting a user_profiles row (admin tools, SQL,
-- any future code path) removes the connection with it.
--
-- Safe + re-runnable:
--   * skipped (with a NOTICE) if either table is missing, so a database without migrations 006/033
--     is not broken by running this;
--   * added as NOT VALID, which enforces the rule for every NEW or UPDATED row without scanning or
--     rejecting rows that already exist — orphans (a connection whose account was deleted before
--     this migration) are SKIPPED, never deleted and never an error;
--   * VALIDATE CONSTRAINT runs only when there are no orphans, so it cannot fail either;
--   * a second run does nothing (the constraint is looked up by name first).
--
-- To inspect / clean up the skipped orphans afterwards (each is an encrypted token of an account that
-- no longer exists, so deleting the row is the right outcome), then re-run this migration so the
-- constraint gets validated:
--   SELECT email, connected_at FROM gbp_connections g
--   WHERE NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.email = g.email);
--   DELETE FROM gbp_connections g WHERE NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.email = g.email);

DO $$
DECLARE
  orphans bigint;
  validated boolean;
BEGIN
  IF to_regclass('public.gbp_connections') IS NULL OR to_regclass('public.user_profiles') IS NULL THEN
    RAISE NOTICE '043: gbp_connections or user_profiles is missing - nothing to do';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gbp_connections_email_fkey' AND conrelid = 'public.gbp_connections'::regclass
  ) THEN
    ALTER TABLE public.gbp_connections
      ADD CONSTRAINT gbp_connections_email_fkey
      FOREIGN KEY (email) REFERENCES public.user_profiles (email)
      ON DELETE CASCADE ON UPDATE CASCADE
      NOT VALID;
  END IF;

  SELECT count(*) INTO orphans
  FROM public.gbp_connections g
  WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.email = g.email);

  SELECT convalidated INTO validated
  FROM pg_constraint
  WHERE conname = 'gbp_connections_email_fkey' AND conrelid = 'public.gbp_connections'::regclass;

  IF orphans > 0 THEN
    RAISE NOTICE '043: % orphan gbp_connections row(s) skipped; constraint stays NOT VALID (enforced for new rows only)', orphans;
  ELSIF NOT validated THEN
    ALTER TABLE public.gbp_connections VALIDATE CONSTRAINT gbp_connections_email_fkey;
  END IF;
END $$;
