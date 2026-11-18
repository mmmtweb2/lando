// The HEALTH template's copy rules (README part 141): a lint for the tone (calm, no promises, no sales
// words, no superlatives, no prices the owner did not give, no before/after claims), the automatic
// softening of what the lint finds, the neutral defaults that say nothing about the specific clinic,
// the grounding checks for the doctor's details, and the function that turns generated content into
// a health page's content. Pure module: no I/O, no network.
import type { AiContent, TeamMember } from './ai.service';
import { containsPhrase, extractCity, healthSubtype, normalizeText, tokenize, wordMatches, type HealthSubtype } from './pageCategory';

// ─── Lint ─────────────────────────────────────────────────────────────────────

export type LintRuleId =
  | 'promise' | 'no_pain' | 'promo' | 'superlative' | 'hype' | 'price' | 'before_after' | 'loud' | 'ai_word';

export interface LintViolation {
  rule: LintRuleId;
  /** What matched, as written. */
  match: string;
  index: number;
  /** The sentence it is in. */
  sentence: string;
}

const HB = 'א-ת';
// Any 0-2 prefix letters (ו ב ל מ כ ש ה) before a word; the word must start and end at a Hebrew boundary.
const lead = `(?<![${HB}])[ובלמכשה]{0,2}`;
const tail = `(?![${HB}])`;
const W = (alts: string) => new RegExp(`${lead}(?:${alts})${tail}`, 'g');
const RAW = (src: string) => new RegExp(src, 'g');

interface Rule { id: LintRuleId; re: RegExp; /** replace = the fix keeps the sentence (loud punctuation) */ fix: 'remove' | 'replace' }

const RULES: Rule[] = [
  // promises of results, cures, guarantees
  { id: 'promise', fix: 'remove', re: W('מבטיח(?:ה|ים|ות)?|נבטיח|אבטיח|הבטחה|הבטחות|מובטח(?:ת|ים|ות)?|מתחייב(?:ת|ים|ות)?|ערבות|אחריות מלאה|אחריות על התוצאה|החזר כספי') },
  { id: 'promise', fix: 'remove', re: W('תוצאות? (?:מדהימות|מיידיות|מהירות|מושלמות|מובטחות|מבטיחות|טובות)|תוצאה (?:מדהימה|מיידית|מהירה|מושלמת|מובטחת)|שינוי מוחלט|פתרון (?:סופי|מלא|מושלם)|החלמה מלאה|ריפוי מלא|נרפא|מרפאים את|נפתור (?:לכם|את)|נפטר (?:אתכם|אתכן) מ') },
  { id: 'promise', fix: 'remove', re: RAW(`(?:100\\s*%|מאה אחוז)`) },
  // "no pain" guarantees
  { id: 'no_pain', fix: 'remove', re: W('(?:ללא|בלי|אפס|נטול(?:ת|י)?)\\s+(?:כאב|כאבים|אי\\s*נוחות|חרדה|פחד)|לא כואב(?:ת|ים|ות)?|לא תרגישו (?:כאב|כלום)|טיפול נטול כאב') },
  // sales and urgency
  { id: 'promo', fix: 'remove', re: W('הזדמנות|הזדמנויות|הנחה|הנחות|חינם|חינמי(?:ת|ים|ות)?|מתנה|הטבה|הטבות|קופון|לזמן מוגבל|רק היום|אל (?:תחמיצו|תפספסו)|חבל לפספס|מקומות (?:אחרונים|מוגבלים)|מהרו|במחיר מיוחד|מחיר מיוחד|מחירים מיוחדים|ללא עלות|בלי עלות|ללא תשלום|בלעדי(?:ת|ים|ות)?') },
  // "מבצע" is also a verb ("הרופא מבצע בדיקה"): flagged only as the sales noun
  { id: 'promo', fix: 'remove', re: RAW(`(?<![${HB}])[בה]מבצע(?:ים)?${tail}`) },
  { id: 'promo', fix: 'remove', re: RAW(`(?<![${HB}])מבצע(?:ים)?\\s+(?:מיוחד|מיוחדים|חם|חמים|השקה|לזמן|אביב|חורף|קיץ|פתיחה|בלעדי|סוף|חג|עד|ל|על)${tail}`) },
  { id: 'promo', fix: 'remove', re: RAW(`(?<![${HB}])מבצע(?:ים)?\\s*[!:]`) },
  // superlatives, rankings, perfection
  { id: 'superlative', fix: 'remove', re: W('הכי|ביותר|מוביל(?:ה|ים|ות)?|מספר\\s*(?:1|אחת)|מס[\'׳\\.]?\\s*1|ללא תחרות|אין שני|אין כמונו|ללא מתחרים|מהמובילים|מהטובים|מושלם|מושלמת|מושלמים|מושלמות|ללא פשרות') },
  { id: 'superlative', fix: 'remove', re: RAW(`${lead}הטוב(?:ה|ים|ות)?\\s+ב(?:ארץ|אזור|עיר|ישראל)${tail}`) },
  { id: 'superlative', fix: 'remove', re: RAW(`#\\s*1(?!\\d)|\\bnumber\\s*(?:one|1)\\b|\\bno\\.?\\s*1\\b`) },
  // hype
  { id: 'hype', fix: 'remove', re: W('מדהים|מדהימה|מדהימים|מדהימות|פנטסטי(?:ת|ים|ות)?|חלומי(?:ת|ים|ות)?|בלתי נשכח(?:ת|ים|ות)?|מהפכני(?:ת|ים|ות)?|מהפכה|פורץ דרך|פורצת דרך|פורצי דרך|שוברים שיווי משקל|זול(?:ה|ים|ות)?|משתלם(?:ת|ים|ות)?|מחירים? תחרותי(?:ים|ות)?|מחיר תחרותי') },
  // prices (allowed only when the owner wrote the same number, see lintHealthCopy)
  { id: 'price', fix: 'remove', re: RAW(`\\d[\\d,.]*\\s*(?:₪|ש["״]ח|שח|שקל(?:ים)?|nis)(?![a-z])`) },
  { id: 'price', fix: 'remove', re: RAW(`(?:₪|ש["״]ח)\\s*\\d[\\d,.]*`) },
  { id: 'price', fix: 'remove', re: RAW(`${lead}החל\\s+מ-?\\s*\\d[\\d,.]*`) },
  { id: 'price', fix: 'remove', re: RAW(`${lead}מחיר(?:ים)?\\s+(?:של\\s+|הוא\\s+|החל\\s+מ-?\\s*)?\\d[\\d,.]*`) },
  { id: 'price', fix: 'remove', re: RAW(`\\$\\s*\\d[\\d,.]*|\\d[\\d,.]*\\s*\\$`) },
  // before / after results
  { id: 'before_after', fix: 'remove', re: RAW(`(?<![${HB}])לפני\\s*(?:ו|/|-|–)?\\s*אחרי${tail}`) },
  { id: 'before_after', fix: 'remove', re: W('תוצאות (?:אמיתיות|של מטופלים|מטופלים)|גלריית תוצאות|תמונות (?:לפני|תוצאה)') },
  { id: 'before_after', fix: 'remove', re: RAW(`\\bbefore\\s*(?:/|and|&)\\s*after\\b`) },
  // loud punctuation: the sentence stays, the "!" becomes a full stop
  { id: 'loud', fix: 'replace', re: RAW('!+') },
  // the word is never customer-facing
  { id: 'ai_word', fix: 'remove', re: RAW(`(?<![A-Za-z])AI(?![A-Za-z])|בינה מלאכותית`) },
];

/** Split into sentences, keeping each one's terminator. A "." inside a number (1.5) or after ד״ר does not end one. */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

const digitsOf = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((d) => d.replace(/[,.]+$/, ''));

export interface LintOptions {
  /** What the owner wrote (their description and own text). A price whose number appears here is the owner's own and is allowed. */
  sourceText?: string;
}

/** Flags what a calm health page must not say. Pure: returns violations, changes nothing. */
export function lintHealthCopy(text: string, opts: LintOptions = {}): LintViolation[] {
  const out: LintViolation[] = [];
  const src = normalizeText(opts.sourceText ?? '');
  const srcNums = new Set(digitsOf(src));
  for (const sentence of splitSentences(text ?? '')) {
    const norm = sentence;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.re.exec(norm))) {
        if (m[0] === '') { rule.re.lastIndex++; continue; }
        if (rule.id === 'price') {
          const nums = digitsOf(m[0]);
          if (nums.length && nums.every((n) => srcNums.has(n))) continue;
        }
        out.push({ rule: rule.id, match: m[0].trim(), index: text.indexOf(sentence) + m.index, sentence });
      }
    }
  }
  return out;
}

export interface SoftenResult { text: string; violations: LintViolation[]; changed: boolean }

/**
 * Makes copy calm: "!" becomes ".", and a sentence (or, inside a sentence, a comma-separated clause)
 * that makes a forbidden claim is removed. Returns '' when nothing clean is left, so the caller can
 * put a neutral default in its place.
 */
export function softenHealthCopy(text: string, opts: LintOptions = {}): SoftenResult {
  const original = text ?? '';
  const violations = lintHealthCopy(original, opts);
  if (violations.length === 0) return { text: original, violations, changed: false };

  const calmPunct = (t: string) => t.replace(/!+/g, '.').replace(/\.{2,}/g, '.');
  const kept: string[] = [];
  for (const sentence of splitSentences(original)) {
    if (lintHealthCopy(sentence, opts).every((v) => v.rule === 'loud')) { kept.push(calmPunct(sentence)); continue; }
    // clause level: "מרפאה, הטובה ביותר בעיר, ליד הים" -> "מרפאה, ליד הים"
    const trail = /[.!?]$/.test(sentence) ? (sentence.slice(-1) === '?' ? '?' : '.') : '';
    const body = trail ? sentence.slice(0, -1) : sentence;
    const clauses = body.split(/\s*[,،;]\s*/);
    const clean = clauses.filter((c) => lintHealthCopy(c, opts).length === 0);
    const remaining = clean.join(', ');
    if (clauses.length > 1 && clean.length > 0 && remaining.split(/\s+/).length >= 3) kept.push(remaining + trail);
  }
  const result = kept.join(' ').trim();
  return { text: result, violations, changed: result !== original };
}

// ─── Neutral defaults (they say nothing about the specific clinic) ────────────

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

export const SPOKEN_LANGUAGES_DEFAULT = ['עברית'];
export const MAX_SPOKEN_LANGUAGES = 8;
export const MAX_TEAM = 4;
export const MAX_TREATMENTS = 8;

export const HEALTH_FIRST_VISIT = [
  { step_number: 1, title: 'שיחה', description: 'מספרים לנו מה מביא אתכם אלינו ומה חשוב לכם. אפשר לשאול הכול.' },
  { step_number: 2, title: 'בדיקה', description: 'בודקים ומסבירים בשפה פשוטה מה נמצא.' },
  { step_number: 3, title: 'המשך', description: 'מדברים על האפשרויות ובוחרים יחד מה מתאים לכם.' },
];

const contactWays = (ctaType: string | undefined) =>
  ctaType === 'phone' ? 'בטלפון' : ctaType === 'email' ? 'במייל או בטלפון' : 'בוואטסאפ או בטלפון';

export function healthFaq(subtype: HealthSubtype, ctaType?: string): Array<{ question: string; answer: string }> {
  const ways = contactWays(ctaType);
  return [
    { question: 'מה קורה בביקור הראשון?', answer: `בדרך כלל מתחילים בשיחה ובבדיקה, ואז מסבירים מה אפשר לעשות. יש שאלה לפני שמגיעים? כתבו או התקשרו, ונשמח לענות.` },
    { question: 'האם אפשר להשתמש בקופת חולים או בביטוח?', answer: `זה תלוי בסוג הטיפול ובקופה או בביטוח שלכם. שאלו אותנו ${ways}, ונבדוק איתכם מה רלוונטי.` },
    subtype === 'dental'
      ? { question: 'אני חושש/ת מטיפולי שיניים. מה אפשר לעשות?', answer: 'זה נפוץ יותר ממה שחושבים. אפשר לספר לנו על כך כשקובעים תור, ונדבר על דרכים להרגיש בנוח.' }
      : { question: 'אני חושש/ת לפני הטיפול. מה אפשר לעשות?', answer: 'זה טבעי. אפשר לספר לנו על כך כשקובעים תור, ונדבר על דרכים להרגיש בנוח.' },
    { question: 'מה עושים במקרה דחוף?', answer: 'אם יש כאב חזק או מצב דחוף, התקשרו אלינו ונסביר מה כדאי לעשות. במצב חירום רפואי פנו למד״א בטלפון 101 או למיון הקרוב.' },
    { question: 'איך קובעים תור?', answer: `אפשר לפנות אלינו ${ways}, ונתאם זמן שמתאים לכם.` },
  ];
}

export function healthLabel(subtype: HealthSubtype): string {
  return subtype === 'dental' ? 'מרפאת שיניים' : subtype === 'physio' ? 'פיזיותרפיה' : 'מרפאה';
}

export function healthCtaLabel(ctaType: string | undefined): string {
  return ctaType === 'phone' ? 'לקביעת תור בטלפון' : ctaType === 'email' ? 'לקביעת תור במייל' : 'לקביעת תור בוואטסאפ';
}

/** Text for the "ב" + city form: "בחיפה". */
export const inCity = (city: string) => `ב${city}`;

export function healthFallbackTitle(subtype: HealthSubtype, city: string | null, businessName: string): string {
  return city ? `${healthLabel(subtype)} ${inCity(city)}` : businessName;
}

// ─── Spoken languages ─────────────────────────────────────────────────────────

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

/** Owner input ("עברית, צרפתית ואנגלית", "מדברים עברית ואנגלית" or one per line) -> a clean list. */
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

// ─── Doctor details: only what the owner said ─────────────────────────────────

export interface DoctorExtraction { name?: string; role?: string; credentials?: string; experience?: string }

const GROUND_STOP = new Set(['של', 'עם', 'את', 'על', 'אל', 'מן', 'גם', 'כל', 'זה', 'זו', 'הוא', 'היא', 'אני', 'אנו', 'אנחנו', 'שלנו', 'לנו']);

/**
 * Is `candidate` something the owner actually wrote? Every number must appear in the source, and every
 * Hebrew/English word of 3+ letters must appear there too (a Hebrew prefix may differ). Conservative on
 * purpose: a paraphrase that fails is dropped, and the owner fills the field in.
 */
export function isGrounded(candidate: string, sourceText: string): boolean {
  const c = (candidate ?? '').trim();
  if (!c) return false;
  const src = tokenize(sourceText);
  const srcNums = new Set(digitsOf(normalizeText(sourceText)));
  if (!digitsOf(normalizeText(c)).every((n) => srcNums.has(n))) return false;
  const words = tokenize(c).filter((w) => w.length >= 3 && !GROUND_STOP.has(w));
  if (words.length === 0) return false;
  return words.every((w) => src.some((s) => wordMatches(s, w) || wordMatches(w, s)));
}

const NAME_TITLE = /(ד["״]ר|דוקטור|פרופ['׳]?|פרופסור|dr\.?)\s+([א-ת'\-]{2,}(?:\s+[א-ת'\-]{2,})?)/i;
const NAME_STOP = new Set([
  'רופא', 'רופאה', 'רופאת', 'רופאי', 'מומחה', 'מומחית', 'מטפל', 'מטפלת', 'פיזיותרפיסט', 'פיזיותרפיסטית', 'אורתודנט', 'אורתודנטית',
  'אורתודונט', 'שיננית', 'מרפאה', 'מרפאת', 'קליניקה', 'בעל', 'בעלת', 'עם', 'מנהל', 'מנהלת', 'מייסד', 'מייסדת', 'בוגר', 'בוגרת',
  'מתמחה', 'מרצה', 'מוסמך', 'מוסמכת', 'ותק', 'ניסיון', 'מאז', 'מזה', 'כבר', 'של', 'פסיכולוג', 'פסיכולוגית', 'דיאטנית', 'כירופרקט',
]);
const isNameStop = (w: string) => NAME_STOP.has(w) || (w.startsWith('ו') && NAME_STOP.has(w.slice(1)));

/** "ד״ר כהן רופא שיניים" -> "ד״ר כהן". Only a name that follows a title the owner wrote. */
export function extractDoctorName(text: string): string | null {
  const m = normalizeText(text).match(NAME_TITLE);
  if (!m) return null;
  const title = /^dr/i.test(m[1]) ? 'ד״ר' : m[1].replace(/"/g, '״').replace(/'/g, '׳');
  const parts: string[] = [];
  for (const w of m[2].split(/\s+/)) {
    if (isNameStop(w)) { if (parts.length > 0) break; return null; }
    parts.push(w);
    if (parts.length === 2) break;
  }
  return parts.length ? `${title} ${parts.join(' ')}` : null;
}

const ROLES = ['רופאת שיניים', 'רופא שיניים', 'אורתודנטית', 'אורתודנט', 'אורתודונטית', 'אורתודונט', 'שיננית', 'פיזיותרפיסטית', 'פיזיותרפיסט', 'פסיכולוגית', 'פסיכולוג', 'רופאת ילדים', 'רופא ילדים', 'רופאת משפחה', 'רופא משפחה', 'קלינאית תקשורת', 'קלינאי תקשורת', 'דיאטנית', 'כירופרקט', 'רופאה', 'רופא'];

/** The professional title the owner wrote ("רופא שיניים"), if any. */
export function extractRole(text: string): string | null {
  const t = tokenize(text);
  for (const r of ROLES) if (containsPhrase(t, normalizeText(r).split(/\s+/))) return r;
  return null;
}

/** A licence number only when the owner wrote one ("רישיון מספר 12345", "מס׳ רישיון 12345"). */
export function extractLicense(text: string): string | null {
  const m = normalizeText(text).match(/(?:מס[׳'.]?(?:פר)?\s*)?(?:רישיון|רשיון)(?:\s*(?:מס[׳'.]?(?:פר)?|מספר))?\s*[:#-]?\s*(\d{3,8})/);
  return m ? m[1] : null;
}

export function buildDoctor(ai: DoctorExtraction | undefined, sourceText: string): TeamMember | null {
  const name = (ai?.name && isGrounded(ai.name, sourceText) ? ai.name.trim() : '') || extractDoctorName(sourceText) || '';
  if (!name) return null;
  const role = (ai?.role && isGrounded(ai.role, sourceText) ? ai.role.trim() : '') || extractRole(sourceText) || '';
  const credentials = ai?.credentials && isGrounded(ai.credentials, sourceText) ? ai.credentials.trim() : '';
  const experience = ai?.experience && isGrounded(ai.experience, sourceText) ? ai.experience.trim() : '';
  const license = extractLicense(sourceText);
  return { name, role, credentials, experience, ...(license ? { license_number: license } : {}) };
}

/** Parking / accessibility lines: kept only when the owner's text mentions the subject at all. */
export function groundedPractical(ai: { parking?: string; accessibility?: string } | undefined, sourceText: string): { parking?: string; accessibility?: string } {
  const t = tokenize(sourceText);
  const mentions = (...ps: string[]) => ps.some((p) => containsPhrase(t, normalizeText(p).split(/\s+/)));
  const out: { parking?: string; accessibility?: string } = {};
  if (ai?.parking?.trim() && mentions('חניה', 'חניון', 'חנייה', 'חניות') && isGrounded(ai.parking, sourceText)) out.parking = ai.parking.trim();
  if (ai?.accessibility?.trim() && mentions('נגיש', 'נגישה', 'נגישות', 'מעלית', 'כיסא גלגלים', 'כסא גלגלים', 'כיסאות גלגלים') && isGrounded(ai.accessibility, sourceText)) out.accessibility = ai.accessibility.trim();
  return out;
}

// ─── Building the health page's content ───────────────────────────────────────

export interface HealthCtx {
  businessName: string;
  address?: string | null;
  /** Everything the owner wrote about the business (description, own text). */
  sourceText: string;
  ctaType?: string;
  /** Extra health-only fields the writer returned (optional). */
  doctor?: DoctorExtraction;
  practical?: { parking?: string; accessibility?: string };
}

/** Lints one text; returns the softened text, or the fallback when nothing clean is left. */
function calm(text: string | undefined, fallback: string, ctx: HealthCtx, report: string[], field: string): string {
  const t = (text ?? '').trim();
  if (!t) return fallback;
  const r = softenHealthCopy(t, { sourceText: ctx.sourceText });
  if (r.violations.length) report.push(`${field}: ${[...new Set(r.violations.map((v) => v.rule))].join(',')}`);
  return r.text || fallback;
}

/**
 * Turns generated content into the HEALTH template's content: calm text (lint + soften), only the
 * treatments the owner named, the doctor section from the owner's own words, the neutral first-visit
 * steps and FAQ, the WhatsApp "book" call to action, the city in the headline, the languages line, and the
 * before/after section switched off. `report` lists what the lint changed (for logs and tests).
 */
export function applyHealthTemplate(content: AiContent, ctx: HealthCtx): { content: AiContent; report: string[] } {
  const report: string[] = [];
  const c: AiContent = JSON.parse(JSON.stringify(content));
  const subtype = healthSubtype(ctx.sourceText);
  const city = extractCity(ctx.address, ctx.sourceText);

  // opening: a quiet headline that names the city, one calm sentence, two buttons (book + call)
  const fallbackTitle = healthFallbackTitle(subtype, city, ctx.businessName);
  let title = calm(c.hero?.title, fallbackTitle, ctx, report, 'hero.title');
  if (city && !title.includes(city)) title = healthFallbackTitle(subtype, city, ctx.businessName);
  c.hero = {
    ...c.hero,
    title,
    subtitle: calm(c.hero?.subtitle, 'אתם מוזמנים לשאול אותנו הכול לפני שקובעים תור.', ctx, report, 'hero.subtitle'),
    primary_cta_text: healthCtaLabel(ctx.ctaType),
  };
  c.about = {
    heading: calm(c.about?.heading, HEALTH_HEADINGS.teamNoPeople, ctx, report, 'about.heading'),
    content: calm(c.about?.content, '', ctx, report, 'about.content'),
  };

  // treatments: only the ones named in the owner's text, one calm sentence each
  const rawServices = (c.services_or_benefits ?? c.services ?? []).slice(0, MAX_TREATMENTS);
  const services = rawServices
    .map((s, i) => {
      const t = calm(s.title, '', ctx, report, `services.${i}.title`);
      if (!t) return null;
      return {
        ...s,
        id: s.id ?? String(i + 1),
        title: t,
        description: calm(s.description, 'שאלו אותנו על הטיפול הזה, ונסביר מה כרוך בו.', ctx, report, `services.${i}.description`),
      };
    })
    .filter((s): s is NonNullable<typeof s> => !!s);
  c.services_or_benefits = services.length
    ? services
    : [{ id: '1', title: subtype === 'dental' ? 'טיפולי שיניים' : subtype === 'physio' ? 'טיפולי פיזיותרפיה' : 'טיפולים', description: 'לפרטים על הטיפולים שמתאימים לכם, שלחו לנו הודעה.', service_icon_keyword: 'clinic' }];
  delete c.services;
  c.services_heading = HEALTH_HEADINGS.services;
  c.services_kicker = undefined;

  // the sections the system writes itself (neutral, nothing about this clinic)
  c.benefits = [];
  c.process_steps = HEALTH_FIRST_VISIT.map((s) => ({ ...s }));
  c.process_heading = HEALTH_HEADINGS.process;
  c.faq = healthFaq(subtype, ctx.ctaType);
  c.faq_heading = HEALTH_HEADINGS.faq;
  c.testimonials_heading = HEALTH_HEADINGS.testimonials;
  c.trust_badges = undefined;
  c.cta_banner_subline = calm(c.cta_banner_subline, 'אפשר לכתוב לנו, ונמצא זמן שמתאים.', ctx, report, 'cta_banner_subline');
  const seoFallback = city ? `${ctx.businessName} | ${healthLabel(subtype)} ${inCity(city)}` : ctx.businessName;
  c.seo_title = calm(c.seo_title, seoFallback, ctx, report, 'seo_title');
  c.seo_description = calm(c.seo_description, `${healthLabel(subtype)}${city ? ` ${inCity(city)}` : ''}. פרטים, טיפולים ודרכי יצירת קשר.`, ctx, report, 'seo_description');

  // doctor and team: from the owner's own words only; a licence number only if they wrote one
  const doctor = buildDoctor(ctx.doctor, ctx.sourceText);
  c.team = doctor ? [doctor] : (c.team ?? []);
  c.team_heading = HEALTH_HEADINGS.team;
  c.practical_info = groundedPractical(ctx.practical, ctx.sourceText);
  c.spoken_languages = c.spoken_languages?.length ? c.spoken_languages : [...SPOKEN_LANGUAGES_DEFAULT];

  // the call to action and the WhatsApp text
  c.contact = {
    ...c.contact,
    whatsapp_message: `שלום, אשמח לקבוע תור ב${ctx.businessName}.`,
  };

  // before/after exists but starts switched off
  c.hidden_sections = [...new Set([...(c.hidden_sections ?? []), 'before_after'])];
  c.design_tokens = { ...c.design_tokens, image_style: 'photo' };
  c.layout_composition = ['hero_split', 'services_grid', 'process_timeline', 'faq_accordion', 'cta_banner'];
  return { content: c, report };
}

/**
 * A full regeneration writes a new ai_content; what the OWNER entered or switched must survive it:
 * the doctor and team, the languages, the practical lines, the hidden sections, the chosen contact method.
 */
export function carryOverOwnerData(prev: AiContent | null | undefined, next: AiContent, defaultHidden: string[] = []): AiContent {
  const out: AiContent = { ...next };
  if (prev?.team?.length) out.team = prev.team;
  if (prev?.spoken_languages?.length) out.spoken_languages = prev.spoken_languages;
  if (prev?.practical_info && Object.values(prev.practical_info).some(Boolean)) out.practical_info = { ...out.practical_info, ...prev.practical_info };
  if (prev?.contact?.cta_type) out.contact = { ...out.contact, cta_type: prev.contact.cta_type };
  out.hidden_sections = [...new Set([...(prev?.hidden_sections ?? []), ...defaultHidden])];
  if (!out.hidden_sections.length) delete out.hidden_sections;
  return out;
}
