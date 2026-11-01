import type { Request, Response } from 'express';
import { gbpConnectEnabled, gbpOAuthConfig } from '../config/gbp';
import { decryptToken, encryptToken, signState, verifyState } from '../services/gbpCrypto';
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
  const enabled = gbpConnectEnabled();
  if (!enabled) { res.json({ enabled: false, connected: false, needsReconnect: false }); return; }
  try {
    const c = await getConnection(email);
    res.json({ enabled: true, connected: !!c, needsReconnect: c?.status === 'needs_reconnect' });
  } catch { res.json({ enabled: true, connected: false, needsReconnect: false }); }
}

/** GET /api/seo/gbp/oauth/start — returns the Google consent URL (the page then navigates to it). */
export async function start(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { needAuth(res); return; }
  const cfg = gbpOAuthConfig();
  if (!cfg) { disabled(res); return; }
  res.json({ url: authUrl(cfg, signState(email, cfg.key)) });
}

/** GET /api/seo/gbp/oauth/callback — the browser comes back from Google. Public by nature; trusts only the signed state. */
export async function callback(req: Request, res: Response): Promise<void> {
  const to = (s: string) => res.redirect(`${APP_URL}/dashboard?gbp=${s}`);
  const cfg = gbpOAuthConfig();
  if (!cfg) { to('error'); return; }
  if (typeof req.query.error === 'string') { to('denied'); return; }
  const st = verifyState(req.query.state, cfg.key);
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!st || !code || code.length > 2000) { to('error'); return; }
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
  if (!cfg) { disabled(res); return; }
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
    if (e instanceof GbpError) { console.error('[GBP] google error:', e.message); res.status(502).json({ error: 'לא הצלחנו לקרוא את הנתונים מגוגל. נסו שוב בעוד כמה דקות.', code: 'google_error' }); return; }
    fail(res, e);
  }
}

/** PUT /api/seo/gbp/location {location} — when the account holds several locations and none matches. */
export async function chooseLocation(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { needAuth(res); return; }
  const cfg = gbpOAuthConfig();
  if (!cfg) { disabled(res); return; }
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
