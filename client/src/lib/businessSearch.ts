// Pure logic of the business search (onboarding "חיבור כרטיס", the profile connection and the free
// /audit check). No React, no I/O, so scripts/test-qa-onboarding.ts can test it directly.
// QA 24.11: an invented name returned three unrelated bakeries with nothing saying they do not match,
// and an empty result showed nothing at all. Every suggestion now carries how well its NAME matches
// what was typed, and the screen state is derived from one place.

export interface Suggestion { placeId: string; name: string; details: string }

/** strong = the name holds what was typed; partial = some of it; none = only the area (or nothing) matches. */
export type Relevance = 'strong' | 'partial' | 'none';
export interface RankedSuggestion extends Suggestion { relevance: Relevance; score: number }

/** Longest search text we accept (the field stops there and says so). Google cuts at 120 anyway. */
export const MAX_QUERY_LEN = 100;
export const MIN_QUERY_LEN = 2;

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** Lower case, no niqqud/geresh/quotes/punctuation, Hebrew final letters folded. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')            // niqqud and cantillation
    .replace(/[״׳"'`’]/g, '')                   // quotes inside names (מסעדת ג'ו, בע"מ)
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const words = (s: string) => normalize(s).split(' ').filter(Boolean);
/** One-letter Hebrew prefixes (ה, ו, ב, ל, מ, ש, כ) that do not change the word. */
const stripPrefix = (w: string) => (w.length > 3 && /^[הובלמשכ]/.test(w) ? w.slice(1) : w);

function wordMatches(token: string, w: string): boolean {
  if (w === token || stripPrefix(w) === token || w === stripPrefix(token)) return true;
  // A word still being typed ("מאפי" → "מאפייה"): a prefix of at least 3 letters counts.
  return token.length >= 3 && (w.startsWith(token) || stripPrefix(w).startsWith(token));
}

/**
 * How well one suggestion matches the query. Tokens found in the NAME count fully; tokens found only
 * in the address line (usually the city) count half, so "מאפייה כלשהי, חיפה" does not match every
 * bakery in Haifa. At least one name token is needed for anything better than "none".
 */
export function relevance(query: string, s: Pick<Suggestion, 'name' | 'details'>): { relevance: Relevance; score: number } {
  const tokens = [...new Set(words(query).filter((t) => t.length >= 2))];
  if (tokens.length === 0) return { relevance: 'none', score: 0 };
  const nameWords = words(s.name);
  const detailWords = words(s.details);
  let inName = 0, inDetails = 0;
  for (const t of tokens) {
    if (nameWords.some((w) => wordMatches(t, w))) inName++;
    else if (detailWords.some((w) => wordMatches(t, w))) inDetails++;
  }
  // Area tokens are not part of the name, so a full name match plus the city still scores 1.
  const nameTokens = tokens.length - inDetails;
  const score = nameTokens > 0 ? inName / nameTokens : 0;
  const rounded = Math.round(score * 100) / 100;
  if (inName === 0) return { relevance: 'none', score: rounded };
  if (score >= 0.75) return { relevance: 'strong', score: rounded };
  if (score >= 0.4) return { relevance: 'partial', score: rounded };
  return { relevance: 'none', score: rounded };
}

/** Suggestions with their relevance, best name match first (Google's order kept within a tier). */
export function rankSuggestions(query: string, list: Suggestion[]): RankedSuggestion[] {
  const order: Record<Relevance, number> = { strong: 0, partial: 1, none: 2 };
  return list
    .map((s, i) => ({ ...s, ...relevance(query, s), i }))
    .sort((a, b) => order[a.relevance] - order[b.relevance] || a.i - b.i)
    .map(({ i: _i, ...s }) => s);
}

export const RELEVANCE_LABEL: Record<Relevance, string> = {
  strong: 'השם תואם',
  partial: 'השם תואם בחלקו',
  none: 'שם אחר ממה שחיפשתם',
};

export type SearchStatus = 'idle' | 'searching' | 'results' | 'empty' | 'error';

/** What the results area shows. One function, so the screens cannot disagree. */
export interface SearchView {
  status: SearchStatus;
  /** Heading above the list (results) or the empty-state title. */
  title: string;
  /** No result matches the name: the list is "similar businesses", said plainly. */
  noneMatch: boolean;
}

export function searchView(p: { query: string; searching: boolean; error: string | null; results: RankedSuggestion[] | null }): SearchView {
  const q = p.query.trim();
  if (q.length < MIN_QUERY_LEN) return { status: 'idle', title: '', noneMatch: false };
  if (p.searching) return { status: 'searching', title: 'מחפשים…', noneMatch: false };
  if (p.error) return { status: 'error', title: p.error, noneMatch: false };
  if (p.results === null) return { status: 'idle', title: '', noneMatch: false };
  if (p.results.length === 0) return { status: 'empty', title: 'לא נמצאו עסקים בשם הזה', noneMatch: false };
  const noneMatch = p.results.every((r) => r.relevance === 'none');
  return {
    status: 'results',
    noneMatch,
    title: noneMatch
      ? 'לא מצאנו עסק בשם הזה. אלה עסקים אחרים שגוגל מצאה, כנראה לא העסק שלכם:'
      : `נמצאו ${p.results.length} עסקים. בחרו את העסק שלכם:`,
  };
}

/** Tips shown when nothing (or nothing matching) was found. */
export const NO_RESULT_TIPS = [
  'כתבו את השם כפי שהוא מופיע בגוגל מפות, ואחריו את העיר.',
  'נסו שם קצר יותר, בלי סוג העסק (למשל "דוד" במקום "קייטרינג דוד בע״מ").',
  'בדקו את האיות, או נסו לכתוב את השם באנגלית.',
];

/** Search-field feedback: null = fine. `submitted` = the visitor pressed Enter / the search button. */
export function queryError(q: string, submitted: boolean): string | null {
  const t = q.trim();
  if (q.length > MAX_QUERY_LEN) return `אפשר להזין עד ${MAX_QUERY_LEN} תווים. כתבו רק את שם העסק והעיר.`;
  if (submitted && t.length === 0) return 'הקלידו את שם העסק והעיר.';
  if (submitted && t.length < MIN_QUERY_LEN) return 'הקלידו לפחות 2 תווים.';
  return null;
}

/** Google Maps link for one place (opens the public listing). */
export const mapsLink = (placeId: string) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
