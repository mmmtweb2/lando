// Run: npx ts-node --transpile-only scripts/test-gbp-controller.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import * as gbp from '../src/controllers/gbp.controller';
import { signState } from '../src/services/gbpCrypto';
import { gbpOAuthConfig } from '../src/config/gbp';

const KEYHEX = 'cd'.repeat(32);
Object.assign(process.env, {
  GOOGLE_OAUTH_CLIENT_ID: 'a.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-abc', GBP_TOKEN_ENCRYPTION_KEY: KEYHEX,
  PUBLIC_API_URL: 'https://api.pagey.co.il', GBP_CONNECT_ENABLED: 'true',
});

type Row = Record<string, any>;
const conns: Row[] = []; let businesses: Row[] = []; let missing = false;
(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {};
  const run = (): any => {
    if (missing) return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    if (table === 'seo_businesses') return { data: businesses, error: null };
    assert.equal(table, 'gbp_connections');
    if (op === 'upsert') { const i = conns.findIndex((r) => r.email === patch.email); if (i >= 0) conns[i] = { ...conns[i], ...patch }; else conns.push({ ...patch }); return { data: null, error: null }; }
    if (op === 'update') { conns.filter((r) => f.every((fn) => fn(r))).forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    if (op === 'delete') { for (let i = conns.length - 1; i >= 0; i--) if (f.every((fn) => fn(conns[i]))) conns.splice(i, 1); return { data: null, error: null }; }
    return { data: conns.find((r) => f.every((fn) => fn(r))) ?? null, error: null };
  };
  const q: any = {
    select: () => q, order: () => q,
    upsert: (p: Row) => { op = 'upsert'; patch = p; return q; },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    maybeSingle: () => Promise.resolve(run()),
    then: (ok: any) => ok(run()),
  };
  return q;
};
const res = () => { const r: any = { code: 200, body: null, redirected: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.redirect = (u: string) => { r.redirected = u; return r; }; return r; };
const req = (email: string | undefined, extra: Row = {}): any => ({ authEmail: email, query: {}, body: {}, ...extra });

let google: (url: string, init?: any) => Response = () => new Response('{}', { status: 404 });
(globalThis as any).fetch = async (url: any, init?: any) => google(String(url), init);
const J = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const cfg = gbpOAuthConfig()!;

(async () => {
  // off by default switch
  process.env.GBP_CONNECT_ENABLED = 'false';
  let r = res(); await gbp.status(req('a@x.co'), r); assert.deepEqual(r.body, { enabled: false, connected: false, needsReconnect: false });
  r = res(); await gbp.start(req('a@x.co'), r); assert.equal(r.code, 503);
  r = res(); await gbp.stats(req('a@x.co'), r); assert.equal(r.code, 503);
  process.env.GBP_CONNECT_ENABLED = 'true';

  // auth required
  r = res(); await gbp.start(req(undefined), r); assert.equal(r.code, 401);
  r = res(); await gbp.stats(req(undefined), r); assert.equal(r.code, 401);

  // start -> consent url bound to the account
  r = res(); await gbp.start(req('a@x.co'), r);
  const u = new URL(r.body.url); assert.equal(u.hostname, 'accounts.google.com');
  const state = u.searchParams.get('state')!;

  // callback: bad state / denied / missing code
  r = res(); await gbp.callback(req(undefined, { query: { code: 'C', state: 'bad' } }), r); assert.match(r.redirected, /gbp=error$/);
  r = res(); await gbp.callback(req(undefined, { query: { error: 'access_denied' } }), r); assert.match(r.redirected, /gbp=denied$/);
  r = res(); await gbp.callback(req(undefined, { query: { state } }), r); assert.match(r.redirected, /gbp=error$/);
  assert.equal(conns.length, 0);

  // callback ok: refresh token stored encrypted
  google = (url) => url.includes('oauth2.googleapis.com/token') ? J(200, { refresh_token: 'RT-SECRET', scope: 'https://www.googleapis.com/auth/business.manage' }) : J(404, {});
  r = res(); await gbp.callback(req(undefined, { query: { code: 'C', state } }), r);
  assert.match(r.redirected, /gbp=ok$/);
  assert.equal(conns.length, 1); assert.equal(conns[0].email, 'a@x.co');
  assert.ok(!JSON.stringify(conns).includes('RT-SECRET'), 'token is not stored in clear');
  // another account's state cannot write for someone else
  const other = signState('b@x.co', cfg.key);
  r = res(); await gbp.callback(req(undefined, { query: { code: 'C', state: other } }), r); assert.equal(conns.length, 2); assert.equal(conns[1].email, 'b@x.co');
  conns.splice(1, 1);

  r = res(); await gbp.status(req('a@x.co'), r); assert.deepEqual(r.body, { enabled: true, connected: true, needsReconnect: false });
  r = res(); await gbp.status(req('zz@x.co'), r); assert.equal(r.body.connected, false);

  // stats: no connection
  r = res(); await gbp.stats(req('zz@x.co'), r); assert.equal(r.code, 409); assert.equal(r.body.code, 'not_connected');

  // stats: matched by the saved business's place id
  businesses = [{ google_place_id: 'ChIJa', name: 'x' }];
  const series = { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ value: '5' }] } }] }] };
  google = (url) => {
    if (url.includes('oauth2.googleapis.com/token')) return J(200, { access_token: 'AT' });
    if (url.includes('mybusinessaccountmanagement')) return J(200, { accounts: [{ name: 'accounts/1' }] });
    if (url.includes('mybusinessbusinessinformation')) return J(200, { locations: [{ name: 'locations/9', title: 'שרברב', metadata: { placeId: 'ChIJa' } }, { name: 'locations/8', title: 'אחר' }] });
    if (url.includes('businessprofileperformance')) return J(200, series);
    return J(404, {});
  };
  r = res(); await gbp.stats(req('a@x.co'), r);
  assert.equal(r.code, 200); assert.equal(r.body.location.name, 'locations/9'); assert.equal(r.body.totals.calls, 5);
  assert.equal(conns[0].location_name, 'locations/9', 'matched location remembered');

  // several locations and no match -> the customer chooses; choice validated against the account
  conns[0].location_name = null; businesses = [];
  r = res(); await gbp.stats(req('a@x.co'), r); assert.equal(r.body.needsChoice, true); assert.equal(r.body.locations.length, 2);
  r = res(); await gbp.chooseLocation(req('a@x.co', { body: { location: 'locations/666' } }), r); assert.equal(r.code, 400);
  r = res(); await gbp.chooseLocation(req('a@x.co', { body: { location: 'locations/8' } }), r); assert.equal(r.code, 200);
  r = res(); await gbp.stats(req('a@x.co'), r); assert.equal(r.body.location.name, 'locations/8');

  // google says the grant is gone -> reconnect needed, flagged
  google = (url) => url.includes('oauth2.googleapis.com/token') ? J(400, { error: 'invalid_grant' }) : J(404, {});
  r = res(); await gbp.stats(req('a@x.co'), r); assert.equal(r.code, 409); assert.equal(r.body.code, 'needs_reconnect');
  assert.equal(conns[0].status, 'needs_reconnect');
  r = res(); await gbp.status(req('a@x.co'), r); assert.equal(r.body.needsReconnect, true);

  // google outage -> 502, not flagged as revoked
  conns[0].status = 'active';
  google = (url) => url.includes('oauth2.googleapis.com/token') ? J(200, { access_token: 'AT' }) : J(503, {});
  r = res(); await gbp.stats(req('a@x.co'), r); assert.equal(r.code, 502); assert.equal(conns[0].status, 'active');

  // disconnect deletes (and revokes best effort)
  let revoked = false; google = (url) => { if (url.includes('/revoke')) revoked = true; return J(200, {}); };
  r = res(); await gbp.disconnect(req('a@x.co'), r); assert.equal(r.code, 200); assert.equal(conns.length, 0); assert.equal(revoked, true);

  // table missing
  missing = true;
  r = res(); await gbp.stats(req('a@x.co'), r); assert.equal(r.code, 503); assert.equal(r.body.code, 'gbp_not_migrated');
  r = res(); await gbp.status(req('a@x.co'), r); assert.equal(r.body.connected, false);

  console.log('gbp controller checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
