import { Request, Response } from 'express';
import { BetaAccessError, grantAccess, listGrants, revokeAccess } from '../services/betaAccess.service';

function fail(res: Response, e: unknown): void {
  if (e instanceof BetaAccessError) {
    const map: Record<string, [number, string]> = {
      bad_email: [400, 'כתובת אימייל לא תקינה.'],
      bad_days: [400, 'מספר ימים לא תקין (1 עד 3650, או ריק ללא הגבלה).'],
      no_account: [404, 'אין חשבון Pagey עם האימייל הזה. הוא צריך להירשם קודם.'],
      paying: [409, 'החשבון הזה מנוי משלם. לא משנים אותו מכאן.'],
    };
    const m = map[e.code];
    if (m) { res.status(m[0]).json({ error: m[1], code: e.code }); return; }
  }
  console.error('[BETA-ACCESS] failed:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

/** GET /api/admin/beta-access */
export async function adminListGrants(_req: Request, res: Response): Promise<void> {
  try { res.json({ grants: await listGrants() }); } catch (e) { fail(res, e); }
}

/** POST /api/admin/beta-access {email, days?} */
export async function adminGrant(req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as { email?: unknown; days?: unknown };
  try { res.json({ grant: await grantAccess(b.email, b.days) }); } catch (e) { fail(res, e); }
}

/** POST /api/admin/beta-access/revoke {email} */
export async function adminRevoke(req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as { email?: unknown };
  try { await revokeAccess(b.email); res.json({ ok: true }); } catch (e) { fail(res, e); }
}
