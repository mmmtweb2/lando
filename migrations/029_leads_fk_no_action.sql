-- Migration: 029_leads_fk_no_action
-- Description: restore the safety net on leads -> landing_pages.
--
-- Found on 2026-10-25 (scripts/verify-9-1.sql, check 1): the LIVE database has
--   leads_landing_page_id_fkey ... ON DELETE CASCADE
-- while migrations 006/013 define and assume NO ACTION. With CASCADE, deleting a landing page
-- (one click in the dashboard) silently destroys that page's whole lead history.
--
-- Every delete path in the application already removes the leads EXPLICITLY first
-- (landing.controller deletePage, user.controller account delete, renewal.service hard delete,
-- draftCleanup.service, pageTree.service.deleteLeadsForPageTree), so restoring NO ACTION breaks
-- none of them; it only turns an accidental delete that skipped that step into an error
-- instead of silent data loss.
--
-- lead_events keeps ON DELETE CASCADE (click counters, not customer data).
-- Idempotent and safe to re-run.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_landing_page_id_fkey;
ALTER TABLE leads
  ADD CONSTRAINT leads_landing_page_id_fkey
  FOREIGN KEY (landing_page_id) REFERENCES landing_pages(id);
