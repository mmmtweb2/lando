// Run: npx ts-node --transpile-only scripts/test-gbp.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { supabase } from '../src/config/supabase';
import { decryptToken, encryptToken, signState, verifyState } from '../src/services/gbpCrypto';
import {
  GbpError, accessTokenFrom, authUrl, dateRange, exchangeCode, fetchTotals, listLocations, pickLocation, sumSeries,
} from '../src/services/gbpGoogle';
import { gbpConnectEnabled, gbpOAuthConfig } from '../src/config/gbp';

const key = crypto.randomBytes(32);
const cfg = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'GOCSPX-x', redirectUri: 'https://api.pagey.co.il/api/seo/gbp/oauth/callback' };

// ---------- crypto ----------
const blob = encryptToken('1//refresh-token', key);
assert.ok(!blob.includes('refresh-token'));
assert.equal(decryptToken(blob, key), '1//refresh-token');
assert.notEqual(encryptToken('1//refresh-token', key), blob, 'random IV');
assert.equal(decryptToken(blob, crypto.randomBytes(32)), null, 'wrong key');
assert.equal(decryptToken(blob.slice(0, -3) + 'AAA', key), null, 'tampered');
assert.equal(decryptToken('garbage', key), null);

// ---------- state ----------
const t0 = 1_000_000;
const st = signState('a@x.co', key, t0);
assert.equal(verifyState(st, key, t0 + 1000)?.email, 'a@x.co');
assert.equal(verifyState(st, key, t0 + 11 * 60 * 1000), null, 'expired');
assert.equal(verifyState(st, crypto.randomBytes(32), t0), null, 'other key');
const [body, mac] = st.split('.');
const forged = Buffer.from(JSON.stringify({ email: 'evil@x.co', exp: t0 + 99999, n: 'x' })).toString('base64url');
assert.equal(verifyState(`${forged}.${mac}`, key, t0), null, 'payload swapped');
assert.equal(verifyState(body, key, t0), null);
assert.equal(verifyState(undefined, key), null);

// ---------- auth URL ----------
const u = new URL(authUrl(cfg, 'STATE'));
assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/business.manage');
assert.equal(u.searchParams.get('access_type'), 'offline');
assert.equal(u.searchParams.get('prompt'), 'consent');
assert.equal(u.searchParams.get('redirect_uri'), cfg.redirectUri);
assert.equal(u.searchParams.get('state'), 'STATE');
assert.ok(!u.toString().includes('GOCSPX'), 'secret never in the browser URL');

// ---------- token calls ----------
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const seen: { url: string; init?: RequestInit }[] = [];
const mk = (handler: (url: string) => Response): typeof fetch => (async (url: any, init?: any) => { seen.push({ url: String(url), init }); return handler(String(url)); }) as any;

(async () => {
  let r = await exchangeCode('CODE', cfg, mk(() => json(200, { refresh_token: 'RT', access_token: 'AT', scope: 'https://www.googleapis.com/auth/business.manage' })));
  assert.equal(r.refreshToken, 'RT');
  const form = new URLSearchParams(String(seen[0].init?.body));
  assert.equal(form.get('grant_type'), 'authorization_code'); assert.equal(form.get('code'), 'CODE'); assert.equal(form.get('client_secret'), 'GOCSPX-x');
  await assert.rejects(exchangeCode('C', cfg, mk(() => json(200, { access_token: 'AT' }))), (e: any) => e instanceof GbpError && e.code === 'no_refresh_token');
  await assert.rejects(exchangeCode('C', cfg, mk(() => json(200, { refresh_token: 'RT', scope: 'email' }))), (e: any) => e.message === 'scope_not_granted');
  await assert.rejects(exchangeCode('C', cfg, mk(() => json(400, { error: 'invalid_grant' }))), (e: any) => e.code === 'revoked');
  assert.equal(await accessTokenFrom('RT', cfg, mk(() => json(200, { access_token: 'AT2' }))), 'AT2');
  await assert.rejects(accessTokenFrom('RT', cfg, mk(() => json(400, { error: 'invalid_grant' }))), (e: any) => e.code === 'revoked');

  // ---------- locations ----------
  seen.length = 0;
  const locs = await listLocations('AT', mk((url) => {
    if (url.includes('mybusinessaccountmanagement')) return json(200, { accounts: [{ name: 'accounts/111' }, { name: '../evil' }] });
    return json(200, { locations: [{ name: 'locations/1', title: 'שרברב דני', metadata: { placeId: 'ChIJa' } }, { name: 'bad', title: 'x' }, { name: 'locations/2', title: 'סניף' }] });
  }));
  assert.deepEqual(locs, [{ name: 'locations/1', title: 'שרברב דני', placeId: 'ChIJa', account: 'accounts/111' }, { name: 'locations/2', title: 'סניף', placeId: null, account: 'accounts/111' }]);
  assert.ok(seen.every((s) => (s.init?.headers as any).authorization === 'Bearer AT'));
  assert.ok(seen.some((s) => s.url.includes('/accounts/111/locations?readMask=name,title,metadata')));
  assert.equal(seen.filter((s) => s.url.includes('evil')).length, 0, 'malformed account names are skipped');

  // pick: saved > place match > single > none
  assert.equal(pickLocation(locs, 'locations/2', ['ChIJa'])?.name, 'locations/2');
  assert.equal(pickLocation(locs, null, ['ChIJa'])?.name, 'locations/1');
  assert.equal(pickLocation(locs, 'locations/gone', [])?.name, undefined);
  assert.equal(pickLocation([locs[0]], null, [])?.name, 'locations/1');
  assert.equal(pickLocation(locs, null, ['other']), null);

  // ---------- metrics ----------
  const rng = dateRange(new Date(Date.UTC(2026, 10, 1)), 30);
  assert.deepEqual(rng.end, { y: 2026, m: 10, d: 30 });
  assert.deepEqual(rng.start, { y: 2026, m: 10, d: 1 });
  const resp = { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
    { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: {}, value: '3' }, { date: {} }, { date: {}, value: '4' }] } },
    { dailyMetric: 'BUSINESS_DIRECTION_REQUESTS', timeSeries: { datedValues: [{ value: '2' }] } },
    { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: [] } },
    { dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', timeSeries: { datedValues: [{ value: '100' }] } },
    { dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', timeSeries: { datedValues: [{ value: '20' }] } },
  ] }] };
  assert.deepEqual(sumSeries(resp), { calls: 7, directions: 2, website: 0, impressions: 120 });
  assert.deepEqual(sumSeries({}), { calls: 0, directions: 0, website: 0, impressions: 0 });
  seen.length = 0;
  const out = await fetchTotals('AT', 'locations/1', new Date(Date.UTC(2026, 10, 1)), mk(() => json(200, resp)));
  assert.equal(out.totals.calls, 7);
  const q = new URL(seen[0].url);
  assert.equal(q.pathname, '/v1/locations/1:fetchMultiDailyMetricsTimeSeries');
  assert.equal(q.searchParams.getAll('dailyMetrics').length, 7);
  assert.equal(q.searchParams.get('dailyRange.end_date.day'), '30');
  await assert.rejects(fetchTotals('AT', 'locations/1/../x', new Date(), mk(() => json(200, {}))));
  await assert.rejects(fetchTotals('AT', 'locations/1', new Date(), mk(() => json(401, {}))), (e: any) => e.code === 'revoked');
  await assert.rejects(fetchTotals('AT', 'locations/1', new Date(), mk(() => json(403, { error: { status: 'PERMISSION_DENIED' } }))), (e: any) => e.message === 'metrics:http_403:PERMISSION_DENIED');

  // ---------- config switch ----------
  const good = {
    GOOGLE_OAUTH_CLIENT_ID: 'a.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-abc', GBP_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32),
    PUBLIC_API_URL: 'https://api.pagey.co.il',
  };
  assert.equal(gbpConnectEnabled(good), false, 'off without the switch');
  assert.equal(gbpConnectEnabled({ ...good, GBP_CONNECT_ENABLED: 'true' }), true);
  assert.equal(gbpConnectEnabled({ ...good, GBP_CONNECT_ENABLED: 'true', GBP_TOKEN_ENCRYPTION_KEY: 'short' }), false, 'bad key keeps it off');
  assert.equal(gbpOAuthConfig(good), null);
  assert.equal(gbpOAuthConfig({ ...good, GBP_CONNECT_ENABLED: 'true' })?.redirectUri, 'https://api.pagey.co.il/api/seo/gbp/oauth/callback');

  console.log('gbp checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
