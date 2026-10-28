// Run: npx ts-node --transpile-only scripts/test-seo-setup.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { getSetup, putSetup } from '../src/controllers/seoSetup.controller';
import { SETUP_KEYS, isSetupKey } from '../src/services/seoSetup.service';

type Row = Record<string, any>;
const db: Row[] = [];
let missingTable = false;
(supabase as any).from = (table: string) => {
  assert.equal(table, 'seo_setup_steps');
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {};
  const run = (): any => {
    if (missingTable) return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    if (op === 'upsert') {
      const ex = db.find((r) => r.email === patch.email && r.step_key === patch.step_key);
      if (ex) Object.assign(ex, patch); else db.push({ ...patch });
      return { data: null, error: null };
    }
    if (op === 'delete') { for (let i = db.length - 1; i >= 0; i--) if (f.every((fn) => fn(db[i]))) db.splice(i, 1); return { data: null, error: null }; }
    return { data: db.filter((r) => f.every((fn) => fn(r))), error: null };
  };
  const q: any = {
    select: () => q,
    upsert: (p: Row) => { op = 'upsert'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    then: (ok: any) => ok(run()),
  };
  return q;
};
const res = () => { const r: any = { code: 200, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const req = (email: string | undefined, key?: string, body?: any): any => ({ authEmail: email, params: { key }, body });

(async () => {
  // validation
  assert.ok(SETUP_KEYS.every(isSetupKey));
  assert.equal(isSetupKey('drop table'), false);
  assert.equal(isSetupKey(undefined), false);

  // requires a signed-in account
  let r = res(); await getSetup(req(undefined), r); assert.equal(r.code, 401);
  r = res(); await putSetup(req(undefined, 'first_check', { done: true }), r); assert.equal(r.code, 401);

  // tick, list, untick; accounts are separate
  r = res(); await putSetup(req('a@x.co', 'first_check', { done: true }), r); assert.equal(r.code, 200);
  r = res(); await putSetup(req('a@x.co', 'first_check', { done: true }), r); assert.equal(r.code, 200, 'ticking twice is fine');
  r = res(); await putSetup(req('a@x.co', 'profile_verified', { done: true }), r);
  r = res(); await putSetup(req('b@x.co', 'tracking_ready', { done: true }), r);
  r = res(); await getSetup(req('a@x.co'), r);
  assert.deepEqual([...r.body.steps].sort(), ['first_check', 'profile_verified']);
  assert.equal(db.filter((x) => x.email === 'a@x.co' && x.step_key === 'first_check').length, 1, 'no duplicates');
  r = res(); await putSetup(req('a@x.co', 'first_check', { done: false }), r);
  r = res(); await getSetup(req('a@x.co'), r);
  assert.deepEqual(r.body.steps, ['profile_verified']);
  r = res(); await getSetup(req('b@x.co'), r);
  assert.deepEqual(r.body.steps, ['tracking_ready'], "another account's ticks are untouched");

  // bad input
  r = res(); await putSetup(req('a@x.co', 'nope', { done: true }), r); assert.equal(r.code, 400);
  r = res(); await putSetup(req('a@x.co', 'first_check', { done: 'yes' }), r); assert.equal(r.code, 400);
  r = res(); await putSetup(req('a@x.co', 'first_check', undefined), r); assert.equal(r.code, 400);

  // before migration 032 runs: a clear 503, nothing crashes
  missingTable = true;
  r = res(); await getSetup(req('a@x.co'), r); assert.equal(r.code, 503); assert.equal(r.body.code, 'setup_not_migrated');
  r = res(); await putSetup(req('a@x.co', 'first_check', { done: true }), r); assert.equal(r.code, 503);

  console.log('seo setup checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
