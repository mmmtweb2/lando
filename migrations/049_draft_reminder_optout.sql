-- 049: one-click unsubscribe from the abandoned-draft reminder emails (draft.mailer.ts).
-- seo_email_prefs (migration 036) holds one row per account that changed an email preference;
-- this adds the draft-reminder choice next to the monthly digest. No row = default (on).
-- Security unchanged: RLS ENABLE + FORCE, zero policies (backend service role only). Re-runnable.

ALTER TABLE seo_email_prefs ADD COLUMN IF NOT EXISTS draft_reminders BOOLEAN NOT NULL DEFAULT true;
