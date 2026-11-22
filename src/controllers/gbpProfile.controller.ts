import type { Request, Response } from 'express';
import { ATTRIBUTES, isProfileField } from '../services/gbpSync';
import {
  SyncError, addPhoto, getProfile, isPhotoCategory, listPhotos, removePhoto, resolveField, saveAttributes, saveField, websiteFromPage,
} from '../services/gbpSync.service';
import { PhotoInputError, fetchPageImage, storeGooglePhoto, toGooglePhoto } from '../services/gbpPhotos';
import { writeBackEnabled } from '../services/businessTruth.service';
import { recordManualSend } from '../services/pageGoogle.service';

// The customer's Google listing, edited from our dashboard (docs/gbp-sync-spec.md). Every route is
// behind requireAuth + requireProduct('seo_autopilot') (routes/seo.routes.ts).

const needAuth = (res: Response) => { res.status(401).json({ error: 'נדרשת התחברות.' }); };

const INVALID_HE: Record<string, string> = {
  website: 'כתובת האתר צריכה להתחיל ב-https://.',
  description: 'התיאור ריק או ארוך מדי (עד 750 תווים).',
  descriptionContent: 'בתיאור אסור לכלול קישורים, כתובות מייל או מספרי טלפון. גוגל דוחה תיאור כזה.',
  phone: 'מספר הטלפון לא תקין.',
  extraPhones: 'אפשר עד שני מספרים נוספים, כל אחד מספר טלפון תקין.',
  hours: 'שעות הפעילות לא תקינות.',
  specialHours: 'השעות המיוחדות לא תקינות: תאריך, ושעות פתיחה וסגירה או "סגור".',
  specialHoursNeedHours: 'כדי להוסיף שעות לחגים, צריך קודם שעות פעילות רגילות.',
  services: 'רשימת השירותים לא תקינה: עד 20 שירותים, שם קצר לכל אחד, בלי קישורים.',
  serviceArea: 'רשימת אזורי השירות לא תקינה: צריך לפחות אזור אחד ועד 20, כל אחד שם של עיר או אזור.',
  serviceAreaPlace: 'לא הצלחנו לזהות את האזור. כתבו את שם העיר או האזור כמו שהוא מופיע במפות גוגל.',
  attributes: 'אחד המאפיינים לא מוכר. רעננו את המסך ונסו שוב.',
};

const SYNC_HE: Record<SyncError['code'], [number, string]> = {
  not_found: [404, 'עוד לא קראנו את פרטי העסק. חברו את כרטיס העסק שלכם בגוגל.'],
  not_connected: [409, 'צריך לחבר מחדש את כרטיס העסק שלכם בגוגל.'],
  invalid: [400, 'הערך לא תקין.'],
  google_rejected: [422, 'גוגל לא קיבלה את השינוי.'],
  quota: [503, 'גוגל עמוסה כרגע. נסו שוב בעוד דקה.'],
  google: [502, 'לא הצלחנו לעדכן את גוגל. נסו שוב בעוד כמה דקות.'],
  not_migrated: [503, 'החלק הזה עדיין לא הופעל.'],
  no_page: [409, 'עוד אין לכם דף נחיתה מפורסם.'],
  bad_photo: [400, 'התמונה לא נמצאה.'],
  nothing_to_resolve: [409, 'אין כאן מה לבחור. רעננו את המסך.'],
  sync_off: [409, 'העברה אוטומטית לגוגל עדיין כבויה. תמונות יתווספו כשהיא תופעל.'],
};

const PHOTO_HE: Record<PhotoInputError['code'], string> = {
  type: 'אפשר להעלות תמונות JPG, PNG או WEBP.',
  size: 'התמונה גדולה מדי (עד 10MB).',
  small: 'התמונה קטנה מדי. גוגל דורשת לפחות 250 פיקסלים בכל צד.',
  unreadable: 'לא הצלחנו לקרוא את התמונה. נסו קובץ אחר.',
  not_on_page: 'אפשר לבחור רק תמונה שמופיעה בדף הנחיתה שלכם.',
};

function fail(res: Response, e: unknown): void {
  if (e instanceof SyncError) {
    const [status, msg] = SYNC_HE[e.code];
    const error = e.code === 'invalid'
      ? `${INVALID_HE[e.field ?? ''] ?? msg}${e.field === 'serviceAreaPlace' && e.detail ? ` (${e.detail.slice(0, 60)})` : ''}`
      : e.code === 'google_rejected' && e.detail ? `${msg} ${e.detail}` : msg;
    res.status(status).json({ error, code: e.code, ...(e.field ? { field: e.field } : {}), ...(e.code === 'google_rejected' && e.detail ? { googleMessage: e.detail } : {}) });
    return;
  }
  if (e instanceof PhotoInputError) { res.status(400).json({ error: PHOTO_HE[e.code], code: 'bad_photo', reason: e.code }); return; }
  console.error('[GBP-PROFILE]', e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'unknown');
  res.status(500).json({ error: 'משהו השתבש. נסו שוב.' });
}

const SYNC_OFF_MSG = 'העדכון נשמר אצלנו. הסנכרון לגוגל עדיין כבוי.';

/** GET /api/seo/gbp/profile */
export async function getProfileView(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json(await getProfile(req.authEmail)); } catch (e) { fail(res, e); }
}

/** PUT /api/seo/gbp/profile/:field {value} — 200 with `code: 'sync_off'` when it was saved here only. */
export async function putField(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  const field = req.params.field;
  if (!isProfileField(field) || !req.body || typeof req.body !== 'object' || !('value' in req.body)) { res.status(400).json({ error: 'בקשה לא תקינה.', code: 'invalid' }); return; }
  try {
    const value = (req.body as { value: unknown }).value;
    // the yes/no attributes go to Google through their own call (gbpAttributes.ts); every other field through locations.patch
    const r = field === ATTRIBUTES ? await saveAttributes(req.authEmail, value) : await saveField(req.authEmail, field, value);
    res.json(r.code === 'sync_off' ? { ...r, message: SYNC_OFF_MSG } : r);
  } catch (e) { fail(res, e); }
}

/** POST /api/seo/gbp/profile/:field/resolve {keep: 'google' | 'ours'} */
export async function resolve(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  const field = req.params.field, keep = (req.body ?? {}).keep;
  if (!isProfileField(field) || (keep !== 'google' && keep !== 'ours')) { res.status(400).json({ error: 'בקשה לא תקינה.', code: 'invalid' }); return; }
  try {
    const r = await resolveField(req.authEmail, field, keep);
    res.json(r.code === 'sync_off' ? { ...r, message: SYNC_OFF_MSG } : r);
  } catch (e) { fail(res, e); }
}

/** POST /api/seo/gbp/profile/website-from-page */
export async function useWebsiteFromPage(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try {
    const r = await websiteFromPage(req.authEmail);
    res.json(r.code === 'sync_off' ? { ...r, message: SYNC_OFF_MSG } : r);
  } catch (e) { fail(res, e); }
}

/** GET /api/seo/gbp/photos */
export async function getPhotos(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ photos: await listPhotos(req.authEmail), syncEnabled: writeBackEnabled() }); } catch (e) { fail(res, e); }
}

/**
 * POST /api/seo/gbp/photos — multipart `file` + `category`, or JSON {fromPageImage, category}.
 * The image is converted to a JPEG Google accepts, stored publicly, then added to the listing.
 */
export async function postPhoto(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) return needAuth(res);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const category = body.category ?? 'ADDITIONAL';
  if (!isPhotoCategory(category)) { res.status(400).json({ error: 'סוג התמונה לא תקין.', code: 'invalid' }); return; }
  const file = (req as Request & { file?: { buffer: Buffer; mimetype: string } }).file;
  const fromPage = typeof body.fromPageImage === 'string' ? body.fromPageImage : '';
  if (!file && !fromPage) { res.status(400).json({ error: 'לא נבחרה תמונה.', code: 'invalid' }); return; }
  try {
    const src = file ? { buffer: file.buffer, mime: file.mimetype } : await fetchPageImage(email, fromPage);
    const jpeg = await toGooglePhoto(src.buffer, src.mime);
    const r = await addPhoto(email, category, () => storeGooglePhoto(email, jpeg.buffer));
    // a page photo sent by hand is remembered, so it is never sent again by itself (README part 143)
    if (fromPage && !file) void recordManualSend(email, fromPage, r.id);
    res.status(201).json({ ok: true, id: r.id, small: jpeg.small });
  } catch (e) { fail(res, e); }
}

/** DELETE /api/seo/gbp/photos/:id */
export async function deletePhoto(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { await removePhoto(req.authEmail, String(req.params.id ?? '')); res.json({ ok: true }); } catch (e) { fail(res, e); }
}
