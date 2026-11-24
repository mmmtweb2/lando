// Small text helpers shared by the published page and the server shell (README part 150).
// Pure, no imports. Copied byte for byte to client/src/lib/pageText.ts; scripts/test-input-validation.ts
// fails if the two differ.

const HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const LATIN = /[A-Za-z\u00C0-\u024F]/;

/**
 * The direction an owner-typed text (a business name, a customer name) should be shown in.
 * Any Hebrew letter makes it right-to-left, so "QA מאפיית בדיקה" reads in the order it was typed
 * instead of being flipped by the browser's first-strong-letter guess (which would pick LTR for "QA").
 * Only Latin letters: left-to-right. Neither (digits, symbols): 'auto'.
 */
export function textDir(text: string | null | undefined): 'rtl' | 'ltr' | 'auto' {
  const s = text ?? '';
  if (HEBREW.test(s)) return 'rtl';
  if (LATIN.test(s)) return 'ltr';
  return 'auto';
}

/**
 * The same text wrapped in Unicode isolates (RLI/LRI/FSI ... PDI), for strings that are not JSX:
 * "מוכנים להתחיל עם ${name}?" keeps its question mark in place whatever the name holds.
 */
export function isolate(text: string): string {
  if (!text) return text;
  const d = textDir(text);
  const open = d === 'rtl' ? '\u2067' : d === 'ltr' ? '\u2066' : '\u2068';
  return `${open}${text}\u2069`;
}

/** Text with every direction-control character removed (they must never reach a URL, a message or a file). */
export const stripBidi = (text: string): string => text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');

export type TitleLang = 'he' | 'en' | 'fr';

/** Words added after a bare business name, so the tab and Google read "<name> | <what this page is>". */
export const TITLE_FALLBACK_DESCRIPTOR: Readonly<Record<TitleLang, string>> = {
  he: 'דף העסק',
  en: 'Business page',
  fr: 'Page de l’entreprise',
};

const DEFAULT_NAME: Readonly<Record<TitleLang, string>> = { he: 'דף נחיתה', en: 'Landing page', fr: 'Page' };

export interface PageTitleInput {
  /** ai_content.seo_title (already in the page's language). */
  seoTitle?: string | null;
  businessName?: string | null;
  /** A short words-about-the-business line, e.g. ai_content.services_heading. Used only without seoTitle. */
  descriptor?: string | null;
  lang?: string | null;
  /** A paid white-label account: no "| Pagey" at the end. */
  whiteLabel?: boolean;
}

const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
};

/**
 * The browser-tab / Google title of a published page: seo_title, or "<business name> | <descriptor>",
 * then " | Pagey" unless white-label. Always ONE plain string (React 19 leaves <title> empty when it
 * gets several children, which is how published pages lost their title). A Hebrew title that starts
 * with a Latin word gets a leading RLM, so the tab shows it right-to-left.
 */
export function buildPageTitle(input: PageTitleInput): string {
  const lang: TitleLang = input.lang === 'en' || input.lang === 'fr' ? input.lang : 'he';
  const name = (input.businessName ?? '').replace(/\s+/g, ' ').trim();
  const seo = (input.seoTitle ?? '').replace(/\s+/g, ' ').trim();
  let base: string;
  if (seo) {
    base = clip(seo, 70);
  } else if (name) {
    const desc = (input.descriptor ?? '').replace(/\s+/g, ' ').trim();
    const usable = desc && desc.length <= 40 && !desc.includes(name) ? desc : TITLE_FALLBACK_DESCRIPTOR[lang];
    base = `${clip(name, 60)} | ${usable}`;
  } else {
    base = DEFAULT_NAME[lang];
  }
  const full = input.whiteLabel ? base : `${base} | Pagey`;
  const firstStrong = full.match(/[A-Za-z\u00C0-\u024F\u0590-\u05FF]/)?.[0] ?? '';
  return lang === 'he' && HEBREW.test(full) && LATIN.test(firstStrong) ? `\u200f${full}` : full;
}
