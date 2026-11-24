// Owner endpoints for page languages (README part 142). All behind requireAuth + requireOwnPage.
// Without migration 054 every endpoint answers 503 {code:'not_migrated'}; serving pages is unaffected.
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import type { AiContent } from '../services/ai.service';
import {
  applyManualEdits, canAddLanguage, flattenTranslatable, initialStatus, isTranslationLang, mergeTranslated, planRefresh,
  sourceHashes, translateFlat, type LangCode, type TranslateCall,
} from '../services/landingLanguages';
import {
  anthropicTranslateCall, deleteTranslation, loadTranslation, loadTranslations, ownerTranslations, saveTranslation,
} from '../services/landingTranslations.service';
import { serverError } from '../utils/httpErrors';
import { editErrorBody, validateTranslationChanges } from '../utils/pageEditInput';

/** Swappable for tests and dev harnesses; production uses the real model. */
let translateCall: TranslateCall = anthropicTranslateCall;
export function setTranslateCallForTests(c: TranslateCall): void { translateCall = c; }

const NOT_MIGRATED = { code: 'not_migrated', error: 'האפשרות תהיה זמינה בקרוב.' };
const TRANSLATE_FAILED = 'התרגום לא הצליח הפעם. נסו שוב בעוד רגע.';

interface PageRow { id: string; owner_email: string | null; business_name: string; ai_content: AiContent; user_images: unknown; parent_id: string | null; category?: string | null }

async function loadPage(id: string): Promise<PageRow | null> {
  // '*' on purpose: `category` (migration 053) may not exist yet.
  const { data, error } = await supabase.from('landing_pages').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as unknown as PageRow;
}

async function listFor(page: PageRow) {
  const all = await loadTranslations(page.id);
  return ownerTranslations(all.rows, withName(page), page.user_images);
}

function langParam(req: Request, res: Response): LangCode | null {
  const lang = req.params.lang ?? (req.body as { lang?: unknown } | undefined)?.lang;
  if (!isTranslationLang(lang)) { res.status(400).json({ error: 'השפה הזו אינה זמינה.' }); return null; }
  return lang;
}

/** GET /api/landing/:id/translations */
export async function listTranslations(req: Request, res: Response): Promise<void> {
  const page = await loadPage(req.params.id);
  if (!page) { res.status(404).json({ error: 'הדף לא נמצא.' }); return; }
  const all = await loadTranslations(page.id);
  if (!all.ready) { res.status(503).json(NOT_MIGRATED); return; }
  res.json({ translations: ownerTranslations(all.rows, withName(page), page.user_images) });
}

/** POST /api/landing/:id/translations {lang}: translate the whole page in one click. */
export async function addTranslation(req: Request, res: Response): Promise<void> {
  const lang = langParam(req, res);
  if (!lang) return;
  try {
    const page = await loadPage(req.params.id);
    if (!page) { res.status(404).json({ error: 'הדף לא נמצא.' }); return; }
    if (page.parent_id) { res.status(400).json({ error: 'אפשר להוסיף שפות לדף הראשי בלבד.' }); return; }
    // Billing hook: always true for now (no charge, no credits). See canAddLanguage.
    if (!canAddLanguage(page)) { res.status(402).json({ code: 'payment_required', error: 'הוספת שפה אינה כלולה כרגע בחבילה שלכם.' }); return; }
    const existing = await loadTranslation(page.id, lang);
    if (!existing.ready) { res.status(503).json(NOT_MIGRATED); return; }

    const flat = flattenTranslatable(withName(page), page.user_images);
    const health = page.category === 'health';
    const result = await translateFlat(flat, lang, { health, businessName: page.business_name, call: translateCall });
    if (Object.keys(result.value).length === 0) { res.status(502).json({ error: TRANSLATE_FAILED }); return; }

    const hashes = sourceHashes(flat);
    const source_hash: Record<string, string> = {};
    for (const k of Object.keys(result.value)) source_hash[k] = hashes[k];
    // Re-adding a language the page already has keeps its status (an approved health page stays published).
    const status = existing.row?.status ?? initialStatus(page.category);
    await saveTranslation(page.id, lang, {
      content: result.value, source_hash, manual_keys: [], status,
      ...(status === 'published' && !health ? { approved_at: new Date().toISOString() } : {}),
    });
    res.status(201).json({ lang, status, failed: result.failed.length, translations: await listFor(page) });
  } catch (e) {
    serverError(res, e, '[LANG]');
  }
}

/** PATCH /api/landing/:id/translations/:lang {changes: {key: text}}: the owner's own wording. */
export async function editTranslation(req: Request, res: Response): Promise<void> {
  const lang = langParam(req, res);
  if (!lang) return;
  const changes = (req.body as { changes?: unknown } | undefined)?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) { res.status(400).json({ error: 'בקשה לא תקינה.' }); return; }
  const tooLong = validateTranslationChanges(changes as Record<string, unknown>);
  if (Object.keys(tooLong).length) { res.status(400).json(editErrorBody(tooLong)); return; }
  try {
    const page = await loadPage(req.params.id);
    if (!page) { res.status(404).json({ error: 'הדף לא נמצא.' }); return; }
    const { ready, row } = await loadTranslation(page.id, lang);
    if (!ready) { res.status(503).json(NOT_MIGRATED); return; }
    if (!row) { res.status(404).json({ error: 'השפה הזו עדיין לא נוספה לדף.' }); return; }
    const flat = flattenTranslatable(withName(page), page.user_images);
    const { row: next, applied } = applyManualEdits(flat, row, changes as Record<string, unknown>);
    if (applied.length) await saveTranslation(page.id, lang, { ...next, status: row.status });
    res.json({ applied, translations: await listFor(page) });
  } catch (e) {
    serverError(res, e, '[LANG]');
  }
}

/**
 * POST /api/landing/:id/translations/:lang/refresh {manual?: 'overwrite' | 'keep'}
 * Re-translates only the texts whose Hebrew changed. Texts the owner wrote by hand are never replaced
 * silently: without `manual` the answer is 409 with the list, and the owner chooses.
 */
export async function refreshTranslation(req: Request, res: Response): Promise<void> {
  const lang = langParam(req, res);
  if (!lang) return;
  const mode = (req.body as { manual?: unknown } | undefined)?.manual;
  const manualMode = mode === 'overwrite' || mode === 'keep' ? mode : undefined;
  try {
    const page = await loadPage(req.params.id);
    if (!page) { res.status(404).json({ error: 'הדף לא נמצא.' }); return; }
    const { ready, row } = await loadTranslation(page.id, lang);
    if (!ready) { res.status(503).json(NOT_MIGRATED); return; }
    if (!row) { res.status(404).json({ error: 'השפה הזו עדיין לא נוספה לדף.' }); return; }
    const flat = flattenTranslatable(withName(page), page.user_images);
    const plan = planRefresh(flat, row, manualMode);
    if (plan.manualConflicts.length && !manualMode) {
      res.status(409).json({
        code: 'manual_conflict',
        keys: plan.manualConflicts,
        items: plan.manualConflicts.map((k) => ({ key: k, source: flat[k], current: row.content[k] })),
        error: 'חלק מהטקסטים שתרגמתם בעצמכם השתנו בעברית.',
      });
      return;
    }
    const toTranslate: Record<string, string> = {};
    for (const k of plan.translate) toTranslate[k] = flat[k];
    let fresh: Record<string, string> = {};
    let failed = 0;
    if (Object.keys(toTranslate).length) {
      const result = await translateFlat(toTranslate, lang, { health: page.category === 'health', businessName: page.business_name, call: translateCall });
      if (Object.keys(result.value).length === 0) { res.status(502).json({ error: TRANSLATE_FAILED }); return; }
      fresh = result.value;
      failed = result.failed.length;
    }
    const keep = manualMode === 'keep' ? plan.manualConflicts : [];
    const merged = mergeTranslated(flat, row, fresh, keep);
    await saveTranslation(page.id, lang, { ...merged, status: row.status });
    res.json({ updated: Object.keys(fresh).length, kept: keep.length, failed, translations: await listFor(page) });
  } catch (e) {
    serverError(res, e, '[LANG]');
  }
}

/** POST /api/landing/:id/translations/:lang/publish: "אישור ופרסום" (the health page's approval). */
export async function publishTranslation(req: Request, res: Response): Promise<void> {
  const lang = langParam(req, res);
  if (!lang) return;
  try {
    const page = await loadPage(req.params.id);
    if (!page) { res.status(404).json({ error: 'הדף לא נמצא.' }); return; }
    const { ready, row } = await loadTranslation(page.id, lang);
    if (!ready) { res.status(503).json(NOT_MIGRATED); return; }
    if (!row) { res.status(404).json({ error: 'השפה הזו עדיין לא נוספה לדף.' }); return; }
    await saveTranslation(page.id, lang, { status: 'published', approved_at: new Date().toISOString() });
    res.json({ translations: await listFor(page) });
  } catch (e) {
    serverError(res, e, '[LANG]');
  }
}

/** DELETE /api/landing/:id/translations/:lang: remove a language from the page. */
export async function removeTranslation(req: Request, res: Response): Promise<void> {
  const lang = langParam(req, res);
  if (!lang) return;
  try {
    const page = await loadPage(req.params.id);
    if (!page) { res.status(404).json({ error: 'הדף לא נמצא.' }); return; }
    const { ready } = await loadTranslation(page.id, lang);
    if (!ready) { res.status(503).json(NOT_MIGRATED); return; }
    await deleteTranslation(page.id, lang);
    res.json({ translations: await listFor(page) });
  } catch (e) {
    serverError(res, e, '[LANG]');
  }
}

/** The page's texts plus its business name, so the name is translated with the page (decision 23.11). */
function withName(page: { ai_content: unknown; business_name?: string | null }) {
  return { ...((page.ai_content ?? {}) as object), business_name: page.business_name ?? '' } as never;
}
