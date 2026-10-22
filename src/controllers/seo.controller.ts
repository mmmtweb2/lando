import { Request, Response } from 'express';
import {
  PlacesError, auditPlace, autocompleteBusinesses, fetchPlace, isValidPlaceId, placesConfigured,
} from '../services/places.service';
import { MAX_BUSINESSES_PER_ACCOUNT, addBusiness, listBusinesses, removeBusiness } from '../services/seoBusinesses.service';

// Per-account daily ceiling on Places calls — protects the Google bill from one
// account (or a stolen token). In-memory like middleware/rateLimit.ts: fine for a
// single instance; move to a shared store when scaling out.
const DAILY_LIMIT = 200;
const usage = new Map<string, { day: string; count: number }>();

function underDailyLimit(email: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(email);
  if (!u || u.day !== day) {
    usage.set(email, { day, count: 1 });
    return true;
  }
  if (u.count >= DAILY_LIMIT) return false;
  u.count += 1;
  return true;
}

function fail(res: Response, e: unknown): void {
  if (e instanceof PlacesError) {
    switch (e.code) {
      case 'not_configured':
        res.status(503).json({ error: 'חיפוש העסקים עדיין לא הופעל.', code: 'places_not_configured' });
        return;
      case 'bad_request':
        res.status(400).json({ error: 'הבקשה לא תקינה.' });
        return;
      case 'not_found':
        res.status(404).json({ error: 'העסק לא נמצא.' });
        return;
      default:
        res.status(502).json({ error: 'גוגל לא הגיבה. נסו שוב בעוד רגע.' });
        return;
    }
  }
  console.error('[SEO] unexpected error:', e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

/** POST /api/seo/places/autocomplete  { input, sessionToken? } */
export async function placesAutocomplete(req: Request, res: Response): Promise<void> {
  const email = req.authEmail!;
  const { input, sessionToken } = req.body ?? {};
  if (typeof input !== 'string') {
    res.status(400).json({ error: 'חסר טקסט לחיפוש.' });
    return;
  }
  if (!placesConfigured()) { fail(res, new PlacesError('not_configured', '')); return; }
  if (!underDailyLimit(email)) {
    res.status(429).json({ error: 'הגעתם למגבלת החיפושים היומית.' });
    return;
  }
  try {
    const suggestions = await autocompleteBusinesses(input, typeof sessionToken === 'string' ? sessionToken : undefined);
    res.json({ suggestions });
  } catch (e) {
    fail(res, e);
  }
}

/** GET /api/seo/places/:placeId/audit */
export async function placeAudit(req: Request, res: Response): Promise<void> {
  const email = req.authEmail!;
  const { placeId } = req.params;
  if (!isValidPlaceId(placeId)) {
    res.status(400).json({ error: 'מזהה עסק לא תקין.' });
    return;
  }
  if (!placesConfigured()) { fail(res, new PlacesError('not_configured', '')); return; }
  if (!underDailyLimit(email)) {
    res.status(429).json({ error: 'הגעתם למגבלת הבדיקות היומית.' });
    return;
  }
  try {
    res.json({ audit: await auditPlace(placeId) });
  } catch (e) {
    fail(res, e);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/seo/businesses — the account's saved businesses. */
export async function getBusinesses(req: Request, res: Response): Promise<void> {
  try {
    res.json({ businesses: await listBusinesses(req.authEmail!), max: MAX_BUSINESSES_PER_ACCOUNT });
  } catch (e) {
    console.error('[SEO] list businesses failed:', e);
    res.status(500).json({ error: 'שגיאה פנימית.' });
  }
}

/**
 * POST /api/seo/businesses { placeId } — the name is read from Google (never trusted from
 * the client). Places terms forbid storing Places content other than place_id, so only the
 * business name the customer just confirmed ("this is my business") is kept, and NOT the
 * website or anything else; everything else is fetched live when shown.
 */
export async function saveBusiness(req: Request, res: Response): Promise<void> {
  const email = req.authEmail!;
  const placeId = req.body?.placeId;
  if (!isValidPlaceId(placeId)) {
    res.status(400).json({ error: 'מזהה עסק לא תקין.' });
    return;
  }
  if (!placesConfigured()) { fail(res, new PlacesError('not_configured', '')); return; }
  if (!underDailyLimit(email)) {
    res.status(429).json({ error: 'הגעתם למגבלת הבדיקות היומית.' });
    return;
  }
  try {
    const place = await fetchPlace(placeId);
    const r = await addBusiness(email, {
      placeId: place.id,
      name: place.displayName?.text ?? '',
      websiteUrl: null,
    });
    if (!r.ok) {
      res.status(409).json({
        error: `אפשר לחבר עד ${MAX_BUSINESSES_PER_ACCOUNT} עסקים לחשבון. הסירו עסק קיים כדי להוסיף חדש.`,
        code: 'business_limit',
      });
      return;
    }
    res.status(r.created ? 201 : 200).json({ business: r.business });
  } catch (e) {
    if (e instanceof PlacesError) { fail(res, e); return; }
    console.error('[SEO] save business failed:', e);
    res.status(500).json({ error: 'שגיאה פנימית.' });
  }
}

/** DELETE /api/seo/businesses/:id — owner only. */
export async function deleteBusiness(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'מזהה לא תקין.' });
    return;
  }
  try {
    const removed = await removeBusiness(req.authEmail!, id);
    res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: 'העסק לא נמצא.' });
  } catch (e) {
    console.error('[SEO] delete business failed:', e);
    res.status(500).json({ error: 'שגיאה פנימית.' });
  }
}
