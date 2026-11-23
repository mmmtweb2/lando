// "עדכון הדף לפי פרטי העסק" (README part 146): reads the page and its business card, runs the page writer,
// keeps the candidate until the owner chooses, and saves only what they ticked. The pure rules are in
// pageRefresh.ts. No credits, no billing: the only limit is REFRESH_DAILY_LIMIT per page per day.

import { randomBytes } from 'crypto';
import { supabase } from '../config/supabase';
import { type AiContent, type GenerateInput, GenerationUnavailable, generateAiContent } from './ai.service';
import type { TruthCard } from './businessTruth';
import type { AttributeMeta } from './gbpAttributes';
import { type CategoryId, defaultHiddenSections, isMissingCategoryColumn, normalizeCategory, templateFor } from './pageCategory';
import { realLinkDeps } from './pageGoogle.service';
import {
  type RefreshPage, type RefreshPreviewSection, type RefreshSectionId, CandidateStore, RefreshCounter, REFRESH_SECTIONS,
  buildCandidate, cardToGenerateInput, cardUsable, mergeRefresh, nextCategory, previewSections,
} from './pageRefresh';

export type RefreshErrorCode = 'not_found' | 'no_card' | 'limit' | 'unavailable' | 'failed' | 'expired' | 'invalid' | 'nothing';
const STATUS: Record<RefreshErrorCode, number> = { not_found: 404, no_card: 409, limit: 429, unavailable: 503, failed: 502, expired: 410, invalid: 400, nothing: 409 };
const MESSAGE: Record<RefreshErrorCode, string> = {
  not_found: 'הדף לא נמצא.',
  no_card: 'עוד אין פרטי עסק שאפשר לעדכן מהם את הדף.',
  limit: 'אפשר לעדכן את הדף לפי פרטי העסק עד 3 פעמים ביום. נסו שוב מחר.',
  unavailable: 'האפשרות הזו לא זמינה כרגע. נסו שוב מאוחר יותר.',
  failed: 'לא הצלחנו להכין טקסטים חדשים הפעם. הדף לא השתנה. נסו שוב בעוד כמה דקות.',
  expired: 'ההצעה כבר לא בתוקף. בקשו עדכון חדש.',
  invalid: 'לא נבחר אף חלק להחלפה.',
  nothing: 'הטקסטים בדף כבר מתאימים לפרטי העסק. אין מה להחליף.',
};
export class RefreshError extends Error {
  readonly status: number;
  constructor(public readonly code: RefreshErrorCode) { super(MESSAGE[code]); this.status = STATUS[code]; }
}

/** One model run, start to end (both writer calls run in parallel, each with its own timeout). */
export const REFRESH_TIMEOUT_MS = 75_000;
const CALL_TIMEOUT_MS = 60_000;

export interface RefreshPageRow extends RefreshPage { id: string; owner_email?: string | null; parent_id?: string | null }
export interface CardFound { card: TruthCard; meta: AttributeMeta[] }

export interface RefreshDeps {
  page(id: string): Promise<RefreshPageRow | null>;
  card(page: RefreshPageRow): Promise<CardFound | null>;
  generate(input: GenerateInput): Promise<AiContent>;
  save(id: string, patch: { ai_content: AiContent; category?: CategoryId; category_source?: 'auto' }): Promise<void>;
  hasKey(): boolean;
  now(): Date;
  counter: RefreshCounter;
  store: CandidateStore;
  token(): string;
  /** The whole writer run; REFRESH_TIMEOUT_MS when unset. */
  timeoutMs?: number;
}

// ── Real dependencies ────────────────────────────────────────────────────────

const PAGE_COLS = 'id, owner_email, parent_id, business_name, phone_number, design_style, page_goal, about_business, ai_content';

async function readPage(id: string): Promise<RefreshPageRow | null> {
  const read = (cols: string) => supabase.from('landing_pages').select(cols).eq('id', id).maybeSingle();
  // category / category_source come with migration 053; before it the page is read without them (= general, auto).
  let { data, error } = await read(`${PAGE_COLS}, category, category_source`);
  if (error && isMissingCategoryColumn(error)) ({ data, error } = await read(PAGE_COLS));
  if (error) throw new Error(error.message);
  return (data as unknown as RefreshPageRow | null) ?? null;
}

/**
 * The business card behind a page: the page must be the business's own page (the same lookup as the Google link,
 * seoPageAddon.businessPageId: the included page, or the page created from the card) and the account's card must
 * have enough to write from. The listing does not have to be connected right now: the card is what we write from.
 */
export async function cardForPage(page: { id: string; owner_email?: string | null; parent_id?: string | null }): Promise<CardFound | null> {
  const email = (page.owner_email ?? '').trim().toLowerCase();
  if (!email || page.parent_id) return null;
  try {
    if ((await realLinkDeps.businessPageId(email)) !== page.id) return null;
    const t = await realLinkDeps.truth(email);
    return t && cardUsable(t.card) ? { card: t.card, meta: t.meta } : null;
  } catch (e) {
    console.error('[PAGE-REFRESH] card lookup failed:', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    return null;
  }
}

/** The ids of the account's pages that have a business card behind them (the dashboard shows the button there). */
export async function refreshablePageIds(email: string, pageIds: string[]): Promise<string[]> {
  if (!pageIds.length) return [];
  try {
    const id = await realLinkDeps.businessPageId(email);
    if (!id || !pageIds.includes(id)) return [];
    const t = await realLinkDeps.truth(email);
    return t && cardUsable(t.card) ? [id] : [];
  } catch { return []; }
}

const counter = new RefreshCounter();
const store = new CandidateStore();

export const realRefreshDeps: RefreshDeps = {
  page: readPage,
  card: cardForPage,
  generate: (input) => generateAiContent(input, { strict: true, timeoutMs: CALL_TIMEOUT_MS }),
  async save(id, patch) {
    let { error } = await supabase.from('landing_pages').update(patch).eq('id', id);
    if (error && isMissingCategoryColumn(error) && patch.category) {
      ({ error } = await supabase.from('landing_pages').update({ ai_content: patch.ai_content }).eq('id', id));
    }
    if (error) throw new Error(error.message);
  },
  hasKey: () => !!process.env.ANTHROPIC_API_KEY,
  now: () => new Date(),
  counter,
  store,
  token: () => randomBytes(16).toString('hex'),
};

// ── Steps ────────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

interface Prepared { page: RefreshPageRow; candidate: AiContent; category: CategoryId; categoryChanged: boolean }

/** Reads the page and its card, counts one refresh, and writes the candidate. Nothing is saved here. */
async function prepare(pageId: string, who: 'owner' | 'admin', deps: RefreshDeps): Promise<Prepared> {
  const page = await deps.page(pageId);
  if (!page) throw new RefreshError('not_found');
  const found = await deps.card(page);
  if (!found) throw new RefreshError('no_card');
  if (!deps.hasKey()) throw new RefreshError('unavailable');
  const now = deps.now();
  if (!deps.counter.take(pageId, who, now)) throw new RefreshError('limit');
  const category = nextCategory(page, found.card);
  const was = normalizeCategory(page.category);
  const categoryChanged = templateFor(category) !== templateFor(was);
  const started = Date.now();
  try {
    const written = await withTimeout(deps.generate(cardToGenerateInput(found.card, found.meta, page, category)), deps.timeoutMs ?? REFRESH_TIMEOUT_MS);
    if (written.page_strategy?.detected_goal === 'UNCLEAR_INPUT') throw new Error('unclear');
    const candidate = buildCandidate(written, found.card, page.ai_content);
    console.log(`[PAGE-REFRESH] ${who} candidate ready in ${Date.now() - started}ms (category ${category}${categoryChanged ? ', changed' : ''})`);
    return { page, candidate, category, categoryChanged };
  } catch (e) {
    deps.counter.refund(pageId, who, now);
    if (e instanceof GenerationUnavailable) throw new RefreshError('unavailable');
    console.error(`[PAGE-REFRESH] ${who} writer failed after ${Date.now() - started}ms:`, e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    throw new RefreshError('failed');
  }
}

/** Hidden sections the page had stay; a new template adds its own off-by-default ones. */
function finalContent(old: AiContent, merged: AiContent, category: CategoryId, categoryChanged: boolean): AiContent {
  if (!categoryChanged) return merged;
  const hidden = [...new Set([...(old.hidden_sections ?? []), ...defaultHiddenSections(category)])];
  return hidden.length ? { ...merged, hidden_sections: hidden } : merged;
}

function categoryPatch(page: RefreshPageRow, category: CategoryId): { category?: CategoryId; category_source?: 'auto' } {
  if (page.category_source === 'manual') return {};
  if (!('category' in page) && category === 'general') return {};   // before migration 053: nothing to store
  return normalizeCategory(page.category) === category && page.category_source === 'auto' ? {} : { category, category_source: 'auto' };
}

export interface PreviewResult { token: string; sections: RefreshPreviewSection[]; remaining: number }

/** POST .../refresh-from-card: the review. Nothing on the page changes. */
export async function previewRefresh(pageId: string, deps: RefreshDeps = realRefreshDeps): Promise<PreviewResult> {
  const p = await prepare(pageId, 'owner', deps);
  const sections = previewSections(p.page.ai_content ?? {}, p.candidate, { categoryChanged: p.categoryChanged });
  const token = deps.token();
  if (sections.length) deps.store.put(token, { pageId, candidate: p.candidate, category: p.category, categoryChanged: p.categoryChanged, at: deps.now().getTime() });
  return { token: sections.length ? token : '', sections, remaining: deps.counter.remaining(pageId, 'owner', deps.now()) };
}

export interface ApplyResult { ai_content: AiContent; applied: RefreshSectionId[]; category?: CategoryId; category_source?: 'auto' }

/** POST .../refresh-from-card/apply {token, sections}: only the ticked sections, onto the page as it is NOW. */
export async function applyRefresh(pageId: string, token: unknown, sections: unknown, deps: RefreshDeps = realRefreshDeps): Promise<ApplyResult> {
  const chosen = Array.isArray(sections) ? [...new Set(sections.filter((s): s is RefreshSectionId => REFRESH_SECTIONS.some((r) => r.id === s)))] : [];
  if (!chosen.length) throw new RefreshError('invalid');
  if (typeof token !== 'string' || !token) throw new RefreshError('expired');
  const c = deps.store.get(token, pageId, deps.now().getTime());
  if (!c) throw new RefreshError('expired');
  const page = await deps.page(pageId);
  if (!page) throw new RefreshError('not_found');
  const old = page.ai_content ?? {};
  const merged = finalContent(old, mergeRefresh(old, c.candidate, chosen, { categoryChanged: c.categoryChanged }), c.category, c.categoryChanged);
  const cat = categoryPatch(page, c.category);
  await deps.save(pageId, { ai_content: merged, ...cat });
  deps.store.drop(token);
  console.log(`[PAGE-REFRESH] applied ${chosen.join(',')}`);
  return { ai_content: merged, applied: chosen, ...cat };
}

/** Admin (the operator): writes and applies every changed section at once. Real testimonials and the team stay. */
export async function adminRefresh(pageId: string, deps: RefreshDeps = realRefreshDeps): Promise<ApplyResult> {
  const p = await prepare(pageId, 'admin', deps);
  const old = p.page.ai_content ?? {};
  const ids = previewSections(old, p.candidate, { categoryChanged: p.categoryChanged }).map((s) => s.id);
  if (!ids.length) throw new RefreshError('nothing');
  const merged = finalContent(old, mergeRefresh(old, p.candidate, ids, { categoryChanged: p.categoryChanged }), p.category, p.categoryChanged);
  const cat = categoryPatch(p.page, p.category);
  await deps.save(pageId, { ai_content: merged, ...cat });
  console.log(`[PAGE-REFRESH] admin applied ${ids.join(',')}`);
  return { ai_content: merged, applied: ids, ...cat };
}
