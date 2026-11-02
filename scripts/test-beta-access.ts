// Run: npx ts-node --transpile-only scripts/test-beta-access.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { adminGrant, adminListGrants, adminRevoke } from '../src/controllers/betaAccess.controller';
import { normDays, normEmail } from '../src/services/betaAccess.service';

type Row = Record<string, any>;
const profiles: Row[] = [{ email: 'a@x.co' }, { email: 'pay@x.co' }, { email: 'b@x.co' }];
const products: Row[] = [{ email: 'pay@x.co', product: 'seo_autopilot', status: 'active', source: 'sumit', current_period_end: new Date(Date.now() + 10 * 864e5).toISOString(), started_at: '2026-10-01T00:00:00Z' }];
(supabase as any).from = (table: string) => {
  const t = table === 'user_profiles' ? profiles : products;
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {};
  const run = (single: boolean): any => {
    if (op === 'upsert') { const ex = t.find((r) => r.email === patch.email && r.product === patch.product); if (ex) Object.assign(ex, patch); else t.push({ started_at: new Date().toISOString(), ...patch }); return { data: null, error: null }; }
    if (op === 'update') { t.filter((r) => f.every((fn) => fn(r))).forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    const rows = t.filter((r) => f.every((fn) => fn(r)));
    return { data: single ? rows[0] ?? null : rows, error: null };
  };
  const q: any = {
    select: () => q, order: () => q, limit: () => q,
    upsert: (p: Row) => { op = 'upsert'; patch = p; return q; },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    maybeSingle: () => Promise.resolve(run(true)),
    then: (ok: any) => ok(run(false)),
  };
  return q;
};
const res = () => { const r: any = { code: 200, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const req = (body?: any): any => ({ body });

(async () => {
  assert.equal(normEmail('  A@X.co '), 'a@x.co');
  assert.throws(() => normEmail('nope'));
  assert.throws(() => normEmail(5));
  assert.equal(normDays(undefined), null); assert.equal(normDays(''), null); assert.equal(normDays('60'), 60);
  assert.throws(() => normDays(0)); assert.throws(() => normDays(1.5)); assert.throws(() => normDays(99999));

  let r = res(); await adminGrant(req({ email: 'bad', days: 30 }), r); assert.equal(r.code, 400);
  r = res(); await adminGrant(req({ email: 'a@x.co', days: 0 }), r); assert.equal(r.code, 400);
  r = res(); await adminGrant(req({ email: 'ghost@x.co', days: 30 }), r); assert.equal(r.code, 404, 'must have registered first');
  r = res(); await adminGrant(req({ email: 'pay@x.co', days: 30 }), r); assert.equal(r.code, 409, 'paying subscriber untouched');
  assert.equal(products.find((p) => p.email === 'pay@x.co')!.source, 'sumit');

  r = res(); await adminGrant(req({ email: 'A@x.co', days: 60 }), r); assert.equal(r.code, 200);
  const a = products.find((p) => p.email === 'a@x.co')!;
  assert.equal(a.source, 'manual'); assert.equal(a.status, 'active');
  const days = (new Date(a.current_period_end).getTime() - Date.now()) / 864e5;
  assert.ok(days > 59.9 && days < 60.1);
  r = res(); await adminGrant(req({ email: 'b@x.co' }), r); assert.equal(r.code, 200);
  assert.equal(products.find((p) => p.email === 'b@x.co')!.current_period_end, null, 'no end date');
  r = res(); await adminGrant(req({ email: 'a@x.co', days: 5 }), r); assert.equal(r.code, 200);
  assert.equal(products.filter((p) => p.email === 'a@x.co').length, 1, 're-grant updates, no duplicate');

  r = res(); await adminListGrants(req(), r);
  assert.equal(r.body.grants.length, 3);
  assert.equal(r.body.grants.find((g: any) => g.email === 'a@x.co').active, true);

  r = res(); await adminRevoke(req({ email: 'pay@x.co' }), r); assert.equal(r.code, 409);
  r = res(); await adminRevoke(req({ email: 'a@x.co' }), r); assert.equal(r.code, 200);
  r = res(); await adminListGrants(req(), r);
  assert.equal(r.body.grants.find((g: any) => g.email === 'a@x.co').active, false, 'revoked grant is inactive');
  r = res(); await adminRevoke(req({ email: 'nobody@x.co' }), r); assert.equal(r.code, 200, 'revoking nothing is fine');

  console.log('beta access checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
