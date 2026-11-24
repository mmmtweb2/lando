// Page categories, the render-side half (README part 141). The server owns detection and the text
// (src/services/pageCategory.ts, src/services/healthCopy.ts); this file holds what the page needs to
// DRAW itself: the category list, which sections appear in which order, which start switched off, the
// fixed Hebrew headings of the health template, and the languages line. scripts/test-page-category.ts
// compares it with the server copy, so the two cannot drift apart silently.

export type CategoryId =
  | 'general' | 'health' | 'professional' | 'nonprofit' | 'arts_events' | 'food' | 'beauty' | 'trades';

export const CATEGORY_IDS: readonly CategoryId[] = [
  'general', 'health', 'professional', 'nonprofit', 'arts_events', 'food', 'beauty', 'trades',
];

export const CATEGORY_NAMES: Record<CategoryId, string> = {
  general: 'כללי',
  health: 'בריאות ורפואה',
  professional: 'שירותים מקצועיים',
  nonprofit: 'עמותות ומלכ"רים',
  arts_events: 'אמנים ואירועים',
  food: 'אוכל ואירוח',
  beauty: 'יופי וטיפוח',
  trades: 'בעלי מלאכה ושירותי בית',
};

/** Categories with a template of their own. The rest are recognised but drawn with the general template. */
export const IMPLEMENTED_CATEGORIES: readonly CategoryId[] = ['general', 'health'];

export type SectionKey =
  | 'about' | 'services' | 'team' | 'gallery' | 'process' | 'testimonials' | 'faq' | 'visit' | 'before_after';

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === 'string' && (CATEGORY_IDS as readonly string[]).includes(v);
}

/** Anything missing or unknown (a page created before categories existed) is the general category. */
export function normalizeCategory(v: unknown): CategoryId {
  return isCategoryId(v) ? v : 'general';
}

/** The template that is drawn. */
export function templateFor(v: unknown): CategoryId {
  const id = normalizeCategory(v);
  return IMPLEMENTED_CATEGORIES.includes(id) ? id : 'general';
}

const GENERAL_ORDER: SectionKey[] = ['about', 'services', 'gallery', 'process', 'testimonials', 'faq', 'visit'];

/** Body sections in order, after the opening and before the lead form and the closing block. */
export const SECTION_ORDER: Record<CategoryId, SectionKey[]> = {
  general: GENERAL_ORDER,
  // treatments, doctor and team, photos of the clinic, reviews, first visit, FAQ, practical guide, before/after (off by default)
  health: ['services', 'team', 'gallery', 'testimonials', 'process', 'faq', 'visit', 'before_after'],
  professional: GENERAL_ORDER, nonprofit: GENERAL_ORDER, arts_events: GENERAL_ORDER, food: GENERAL_ORDER, beauty: GENERAL_ORDER, trades: GENERAL_ORDER,
};

/** Sections that exist but start switched off; the owner can switch them on. */
export const HIDDEN_BY_DEFAULT: Record<CategoryId, SectionKey[]> = {
  general: [], health: ['before_after'], professional: [], nonprofit: [], arts_events: [], food: [], beauty: [], trades: [],
};

export const sectionOrderFor = (v: unknown): SectionKey[] => SECTION_ORDER[templateFor(v)];
export const hiddenByDefaultFor = (v: unknown): SectionKey[] => HIDDEN_BY_DEFAULT[templateFor(v)];

/** The ids a section is recorded under in ai_content.hidden_sections (older pages use the composition ids). */
export const SECTION_IDS: Record<SectionKey, string[]> = {
  about: ['about'],
  services: ['services_bento', 'services_grid'],
  team: ['team'],
  gallery: ['gallery'],
  process: ['process_timeline', 'process_horizontal'],
  testimonials: ['testimonials_grid'],
  faq: ['faq_accordion'],
  visit: ['visit'],
  before_after: ['before_after'],
};

// ─── Health template: fixed headings and the languages line ───────────────────

export const HEALTH_HEADINGS = {
  services: 'הטיפולים שלנו',
  team: 'הרופא והצוות',
  teamNoPeople: 'על המרפאה',
  testimonials: 'מה אומרים המטופלים',
  process: 'הביקור הראשון',
  faq: 'שאלות לפני שמגיעים',
  visit: 'מידע מעשי',
  beforeAfter: 'לפני ואחרי',
} as const;

/** A person in the clinic's doctor-and-team section. Only what the owner provided. */
export interface TeamMember {
  name: string;
  role: string;
  credentials: string;
  experience: string;
  /** shown only when the owner provided one */
  license_number?: string;
  photo_url?: string;
}

export const SPOKEN_LANGUAGES_DEFAULT = ['עברית'];
export const MAX_SPOKEN_LANGUAGES = 8;
export const MAX_TEAM = 4;

/** "עברית" / "עברית ואנגלית" / "עברית, צרפתית ואנגלית" */
export function formatLanguages(list: string[]): string {
  const l = list.map((x) => x.trim()).filter(Boolean);
  if (l.length === 0) return '';
  if (l.length === 1) return l[0];
  return `${l.slice(0, -1).join(', ')} ו${l[l.length - 1]}`;
}

export function languagesLine(list: string[]): string {
  const s = formatLanguages(list);
  return s ? `מדברים ${s}` : '';
}

const KNOWN_LANGUAGES = new Set([
  'עברית', 'ערבית', 'אנגלית', 'רוסית', 'צרפתית', 'ספרדית', 'גרמנית', 'איטלקית', 'אמהרית', 'פורטוגזית', 'רומנית', 'טורקית',
  'פרסית', 'יידיש', 'הולנדית', 'יוונית', 'הונגרית', 'פולנית', 'אוקראינית', 'גאורגית', 'הינדית', 'סינית', 'יפנית', 'וייטנאמית', 'ארמנית',
]);

/** What the owner types ("עברית, צרפתית ואנגלית", "מדברים עברית ואנגלית") -> a clean list. */
export function parseLanguages(input: string): string[] {
  const parts = (input ?? '')
    .replace(/^\s*מדברים\s+/, '')
    .split(/[,،;\n]+/)
    .flatMap((piece) => piece.trim().split(/\s+ו(?=[\u05D0-\u05EA]{3,})/))
    .map((x) => x.trim())
    .map((x) => (!KNOWN_LANGUAGES.has(x) && x.startsWith('ו') && KNOWN_LANGUAGES.has(x.slice(1)) ? x.slice(1) : x))
    .filter(Boolean)
    .map((x) => x.slice(0, 30));
  return [...new Set(parts)].slice(0, MAX_SPOKEN_LANGUAGES);
}

/** Text shown (in edit mode only) where the owner has not filled a field in yet. */
export const FIELD_HINTS = {
  name: 'הוסיפו כאן את שם הרופא או הרופאה',
  role: 'הוסיפו כאן תפקיד',
  credentials: 'הוסיפו כאן הכשרה והסמכות',
  experience: 'הוסיפו כאן ניסיון',
  license: 'הוסיפו כאן מספר רישיון (לא חובה)',
  parking: 'הוסיפו כאן פרטי חניה',
  accessibility: 'הוסיפו כאן פרטי נגישות',
  languages: 'הוסיפו כאן את השפות שמדברים',
} as const;
