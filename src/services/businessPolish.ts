// "שיפור הניסוח" (README part 144): the owner presses one button next to the business description or the
// list of services and gets ONE strong suggestion, shown as before/after, that they can edit, accept or
// drop. Nothing is saved or sent to Google until they accept; accepting goes through the normal save
// path (PUT /gbp/profile/:field).
//
// This module is pure (no I/O): the checks that make a text fit for a Google Business Profile, the
// grounding block the writer may rely on, the prompts, the repair of the model's JSON, the clean-up of
// the services list, and the per-account daily counter. The model call lives in businessPolish.service.ts.
//
// The professional rules are enforced HERE, not only in the prompt: every suggestion passes
// checkDescription / checkServices; what can be fixed is fixed (sentences dropped, health tone softened),
// and what cannot is retried once and otherwise not offered.
import { createHash } from 'crypto';
import { type TruthCard, hoursText, line, MAX_DESCRIPTION, MAX_SERVICES } from './businessTruth';
import { BARE_DOMAIN } from './gbpPosts';
import { lintHealthCopy, softenHealthCopy, splitSentences } from './healthCopy';
import { type CategoryId, CATEGORY_CONFIG, detectCategory, normalizeText, tokenize, wordMatches } from './pageCategory';

export type PolishField = 'description' | 'services';
export const POLISH_FIELDS: readonly PolishField[] = ['description', 'services'];
export const isPolishField = (v: unknown): v is PolishField => v === 'description' || v === 'services';

// ─── Limits (Google Business Profile) ─────────────────────────────────────────

/** Google cuts the description at 750 characters. */
export const DESC_MAX = MAX_DESCRIPTION;
/** What a good description aims for: long enough to say something, short enough to be read. */
export const DESC_AIM_MIN = 250;
export const DESC_AIM_MAX = 600;
/** Under this the owner sees "התיאור קצר מדי". */
export const DESC_SHORT = 150;
/** Google shows about this much before "more": the essence must be inside it. */
export const DESC_FOLD = 250;
/** A service's one-line description. */
export const SERVICE_DESC_MAX = 120;
export const SERVICE_NAME_MAX_WORDS = 5;
export const SERVICE_NAME_MAX_CHARS = 40;
export const MAX_FORGOTTEN = 3;

// ─── Issues ───────────────────────────────────────────────────────────────────

export type IssueCode =
  | 'empty' | 'too_long' | 'too_short' | 'url' | 'email' | 'phone' | 'promo' | 'price' | 'caps' | 'loud'
  | 'stuffing' | 'no_area' | 'no_service' | 'essence_late' | 'invented' | 'health_tone'
  | 'too_many' | 'name_short' | 'name_long' | 'desc_long' | 'dup';

export interface Issue {
  code: IssueCode;
  /** error: cannot go to Google as is (or is not grounded). warn: a quality hint only. */
  level: 'error' | 'warn';
  /** One short sentence for the owner, plural second person. */
  text: string;
  /** What matched, as written (for logs and tests; never logged with the text around it). */
  match?: string;
  /** services: the row the issue is about */
  index?: number;
}

const ISSUE_HE: Record<IssueCode, string> = {
  empty: 'התיאור ריק.',
  too_long: 'התיאור ארוך מ-750 תווים, וגוגל תחתוך אותו.',
  too_short: 'התיאור קצר מדי. כמה משפטים על מה שאתם עושים ואיפה יעזרו ללקוחות לבחור בכם.',
  url: 'גוגל לא מקבלת קישורים בתיאור.',
  email: 'גוגל לא מקבלת כתובת מייל בתיאור.',
  phone: 'גוגל לא מקבלת מספר טלפון בתיאור. הטלפון כבר מופיע בכרטיס.',
  promo: 'מבצעים והנחות לא מתאימים לתיאור. אפשר לפרסם אותם בפוסט.',
  price: 'מחירים לא מתאימים לתיאור. אפשר לפרסם אותם בפוסט.',
  caps: 'מילים באותיות גדולות נראות כמו צעקה.',
  loud: 'יותר מדי סימני קריאה.',
  stuffing: 'אותה מילה חוזרת הרבה פעמים. גוגל לא אוהבת את זה.',
  no_area: 'חסר האזור: כתבו באיזו עיר או באיזה אזור אתם עובדים.',
  no_service: 'לא מוזכר אף אחד מהשירותים שלכם.',
  essence_late: 'בתחילת התיאור כדאי לכתוב מה אתם עושים ואיפה. רק השורות הראשונות מוצגות לפני "עוד".',
  invented: 'יש כאן פרט שלא מופיע בפרטי העסק.',
  health_tone: 'בתחום הבריאות לא כותבים הבטחות, מבצעים או "הכי טוב".',
  too_many: 'אפשר עד 20 שירותים.',
  name_short: 'שם שירות קצר מדי.',
  name_long: 'שם שירות ארוך. 2 עד 5 מילים קל יותר לקרוא.',
  desc_long: 'תיאור השירות ארוך מ-120 תווים.',
  dup: 'שני שירותים כמעט זהים.',
};
const issue = (code: IssueCode, level: Issue['level'], extra: Partial<Issue> = {}): Issue => ({ code, level, text: ISSUE_HE[code], ...extra });

export const hasErrors = (list: Issue[]): boolean => list.some((i) => i.level === 'error');

// ─── What the card knows ──────────────────────────────────────────────────────

/** The places the business works in: the city, the areas the posts use, and the service area on Google. */
export function cardAreas(c: TruthCard): string[] {
  const all = [c.city, ...(c.areas ?? []), ...(c.serviceArea?.places ?? []).map((p) => p.name)].map((x) => line(x, 60)).filter((x) => x.length >= 2);
  const seen = new Set<string>();
  return all.filter((x) => { const k = normalizeText(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The card's category, as the landing pages detect it (health gets the calm tone). */
export function cardCategory(c: TruthCard): CategoryId {
  return detectCategory({
    googleCategory: [c.category, ...(c.categories ?? [])].join(' '),
    description: [c.description, c.services.map((s) => s.name).join(' '), c.notes].join(' '),
    businessName: c.name,
  }).id;
}

/**
 * Everything the owner told us, as one text: the whitelist for claims. A number, a year, a certificate or
 * a guarantee in a suggestion must appear here, or the sentence goes. `draft` is what the owner has
 * typed now (their own words count as facts too).
 */
export function sourceText(c: TruthCard, draft = '', attributeLabels: string[] = []): string {
  return [
    c.name, c.category, ...(c.categories ?? []), c.city, ...cardAreas(c),
    ...c.services.map((s) => `${s.name} ${s.description}`),
    ...attributeLabels, c.hours.length ? hoursText(c.hours) : '',
    c.description, c.notes, draft,
  ].filter(Boolean).join('\n');
}

/**
 * The facts block the writer gets, and nothing else. Only what is in the card: name, category, place,
 * services, yes/no attributes that are on, hours, the current description and the owner's notes. The phone,
 * the website and the street address are left out on purpose: they must not end up in the description.
 */
export function buildGrounding(c: TruthCard, opts: { draft?: string; attributeLabels?: string[] } = {}): string {
  const areas = cardAreas(c);
  return [
    c.name && `שם העסק: ${c.name}`,
    c.category && `תחום: ${[c.category, ...(c.categories ?? [])].join(', ')}`,
    c.city && `עיר: ${c.city}`,
    areas.length && `אזורי שירות: ${areas.join(', ')}`,
    c.services.length && `שירותים: ${c.services.map((s) => (s.description ? `${s.name} (${s.description})` : s.name)).join('; ')}`,
    opts.attributeLabels?.length && `מאפיינים: ${opts.attributeLabels.join(', ')}`,
    c.hours.length && `שעות פעילות: ${hoursText(c.hours)}`,
    c.description && `התיאור שמופיע היום: ${c.description}`,
    opts.draft && opts.draft.trim() !== c.description.trim() && `מה שבעל העסק כתב עכשיו: ${opts.draft.trim()}`,
    c.notes && `מה מיוחד בעסק (מפי בעל העסק): ${c.notes}`,
  ].filter(Boolean).join('\n');
}

// ─── Detectors ────────────────────────────────────────────────────────────────

const HB = 'א-ת';
const lead = `(?<![${HB}])[ובלמכשה]{0,2}`;
const tail = `(?![${HB}])`;
const W = (alts: string, flags = 'g') => new RegExp(`${lead}(?:${alts})${tail}`, flags);

const URL_RE = /https?:\/\/|www\./i;
const EMAIL_RE = /\S+@\S+\.\S+/;
/** The same test the save path uses (gbpSync.PHONE_IN_TEXT), plus the *1234 short numbers. */
const PHONE_RE = /(?:\+?\d[\d\s()-]{7,}\d)|(?:\*\d{3,5}(?!\d))/;

const PROMO_RES: RegExp[] = [
  W('הנחה|הנחות|חינם|בחינם|מתנה|קופון|קופונים|לזמן מוגבל|רק היום|רק החודש|מחיר מיוחד|מחירים מיוחדים|במחיר מיוחד|הזדמנות|אל תחמיצו|אל תפספסו|חבל לפספס|מהרו|ללא עלות|בלי עלות|ללא תשלום|השתלם|משתלם|משתלמים|זול|זולים|הכי זול|מחירים זולים|מחירי רצפה'),
  // "מבצע" is also a verb ("מבצעים התקנות"): only the sales noun
  new RegExp(`(?<![${HB}])[בה]מבצע(?:ים)?${tail}`, 'g'),
  new RegExp(`(?<![${HB}])מבצע(?:ים)?\\s+(?:מיוחד|מיוחדים|חם|חמים|השקה|לזמן|אביב|חורף|קיץ|פתיחה|בלעדי|סוף|חג|עד|על)${tail}`, 'g'),
  new RegExp(`(?<![${HB}])מבצע(?:ים)?\\s*[!:]`, 'g'),
  /\d+\s*%/g,
  /\b(?:sale|discount|free|promo)\b/gi,
];
const PRICE_RES: RegExp[] = [
  /\d[\d,.]*\s*(?:₪|ש["״]ח|שח|שקל(?:ים)?|nis)(?![a-z])/gi,
  /(?:₪|ש["״]ח)\s*\d[\d,.]*/g,
  new RegExp(`${lead}החל\\s+מ-?\\s*\\d[\\d,.]*`, 'g'),
  new RegExp(`${lead}מחיר(?:ים)?\\s+(?:של\\s+|הוא\\s+|החל\\s+מ-?\\s*)?\\d[\\d,.]*`, 'g'),
  /\$\s*\d[\d,.]*|\d[\d,.]*\s*\$/g,
];

/** A claim that must come from the owner. `stem` is looked for in the owner's own words (normalized). */
interface Claim { re: RegExp; stems: string[] }
const CLAIMS: Claim[] = [
  // years, experience, "since", generations
  { re: W('שנות ניסיון|שנים של ניסיון|ניסיון של|ניסיון רב|שנים רבות|ותק|ותיק|ותיקה|ותיקים|משנת|מאז שנת|דור שני|דור שלישי|מסורת משפחתית|עשרות שנים|עשורים'), stems: ['ניסיון', 'שנים', 'ותק', 'ותיק', 'משנת', 'מאז', 'דור', 'מסורת', 'עשור', 'עשרות'] },
  // amounts in words
  { re: W('עשרות|מאות|אלפי|אלפים|רבבות|עשרות אלפי|מאות אלפי'), stems: ['עשרות', 'מאות', 'אלפי', 'אלפים', 'רבבות'] },
  // certificates, licences, degrees, experts
  { re: W('מוסמך|מוסמכת|מוסמכים|מוסמכות|הסמכה|הסמכות|מורשה|מורשית|מורשים|רישיון|רשיון|רישוי|תעודה|תעודת|תעודות|דיפלומה|תואר|בוגר|בוגרת|בוגרי|מומחה|מומחית|מומחים|מומחיות|ד"ר|דוקטור|פרופסור|מהנדס|מהנדסת'), stems: ['מוסמ', 'הסמכ', 'מורש', 'רישי', 'רשיו', 'רישו', 'תעוד', 'דיפלומ', 'תואר', 'בוגר', 'מומח', 'ד"ר', 'דוקטור', 'פרופסור', 'מהנדס'] },
  // awards, rankings
  { re: W('פרס|פרסים|זוכה|זוכת|זכה|זכתה|זכייה|מדורג|מדורגת|דירוג|נבחר|נבחרה|מומלץ על ידי|מוכר על ידי|מוכרת על ידי|מאושר על ידי|מאושרת על ידי'), stems: ['פרס', 'זוכ', 'זכה', 'זכת', 'זכי', 'מדורג', 'דירוג', 'נבחר', 'מומלץ', 'מוכר', 'מאושר'] },
  // guarantees and promises
  { re: W('אחריות|באחריות|מבטיח|מבטיחה|מבטיחים|הבטחה|מובטח|מובטחת|מובטחים|ערבות|החזר כספי|שביעות רצון מלאה|מתחייב|מתחייבת|מתחייבים|התחייבות'), stems: ['אחריות', 'מבטיח', 'הבטח', 'מובטח', 'ערבות', 'החזר', 'שביעות רצון', 'מתחייב', 'התחייב'] },
  { re: /100\s*%|מאה אחוז/g, stems: ['100', 'מאה אחוז'] },
  // superlatives and rankings: a claim nobody can back
  { re: W('הטוב ביותר|הטובה ביותר|הטובים ביותר|הכי טוב|הכי טובה|הכי טובים|המוביל|המובילה|המובילים|מוביל|מובילה|מובילים|מספר 1|מספר אחת|היחיד|היחידה|היחידים|ללא תחרות|אין כמונו|ללא מתחרים|מהמובילים|מהטובים'), stems: ['ביותר', 'הכי', 'מוביל', 'מספר 1', 'יחיד', 'תחרות', 'כמונו', 'מתחרים'] },
  // availability promises
  { re: W('24/7|סביב השעון|בכל שעה|זמינות מלאה|זמינים תמיד|תמיד זמינים|מענה מיידי|הגעה מיידית|תוך שעה|באותו יום|בו ביום'), stems: ['24', 'סביב השעון', 'בכל שעה', 'זמינ', 'מייד', 'תוך שעה', 'באותו יום', 'בו ביום'] },
];

const digitsOf = (s: string): string[] => (s.match(/\d[\d,.]*/g) ?? []).map((d) => d.replace(/[,.]+$/, '').replace(/,/g, ''));

/**
 * Claims in `text` the owner never made: numbers that are not in their words, years of experience,
 * certificates, awards, guarantees, superlatives, "24/7". Returns what matched.
 */
export function ungroundedClaims(text: string, source: string): string[] {
  const src = normalizeText(source);
  const srcNums = new Set(digitsOf(src));
  const out: string[] = [];
  for (const n of digitsOf(text)) if (!srcNums.has(n)) out.push(n);
  const norm = normalizeText(text);
  for (const c of CLAIMS) {
    c.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = c.re.exec(norm))) {
      if (m[0] === '') { c.re.lastIndex++; continue; }
      const hit = m[0].trim();
      // grounded when the owner used the same idea (its stem) themselves
      const stems = c.stems.filter((s) => hit.includes(s) || normalizeText(hit).includes(s));
      const grounded = (stems.length ? stems : c.stems).some((s) => src.includes(s));
      if (!grounded) out.push(hit);
    }
  }
  return [...new Set(out)];
}

function findAll(res: RegExp[], text: string): string[] {
  const out: string[] = [];
  for (const re of res) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { if (m[0] === '') { re.lastIndex++; continue; } out.push(m[0].trim()); if (!re.global) break; }
  }
  return out;
}

const STOP = new Set(['של', 'את', 'עם', 'על', 'גם', 'כל', 'או', 'אנחנו', 'אתם', 'לכם', 'שלנו', 'שלכם', 'אשר', 'הוא', 'היא', 'הם', 'זה', 'זו', 'בין', 'כמו', 'יותר', 'אצלנו', 'לנו', 'אנו', 'וגם', 'רק', 'לא', 'כן', 'מה', 'אם', 'כי', 'עד', 'אל', 'and', 'the', 'for', 'with']);

/** The same word over and over (keyword stuffing): a token 5+ times, or one place name 4+ times. */
function stuffing(text: string, areas: string[]): string | null {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) {
    if (t.length < 3 || STOP.has(t)) continue;
    const k = t.replace(/^[ובלמכשה]{1,2}(?=[א-ת]{3,})/, '');
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of counts) if (n >= 5) return k;
  const norm = normalizeText(text);
  for (const a of areas) {
    const na = normalizeText(a);
    if (na.length >= 2 && norm.split(na).length - 1 >= 4) return a;
  }
  return null;
}

/** Does the text name the place (any of the card's areas, with or without a Hebrew prefix)? */
export function mentionsArea(text: string, areas: string[]): boolean {
  const norm = normalizeText(text);
  return areas.some((a) => { const na = normalizeText(a).trim(); return na.length >= 2 && norm.includes(na); });
}

const serviceWords = (name: string): string[] => tokenize(name).filter((t) => t.length >= 3 && !STOP.has(t));

/** Does the text name one of the services (one of its main words is enough: "סתימות" for "פתיחת סתימות")? */
export function mentionsService(text: string, c: TruthCard): boolean {
  const toks = tokenize(text);
  const cat = serviceWords(c.category);
  return c.services.some((s) => serviceWords(s.name).some((w) => w.length >= 4 && toks.some((t) => wordMatches(t, w))))
    || cat.some((w) => w.length >= 3 && toks.some((t) => wordMatches(t, w)));
}

/** Latin words in capitals (4+ letters): shouting. Short acronyms (LED, BMW) are fine. */
const CAPS_RE = /\b[A-Z]{4,}\b/g;

export interface CheckOptions {
  /** The category's tone (health: the calm lint). Detected from the card when not given. */
  category?: CategoryId;
  /** The owner's own words for this check (their draft): grounding for claims. */
  draft?: string;
  attributeLabels?: string[];
}

/**
 * Is this description fit for the Google listing? Errors = Google would refuse it, or it states what the
 * owner never said. Warnings = quality hints ("התיאור קצר מדי", "חסר האזור"). Pure.
 */
export function checkDescription(text: string, card: TruthCard, opts: CheckOptions = {}): Issue[] {
  const t = (text ?? '').trim();
  if (!t) return [issue('empty', 'error')];
  const out: Issue[] = [];
  const category = opts.category ?? cardCategory(card);
  const source = sourceText(card, opts.draft ?? '', opts.attributeLabels ?? []);
  const areas = cardAreas(card);

  if (t.length > DESC_MAX) out.push(issue('too_long', 'error'));
  if (URL_RE.test(t) || BARE_DOMAIN.test(t)) out.push(issue('url', 'error'));
  if (EMAIL_RE.test(t)) out.push(issue('email', 'error'));
  if (PHONE_RE.test(t)) out.push(issue('phone', 'error'));
  for (const m of findAll(PRICE_RES, t)) out.push(issue('price', 'error', { match: m }));
  for (const m of findAll(PROMO_RES, normalizeText(t))) out.push(issue('promo', 'error', { match: m }));
  for (const m of ungroundedClaims(t, source)) {
    if (out.some((i) => (i.code === 'price' || i.code === 'promo') && i.match?.includes(m))) continue;
    out.push(issue('invented', 'error', { match: m }));
  }
  if (category === 'health') {
    for (const v of lintHealthCopy(t, { sourceText: source })) {
      if (v.rule === 'loud') continue;   // counted below as a warning
      if (out.some((i) => i.match && (i.match.includes(v.match) || v.match.includes(i.match)))) continue;
      out.push(issue('health_tone', 'error', { match: v.match }));
    }
  }
  const caps = t.match(CAPS_RE);
  if (caps) out.push(issue('caps', 'warn', { match: caps[0] }));
  if ((t.match(/!/g) ?? []).length > 1 || /!{2,}/.test(t) || (category === 'health' && t.includes('!'))) out.push(issue('loud', 'warn'));
  const stuffed = stuffing(t, areas);
  if (stuffed) out.push(issue('stuffing', 'warn', { match: stuffed }));
  if (t.length < DESC_SHORT) out.push(issue('too_short', 'warn'));
  if (areas.length && !mentionsArea(t, areas)) out.push(issue('no_area', 'warn'));
  if (card.services.length && !mentionsService(t, card)) out.push(issue('no_service', 'warn'));
  else if (t.length > DESC_FOLD) {
    const head = t.slice(0, DESC_FOLD);
    if (!mentionsService(head, card) && !(areas.length && mentionsArea(head, areas))) out.push(issue('essence_late', 'warn'));
  }
  return out;
}

// ─── Fixing a description (what can be fixed in code) ────────────────────────

/**
 * Drops every sentence that carries an error (link, phone, price, promotion, a claim the owner never
 * made), softens the health tone, calms "!!!" and lowers shouting capitals, and cuts at a sentence
 * boundary under 750. Returns '' when nothing clean is left.
 */
export function fixDescription(text: string, card: TruthCard, opts: CheckOptions = {}): string {
  const category = opts.category ?? cardCategory(card);
  let t = (text ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  t = t.replace(CAPS_RE, (w) => w.charAt(0) + w.slice(1).toLowerCase()).replace(/!{2,}/g, '!');
  const paras = t.split(/\n\n/);
  const keptParas: string[] = [];
  for (const p of paras) {
    const kept = splitSentences(p).filter((s) => !hasErrors(checkDescription(s, card, { ...opts, category }).filter((i) => i.code !== 'too_long')));
    if (kept.length) keptParas.push(kept.join(' '));
  }
  t = keptParas.join('\n\n');
  if (category === 'health') {
    const src = sourceText(card, opts.draft ?? '', opts.attributeLabels ?? []);
    t = softenHealthCopy(t, { sourceText: src }).text;
  }
  if ((t.match(/!/g) ?? []).length > 1) {
    let first = true;
    t = t.replace(/!/g, () => { if (first) { first = false; return '!'; } return '.'; });
  }
  return cutAtSentence(t, DESC_MAX);
}

/** The longest run of whole sentences that fits in `max` characters. */
export function cutAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const parts = text.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const p of parts) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  return out || text.slice(0, max).replace(/\s+\S*$/, '');
}

// ─── Services ─────────────────────────────────────────────────────────────────

export interface ServiceValue { name: string; description: string }

/** A name for comparing: no niqqud or punctuation, no "ה"/"ו" in front, plural endings folded. */
export function serviceKey(name: string): string {
  return tokenize(name)
    .map((t) => t.replace(/^(?:ו|ה|וה)(?=[א-ת]{3,})/, ''))
    .map((t) => (t.length > 4 ? t.replace(/(?:ים|ות)$/, '') : t))
    .filter((t) => !STOP.has(t))
    .sort()
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Two names for the same service ("התקנת מזגנים" / "מזגנים - התקנה" is not caught; "התקנת מזגן" / "התקנת מזגנים" is). */
export function nearDuplicate(a: string, b: string): boolean {
  const ka = serviceKey(a), kb = serviceKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return Math.min(ka.length, kb.length) >= 5 && levenshtein(ka, kb) <= 1;
}

/** A tidy name: no bullets or numbering in front, no trailing punctuation, one space. */
export function tidyName(name: string): string {
  return line(name, 140)
    .replace(/^(?:[-–—•*·▪●◦]+|\d{1,2}[.)-])\s*/, '')
    .replace(/[\s.,;:!-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The owner's list, cleaned without changing what it says: tidy names, exact duplicates (by serviceKey)
 * merged into the first one (the longer description is kept). Never adds anything.
 */
export function normalizeServices(list: ServiceValue[]): ServiceValue[] {
  const out: ServiceValue[] = [];
  for (const s of list) {
    const name = tidyName(s?.name ?? '');
    const description = line(s?.description ?? '', 300);
    if (name.length < 2) continue;
    const dup = out.find((o) => serviceKey(o.name) === serviceKey(name));
    if (dup) { if (description.length > dup.description.length) dup.description = description; continue; }
    out.push({ name, description });
  }
  return out.slice(0, MAX_SERVICES);
}

/** Is this list fit for the Google listing? Issues carry the row's index. Pure. */
export function checkServices(list: ServiceValue[], card: TruthCard, opts: CheckOptions = {}): Issue[] {
  const out: Issue[] = [];
  const source = sourceText(card, opts.draft ?? '', opts.attributeLabels ?? []);
  if (list.length > MAX_SERVICES) out.push(issue('too_many', 'error'));
  list.forEach((s, index) => {
    const name = (s.name ?? '').trim(), desc = (s.description ?? '').trim();
    const both = `${name} ${desc}`;
    if (name.length < 2) out.push(issue('name_short', 'error', { index }));
    if (name.split(/\s+/).length > SERVICE_NAME_MAX_WORDS || name.length > SERVICE_NAME_MAX_CHARS) out.push(issue('name_long', 'warn', { index }));
    if (desc.length > SERVICE_DESC_MAX) out.push(issue('desc_long', 'warn', { index }));
    if (URL_RE.test(both) || BARE_DOMAIN.test(both)) out.push(issue('url', 'error', { index }));
    if (EMAIL_RE.test(both)) out.push(issue('email', 'error', { index }));
    if (PHONE_RE.test(both)) out.push(issue('phone', 'error', { index }));
    for (const m of findAll(PRICE_RES, both)) out.push(issue('price', 'error', { index, match: m }));
    for (const m of findAll(PROMO_RES, normalizeText(both))) out.push(issue('promo', 'error', { index, match: m }));
    if (desc) for (const m of ungroundedClaims(desc, source)) out.push(issue('invented', 'error', { index, match: m }));
    if (CAPS_RE.test(both)) { CAPS_RE.lastIndex = 0; out.push(issue('caps', 'warn', { index })); }
    CAPS_RE.lastIndex = 0;
    for (let j = 0; j < index; j++) if (nearDuplicate(list[j].name, name)) { out.push(issue('dup', 'warn', { index, match: list[j].name })); break; }
  });
  return out;
}

// ─── The model's answer ───────────────────────────────────────────────────────

/**
 * The model is told to answer with JSON only. Fences, a sentence around it, trailing commas, smart quotes
 * and a Hebrew abbreviation with a bare double quote inside a string (צה"ל, ש"ח) are repaired. null when
 * it still does not parse.
 */
export function parseModelJson<T = Record<string, unknown>>(raw: string): T | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first === -1 || last <= first) return null;
  s = s.slice(first, last + 1);
  const attempts = [
    s,
    s.replace(/,\s*([}\]])/g, '$1'),
    s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"').replace(/([א-ת])"([א-ת])/g, '$1״$2'),
  ];
  for (const a of attempts) {
    try { const v = JSON.parse(a) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) return v as T; } catch { /* next */ }
  }
  return null;
}

export interface ServicesAnswerItem { from: number[]; name: string; description: string }
export interface ServicesAnswer { services: ServicesAnswerItem[]; forgotten: string[] }

/** The services answer in its exact shape, or null. */
export function readServicesAnswer(v: unknown): ServicesAnswer | null {
  const o = v as { services?: unknown; forgotten?: unknown } | null;
  if (!o || !Array.isArray(o.services)) return null;
  const services: ServicesAnswerItem[] = [];
  for (const it of o.services) {
    const x = it as { from?: unknown; name?: unknown; description?: unknown };
    const from = Array.isArray(x?.from) ? x.from.filter((n): n is number => Number.isInteger(n)) : Number.isInteger(x?.from) ? [x.from as number] : [];
    if (!from.length || typeof x?.name !== 'string') continue;
    services.push({ from, name: x.name, description: typeof x.description === 'string' ? x.description : '' });
  }
  const forgotten = Array.isArray(o.forgotten) ? o.forgotten.filter((f): f is string => typeof f === 'string') : [];
  return services.length ? { services, forgotten } : null;
}

export interface PolishedService extends ServiceValue {
  /** The rows of the owner's list it stands for (two or more = merged). */
  from: number[];
  /** The name is the one on Google and was kept as is (renaming would add a second item on Google). */
  locked: boolean;
}

export interface ServicesSuggestion { services: PolishedService[]; forgotten: string[] }

/**
 * The model's answer applied over the owner's list, with the rules enforced in code:
 *  • every row of the owner's list is in the result exactly once, and nothing else is (no new services);
 *  • a row whose name is already on Google keeps its name (Google never loses items, so a new name would
 *    become a second item there), and two such rows are never merged;
 *  • names are tidy and short, descriptions one line of at most 120 characters with nothing the owner did
 *    not say (otherwise the owner's own description stays);
 *  • at most 3 "שירותים שאולי שכחתם", short, not like anything listed, never added by themselves.
 */
export function applyServicesAnswer(original: ServiceValue[], answer: ServicesAnswer, card: TruthCard, locked: Set<string>, opts: CheckOptions = {}): ServicesSuggestion {
  const source = sourceText(card, opts.draft ?? original.map((s) => `${s.name} ${s.description}`).join('\n'), opts.attributeLabels ?? []);
  const isLocked = (i: number) => locked.has(original[i].name.trim().toLowerCase());
  const used = new Set<number>();
  const out: PolishedService[] = [];

  const cleanDesc = (proposed: string, fallback: string): string => {
    const d = line(proposed, 400).replace(/[.\s]+$/, '');
    const bad = !d || d.length > SERVICE_DESC_MAX || hasErrors(checkServices([{ name: 'x x', description: d }], card, { ...opts, draft: source }))
      || (opts.category === 'health' && lintHealthCopy(d, { sourceText: source }).some((v) => v.rule !== 'loud'));
    return bad ? fallback : d;
  };

  const push = (from: number[], name: string, description: string) => {
    const lockedRows = from.filter(isLocked);
    if (lockedRows.length > 1) {
      // two items Google already has cannot become one: each keeps its own row
      for (const i of from) push([i], original[i].name, original[i].description);
      return;
    }
    const keepName = lockedRows.length === 1 ? original[lockedRows[0]].name : null;
    let n = keepName ?? tidyName(name);
    const fallbackName = original[from[0]].name;
    if (!keepName && (n.length < 2 || n.split(/\s+/).length > SERVICE_NAME_MAX_WORDS + 1 || hasErrors(checkServices([{ name: n, description: '' }], card)))) n = fallbackName;
    // a merged row may never lose the only description one of its rows had
    const ownDesc = from.map((i) => original[i].description).sort((a, b) => b.length - a.length)[0] ?? '';
    const d = cleanDesc(description, ownDesc.length <= SERVICE_DESC_MAX ? ownDesc : cutAtSentence(ownDesc, SERVICE_DESC_MAX));
    out.push({ name: n, description: d, from, locked: !!keepName });
    from.forEach((i) => used.add(i));
  };

  for (const it of answer.services) {
    const from = [...new Set(it.from)].filter((i) => i >= 0 && i < original.length && !used.has(i));
    if (!from.length) continue;
    // a merge must really be the same service: otherwise the rows stay apart
    if (from.length > 1 && !from.every((i) => from.some((j) => j !== i && (nearDuplicate(original[i].name, original[j].name) || sharesMainWord(original[i].name, original[j].name))))) {
      for (const i of from) push([i], it.name && from[0] === i ? it.name : original[i].name, from[0] === i ? it.description : original[i].description);
      continue;
    }
    push(from, it.name, it.description);
  }
  // rows the model dropped come back as they were, in their place
  original.forEach((s, i) => { if (!used.has(i)) out.push({ name: s.name, description: s.description, from: [i], locked: isLocked(i) }); });
  out.sort((a, b) => Math.min(...a.from) - Math.min(...b.from));

  // two result rows that still read the same: merge the later into the earlier (unless both are on Google)
  const merged: PolishedService[] = [];
  for (const s of out) {
    const twin = merged.find((m) => nearDuplicate(m.name, s.name) && !(m.locked && s.locked));
    if (twin) {
      twin.from = [...twin.from, ...s.from];
      if (s.locked) { twin.name = s.name; twin.locked = true; }
      if (!twin.description && s.description) twin.description = s.description;
    } else merged.push({ ...s });
  }

  const all = merged.map((m) => m.name);
  const forgotten: string[] = [];
  for (const f of answer.forgotten) {
    const n = tidyName(f);
    if (n.length < 2 || n.split(/\s+/).length > SERVICE_NAME_MAX_WORDS || /\d/.test(n)) continue;
    if (hasErrors(checkServices([{ name: n, description: '' }], card))) continue;
    if ([...all, ...forgotten].some((x) => nearDuplicate(x, n))) continue;
    forgotten.push(n);
    if (forgotten.length >= MAX_FORGOTTEN) break;
  }
  return { services: merged.slice(0, MAX_SERVICES), forgotten: merged.length + forgotten.length > MAX_SERVICES ? forgotten.slice(0, Math.max(0, MAX_SERVICES - merged.length)) : forgotten };
}

/** "תיקון מזגנים" / "מזגנים: תיקון ושירות" share a main word (4+ letters, not a generic one). */
function sharesMainWord(a: string, b: string): boolean {
  const GENERIC = new Set(['שירות', 'שירותי', 'שירותים', 'טיפול', 'טיפולי', 'טיפולים', 'תיקון', 'תיקוני', 'התקנת', 'התקנה', 'התקנות', 'ייעוץ']);
  const wa = serviceKey(a).split(' ').filter((w) => w.length >= 4 && !GENERIC.has(w));
  const wb = new Set(serviceKey(b).split(' ').filter((w) => w.length >= 4 && !GENERIC.has(w)));
  return wa.length > 0 && wa.every((w) => wb.has(w)) && wa.length === wb.size;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const GENERAL_TONE = [
  'Warm, confident and professional. Plain everyday Hebrew, short sentences, no jargon, no slogans.',
  'Written for people first: a customer reading it on Google Maps must understand in one glance what the business does and where.',
];
const CATEGORY_TONE: Partial<Record<CategoryId, string[]>> = {
  professional: ['Precise and trustworthy. Explain how you help, not how great you are.'],
  trades: ['Practical and reliable: what you fix or install, where you come to, how the work is done. No exaggeration.'],
  beauty: ['Warm and caring. Describe the treatments and the experience; never promise results.'],
  food: ['Inviting and concrete: what you serve and the atmosphere. Do not invent dishes, prices or awards.'],
  nonprofit: ['Respectful and clear: who you help and how. No pressure and no guilt.'],
  arts_events: ['Lively but clear: what you perform or organize and for which events.'],
};

/** The tone lines for this category (health: the calm rules of the health landing page). */
export function toneFor(category: CategoryId): string[] {
  if (category === 'health') return CATEGORY_CONFIG.health.toneRules;
  return [...GENERAL_TONE, ...(CATEGORY_TONE[category] ?? [])];
}

const GROUNDING_RULES = [
  'Use ONLY the facts in the FACTS block. If something is not there, do not write it.',
  'NEVER invent: years of experience, founding year, number of customers or jobs, certificates, licences, degrees, "expert", awards, rankings, guarantees, warranties, "24/7", response times, prices or discounts.',
  'No superlatives ("הכי", "הטוב ביותר", "מוביל", "מספר 1").',
  'No phone numbers, no links, no e-mail, no prices, no promotions or sales words ("מבצע", "הנחה", "חינם"), no ALL CAPS, at most one "!".',
  'Never the words "AI" or "בינה מלאכותית".',
];

export interface PromptPair { system: string; user: string }

export interface DescriptionPromptInput {
  card: TruthCard;
  draft: string;
  category: CategoryId;
  attributeLabels?: string[];
  /** earlier suggestions in this session: write a different one */
  previous?: string[];
  /** the issues the last answer had (the one retry) */
  fix?: Issue[];
}

export function descriptionPrompt(i: DescriptionPromptInput): PromptPair {
  const areas = cardAreas(i.card);
  const system = [
    'You write the business description for an Israeli small business\'s Google Business Profile, in Hebrew.',
    'Return ONLY JSON: {"description": "<the text>"}. No other keys, no explanations.',
    '',
    'GOOGLE RULES:',
    `- ${DESC_AIM_MIN} to ${DESC_AIM_MAX} characters (hard maximum ${DESC_MAX}). 2 short paragraphs at most, separated by a blank line.`,
    `- The first ${DESC_FOLD} characters carry the essence: what the business does, its main service, and where (Google shows only this before "more").`,
    areas.length ? `- Mention the place naturally once or twice (${areas.slice(0, 3).join(', ')}), and the main service once or twice. Written for humans: never a list of keywords, never the same word over and over.` : '- Mention the main service once or twice, naturally. Never a list of keywords.',
    '- Do not start with the business name followed by a colon; do not repeat the name more than once.',
    '- Speak as the business ("אנחנו") or neutrally; address customers in the plural ("אתם") if at all.',
    '',
    'GROUNDING:',
    ...GROUNDING_RULES.map((r) => `- ${r}`),
    '- Keep every true detail the owner wrote that helps a customer decide (how they work, what is special), in better words.',
    '',
    'TONE:',
    ...toneFor(i.category).map((r) => `- ${r}`),
  ].join('\n');
  const user = [
    'FACTS:',
    buildGrounding(i.card, { draft: i.draft, attributeLabels: i.attributeLabels }),
    '',
    i.draft.trim() ? `THE CURRENT TEXT TO IMPROVE:\n${i.draft.trim()}` : 'There is no description yet: write one from the facts.',
    ...(i.previous?.length ? ['', 'ALREADY SUGGESTED (write a clearly different version: another opening, another order, other wording):', ...i.previous.map((p) => `---\n${p}`)] : []),
    ...(i.fix?.length ? ['', 'YOUR LAST ANSWER BROKE THESE RULES, fix them:', ...i.fix.map((f) => `- ${f.code}${f.match ? ` ("${f.match}")` : ''}`)] : []),
  ].join('\n');
  return { system, user };
}

export interface ServicesPromptInput {
  card: TruthCard;
  list: ServiceValue[];
  locked: Set<string>;
  category: CategoryId;
  attributeLabels?: string[];
  previous?: ServicesSuggestion[];
  fix?: Issue[];
}

export function servicesPrompt(i: ServicesPromptInput): PromptPair {
  const system = [
    'You tidy the list of services of an Israeli small business for its Google Business Profile, in Hebrew.',
    'Return ONLY JSON: {"services": [{"from": [<row numbers>], "name": "...", "description": "..."}], "forgotten": ["..."]}.',
    '',
    'RULES:',
    '- Every row of the input appears in exactly one item\'s "from". Never add a service that is not in the input. Never drop one.',
    '- Merge rows only when they are the same service written twice (e.g. "התקנת מזגן" and "התקנת מזגנים"): one item with both row numbers.',
    '- "name": a short Hebrew name, 2 to 5 words, the way a customer would search for it ("פתיחת סתימות", "החלפת דוד שמש"). One consistent style for all items (noun phrases, no verbs in the imperative, no punctuation at the end).',
    '- A row marked [ON GOOGLE] keeps its name EXACTLY as written (you may still write its description).',
    `- "description": one line, at most ${SERVICE_DESC_MAX} characters, saying concretely what the service includes. Only facts from the FACTS block and the row itself; if there is nothing true to add, use "" or the row's own description.`,
    '- "forgotten": up to 3 short service names that businesses of this kind very commonly offer and that are NOT in the list. They are only suggestions the owner may tick. If unsure, return [].',
    '',
    'GROUNDING:',
    ...GROUNDING_RULES.map((r) => `- ${r}`),
    '',
    'TONE:',
    ...toneFor(i.category).map((r) => `- ${r}`),
  ].join('\n');
  const rows = i.list.map((s, n) => `${n}. ${s.name}${i.locked.has(s.name.trim().toLowerCase()) ? ' [ON GOOGLE]' : ''}${s.description ? ` | ${s.description}` : ''}`);
  const user = [
    'FACTS:',
    buildGrounding(i.card, { attributeLabels: i.attributeLabels }),
    '',
    'THE LIST (row number. name | description):',
    ...rows,
    ...(i.previous?.length ? ['', 'ALREADY SUGGESTED (offer different wording where it helps):', ...i.previous.map((p) => p.services.map((s) => `- ${s.name}${s.description ? ` | ${s.description}` : ''}`).join('\n'))] : []),
    ...(i.fix?.length ? ['', 'YOUR LAST ANSWER BROKE THESE RULES, fix them:', ...i.fix.map((f) => `- ${f.code}${f.match ? ` ("${f.match}")` : ''}${f.index !== undefined ? ` (item ${f.index})` : ''}`)] : []),
  ].join('\n');
  return { system, user };
}

// ─── The daily allowance ──────────────────────────────────────────────────────

/** Suggestions per field per account per day (the first one and up to two "ניסוח אחר"). */
export const POLISH_DAILY_LIMIT = 3;

/** The day in Israel ("2026-11-22"): the allowance renews at midnight Israel time. */
export function israelDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The account as a key: a hash, never the e-mail itself. */
export const accountKey = (email: string): string => createHash('sha256').update(`polish:${email.trim().toLowerCase()}`).digest('hex').slice(0, 24);

/**
 * How many suggestions an account asked for today, per field. In memory, like the route limiters
 * (middleware/rateLimit.ts): a restart forgets the day's count, which only ever errs in the owner's favour.
 */
export class PolishCounter {
  private readonly used = new Map<string, number>();
  constructor(private readonly limit = POLISH_DAILY_LIMIT) {}
  private key(account: string, field: PolishField, now: Date) { return `${israelDay(now)}|${account}|${field}`; }
  remaining(account: string, field: PolishField, now = new Date()): number {
    return Math.max(0, this.limit - (this.used.get(this.key(account, field, now)) ?? 0));
  }
  /** Takes one; false when the day's allowance is used up. */
  take(account: string, field: PolishField, now = new Date()): boolean {
    this.sweep(now);
    const k = this.key(account, field, now);
    const n = this.used.get(k) ?? 0;
    if (n >= this.limit) return false;
    this.used.set(k, n + 1);
    return true;
  }
  /** Gives one back (the model failed and nothing was shown). */
  refund(account: string, field: PolishField, now = new Date()): void {
    const k = this.key(account, field, now);
    const n = this.used.get(k) ?? 0;
    if (n <= 1) this.used.delete(k); else this.used.set(k, n - 1);
  }
  private sweep(now: Date) {
    if (this.used.size < 5000) return;
    const today = israelDay(now);
    for (const k of this.used.keys()) if (!k.startsWith(today)) this.used.delete(k);
  }
}
