// Database and model I/O for page languages (README part 142). The rules live in landingLanguages.ts (pure).
// Every read here tolerates a database without migration 054: the feature is simply not there.
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/supabase';
import type { AiContent } from './ai.service';
import {
  LANGUAGES, applyAltTranslation, applyTranslation, flattenTranslatable, isMissingTranslationsTable, staleKeys,
  type LangCode, type TranslateCall, type TranslationRow,
} from './landingLanguages';

export const TRANSLATION_COLUMNS = 'lang, status, content, source_hash, manual_keys, created_at, updated_at, approved_at';

export type LoadResult = { ready: true; rows: TranslationRow[] } | { ready: false; rows: [] };

function normalizeRow(r: Record<string, unknown>): TranslationRow {
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {});
  return {
    lang: String(r.lang),
    status: r.status === 'published' ? 'published' : 'draft',
    content: obj(r.content),
    source_hash: obj(r.source_hash),
    manual_keys: Array.isArray(r.manual_keys) ? (r.manual_keys as unknown[]).filter((k): k is string => typeof k === 'string') : [],
    updated_at: (r.updated_at as string | null) ?? null,
    approved_at: (r.approved_at as string | null) ?? null,
  };
}

/** All languages of a page. `ready: false` = migration 054 has not run (or the read failed): no languages. */
export async function loadTranslations(pageId: string): Promise<LoadResult> {
  try {
    const { data, error } = await supabase.from('landing_translations').select(TRANSLATION_COLUMNS).eq('page_id', pageId);
    if (error) {
      if (!isMissingTranslationsTable(error)) console.error('[LANG] load failed:', error.message);
      return { ready: false, rows: [] };
    }
    return { ready: true, rows: ((data ?? []) as Record<string, unknown>[]).map(normalizeRow) };
  } catch (e) {
    console.error('[LANG] load threw:', (e as Error)?.message ?? e);
    return { ready: false, rows: [] };
  }
}

export async function loadTranslation(pageId: string, lang: string): Promise<{ ready: boolean; row: TranslationRow | null }> {
  const { data, error } = await supabase.from('landing_translations').select(TRANSLATION_COLUMNS).eq('page_id', pageId).eq('lang', lang).maybeSingle();
  if (error) {
    if (isMissingTranslationsTable(error)) return { ready: false, row: null };
    throw new Error(error.message);
  }
  return { ready: true, row: data ? normalizeRow(data as Record<string, unknown>) : null };
}

export async function saveTranslation(pageId: string, lang: string, patch: Partial<TranslationRow>): Promise<TranslationRow> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('landing_translations')
    .upsert({ page_id: pageId, lang, ...patch, updated_at: now }, { onConflict: 'page_id,lang' })
    .select(TRANSLATION_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'save failed');
  return normalizeRow(data as Record<string, unknown>);
}

export async function deleteTranslation(pageId: string, lang: string): Promise<void> {
  const { error } = await supabase.from('landing_translations').delete().eq('page_id', pageId).eq('lang', lang);
  if (error) throw new Error(error.message);
}

/** What a visitor gets: published languages only, content only. */
export function publicTranslations(rows: TranslationRow[]): Array<{ lang: string; status: 'published'; content: Record<string, string> }> {
  return rows.filter((r) => r.status === 'published' && LANGUAGES[r.lang as LangCode]?.enabled)
    .map((r) => ({ lang: r.lang, status: 'published' as const, content: r.content }));
}

/** What the owner gets: every language, with what is out of date and what they wrote by hand. */
export function ownerTranslations(rows: TranslationRow[], content: AiContent, userImages: unknown) {
  const flat = flattenTranslatable(content, userImages);
  return rows.filter((r) => LANGUAGES[r.lang as LangCode]?.enabled).map((r) => ({
    lang: r.lang, status: r.status, content: r.content, manual_keys: r.manual_keys,
    stale_keys: staleKeys(flat, r), total_keys: Object.keys(flat).length,
    updated_at: r.updated_at, approved_at: r.approved_at,
  }));
}

/** The page's content and images in a language (for the server-rendered head and body). */
export function translatedPage<T extends { ai_content: unknown; user_images?: unknown }>(page: T, row: TranslationRow | null): T {
  if (!row) return page;
  return {
    ...page,
    ai_content: applyTranslation((page.ai_content ?? {}) as object, row.content),
    user_images: applyAltTranslation(page.user_images, row.content),
  };
}

// ─── The model ────────────────────────────────────────────────────────────────

const TRANSLATE_MODEL = 'claude-sonnet-4-6';

function anthropicCall(model: string, maxTokens: number): TranslateCall {
  return async (system, user) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('no ANTHROPIC_API_KEY');
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
    return r.content[0]?.type === 'text' ? r.content[0].text : '';
  };
}

/** The real page-translation call. Without an API key it throws, and the caller answers "try again later". */
export const anthropicTranslateCall: TranslateCall = anthropicCall(TRANSLATE_MODEL, 8000);
/** A visitor's short message: the cheap model is enough. */
const leadTranslateCall: TranslateCall = anthropicCall('claude-haiku-4-5', 1500);

/**
 * A visitor wrote to the business in French or English: a Hebrew translation of the free text for the owner.
 * Returns null on any failure (the email then carries the original with a note).
 */
export async function translateLeadMessageToHebrew(message: string, fromLang: string, call: TranslateCall = leadTranslateCall): Promise<string | null> {
  const from = LANGUAGES[fromLang as LangCode]?.english ?? 'the visitor\'s language';
  try {
    const system = `Translate the customer's message from ${from} into natural Hebrew for a small business owner. Keep names, phone numbers, emails and numbers exactly. Return only the Hebrew translation, nothing else.`;
    const out = (await Promise.race([
      call(system, message),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('lead translation timeout')), 12000)),
    ])).trim();
    return out && /[א-ת]/.test(out) ? out.slice(0, 4000) : null;
  } catch (e) {
    console.warn('[LANG] lead message translation failed:', (e as Error)?.message ?? e);
    return null;
  }
}
