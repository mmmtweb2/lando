import type { Request, Response } from 'express';
import { DraftError, dismiss, listPending, liveTexts, publish } from '../services/reviewAlerts.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown): void {
  if (e instanceof DraftError) {
    const m: Record<string, [number, string, string]> = {
      not_found: [404, 'לא נמצא.', 'not_found'],
      bad_text: [400, 'הטקסט ריק או ארוך מדי.', 'bad_text'],
      not_pending: [409, 'כבר טיפלתם בתשובה הזו.', 'not_pending'],
      not_connected: [409, 'צריך לחבר מחדש את הפרופיל בגוגל.', 'needs_reconnect'],
      quota_pending: [503, 'ממשק Business Profile של גוגל עדיין לא אושר לפרויקט. אפשר להעתיק את התשובה ולפרסם אותה ישירות בגוגל.', 'quota_pending'],
      google: [502, 'גוגל לא אישרה את הפרסום. נסו שוב בעוד כמה דקות.', 'google_error'],
      not_migrated: [503, 'התשובות המוכנות עדיין לא הופעלו.', 'drafts_not_migrated'],
    };
    const x = m[e.code];
    if (x) { res.status(x[0]).json({ error: x[1], code: x[2] }); return; }
  }
  console.error('[REVIEW-DRAFTS] failed:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

/** GET /api/seo/review-drafts — pending drafts, with the live review text when Google answers. */
export async function listDrafts(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  try {
    const rows = await listPending(req.authEmail);
    const live = await liveTexts(req.authEmail, rows);
    res.json({
      drafts: rows
        .filter(r => !live.get(r.review_id)?.hasReply) // answered on Google meanwhile: nothing left to approve
        .map(r => ({
          id: r.id, rating: r.rating, reviewer: r.reviewer_first, createdAt: r.review_created_at, draft: r.draft,
          reviewText: live.get(r.review_id)?.text ?? null,
        })),
    });
  } catch (e) { fail(res, e); }
}

/** POST /api/seo/review-drafts/:id/publish {text} — the owner's explicit approval. */
export async function publishDraft(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { await publish(req.authEmail, req.params.id, (req.body ?? {}).text); res.json({ ok: true }); } catch (e) { fail(res, e); }
}

/** POST /api/seo/review-drafts/:id/dismiss */
export async function dismissDraft(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { await dismiss(req.authEmail, req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); }
}
