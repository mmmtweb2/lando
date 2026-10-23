-- Stage 9.1 — verify against the LIVE database that deleting a parent page whose CHILD page has
-- a lead works when the leads of the tree are removed first (what deleteLeadsForPageTree does).
-- Run in the Supabase SQL editor. Everything happens inside a transaction that ends with
-- ROLLBACK, so nothing is left behind. Expected: all three NOTICE lines say PASS.
BEGIN;

INSERT INTO landing_pages (id, slug, business_name, phone_number, image_source, ai_content, owner_email, status)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'verify-9-1-parent', 'verify parent', '0500000000', 'text_only', '{}'::jsonb, 'verify-9-1@example.com', 'published');
INSERT INTO landing_pages (id, slug, business_name, phone_number, image_source, ai_content, owner_email, status, parent_id, sub_slug)
VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'verify-9-1-child', 'verify parent', '0500000000', 'text_only', '{}'::jsonb, 'verify-9-1@example.com', 'published', 'aaaaaaaa-0000-4000-8000-000000000001', 'child');
INSERT INTO leads (landing_page_id, name, phone) VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'verify lead', '0500000000');
INSERT INTO lead_events (landing_page_id, event_type, source_url) VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'whatsapp', 'smoke-test');

-- 1. Without removing the leads first the foreign key must BLOCK the delete (this is why the helper exists).
DO $$
BEGIN
  BEGIN
    DELETE FROM landing_pages WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
    RAISE NOTICE '1. FAIL: parent delete was NOT blocked by the child''s lead';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE '1. PASS: FK blocks deleting the parent while a child has leads';
  END;
END $$;

-- 2. The helper's order: leads of parent + children first, then the parent.
DELETE FROM leads WHERE landing_page_id IN ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002');
DELETE FROM landing_pages WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM landing_pages WHERE id IN ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002')) THEN
    RAISE NOTICE '2. PASS: parent and child both gone (parent_id ON DELETE CASCADE)';
  ELSE
    RAISE NOTICE '2. FAIL: parent or child still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM lead_events WHERE source_url = 'smoke-test' AND landing_page_id = 'aaaaaaaa-0000-4000-8000-000000000002') THEN
    RAISE NOTICE '3. PASS: the child''s lead_events went with it (ON DELETE CASCADE)';
  ELSE
    RAISE NOTICE '3. FAIL: lead_events row survived';
  END IF;
END $$;

ROLLBACK;
