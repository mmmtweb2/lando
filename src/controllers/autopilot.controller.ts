import type { Request, Response } from 'express';
import { CardInputError } from '../services/businessTruth';
import { TruthError, approve, getTruth, saveEdit, syncFromGoogle } from '../services/businessTruth.service';
import { POSTS_MODES, REPLIES_MODES, autopilotEnabled, getAutomation, listActivity, setAutomation } from '../services/automation.service';
import { PostError, editPost, listPosts, publishNow, skipPost } from '../services/gbpPosts.service';
import { EDIT_WINDOW_HOURS } from '../services/gbpPosts';

// The automatic product (docs/mvp-plan.md, part A): the business card everything is written from,
// what the customer lets us do by ourselves, the weekly posts and the log of what we did.
// Every route is behind requireAuth + requireProduct (routes/seo.routes.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const needAuth = (res: Response) => { res.status(401).json({ error: 'נדרשת התחברות.' }); };

const FIELD_HE: Record<string, string> = {
  phone: 'מספר הטלפון לא תקין.', website: 'כתובת האתר צריכה להתחיל ב-https://.', description: 'התיאור ארוך מדי.', notes: 'הטקסט ארוך מדי.',
  services: 'רשימת השירותים לא תקינה: עד 20 שירותים, שם קצר לכל אחד, בלי קישורים.', areas: 'רשימת האזורים לא תקינה: עד 10 אזורים, בלי קישורים.',
  hours: 'שעות הפעילות לא תקינות.', body: 'בקשה לא תקינה.',
};

function fail(res: Response, e: unknown): void {
  if (e instanceof CardInputError) { res.status(400).json({ error: FIELD_HE[e.field] ?? 'בקשה לא תקינה.', code: 'bad_input', field: e.field }); return; }
  if (e instanceof TruthError) {
    const m: Record<TruthError['code'], [number, string]> = {
      not_connected: [409, 'צריך לחבר את כרטיס העסק שלכם בגוגל.'],
      no_location: [409, 'צריך לבחור איזה עסק לחבר.'],
      not_migrated: [503, 'החלק הזה עדיין לא הופעל.'],
      not_found: [404, 'עוד לא קראנו את פרטי העסק. חברו את כרטיס העסק שלכם בגוגל.'],
      not_ready: [409, 'חסרים פרטים שבלעדיהם אי אפשר להתחיל. השלימו אותם ונסו שוב.'],
      quota_pending: [503, 'גוגל עדיין לא פתחה לנו את הגישה לפרטי הכרטיס. אפשר למלא את הפרטים כאן בינתיים.'],
      google: [502, 'לא הצלחנו לקרוא את הפרטים מגוגל. נסו שוב בעוד כמה דקות.'],
    };
    res.status(m[e.code][0]).json({ error: m[e.code][1], code: e.code }); return;
  }
  if (e instanceof PostError) {
    const m: Record<PostError['code'], [number, string]> = {
      not_found: [404, 'לא נמצא.'],
      bad_text: [400, 'הטקסט קצר מדי, ארוך מדי או כולל קישור.'],
      not_scheduled: [409, 'הפוסט הזה כבר פורסם או נעצר.'],
      not_connected: [409, 'צריך לחבר מחדש את כרטיס העסק שלכם בגוגל.'],
      quota_pending: [503, 'גוגל עדיין לא פתחה לנו את הפרסום. הפוסט שמור ויתפרסם מיד כשזה יתאפשר.'],
      google: [502, 'לא הצלחנו להעביר את הפוסט לגוגל. הוא שמור, וננסה שוב בעוד כמה שעות.'],
      not_migrated: [503, 'החלק הזה עדיין לא הופעל.'],
    };
    res.status(m[e.code][0]).json({ error: m[e.code][1], code: e.code }); return;
  }
  console.error('[AUTOPILOT]', e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'unknown');
  res.status(500).json({ error: 'משהו השתבש. נסו שוב.' });
}

/** GET /api/seo/truth — the card, or `card: null` before the first read from Google. Never 404s the page. */
export async function getCard(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ truth: await getTruth(req.authEmail) }); } catch (e) {
    if (e instanceof TruthError && e.code === 'not_migrated') { res.json({ truth: null, notReady: true }); return; }
    fail(res, e);
  }
}

/** POST /api/seo/truth/sync — read the card again from Google. */
export async function syncCard(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ truth: await syncFromGoogle(req.authEmail) }); } catch (e) { fail(res, e); }
}

/** PUT /api/seo/truth — the customer's edits (any subset of the editable fields). */
export async function putCard(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ truth: await saveEdit(req.authEmail, req.body) }); } catch (e) { fail(res, e); }
}

/** POST /api/seo/truth/approve — "הפרטים נכונים, תתחילו לעבוד". */
export async function approveCard(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ truth: await approve(req.authEmail), automation: await getAutomation(req.authEmail) }); } catch (e) { fail(res, e); }
}

/** GET /api/seo/automation — `live` is false while the operator switch is off (nothing is published yet). */
export async function getSettings(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ ...(await getAutomation(req.authEmail)), live: autopilotEnabled(), editWindowHours: EDIT_WINDOW_HOURS }); } catch (e) { fail(res, e); }
}

/** PUT /api/seo/automation {postsMode?, repliesMode?} */
export async function putSettings(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  const b = (req.body ?? {}) as Record<string, unknown>;
  const posts = b.postsMode, replies = b.repliesMode;
  if ((posts !== undefined && !POSTS_MODES.includes(posts as never)) || (replies !== undefined && !REPLIES_MODES.includes(replies as never)) || (posts === undefined && replies === undefined)) {
    res.status(400).json({ error: 'בקשה לא תקינה.', code: 'bad_input' }); return;
  }
  try { res.json({ ...(await setAutomation(req.authEmail, { postsMode: posts as never, repliesMode: replies as never })), live: autopilotEnabled(), editWindowHours: EDIT_WINDOW_HOURS }); } catch (e) { fail(res, e); }
}

/** GET /api/seo/posts — the last 12 posts, newest first. */
export async function getPosts(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ posts: await listPosts(req.authEmail) }); } catch (e) { fail(res, e); }
}

const withPost = (fn: (email: string, id: string, req: Request) => Promise<unknown>) => async (req: Request, res: Response): Promise<void> => {
  if (!req.authEmail) return needAuth(res);
  if (!UUID.test(req.params.id)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  try { res.json({ ok: true, post: (await fn(req.authEmail, req.params.id, req)) ?? null }); } catch (e) { fail(res, e); }
};
/** PUT /api/seo/posts/:id {text} */
export const putPost = withPost((email, id, req) => editPost(email, id, (req.body ?? {}).text));
/** POST /api/seo/posts/:id/publish */
export const publishPost = withPost((email, id) => publishNow(email, id));
/** POST /api/seo/posts/:id/skip */
export const skipPostNow = withPost((email, id) => skipPost(email, id));

/** GET /api/seo/activity?limit=30 — "מה עשינו בשבילך". */
export async function getActivity(req: Request, res: Response): Promise<void> {
  if (!req.authEmail) return needAuth(res);
  try { res.json({ items: await listActivity(req.authEmail, Number(req.query.limit) || 30) }); } catch (e) { fail(res, e); }
}
