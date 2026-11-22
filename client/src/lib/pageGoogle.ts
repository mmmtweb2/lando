// The Google part of a landing page on the client (README part 143): the business card's practical details
// and the Google reviews, as GET /api/landing/:slug hands them over in `google`. Pure, no React, so
// scripts/test-page-gbp-integration.ts can pin it. The server side is src/services/pageGoogle.ts.
import type { PageStrings } from '../i18n/pageStrings';

export type Day = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
export const DAYS: Day[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

export interface FactAttr { id: string; label: string }
export interface PageFacts { phone: string; address: string; hours: Array<{ day: Day; open: string; close: string }>; areas: string[]; parking: FactAttr[]; accessibility: FactAttr[] }
export interface PageReview { name: string | null; rating: number; date: string; text: string }
export interface PageReviews { rating: number; count: number; items: PageReview[]; mapsUrl: string | null; fetchedAt: string }
export interface PageGoogle { linked?: boolean; facts: PageFacts | null; reviews: PageReviews | null }

/** The section id of the owner's quiet switch (ai_content.hidden_sections); same as the server's REVIEWS_SECTION_ID. */
export const REVIEWS_SECTION_ID = 'google_reviews';

/** Opening hours as lines, consecutive days with the same hours joined ("א׳-ה׳ 09:00-19:00"). Same rule as the server's hoursLines. */
export function formatHours(hours: PageFacts['hours'], days: readonly string[]): string {
  const spanOf = (i: number) => hours.filter((h) => h.day === DAYS[i]).map((h) => `${h.open}-${h.close}`).join(', ');
  const lines: string[] = [];
  let i = 0;
  while (i < 7) {
    const s = spanOf(i);
    if (!s) { i++; continue; }
    let j = i;
    while (j + 1 < 7 && spanOf(j + 1) === s) j++;
    lines.push(`${j > i ? `${days[i]}-${days[j]}` : days[i]} ${s}`);
    i = j + 1;
  }
  return lines.join('\n');
}

/** Accessibility / parking words in the page language: Google's Hebrew name on a Hebrew page, our fixed words otherwise (unknown ones are left out). */
export function attrText(list: FactAttr[], lang: string, t: Pick<PageStrings, 'attrs'>): string {
  const words = list.map((a) => (lang === 'he' ? a.label || t.attrs[a.id] || '' : t.attrs[a.id] || '')).filter(Boolean);
  return [...new Set(words)].join(', ');
}

export interface Practical { phone: string; address: string; hours: string; areas: string; parking: string; accessibility: string }

/**
 * The page's practical details: the business card's when the page is linked to the Google listing and the card
 * has a value, the page's own text otherwise. One source each: what is in Google (or our dashboard) is what the
 * page says.
 */
export function practicalDetails(own: Practical, facts: PageFacts | null | undefined, lang: string, t: Pick<PageStrings, 'attrs' | 'days'>): Practical & { fromCard: Array<keyof Practical> } {
  if (!facts) return { ...own, fromCard: [] };
  const out: Practical & { fromCard: Array<keyof Practical> } = { ...own, fromCard: [] };
  const take = (k: keyof Practical, v: string) => { if (v) { out[k] = v; out.fromCard.push(k); } };
  take('phone', facts.phone);
  take('address', facts.address);
  take('hours', facts.hours.length ? formatHours(facts.hours, t.days) : '');
  take('areas', [...new Set(facts.areas)].join(', '));
  take('parking', attrText(facts.parking, lang, t));
  take('accessibility', attrText(facts.accessibility, lang, t));
  return out;
}

/** "14 בנובמבר 2026" in the page language. */
export function reviewDate(iso: string, locale: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return iso.slice(0, 10); }
}

/** Reads `google` from the page JSON defensively; anything malformed is dropped. */
export function readPageGoogle(v: unknown): PageGoogle | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  const attrs = (x: unknown): FactAttr[] => (Array.isArray(x) ? x.filter((a) => a && typeof a.id === 'string').map((a) => ({ id: a.id, label: str(a.label) })) : []);
  const f = o.facts && typeof o.facts === 'object' ? o.facts as Record<string, unknown> : null;
  const facts: PageFacts | null = f ? {
    phone: str(f.phone), address: str(f.address),
    areas: Array.isArray(f.areas) ? f.areas.filter((a): a is string => typeof a === 'string' && !!a) : [],
    hours: Array.isArray(f.hours) ? f.hours.filter((h) => h && DAYS.includes(h.day) && /^\d\d:\d\d$/.test(h.open) && /^\d\d:\d\d$/.test(h.close)) : [],
    parking: attrs(f.parking), accessibility: attrs(f.accessibility),
  } : null;
  const r = o.reviews && typeof o.reviews === 'object' ? o.reviews as Record<string, unknown> : null;
  const items = r && Array.isArray(r.items) ? r.items.filter((x) => x && typeof x.text === 'string' && x.text && typeof x.rating === 'number').map((x) => ({
    name: typeof x.name === 'string' && x.name ? x.name : null, rating: Math.max(1, Math.min(5, Math.round(x.rating))), date: str(x.date), text: x.text as string,
  })) : [];
  const reviews: PageReviews | null = r && typeof r.rating === 'number' && typeof r.count === 'number' && items.length ? {
    rating: r.rating, count: r.count, items, mapsUrl: /^https:\/\//.test(str(r.mapsUrl)) ? str(r.mapsUrl) : null, fetchedAt: str(r.fetchedAt),
  } : null;
  return { ...(typeof o.linked === 'boolean' ? { linked: o.linked } : {}), facts, reviews };
}
