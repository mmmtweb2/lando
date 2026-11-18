// The 14-day refund of the Google-promotion subscription and the "do not renew" choice on a page
// (decisions of 17.11.2026, migration 051).
// Run: npx tsx scripts/test-seo-refund.ts
import './_env-seo-subscription';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { REFUND_WINDOW_DAYS, refundOffer, ChargeEvent } from '../src/services/seoRefund';
import { cancel, getStatus } from '../src/controllers/seoSubscription.controller';
import { cancelSubscription, listRefundRequests, markRefundRequest } from '../src/services/seoSubscription.service';
import { adminListRefunds, adminMarkRefund } from '../src/controllers/adminSeo.controller';
import { setRefundMailer, adminRefundMail, customerRefundMail } from '../src/services/refundMail';
import { runRenewalSweep, setRenewalOptOut } from '../src/services/renewal.service';
import adminRouter from '../src/routes/admin.routes';
import landingRouter from '../src/routes/landing.routes';

type Row = Record<string, any>;
const DAY = 86_400_000;
const db: Record<string, Row[]> = {
  seo_subscriptions: [], seo_subscription_events: [], seo_refund_requests: [], user_products: [], journey_events: [],
  payments: [], seo_addon_pages: [], landing_pages: [],
};
const UNIQUE: Record<string, string[]> = { seo_subscriptions: ['email'], seo_refund_requests: ['email'], seo_subscription_events: ['sumit_payment_id'] };
let seq = 0;
let refundTableMissing = false;
let failSubUpdate = false;
(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let onConflict: string[] = [];
  if (!db[table]) db[table] = [];
  const rows = () => db[table].filter(r => f.every(fn => fn(r)));
  const run = (): any => {
    if (refundTableMissing && table === 'seo_refund_requests') return { data: null, error: { code: '42P01', message: 'relation "seo_refund_requests" does not exist' } };
    if (op === 'insert') {
      for (const col of UNIQUE[table] ?? []) {
        if (patch[col] != null && db[table].some(r => r[col] === patch[col])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), ...(table === 'seo_refund_requests' ? { status: 'pending', handled_at: null, note: null } : {}), ...patch };
      db[table].push(row); return { data: [row], error: null };
    }
    if (op === 'upsert') {
      const ex = db[table].find(r => onConflict.every(c => r[c] === patch[c]));
      if (ex) Object.assign(ex, patch); else db[table].push({ ...patch });
      return { data: null, error: null };
    }
    if (op === 'update' && failSubUpdate && table === 'seo_subscriptions') return { data: null, error: { code: 'XX000', message: 'db down' } };
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
    neq: (k: string, v: unknown) => { f.push(r => r[k] !== v); return q; },
    in: (k: string, vs: unknown[]) => { f.push(r => vs.includes(r[k])); return q; },
    is: (k: string, v: unknown) => { f.push(r => (r[k] ?? null) === v); return q; },
    not: (k: string, _o: string, v: unknown) => { f.push(r => (r[k] ?? null) !== v); return q; },
    lte: (k: string, v: string) => { f.push(r => r[k] != null && r[k] <= v); return q; },
    lt: (k: string, v: string) => { f.push(r => r[k] != null && r[k] < v); return q; },
    gte: (k: string, v: string) => { f.push(r => r[k] != null && r[k] >= v); return q; },
    gt: (k: string, v: string) => { f.push(r => r[k] != null && r[k] > v); return q; },
    like: (k: string, pat: string) => { f.push(r => String(r[k] ?? '').startsWith(pat.replace(/%$/, ''))); return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any) => ok(run()),
  };
  return q;
};

// ── fake SUMIT: only the standing-order stop is expected ──
const sumitCalls: Array<{ path: string; body: any }> = [];
let cancelOk = true;
(globalThis as any).fetch = async (url: string, init: any) => {
  const path = new URL(url).pathname;
  sumitCalls.push({ path, body: JSON.parse(init.body) });
  if (path === '/billing/recurring/cancel/') return { json: async () => (cancelOk ? { Status: 0 } : { Status: 1, UserErrorMessage: 'nope' }) };
  throw new Error('unexpected SUMIT call ' + path);
};

// ── mail capture ──
const mails: Array<{ to: string; subject: string; text: string; html: string }> = [];
setRefundMailer(async (to, subject, text, html) => { mails.push({ to, subject, text, html }); });
process.env.ADMIN_ALERT_EMAIL = 'admin@pagey.test';

function res() {
  const r: any = { code: 200, body: undefined };
  r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const stoppedCalls = () => sumitCalls.filter(c => c.path === '/billing/recurring/cancel/').length;

let n = 0;
/** A paid monthly (or annual) subscription whose first payment was `paidDaysAgo` days ago. */
function seed(opts: { paidDaysAgo?: number; cycle?: 'month' | 'year'; charges?: number; amount?: number; email?: string; status?: string } = {}) {
  n++;
  const email = opts.email ?? `u${n}@x.co`;
  const cycle = opts.cycle ?? 'month';
  const amount = opts.amount ?? (cycle === 'year' ? 2500 : 250);
  const id = `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const sub: Row = {
    id, email, status: opts.status ?? 'active', amount, plan_id: cycle === 'year' ? 'annual' : 'monthly', cycle, with_page: true,
    sumit_customer_id: '42', sumit_recurring_item_id: cycle === 'year' ? null : `9${n}`,
    current_period_end: new Date(Date.now() + 20 * DAY).toISOString(), cancel_at_period_end: false, needs_manual_cancel: false, reminder_for_period_end: null,
  };
  db.seo_subscriptions.push(sub);
  const first = Date.now() - (opts.paidDaysAgo ?? 3) * DAY;
  for (let i = 0; i < (opts.charges ?? 1); i++) {
    db.seo_subscription_events.push({ subscription_id: id, kind: 'charge_ok', sumit_payment_id: `p${n}-${i}`, amount, created_at: new Date(first + i * 30 * DAY).toISOString() });
  }
  db.user_products.push({ email, product: 'seo_autopilot', status: 'active', current_period_end: sub.current_period_end, source: 'sumit' });
  return sub;
}
const ev = (days: number, amount = 250, kind = 'charge_ok'): ChargeEvent => ({ kind, sumit_payment_id: `p${days}`, amount, created_at: new Date(Date.UTC(2026, 10, 1) + days * DAY).toISOString() });

(async () => {
  process.env.SEO_SUBSCRIPTION_ENABLED = 'true';
  // ── 1. the pure rule: window boundary, first payment only, once per account ──
  const t0 = new Date(Date.UTC(2026, 10, 1));
  assert.equal(REFUND_WINDOW_DAYS, 14);
  assert.equal(refundOffer('active', [ev(0)], false, new Date(t0.getTime() + 13 * DAY)).eligible, true, 'day 13');
  const edge = refundOffer('active', [ev(0)], false, new Date(t0.getTime() + 14 * DAY));
  assert.equal(edge.eligible, true, 'exactly 14 days is still inside');
  assert.equal(edge.amount, 250); assert.equal(edge.paymentId, 'p0'); assert.equal(edge.until?.getTime(), t0.getTime() + 14 * DAY);
  const late = refundOffer('active', [ev(0)], false, new Date(t0.getTime() + 14 * DAY + 1000));
  assert.equal(late.eligible, false); assert.equal(late.reason, 'expired');
  assert.equal(refundOffer('active', [ev(0), ev(5)], false, new Date(t0.getTime() + 6 * DAY)).reason, 'not_first', 'a renewal means the first-payment right is gone');
  assert.equal(refundOffer('active', [ev(0)], true, new Date(t0.getTime() + 2 * DAY)).reason, 'used', 'once per account');
  assert.equal(refundOffer('canceled', [ev(0)], false, new Date(t0.getTime() + 2 * DAY)).reason, 'not_active');
  assert.equal(refundOffer('pending', [], false, t0).reason, 'not_active');
  assert.equal(refundOffer('active', [], false, t0).reason, 'no_payment');
  assert.equal(refundOffer('active', [ev(0, 0)], false, t0).reason, 'no_payment', 'a zero charge is not a payment');
  assert.equal(refundOffer('active', [ev(0, 250, 'canceled')], false, t0).reason, 'no_payment', 'only charge_ok events count');
  assert.equal(refundOffer('past_due', [ev(0)], false, new Date(t0.getTime() + DAY)).eligible, true);
  assert.equal(refundOffer('active', [ev(0, 2500)], false, new Date(t0.getTime() + DAY)).amount, 2500, 'the annual plan has the same window and refunds what was paid');

  // ── 2. cancelling inside the window: stop the standing order, end access now, record, mail both ──
  const a = seed({ paidDaysAgo: 3 });
  let r = res(); await getStatus({ authEmail: a.email, query: {}, body: {} } as any, r);
  assert.equal(r.body.subscription.refund.eligible, true, 'the card can state the case before confirming');
  assert.equal(r.body.subscription.refund.amount, 250);
  assert.ok(r.body.subscription.refund.until);
  const cancelsBefore = stoppedCalls();
  const mailsBefore = mails.length;
  r = res(); await cancel({ authEmail: a.email, query: {}, body: {} } as any, r);
  assert.equal(r.code, 200); assert.equal(r.body.refunded, 250);
  assert.equal(a.status, 'canceled', 'access ends immediately');
  assert.ok(Math.abs(new Date(a.current_period_end).getTime() - Date.now()) < 60_000, 'period end is now, not a month away');
  assert.equal(a.cancel_at_period_end, false);
  assert.equal(stoppedCalls(), cancelsBefore + 1, 'the standing order is stopped at SUMIT');
  assert.equal(sumitCalls[sumitCalls.length - 1].body.RecurringCustomerItemID, Number(`9${n}`));
  assert.equal(a.sumit_recurring_item_id, null); assert.equal(a.needs_manual_cancel, false);
  assert.equal(db.user_products.find(p => p.email === a.email)!.status, 'canceled', 'the entitlement is gone');
  const req1 = db.seo_refund_requests.find(x => x.email === a.email)!;
  assert.ok(req1, 'a refund request is recorded');
  assert.equal(req1.status ?? 'pending', 'pending'); assert.equal(req1.amount, 250);
  assert.equal(req1.sumit_payment_id, `p${n}-0`); assert.equal(req1.subscription_id, a.id);
  assert.ok(db.seo_subscription_events.some(e => e.subscription_id === a.id && e.kind === 'canceled'));
  // emails: the admin gets the payment id and the amount, the customer a confirmation with no promised number of days
  assert.equal(mails.length, mailsBefore + 2);
  const adminMail = mails.find(m => m.to === 'admin@pagey.test')!; const custMail = mails.find(m => m.to === a.email)!;
  assert.ok(adminMail && custMail, 'both mails attempted');
  assert.ok(adminMail.text.includes(`p${n}-0`) && adminMail.text.includes('250'), 'admin mail: payment id and amount');
  assert.ok(custMail.text.includes('בימים הקרובים'), 'customer mail: "בימים הקרובים"');
  assert.ok(!/\d+\s*(ימי עסקים|ימים)/.test(custMail.text.replace('14 יום', '')), 'customer mail promises no number of days');
  assert.ok(custMail.text.includes('250'));
  assert.deepEqual(Object.keys(adminRefundMail({ email: 'e', amount: 1, paymentId: null, cycle: 'month' })).sort(), ['html', 'subject', 'text']);
  assert.ok(customerRefundMail({ email: 'e', amount: 1, paymentId: null, cycle: 'year' }).subject.length > 0);

  // a second cancel does nothing more: no second request, no second refund
  r = res(); await cancel({ authEmail: a.email, query: {}, body: {} } as any, r);
  assert.equal(db.seo_refund_requests.filter(x => x.email === a.email).length, 1, 'never two requests for one account');
  assert.equal(mails.length, mailsBefore + 2, 'no second mail');

  // ── 3. once per account, ever: a later subscription of the same account gets no refund ──
  const again = seed({ paidDaysAgo: 2, email: a.email.replace('u', 'again-') });
  db.seo_refund_requests.push({ id: 'old', email: again.email, subscription_id: null, amount: 250, status: 'refunded' });
  r = res(); await getStatus({ authEmail: again.email, query: {}, body: {} } as any, r);
  assert.equal(r.body.subscription.refund.eligible, false);
  const mailsB2 = mails.length; const calls2 = stoppedCalls();
  r = res(); await cancel({ authEmail: again.email, query: {}, body: {} } as any, r);
  assert.equal(r.code, 200); assert.ok(!r.body.refunded, 'no refund the second time');
  assert.equal(again.status, 'active'); assert.equal(again.cancel_at_period_end, true, 'ordinary cancel: access to the end of the paid period');
  assert.equal(stoppedCalls(), calls2 + 1, 'the standing order is still stopped');
  assert.equal(mails.length, mailsB2, 'no refund mail');

  // a request that appears between the check and the insert (double click): the unique index sends it down the ordinary path
  const race = seed({ paidDaysAgo: 1 });
  const realFrom = (supabase as any).from;
  let injected = false;
  (supabase as any).from = (t: string) => {
    const q = realFrom(t);
    if (t === 'seo_refund_requests' && !injected) {
      const origInsert = q.insert;
      q.insert = (p: Row) => { injected = true; db.seo_refund_requests.push({ id: 'racer', email: p.email, amount: 250, status: 'pending' }); return origInsert(p); };
    }
    return q;
  };
  const mailsB3 = mails.length;
  const out = await cancelSubscription(race.email, new Date(), { refund: true });
  (supabase as any).from = realFrom;
  assert.ok(!out.refunded, 'the loser of the race is not refunded twice');
  assert.equal(race.cancel_at_period_end, true); assert.equal(race.status, 'active');
  assert.equal(db.seo_refund_requests.filter(x => x.email === race.email).length, 1);
  assert.equal(mails.length, mailsB3);

  // ── 4. after 14 days, or after any renewal: cancel works as today ──
  const old = seed({ paidDaysAgo: 15 });
  r = res(); await getStatus({ authEmail: old.email, query: {}, body: {} } as any, r);
  assert.equal(r.body.subscription.refund.eligible, false);
  const calls4 = stoppedCalls();
  r = res(); await cancel({ authEmail: old.email, query: {}, body: {} } as any, r);
  assert.equal(r.code, 200); assert.ok(!r.body.refunded);
  assert.equal(old.status, 'active', 'access stays to the end of the paid period'); assert.equal(old.cancel_at_period_end, true);
  assert.equal(stoppedCalls(), calls4 + 1);
  assert.ok(!db.seo_refund_requests.some(x => x.email === old.email));

  const renewed = seed({ paidDaysAgo: 20, charges: 2 });   // second charge 10 days ago, first 20 days ago: not first anymore
  r = res(); await cancel({ authEmail: renewed.email, query: {}, body: {} } as any, r);
  assert.ok(!r.body.refunded); assert.equal(renewed.status, 'active');
  const fresh2 = seed({ paidDaysAgo: 40, charges: 2 });   // renewed, so even though... no refund
  r = res(); await cancel({ authEmail: fresh2.email, query: {}, body: {} } as any, r);
  assert.ok(!r.body.refunded);

  // an account deletion calls the plain cancel: never a refund
  const del = seed({ paidDaysAgo: 1 });
  await cancelSubscription(del.email);
  assert.ok(!db.seo_refund_requests.some(x => x.email === del.email), 'deleting an account is not a refund request');

  // ── 5. the annual plan gets the same refund ──
  const y = seed({ paidDaysAgo: 5, cycle: 'year' });
  const calls5 = stoppedCalls();
  r = res(); await cancel({ authEmail: y.email, query: {}, body: {} } as any, r);
  assert.equal(r.body.refunded, 2500); assert.equal(y.status, 'canceled');
  assert.equal(stoppedCalls(), calls5, 'an annual plan has no standing order to stop');
  assert.equal(db.seo_refund_requests.find(x => x.email === y.email)!.amount, 2500);

  // ── 6. the standing order cannot be stopped: access still ends, a human is flagged, the refund is still recorded ──
  const bad = seed({ paidDaysAgo: 2 });
  cancelOk = false;
  r = res(); await cancel({ authEmail: bad.email, query: {}, body: {} } as any, r);
  cancelOk = true;
  assert.equal(bad.status, 'canceled'); assert.equal(bad.needs_manual_cancel, true);
  assert.ok(db.seo_refund_requests.some(x => x.email === bad.email));

  // ── 7. the cancel itself fails to save: nothing is recorded, the customer can try again ──
  const flaky = seed({ paidDaysAgo: 2 });
  failSubUpdate = true;
  const origErr = console.error; console.error = () => {};
  r = res(); await cancel({ authEmail: flaky.email, query: {}, body: {} } as any, r);
  console.error = origErr; failSubUpdate = false;
  assert.notEqual(r.code, 200);
  assert.ok(!db.seo_refund_requests.some(x => x.email === flaky.email), 'the request is released when the cancel did not happen');
  assert.equal(flaky.status, 'active');

  // ── 8. before migration 051: no refund is offered, cancel works as today ──
  const pre = seed({ paidDaysAgo: 2 });
  refundTableMissing = true;
  r = res(); await getStatus({ authEmail: pre.email, query: {}, body: {} } as any, r);
  assert.equal(r.body.subscription.refund.eligible, false);
  r = res(); await cancel({ authEmail: pre.email, query: {}, body: {} } as any, r);
  refundTableMissing = false;
  assert.equal(r.code, 200); assert.ok(!r.body.refunded); assert.equal(pre.cancel_at_period_end, true);

  // ── 9. an email that fails does not undo the cancellation ──
  const mailFail = seed({ paidDaysAgo: 2 });
  setRefundMailer(async () => { throw new Error('resend down'); });
  const errQuiet = console.error; console.error = () => {};
  r = res(); await cancel({ authEmail: mailFail.email, query: {}, body: {} } as any, r);
  console.error = errQuiet;
  setRefundMailer(async (to, subject, text, html) => { mails.push({ to, subject, text, html }); });
  assert.equal(r.code, 200); assert.equal(mailFail.status, 'canceled'); assert.ok(db.seo_refund_requests.some(x => x.email === mailFail.email));

  // ── 10. the admin side: list, mark refunded, gated ──
  r = res(); await adminListRefunds({} as any, r);
  assert.ok(Array.isArray(r.body.refunds) && r.body.refunds.length >= 3);
  assert.equal((await listRefundRequests()).length, db.seo_refund_requests.length);
  r = res(); await adminMarkRefund({ params: { id: 'nope' }, body: { status: 'refunded' } } as any, r);
  assert.equal(r.code, 400);
  r = res(); await adminMarkRefund({ params: { id: req1.id }, body: { status: 'bogus' } } as any, r);
  assert.equal(r.code, 400);
  r = res(); await adminMarkRefund({ params: { id: req1.id }, body: { status: 'refunded', note: 'הוחזר בסאמיט' } } as any, r);
  assert.equal(r.code, 200); assert.equal(req1.status, 'refunded'); assert.ok(req1.handled_at); assert.equal(req1.note, 'הוחזר בסאמיט');
  r = res(); await adminMarkRefund({ params: { id: req1.id }, body: { status: 'rejected' } } as any, r);
  assert.equal(r.code, 409, 'a handled request cannot be flipped'); assert.equal(req1.status, 'refunded');
  assert.equal(await markRefundRequest('00000000-0000-4000-8000-00000000ffff', 'refunded', null), false);
  refundTableMissing = true;
  r = res(); await adminListRefunds({} as any, r);
  refundTableMissing = false;
  assert.equal(r.code, 503); assert.equal(r.body.code, 'not_migrated');

  // the routes sit behind the admin gate: requireAuth, requireAdmin and the panel password are router-wide middleware
  // registered BEFORE the refund routes, and no customer router exposes them
  const stack = (adminRouter as any).stack as Array<{ name: string; route?: { path: string; methods: Record<string, boolean> } }>;
  const idx = (p: string, m: string) => stack.findIndex(l => l.route?.path === p && l.route.methods[m]);
  const list = idx('/seo/refunds', 'get'), mark = idx('/seo/refunds/:id/handled', 'post');
  assert.ok(list > 0 && mark > 0, 'refund routes exist on the admin router');
  const mwNames = stack.slice(0, Math.min(list, mark)).filter(l => !l.route).map(l => l.name);
  assert.ok(mwNames.includes('requireAuth') && mwNames.includes('requireAdmin') && mwNames.includes('requireAdminPanelPassword'), `gate runs first, saw: ${mwNames.join(',')}`);
  const customerPaths = ((landingRouter as any).stack as Array<{ route?: { path: string } }>).map(l => l.route?.path ?? '');
  assert.ok(!customerPaths.some(p => p.includes('refund')), 'no customer route can mark a refund');

  // ── 11. "do not renew" a page: reminders stop, and it is reversible ──
  const OWNER = 'page@x.co';
  const soon = new Date(Date.now() + 5 * DAY).toISOString();
  const pg = (id: string, extra: Row = {}) => { db.landing_pages.push({ id, owner_email: OWNER, status: 'published', parent_id: null, slug: id, subdomain: null, business_name: 'עסק', expires_at: soon, frozen_at: null, renewal_reminder_30_at: null, renewal_reminder_7_at: null, renewal_reminder_0_at: null, renewal_opt_out_at: null, ...extra }); return db.landing_pages[db.landing_pages.length - 1]; };
  const stay = pg('page-stays'), gone = pg('page-optout');
  assert.deepEqual(await setRenewalOptOut(OWNER, 'page-optout', true), { ok: true });
  assert.ok(gone.renewal_opt_out_at, 'the choice is recorded with a time');
  assert.deepEqual(await setRenewalOptOut('someone@else.co', 'page-optout', false), { ok: false, reason: 'not_found' }, "only the owner can change it");
  assert.ok(gone.renewal_opt_out_at);
  const child = pg('page-child', { parent_id: 'page-stays' });
  assert.deepEqual(await setRenewalOptOut(OWNER, 'page-child', true), { ok: false, reason: 'not_found' }, 'only a top-level page');
  assert.equal(child.renewal_opt_out_at, null);
  const errOff = console.error; const logOff = console.log; const warnOff = console.warn; console.error = () => {}; console.log = () => {}; console.warn = () => {};
  try { await runRenewalSweep(); } finally { console.error = errOff; console.log = logOff; console.warn = warnOff; }
  assert.ok(stay.renewal_reminder_7_at, 'a normal page is reminded');
  assert.equal(gone.renewal_reminder_30_at, null); assert.equal(gone.renewal_reminder_7_at, null); assert.equal(gone.renewal_reminder_0_at, null);
  assert.equal(gone.status, 'published', 'opting out does not take the page down early');
  // frozen reminders follow the same rule
  const fz = (id: string, optOut: string | null) => pg(id, { status: 'frozen', expires_at: null, frozen_at: new Date(Date.now() - 200 * DAY).toISOString(), frozen_reminder_6mo_at: null, frozen_reminder_11mo_at: null, renewal_opt_out_at: optOut });
  const fzNormal = fz('frozen-normal', null), fzOut = fz('frozen-optout', new Date().toISOString());
  console.error = () => {}; console.log = () => {}; console.warn = () => {};
  try { await runRenewalSweep(); } finally { console.error = errOff; console.log = logOff; console.warn = warnOff; }
  assert.ok(fzNormal.frozen_reminder_6mo_at, 'a frozen page is reminded');
  assert.equal(fzOut.frozen_reminder_6mo_at, null, 'a frozen page whose owner opted out is not');
  // reversible: "לחדש בכל זאת" puts it back in the sweep
  assert.deepEqual(await setRenewalOptOut(OWNER, 'page-optout', false), { ok: true });
  assert.equal(gone.renewal_opt_out_at, null);
  console.error = () => {}; console.log = () => {}; console.warn = () => {};
  try { await runRenewalSweep(); } finally { console.error = errOff; console.log = logOff; console.warn = warnOff; }
  assert.ok(gone.renewal_reminder_7_at, 'after reverting, reminders resume');
  // the owner-facing route exists, behind the page-ownership check
  const optRoute = ((landingRouter as any).stack as Array<{ route?: { path: string; stack: Array<{ name: string }> } }>).find(l => l.route?.path === '/:id/renewal-opt-out');
  assert.ok(optRoute, 'POST /:id/renewal-opt-out exists');
  assert.ok(optRoute!.route!.stack.map(s => s.name).includes('requireAuth') && optRoute!.route!.stack.map(s => s.name).includes('requireOwnPage'));

  // before migration 051 the sweep still sends reminders (the filter is dropped when the column is unknown)
  {
    const real = (supabase as any).from;
    const legacy = pg('page-legacy', { expires_at: soon });
    delete (legacy as Row).renewal_opt_out_at;
    (supabase as any).from = (t: string) => {
      const q = real(t);
      if (t !== 'landing_pages') return q;
      const origIs = q.is; let missing = false;
      q.is = (k: string, v: unknown) => { if (k === 'renewal_opt_out_at') { missing = true; return q; } return origIs(k, v); };
      const origThen = q.then;
      q.then = (ok: any) => origThen((x: any) => ok(missing ? { data: null, error: { message: 'column landing_pages.renewal_opt_out_at does not exist' } } : x));
      return q;
    };
    console.error = () => {}; console.log = () => {}; console.warn = () => {};
    try { await runRenewalSweep(); } finally { console.error = errOff; console.log = logOff; console.warn = warnOff; (supabase as any).from = real; }
    assert.ok(legacy.renewal_reminder_7_at, 'before 051 reminders are not silenced');
  }

  console.log('seo refund + renewal opt-out checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
