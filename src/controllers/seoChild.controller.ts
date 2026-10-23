// Stage 8.2b — SEO child pages for businesses linked to a Pagey page.
// All routes: auth + requireProduct('seo_autopilot'); owner-scoped via the business and the
// parent page's owner_email. Child pages are created `published` and become visible only while
// their parent is published (inherited at read time, migration 025).

import { Request, Response } from 'express';
import { getOwnedBusiness, PlanStoreError } from '../services/seoPlanStore';
import { cleanLabel } from '../services/seoPhrases';
import { buildChildContent, generateChildText, MAX_CHILD_PAGES_PER_PARENT } from '../services/seoChildPage';
import {
  childUrl, deleteChild, getOwnedParentPage, insertChild, linkLandingPage, listChildren,
} from '../services/seoChildStore';
import { underKitLimit } from './seoContent.controller';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function internal(res: Response, e: unknown): void {
  if (e instanceof PlanStoreError && e.code === 'not_migrated') {
    res.status(503).json({ error: 'התכונה עדיין לא הופעלה.', code: 'plan_not_migrated' });
    return;
  }
  console.error('[SEO] child pages error:', e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

function uuidParam(req: Request, res: Response, name: string): string | null {
  const v = req.params[name];
  if (!UUID_RE.test(v)) { res.status(400).json({ error: 'מזהה לא תקין.' }); return null; }
  return v;
}

/** PUT /api/seo/businesses/:id/landing-page { pageId: uuid | null } */
export async function linkPage(req: Request, res: Response): Promise<void> {
  const id = uuidParam(req, res, 'id'); if (!id) return;
  const pageId = req.body?.pageId ?? null;
  if (pageId !== null && (typeof pageId !== 'string' || !UUID_RE.test(pageId))) {
    res.status(400).json({ error: 'מזהה דף לא תקין.' });
    return;
  }
  try {
    if (pageId !== null && !(await getOwnedParentPage(req.authEmail!, pageId))) {
      res.status(404).json({ error: 'הדף לא נמצא.' });
      return;
    }
    const ok = await linkLandingPage(req.authEmail!, id, pageId);
    res.status(ok ? 200 : 404).json(ok ? { ok: true, pageId } : { error: 'העסק לא נמצא.' });
  } catch (e) { internal(res, e); }
}

/** GET /api/seo/businesses/:id/child-pages */
export async function getChildPages(req: Request, res: Response): Promise<void> {
  const id = uuidParam(req, res, 'id'); if (!id) return;
  try {
    const b = await getOwnedBusiness(req.authEmail!, id);
    if (!b) { res.status(404).json({ error: 'העסק לא נמצא.' }); return; }
    const parent = b.landing_page_id ? await getOwnedParentPage(req.authEmail!, b.landing_page_id) : null;
    if (!parent) { res.json({ parent: null, pages: [], max: MAX_CHILD_PAGES_PER_PARENT }); return; }
    const kids = await listChildren(parent.id);
    res.json({
      parent: { id: parent.id, name: parent.business_name, status: parent.status },
      pages: kids.map(c => ({ id: c.id, phrase: c.target_keyword, title: c.hero_title, url: childUrl(parent, c) })),
      max: MAX_CHILD_PAGES_PER_PARENT,
    });
  } catch (e) { internal(res, e); }
}

/** POST /api/seo/businesses/:id/child-pages { phrase } — phrase must be one the customer saved. */
export async function createChildPage(req: Request, res: Response): Promise<void> {
  const id = uuidParam(req, res, 'id'); if (!id) return;
  const email = req.authEmail!;
  const phrase = cleanLabel(req.body?.phrase, 3, 80);
  if (!phrase) { res.status(400).json({ error: 'הביטוי לא תקין.' }); return; }
  try {
    const b = await getOwnedBusiness(email, id);
    if (!b) { res.status(404).json({ error: 'העסק לא נמצא.' }); return; }
    const parent = b.landing_page_id ? await getOwnedParentPage(email, b.landing_page_id) : null;
    if (!parent) { res.status(400).json({ error: 'חברו קודם את העסק לדף Pagey שלכם.', code: 'no_page' }); return; }
    if (!b.business_type || !b.service_areas?.length || !b.long_tail_phrases.includes(phrase)) {
      res.status(400).json({ error: 'שמרו קודם את תחום העסק, האזורים והביטוי.' });
      return;
    }
    const kids = await listChildren(parent.id);
    if (kids.some(k => k.target_keyword === phrase)) {
      res.status(409).json({ error: 'כבר יצרתם דף לביטוי הזה.', code: 'exists' });
      return;
    }
    if (kids.length >= MAX_CHILD_PAGES_PER_PARENT) {
      res.status(409).json({ error: `אפשר ליצור עד ${MAX_CHILD_PAGES_PER_PARENT} דפים נוספים לדף.`, code: 'child_limit' });
      return;
    }
    if (!underKitLimit(email)) { res.status(429).json({ error: 'הגעתם למגבלת היצירה היומית.' }); return; }

    const area = [...b.service_areas].sort((x, y) => y.length - x.length).find(a => phrase.includes(a)) ?? b.service_areas[0];
    let generated;
    try {
      generated = await generateChildText(parent.ai_content, {
        businessName: parent.business_name, businessType: b.business_type, area, phrase, facts: b.facts ?? '',
      });
    } catch (e) {
      console.error('[SEO] child text generation failed:', (e as Error).message);
      res.status(502).json({ error: 'יצירת הדף נכשלה. נסו שוב בעוד רגע.' });
      return;
    }
    const child = await insertChild(parent, phrase, buildChildContent(parent.ai_content, generated.text));
    res.status(201).json({
      page: { id: child.id, phrase, title: child.hero_title, url: childUrl(parent, child) },
      dropped: generated.dropped,
      parentPublished: parent.status === 'published',
    });
  } catch (e) { internal(res, e); }
}

/** DELETE /api/seo/businesses/:id/child-pages/:pageId — refused when the page has leads. */
export async function removeChildPage(req: Request, res: Response): Promise<void> {
  const id = uuidParam(req, res, 'id'); if (!id) return;
  const pageId = uuidParam(req, res, 'pageId'); if (!pageId) return;
  try {
    const b = await getOwnedBusiness(req.authEmail!, id);
    const parent = b?.landing_page_id ? await getOwnedParentPage(req.authEmail!, b.landing_page_id) : null;
    if (!b || !parent) { res.status(404).json({ error: 'לא נמצא.' }); return; }
    const r = await deleteChild(parent.id, pageId);
    if (r === 'has_leads') {
      res.status(409).json({ error: 'יש פניות שהגיעו מהדף הזה, לכן אי אפשר למחוק אותו.', code: 'has_leads' });
      return;
    }
    res.status(r === 'deleted' ? 200 : 404).json(r === 'deleted' ? { ok: true } : { error: 'הדף לא נמצא.' });
  } catch (e) { internal(res, e); }
}
