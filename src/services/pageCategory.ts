// Page categories (README part 141). One visual brand (the "Pinkas" design) with category-specific
// PARAMETERS: which sections appear and in what order, the call to action, the trust elements, the
// tone of the text, and the stock-photo search words. The category is chosen by the machine from
// the business description (and the Google category text when there is one) and never asked from
// the customer. When the detection is not confident the page is built from the GENERAL template,
// which is what every page was before.
//
// Pure module: no I/O. The client mirrors the render-side half in client/src/config/pageCategory.ts
// (ids, names, section order, hidden-by-default); scripts/test-page-category.ts compares the two.

export type CategoryId =
  | 'general' | 'health' | 'professional' | 'nonprofit' | 'arts_events' | 'food' | 'beauty' | 'trades';

export const CATEGORY_IDS: readonly CategoryId[] = [
  'general', 'health', 'professional', 'nonprofit', 'arts_events', 'food', 'beauty', 'trades',
];

/** Categories that have their own template today. The rest are recognised but render as GENERAL. */
export const IMPLEMENTED_CATEGORIES: readonly CategoryId[] = ['general', 'health'];

export type CategorySource = 'auto' | 'manual';

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === 'string' && (CATEGORY_IDS as readonly string[]).includes(v);
}

/** The category a stored value stands for: anything missing or unknown is GENERAL (null = general). */
export function normalizeCategory(v: unknown): CategoryId {
  return isCategoryId(v) ? v : 'general';
}

/** The template that actually renders: a recognised-but-not-built category falls back to GENERAL. */
export function templateFor(v: unknown): CategoryId {
  const id = normalizeCategory(v);
  return (IMPLEMENTED_CATEGORIES as readonly string[]).includes(id) ? id : 'general';
}

// ─── Section model (shared vocabulary with the renderer) ──────────────────────

/** Body sections of the V3 page, between the opening and the lead form / closing block. */
export type SectionKey =
  | 'about' | 'services' | 'team' | 'gallery' | 'process' | 'testimonials' | 'faq' | 'visit' | 'before_after';

export interface CategoryConfig {
  id: CategoryId;
  nameHe: string;
  /** false = detected but still rendered with the GENERAL template. */
  implemented: boolean;
  /** Body sections in order (after the opening, before the lead form and the closing block). */
  sectionOrder: SectionKey[];
  /** Sections that exist but start switched off (the owner can switch them on). */
  hiddenByDefault: SectionKey[];
  cta: {
    /** Primary call to action. 'whatsapp' = book/ask on WhatsApp. */
    primary: 'whatsapp' | 'phone' | 'any';
    /** A second, quieter button next to the primary one. */
    secondary: 'call' | null;
    labelWhatsapp: string;
    labelPhone: string;
  };
  /** What builds trust on this kind of page (the renderer shows the ones it has data for). */
  trustElements: string[];
  /** Tone rules, in English for the model. */
  toneRules: string[];
  /** Phrases the text must never contain (also enforced in code, see healthCopy.ts). */
  forbidden: string[];
  /** English search words for the free stock-photo source. */
  imageKeywords: string[];
}

const GENERAL_ORDER: SectionKey[] = ['about', 'services', 'gallery', 'process', 'testimonials', 'faq', 'visit'];

export const CATEGORY_CONFIG: Record<CategoryId, CategoryConfig> = {
  general: {
    id: 'general', nameHe: 'כללי', implemented: true,
    sectionOrder: GENERAL_ORDER, hiddenByDefault: [],
    cta: { primary: 'any', secondary: null, labelWhatsapp: '', labelPhone: '' },
    trustElements: [], toneRules: [], forbidden: [], imageKeywords: [],
  },
  health: {
    id: 'health', nameHe: 'בריאות ורפואה', implemented: true,
    // opening (fixed) → treatments → doctor & team → reviews → first visit → FAQ → practical guide → before/after (off)
    sectionOrder: ['services', 'team', 'gallery', 'testimonials', 'process', 'faq', 'visit', 'before_after'],
    hiddenByDefault: ['before_after'],
    cta: { primary: 'whatsapp', secondary: 'call', labelWhatsapp: 'לקביעת תור בוואטסאפ', labelPhone: 'לקביעת תור בטלפון' },
    trustElements: ['doctor_credentials', 'license_if_provided', 'spoken_languages', 'reviews', 'practical_guide'],
    toneRules: [
      'Calm, warm and encouraging. Plain Hebrew, plural second person ("אתם"). No jargon.',
      'NEVER promise results, outcomes, cures, or the absence of pain ("ללא כאב", "בלי כאב", "תוצאות מובטחות").',
      'NEVER use sales or urgency words: "הזדמנות", "מבצע", "הנחה", "חינם", "לזמן מוגבל".',
      'NEVER use superlatives or rankings: "הטוב ביותר", "הכי טוב", "מוביל", "מספר 1".',
      'NEVER state prices, or any number the owner did not give.',
      'NEVER describe before/after results.',
      'Do not state which health funds (קופות חולים) or insurers the clinic works with unless the owner said so.',
    ],
    forbidden: ['הזדמנות', 'מבצע', 'הטוב ביותר', 'ללא כאב', 'בלי כאב', 'לפני ואחרי', 'מובטח'],
    imageKeywords: ['medical clinic interior', 'doctor consultation', 'modern clinic reception'],
  },
  professional: stub('professional', 'שירותים מקצועיים'),
  nonprofit: stub('nonprofit', 'עמותות ומלכ"רים'),
  arts_events: stub('arts_events', 'אמנים ואירועים'),
  food: stub('food', 'אוכל ואירוח'),
  beauty: stub('beauty', 'יופי וטיפוח'),
  trades: stub('trades', 'בעלי מלאכה ושירותי בית'),
};

function stub(id: CategoryId, nameHe: string): CategoryConfig {
  return {
    id, nameHe, implemented: false,
    sectionOrder: GENERAL_ORDER, hiddenByDefault: [],
    cta: { primary: 'any', secondary: null, labelWhatsapp: '', labelPhone: '' },
    trustElements: [], toneRules: [], forbidden: [], imageKeywords: [],
  };
}

/** The config of the template that renders (a stub category resolves to GENERAL). */
export function configFor(v: unknown): CategoryConfig {
  return CATEGORY_CONFIG[templateFor(v)];
}

/** Sections a page of this category starts with switched off (merged into ai_content.hidden_sections). */
export function defaultHiddenSections(v: unknown): SectionKey[] {
  return [...configFor(v).hiddenByDefault];
}

// ─── Text normalisation and Hebrew-aware matching ─────────────────────────────

/** Lower-case, drop niqqud, unify the many quote marks (ד״ר = ד"ר = ד”ר), collapse "רופא/ת" to "רופא". */
export function normalizeText(s: string): string {
  return (s ?? '')
    .normalize('NFC')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[“”״″]/g, '"')
    .replace(/[‘’׳′]/g, "'")
    .replace(/\/(?:ת|ה|ית)(?![א-ת])/g, '')
    .replace(/\((?:ת|ה)\)/g, '')
    .toLowerCase();
}

/** Words: Hebrew runs (a quote inside a word stays: ד"ר, צה"ל) and Latin runs. Everything else separates. */
export function tokenize(s: string): string[] {
  return normalizeText(s).match(/[א-ת]+(?:["'][א-ת]+)*|[a-z]+/g) ?? [];
}

// Hebrew one-letter and two-letter prefixes that stick to a word: ו (and) ש (that) ה (the) ב (in) כ (like)
// ל (to) מ (from), and their usual combinations (ובה, שלה, כשה, מה, ...).
const PREFIX_RE = /^ו?(?:ש?[בלמכ]?ה?|[כמ]שה?)$/;
const isHebrew = (w: string) => /[א-ת]/.test(w);

/** Does the text word `t` stand for the keyword `kw`? (exact, Hebrew prefix, or an English `stem*`). */
export function wordMatches(t: string, kw: string): boolean {
  if (t === kw) return true;
  if (kw.endsWith('*')) return t.startsWith(kw.slice(0, -1));
  if (!isHebrew(kw) || kw.length < 3 || t.length <= kw.length || !t.endsWith(kw)) return false;
  return PREFIX_RE.test(t.slice(0, t.length - kw.length));
}

/** Does the phrase appear as consecutive words (each word may carry a Hebrew prefix)? */
export function containsPhrase(tokens: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || tokens.length < phrase.length) return false;
  for (let i = 0; i <= tokens.length - phrase.length; i++) {
    let ok = true;
    for (let k = 0; k < phrase.length; k++) if (!wordMatches(tokens[i + k], phrase[k])) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

// ─── Keyword data ─────────────────────────────────────────────────────────────
// [phrase, weight]: 3 = names the field outright, 2 = points to it, 1 = weak hint (capped, see below).

type KW = readonly [string, 1 | 2 | 3];

const HEALTH_KW: KW[] = [
  // dental
  ['מרפאת שיניים', 3], ['מרפאות שיניים', 3], ['רופא שיניים', 3], ['רופאת שיניים', 3], ['רופאי שיניים', 3],
  ['רפואת שיניים', 3], ['שיננית', 3], ['שיננים', 3], ['אורתודנט', 3], ['אורתודנטית', 3], ['אורתודונט', 3],
  ['אורתודונטית', 3], ['אורתודנטיה', 3], ['אורתודונטיה', 3], ['יישור שיניים', 3], ['ישור שיניים', 3],
  ['השתלות שיניים', 3], ['השתלת שיניים', 3], ['הלבנת שיניים', 3], ['טיפולי שורש', 3], ['טיפול שורש', 3],
  ['כירורג פה ולסת', 3], ['שיניים', 2], ['dentist*', 3], ['dental', 3], ['orthodont*', 3], ['endodont*', 3],
  // physio and para-medical
  ['פיזיותרפיה', 3], ['פיזיותרפיסט', 3], ['פיזיותרפיסטית', 3], ['פיזיותרפיסטים', 3], ['פיזיותרפיסטיות', 3],
  ['physiotherap*', 3], ['physical therapy', 3], ['physical therapist', 3], ['physio', 3],
  ['קלינאית תקשורת', 3], ['קלינאי תקשורת', 3], ['ריפוי בעיסוק', 3], ['מרפאה בעיסוק', 3], ['מרפא בעיסוק', 3],
  ['פסיכולוג', 3], ['פסיכולוגית', 3], ['פסיכותרפיה', 3], ['פסיכותרפיסט', 3], ['פסיכותרפיסטית', 3],
  ['כירופרקט', 3], ['כירופרקטית', 3], ['כירופרקטיקה', 3], ['אוסטאופת', 3], ['אוסטיאופת', 3],
  ['דיקור סיני', 3], ['רפואה סינית', 3], ['רפואה משלימה', 3], ['רפלקסולוגיה', 3], ['רפלקסולוג', 3],
  ['אופטומטריסט', 3], ['אופטומטריסטית', 3], ['אופטומטריה', 3], ['דיאטנית', 3], ['דיאטן', 3], ['תזונאית קלינית', 3],
  ['פודיאטר', 3], ['פודיאטרית', 3], ['פרא רפואי', 3], ['פרא רפואית', 3],
  // doctors and clinics
  ['רופא', 3], ['רופאה', 3], ['רופאים', 3], ['רופאות', 3], ['רופא ילדים', 3], ['רופא משפחה', 3], ['רופא עיניים', 3],
  ['גינקולוג', 3], ['גינקולוגית', 3], ['אורתופד', 3], ['אורתופדיה', 3], ['דרמטולוג', 3], ['דרמטולוגית', 3],
  ['קרדיולוג', 3], ['נוירולוג', 3], ['אורולוג', 3], ['מרפאה', 3], ['מרפאות', 3], ['קופת חולים', 3], ['קופות חולים', 3],
  ['clinic', 3], ['doctor', 3], ['physician', 3], ['medical', 2], ['health*', 2],
  ['קליניקה', 2], ['קליניקת', 2], ['רפואי', 2], ['רפואית', 2], ['מטופל', 2], ['מטופלים', 2], ['מטופלת', 2],
  ['בית מרקחת', 2], ['בריאות', 2], ['טיפולים רפואיים', 2], ['טיפול רפואי', 2],
  ['ד"ר', 1], ['דוקטור', 1], ['dr', 1], ['טיפול', 1], ['טיפולים', 1], ['בדיקה', 1], ['בדיקות', 1], ['כאב', 1], ['כאבים', 1],
  ['רפואה', 1],
];

// Words that mean "this is NOT a human clinic" even when a health word is present (a vet clinic).
const HEALTH_NEGATIVE: string[] = ['וטרינר', 'וטרינרית', 'וטרינריה', 'veterinar*', 'vet', 'בעלי חיים'];

const PROFESSIONAL_KW: KW[] = [
  ['עורך דין', 3], ['עורכת דין', 3], ['עורכי דין', 3], ['משרד עורכי דין', 3], ['עו"ד', 3], ['lawyer', 3], ['attorney', 3], ['law firm', 3],
  ['רואה חשבון', 3], ['רואת חשבון', 3], ['רו"ח', 3], ['יועץ מס', 3], ['יועצת מס', 3], ['ייעוץ מס', 3], ['accountant', 3],
  ['הנהלת חשבונות', 3], ['מנהל חשבונות', 3], ['מנהלת חשבונות', 3], ['יועץ משכנתאות', 3], ['משכנתאות', 3], ['נוטריון', 3], ['notary', 3],
  ['מתווך', 3], ['מתווכת', 3], ['תיווך', 3], ['נדל"ן', 3], ['real estate', 3], ['אדריכל', 3], ['אדריכלית', 3], ['architect*', 3],
  ['שמאי', 3], ['מהנדס', 2], ['מהנדסת', 2], ['יועץ עסקי', 3], ['ייעוץ עסקי', 3], ['יועץ ארגוני', 3], ['consult*', 2],
  ['סוכן ביטוח', 3], ['סוכנות ביטוח', 3], ['משרד', 1], ['ייעוץ', 1], ['יועץ', 1], ['יועצת', 1],
];

const NONPROFIT_KW: KW[] = [
  ['עמותה', 3], ['עמותת', 3], ['עמותות', 3], ['מלכ"ר', 3], ['ללא כוונת רווח', 3], ['ללא מטרות רווח', 3], ['לא למטרות רווח', 3],
  ['nonprofit', 3], ['non profit', 3], ['charity', 3], ['foundation', 2], ['תרומה', 2], ['תרומות', 2], ['לתרום', 2], ['donat*', 2],
  ['מתנדבים', 2], ['התנדבות', 2], ['volunteer*', 2], ['גיוס כספים', 3], ['קמפיין גיוס', 3], ['צדקה', 3], ['חסד', 2], ['נזקקים', 2],
  ['קרן', 1], ['מתנדב', 1],
];

const ARTS_EVENTS_KW: KW[] = [
  ['צלם', 3], ['צלמת', 3], ['צלמים', 3], ['צילום אירועים', 3], ['צילום', 2], ['photographer', 3], ['photography', 2],
  ['הפקת אירועים', 3], ['מפיק אירועים', 3], ['מפיקת אירועים', 3], ['מנחה אירועים', 3], ['אולם אירועים', 3], ['גן אירועים', 3],
  ['תקליטן', 3], ['דיג\'יי', 3], ['די ג\'יי', 3], ['dj', 3], ['להקה', 3], ['נגן', 2], ['זמר', 3], ['זמרת', 3], ['הופעות', 2],
  ['חתונה', 2], ['חתונות', 2], ['בר מצווה', 2], ['בת מצווה', 2], ['wedding*', 2], ['event*', 2], ['band', 2],
  ['אמן', 2], ['אמנית', 2], ['אמנות', 2], ['גרפיקאי', 3], ['גרפיקאית', 3], ['מאייר', 3], ['מאיירת', 3], ['תערוכה', 2], ['artist*', 2],
  ['קוסם', 3], ['סדנאות יצירה', 3],
];

const FOOD_KW: KW[] = [
  ['מסעדה', 3], ['מסעדת', 3], ['מסעדות', 3], ['restaurant', 3], ['בית קפה', 3], ['קפה', 2], ['cafe', 3], ['coffee', 2],
  ['מאפייה', 3], ['מאפיה', 3], ['קונדיטוריה', 3], ['bakery', 3], ['קייטרינג', 3], ['catering', 3], ['שף', 3], ['chef', 3],
  ['פיצריה', 3], ['המבורגר', 3], ['שווארמה', 3], ['פלאפל', 3], ['סושי', 3], ['פאב', 3], ['pub', 2], ['pizza', 3], ['burger', 3],
  ['מטבח', 2], ['אוכל', 2], ['food', 2], ['מסעדן', 3], ['צימר', 2], ['בוטיק הוטל', 3], ['מלון', 2], ['hotel', 2],
];

const BEAUTY_KW: KW[] = [
  ['מספרה', 3], ['מספרת', 3], ['מספרות', 3], ['ספר גברים', 3], ['barber*', 3], ['salon', 3], ['hair', 2], ['תספורת', 3], ['עיצוב שיער', 3],
  ['צבע שיער', 3], ['קוסמטיקאית', 3], ['קוסמטיקאי', 3], ['קוסמטיקה', 3], ['cosmetic*', 2], ['אסתטיקאית', 3], ['אסתטיקה', 3],
  ['מניקור', 3], ['פדיקור', 2], ['ציפורניים', 3], ['nails', 3], ['מאפרת', 3], ['איפור', 3], ['makeup', 3], ['ריסים', 3],
  ['lashes', 3], ['גבות', 3], ['brows', 3], ['הסרת שיער', 3], ['ספא', 3], ['spa', 3], ['עיסוי', 3], ['עיסויים', 3], ['massage', 3],
  ['מסאז', 3], ['טיפולי פנים', 3], ['סלון יופי', 3], ['beauty', 3], ['יופי', 2], ['טיפוח', 2],
];

const TRADES_KW: KW[] = [
  ['אינסטלטור', 3], ['אינסטלציה', 3], ['שרברב', 3], ['plumber', 3], ['plumbing', 3], ['חשמלאי', 3], ['electrician', 3],
  ['נגר', 3], ['נגרות', 3], ['שיפוצים', 3], ['שיפוצניק', 3], ['renovation*', 3], ['קבלן', 3], ['contractor', 3], ['handyman', 3],
  ['צבעי', 2], ['צביעה', 3], ['מזגנים', 3], ['טכנאי מזגנים', 3], ['hvac', 3], ['מנעולן', 3], ['מנעולנות', 3], ['locksmith', 3],
  ['הובלות', 3], ['מובילים', 2], ['moving', 2], ['גינון', 3], ['גנן', 3], ['ריצוף', 3], ['רצף', 3], ['איטום', 3], ['גבס', 3], ['גגות', 3],
  ['ניקיון', 3], ['נקיון', 3], ['חברת ניקיון', 3], ['מנקה', 2], ['הדברה', 3], ['מדביר', 3], ['טכנאי', 2], ['תיקון', 1], ['תיקונים', 1],
];

export const CATEGORY_KEYWORDS: Record<Exclude<CategoryId, 'general'>, readonly KW[]> = {
  health: HEALTH_KW, professional: PROFESSIONAL_KW, nonprofit: NONPROFIT_KW,
  arts_events: ARTS_EVENTS_KW, food: FOOD_KW, beauty: BEAUTY_KW, trades: TRADES_KW,
};

// Pre-split once: words of a keyword phrase (a trailing "*" marks an English stem such as "dentist*").
const words = (phrase: string): string[] => normalizeText(phrase).split(/\s+/).filter(Boolean);
const COMPILED = (Object.keys(CATEGORY_KEYWORDS) as Array<keyof typeof CATEGORY_KEYWORDS>).map((id) => ({
  id,
  kws: CATEGORY_KEYWORDS[id].map(([phrase, weight]) => ({ phrase, weight, words: words(phrase) })),
}));
const NEG_COMPILED = HEALTH_NEGATIVE.map(words);

// ─── Detection ────────────────────────────────────────────────────────────────

/** A category needs at least this much evidence, and at least one keyword of weight 2 or 3. */
export const DETECT_MIN_SCORE = 3;
/** ...and must beat the runner-up (another category) by at least this much. */
export const DETECT_MIN_MARGIN = 2;
/** Weak hints ("טיפול", "בדיקה") together count for at most this much. */
const WEAK_CAP = 2;
const SOURCE_WEIGHT = { google: 1.5, description: 1, name: 0.5 } as const;

export interface DetectInput {
  /** The free text the customer wrote about the business (what the wizard calls vibe, about, own text). */
  description?: string | null;
  /** The Google Business category text ("Dentist", "רופא שיניים"), when the business came from Google. */
  googleCategory?: string | null;
  /** Optional: the business name. Counts for less (a name can mislead) and is never decisive alone. */
  businessName?: string | null;
}

export interface Detection {
  id: CategoryId;
  /** 0..1 confidence in `id`. 0 when the page falls back to GENERAL because nothing was clear. */
  confidence: number;
  /** Per-category evidence, for logs and tests. */
  scores: Partial<Record<CategoryId, number>>;
}

interface Scored { id: Exclude<CategoryId, 'general'>; score: number; strong: boolean }

function scoreAll(sources: Array<{ tokens: string[]; mult: number }>): Scored[] {
  const out: Scored[] = [];
  for (const cat of COMPILED) {
    let strongSum = 0, weakSum = 0, strong = false;
    for (const k of cat.kws) {
      let best = 0;
      for (const s of sources) if (s.tokens.length && containsPhrase(s.tokens, k.words)) best = Math.max(best, s.mult);
      if (best === 0) continue;
      if (k.weight >= 2) { strongSum += k.weight * best; if (k.weight * best >= 2) strong = true; } else weakSum += k.weight * best;
    }
    let score = strongSum + Math.min(WEAK_CAP, weakSum);
    if (cat.id === 'health') {
      const vet = sources.some((s) => NEG_COMPILED.some((p) => containsPhrase(s.tokens, p)));
      if (vet) score -= 4;
    }
    out.push({ id: cat.id, score: Math.max(0, score), strong });
  }
  return out;
}

export function detectCategory(input: DetectInput): Detection {
  const sources = [
    { tokens: tokenize(input.googleCategory ?? ''), mult: SOURCE_WEIGHT.google },
    { tokens: tokenize(input.description ?? ''), mult: SOURCE_WEIGHT.description },
    { tokens: tokenize(input.businessName ?? ''), mult: SOURCE_WEIGHT.name },
  ];
  const scored = scoreAll(sources).sort((a, b) => b.score - a.score);
  const scores: Partial<Record<CategoryId, number>> = {};
  for (const s of scored) if (s.score > 0) scores[s.id] = Math.round(s.score * 100) / 100;

  const top = scored[0];
  const second = scored[1];
  const margin = top.score - (second?.score ?? 0);
  if (!top || top.score < DETECT_MIN_SCORE || !top.strong || margin < DETECT_MIN_MARGIN) {
    return { id: 'general', confidence: 0, scores };
  }
  return { id: top.id, confidence: Math.min(1, Math.round((top.score / 8) * 100) / 100), scores };
}

// ─── Health sub-type (used for images, labels and the neutral defaults) ───────

export type HealthSubtype = 'dental' | 'physio' | 'general';

export function healthSubtype(text: string): HealthSubtype {
  const t = tokenize(text);
  const has = (...ps: string[]) => ps.some((p) => containsPhrase(t, words(p)));
  if (has('שיניים', 'שיננית', 'אורתודנט', 'אורתודונט', 'אורתודנטיה', 'dentist', 'dental') || t.some((w) => w.startsWith('orthodont'))) return 'dental';
  if (has('פיזיותרפיה', 'פיזיותרפיסט', 'פיזיותרפיסטית', 'physio', 'physiotherapy', 'physiotherapist')) return 'physio';
  return 'general';
}

/** Stock-photo search words for a category (English; the free source indexes English). */
export function stockKeywordsFor(category: unknown, sourceText: string): string[] | null {
  if (templateFor(category) !== 'health') return null;
  switch (healthSubtype(sourceText)) {
    case 'dental': return ['dental clinic interior', 'dentist office', 'dental care'];
    case 'physio': return ['physiotherapy clinic', 'physical therapy session', 'rehabilitation clinic'];
    default: return [...CATEGORY_CONFIG.health.imageKeywords];
  }
}

// ─── City ─────────────────────────────────────────────────────────────────────

const CITIES = [
  'תל אביב', 'ירושלים', 'חיפה', 'ראשון לציון', 'פתח תקווה', 'אשדוד', 'נתניה', 'באר שבע', 'בני ברק', 'חולון', 'רמת גן',
  'אשקלון', 'רחובות', 'בת ים', 'בית שמש', 'כפר סבא', 'הרצליה', 'חדרה', 'מודיעין', 'לוד', 'רעננה', 'רמלה', 'נצרת', 'עכו',
  'רמת השרון', 'נהריה', 'קריית גת', 'קרית גת', 'גבעתיים', 'אילת', 'הוד השרון', 'עפולה', 'נס ציונה', 'יבנה', 'קריית אתא',
  'קרית אתא', 'קריית ביאליק', 'קרית ביאליק', 'קריית מוצקין', 'קרית מוצקין', 'קריית ים', 'קרית ים', 'קריית שמונה', 'קרית שמונה',
  'טבריה', 'צפת', 'כרמיאל', 'טירת כרמל', 'נשר', 'זכרון יעקב', 'זיכרון יעקב', 'פרדס חנה', 'קיסריה', 'אור יהודה', 'יהוד',
  'גבעת שמואל', 'קריית אונו', 'קרית אונו', 'אור עקיבא', 'דימונה', 'אופקים', 'נתיבות', 'שדרות', 'קריית מלאכי', 'גדרה',
  'ראש העין', 'שוהם', 'אלעד', 'מבשרת ציון', 'מעלה אדומים', 'בית שאן', 'עומר', 'להבים', 'מגדל העמק', 'יקנעם', 'נוף הגליל',
  'כפר יונה', 'קדימה צורן', 'גן יבנה', 'ערד', 'מצפה רמון', 'הרצליה', 'סביון', 'רמת אפעל',
];
const CITY_ALIAS: Record<string, string> = { 'קרית גת': 'קריית גת', 'קרית אתא': 'קריית אתא', 'קרית ביאליק': 'קריית ביאליק', 'קרית מוצקין': 'קריית מוצקין', 'קרית ים': 'קריית ים', 'קרית שמונה': 'קריית שמונה', 'קרית אונו': 'קריית אונו', 'זכרון יעקב': 'זיכרון יעקב' };
const CITIES_COMPILED = CITIES.map((c) => ({ name: CITY_ALIAS[c] ?? c, words: tokenize(c) }));

function lastCityIn(text: string): string | null {
  const tokens = tokenize(text);
  let best: { name: string; at: number; len: number } | null = null;
  for (const c of CITIES_COMPILED) {
    for (let i = 0; i <= tokens.length - c.words.length; i++) {
      if (c.words.every((w, k) => wordMatches(tokens[i + k], w))) {
        // later in the text wins (an address ends with the city); on a tie the longer name wins ("קריית גת" over "גת")
        if (!best || i > best.at || (i === best.at && c.words.length > best.len)) best = { name: c.name, at: i, len: c.words.length };
      }
    }
  }
  return best?.name ?? null;
}

/** The city a business is in: the address first (its last city name), else the description. null when unknown. */
export function extractCity(address: string | null | undefined, description: string | null | undefined): string | null {
  return lastCityIn(address ?? '') ?? lastCityIn(description ?? '');
}

// ─── Missing-column tolerance (migration 053 may not have run yet) ────────────

/** Is this database error "the category columns do not exist yet"? (Postgres 42703, PostgREST PGRST204/schema cache.) */
export function isMissingCategoryColumn(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  const msg = e.message ?? '';
  if (!/category(_source)?/.test(msg)) return false;
  return e.code === '42703' || e.code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(msg);
}

/** The category of a stored row: a missing column (older database) or a null value both mean GENERAL. */
export function categoryOfRow(row: { category?: unknown } | null | undefined): CategoryId {
  return normalizeCategory(row?.category);
}

/**
 * Runs a write that carries the category columns; when the database does not have them yet (migration 053
 * has not run) it runs the same write again without them, so a page is still created, as a general page.
 */
export async function withCategoryColumns<T extends { error: { code?: string; message?: string } | null }>(
  run: (extra: { category?: CategoryId; category_source?: CategorySource }) => PromiseLike<T>,
  category: CategoryId,
  source: CategorySource,
): Promise<T> {
  const first = await run({ category, category_source: source });
  if (first.error && isMissingCategoryColumn(first.error)) return run({});
  return first;
}
