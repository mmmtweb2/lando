// Customer ratings (migration 052, services/customerRatings.service.ts).
import { Request, Response } from 'express';
import {
  RatingError, dismissAsk, getMine, isProduct, listForAdmin, publicRatings, reviewRating, saveMine, validateRating,
} from '../services/customerRatings.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown): void {
  if (e instanceof RatingError && e.code === 'not_eligible') { res.status(403).json({ error: e.message, code: e.code }); return; }
  console.error('[RATINGS]', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'משהו השתבש. נסו שוב בעוד רגע.' });
}

/** GET /api/ratings/mine */
export async function mine(req: Request, res: Response): Promise<void> {
  try { res.json(await getMine(req.authEmail!)); } catch (e) { fail(res, e); }
}

/** POST /api/ratings/mine  { product, stars, text, displayName, businessType, consentPublish } */
export async function saveRating(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isProduct(body.product)) { res.status(400).json({ error: 'מוצר לא מוכר.', code: 'invalid' }); return; }
  const v = validateRating(body);
  if (!v.ok) { res.status(400).json({ error: v.error, code: 'invalid' }); return; }
  try { await saveMine(req.authEmail!, body.product, v.value); res.json({ ok: true, status: 'pending' }); } catch (e) { fail(res, e); }
}

/** POST /api/ratings/mine/dismiss  { product } */
export async function dismiss(req: Request, res: Response): Promise<void> {
  const product = (req.body ?? {}).product;
  if (!isProduct(product)) { res.status(400).json({ error: 'מוצר לא מוכר.', code: 'invalid' }); return; }
  try { await dismissAsk(req.authEmail!, product); res.json({ ok: true }); } catch (e) { fail(res, e); }
}

/** GET /api/ratings/public?product=pages|seo */
export async function publicList(req: Request, res: Response): Promise<void> {
  const product = req.query.product;
  if (!isProduct(product)) { res.status(400).json({ error: 'מוצר לא מוכר.' }); return; }
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(await publicRatings(product));
  } catch (e) { fail(res, e); }
}

/** GET /api/admin/ratings */
export async function adminList(_req: Request, res: Response): Promise<void> {
  try { res.json({ ratings: await listForAdmin() }); } catch (e) { fail(res, e); }
}

/** POST /api/admin/ratings/:id/approve | /reject */
export function adminReview(decision: 'approved' | 'rejected') {
  return async (req: Request, res: Response): Promise<void> => {
    if (!UUID.test(String(req.params.id))) { res.status(400).json({ error: 'bad id' }); return; }
    try {
      const ok = await reviewRating(String(req.params.id), decision);
      if (!ok) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ ok: true, status: decision });
    } catch (e) { fail(res, e); }
  };
}
