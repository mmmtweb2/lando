import type { Request, Response } from 'express';
import { GBP_CALLBACK_PATH, gbpAllowedFor, gbpConnectEnabled, gbpOAuthConfig } from '../config/gbp';
import { decryptToken, encryptToken, newBrowserNonce, signState, stateMatchesBrowser, verifyState } from '../services/gbpCrypto';
import {
  GbpError, accessTokenFrom, authUrl, exchangeCode, fetchTotals, listLocations, pickLocation, revokeToken,
} from '../services/gbpGoogle';
import {
  GbpStoreError, deleteConnection, getConnection, markNeedsReconnect, saveConnection, setLocation,
} from '../services/gbpStore';
import { listBusinesses } from '../services/seoBusinesses.service';

// Stage 6.3: the customer connects their own Google account so the dashboard can show the numbers
// of their Business Profile. Off unless GBP_CONNECT_ENABLED=true and the settings are valid.
// Nothing from Google is stored except the encrypted refresh token and the chosen location id.

const APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const disabled = (res: Response) => res.status(503).json({ error: 'החיבור לגוגל עדיין לא הופעל.', code: 'gbp_disabled' });
const needAuth = (res: Response) => res.status(401).json({ error: 'נדרשת התחברות.' });

function fail(res: Response, e: unknown): void {
  if (e instanceof GbpStoreError && e.code === 'not_migrated') { res.status(503).json({ error: 'החיבור לגוגל עדיין לא הופעל.', code: 'gbp_not_migrated' }); return; }
  console.error('[GBP]', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
  res.status(500).json({ error: 'משהו השתבש. נסו שוב.' });
}

/** GET /api/seo/gbp/status — never fails the page. */
export async function status(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { needAuth(res); return; }
  const enabled = gbpConnectEnabled() && gbpAllowedFor(email);
  if (!enabled) { res.json({ enabled: false, connected: false, needsReconnect: false }); return; }
  try {
    const c = await getConnection(email);
    res.json({ enabled: true, connected: !!c, needsReconnect: c?.status === 'needs_reconnect' });
  } catch { res.json({ enabled: true, connected: false, needsReconnect: false }); }
}

// OAuth login-CSRF defence. The signed `state` alone only proves WHICH ACCOUNT started the flow, not
// that the browser finishing it is the same one: an attacker could start a flow on their own
// account, then lure a logged-in victim to the resulting callback URL. So start also sets a
// short-lived httpOnly SameSite=Lax cookie holding a random nonce; the state carries its hash and
// the callback requires both to match. The cookie is scoped to the callback path, cleared on every
// callback (single use), and each state may complete only once.
export const GBP_NONCE_COOKIE = 'gbp_oauth_nonce';
const NONCE_TTL_MS = 10 * 60 * 1000;
const nonceCookieOpts = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,           // Lax: the cookie must accompany Google's top-level GET redirect back to us
  secure: process.env.NODE_ENV === 'production',
  path: GBP_CALLBACK_PATH,
  ...(process.env.GBP_COOKIE_DOMAIN ? { domain: process.env.GBP_COOKIE_DOMAIN } : {}),
});

/** state `n` values already redeemed (in memory, like the rate limiter; entries expire with the state). */
const usedStates = new Map<string, number>();
function markStateUsed(n: string, now = Date.now()): boolean {
  for (const [k, exp] of usedStates) if (exp < now) usedStates.delete(k);
  if (usedStates.has(n)) return false;
  usedStates.set(n, now + NONCE_TTL_MS + 60_000);
  return true;
}

/** GET /api/seo/gbp/oauth/start — returns the Google consent URL (the page then navigates to it). */
export async function start(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { needAuth(res); return; }
  const cfg = gbpOAuthConfig();
  if (!cfg || !gbpAllowedFor(email)) { disabled(res); return; }
  const nonce = newBrowserNonce();
  res.cookie(GBP_NONCE_COOKIE, nonce, { ...nonceCookieOpts(), maxAge: NONCE_TTL_MS });
  res.json({ url: authUrl(cfg, signState(email, cfg.key, Date.now(), NONCE_TTL_MS, nonce)) });
}

/** GET /api/seo/gbp/oauth/callback — the browser comes back from Google. Public by nature; trusts only the signed state bound to this browser's cookie. */
export async function callback(req: Request, res: Response): Promise<void> {
  const to = (s: string) => res.redirect(`${APP_URL}/dashboard?gbp=${s}`);
  const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const cookieNonce = cookies?.[GBP_NONCE_COOKIE];
  // Single use: whatever happens next, this browser's nonce is spent.
  res.clearCookie(GBP_NONCE_COOKIE, nonceCookieOpts());
  const cfg = gbpOAuthConfig();
  if (!cfg) { to('error'); return; }
  if (typeof req.query.error === 'string') { to('denied'); return; }
  const st = verifyState(req.query.state, cfg.key);
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!st || !code || code.length > 2000 || !gbpAllowedFor(st.email)) { to('error'); return; }
  // Browser binding: a missing cookie, a wrong cookie, or a state minted without a binding all fail.
  if (!stateMatchesBrowser(st, cookieNonce)) {
    console.warn('[GBP] callback refused: state is not bound to this browser (missing/mismatched nonce cookie)');
    to('error');
    return;
  }
  if (!markStateUsed(st.n)) { console.warn('[GBP] callback refused: state already used'); to('error'); return; }
  try {
    const { refreshToken, scope } = await exchangeCode(code, cfg);
    await saveConnection(st.email, encryptToken(refreshToken, cfg.key), scope);
    to('ok');
  } catch (e) {
    console.error('[GBP] connect failed:', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
    to('error');
  }
}

/** POST /api/seo/gbp/disconnect */
export async function disconnect(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { needAuth(res); return; }
  const cfg = gbpOAuthConfig();
  try {
    const c = await getConnection(email);
    if (c && cfg) { const t = decryptToken(c.refresh_token_enc, cfg.key); if (t) await revokeToken(t); }
    await deleteConnection(email);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
}

/** GET /api/seo/gbp/stats — last 30 days, fetched live. Not stored. */
export async function stats(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { needAuth(res); return; }
  const cfg = gbpOAuthConfig();
  if (!cfg || !gbpAllowedFor(email)) { disabled(res); return; }
  try {
    const c = await getConnection(email);
    if (!c) { res.status(409).json({ error: 'החשבון עדיין לא מחובר.', code: 'not_connected' }); return; }
    const refresh = decryptToken(c.refresh_token_enc, cfg.key);
    if (!refresh) { await markNeedsReconnect(email, 'undecryptable'); res.status(409).json({ error: 'צריך להתחבר מחדש.', code: 'needs_reconnect' }); return; }
    let access: string;
    try { access = await accessTokenFrom(refresh, cfg); } catch (e) {
      if (e instanceof GbpError && e.code === 'revoked') { await markNeedsReconnect(email, 'revoked'); res.status(409).json({ error: 'צריך להתחבר מחדש.', code: 'needs_reconnect' }); return; }
      throw e;
    }
    const locs = await listLocations(access);
    const placeIds = (await listBusinesses(email)).map((b) => b.google_place_id).filter((x): x is string => !!x);
    const loc = pickLocation(locs, c.location_name, placeIds);
    if (!loc) {
      res.json({ needsChoice: true, locations: locs.map((l) => ({ name: l.name, title: l.title })) });
      return;
    }
    if (loc.name !== c.location_name) await setLocation(email, loc.name);
    const { totals, days } = await fetchTotals(access, loc.name, new Date());
    res.json({ location: { name: loc.name, title: loc.title }, days, totals });
  } catch (e) {
    if (e instanceof GbpError && e.code === 'revoked') { await markNeedsReconnect(email, 'revoked').catch(() => undefined); res.status(409).json({ error: 'צריך להתחבר מחדש.', code: 'needs_reconnect' }); return; }
    if (e instanceof GbpError && /:http_429:/.test(e.message)) {
      // Google gives new Business Profile API projects a 0 requests/minute quota until the access request is approved.
      console.error('[GBP] quota:', e.message.slice(0, 200));
      res.status(503).json({ error: 'ממשק Business Profile של גוגל עדיין לא אושר לפרויקט. החיבור תקין, והנתונים יופיעו אחרי אישור גוגל.', code: 'quota_pending' });
      return;
    }
    if (e instanceof GbpError) { console.error('[GBP] google error:', e.message); res.status(502).json({ error: 'לא הצלחנו לקרוא את הנתונים מגוגל. נסו שוב בעוד כמה דקות.', code: 'google_error' }); return; }
    fail(res, e);
  }
}

/** PUT /api/seo/gbp/location {location} — when the account holds several locations and none matches. */
export async function chooseLocation(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { needAuth(res); return; }
  const cfg = gbpOAuthConfig();
  if (!cfg || !gbpAllowedFor(email)) { disabled(res); return; }
  const want = (req.body as { location?: unknown } | undefined)?.location;
  if (typeof want !== 'string') { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try {
    const c = await getConnection(email);
    const refresh = c ? decryptToken(c.refresh_token_enc, cfg.key) : null;
    if (!c || !refresh) { res.status(409).json({ error: 'צריך להתחבר מחדש.', code: 'needs_reconnect' }); return; }
    const locs = await listLocations(await accessTokenFrom(refresh, cfg));
    if (!locs.some((l) => l.name === want)) { res.status(400).json({ error: 'המיקום לא נמצא בחשבון.' }); return; }
    await setLocation(email, want);
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof GbpError) { res.status(502).json({ error: 'לא הצלחנו לקרוא את הנתונים מגוגל.', code: 'google_error' }); return; }
    fail(res, e);
  }
}
