// Run: npx ts-node --transpile-only scripts/test-gbp-diagnose.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { encryptToken } from '../src/services/gbpCrypto';
import { allowRun, readGoogleError, resetRunGuard, runDiagnosis, verdictOf, type Step } from '../src/services/gbpDiagnose.service';

const KEY = 'ab'.repeat(32);
const setEnv = () => Object.assign(process.env, {
  GBP_CONNECT_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: '347917250920-abc.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-secret-value',
  GBP_TOKEN_ENCRYPTION_KEY: KEY, PUBLIC_API_URL: 'https://api.pagey.co.il',
});
setEnv();
let conn: Record<string, unknown> | null = { email: 'a@x.co', refresh_token_enc: encryptToken('REFRESH-TOKEN-123', Buffer.from(KEY, 'hex')), location_name: 'locations/111', status: 'active' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(supabase as any).from = (t: string) => {
  const q: any = { select: () => q, eq: () => q, update: () => q, maybeSingle: async () => ({ data: t === 'gbp_connections' ? conn : null, error: null }), then: (r: (x: unknown) => unknown) => r({ data: null, error: null }) };
  return q;
};

type Route = { match: RegExp; status: number; body: unknown };
const calls: string[] = [];
const fakeFetch = (routes: Route[]) => (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url); calls.push(`${init?.method ?? 'GET'} ${u}`);
  const r = routes.find((x) => x.match.test(u));
  if (!r) throw new Error(`unexpected ${u}`);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

const TOKEN: Route = { match: /oauth2\.googleapis\.com\/token/, status: 200, body: { access_token: 'ACCESS-TOKEN-XYZ' } };
const OK: Route[] = [
  TOKEN,
  { match: /mybusinessaccountmanagement/, status: 200, body: { accounts: [{ name: 'accounts/9' }] } },
  { match: /mybusinessbusinessinformation.*\/accounts\/9\/locations/, status: 200, body: { locations: [{ name: 'locations/111', title: 'קפה' }] } },
  { match: /mybusinessbusinessinformation.*\/locations\/111\?readMask/, status: 200, body: { name: 'locations/111' } },
  { match: /businessprofileperformance/, status: 200, body: {} },
  { match: /mybusiness\.googleapis\.com\/v4/, status: 200, body: { reviews: [{ reviewId: 'abcde' }] } },
];
const QUOTA_BODY = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessbusinessinformation.googleapis.com' for consumer 'project_number:347917250920'.",
  details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED', domain: 'googleapis.com', metadata: { quota_metric: 'mybusinessbusinessinformation.googleapis.com/default_requests', quota_limit: 'DefaultRequestsPerMinutePerProject', quota_limit_value: '0', consumer: 'projects/347917250920', service: 'mybusinessbusinessinformation.googleapis.com' } }] } };

(async () => {
  // 1) everything works: eight steps, read-only
  resetRunGuard();
  let d = await runDiagnosis('a@x.co', fakeFetch(OK), new Date('2026-11-04T10:00:00Z'));
  assert.equal(d.verdict, 'works'); assert.deepEqual(d.steps.map((s) => s.key), ['config', 'connection', 'token', 'accounts', 'locations', 'location', 'performance', 'reviews']);
  assert.ok(d.steps.every((s) => s.ok)); assert.equal(d.project, '347917250920');
  assert.ok(calls.filter((c) => !c.includes('oauth2.googleapis.com')).every((c) => c.startsWith('GET ')), 'only GET requests go to Google APIs (the token refresh is the only POST)');
  assert.equal(calls.filter((c) => c.startsWith('POST ')).length, 1);
  const blob = JSON.stringify(d);
  for (const secret of ['ACCESS-TOKEN-XYZ', 'REFRESH-TOKEN-123', 'GOCSPX-secret-value']) assert.equal(blob.includes(secret), false, `${secret} must not be in the report`);
  assert.equal(d.steps.find((s) => s.key === 'locations')!.detail, '1 מיקומים בחשבון הראשון');

  // 2) the reported scenario: approved project but quota 0 on Business Information -> full Google error is shown
  d = await runDiagnosis('a@x.co', fakeFetch([TOKEN, OK[1], { match: /mybusinessbusinessinformation/, status: 429, body: QUOTA_BODY }]));
  assert.equal(d.verdict, 'quota');
  const bad = d.steps.find((s) => !s.ok && !s.skipped)!;
  assert.deepEqual([bad.key, bad.httpStatus, bad.googleStatus], ['locations', 429, 'RESOURCE_EXHAUSTED']);
  assert.ok(bad.message!.includes('Requests per minute')); assert.deepEqual(bad.reasons, ['RATE_LIMIT_EXCEEDED']);
  assert.ok(bad.quota!.includes('quota_limit_value=0') && bad.quota!.includes('consumer=projects/347917250920'));
  assert.equal(d.project, '347917250920'); assert.ok(d.summary.includes('mybusinessbusinessinformation.googleapis.com'));
  assert.deepEqual(d.steps.slice(-3).map((s) => s.skipped), [true, true, true], 'later steps are skipped, not guessed');

  // 3) API not enabled in the project
  d = await runDiagnosis('a@x.co', fakeFetch([TOKEN, { match: /mybusinessaccountmanagement/, status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'My Business Account Management API has not been used in project 347917250920 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'mybusinessaccountmanagement.googleapis.com', consumer: 'projects/347917250920' } }] } } }]));
  assert.equal(d.verdict, 'api_disabled'); assert.ok(d.summary.includes('mybusinessaccountmanagement.googleapis.com'));
  // 4) plain permission refusal
  d = await runDiagnosis('a@x.co', fakeFetch([...OK.slice(0, 3), { match: /locations\/111\?readMask/, status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } } }, OK[4], OK[5]]));
  assert.equal(d.verdict, 'permission'); assert.equal(d.steps.find((s) => s.key === 'location')!.ok, false);
  assert.equal(d.steps.find((s) => s.key === 'performance')!.ok, true, 'independent steps still run after one failure');
  // 5) revoked / expired refresh token
  d = await runDiagnosis('a@x.co', fakeFetch([{ match: /oauth2\.googleapis\.com\/token/, status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }]));
  assert.equal(d.verdict, 'reconnect'); assert.equal(d.steps.find((s) => s.key === 'accounts')!.skipped, true);
  // 6) not connected / not configured
  conn = null; d = await runDiagnosis('a@x.co', fakeFetch([]));
  assert.equal(d.verdict, 'not_connected'); conn = { email: 'a@x.co', refresh_token_enc: 'garbage', location_name: null, status: 'active' };
  d = await runDiagnosis('a@x.co', fakeFetch([]));
  assert.equal(d.verdict, 'reconnect', 'undecryptable token');
  delete process.env.GBP_CONNECT_ENABLED; d = await runDiagnosis('a@x.co', fakeFetch([]));
  assert.equal(d.verdict, 'config'); assert.equal(d.steps.length, 8); setEnv();
  // 7) network failure on a step
  conn = { email: 'a@x.co', refresh_token_enc: encryptToken('R', Buffer.from(KEY, 'hex')), location_name: null, status: 'active' };
  d = await runDiagnosis('a@x.co', (async (u: string) => { if (String(u).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'A' }), { status: 200 }); throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
  assert.equal(d.verdict, 'unknown'); assert.ok(d.steps.find((s) => s.key === 'accounts')!.message!.startsWith('network:'));

  // helpers
  assert.deepEqual([readGoogleError(null).reasons, readGoogleError(null).quota], [[], []]);
  assert.equal(verdictOf([{ key: 'config', label: 'x', ok: true } as Step]).verdict, 'works');
  resetRunGuard(); assert.equal(allowRun(100000), true); assert.equal(allowRun(105000), false, 'one run per 10 seconds'); assert.equal(allowRun(112000), true);
  console.log('gbp diagnose checks passed');
})();
