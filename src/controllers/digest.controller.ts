import type { Request, Response } from 'express';
import { buildDigest, digestEnabled, gatherStats, realDeps, setDigestPref, unsubUrl, verifyUnsub } from '../services/digest.service';

const page = (title: string, body: string) => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:Heebo,Arial,sans-serif;background:#f8fafc;color:#1e293b;display:flex;justify-content:center;padding:48px 16px}main{max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;text-align:center}button{background:#2E63F6;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:16px;font-weight:600;cursor:pointer}a{color:#2E63F6}</style></head><body><main>${body}</main></body></html>`;
const APP = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');

/** GET /api/seo/digest/unsubscribe?t=… — shows a confirm button; changes nothing (mail scanners open links). */
export function unsubscribePage(req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  const t = typeof req.query.t === 'string' ? req.query.t : '';
  if (!verifyUnsub(t)) { res.status(400).send(page('קישור לא תקין', '<h2>הקישור לא תקין</h2><p>אפשר להיכנס לדשבורד ולפנות אלינו מכל מקום באתר.</p>')); return; }
  res.send(page('הפסקת סיכומים והתראות', `<h2>להפסיק לקבל סיכומים והתראות במייל?</h2><form method="post" action="/api/seo/digest/unsubscribe?t=${encodeURIComponent(t)}"><button type="submit">כן, להפסיק</button></form>`));
}

/** POST /api/seo/digest/unsubscribe?t=… — the button above, and mail clients' one-click unsubscribe. */
export async function unsubscribeApply(req: Request, res: Response): Promise<void> {
  const email = verifyUnsub(typeof req.query.t === 'string' ? req.query.t : '');
  if (!email) { res.status(400).send(page('קישור לא תקין', '<h2>הקישור לא תקין</h2>')); return; }
  try {
    await setDigestPref(email, false);
    res.send(page('בוטל', `<h2>בוצע</h2><p>לא נשלח אליכם עוד סיכום חודשי.</p><p><a href="${APP}/dashboard">לדשבורד</a></p>`));
  } catch (e) {
    console.error('[DIGEST] unsubscribe failed:', e instanceof Error ? e.message : e);
    res.status(503).send(page('שגיאה', '<h2>לא הצלחנו לעדכן כרגע</h2><p>נסו שוב בעוד כמה דקות.</p>'));
  }
}

/** GET /api/admin/digest/preview?email= — HTML of what that account would get now. Sends nothing. */
export async function adminPreview(req: Request, res: Response): Promise<void> {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  if (!email) { res.status(400).json({ error: 'חסר אימייל.' }); return; }
  try {
    const mail = buildDigest(await gatherStats(email), '#unsubscribe-preview');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>${mail.subject.replace(/</g, '&lt;')}</title>${mail.html}`);
  } catch (e) { console.error('[DIGEST] preview failed:', e instanceof Error ? e.message : e); res.status(500).json({ error: 'שגיאה פנימית.' }); }
}

/** POST /api/admin/digest/test — sends the preview to the calling admin only (never to the customer). */
export async function adminTest(req: Request, res: Response): Promise<void> {
  const admin = req.authEmail;
  const target = typeof (req.body as { email?: unknown } | undefined)?.email === 'string' ? (req.body as { email: string }).email.trim().toLowerCase() : admin;
  if (!admin || !target) { res.status(400).json({ error: 'חסר אימייל.' }); return; }
  try {
    const unsub = unsubUrl(admin);
    const mail = buildDigest(await gatherStats(target), unsub);
    await realDeps.send({ to: admin, ...mail, subject: `[בדיקה] ${mail.subject}`, unsub });
    res.json({ ok: true, to: admin, enabled: digestEnabled() });
  } catch (e) { console.error('[DIGEST] test send failed:', e instanceof Error ? e.message : e); res.status(500).json({ error: 'השליחה נכשלה. בדקו RESEND_API_KEY ו-DIGEST_SECRET.' }); }
}
