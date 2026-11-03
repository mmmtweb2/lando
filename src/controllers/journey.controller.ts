import type { Request, Response } from 'express';
import {
  JourneyError, activate, completeSetup, isAccountEvent, isPublicEvent, logEvent, peek, recordDashboardView, setBusiness, setPendingProfile, start, validAnonId,
} from '../services/journey.service';

function fail(res: Response, e: unknown): void {
  if (e instanceof JourneyError) {
    const m: Record<string, [number, string, string]> = {
      not_migrated: [503, 'ההקמה עדיין לא הופעלה.', 'journey_not_migrated'],
      bad_place: [400, 'העסק לא תקין. בחרו אותו מהרשימה.', 'bad_place'],
      no_business: [409, 'קודם בוחרים את העסק.', 'no_business'],
      bad_name: [400, 'כתבו את שם העסק (2 עד 80 תווים).', 'bad_name'],
      has_business: [409, 'כבר בחרתם עסק מגוגל.', 'has_business'],
      not_ready: [409, 'צריך להשלים את ההקמה לפני ההפעלה.', 'not_ready'],
      payment_required: [402, 'ההפעלה כוללת תשלום.', 'payment_required'],
      beta_ended: [409, 'תקופת הבטא שלכם הסתיימה. כדי להמשיך, כתבו לנו ונסדר את ההמשך.', 'beta_ended'],
    };
    const x = m[e.code];
    if (x) { res.status(x[0]).json({ error: x[1], code: x[2], ...(e.code === 'payment_required' ? { next: '/seo-plan' } : {}) }); return; }
  }
  console.error('[JOURNEY] failed:', e instanceof Error ? e.message : e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

const who = (req: Request, res: Response): string | null => {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return null; }
  return req.authEmail;
};

/** GET /api/seo/journey — read-only (creates nothing). */
export async function getJourney(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  try { res.json(await peek(email)); } catch (e) { fail(res, e); }
}

/** POST /api/seo/journey/start {anonId?, attribution?} — idempotent. */
export async function startJourney(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  const b = (req.body ?? {}) as { anonId?: unknown; attribution?: unknown };
  try { res.json(await start(email, validAnonId(b.anonId), b.attribution)); } catch (e) { fail(res, e); }
}

/** PUT /api/seo/journey/business {placeId} */
export async function putBusiness(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  try { res.json(await setBusiness(email, (req.body ?? {}).placeId)); } catch (e) { fail(res, e); }
}

/** PUT /api/seo/journey/profile-pending { name } — the business has no verified Google profile yet. */
export async function putPendingProfile(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  try { res.json(await setPendingProfile(email, (req.body ?? {}).name)); } catch (e) { fail(res, e); }
}

/** POST /api/seo/journey/setup-complete */
export async function postSetupComplete(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  try { res.json(await completeSetup(email)); } catch (e) { fail(res, e); }
}

/** POST /api/seo/journey/activate */
export async function postActivate(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  try { res.json(await activate(email)); } catch (e) { fail(res, e); }
}

/** POST /api/seo/journey/event {event, props?} — events only a signed-in customer's page can report. */
export async function postAccountEvent(req: Request, res: Response): Promise<void> {
  const email = who(req, res); if (!email) return;
  const b = (req.body ?? {}) as { event?: unknown; props?: unknown; attribution?: unknown; anonId?: unknown };
  if (!isAccountEvent(b.event)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  if (b.event === 'dashboard_viewed') await recordDashboardView(email);
  else await logEvent({ event: b.event as never, email, anonId: validAnonId(b.anonId), props: b.props, attribution: b.attribution });
  res.status(204).end();
}

/** POST /api/public/journey/event {event, anonId, props?, attribution?} — anonymous visitor events. Always 204: tracking never blocks. */
export async function postPublicEvent(req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as { event?: unknown; anonId?: unknown; props?: unknown; attribution?: unknown };
  const anon = validAnonId(b.anonId);
  if (isPublicEvent(b.event) && anon) await logEvent({ event: b.event as never, anonId: anon, props: b.props, attribution: b.attribution });
  res.status(204).end();
}
