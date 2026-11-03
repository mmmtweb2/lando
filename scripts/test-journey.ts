// Run: npx ts-node --transpile-only scripts/test-journey.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import {
  JourneyError, activate, cleanAttribution, cleanProps, completeSetup, cleanBusinessName, setPendingProfile, dayMilestone, deriveState, logEvent, peek,
  recordDashboardView, setBusiness, start,
} from '../src/services/journey.service';
import { postPublicEvent, postAccountEvent, postActivate } from '../src/controllers/journey.controller';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = { seo_journey: [], journey_events: [], user_products: [], seo_businesses: [], funnel_events: [], user_profiles: [{ email: 'a@x.co' }, { email: 'b@x.co' }, { email: 'c@x.co' }, { email: 'old@x.co' }, { email: 'd@x.co' }, { email: 'e@x.co' }, { email: 'keep@x.co', credits: 99 }, { email: 'link@x.co' }, { email: 'own@x.co' }] };
let missing = false;
let hideProfileOnce: string | null = null; // simulates /api/users/auth creating the row between our read and our insert
const MILESTONES = ['signup', 'setup_completed', 'activation_requested', 'activated_beta', 'payment_succeeded', 'day7_active', 'day30_active'];
(supabase as any).from = (table: string) => {
  const t = tables[table]; const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let conflict = ''; let many = false;
  const run = (): any => {
    if (missing && (table === 'seo_journey' || table === 'journey_events')) return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    if (op === 'insert') {
      if (table === 'seo_journey' && t.some((r) => r.email === patch.email)) return { data: null, error: { code: '23505', message: 'dup' } };
      if (table === 'seo_journey' && !tables.user_profiles.some((r) => r.email === patch.email)) return { data: null, error: { code: '23503', message: 'FK user_profiles' } };
      if (table === 'user_profiles' && t.some((r) => r.email === patch.email)) return { data: null, error: { code: '23505', message: 'dup' } };
      if (table === 'seo_businesses') { t.push({ id: `b${t.length + 1}`, created_at: new Date().toISOString(), website_url: null, landing_page_id: null, ...patch }); return { data: t[t.length - 1], error: null }; }
      if (table === 'journey_events' && patch.email && MILESTONES.includes(patch.event) && t.some((r) => r.email === patch.email && r.event === patch.event)) return { data: null, error: { code: '23505', message: 'dup' } };
      t.push({ stage: 'registered', place_id: null, activation_requested_at: null, beta_activated_at: null, setup_at: null, ready_at: null, registered_at: patch.registered_at ?? new Date().toISOString(), ...patch });
      return { data: null, error: null };
    }
    if (op === 'upsert') {
      const ex = t.find((r) => r[conflict.split(',')[0]] === patch[conflict.split(',')[0]] && r.product === patch.product);
      if (ex) Object.assign(ex, patch); else t.push({ ...patch }); return { data: null, error: null };
    }
    if (op === 'update') { t.filter((r) => f.every((fn) => fn(r))).forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    if (table === 'user_profiles' && hideProfileOnce && f.some((fn) => fn({ email: hideProfileOnce })) ) { hideProfileOnce = null; return { data: null, error: null }; }
    const rows = t.filter((r) => f.every((fn) => fn(r)));
    return { data: many ? rows : rows[0] ?? null, error: null };
  };
  const q: any = {
    select: () => q, eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    order: () => { many = true; return q; },
    insert: (p: Row) => { op = 'insert'; patch = p; const r = run(); const pr: any = Promise.resolve(r); pr.select = () => ({ single: () => Promise.resolve(r.error ? r : { data: patch, error: null }) }); return pr; },
    upsert: (p: Row, o: { onConflict: string }) => { op = 'upsert'; patch = p; conflict = o.onConflict; return Promise.resolve(run()); },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    maybeSingle: () => Promise.resolve(run()), then: (ok: any) => ok(run()),
  };
  return q;
};
const events = (email?: string) => tables.journey_events.filter((e) => (email === undefined ? true : e.email === email)).map((e) => e.event);
const GOOD = 'ChIJabcdefghijk';
const now = new Date('2026-11-10T10:00:00Z');
const res = () => { const r: any = { code: 200, body: null, ended: false }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.end = () => { r.ended = true; return r; }; return r; };
const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof JourneyError ? e.code : 'other'; } };

(async () => {
  // ── pure ──
  assert.equal(deriveState('setup', { entitled: false, source: null }), 'setup');
  assert.equal(deriveState('ready_to_activate', { entitled: true, source: 'manual' }), 'active_beta');
  assert.equal(deriveState('registered', { entitled: true, source: 'sumit' }), 'active');
  assert.deepEqual(cleanProps({ step_id: 'business', name: 'דנה', phone: '0501234567', email: 'a@x.co', place_id: GOOD, n: 5000, free: 'text', ok: true }), { step_id: 'business', place_id: GOOD, ok: true }, 'only allow-listed, harmless keys survive');
  assert.deepEqual(cleanProps({ step_id: 'Bad Value!', place_id: '../x' }), {});
  assert.deepEqual(cleanProps('x'), {}); assert.deepEqual(cleanProps([1]), {});
  assert.equal(cleanAttribution({ utm_source: 'google', utm_campaign: '<script>' }).utm_campaign, null);
  assert.equal(cleanAttribution({ utm_source: 'google' }).utm_source, 'google');
  assert.equal(dayMilestone('2026-11-04T10:00:00Z', now), null, 'day 6');
  assert.equal(dayMilestone('2026-11-03T10:00:00Z', now), 'day7_active', 'exactly 7 days');
  assert.equal(dayMilestone('2026-10-11T10:00:00Z', now), 'day30_active');

  // ── start: row once, signup once, never for existing customers ──
  let v = await start('a@x.co', 'anon-12345678', { utm_source: 'google', utm_medium: 'cpc' }, now);
  assert.deepEqual([v.state, v.started, v.placeId], ['registered', true, null]);
  await start('a@x.co', null, null, now);
  assert.equal(tables.seo_journey.length, 1);
  assert.deepEqual(events('a@x.co'), ['signup'], 'signup is logged once');
  assert.equal(tables.journey_events[0].utm_source, 'google');
  assert.equal(tables.journey_events[0].anon_id, 'anon-12345678');
  tables.user_products.push({ email: 'old@x.co', product: 'seo_autopilot', status: 'active', source: 'manual', current_period_end: null });
  await start('old@x.co', null, null, now);
  assert.deepEqual(events('old@x.co'), [], 'an account that already holds the product is not a new signup');
  assert.equal((await peek('old@x.co', now)).state, 'active_beta');
  assert.equal((await peek('zzz@x.co', now)).started, false, 'peek creates nothing');
  assert.equal(tables.seo_journey.length, 2);

  // ── business -> setup ──
  assert.equal(await code(setBusiness('a@x.co', '../etc', now)), 'bad_place');
  assert.equal(await code(setBusiness('a@x.co', 5, now)), 'bad_place');
  assert.equal(await code(completeSetup('a@x.co', now)), 'no_business', 'cannot finish setup without a business');
  v = await setBusiness('a@x.co', GOOD, now);
  assert.deepEqual([v.state, v.placeId], ['setup', GOOD]);
  assert.ok(events('a@x.co').includes('setup_step_completed'));
  v = await setBusiness('a@x.co', 'ChIJother12345', now);
  assert.equal(v.state, 'setup', 'changing the business keeps the stage');
  assert.equal(tables.seo_journey.find((r) => r.email === 'a@x.co')!.place_id, 'ChIJother12345');

  // ── activate before ready ──
  assert.equal(await code(activate('a@x.co', now)), 'not_ready');
  v = await completeSetup('a@x.co', now);
  assert.equal(v.state, 'ready_to_activate');
  await completeSetup('a@x.co', now);
  assert.equal(events('a@x.co').filter((e) => e === 'setup_completed').length, 1, 'setup_completed once');

  // ── no Google profile yet (task #12): the setup is not blocked ──
  assert.equal(cleanBusinessName('  קפה   נעמי '), 'קפה נעמי'); assert.equal(cleanBusinessName('א'), null); assert.equal(cleanBusinessName('x'.repeat(81)), null);
  assert.equal(cleanBusinessName(5), null); assert.equal(cleanBusinessName('<script>'), 'script');
  await start('e@x.co', null, null, now);
  assert.equal(await code(setPendingProfile('e@x.co', '', now)), 'bad_name');
  assert.equal(await code(completeSetup('e@x.co', now)), 'no_business', 'neither a place nor a pending profile');
  let pv = await setPendingProfile('e@x.co', 'קפה נעמי', now);
  assert.deepEqual([pv.state, pv.profilePending, pv.pendingName, pv.placeId], ['setup', true, 'קפה נעמי', null]);
  pv = await setPendingProfile('e@x.co', 'קפה נעמי חיפה', now);
  assert.equal(pv.pendingName, 'קפה נעמי חיפה');
  assert.equal(events('e@x.co').filter((x) => x === 'setup_step_completed').length, 1, 'logged once');
  pv = await completeSetup('e@x.co', now);
  assert.deepEqual([pv.state, pv.profilePending], ['ready_to_activate', true], 'pending verification does not block finishing the setup');
  pv = await setBusiness('e@x.co', GOOD, now);
  assert.deepEqual([pv.state, pv.profilePending, pv.pendingName, pv.placeId], ['ready_to_activate', false, null, GOOD], 'picking the business later clears the marker, keeps the stage');
  assert.equal(await code(setPendingProfile('e@x.co', 'קפה נעמי', now)), 'has_business');

  // ── the payment gate changes behaviour, not data ──
  process.env.PAYMENT_GATE_ENABLED = 'true'; process.env.BETA_SELF_ACTIVATION = 'true';
  assert.equal(await code(activate('a@x.co', now)), 'payment_required', 'gate on: never free, even with self activation on');
  assert.equal(tables.user_products.filter((r) => r.email === 'a@x.co').length, 0);
  let r = res(); await postActivate({ authEmail: 'a@x.co' } as any, r);
  assert.equal(r.code, 402); assert.equal(r.body.next, '/seo-plan');

  process.env.PAYMENT_GATE_ENABLED = 'false'; delete process.env.BETA_SELF_ACTIVATION;
  let act = await activate('a@x.co', now);
  assert.deepEqual([act.state, act.requested], ['ready_to_activate', true], 'gate off, self activation closed: request recorded');
  await activate('a@x.co', now);
  assert.equal(events('a@x.co').filter((e) => e === 'activation_requested').length, 1);
  assert.equal(tables.user_products.filter((r) => r.email === 'a@x.co').length, 0, 'no access without the owner');

  process.env.BETA_SELF_ACTIVATION = 'true'; process.env.BETA_ACTIVATION_DAYS = '30';
  act = await activate('a@x.co', now);
  assert.equal(act.state, 'active_beta');
  const grant = tables.user_products.find((r) => r.email === 'a@x.co')!;
  assert.deepEqual([grant.source, grant.status], ['manual', 'active']);
  assert.equal(grant.current_period_end, new Date(now.getTime() + 30 * 86400000).toISOString());
  assert.ok(tables.seo_journey.find((r) => r.email === 'a@x.co')!.beta_activated_at);
  assert.equal(events('a@x.co').filter((e) => e === 'activated_beta').length, 1);
  await activate('a@x.co', now);
  assert.equal(events('a@x.co').filter((e) => e === 'activated_beta').length, 1, 'idempotent');

  // Day 91: access ends, and a new click does not buy another free round.
  assert.equal(await code(activate('a@x.co', new Date(now.getTime() + 31 * 86400000))), 'beta_ended', 'beta is single-use');
  tables.user_products.find((x) => x.email === 'a@x.co')!.current_period_end = '2026-01-01T00:00:00Z';
  r = res(); await postActivate({ authEmail: 'a@x.co' } as any, r); assert.equal(r.code, 409); assert.equal(r.body.code, 'beta_ended');
  tables.user_products.find((x) => x.email === 'a@x.co')!.current_period_end = new Date(now.getTime() + 30 * 86400000).toISOString();

  // Same stored data, a paying subscriber: derived state is "active". No data change needed.
  tables.user_products.find((r) => r.email === 'a@x.co')!.source = 'sumit';
  assert.equal((await peek('a@x.co', now)).state, 'active');
  // Expired entitlement falls back to the stored stage.
  Object.assign(tables.user_products.find((r) => r.email === 'a@x.co')!, { source: 'manual', current_period_end: '2026-01-01T00:00:00Z' });
  assert.equal((await peek('a@x.co', now)).state, 'ready_to_activate');
  delete process.env.BETA_SELF_ACTIVATION; delete process.env.BETA_ACTIVATION_DAYS;

  // Default length is 90 days: open on day 89, closed on day 91.
  await start('d@x.co', null, null, now); await setBusiness('d@x.co', 'ChIJabcdefghij', now); await completeSetup('d@x.co', now);
  process.env.BETA_SELF_ACTIVATION = 'true';
  assert.equal((await activate('d@x.co', now)).state, 'active_beta');
  assert.equal(tables.user_products.find((x) => x.email === 'd@x.co')!.current_period_end, new Date(now.getTime() + 90 * 86400000).toISOString());
  assert.equal((await peek('d@x.co', new Date(now.getTime() + 89 * 86400000))).state, 'active_beta');
  assert.equal((await peek('d@x.co', new Date(now.getTime() + 91 * 86400000))).state, 'ready_to_activate');
  assert.equal(events('d@x.co').filter((e) => e === 'activated_beta').length, 1);
  delete process.env.BETA_SELF_ACTIVATION;

  // ── day 7 / day 30 ──
  await start('b@x.co', null, null, new Date('2026-10-01T10:00:00Z'));
  tables.seo_journey.find((r) => r.email === 'b@x.co')!.registered_at = '2026-10-31T10:00:00Z'; // 10 days before `now`
  await recordDashboardView('b@x.co', now);
  await recordDashboardView('b@x.co', now);
  assert.deepEqual(events('b@x.co').filter((e) => e === 'day7_active').length, 1, 'day7_active once');
  assert.equal(events('b@x.co').filter((e) => e === 'day30_active').length, 0);
  assert.equal(events('b@x.co').filter((e) => e === 'dashboard_viewed').length, 2);
  tables.seo_journey.find((r) => r.email === 'b@x.co')!.registered_at = '2026-09-01T10:00:00Z'; // 70 days
  await recordDashboardView('b@x.co', now);
  assert.equal(events('b@x.co').filter((e) => e === 'day30_active').length, 1);
  await start('c@x.co', null, null, now);
  await recordDashboardView('c@x.co', now);
  assert.deepEqual(events('c@x.co'), ['signup', 'dashboard_viewed'], 'a new account has no milestone yet');

  // ── race at /start: the profile row does not exist yet (or appears mid-way); no 500, nothing overwritten ──
  assert.equal(tables.user_profiles.some((x) => x.email === 'new@x.co'), false);
  v = await start('new@x.co', null, null, now);
  assert.equal(v.started, true, 'start creates the missing profile first instead of failing on the FK');
  assert.equal(tables.user_profiles.filter((x) => x.email === 'new@x.co').length, 1);
  await start('keep@x.co', null, null, now);
  assert.equal(tables.user_profiles.find((x) => x.email === 'keep@x.co')!.credits, 99, 'an existing profile is never overwritten');
  hideProfileOnce = 'race@x.co'; tables.user_profiles.push({ email: 'race@x.co' });
  v = await start('race@x.co', null, null, now);
  assert.equal(v.started, true, 'losing the insert race (23505) re-reads the winner');
  assert.equal(tables.user_profiles.filter((x) => x.email === 'race@x.co').length, 1);

  // ── the business chosen in /start becomes the dashboard's business (once, place_id from the journey) ──
  const { linkJourneyBusiness } = await import('../src/services/journeyBusiness.service');
  const realFetch = globalThis.fetch; let placeCalls = 0; let placeOk = true;
  (globalThis as any).fetch = async (url: string) => {
    placeCalls++;
    if (!placeOk) return new Response('boom', { status: 500 });
    return new Response(JSON.stringify({ id: GOOD, displayName: { text: 'קפה נעמי' }, websiteUri: 'https://x.co', rating: 4.9 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  process.env.GOOGLE_PLACES_API_KEY = 'fake-key';
  await start('link@x.co', null, null, now); await setBusiness('link@x.co', GOOD, now);
  assert.equal(await linkJourneyBusiness('nobody@x.co', now), 'nothing');
  placeOk = false;
  assert.equal(await linkJourneyBusiness('link@x.co', now), 'skipped', 'Places down: nothing saved, no marker, retried next time');
  assert.equal(tables.seo_businesses.length, 0); assert.equal(tables.seo_journey.find((x) => x.email === 'link@x.co')!.business_linked_at, undefined);
  placeOk = true;
  assert.equal(await linkJourneyBusiness('link@x.co', now), 'linked');
  assert.deepEqual(tables.seo_businesses.map((b) => [b.owner_email, b.google_place_id, b.name, b.website_url]), [['link@x.co', GOOD, 'קפה נעמי', null]], 'place_id + the confirmed name only');
  assert.ok(tables.seo_journey.find((x) => x.email === 'link@x.co')!.business_linked_at);
  const callsAfter = placeCalls;
  assert.equal(await linkJourneyBusiness('link@x.co', now), 'already'); assert.equal(placeCalls, callsAfter, 'no second Places call');
  tables.seo_businesses.length = 0; // the customer removed the business on purpose
  assert.equal(await linkJourneyBusiness('link@x.co', now), 'already'); assert.equal(tables.seo_businesses.length, 0, 'a removed business is not added back');
  await start('own@x.co', null, null, now); await setBusiness('own@x.co', GOOD, now);
  tables.seo_businesses.push({ id: 'own1', owner_email: 'own@x.co', name: 'שלי', google_place_id: 'ChIJmine123456', created_at: '2026-01-01' });
  const c2 = placeCalls;
  assert.equal(await linkJourneyBusiness('own@x.co', now), 'already'); assert.equal(placeCalls, c2, 'a business the customer connected themselves is kept, no Places call');
  assert.equal(tables.seo_businesses.filter((b) => b.owner_email === 'own@x.co').length, 1);
  globalThis.fetch = realFetch; delete process.env.GOOGLE_PLACES_API_KEY;

  // ── public events: only known events with a valid anonymous id; always 204 ──
  const before = tables.journey_events.length;
  r = res(); await postPublicEvent({ body: { event: 'signup', anonId: 'anon-12345678' } } as any, r);
  assert.equal(r.code, 204); assert.ok(r.ended);
  await postPublicEvent({ body: { event: 'activated_beta', anonId: 'anon-12345678' } } as any, res());
  await postPublicEvent({ body: { event: 'audit_started', anonId: 'short' } } as any, res());
  await postPublicEvent({ body: { event: 'audit_started' } } as any, res());
  await postPublicEvent({ body: null } as any, res());
  assert.equal(tables.journey_events.length, before, 'server-only events and bad ids are dropped');
  await postPublicEvent({ body: { event: 'audit_completed', anonId: 'anon-12345678', props: { place_id: GOOD, phone: '0501234567' }, attribution: { utm_source: 'g' } } } as any, res());
  const last = tables.journey_events[tables.journey_events.length - 1];
  assert.deepEqual([last.event, last.email, last.anon_id, last.props, last.utm_source], ['audit_completed', null, 'anon-12345678', { place_id: GOOD }, 'g']);

  // ── account events ──
  r = res(); await postAccountEvent({ authEmail: undefined, body: {} } as any, r); assert.equal(r.code, 401);
  r = res(); await postAccountEvent({ authEmail: 'c@x.co', body: { event: 'activated_beta' } } as any, r); assert.equal(r.code, 400, 'a customer cannot report a server-only milestone');
  r = res(); await postAccountEvent({ authEmail: 'c@x.co', body: { event: 'activation_viewed' } } as any, r); assert.equal(r.code, 204);
  assert.ok(events('c@x.co').includes('activation_viewed'));

  // ── logging never throws, even when the table is missing ──
  missing = true;
  assert.equal(await logEvent({ event: 'audit_started', anonId: 'anon-12345678' }), false);
  assert.equal(await code(peek('a@x.co', now)), 'not_migrated');
  r = res(); await postActivate({ authEmail: 'a@x.co' } as any, r); assert.equal(r.code, 503); assert.equal(r.body.code, 'journey_not_migrated');
  missing = false;

  console.log('journey checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
