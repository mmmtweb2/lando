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

async function getJson(url: string, access: string, f: Fetch, step = 'google'): Promise<Record<string, any>> {
  const r = await f(url, { headers: { authorization: `Bearer ${access}` } });
  const body = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (r.status === 401) throw new GbpError('revoked');
  if (!r.ok) {
    // Google's own short reason (no tokens or secrets in it) so an operator can see what to fix.
    const why = typeof body?.error?.message === 'string' ? ':' + body.error.message.replace(/\s+/g, ' ').slice(0, 160) : '';
    throw new GbpError('google', `${step}:http_${r.status}${body?.error?.status ? ':' + body.error.status : ''}${why}`);
  }
  return body;
}

export interface GbpLocation { name: string; title: string; placeId: string | null; account?: string }

/** All locations the signed-in Google user can read (first 100 per account, at most 5 accounts). */
export async function listLocations(access: string, f: Fetch = fetch): Promise<GbpLocation[]> {
  const accounts = await getJson('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', access, f, 'accounts');
  const out: GbpLocation[] = [];
  for (const a of ((accounts.accounts ?? []) as { name?: string }[]).slice(0, 5)) {
    if (!a.name || !/^accounts\/[\w-]+$/.test(a.name)) continue;
    const l = await getJson(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,metadata&pageSize=100`, access, f, 'locations');
    for (const loc of (l.locations ?? []) as { name?: string; title?: string; metadata?: { placeId?: string } }[]) {
      if (loc.name && /^locations\/[\w-]+$/.test(loc.name)) out.push({ name: loc.name, title: loc.title ?? '', placeId: loc.metadata?.placeId ?? null, account: a.name });
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
  const body = await getJson(`https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${q.toString()}`, access, f, 'metrics');
  return { totals: sumSeries(body), days: 30 };
}

// ── Reviews (My Business API v4: the only API that lists reviews and posts replies) ──
export interface GbpReview { id: string; rating: number; createdAt: string; reviewer: string | null; hasReply: boolean; text: string }
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/** Google sends the star rating as a word and omits fields freely; anything unusable is skipped. */
export function parseReviews(resp: any): GbpReview[] {
  const out: GbpReview[] = [];
  for (const r of (resp?.reviews ?? []) as any[]) {
    const id = typeof r?.reviewId === 'string' ? r.reviewId : '';
    const rating = STARS[String(r?.starRating)] ?? 0;
    const createdAt = typeof r?.createTime === 'string' ? r.createTime : '';
    if (!/^[\w-]{5,200}$/.test(id) || !rating || !createdAt || Number.isNaN(Date.parse(createdAt))) continue;
    out.push({
      id, rating, createdAt,
      reviewer: r?.reviewer?.isAnonymous ? null : (typeof r?.reviewer?.displayName === 'string' ? r.reviewer.displayName : null),
      hasReply: !!(r?.reviewReply && typeof r.reviewReply.comment === 'string' && r.reviewReply.comment.trim()),
      text: typeof r?.comment === 'string' ? r.comment.slice(0, 1500) : '',
    });
  }
  return out;
}

const ACCOUNT_RE = /^accounts\/[\w-]+$/;
const LOCATION_RE = /^locations\/[\w-]+$/;

/** Newest 50 reviews of a location. Fetched live; the caller keeps only what it needs. */
export async function listReviews(access: string, account: string, location: string, f: Fetch = fetch): Promise<GbpReview[]> {
  if (!ACCOUNT_RE.test(account) || !LOCATION_RE.test(location)) throw new GbpError('google', 'bad_location');
  const body = await getJson(`https://mybusiness.googleapis.com/v4/${account}/${location}/reviews?pageSize=50&orderBy=updateTime%20desc`, access, f, 'reviews');
  return parseReviews(body);
}

/** Publishes (or replaces) the owner's reply to one review. Called only after the owner approved the text. */
export async function postReply(access: string, account: string, location: string, reviewId: string, comment: string, f: Fetch = fetch): Promise<void> {
  if (!ACCOUNT_RE.test(account) || !LOCATION_RE.test(location) || !/^[\w-]{5,200}$/.test(reviewId)) throw new GbpError('google', 'bad_location');
  const r = await f(`https://mybusiness.googleapis.com/v4/${account}/${location}/reviews/${reviewId}/reply`, {
    method: 'PUT', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: JSON.stringify({ comment }),
  });
  if (r.status === 401) throw new GbpError('revoked');
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as Record<string, any>;
    throw new GbpError('google', `reply:http_${r.status}${body?.error?.status ? ':' + body.error.status : ''}`);
  }
}

// ── Location details (Business Information API v1) ──
// The full profile of ONE location: what the customer wrote in their Google card. Parsed by
// businessTruth.ts. UNVERIFIED against live Google for every field: covered by tests with fake responses.
export const LOCATION_DETAIL_MASK = 'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,serviceArea,profile,serviceItems,metadata,openInfo';

export async function fetchLocationDetail(access: string, location: string, f: Fetch = fetch): Promise<Record<string, any>> {
  if (!LOCATION_RE.test(location)) throw new GbpError('google', 'bad_location');
  return getJson(`https://mybusinessbusinessinformation.googleapis.com/v1/${location}?readMask=${LOCATION_DETAIL_MASK}`, access, f, 'location');
}

// ── Local posts (My Business API v4: the only API that publishes posts to a profile) ──
export const MAX_POST_LEN = 1500;
export type PostCta = 'CALL' | 'LEARN_MORE';
export interface NewLocalPost { summary: string; cta?: PostCta | null; url?: string | null }

/** The request body Google expects. A CALL button uses the profile's phone and must carry no url. */
export function localPostBody(p: NewLocalPost): Record<string, unknown> {
  const body: Record<string, unknown> = { languageCode: 'he', topicType: 'STANDARD', summary: p.summary };
  if (p.cta === 'CALL') body.callToAction = { actionType: 'CALL' };
  else if (p.cta === 'LEARN_MORE' && p.url && /^https:\/\/[^\s]+$/.test(p.url)) body.callToAction = { actionType: 'LEARN_MORE', url: p.url };
  return body;
}

/**
 * Publishes one post. Returns Google's resource name (accounts/…/locations/…/localPosts/…) and
 * state. Called only for an account whose owner approved automatic posts, or pressed "publish".
 */
export async function createLocalPost(access: string, account: string, location: string, p: NewLocalPost, f: Fetch = fetch): Promise<{ name: string | null; state: string | null }> {
  if (!ACCOUNT_RE.test(account) || !LOCATION_RE.test(location)) throw new GbpError('google', 'bad_location');
  const summary = p.summary.trim();
  if (summary.length < 20 || summary.length > MAX_POST_LEN) throw new GbpError('google', 'bad_post_text');
  const r = await f(`https://mybusiness.googleapis.com/v4/${account}/${location}/localPosts`, {
    method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: JSON.stringify(localPostBody({ ...p, summary })),
  });
  const body = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (r.status === 401) throw new GbpError('revoked');
  if (!r.ok) throw new GbpError('google', `post:http_${r.status}${body?.error?.status ? ':' + body.error.status : ''}`);
  return { name: typeof body.name === 'string' ? body.name : null, state: typeof body.state === 'string' ? body.state : null };
}

// ── Updating a location (Business Information API v1) ──
/** The only fields we ever write to a customer's listing. Anything else in a mask is refused here. */
export const WRITABLE_MASKS = ['profile.description', 'serviceItems'] as const;

/**
 * PATCHes the customer's listing. Called only after the customer approved their business details,
 * and only for the fields in WRITABLE_MASKS. UNVERIFIED against live Google.
 */
export async function patchLocation(access: string, location: string, body: Record<string, unknown>, mask: string[], f: Fetch = fetch): Promise<void> {
  if (!LOCATION_RE.test(location)) throw new GbpError('google', 'bad_location');
  if (!mask.length || mask.some((m) => !(WRITABLE_MASKS as readonly string[]).includes(m))) throw new GbpError('google', 'bad_mask');
  const r = await f(`https://mybusinessbusinessinformation.googleapis.com/v1/${location}?updateMask=${mask.join(',')}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 401) throw new GbpError('revoked');
  if (!r.ok) {
    const b = (await r.json().catch(() => ({}))) as Record<string, any>;
    throw new GbpError('google', `patch:http_${r.status}${b?.error?.status ? ':' + b.error.status : ''}`);
  }
}
