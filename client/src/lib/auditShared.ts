// Types and score styling shared by the Audit card, its snapshot image and the public page.

export type Level = 'good' | 'ok' | 'weak';
export interface AuditItem {
  key: string; label: string; level: Level; value: string; tip: string;
  weDo: string; weDoAvailability: 'now' | 'soon'; youDo: string;
}
export interface Benchmark {
  count: number; medianRating: number; medianReviews: number;
  topReviews: number; ratingTarget: number; reviewsTarget: number;
}
export interface Audit {
  placeId: string; name: string; address: string | null; category: string | null;
  mapsUrl: string | null; rating: number | null; reviewCount: number;
  score: number; items: AuditItem[]; photosCapped: boolean; benchmark: Benchmark | null;
}

export const LEVEL_STYLE: Record<Level, { dot: string; text: string }> = {
  good: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  ok: { dot: 'bg-amber-500', text: 'text-amber-700' },
  weak: { dot: 'bg-rose-500', text: 'text-rose-700' },
};

// "Strong" is reserved for a profile with a high score AND nothing left to improve: a
// 5.0 with fewer reviews than the local leaders is good, not strong.
export function scoreStyle(score: number, hasGaps: boolean): { ring: string; label: string; color: string } {
  if (score >= 90 && !hasGaps) return { ring: 'border-emerald-500 text-emerald-700', label: 'פרופיל חזק', color: '#059669' };
  if (score >= 75) return { ring: 'border-emerald-500 text-emerald-700', label: 'פרופיל טוב, יש עוד מה לחזק', color: '#059669' };
  if (score >= 45) return { ring: 'border-amber-500 text-amber-700', label: 'יש פוטנציאל לשיפור', color: '#d97706' };
  return { ring: 'border-rose-500 text-rose-700', label: 'יש הרבה מה לחזק', color: '#e11d48' };
}

/** Numeric values like "10+" must keep their order inside an RTL page ("+10" otherwise). */
export const isNumericValue = (v: string): boolean => /^[\d.+★\s]+$/.test(v);
