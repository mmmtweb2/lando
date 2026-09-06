import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * A shared-secret gate in front of the whole admin area, on TOP of the real
 * identity checks (requireAuth + requireAdmin, i.e. a genuine Supabase session
 * whose user_profiles.is_admin is true). Moshe's request: /admin should also
 * want a password.
 *
 * This is deliberately NOT an authentication mechanism and replaces nothing.
 * It is a second factor of the crudest kind — it means a stolen or mistakenly
 * flagged admin session is not on its own enough to reach the admin API.
 *
 * FAILS CLOSED. If ADMIN_PANEL_PASSWORD is unset the check REJECTS every admin
 * request and logs a warning, rather than waving everyone through. A forgotten
 * env var in production must be loud and obvious (an admin panel that stops
 * working), never a silent bypass that nobody notices for months.
 */
/** Constant-time compare, so the response time can't be used to learn the
 *  password character by character. Length is compared separately because
 *  timingSafeEqual throws on mismatched lengths. */
function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireAdminPanelPassword(req: Request, res: Response, next: NextFunction): void {
  // Read per-request rather than at module load: import order is then irrelevant
  // (env.ts runs dotenv first today, but this must not silently break if that
  // ever changes), and the value can be rotated by a restart-free redeploy.
  const expected = process.env.ADMIN_PANEL_PASSWORD ?? '';

  if (!expected) {
    console.warn('[ADMIN] ADMIN_PANEL_PASSWORD is not set — refusing every /api/admin request. Set it in the environment to re-enable the admin panel.');
    res.status(503).json({ adminPassword: true, error: 'פאנל הניהול אינו מוגדר בשרת (חסר ADMIN_PANEL_PASSWORD).' });
    return;
  }

  const header = req.headers['x-admin-password'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!provided || !matches(provided, expected)) {
    // `adminPassword: true` is what lets the client tell "wrong panel password"
    // apart from the pre-existing "your account is not an admin" denial, and
    // show "סיסמה שגויה" instead of the generic access-denied screen.
    res.status(401).json({ adminPassword: true, error: 'סיסמה שגויה.' });
    return;
  }
  next();
}
