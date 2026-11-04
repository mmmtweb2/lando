import type { Request, Response } from 'express';
import { getPremiumStatus } from '../services/premiumStatus.service';

/** GET /api/seo/premium: is this account a manual-premium customer, and by when is the card update expected. */
export async function getPremium(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  try { res.json(await getPremiumStatus(email)); } catch (e) { console.error('[PREMIUM-STATUS]', e); res.json({ premium: false, expectedBy: null }); }
}
