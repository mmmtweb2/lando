// The small quality hints under the owner's own description and services ("התיאור קצר מדי", "חסר האזור").
// A mirror of the part of src/services/businessPolish.ts (checkDescription / checkServices) that needs no
// card facts beyond the areas; scripts/test-ai-business-polish.ts compares the two on the same texts.
// Hints only: nothing here blocks a save, except what Google refuses anyway (links, phone numbers, length).
import type { ServiceItem } from './profileTypes';

export type HintCode = 'too_short' | 'too_long' | 'url' | 'email' | 'phone' | 'caps' | 'no_area' | 'dup' | 'name_long' | 'desc_long' | 'desc_missing';
export interface Hint { code: HintCode; level: 'error' | 'warn'; index?: number }

export const DESC_MAX = 750;
export const DESC_SHORT = 150;
const SERVICE_DESC_MAX = 120;

const URL_RE = /https?:\/\/|www\./i;
const BARE_DOMAIN = /\b[a-z0-9-]{2,}\.(?:co\.il|org\.il|net\.il|com|net|org|io|il|me|info|biz|app|shop|store|site|online|xyz|link|ly|co)\b/i;
const EMAIL_RE = /\S+@\S+\.\S+/;
const PHONE_RE = /(?:\+?\d[\d\s()-]{7,}\d)|(?:\*\d{3,5}(?!\d))/;
const CAPS_RE = /\b[A-Z]{4,}\b/;

export function normalizeText(s: string): string {
  return (s ?? '').normalize('NFC').replace(/[֑-ׇ]/g, '').replace(/[“”״″]/g, '"').replace(/[‘’׳′]/g, "'")
    .replace(/\/(?:ת|ה|ית)(?![א-ת])/g, '').replace(/\((?:ת|ה)\)/g, '').toLowerCase();
}
const tokenize = (s: string): string[] => normalizeText(s).match(/[א-ת]+(?:["'][א-ת]+)*|[a-z]+/g) ?? [];

export function mentionsArea(text: string, areas: string[]): boolean {
  const norm = normalizeText(text);
  return areas.some((a) => { const na = normalizeText(a).trim(); return na.length >= 2 && norm.includes(na); });
}

/** What Google would refuse, and what makes a description weaker. `areas`: where the business works. */
export function descriptionHints(text: string, areas: string[]): Hint[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  const out: Hint[] = [];
  if (t.length > DESC_MAX) out.push({ code: 'too_long', level: 'error' });
  if (URL_RE.test(t) || BARE_DOMAIN.test(t)) out.push({ code: 'url', level: 'error' });
  if (EMAIL_RE.test(t)) out.push({ code: 'email', level: 'error' });
  if (PHONE_RE.test(t)) out.push({ code: 'phone', level: 'error' });
  if (CAPS_RE.test(t)) out.push({ code: 'caps', level: 'warn' });
  if (t.length < DESC_SHORT) out.push({ code: 'too_short', level: 'warn' });
  if (areas.length && !mentionsArea(t, areas)) out.push({ code: 'no_area', level: 'warn' });
  return out;
}

const STOP = new Set(['של', 'את', 'עם', 'על', 'גם', 'כל', 'או', 'אנחנו', 'אתם', 'לכם', 'שלנו', 'שלכם', 'אשר', 'הוא', 'היא', 'הם', 'זה', 'זו', 'בין', 'כמו', 'יותר', 'אצלנו', 'לנו', 'אנו', 'וגם', 'רק', 'לא', 'כן', 'מה', 'אם', 'כי', 'עד', 'אל', 'and', 'the', 'for', 'with']);

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

export function nearDuplicate(a: string, b: string): boolean {
  const ka = serviceKey(a), kb = serviceKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return Math.min(ka.length, kb.length) >= 5 && levenshtein(ka, kb) <= 1;
}

export function servicesHints(list: ServiceItem[]): Hint[] {
  const out: Hint[] = [];
  list.forEach((s, index) => {
    const name = s.name.trim(), desc = s.description.trim();
    if (name.split(/\s+/).length > 5 || name.length > 40) out.push({ code: 'name_long', level: 'warn', index });
    if (desc.length > SERVICE_DESC_MAX) out.push({ code: 'desc_long', level: 'warn', index });
    for (let j = 0; j < index; j++) if (nearDuplicate(list[j].name, name)) { out.push({ code: 'dup', level: 'warn', index }); break; }
  });
  // Many owners list services without a word about them: one quiet hint for the whole list.
  if (list.length && list.some((s) => !s.description.trim())) out.push({ code: 'desc_missing', level: 'warn' });
  return out;
}
