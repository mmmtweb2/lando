// Which search-phrase pages a business gets (docs/mvp-plan.md, C2). Pure, no I/O.
//
// A phrase page targets one "service in area" search ("תיקון נזילות ברמת גן"). The rule Moshe
// approved (10.11.2026): a page is made only for a service and an area the business really has,
// and only when it has something of its own to say. Many pages that differ by the city name alone
// are what Google calls doorway pages; they get ignored or penalised, and on a shared domain one
// customer's doorway pages hurt every other customer. So:
//   • every phrase comes from the approved business card (never free text);
//   • first one page per service, in the business's main area;
//   • a second area only for a service that has a description of its own, one extra area at most;
//   • 5 pages by default, up to 10 for a business with at least 4 services and 2 areas;
//   • a phrase too close to an existing page is refused.

import type { TruthCard } from './businessTruth';

export const DEFAULT_PAGES = 5;
export const MAX_PAGES = 10;

export interface PhraseIdea { phrase: string; service: string; area: string }

export const pageCap = (c: TruthCard): number => (c.services.length >= 4 && c.areas.length >= 2 ? MAX_PAGES : DEFAULT_PAGES);

/** "ב" + area, the way it is written in Hebrew ("ברמת גן", "בתל אביב-יפו"). */
export const phraseOf = (service: string, area: string): string => `${service.trim()} ב${area.trim()}`.replace(/\s+/g, ' ');

// Words are compared by their first four letters, so singular and plural ("נזילה", "נזילות") count as the same word.
const tokens = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1).map((w) => w.slice(0, 4)));

/** 0..1: how many of the words two phrases share. */
export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export const TOO_SIMILAR = 0.75;
export const tooSimilar = (phrase: string, existing: string[]): boolean => existing.some((e) => similarity(phrase, e) >= TOO_SIMILAR);

/** Every phrase this business may have a page for, best first. */
export function allIdeas(c: TruthCard): PhraseIdea[] {
  const areas = c.areas.length ? c.areas : c.city ? [c.city] : [];
  if (!areas.length) return [];
  const idea = (service: string, area: string): PhraseIdea => ({ phrase: phraseOf(service, area), service, area });
  const first = c.services.map((s) => idea(s.name, areas[0]));
  const second = areas.length > 1 ? c.services.filter((s) => s.description.length >= 20).map((s) => idea(s.name, areas[1])) : [];
  return [...first, ...second].filter((i) => i.phrase.length >= 5 && i.phrase.length <= 80);
}

/**
 * What to offer now: ideas that are not yet pages and are not too close to one, as many as the
 * cap still allows. `existing` are the phrases of the pages the business already has.
 */
export function suggest(c: TruthCard, existing: string[]): { ideas: PhraseIdea[]; cap: number; left: number } {
  const cap = pageCap(c);
  const left = Math.max(0, cap - existing.length);
  const taken = [...existing];
  const ideas: PhraseIdea[] = [];
  for (const i of allIdeas(c)) {
    if (ideas.length >= left) break;
    if (taken.includes(i.phrase) || tooSimilar(i.phrase, taken)) continue;
    ideas.push(i); taken.push(i.phrase);
  }
  return { ideas, cap, left };
}

export type PhraseRefusal = 'not_offered' | 'exists' | 'too_similar' | 'limit';

/** May a page be created for `phrase` now? Returns the idea, or why not. */
export function admit(c: TruthCard, phrase: string, existing: string[]): PhraseIdea | PhraseRefusal {
  const idea = allIdeas(c).find((i) => i.phrase === phrase);
  if (!idea) return 'not_offered';
  if (existing.includes(phrase)) return 'exists';
  if (existing.length >= pageCap(c)) return 'limit';
  if (tooSimilar(phrase, existing)) return 'too_similar';
  return idea;
}
