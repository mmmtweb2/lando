// Page languages, client side (README part 142). Mirror of the parts of src/services/landingLanguages.ts the
// page needs (scripts/test-landing-languages.ts checks the two agree): the language list, the address of each
// language, applying a translation over the Hebrew content, and the first-visit redirect rule. Pure: no React.

export type LangCode = 'he' | 'fr' | 'en' | 'ru' | 'ar';

export interface LangConfig { code: LangCode; dir: 'rtl' | 'ltr'; heName: string; native: string; short: string; enabled: boolean }

export const SOURCE_LANG: LangCode = 'he';

export const LANGUAGES: Record<LangCode, LangConfig> = {
  he: { code: 'he', dir: 'rtl', heName: 'עברית', native: 'עברית', short: 'עב', enabled: true },
  fr: { code: 'fr', dir: 'ltr', heName: 'צרפתית', native: 'Français', short: 'FR', enabled: true },
  en: { code: 'en', dir: 'ltr', heName: 'אנגלית', native: 'English', short: 'EN', enabled: true },
  ru: { code: 'ru', dir: 'ltr', heName: 'רוסית', native: 'Русский', short: 'RU', enabled: false },
  ar: { code: 'ar', dir: 'rtl', heName: 'ערבית', native: 'العربية', short: 'AR', enabled: false },
};

export const TRANSLATION_LANGS: LangCode[] = (['fr', 'en', 'ru', 'ar'] as LangCode[]).filter((l) => LANGUAGES[l].enabled);

export function isTranslationLang(x: unknown): x is LangCode {
  return typeof x === 'string' && (TRANSLATION_LANGS as string[]).includes(x);
}

export function langDir(lang: string | null | undefined): 'rtl' | 'ltr' {
  return (LANGUAGES as Record<string, LangConfig>)[lang ?? '']?.dir ?? 'rtl';
}

export const ALT_PREFIX = 'img_alt:';

// ─── Addresses ────────────────────────────────────────────────────────────────

/**
 * Which page language an address asks for, and the Hebrew address it belongs to.
 *   /p/<slug>/fr -> fr, base /p/<slug>     /b/<sub>/en -> en, base /b/<sub>
 *   /fr (on the page's own subdomain) -> fr, base /
 * A child page's address (/b/<sub>/<child>/fr) is not a language address: child pages are Hebrew only.
 */
export function parseLangPath(pathname: string, onSubdomain = false): { lang: LangCode; base: string } {
  const segs = pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  if (isTranslationLang(last)) {
    if (onSubdomain && segs.length === 1) return { lang: last, base: '/' };
    if ((segs[0] === 'p' || segs[0] === 'b') && segs.length === 3) return { lang: last, base: `/${segs[0]}/${segs[1]}` };
  }
  return { lang: SOURCE_LANG, base: pathname.replace(/\/+$/, '') || '/' };
}

/** The address of a language from the Hebrew address. */
export function langPath(base: string, lang: string): string {
  if (lang === SOURCE_LANG) return base || '/';
  return `${(base || '/').replace(/\/+$/, '')}/${lang}`;
}

// ─── Applying a translation ───────────────────────────────────────────────────

/** A copy of the Hebrew content with every translated key written over an existing text (same rule as the server). */
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
    const holder = obj as Record<string | number, unknown>;
    const idx = Array.isArray(obj) ? Number(last) : last;
    if (typeof holder[idx] !== 'string') continue;
    holder[idx] = value;
  }
  return next as T;
}

/** The translated alt texts as a url -> alt map. */
export function translatedAlts(translated: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(translated ?? {})) if (k.startsWith(ALT_PREFIX) && typeof v === 'string') out[k.slice(ALT_PREFIX.length)] = v;
  return out;
}

/**
 * The editor writes paths like "services.2.title" (whichever list the page has). A translation key names the
 * list itself ("services_or_benefits.2.title"). The languages line is edited as one text: split by commas.
 */
export function editPathToKeys(path: string, value: string, content: { services_or_benefits?: unknown[]; services?: unknown[] }): Record<string, string> {
  if (path.startsWith('services.')) {
    const list = Array.isArray(content.services_or_benefits) ? 'services_or_benefits' : 'services';
    return { [`${list}.${path.slice('services.'.length)}`]: value };
  }
  if (path === 'spoken_languages') {
    const out: Record<string, string> = {};
    value.split(/[,،;]+|\s+(?:et|and)\s+/).map((x) => x.trim()).filter(Boolean).forEach((x, i) => { out[`spoken_languages.${i}`] = x; });
    return out;
  }
  return { [path]: value };
}

// ─── First visit: follow the browser's language ───────────────────────────────

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|lighthouse|headless|google|bing|yandex|baidu|duckduck|embedly|quora|pinterest|vkshare|w3c_validator|python-requests|curl|wget/i;

export function isBot(ua: string | null | undefined): boolean {
  return !ua || BOT_RE.test(ua);
}

export interface RedirectInput {
  /** The language the address already asks for. */
  urlLang: LangCode;
  /** navigator.languages, in order of preference. */
  navigatorLanguages: readonly string[];
  userAgent: string;
  /** Languages this page has published. */
  published: string[];
  /** The visitor's own earlier choice on this page (switch click), or null. */
  explicitChoice: string | null;
  /** True once this visitor was already sent to a language automatically. */
  alreadyRedirected: boolean;
  /** The page owner never gets redirected. */
  isOwner: boolean;
}

/**
 * On the bare Hebrew address only: a human whose browser prefers French or English, on a page that has that
 * language published, is sent there once. A choice the visitor made with the switch always wins. Never for
 * bots and crawlers, never when the address already names a language, never for the owner.
 */
export function decideRedirect(i: RedirectInput): LangCode | null {
  if (i.urlLang !== SOURCE_LANG || i.isOwner || isBot(i.userAgent)) return null;
  if (i.explicitChoice) {
    return isTranslationLang(i.explicitChoice) && i.published.includes(i.explicitChoice) ? i.explicitChoice : null;
  }
  if (i.alreadyRedirected) return null;
  for (const raw of i.navigatorLanguages) {
    const primary = String(raw).toLowerCase().split('-')[0];
    if (primary === 'he' || primary === 'iw') return null;
    if (isTranslationLang(primary) && i.published.includes(primary)) return primary;
  }
  return null;
}

const choiceKey = (slug: string) => `pagey_lang_choice:${slug}`;
const autoKey = (slug: string) => `pagey_lang_auto:${slug}`;

export function readLangChoice(slug: string): { choice: string | null; auto: boolean } {
  try {
    return { choice: window.localStorage.getItem(choiceKey(slug)), auto: !!window.localStorage.getItem(autoKey(slug)) };
  } catch {
    return { choice: null, auto: false };
  }
}

export function rememberLangChoice(slug: string, lang: string): void {
  try { window.localStorage.setItem(choiceKey(slug), lang); } catch { /* storage blocked: the choice simply is not remembered */ }
}

export function rememberAutoRedirect(slug: string, lang: string): void {
  try { window.localStorage.setItem(autoKey(slug), lang); } catch { /* storage blocked */ }
}
