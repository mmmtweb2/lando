import type { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { CardInputError, landingInputFromCard } from '../services/businessTruth';
import { createLandingPage } from './landing.controller';
import { admit, suggest } from '../services/phrasePlan';
import { factsText } from '../services/businessTruth';
import { buildChildContent, generateChildText } from '../services/seoChildPage';
import { childUrl, getOwnedParentPage, insertChild, listChildren } from '../services/seoChildStore';
import { underKitLimit } from './seoContent.controller';
import { logActivity } from '../services/automation.service';
import { TruthError, approve, getTruth, saveEdit, syncFromGoogle } from '../services/businessTruth.service';
import { POSTS_MODES, REPLIES_MODES, autopilotEnabled, getAutomation, listActivity, setAutomation } from '../services/automation.service';
import { PostError, editPost, listPosts, planPostFor, publishNow, skipPost } from '../services/gbpPosts.service';
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
  try {
    const truth = await approve(req.authEmail);
    // The first post is written at once (best effort, capped), so the customer sees it on the next screen.
    await Promise.race([planPostFor(req.authEmail), new Promise((r) => setTimeout(r, 20_000))]);
    res.json({ truth, automation: await getAutomation(req.authEmail) });
  } catch (e) { fail(res, e); }
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

/**
 * POST /api/seo/truth/landing — "צרו לי דף נחיתה": one press creates a complete draft page from
 * the business card, through the same creation code as the wizard (same limits, same writer, same
 * checks). Nothing is published and nothing is charged here: the customer reads the draft and
 * publishes it from the page itself. An account that already has a page gets that page back
 * instead of a second one.
 */
export async function createPageFromCard(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) return needAuth(res);
  try {
    const t = await getTruth(email);
    if (!t) { fail(res, new TruthError('not_found')); return; }
    if (!t.readiness.ready) { fail(res, new TruthError('not_ready')); return; }
    const { data: mine, error } = await supabase.from('landing_pages').select('id, slug, status')
      .eq('owner_email', email).is('parent_id', null).order('created_at', { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const have = ((mine ?? []) as { id: string; slug: string; status: string }[])[0];
    if (have) { res.json({ existing: true, id: have.id, slug: have.slug, status: have.status }); return; }

    req.body = landingInputFromCard(t.card);
    (req as { files?: unknown }).files = {};
    const send = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode === 201) void logActivity(email, 'page_created', 'יצרנו לכם דף נחיתה מפרטי העסק', 'הדף מחכה לכם כטיוטה. קראו אותו ופרסמו כשהוא מוכן.', `page:${(body as { id?: string } | null)?.id ?? ''}`);
      return send(body);
    }) as Response['json'];
    await createLandingPage(req, res);
  } catch (e) { fail(res, e); }
}

// ── Search-phrase pages (docs/mvp-plan.md, C2) ───────────────────────────────

/** The account's landing page (newest root page), which phrase pages hang under. */
async function parentOf(email: string) {
  const { data, error } = await supabase.from('landing_pages').select('id').eq('owner_email', email).is('parent_id', null).order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const id = ((data ?? []) as { id: string }[])[0]?.id;
  return id ? getOwnedParentPage(email, id) : null;
}

/** GET /api/seo/truth/phrases — the pages that exist, what we offer next, and how many are left. */
export async function getPhrases(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) return needAuth(res);
  try {
    const t = await getTruth(email);
    const parent = await parentOf(email);
    const kids = parent ? await listChildren(parent.id) : [];
    const plan = t ? suggest(t.card, kids.map((k) => k.target_keyword ?? '').filter(Boolean)) : { ideas: [], cap: 0, left: 0 };
    res.json({
      hasPage: !!parent, parentPublished: parent?.status === 'published',
      pages: parent ? kids.map((k) => ({ id: k.id, phrase: k.target_keyword, title: k.hero_title, url: childUrl(parent, k) })) : [],
      ideas: plan.ideas, cap: plan.cap, left: plan.left,
    });
  } catch (e) { fail(res, e); }
}

const PHRASE_HE: Record<string, [number, string]> = {
  not_offered: [400, 'אפשר ליצור דף רק לשירות ולאזור שמופיעים בפרטי העסק שלכם.'],
  exists: [409, 'כבר יש לכם דף לביטוי הזה.'],
  too_similar: [409, 'כבר יש לכם דף כמעט זהה. דפים שחוזרים על עצמם מזיקים לקידום ולא עוזרים לו.'],
  limit: [409, 'הגעתם למספר הדפים שמתאים לעסק שלכם. הוספת שירותים או אזורים בפרטי העסק פותחת דפים נוספים.'],
};

/** POST /api/seo/truth/phrases {phrase} — creates one phrase page, only for a phrase we offered. */
export async function createPhrasePage(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) return needAuth(res);
  const phrase = typeof req.body?.phrase === 'string' ? req.body.phrase.trim().slice(0, 80) : '';
  try {
    const t = await getTruth(email);
    if (!t) { fail(res, new TruthError('not_found')); return; }
    const parent = await parentOf(email);
    if (!parent) { res.status(409).json({ error: 'צריך קודם דף נחיתה. צרו אותו בלחיצה אחת מפרטי העסק.', code: 'no_page' }); return; }
    const kids = await listChildren(parent.id);
    const ok = admit(t.card, phrase, kids.map((k) => k.target_keyword ?? '').filter(Boolean));
    if (typeof ok === 'string') { res.status(PHRASE_HE[ok][0]).json({ error: PHRASE_HE[ok][1], code: ok }); return; }
    if (!underKitLimit(email)) { res.status(429).json({ error: 'הגעתם למגבלת היצירה היומית. נסו שוב מחר.' }); return; }
    let generated;
    try {
      generated = await generateChildText(parent.ai_content, { businessName: parent.business_name, businessType: t.card.category, area: ok.area, phrase, facts: factsText(t.card) });
    } catch (e) {
      console.error('[AUTOPILOT] phrase page generation failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
      res.status(502).json({ error: 'יצירת הדף נכשלה. נסו שוב בעוד רגע.' }); return;
    }
    const child = await insertChild(parent, phrase, buildChildContent(parent.ai_content, generated.text));
    void logActivity(email, 'page_created', `יצרנו דף לחיפוש "${phrase}"`, parent.status === 'published' ? null : 'הוא יעלה לאוויר יחד עם דף הנחיתה שלכם.', `phrase:${child.id}`);
    res.status(201).json({ page: { id: child.id, phrase, title: child.hero_title, url: childUrl(parent, child) }, parentPublished: parent.status === 'published' });
  } catch (e) { fail(res, e); }
}
