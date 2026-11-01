// Google calls for the Business Profile connection (Stage 6.3). Every function takes the fetch
// implementation as a parameter so it can be tested without the network. Tokens and secrets are
// never logged; error messages carry Google's short error code only.
//
// APIs used (all behind the scope business.manage):
//   OAuth:        accounts.google.com/o/oauth2/v2/auth, oauth2.googleapis.com/token, /revoke
//   Accounts:     mybusinessaccountmanagement.googleapis.com/v1/accounts
//   Locations:    mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
//   Performance:  businessprofileperformance.googleapis.com/v1/{location}:fetchMultiDailyMetricsTimeSeries

import { GBP_OAUTH_SCOPE } from '../config/gbp';

export type Fetch = typeof fetch;
export interface OAuthCfg { clientId: string; clientSecret: string; redirectUri: string }

export class GbpError extends Error {
  constructor(public readonly code: 'exchange' | 'no_refresh_token' | 'revoked' | 'google', message?: string) { super(message ?? code); }
}

export function authUrl(cfg: OAuthCfg, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: GBP_OAUTH_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

async function tokenCall(form: Record<string, string>, f: Fetch): Promise<Record<string, unknown>> {
  const r = await f('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    if (body.error === 'invalid_grant') throw new GbpError('revoked');
    throw new GbpError('exchange', typeof body.error === 'string' ? body.error : `http_${r.status}`);
  }
  return body;
}

export async function exchangeCode(code: string, cfg: OAuthCfg, f: Fetch = fetch): Promise<{ refreshToken: string; scope: string | null }> {
  const b = await tokenCall({
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code',
  }, f);
  if (typeof b.refresh_token !== 'string' || !b.refresh_token) throw new GbpError('no_refresh_token');
  const scope = typeof b.scope === 'string' ? b.scope : null;
  if (scope && !scope.split(' ').includes(GBP_OAUTH_SCOPE)) throw new GbpError('exchange', 'scope_not_granted');
  return { refreshToken: b.refresh_token, scope };
}

export async function accessTokenFrom(refreshToken: string, cfg: OAuthCfg, f: Fetch = fetch): Promise<string> {
  const b = await tokenCall({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }, f);
  if (typeof b.access_token !== 'string') throw new GbpError('exchange', 'no_access_token');
  return b.access_token;
}

/** Best effort: failing to revoke must never block a customer from disconnecting. */
export async function revokeToken(token: string, f: Fetch = fetch): Promise<void> {
  try {
    await f('https://oauth2.googleapis.com/revoke', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(),
    });
  } catch { /* ignore */ }
}

async function getJson(url: string, access: string, f: Fetch): Promise<Record<string, any>> {
  const r = await f(url, { headers: { authorization: `Bearer ${access}` } });
  const body = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (r.status === 401) throw new GbpError('revoked');
  if (!r.ok) throw new GbpError('google', `http_${r.status}${body?.error?.status ? ':' + body.error.status : ''}`);
  return body;
}

export interface GbpLocation { name: string; title: string; placeId: string | null }

/** All locations the signed-in Google user can read (first 100 per account, at most 5 accounts). */
export async function listLocations(access: string, f: Fetch = fetch): Promise<GbpLocation[]> {
  const accounts = await getJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', access, f);
  const out: GbpLocation[] = [];
  for (const a of ((accounts.accounts ?? []) as { name?: string }[]).slice(0, 5)) {
    if (!a.name || !/^accounts\/[\w-]+$/.test(a.name)) continue;
    const l = await getJson(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,metadata&pageSize=100`, access, f);
    for (const loc of (l.locations ?? []) as { name?: string; title?: string; metadata?: { placeId?: string } }[]) {
      if (loc.name && /^locations\/[\w-]+$/.test(loc.name)) out.push({ name: loc.name, title: loc.title ?? '', placeId: loc.metadata?.placeId ?? null });
    }
  }
  return out;
}

/** Saved choice first, then the location whose Google place equals a business the customer saved, then a single location. */
export function pickLocation(locs: GbpLocation[], saved: string | null, placeIds: string[]): GbpLocation | null {
  const s = saved ? locs.find((l) => l.name === saved) : undefined;
  if (s) return s;
  const m = locs.find((l) => l.placeId && placeIds.includes(l.placeId));
  if (m) return m;
  return locs.length === 1 ? locs[0] : null;
}

export interface Totals { calls: number; directions: number; website: number; impressions: number }
const METRICS = [
  'CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
] as const;

/** Last `days` days ending 2 days ago (Google's numbers lag by a couple of days). */
export function dateRange(now: Date, days = 30): { start: { y: number; m: number; d: number }; end: { y: number; m: number; d: number } } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const p = (x: Date) => ({ y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() });
  return { start: p(start), end: p(end) };
}

/** Adds up the daily values. Google omits a day's value when it is zero and sends numbers as strings. */
export function sumSeries(resp: any): Totals {
  const t: Totals = { calls: 0, directions: 0, website: 0, impressions: 0 };
  for (const m of resp?.multiDailyMetricTimeSeries ?? []) {
    for (const s of m?.dailyMetricTimeSeries ?? []) {
      const sum = ((s?.timeSeries?.datedValues ?? []) as { value?: string }[]).reduce((n, v) => n + (Number(v.value) || 0), 0);
      if (s?.dailyMetric === 'CALL_CLICKS') t.calls += sum;
      else if (s?.dailyMetric === 'BUSINESS_DIRECTION_REQUESTS') t.directions += sum;
      else if (s?.dailyMetric === 'WEBSITE_CLICKS') t.website += sum;
      else if (typeof s?.dailyMetric === 'string' && s.dailyMetric.startsWith('BUSINESS_IMPRESSIONS_')) t.impressions += sum;
    }
  }
  return t;
}

export async function fetchTotals(access: string, location: string, now: Date, f: Fetch = fetch): Promise<{ totals: Totals; days: number }> {
  if (!/^locations\/[\w-]+$/.test(location)) throw new GbpError('google', 'bad_location');
  const { start, end } = dateRange(now);
  const q = new URLSearchParams();
  for (const m of METRICS) q.append('dailyMetrics', m);
  q.set('dailyRange.start_date.year', String(start.y)); q.set('dailyRange.start_date.month', String(start.m)); q.set('dailyRange.start_date.day', String(start.d));
  q.set('dailyRange.end_date.year', String(end.y)); q.set('dailyRange.end_date.month', String(end.m)); q.set('dailyRange.end_date.day', String(end.d));
  const body = await getJson(`https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q.toString()}`, access, f);
  return { totals: sumSeries(body), days: 30 };
}
