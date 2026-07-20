-- ─────────────────────────────────────────────────────────────────────────────
-- 007 — RLS lockdown (run in Supabase SQL editor)
--
-- WHY: the browser holds the *anon* key. Until now the anon key could read/write
-- tables directly (open RLS), which meant anyone could read profiles, credits,
-- and leads, or tamper with pages straight from the browser console.
--
-- After the code changes in this round, the browser NEVER touches these tables
-- directly — every read/write goes through the backend, which uses the
-- SERVICE_ROLE key (service_role BYPASSES RLS). So we can safely deny the anon
-- and authenticated roles on all three tables.
--
-- ⚠️ BEFORE RUNNING: make sure the updated backend is deployed/restarted, because
-- once RLS is locked, any lingering direct-from-browser query will start failing.
-- Test the app (dashboard, wallet, leads, public page view, lead submit) right
-- after applying.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Enable RLS. With RLS enabled and NO permissive policies, the anon and
--    authenticated roles are denied all access; service_role still bypasses.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads         ENABLE ROW LEVEL SECURITY;

-- 2) Force RLS even for the table owner, so nothing sneaks past (service_role
--    still bypasses — it has the BYPASSRLS attribute).
ALTER TABLE public.user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.landing_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.leads         FORCE ROW LEVEL SECURITY;

-- 3) Drop any old permissive policies from earlier experiments (safe if absent).
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('user_profiles', 'landing_pages', 'leads')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect rowsecurity = true for all three, and zero policies remaining.
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename IN ('user_profiles','landing_pages','leads');
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname='public' AND tablename IN ('user_profiles','landing_pages','leads');
