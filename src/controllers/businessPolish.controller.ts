import type { Request, Response } from 'express';
import { isPolishField } from '../services/businessPolish';
import { PolishError, type PolishErrorCode, polish } from '../services/businessPolish.service';

// POST /api/seo/gbp/profile/:field/polish — "שיפור הניסוח" for the description and the services (README
// part 144). Returns ONE suggestion; nothing is saved. Behind requireAuth + requireProduct('seo_autopilot')
// and a per-account limiter (routes/seo.routes.ts); 3 suggestions per field per day.

const POLISH_HE: Record<PolishErrorCode, [number, string]> = {
  not_found: [404, 'עוד לא קראנו את פרטי העסק. חברו את כרטיס העסק שלכם בגוגל.'],
  limit: [429, 'הגעתם ל-3 הצעות היום לשדה הזה. אפשר לנסות שוב מחר, או לערוך בעצמכם.'],
  unavailable: [503, 'שיפור הניסוח לא זמין כרגע. אפשר לערוך בעצמכם.'],
  failed: [502, 'לא הצלחנו להציע ניסוח טוב יותר הפעם. נסו שוב בעוד רגע, או ערכו בעצמכם.'],
  invalid: [400, 'בקשה לא תקינה.'],
  empty: [400, 'אין עדיין שירותים לשפר. הוסיפו שירות אחד לפחות.'],
};

export async function postPolish(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  const field = req.params.field;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isPolishField(field) || typeof body !== 'object') { res.status(400).json({ error: POLISH_HE.invalid[1], code: 'invalid' }); return; }
  try {
    res.json(await polish(req.authEmail, field, { draft: body.draft, previous: body.previous }));
  } catch (e) {
    if (e instanceof PolishError) {
      const [status, error] = POLISH_HE[e.code];
      res.status(status).json({ error, code: e.code, ...(e.code === 'limit' ? { remaining: 0 } : {}) });
      return;
    }
    console.error('[POLISH]', e instanceof Error ? e.name : 'unknown');
    res.status(500).json({ error: 'משהו השתבש. נסו שוב.' });
  }
}
