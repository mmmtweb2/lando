import type { Response } from 'express';

/** What a client is told when something unexpected failed server-side. */
export const GENERIC_SERVER_ERROR = 'שגיאה בשרת. נסו שוב, ואם זה נמשך צרו איתנו קשר.';

/**
 * Answers 500 with a generic Hebrew message and logs the real error server-side.
 * Raw database / driver messages carry table, column and constraint names — free reconnaissance
 * for an attacker — so they never go to the client.
 */
export function serverError(res: Response, err: unknown, tag = '[API]'): void {
  const detail = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  console.error(`${tag} 500:`, detail);
  res.status(500).json({ error: GENERIC_SERVER_ERROR });
}
