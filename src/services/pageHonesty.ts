// What the page writer may say, and the checks run on what it wrote (README part 150). Pure: unit-tested.
//
// The wizard used to promise "Pagey לעולם לא ימציא נתונים". The QA pass found a page with an FAQ the owner
// never gave and a product detail ("קרום פריך") nobody wrote. What the system guarantees now, and only this:
//   1. Specific facts (numbers, prices, years, ingredients, materials, product attributes, menu items,
//      certifications, guarantees) are asked for ONLY when the owner wrote them (prompt rules below).
//   2. FAQ: written only when the owner gave enough of their own text to answer from, and then only
//      questions the text answers. With too little text the page has NO FAQ (enforced in code, not just
//      asked of the model). We chose "omit" over "generic answers that say ask us": an FAQ whose every
//      answer is "שאלו אותנו" adds nothing, and it still invents which questions customers ask.
//   3. Text with a word that mixes alphabets (Hebrew letters glued to Latin or Cyrillic in one word, Arabic
//      or Cyrillic letters inside Hebrew copy) is a known failure of the model: such FAQ items, benefits and
//      trust badges are dropped, other fields are reported in the log.
// It cannot guarantee correct Hebrew spelling: the prompt asks for care, and the owner reads the draft.

/** How much of their own text (free text + follow-up answers + about) the owner must give before an FAQ is written. */
export const FAQ_MIN_OWNER_TEXT = 150;

export interface OwnerTextInput {
  about_business?: string;
  user_provided_text?: string;
}

/** The owner's own words about the business, as one text. */
export const ownerText = (input: OwnerTextInput): string =>
  [input.about_business, input.user_provided_text].filter((s): s is string => typeof s === 'string' && !!s.trim()).join('\n').trim();

/** True when the owner wrote enough to answer customer questions from it. */
export const faqAllowed = (input: OwnerTextInput): boolean => ownerText(input).length >= FAQ_MIN_OWNER_TEXT;

/** Extra bullets for NO_FABRICATION_RULE: the product details the QA pass caught. */
export const PRODUCT_DETAILS_RULE = `- product or service DETAILS: ingredients, materials, textures, flavours, techniques, brands, models,
  sizes, durations, specific dishes or menu items, dietary labels (vegan, gluten-free, kosher, organic),
  "handmade", "fresh daily", opening days — e.g. never "קרום פריך", "בצק שמרים שהותפח 48 שעות", "קמח מלא",
  "כשר למהדרין" unless those words (or a plain equivalent) appear in the input. Describe the offering in the
  general words of the niche the owner named, nothing more specific.`;

export const SPELLING_RULE = `HEBREW SPELLING (CRITICAL):
- Write standard, correctly spelled modern Hebrew. Re-read every Hebrew word before returning.
- If you are not sure how a word is spelled, use a simpler common word you are sure of
  (a typo like "טבגן" instead of "טבעוני" is worse than a plainer sentence).
- Never mix alphabets inside one word: no Latin, Cyrillic or Arabic letters glued to Hebrew letters.
  Brand names in Latin letters stay as separate words, optionally with a Hebrew prefix and a hyphen ("ב-Google").
- No transliterated English when a normal Hebrew word exists.`;

/** The FAQ instruction for the trust prompt, by how much the owner wrote. */
export function faqRule(input: OwnerTextInput): string {
  if (!faqAllowed(input)) {
    return `- faq: return [] (an EMPTY array). The owner gave too little of their own text to answer customer questions
  truthfully, and this page must not guess which questions customers ask or what the answers are.
  faqHeading and faqKicker: "" (empty strings).`;
  }
  return `- faq: 0 to 4 items. ONLY questions whose answer is written in the input (the owner's text, the follow-up
  answers, the contact details, the hours, the services they listed). Each answer restates only that.
  If the input does not contain the answer, leave the question out. Never answer with a price, duration,
  policy, guarantee, availability or product detail the input does not state. Fewer than 2 such questions: return [].`;
}

// ─── Mixed-alphabet check ───────────────────────────────────────────────────

const HEB = /\p{Script=Hebrew}/u;
const LAT = /\p{Script=Latin}/u;
const OTHER_LETTER = /(?![\p{Script=Hebrew}\p{Script=Latin}])\p{L}/u;
// Hebrew prefix letters + optional hyphen/maqaf before a Latin brand word: "בGoogle", "ל-Instagram".
const PREFIXED_LATIN = /^[ובלמהשכ]{1,3}[-־]?\p{Script=Latin}[\p{Script=Latin}\p{N}'’.&+]*$/u;

/** The words in `text` that mix alphabets (or use one that has no place on a Hebrew page). */
export function mixedScriptWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,.;:!?()[\]{}"“”„«»…|/\\–—]+/u)) {
    const w = raw.replace(/^[-־'’׳״*]+|[-־'’׳״*]+$/gu, '');
    if (!w) continue;
    if (OTHER_LETTER.test(w)) { out.push(w); continue; }
    if (HEB.test(w) && LAT.test(w) && !PREFIXED_LATIN.test(w)) out.push(w);
  }
  return out;
}

export const hasMixedScript = (text: string | undefined | null): boolean => !!text && mixedScriptWords(text).length > 0;

interface LintableContent {
  faq?: Array<{ question: string; answer: string }>;
  benefits?: Array<{ title: string; description: string }>;
  trust_badges?: Array<{ label: string }>;
}

/**
 * Drops FAQ items, benefits and trust badges with a mixed-alphabet word, and lists every other text
 * field that has one (for the log). Returns a new object; the input is not changed.
 */
export function lintScripts<T extends LintableContent>(content: T): { content: T; dropped: string[]; flagged: string[] } {
  const dropped: string[] = [];
  const flagged: string[] = [];
  const next = { ...content } as T;
  const keep = <I>(key: string, list: I[] | undefined, texts: (i: I) => string[]): I[] | undefined => {
    if (!Array.isArray(list)) return list;
    return list.filter((item, idx) => {
      const bad = texts(item).some((t) => hasMixedScript(t));
      if (bad) dropped.push(`${key}.${idx}`);
      return !bad;
    });
  };
  next.faq = keep('faq', content.faq, (i) => [i.question, i.answer]);
  next.benefits = keep('benefits', content.benefits, (i) => [i.title, i.description]);
  next.trust_badges = keep('trust_badges', content.trust_badges, (i) => [i.label]);

  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > 6) return;
    if (typeof v === 'string') { if (hasMixedScript(v)) flagged.push(path); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}.${i}`, depth + 1)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1);
  };
  // Prompts, image words and colours are not page copy.
  const SKIP = new Set(['faq', 'benefits', 'trust_badges', 'design_system', 'design_hints', 'color_palette', 'design_tokens', 'layout_composition', 'page_strategy', 'hidden_sections', 'typography_pairing']);
  for (const [k, v] of Object.entries(next as unknown as Record<string, unknown>)) {
    if (SKIP.has(k)) continue;
    if (k === 'hero' && v && typeof v === 'object') {
      const { hero_image_prompt: _p, ...rest } = v as Record<string, unknown>;
      walk(rest, 'hero', 1);
      continue;
    }
    if ((k === 'services_or_benefits' || k === 'services') && Array.isArray(v)) {
      v.forEach((s, i) => { if (s && typeof s === 'object') { const o = s as Record<string, unknown>; walk({ title: o.title, description: o.description }, `${k}.${i}`, 1); } });
      continue;
    }
    walk(v, k, 0);
  }
  return { content: next, dropped, flagged };
}

/** The FAQ gate, applied in code after generation: too little owner text = no FAQ section at all. */
export function enforceFaqGate<T extends { faq?: unknown[]; faq_heading?: string; faq_kicker?: string; layout_composition?: string[] }>(
  content: T, input: OwnerTextInput,
): T {
  if (faqAllowed(input)) return content;
  return {
    ...content,
    faq: [],
    faq_heading: undefined,
    faq_kicker: undefined,
    layout_composition: content.layout_composition?.filter((b) => b !== 'faq_accordion'),
  };
}
