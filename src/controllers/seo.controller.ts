import { Request, Response } from 'express';
import {
  PlacesError, auditPlace, autocompleteBusinesses, isValidPlaceId, placesConfigured,
} from '../services/places.service';

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
