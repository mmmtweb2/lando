import type { Request, Response } from 'express';
import { FeedbackError, addFeedback, listFeedback, setSeen } from '../services/feedback.service';
import { notifyOwner } from '../services/alerts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown): void {
  if (e instanceof FeedbackError) {
    if (e.code === 'bad_input') { res.status(400).json({ error: 'כתבו לפחות כמה מילים (עד 2000 תווים).', code: 'bad_input' }); return; }
    if (e.code === 'too_many') { res.status(429).json({ error: 'שלחתם הרבה הודעות היום. נשמח לעוד מחר.', code: 'too_many' }); return; }
    if (e.code === 'not_migrated') { res.status(503).json({ error: 'המשוב עדיין לא הופעל.', code: 'feedback_not_migrated' }); return; }
  }
  console.error('[FEEDBACK] failed:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

/** POST /api/seo/feedback {kind, message, page?} */
export async function sendFeedback(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  const b = (req.body ?? {}) as { kind?: unknown; message?: unknown; page?: unknown };
  try {
    const row = await addFeedback(email, b.kind, b.message, b.page);
    // Optional ping to the owner (see services/alerts.ts); never blocks or fails the request.
    void notifyOwner(`משוב חדש (${row.kind}) מ-${email}: ${row.message.slice(0, 200)}`, `feedback:${row.id}`);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
}

/** GET /api/admin/feedback */
export async function adminListFeedback(_req: Request, res: Response): Promise<void> {
  try { res.json({ items: await listFeedback(200) }); }
  catch (e) {
    if (e instanceof FeedbackError && e.code === 'not_migrated') { res.json({ items: [], notMigrated: true }); return; }
    fail(res, e);
  }
}

/** POST /api/admin/feedback/:id/seen {seen} */
export async function adminMarkSeen(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (!UUID.test(id)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  const seen = (req.body as { seen?: unknown } | undefined)?.seen !== false;
  try { await setSeen(id, seen); res.json({ ok: true }); } catch (e) { fail(res, e); }
}
