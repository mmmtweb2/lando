// The landing page included in a "with page" promotion plan (task #30).
// Run: npx tsx scripts/test-seo-page-addon.ts
import './_env-seo-subscription';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { publishIncludedPage } from '../src/controllers/landing.controller';
import { cancel, start, subscriptionReturn, getStatus } from '../src/controllers/seoSubscription.controller';
import { sweepSubscriptions } from '../src/services/seoSubscription.service';
import { addonPageIds, canUseAddon, reconcileAddonPage } from '../src/services/seoPageAddon.service';
import { checkRenewEligibility } from '../src/services/renewal.service';

type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  seo_subscriptions: [], seo_subscription_events: [], user_products: [], journey_events: [], payments: [],
  seo_addon_pages: [], landing_pages: [],
};
const UNIQUE: Record<string, string[]> = { seo_subscriptions: ['email'], seo_subscription_events: ['sumit_payment_id'], seo_addon_pages: ['email', 'page_id'] };
let seq = 0;
(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let onConflict: string[] = [];
  if (!db[table]) db[table] = [];
  const rows = () => db[table].filter(r => f.every(fn => fn(r)));
  const run = (): any => {
    if (op === 'insert') {
      for (const col of UNIQUE[table] ?? []) {
        if (patch[col] != null && db[table].some(r => r[col] === patch[col])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, ...patch };
      db[table].push(row); return { data: [row], error: null };
    }
    if (op === 'upsert') {
      const ex = db[table].find(r => onConflict.every(c => r[c] === patch[c]));
      if (ex) Object.assign(ex, patch); else db[table].push({ ...patch });
      return { data: null, error: null };
    }
    if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, patch)); return { data: hit, error: null }; }
    if (op === 'delete') { const hit = rows(); db[table] = db[table].filter(r => !hit.includes(r)); return { data: null, error: null }; }
    return { data: rows(), error: null };
  };
  const q: any = {
    select: () => q, limit: () => q, order: () => q,
    insert: (p: Row) => { op = 'insert'; patch = p; return q; },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    upsert: (p: Row, o: { onConflict: string }) => { op = 'upsert'; patch = p; onConflict = o.onConflict.split(','); return q; },
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
    in: (k: string, vs: unknown[]) => { f.push(r => vs.includes(r[k])); return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any) => ok(run()),
  };
  return q;
};

const payments: Record<string, { valid: boolean; amount: number; ext?: unknown }> = {};
(globalThis as any).fetch = async (url: string, init: any) => {
  const path = new URL(url).pathname;
  const body = JSON.parse(init.body);
  const json = (o: unknown) => ({ json: async () => o });
  if (path === '/billing/payments/beginredirect/') return json({ Status: 0, Data: { RedirectURL: 'https://pay.sumit/x' } });
  if (path === '/billing/payments/get/') {
    const p = payments[String(body.PaymentID)];
    return p ? json({ Status: 0, Data: { Payment: { ValidPayment: p.valid, Amount: p.amount, Status: '000', ExternalIdentifier: p.ext } } }) : json({ Status: 1 });
  }
  if (path === '/billing/recurring/cancel/') return json({ Status: 0 });
  throw new Error('unexpected SUMIT call ' + path);
};
function res() {
  const r: any = { code: 200, body: undefined, redirected: '' };
  r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; };
  r.redirect = (u: string) => { r.redirected = u; return r; };
  return r;
}
const E = 'owner@x.co';
const req = (extra: Row = {}) => ({ authEmail: E, query: {}, body: {}, ...extra }) as any;
const page = (id: string, status = 'draft', owner = E) => { db.landing_pages.push({ id, owner_email: owner, status, parent_id: null, business_name: 'עסק', expires_at: null, frozen_at: null }); return db.landing_pages[db.landing_pages.length - 1]; };
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222';

(async () => {
  process.env.SEO_SUBSCRIPTION_ENABLED = 'true';

  // 1. no subscription / plan without a page -> the included-page path does not apply
  page(P1); page(P2);
  assert.equal(await publishIncludedPage(E, P1), null, 'no subscription');
  let r: any = res(); await start(req({ body: { plan: 'monthly' } }), r);
  const sub = db.seo_subscriptions[0];
  payments['1'] = { valid: true, amount: 250, ext: sub.id };
  await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '1' } } as any, res());
  assert.equal(sub.status, 'active');
  assert.equal(await publishIncludedPage(E, P1), null, 'plan without a page');

  // 2. switch to a plan with a page, pay -> the first page is published without a credit
  sub.status = 'canceled'; sub.current_period_end = null;
  r = res(); await start(req({ body: { plan: 'monthly_page' } }), r);
  assert.equal(sub.with_page, true); assert.equal(sub.amount, 265);
  payments['2'] = { valid: true, amount: 265, ext: sub.id };
  await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '2' } } as any, res());
  assert.equal(sub.status, 'active');
  const pub = await publishIncludedPage(E, P1);
  assert.ok(pub, 'published through the subscription');
  const p1 = db.landing_pages.find(x => x.id === P1)!;
  assert.equal(p1.status, 'published');
  assert.equal(p1.expires_at, sub.current_period_end, 'lives as long as the paid period');
  assert.equal(db.seo_addon_pages.length, 1);
  assert.ok((await addonPageIds()).has(P1));

  // 3. one page only: a second page is not included
  assert.equal(await canUseAddon(E, P2, { active: true, periodEnd: sub.current_period_end }), false);
  assert.equal(await publishIncludedPage(E, P2), null);
  assert.equal(db.landing_pages.find(x => x.id === P2)!.status, 'draft');
  // somebody else's page is never published by this account's subscription
  const foreign = '33333333-3333-4333-8333-333333333333'; page(foreign, 'draft', 'other@x.co');
  db.seo_addon_pages.length = 0;
  assert.equal(await publishIncludedPage(E, foreign), null);
  db.seo_addon_pages.push({ email: E, page_id: P1, subscription_id: sub.id });

  // 4. renewing the subscription extends the page; the page is not sold a 99 renewal
  const before = sub.current_period_end;
  payments['3'] = { valid: true, amount: 265, ext: sub.id };
  await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '3' } } as any, res());
  assert.notEqual(sub.current_period_end, before);
  assert.equal(p1.expires_at, sub.current_period_end);
  const el = await checkRenewEligibility(E, P1);
  assert.equal(el.ok, false); assert.equal(el.reason, 'managed_by_subscription');

  // 5. status shows the page
  r = res(); await getStatus(req(), r);
  assert.deepEqual(r.body.subscription.page, { included: true, pageId: P1, status: 'published' });

  // 6. the subscription ends -> the page is FROZEN (not deleted); content stays
  sub.cancel_at_period_end = true;
  sub.current_period_end = new Date(Date.now() - 86400000).toISOString();
  await sweepSubscriptions(new Date(), async () => true);
  assert.equal(sub.status, 'canceled');
  assert.equal(p1.status, 'frozen'); assert.ok(p1.frozen_at);
  assert.equal(db.landing_pages.length, 3, 'nothing deleted');
  assert.equal(await publishIncludedPage(E, P1), null, 'frozen pages come back through the subscription, not the publish path');

  // 7. buying a plan with a page again brings it back
  r = res(); await start(req({ body: { plan: 'annual_page' } }), r);
  payments['4'] = { valid: true, amount: 2650, ext: sub.id };
  await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '4' } } as any, res());
  assert.equal(sub.status, 'active');
  assert.equal(p1.status, 'published'); assert.equal(p1.frozen_at, null);
  assert.equal(p1.expires_at, sub.current_period_end);

  // 8. a plan WITHOUT a page freezes it too (the add-on is gone) and a past_due account keeps it through the grace
  sub.with_page = false;
  await sweepSubscriptions(new Date(), async () => true);
  assert.equal(p1.status, 'frozen');
  sub.with_page = true; sub.status = 'past_due'; sub.cycle = 'month'; sub.plan_id = 'monthly_page';
  sub.current_period_end = new Date(Date.now() - 2 * 86400000).toISOString();
  await sweepSubscriptions(new Date(), async () => true);
  assert.equal(p1.status, 'published', 'inside the grace window the page stays up');
  sub.current_period_end = new Date(Date.now() - 9 * 86400000).toISOString();
  await sweepSubscriptions(new Date(), async () => true);
  assert.equal(sub.status, 'canceled'); assert.equal(p1.status, 'frozen');

  // 9. a deleted included page frees the slot
  db.landing_pages.splice(db.landing_pages.findIndex(x => x.id === P1), 1);
  assert.equal(await canUseAddon(E, P2, { active: true, periodEnd: null }), true);
  assert.equal(await reconcileAddonPage(E, { active: true, periodEnd: null }), 'none');

  // 10. before migration 047: nothing breaks
  const real = (supabase as any).from;
  (supabase as any).from = (t: string) => t === 'seo_addon_pages'
    ? { select: () => ({ limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "seo_addon_pages" does not exist' } }), eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'x' } }) }) }) }
    : real(t);
  assert.equal((await addonPageIds()).size, 0);
  assert.equal(await reconcileAddonPage(E, { active: false, periodEnd: null }), 'none');
  (supabase as any).from = real;

  console.log('seo page add-on checks passed');
})().catch(e => { console.error(e); process.exit(1); });
