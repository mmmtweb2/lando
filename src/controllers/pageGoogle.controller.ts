import type { Request, Response } from 'express';
import { SyncError } from '../services/gbpSync.service';
import { PageGoogleError, googlePhotosForPage, importGooglePhotos, pageLinkView, sendPendingPhotos } from '../services/pageGoogle.service';
import { touchDraft } from '../services/draftCleanup.service';

// The landing page and the Google listing, shared both ways (README part 143).
//   Editor (requireAuth + requireOwnPage): GET/POST /api/landing/:id/google-photos
//   Dashboard (requireAuth + requireProduct): GET /api/seo/gbp/page-link, POST /api/seo/gbp/page-link/photos

const IMPORT_HE: Record<PageGoogleError['code'], [number, string]> = {
  not_linked: [409, 'הדף הזה לא מחובר לכרטיס בגוגל. חברו את הכרטיס בלוח הבקרה.'],
  full: [409, 'הגלריה מלאה (12 תמונות). הסירו תמונה ונסו שוב.'],
  none: [400, 'לא נבחרו תמונות חדשות.'],
  google: [502, 'לא הצלחנו להביא את התמונות מגוגל. נסו שוב בעוד כמה דקות.'],
};

const SEND_HE: Partial<Record<SyncError['code'], [number, string]>> = {
  sync_off: [409, 'העברה אוטומטית לגוגל עדיין כבויה. התמונות יתווספו כשהיא תופעל.'],
  not_connected: [409, 'צריך לחבר מחדש את כרטיס העסק שלכם בגוגל.'],
  not_migrated: [503, 'החלק הזה עדיין לא הופעל.'],
};

function fail(res: Response, e: unknown, tag: string): void {
  if (e instanceof PageGoogleError) { const [s, error] = IMPORT_HE[e.code]; res.status(s).json({ error, code: e.code }); return; }
  if (e instanceof SyncError) {
    const [s, error] = SEND_HE[e.code] ?? [502, 'לא הצלחנו לקרוא את הכרטיס בגוגל כרגע. נסו שוב בעוד כמה דקות.'];
    res.status(s).json({ error, code: e.code }); return;
  }
  console.error(`[${tag}]`, e instanceof Error ? e.message.slice(0, 200) : 'unknown');
  res.status(500).json({ error: 'משהו השתבש. נסו שוב.' });
}

/** GET /api/landing/:id/google-photos — the listing's photos for the editor's picker. */
export async function getGooglePhotos(req: Request, res: Response): Promise<void> {
  try { res.json(await googlePhotosForPage(String(req.params.id))); } catch (e) { fail(res, e, 'PAGE-GOOGLE'); }
}

/** POST /api/landing/:id/google-photos {ids: string[]} — adds the picked listing photos to the page gallery. */
export async function postGooglePhotos(req: Request, res: Response): Promise<void> {
  const ids = (req.body ?? {}).ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 12 || ids.some((x) => typeof x !== 'string')) { res.status(400).json({ error: 'בקשה לא תקינה.', code: 'invalid' }); return; }
  try {
    const r = await importGooglePhotos(String(req.params.id), ids as string[]);
    touchDraft(String(req.params.id));
    res.json(r);
  } catch (e) { fail(res, e, 'PAGE-GOOGLE'); }
}

/** GET /api/seo/gbp/page-link — what the page and the listing share, for "מחובר לדף שלכם". */
export async function getPageLink(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  try { res.json(await pageLinkView(req.authEmail)); } catch (e) { fail(res, e, 'PAGE-LINK'); }
}

/** POST /api/seo/gbp/page-link/photos {urls?: string[]} — sends the page photos waiting in the dashboard. */
export async function postPagePhotos(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  const urls = (req.body ?? {}).urls;
  if (urls !== undefined && (!Array.isArray(urls) || urls.length > 12 || urls.some((u) => typeof u !== 'string'))) { res.status(400).json({ error: 'בקשה לא תקינה.', code: 'invalid' }); return; }
  try { res.json({ queued: await sendPendingPhotos(req.authEmail, (urls as string[] | undefined) ?? null) }); } catch (e) { fail(res, e, 'PAGE-LINK'); }
}
