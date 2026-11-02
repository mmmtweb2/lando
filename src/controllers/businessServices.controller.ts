import type { Request, Response } from 'express';
import { ServicesError, getServices, setServices } from '../services/businessServices.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown): void {
  if (e instanceof ServicesError) {
    const m: Record<string, [number, string]> = {
      bad_input: [400, 'עד 8 שירותים, כל אחד עד 40 תווים, בלי קישורים.'],
      not_found: [404, 'לא נמצא.'],
      not_migrated: [503, 'רשימת השירותים עדיין לא הופעלה.'],
    };
    const x = m[e.code];
    if (x) { res.status(x[0]).json({ error: x[1], code: e.code === 'not_migrated' ? 'services_not_migrated' : e.code }); return; }
  }
  console.error('[SERVICES] failed:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

/** GET /api/seo/businesses/:id/services */
export async function getBusinessServices(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { res.json({ services: await getServices(req.authEmail, req.params.id) }); } catch (e) { fail(res, e); }
}

/** PUT /api/seo/businesses/:id/services {services: string[]} */
export async function putBusinessServices(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { res.json({ services: await setServices(req.authEmail, req.params.id, (req.body ?? {}).services) }); } catch (e) { fail(res, e); }
}
