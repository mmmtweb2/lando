// Page languages for the landing-page product (README part 142): a page written in Hebrew can be shown in
// more languages, each at its own address (/p/<slug>/fr, <sub>.pagey.co.il/fr, /b/<sub>/fr). The Hebrew
// page stays the source; a translation is a flat map "key -> text" over the page's translatable strings,
// stored in `landing_translations` (migration 054) with a hash of the Hebrew text each key was translated
// from, so a changed Hebrew text shows up as "not updated".
//
// Pure module: no I/O, no network. The AI call is injected (translateFlat's `call`), so everything here is
// tested without a model or a database. A mirror of the client-side part lives in
// client/src/i18n/landingLanguages.ts (scripts/test-landing-languages.ts checks they agree).
import { createHash } from 'crypto';
import type { AiContent } from './ai.service';

// ─── Languages (config) ───────────────────────────────────────────────────────

export type LangCode = 'he' | 'fr' | 'en' | 'ru' | 'ar';

export interface LangConfig {
  code: LangCode;
  dir: 'rtl' | 'ltr';
  /** Hebrew name, for the owner's editor and the lead email ("צרפתית"). */
  heName: string;
  /** The language's own name, for the visitor's switch ("Français"). */
  native: string;
  /** English name, for the translation prompt. */
  english: string;
  ogLocale: string;
  /** Enabled = the owner can add it and visitors can be served it. Russian and Arabic are ready but off. */
  enabled: boolean;
}

export const SOURCE_LANG: LangCode = 'he';

export const LANGUAGES: Record<LangCode, LangConfig> = {
  he: { code: 'he', dir: 'rtl', heName: 'עברית', native: 'עברית', english: 'Hebrew', ogLocale: 'he_IL', enabled: true },
  fr: { code: 'fr', dir: 'ltr', heName: 'צרפתית', native: 'Français', english: 'French', ogLocale: 'fr_FR', enabled: true },
  en: { code: 'en', dir: 'ltr', heName: 'אנגלית', native: 'English', english: 'English', ogLocale: 'en_US', enabled: true },
  // Ready for later, by config only (the database already accepts them): switch `enabled` on and add the
  // strings in client/src/i18n/pageStrings.ts. Arabic is right-to-left: the page keeps its RTL layout.
  ru: { code: 'ru', dir: 'ltr', heName: 'רוסית', native: 'Русский', english: 'Russian', ogLocale: 'ru_RU', enabled: false },
  ar: { code: 'ar', dir: 'rtl', heName: 'ערבית', native: 'العربية', english: 'Arabic', ogLocale: 'ar_AR', enabled: false },
};

/** Every language the database accepts as a translation (the CHECK in migration 054). */
export const DB_TRANSLATION_LANGS: LangCode[] = ['fr', 'en', 'ru', 'ar'];

/** Languages a page can be translated into right now. */
export const TRANSLATION_LANGS: LangCode[] = DB_TRANSLATION_LANGS.filter((l) => LANGUAGES[l].enabled);

export function isTranslationLang(x: unknown): x is LangCode {
  return typeof x === 'string' && (TRANSLATION_LANGS as string[]).includes(x);
}

export function langDir(lang: string | null | undefined): 'rtl' | 'ltr' {
  return (LANGUAGES as Record<string, LangConfig>)[lang ?? '']?.dir ?? 'rtl';
}

// ─── Status rules ─────────────────────────────────────────────────────────────

export type TranslationStatus = 'draft' | 'published';

/**
 * A medical page in another language waits for the owner's approval (someone who reads that language
 * should check it); every other page is published as soon as it is translated, and stays editable.
 */
export function initialStatus(_category?: string | null): TranslationStatus {
  // Decision 22.11: no separate approval step. The owner reviews the translation together with the page,
  // before the page goes live; a translation is served to visitors only when the page itself is.
  return 'published';
}

/**
 * The one place a charge for an extra language would be checked. Nothing is charged now (payments need
 * the owner's explicit approval), and no "smart changes" credits are used.
 * TODO(billing): plug the paid add-on / credits check in here once it is approved.
 */
export function canAddLanguage(_page: { id: string; owner_email?: string | null }): boolean {
  return true;
}

/** True when an error means migration 054 has not run yet (the table or the leads.lang column is missing). */
export function isMissingTranslationsTable(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  const msg = e.message ?? '';
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  if ((e.code === '42703' || e.code === 'PGRST204') && /lang|landing_translations/.test(msg)) return true;
  return /landing_translations/.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

// ─── Flatten / apply ──────────────────────────────────────────────────────────

/** Scalar fields translated as they are. */
const SCALAR_PATHS = [
  'hero.title', 'hero.subtitle', 'hero.slogan', 'hero.primary_cta_text',
  'about.heading', 'about.content',
  'services_heading', 'services_kicker', 'benefits_heading', 'benefits_kicker', 'faq_heading', 'faq_kicker',
  'process_heading', 'process_kicker', 'testimonials_heading', 'testimonials_kicker', 'team_heading',
  'cta_banner_subline', 'seo_title', 'seo_description',
  // Not part of ai_content: the controller passes the page's business_name in the same object (decision 23.11).
  'business_name',
  'contact.business_hours', 'contact.whatsapp_message', 'contact.cta_text',
  'practical_info.parking', 'practical_info.accessibility',
  'gallery.heading', 'before_after.heading',
] as const;

/** List fields: which item fields are translated. Reviewers' names, licence numbers and ids are not; team names are transliterated. */
const LIST_FIELDS: Record<string, string[]> = {
  services_or_benefits: ['title', 'description'],
  services: ['title', 'description'],
  benefits: ['title', 'description'],
  faq: ['question', 'answer'],
  process_steps: ['title', 'description'],
  testimonials: ['quote', 'role'],
  trust_badges: ['label'],
  team: ['name', 'role', 'credentials', 'experience'],
};

/** Plain string lists. */
const STRING_LISTS = ['spoken_languages'];

/** Image alt texts live in user_images.img_meta[url].alt (README part 140); their key is ALT_PREFIX + url. */
export const ALT_PREFIX = 'img_alt:';

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export const isPlaceholderQuote = (q: unknown): boolean => typeof q === 'string' && (q.includes('הכנס כאן') || q.includes('ציטוט אמיתי'));

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function parseImages(userImages: unknown): unknown {
  if (typeof userImages !== 'string') return userImages ?? null;
  try { return JSON.parse(userImages); } catch { return null; }
}

/** Every translatable, non-empty string of a page, as key -> Hebrew text. Stable order. */
export function flattenTranslatable(content: AiContent | null | undefined, userImages?: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const c = (content ?? {}) as Record<string, unknown>;
  for (const p of SCALAR_PATHS) {
    const v = getPath(c, p);
    if (filled(v)) out[p] = v;
  }
  for (const [list, fields] of Object.entries(LIST_FIELDS)) {
    const arr = c[list];
    if (!Array.isArray(arr)) continue;
    arr.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      // The "write a real quote here" placeholder stays as it is: the page hides it from visitors by its Hebrew text.
      if (list === 'testimonials' && isPlaceholderQuote((item as { quote?: unknown }).quote)) return;
      for (const f of fields) {
        const v = (item as Record<string, unknown>)[f];
        if (filled(v)) out[`${list}.${i}.${f}`] = v;
      }
    });
  }
  for (const list of STRING_LISTS) {
    const arr = c[list];
    if (!Array.isArray(arr)) continue;
    arr.forEach((v, i) => { if (filled(v)) out[`${list}.${i}`] = v; });
  }
  const imgs = parseImages(userImages);
  if (imgs && typeof imgs === 'object' && !Array.isArray(imgs)) {
    const meta = (imgs as { img_meta?: unknown }).img_meta;
    if (meta && typeof meta === 'object') {
      for (const [url, m] of Object.entries(meta as Record<string, unknown>)) {
        const alt = m && typeof m === 'object' ? (m as { alt?: unknown }).alt : undefined;
        if (filled(alt)) out[`${ALT_PREFIX}${url}`] = alt;
      }
    }
  }
  return out;
}

/**
 * The page's content in another language: a copy of the Hebrew content with every translated key written
 * over it. A key whose place no longer exists in the source is ignored; a source text that has no
 * translation yet stays in Hebrew (the owner sees it as "not updated").
 */
export function applyTranslation<T extends object>(content: T, translated: Record<string, string> | null | undefined): T {
  const next = JSON.parse(JSON.stringify(content ?? {})) as Record<string, unknown>;
  if (!translated) return next as T;
  for (const [key, value] of Object.entries(translated)) {
    if (typeof value !== 'string' || key.startsWith(ALT_PREFIX)) continue;
    const parts = key.split('.');
    let obj: unknown = next;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      const child = (obj as Record<string, unknown>)?.[Array.isArray(obj) ? Number(p) : p];
      if (!child || typeof child !== 'object') { ok = false; break; }
      obj = child;
    }
    if (!ok) continue;
    const last = parts[parts.length - 1];
    const holder = obj as Record<string, unknown>;
    const idx = Array.isArray(obj) ? Number(last) : last;
    if (typeof holder[idx as keyof typeof holder] !== 'string') continue; // only replace an existing text
    (holder as Record<string | number, unknown>)[idx] = value;
  }
  return next as T;
}

/** user_images with the alt texts in another language (same JSON string shape as stored). */
export function applyAltTranslation(userImages: unknown, translated: Record<string, string> | null | undefined): unknown {
  if (!translated) return userImages;
  const imgs = parseImages(userImages);
  if (!imgs || typeof imgs !== 'object' || Array.isArray(imgs)) return userImages;
  const meta = (imgs as { img_meta?: Record<string, Record<string, unknown>> }).img_meta;
  if (!meta || typeof meta !== 'object') return userImages;
  const nextMeta: Record<string, Record<string, unknown>> = {};
  for (const [url, m] of Object.entries(meta)) {
    const t = translated[`${ALT_PREFIX}${url}`];
    nextMeta[url] = typeof t === 'string' && m && typeof m === 'object' ? { ...m, alt: t } : m;
  }
  const out = { ...(imgs as object), img_meta: nextMeta };
  return typeof userImages === 'string' ? JSON.stringify(out) : out;
}

// ─── Stale detection ──────────────────────────────────────────────────────────

export function hashText(s: string): string {
  return createHash('sha1').update(s.normalize('NFC').trim(), 'utf8').digest('hex').slice(0, 16);
}

export function sourceHashes(flat: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(flat)) out[k] = hashText(v);
  return out;
}

export interface TranslationRow {
  lang: string;
  status: TranslationStatus;
  content: Record<string, string>;
  source_hash: Record<string, string>;
  manual_keys: string[];
  updated_at?: string | null;
  approved_at?: string | null;
}

/** Keys whose Hebrew text changed since they were translated, or that have no translation yet. */
export function staleKeys(flat: Record<string, string>, row: Pick<TranslationRow, 'content' | 'source_hash'>): string[] {
  const content = row.content ?? {};
  const hashes = row.source_hash ?? {};
  return Object.keys(flat).filter((k) => typeof content[k] !== 'string' || hashes[k] !== hashText(flat[k]));
}

export interface RefreshPlan {
  /** Keys to send to translation. */
  translate: string[];
  /** Stale keys the owner edited by hand: never overwritten without an explicit confirmation. */
  manualConflicts: string[];
}

/**
 * What "עדכון התרגום" does: only stale keys are re-translated. A stale key the owner edited by hand is
 * re-translated only with mode 'overwrite'; with 'keep' its text stays and it is marked up to date; with no
 * mode the caller must ask first (manualConflicts is non-empty).
 */
export function planRefresh(flat: Record<string, string>, row: Pick<TranslationRow, 'content' | 'source_hash' | 'manual_keys'>, mode?: 'overwrite' | 'keep'): RefreshPlan {
  const stale = staleKeys(flat, row);
  const manual = new Set(row.manual_keys ?? []);
  const manualConflicts = stale.filter((k) => manual.has(k) && typeof row.content?.[k] === 'string');
  const translate = stale.filter((k) => !manualConflicts.includes(k) || mode === 'overwrite');
  return { translate, manualConflicts };
}

/** Merge a fresh translation into a row. Overwritten keys stop being "manual"; kept manual keys get the new hash. */
export function mergeTranslated(
  flat: Record<string, string>,
  row: Pick<TranslationRow, 'content' | 'source_hash' | 'manual_keys'>,
  fresh: Record<string, string>,
  keepManual: string[] = [],
): Pick<TranslationRow, 'content' | 'source_hash' | 'manual_keys'> {
  const content: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  // drop keys whose source text is gone
  for (const k of Object.keys(flat)) {
    if (typeof row.content?.[k] === 'string') { content[k] = row.content[k]; if (row.source_hash?.[k]) hashes[k] = row.source_hash[k]; }
  }
  for (const [k, v] of Object.entries(fresh)) {
    if (!(k in flat)) continue;
    content[k] = v;
    hashes[k] = hashText(flat[k]);
  }
  for (const k of keepManual) if (k in flat && typeof content[k] === 'string') hashes[k] = hashText(flat[k]);
  const manual = (row.manual_keys ?? []).filter((k) => k in flat && !(k in fresh));
  return { content, source_hash: hashes, manual_keys: manual };
}

/** The owner typed over some texts in a language's view: those keys become "manual" and up to date. */
export function applyManualEdits(
  flat: Record<string, string>,
  row: Pick<TranslationRow, 'content' | 'source_hash' | 'manual_keys'>,
  changes: Record<string, unknown>,
): { row: Pick<TranslationRow, 'content' | 'source_hash' | 'manual_keys'>; applied: string[] } {
  const content = { ...(row.content ?? {}) };
  const hashes = { ...(row.source_hash ?? {}) };
  const manual = new Set(row.manual_keys ?? []);
  const applied: string[] = [];
  for (const [k, v] of Object.entries(changes ?? {})) {
    if (!(k in flat) || typeof v !== 'string') continue;
    const text = v.trim().slice(0, 4000);
    if (!text) continue;
    content[k] = text;
    hashes[k] = hashText(flat[k]);
    manual.add(k);
    applied.push(k);
  }
  return { row: { content, source_hash: hashes, manual_keys: [...manual] }, applied };
}

// ─── Validation of the model's answer ─────────────────────────────────────────

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+|\bwww\.[^\s"'<>]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Israeli and international phone numbers: at least 7 digits, with spaces, dashes or dots between them.
const PHONE_RE = /(?:\+?\d[\d\s\-.]{6,}\d)/g;
const PRICE_RE = /(?:₪\s*\d[\d,.]*|\d[\d,.]*\s*(?:₪|ש["״]ח|שקל(?:ים)?|NIS|nis))/g;

const digitsOnly = (s: string) => s.replace(/\D/g, '');

/** What a translation must carry over unchanged: URLs, emails, phone numbers (compared by digits) and price numbers. */
export function protectedTokens(text: string): { urls: string[]; emails: string[]; phones: string[]; prices: string[] } {
  const urls = (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:)]+$/, ''));
  const emails = text.match(EMAIL_RE) ?? [];
  const noUrl = text.replace(URL_RE, ' ').replace(EMAIL_RE, ' ');
  const phones = (noUrl.match(PHONE_RE) ?? []).map(digitsOnly).filter((d) => d.length >= 7);
  const prices = (noUrl.match(PRICE_RE) ?? []).map((p) => digitsOnly(p)).filter(Boolean);
  return { urls, emails, phones, prices };
}

/** Every protected token of the source is in the translation (phones and prices by their digits). */
export function tokensPreserved(source: string, translated: string): boolean {
  const s = protectedTokens(source);
  const tDigits = digitsOnly(translated);
  for (const u of s.urls) if (!translated.includes(u)) return false;
  for (const e of s.emails) if (!translated.toLowerCase().includes(e.toLowerCase())) return false;
  for (const p of s.phones) if (!tDigits.includes(p)) return false;
  for (const p of s.prices) if (!tDigits.includes(p)) return false;
  return true;
}

export interface ValidationResult {
  /** Keys that passed. */
  value: Record<string, string>;
  missing: string[];
  extra: string[];
  invalid: Array<{ key: string; reason: 'not_string' | 'empty' | 'tokens' | 'too_long' }>;
}

/** Checks the model's answer has the same keys, strings only, and kept phones/URLs/emails/prices. */
export function validateTranslation(source: Record<string, string>, output: unknown): ValidationResult {
  const res: ValidationResult = { value: {}, missing: [], extra: [], invalid: [] };
  const obj = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : {};
  for (const key of Object.keys(obj)) if (!(key in source)) res.extra.push(key);
  for (const [key, src] of Object.entries(source)) {
    if (!(key in obj)) { res.missing.push(key); continue; }
    const v = obj[key];
    if (typeof v !== 'string') { res.invalid.push({ key, reason: 'not_string' }); continue; }
    const t = v.trim();
    if (!t) { res.invalid.push({ key, reason: 'empty' }); continue; }
    if (t.length > Math.max(400, src.length * 4)) { res.invalid.push({ key, reason: 'too_long' }); continue; }
    if (!tokensPreserved(src, t)) { res.invalid.push({ key, reason: 'tokens' }); continue; }
    res.value[key] = t;
  }
  return res;
}

// ─── Health tone in French and English ────────────────────────────────────────

// A short list, in the spirit of lintHealthCopy (healthCopy.ts): promises, "painless", sales words, superlatives.
const FOREIGN_HEALTH_RULES: Record<string, RegExp[]> = {
  fr: [
    /\bgaranti(?:e|es|s)?\b/i, /\bsans (?:aucune )?douleur\b/i, /\bindolore\b/i, /\ble meilleur\b|\bla meilleure\b|\bles meilleur(?:e)?s\b/i,
    /\bn[°º]\s?1\b|\bnuméro\s?(?:1|un)\b/i, /\bpromo(?:tion)?s?\b/i, /\bgratuit(?:e|es|s)?\b/i, /\bmiracle\b/i, /\brévolutionnaire\b/i,
    /\b100\s?%/, /\bparfait(?:e|es|s)?\b/i,
  ],
  en: [
    /\bguarantee(?:d|s)?\b/i, /\bpain[- ]?(?:free|less)\b/i, /\bno pain\b/i, /\bthe best\b/i, /\bnumber one\b|#\s?1\b|\bno\.?\s?1\b/i,
    /\bfree\b/i, /\bdiscount(?:s)?\b/i, /\bmiracle\b/i, /\brevolutionary\b/i, /\b100\s?%/, /\bperfect(?:ly)?\b/i,
  ],
};

export function lintForeignHealth(text: string, lang: string): string[] {
  const rules = FOREIGN_HEALTH_RULES[lang] ?? [];
  const found = rules.map((re) => text.match(re)?.[0]).filter((m): m is string => !!m);
  if (/!/.test(text)) found.push('!');
  return found;
}

/** Quiet the tone: "!" becomes ".", a sentence with a forbidden phrase is dropped (unless nothing would be left). */
export function softenForeignHealth(text: string, lang: string): string {
  let t = text.replace(/\s*!+/g, '.').replace(/\.\.+/g, '.');
  const rules = FOREIGN_HEALTH_RULES[lang] ?? [];
  const sentences = t.split(/(?<=[.?])\s+/);
  const kept = sentences.filter((s) => !rules.some((re) => re.test(s)));
  if (kept.length > 0 && kept.length < sentences.length) t = kept.join(' ');
  return t.trim();
}

// ─── The AI call ──────────────────────────────────────────────────────────────

export function buildTranslationSystem(lang: LangCode, opts: { health: boolean; businessName: string }): string {
  const L = LANGUAGES[lang];
  const lines = [
    `You translate the text of a small Israeli business's landing page from Hebrew into ${L.english}.`,
    'You receive a JSON object of key -> Hebrew text. Return ONLY a JSON object with EXACTLY the same keys, each value the translated text. No other keys, no comments, no markdown.',
    `Write natural, plain ${L.english} that a local customer would read on a business website; keep the meaning and length close to the Hebrew. Do not add claims, details or words that are not in the Hebrew.`,
    'Never change: phone numbers, URLs, email addresses, prices and other numbers, and street addresses (they stay in Hebrew, as on the street signs).',
    `The business name is "${opts.businessName}". Key "business_name" and wherever the name appears: if it is already written in Latin letters, keep it exactly. If it is in Hebrew, render it the way a professional business would present itself abroad: translate the descriptive words and transliterate the proper names with the standard spelling (e.g. "מרפאת שיניים ד״ר כהן" -> ${lang === 'fr' ? '"Cabinet dentaire Dr Cohen"' : '"Dr. Cohen Dental Clinic"'}; "סטודיו נועה" -> "Studio Noa"). Use the same rendering everywhere on the page.`,
    'People\'s names (key "team.N.name" and names inside texts): transliterate with the common standard spelling of the target language and translate titles (ד״ר -> ' + (lang === 'fr' ? '"Dr"' : '"Dr."') + '). Names of reviewers are never sent to you.',
    'Keys starting with "spoken_languages." are names of languages: write the name as used in the middle of a sentence (French: lowercase, e.g. "hébreu").',
    'Keys starting with "img_alt:" are short image descriptions for screen readers.',
    'Opening hours: translate day names and keep the hours exactly.',
    'Keep any text in square brackets as a placeholder, translated.',
  ];
  if (opts.health) {
    lines.push(
      'This is a medical / health clinic page. Be careful and precise: keep the calm, softened tone of the Hebrew.',
      'No promises of results, no "painless", no superlatives, no sales words, no exclamation marks. Use standard medical terms of the target language.',
    );
  }
  return lines.join('\n');
}

export type TranslateCall = (system: string, user: string) => Promise<string>;

function parseJsonObject(raw: string): unknown {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

export interface TranslateResult {
  value: Record<string, string>;
  /** Keys that could not be translated (they stay in Hebrew and show as "not updated"). */
  failed: string[];
  softened: string[];
}

/**
 * One call over all the keys; one retry for whatever came back missing or broken. What still fails is left
 * untranslated rather than guessed. A health page in fr/en gets the same tone check as in Hebrew.
 */
export async function translateFlat(
  source: Record<string, string>,
  lang: LangCode,
  opts: { health: boolean; businessName: string; call: TranslateCall },
): Promise<TranslateResult> {
  const system = buildTranslationSystem(lang, opts);
  const out: Record<string, string> = {};
  let pending = { ...source };
  for (let attempt = 0; attempt < 2 && Object.keys(pending).length > 0; attempt++) {
    let parsed: unknown = null;
    try {
      parsed = parseJsonObject(await opts.call(system, JSON.stringify(pending)));
    } catch (e) {
      console.warn('[LANG] translation call failed:', (e as Error)?.message ?? e);
    }
    const v = validateTranslation(pending, parsed);
    Object.assign(out, v.value);
    const retry: Record<string, string> = {};
    for (const k of [...v.missing, ...v.invalid.map((i) => i.key)]) retry[k] = pending[k];
    pending = retry;
  }
  const softened: string[] = [];
  if (opts.health) {
    for (const [k, v] of Object.entries(out)) {
      if (lintForeignHealth(v, lang).length) {
        const s = softenForeignHealth(v, lang);
        if (s && s !== v) { out[k] = s; softened.push(k); }
      }
    }
  }
  return { value: out, failed: Object.keys(pending), softened };
}

// ─── Addresses ────────────────────────────────────────────────────────────────

/** The address of a page in a language: the Hebrew address plus "/fr". */
export function langUrl(base: string, lang: string): string {
  if (lang === SOURCE_LANG) return base;
  return `${base.replace(/\/+$/, '')}/${lang}`;
}

/** hreflang alternates for the published languages (Hebrew always; x-default = Hebrew). */
export function buildHreflang(base: string, published: string[]): Array<{ hreflang: string; href: string }> {
  const langs = [SOURCE_LANG, ...TRANSLATION_LANGS.filter((l) => published.includes(l))];
  const out: Array<{ hreflang: string; href: string }> = langs.map((l) => ({ hreflang: l as string, href: langUrl(base, l) }));
  out.push({ hreflang: 'x-default', href: base });
  return out;
}
