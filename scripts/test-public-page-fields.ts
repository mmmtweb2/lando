// Run: npx tsx scripts/test-public-page-fields.ts — the public page read hides owner-only fields.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';

(async () => {
  const { publicPageFields } = await import('../src/controllers/landing.controller');
  const row = { id: 'p1', slug: 's', business_name: 'עסק', ai_content: { a: 1 }, owner_email: 'o@x.co', view_count: 9, expires_at: '2027-01-01', draft_reminder_1d_at: null, status: 'published' };
  const pub = publicPageFields({ ...row }, false);
  assert.equal(pub.owner_email, undefined, 'never the owner email');
  assert.equal(pub.view_count, undefined); assert.equal(pub.expires_at, undefined); assert.ok(!('draft_reminder_1d_at' in pub));
  assert.equal(pub.business_name, 'עסק'); assert.deepEqual(pub.ai_content, { a: 1 }); assert.equal(pub.slug, 's');
  const own = publicPageFields({ ...row }, true);
  assert.equal(own.owner_email, undefined, 'not even to the owner (isOwner replaces it)');
  assert.equal(own.view_count, 9); assert.equal(own.expires_at, '2027-01-01');
  console.log('public page fields checks passed');
})().catch(e => { console.error(e); process.exit(1); });
