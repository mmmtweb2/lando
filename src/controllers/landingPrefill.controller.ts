import { Request, Response } from 'express';
import { PlacesError, fetchPlace, isValidPlaceId, placesConfigured } from '../services/places.service';
import { listBusinesses } from '../services/seoBusinesses.service';
import { DRAFT_NOTICE, mapPlaceToPrefill, underPrefillLimit } from '../services/landingPrefill.service';

/**
 * GET /api/landing/prefill-from-google/:businessId  (task #16)
 * Returns wizard prefill for a business the caller owns. One Places Details call, nothing stored.
 */
export async function prefillFromGoogle(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const email = req.authEmail!;
  const id = String(req.params.businessId ?? '');
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) { res.status(400).json({ error: 'הבקשה לא תקינה.' }); return; }
  try {
    // Ownership first: the id must belong to this account (the list is already scoped by email).
    const business = (await listBusinesses(email)).find(b => b.id === id);
    if (!business) { res.status(404).json({ error: 'העסק לא נמצא.' }); return; }
    if (!business.google_place_id || !isValidPlaceId(business.google_place_id)) {
      res.status(400).json({ error: 'לעסק הזה אין כרטיס בגוגל מחובר.', code: 'no_place' });
      return;
    }
    if (!placesConfigured()) { res.status(503).json({ error: 'הפעולה עדיין לא הופעלה.', code: 'places_not_configured' }); return; }
    if (!underPrefillLimit(email)) {
      res.status(429).json({ error: 'ביצעתם כמה פעולות כאלה היום. נסו שוב מחר.', code: 'daily_limit' });
      return;
    }
    const place = await fetchPlace(business.google_place_id);
    res.json({ prefill: mapPlaceToPrefill(place), notice: DRAFT_NOTICE, source: 'google' });
  } catch (e) {
    if (e instanceof PlacesError) {
      if (e.code === 'not_found') { res.status(404).json({ error: 'העסק לא נמצא בגוגל.' }); return; }
      if (e.code === 'not_configured') { res.status(503).json({ error: 'הפעולה עדיין לא הופעלה.', code: 'places_not_configured' }); return; }
      res.status(502).json({ error: 'גוגל לא הגיבה. נסו שוב בעוד רגע.' });
      return;
    }
    console.error('[LANDING] prefill failed');
    res.status(500).json({ error: 'שגיאה פנימית.' });
  }
}
