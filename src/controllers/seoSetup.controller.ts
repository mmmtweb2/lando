import type { Request, Response } from 'express';
import { SetupError, isSetupKey, listSetup, setSetup } from '../services/seoSetup.service';

function fail(res: Response, e: unknown): void {
  if (e instanceof SetupError && e.code === 'not_migrated') {
    res.status(503).json({ error: 'שמירת ההתקדמות עדיין לא הופעלה.', code: 'setup_not_migrated' });
    return;
  }
  console.error('[SEO-SETUP]', e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

export async function getSetup(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  try { res.json({ steps: await listSetup(email) }); } catch (e) { fail(res, e); }
}

export async function putSetup(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  const key = req.params.key;
  const done = (req.body as { done?: unknown } | undefined)?.done;
  if (!isSetupKey(key) || typeof done !== 'boolean') { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { await setSetup(email, key, done); res.json({ ok: true }); } catch (e) { fail(res, e); }
}
