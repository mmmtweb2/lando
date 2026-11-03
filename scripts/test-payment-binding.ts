// Run: npx ts-node --transpile-only scripts/test-payment-binding.ts
// One-time SUMIT payments: a verified payment must be BOUND to the checkout it was opened for
// (ExternalIdentifier = payments.id), one PaymentID settles one thing across products, and the
// DB-level claim of migration 044 (emulated here) is handled cleanly.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'fake';
process.env.SUMIT_COMPANY_ID = '1';
process.env.SUMIT_API_KEY = 'k';
process.env.PUBLIC_APP_URL = 'https://app.test';
import assert from 'node:assert/strict';
/* eslint-disable @typescript-eslint/no-var-requires */
const { supabase } = require('../src/config/supabase') as typeof import('../src/config/supabase');
const credits = require('../src/services/credits.service') as typeof import('../src/services/credits.service');
const { paymentReturn, reverifyPayment } = require('../src/controllers/payment.controller') as typeof import('../src/controllers/payment.controller');
const { evaluateBinding, extractExternalIdentifiers } = require('../src/services/paymentBinding') as typeof import('../src/services/paymentBinding');

type Row = Record<string, any>;
const db: Record<string, Row[]> = { payments: [], seo_subscription_events: [] };
const claims = new Map<string, string>();      // emulated sumit_payment_claims: id -> "table:rowid"
let granted = 0;
(credits as any).addCredits = async () => { granted++; return 10; };

(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {};
  const rows = () => (db[table] ?? []).filter((r) => f.every((fn) => fn(r)));
  const run = (): any => {
    if (op === 'update') {
      const hit = rows();
      for (const r of hit) {
        const next = { ...r, ...patch };
        // emulated migration 044 trigger on payments
        if (table === 'payments' && next.sumit_payment_id && ['paid', 'processing'].includes(next.status)) {
          const owner = claims.get(next.sumit_payment_id);
          if (owner && owner !== `payments:${r.id}`) return { data: null, error: { code: '23505', message: 'SUMIT payment id already settled another payment or subscription' } };
          claims.set(next.sumit_payment_id, `payments:${r.id}`);
        }
        Object.assign(r, patch);
      }
      return { data: hit, error: null };
    }
    return { data: rows(), error: null };
  };
  const q: any = {
    select: () => q, limit: () => q, update: (p: Row) => { op = 'update'; patch = p; return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { f.push((r) => r[k] !== v); return q; },
    in: (k: string, vs: unknown[]) => { f.push((r) => vs.includes(r[k])); return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
  };
  return q;
};

// ── fake SUMIT ──
const sumit: Record<string, { valid: boolean; amount: number; data?: Row }> = {};
(globalThis as any).fetch = async (url: string, init: any) => {
  const body = JSON.parse(init.body);
  const p = sumit[String(body.PaymentID)];
  return { json: async () => (p ? { Status: 0, Data: { Payment: { ValidPayment: p.valid, Amount: p.amount, Status: '000', ...(p.data ?? {}) } } } : { Status: 1, UserErrorMessage: 'not found' }) };
};

const res = () => { const r: any = { code: 200, body: null, redirected: '' }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.redirect = (u: string) => { r.redirected = u; return r; }; return r; };
let n = 0;
const newPay = (amount = 49): Row => { const row = { id: `pay-${++n}`, user_email: 'o@x.co', purpose: 'credits', reference: 'small', amount, status: 'pending', sumit_payment_id: null }; db.payments.push(row); return row; };
const ret = async (ref: string, sumitId?: string) => { const r = res(); await paymentReturn({ query: { ref, ...(sumitId ? { 'OG-PaymentID': sumitId } : {}) } } as any, r); return r.redirected.split('payment=')[1]; };
const quiet = () => { const e = console.error, l = console.log, w = console.warn; console.error = console.log = console.warn = () => undefined; return () => { console.error = e; console.log = l; console.warn = w; }; };

(async () => {
  // ── pure ──
  assert.deepEqual(extractExternalIdentifiers({ Payment: { ExternalIdentifier: 'a', Customer: { ExternalIdentifier: ' b ', ID: 3 } }, Other: [{ ExternalIdentifier: 'x' }] }), ['a', 'b', 'x'], 'nested objects and arrays are searched');
  assert.deepEqual(extractExternalIdentifiers({ Payment: { ExternalIdentifier: '' } }), [], 'empty identifiers do not count');
  assert.deepEqual(extractExternalIdentifiers({ a: { b: { c: { d: { ExternalIdentifier: 'too-deep' } } } } }), []);
  assert.deepEqual(extractExternalIdentifiers({ external_identifier: 77 }), ['77'], 'tolerant key spelling, numbers allowed');
  assert.equal(evaluateBinding(['A'], 'a', false).ok, true);
  { const m = evaluateBinding(['b'], 'a', false); assert.equal(m.ok, false); assert.equal(!m.ok && m.state, 'mismatch'); }
  assert.deepEqual(evaluateBinding([], 'a', false), { ok: true, state: 'unverifiable' });
  assert.equal(evaluateBinding([], 'a', true).ok, false);
  assert.equal(evaluateBinding(['b', 'a'], 'a', true).ok, true, 'any match among several identifiers (payment-level OR customer-level)');

  // ── A. happy path, bound ──
  let p1 = newPay(); sumit['1001'] = { valid: true, amount: 49, data: { ExternalIdentifier: p1.id } };
  let done = quiet(); assert.equal(await ret(p1.id, '1001'), 'success'); done();
  assert.equal(p1.status, 'paid'); assert.equal(granted, 1);

  // ── B. replay of a consumed PaymentID against another pending row ──
  let p2 = newPay(); done = quiet(); assert.equal(await ret(p2.id, '1001'), 'review'); done();
  assert.notEqual(p2.status, 'paid'); assert.equal(granted, 1, 'nothing granted for the replay');

  // ── C. a valid payment that belongs to ANOTHER checkout (the audited gap) ──
  let p3 = newPay(); sumit['2002'] = { valid: true, amount: 500, data: { ExternalIdentifier: 'someone-elses-checkout' } };
  done = quiet(); assert.equal(await ret(p3.id, '2002'), 'review'); done();
  assert.equal(p3.status, 'needs_review'); assert.equal(granted, 1);
  // same payment, but the identifier sits on the SUMIT customer (nested) and is ours -> accepted
  let p3b = newPay(); sumit['2003'] = { valid: true, amount: 49, data: { Customer: { ExternalIdentifier: p3b.id.toUpperCase() } } };
  done = quiet(); assert.equal(await ret(p3b.id, '2003'), 'success'); done(); assert.equal(granted, 2);

  // ── D. SUMIT returns no identifier: default accepts (warned), strict refuses ──
  let p4 = newPay(); sumit['3003'] = { valid: true, amount: 49 };
  process.env.SUMIT_REQUIRE_BINDING = 'true';
  done = quiet(); assert.equal(await ret(p4.id, '3003'), 'review'); done(); assert.equal(p4.status, 'needs_review'); assert.equal(granted, 2);
  delete process.env.SUMIT_REQUIRE_BINDING;
  let p5 = newPay(); sumit['3004'] = { valid: true, amount: 49 };
  done = quiet(); assert.equal(await ret(p5.id, '3004'), 'success'); done(); assert.equal(granted, 3);

  // ── E. cross-product: an id that already activated a SUBSCRIPTION cannot settle a one-time payment ──
  db.seo_subscription_events.push({ id: 'ev1', subscription_id: 's1', kind: 'charge_ok', sumit_payment_id: '4004' });
  let p6 = newPay(); sumit['4004'] = { valid: true, amount: 49, data: { ExternalIdentifier: p6.id } };
  done = quiet(); assert.equal(await ret(p6.id, '4004'), 'review'); done(); assert.equal(granted, 3);

  // ── F. DB-level claim (migration 044) catches what the app-level checks cannot see (a race) ──
  claims.set('5005', 'seo_subscription_events:evX');
  let p7 = newPay(); sumit['5005'] = { valid: true, amount: 49, data: { ExternalIdentifier: p7.id } };
  done = quiet(); assert.equal(await ret(p7.id, '5005'), 'review'); done();
  assert.notEqual(p7.status, 'paid'); assert.equal(granted, 3, 'unique violation -> not granted, clean redirect');

  // ── G. admin re-verify is bound too; force-activate remains the manual escape hatch ──
  let p8 = newPay(); p8.status = 'needs_review'; p8.sumit_payment_id = '6006'; sumit['6006'] = { valid: true, amount: 49, data: { ExternalIdentifier: 'other' } };
  let rr = res(); done = quiet(); await reverifyPayment({ params: { id: p8.id } } as any, rr); done();
  assert.equal(rr.code, 409); assert.match(rr.body.error, /not bound/); assert.equal(p8.status, 'needs_review'); assert.equal(granted, 3);
  sumit['6006'].data = { ExternalIdentifier: p8.id };
  rr = res(); done = quiet(); await reverifyPayment({ params: { id: p8.id } } as any, rr); done();
  assert.equal(rr.body.status, 'paid'); assert.equal(granted, 4);

  // ── H. amount rules unchanged ──
  let p9 = newPay(); sumit['7007'] = { valid: true, amount: 10, data: { ExternalIdentifier: p9.id } };
  done = quiet(); assert.equal(await ret(p9.id, '7007'), 'review'); done(); assert.equal(granted, 4);
  let p10 = newPay(); sumit['8008'] = { valid: false, amount: 49, data: { ExternalIdentifier: p10.id } };
  done = quiet(); assert.equal(await ret(p10.id, '8008'), 'review'); done();
  done = quiet(); assert.equal(await ret(p10.id), 'review'); done();

  // ── I. both /return endpoints are rate limited per IP (30 / 10 min) ──
  {
    const http = require('node:http') as typeof import('node:http');
    const app = (require('../src/app') as typeof import('../src/app')).default;
    const server = app.listen(0); const port = (server.address() as import('node:net').AddressInfo).port;
    const hit = (path: string) => new Promise<number>((resolve, reject) => { http.get({ port, host: '127.0.0.1', path }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode ?? 0)); }).on('error', reject); });
    try {
      for (const path of ['/api/payments/return', '/api/seo/subscription/return']) {
        const codes: number[] = [];
        for (let i = 0; i < 33; i++) codes.push(await hit(path));
        assert.ok(codes.slice(0, 20).every((c) => c === 302), `${path}: first requests pass (${codes.slice(0, 3)})`);
        assert.equal(codes[codes.length - 1], 429, `${path}: limited after the window budget`);
      }
    } finally { server.close(); }
  }

  console.log('payment binding checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
