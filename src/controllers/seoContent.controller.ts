// Stage 8 — content plan (service areas, long-tail phrases) and copy-ready kits for
// external websites. All routes: auth + requireProduct('seo_autopilot'); every business
// lookup is owner-scoped.

import { Request, Response } from 'express';
import { generateKit, renderKitHtml, renderKitText } from '../services/seoContent';
import { suggestPhrases, cleanLabel, validateSettings, MAX_AREAS } from '../services/seoPhrases';
import {
  MAX_KITS_PER_BUSINESS, PlanStoreError, addKit, getOwnedBusiness, listKits, removeKit, saveSettings,
  type StoredKit,
} from '../services/seoPlanStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-account daily ceiling on (paid) model generations. In-memory, like the other caps.
const kitUsage = new Map<string, { day: string; count: number }>();
export function underKitLimit(email: string): boolean {
  const cap = Number(process.env.SEO_KIT_DAILY_CAP) > 0 ? Number(process.env.SEO_KIT_DAILY_CAP) : 10;
  const day = new Date().toISOString().slice(0, 10);
  const u = kitUsage.get(email);
  if (!u || u.day !== day) { kitUsage.set(email, { day, count: 1 }); return true; }
  if (u.count >= cap) return false;
  u.count += 1;
  return true;
}

function fail(res: Response, e: unknown): void {
  if (e instanceof PlanStoreError && e.code === 'not_migrated') {
    res.status(503).json({ error: 'התכונה עדיין לא הופעלה.', code: 'plan_not_migrated' });
    return;
  }
  console.error('[SEO] content plan error:', e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

function publicKit(k: StoredKit) {
  return { id: k.id, phrase: k.phrase, created_at: k.created_at, kit: k.kit, html: renderKitHtml(k.kit), text: renderKitText(k.kit) };
}

function bizId(req: Request, res: Response): string | null {
  const id = req.params.id;
  if (!UUID_RE.test(id)) { res.status(400).json({ error: 'מזהה לא תקין.' }); return null; }
  return id;
}

/** POST /api/seo/phrases/suggest { businessType, serviceAreas } — stateless. */
export function suggest(req: Request, res: Response): void {
  const t = cleanLabel(req.body?.businessType, 2, 40);
  const areas: string[] = [];
  for (const a of Array.isArray(req.body?.serviceAreas) ? req.body.serviceAreas : []) {
    const c = cleanLabel(a, 2, 30);
    if (c && !areas.includes(c)) areas.push(c);
  }
  if (!t || areas.length === 0 || areas.length > MAX_AREAS) {
    res.status(400).json({ error: 'צריך תחום עסק ואזור שירות אחד לפחות.' });
    return;
  }
  res.json({ phrases: suggestPhrases(t, areas) });
}

/** GET /api/seo/businesses/:id/plan — saved settings + generated kits. */
export async function getPlan(req: Request, res: Response): Promise<void> {
  const id = bizId(req, res); if (!id) return;
  try {
    const b = await getOwnedBusiness(req.authEmail!, id);
    if (!b) { res.status(404).json({ error: 'העסק לא נמצא.' }); return; }
    const kits = await listKits(b.id);
    res.json({
      settings: { businessType: b.business_type ?? '', serviceAreas: b.service_areas ?? [], phrases: b.long_tail_phrases ?? [], facts: b.facts ?? '' },
      kits: kits.map(publicKit),
      maxKits: MAX_KITS_PER_BUSINESS,
    });
  } catch (e) { fail(res, e); }
}

/** PUT /api/seo/businesses/:id/plan { businessType, serviceAreas, phrases, facts } */
export async function savePlan(req: Request, res: Response): Promise<void> {
  const id = bizId(req, res); if (!id) return;
  const v = validateSettings(req.body);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  try {
    const b = await saveSettings(req.authEmail!, id, v.value);
    if (!b) { res.status(404).json({ error: 'העסק לא נמצא.' }); return; }
    res.json({ settings: v.value });
  } catch (e) { fail(res, e); }
}

/** POST /api/seo/businesses/:id/content-kits { phrase } — phrase must be one the customer chose. */
export async function createKit(req: Request, res: Response): Promise<void> {
  const id = bizId(req, res); if (!id) return;
  const email = req.authEmail!;
  const phrase = cleanLabel(req.body?.phrase, 3, 80);
  if (!phrase) { res.status(400).json({ error: 'הביטוי לא תקין.' }); return; }
  try {
    const b = await getOwnedBusiness(email, id);
    if (!b) { res.status(404).json({ error: 'העסק לא נמצא.' }); return; }
    if (!b.business_type || !b.service_areas?.length || !b.long_tail_phrases.includes(phrase)) {
      res.status(400).json({ error: 'שמרו קודם את תחום העסק, האזורים והביטוי.' });
      return;
    }
    const existing = await listKits(b.id);
    if (existing.length >= MAX_KITS_PER_BUSINESS) {
      res.status(409).json({ error: `אפשר לשמור עד ${MAX_KITS_PER_BUSINESS} חבילות לעסק. מחקו חבילה קיימת.`, code: 'kit_limit' });
      return;
    }
    if (!underKitLimit(email)) { res.status(429).json({ error: 'הגעתם למגבלת היצירה היומית.' }); return; }

    // The area this phrase targets: the longest saved area that appears in it (fallback: first).
    const area = [...b.service_areas].sort((x, y) => y.length - x.length).find(a => phrase.includes(a)) ?? b.service_areas[0];
    let kit;
    try {
      kit = await generateKit({ businessName: b.name, businessType: b.business_type, area, phrase, facts: b.facts ?? '' });
    } catch (e) {
      console.error('[SEO] kit generation failed:', (e as Error).message);
      res.status(502).json({ error: 'יצירת התוכן נכשלה. נסו שוב בעוד רגע.' });
      return;
    }
    res.status(201).json({ kit: publicKit(await addKit(b.id, phrase, kit)) });
  } catch (e) { fail(res, e); }
}

/** DELETE /api/seo/businesses/:id/content-kits/:kitId */
export async function deleteKit(req: Request, res: Response): Promise<void> {
  const id = bizId(req, res); if (!id) return;
  if (!UUID_RE.test(req.params.kitId)) { res.status(400).json({ error: 'מזהה לא תקין.' }); return; }
  try {
    const b = await getOwnedBusiness(req.authEmail!, id);
    if (!b) { res.status(404).json({ error: 'העסק לא נמצא.' }); return; }
    const ok = await removeKit(b.id, req.params.kitId);
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'החבילה לא נמצאה.' });
  } catch (e) { fail(res, e); }
}
