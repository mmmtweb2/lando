import type { Request, Response } from 'express';
import { RRError, add, list, markReviewed, markSent, remove } from '../services/reviewRequests.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown): void {
  if (e instanceof RRError) {
    const m: Record<string, [number, string]> = {
      bad_input: [400, 'השם לא תקין (עד 40 תווים).'],
      bad_phone: [400, 'מספר נייד ישראלי בלבד, למשל 0501234567.'],
      limit: [409, 'הגעתם למקסימום של 200 אנשים לעסק. אפשר למחוק ישנים.'],
      duplicate: [409, 'המספר הזה כבר ברשימה.'],
      not_found: [404, 'לא נמצא.'],
      too_soon: [409, 'אי אפשר לשלוח עכשיו. בקשה אחת ותזכורת אחת בלבד, בהפרש של שבוע.'],
      not_migrated: [503, 'בקשות הביקורת עדיין לא הופעלו.'],
    };
    const x = m[e.code];
    if (x) { res.status(x[0]).json({ error: x[1], code: e.code === 'not_migrated' ? 'review_requests_not_migrated' : e.code }); return; }
  }
  console.error('[REVIEW-REQUESTS] failed:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

const who = (req: Request, res: Response): string | null => {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return null; }
  return req.authEmail;
};

/** GET /api/seo/review-requests?businessId= */
export async function listRequests(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  const bid = typeof req.query.businessId === 'string' ? req.query.businessId : '';
  if (!UUID.test(bid)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { res.json({ items: await list(email, bid) }); } catch (e) { fail(res, e); }
}

/** POST /api/seo/review-requests {businessId, name, phone} */
export async function addRequest(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  const b = (req.body ?? {}) as { businessId?: unknown; name?: unknown; phone?: unknown };
  if (typeof b.businessId !== 'string' || !UUID.test(b.businessId)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { res.json({ item: await add(email, b.businessId, b.name, b.phone) }); } catch (e) { fail(res, e); }
}

function idOf(req: Request, res: Response): string | null {
  const id = req.params.id;
  if (!UUID.test(id)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return null; }
  return id;
}

/** POST /api/seo/review-requests/:id/sent */
export async function sentRequest(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return; const id = idOf(req, res); if (!id) return;
  try { res.json({ item: await markSent(email, id) }); } catch (e) { fail(res, e); }
}

/** POST /api/seo/review-requests/:id/reviewed */
export async function reviewedRequest(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return; const id = idOf(req, res); if (!id) return;
  try { res.json({ item: await markReviewed(email, id) }); } catch (e) { fail(res, e); }
}

/** DELETE /api/seo/review-requests/:id */
export async function deleteRequest(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return; const id = idOf(req, res); if (!id) return;
  try { await remove(email, id); res.json({ ok: true }); } catch (e) { fail(res, e); }
}
