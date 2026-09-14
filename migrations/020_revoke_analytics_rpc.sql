-- 2026-09-14, pre-launch security audit finding: increment_page_view and
-- increment_page_cta_click (migration 019) are SECURITY DEFINER functions
-- (bypass RLS by design) and were never explicitly REVOKEd from PUBLIC.
-- Postgres grants EXECUTE on new functions to PUBLIC by default, which
-- includes Supabase's `anon` role — and the anon/publishable key is shipped
-- in the client bundle by design. Without this revoke, anyone can call
-- these two RPCs directly against Supabase's PostgREST endpoint with the
-- public anon key, completely bypassing Express's own rate limiting
-- (trackLimiter, 40/min) in src/routes/landing.routes.ts, and inflate or
-- fabricate view/click counts for any published page's analytics.
--
-- Fix: revoke PUBLIC/anon/authenticated execute rights. The Express
-- backend (which is the only intended caller) always uses the service-role
-- key, which is unaffected by these revokes.

REVOKE ALL ON FUNCTION increment_page_view(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION increment_page_cta_click(text) FROM PUBLIC, anon, authenticated;
