// Run: npx tsx scripts/test-premium-status.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { getPremiumStatus } from '../src/services/premiumStatus.service';
import { getPremium } from '../src/controllers/premiumStatus.controller';

type Reply = { data: unknown; error: { message: string } | null };
let selected = ''; let reply: (cols: string) => Reply = () => ({ data: null, error: null });
(supabase as unknown as { from: unknown }).from = () => ({
  select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => { selected = cols; return reply(cols); } }) }),
});
const res = () => { const r: { code: number; body: unknown; status(c: number): typeof r; json(b: unknown): typeof r } = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

(async () => {
  reply = () => ({ data: { status: 'active', expected_by: '2026-11-12' }, error: null });
  assert.deepEqual(await getPremiumStatus('a@x.co'), { premium: true, expectedBy: '2026-11-12' });

  reply = () => ({ data: { status: 'active', expected_by: null }, error: null });
  assert.deepEqual(await getPremiumStatus('a@x.co'), { premium: true, expectedBy: null });

  for (const status of ['paused', 'ended']) { reply = () => ({ data: { status, expected_by: '2026-11-12' }, error: null }); assert.deepEqual(await getPremiumStatus('a@x.co'), { premium: false, expectedBy: null }, status); }
  reply = () => ({ data: null, error: null });
  assert.deepEqual(await getPremiumStatus('a@x.co'), { premium: false, expectedBy: null }, 'no row');
  reply = () => ({ data: { status: 'active', expected_by: 'garbage' }, error: null });
  assert.equal((await getPremiumStatus('a@x.co')).expectedBy, null, 'not a date: dropped');

  // before migration 045: the column is missing, status still works
  reply = (cols) => (cols.includes('expected_by') ? { data: null, error: { message: 'column seo_manual_premium.expected_by does not exist' } } : { data: { status: 'active' }, error: null });
  assert.deepEqual(await getPremiumStatus('a@x.co'), { premium: true, expectedBy: null });
  assert.equal(selected, 'status');

  // table missing or any other error: simply "not premium"
  reply = () => ({ data: null, error: { message: 'relation does not exist' } });
  assert.deepEqual(await getPremiumStatus('a@x.co'), { premium: false, expectedBy: null });

  // controller: needs a login, answers only about the caller
  let r = res(); await getPremium({ authEmail: undefined } as never, r as never); assert.equal(r.code, 401);
  reply = () => ({ data: { status: 'active', expected_by: '2026-11-12' }, error: null });
  r = res(); await getPremium({ authEmail: 'a@x.co' } as never, r as never);
  assert.deepEqual(r.body, { premium: true, expectedBy: '2026-11-12' });
  reply = () => { throw new Error('db down'); };
  r = res(); await getPremium({ authEmail: 'a@x.co' } as never, r as never);
  assert.deepEqual(r.body, { premium: false, expectedBy: null }, 'a failure never blocks the dashboard');

  console.log('premium status checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
