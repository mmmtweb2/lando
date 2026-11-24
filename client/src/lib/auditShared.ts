// Types and score styling shared by the Audit card, its snapshot image and the public page.

export type Level = 'good' | 'ok' | 'weak';
export interface AuditItem {
  key: string; label: string; level: Level; value: string; tip: string;
  weDo: string; weDoAvailability: 'now' | 'soon'; youDo: string;
}
export interface Benchmark {
  count: number; medianRating: number; medianReviews: number;
  topReviews: number; ratingTarget: number; reviewsTarget: number;
  /** #22: the highest review count in the area (always shown), and whether `reviewsTarget` is the median or that maximum. */
  maxReviews?: number; reviewsTargetKind?: 'median' | 'max';
  /** QA 24.11: the most-reviewed nearby businesses by name (public Google Maps data, never stored). */
  leaders?: { name: string; rating: number; reviews: number }[];
}
export interface Audit {
  placeId: string; name: string; address: string | null; category: string | null;
  mapsUrl: string | null; rating: number | null; reviewCount: number;
  score: number; items: AuditItem[]; photosCapped: boolean; benchmark: Benchmark | null;
}

export interface ReadinessCheck {
  key: string; label: string; state: 'pass' | 'fail' | 'unknown'; detail: string; fix: string;
}
export interface AiReadiness { status: 'ok' | 'no_website' | 'unreachable'; host: string | null; checks: ReadinessCheck[] }
export interface CategoryCheck { status: 'same' | 'different'; ours: string; theirs: string; line: string }

export const LEVEL_STYLE: Record<Level, { dot: string; text: string }> = {
  good: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  ok: { dot: 'bg-amber-500', text: 'text-amber-700' },
  weak: { dot: 'bg-rose-500', text: 'text-rose-700' },
};

// "Strong" is reserved for a business card with a high score AND nothing left to improve: a
// 5.0 with fewer reviews than the local leaders is good, not strong.
export function scoreStyle(score: number, hasGaps: boolean): { ring: string; label: string; color: string } {
  if (score >= 90 && !hasGaps) return { ring: 'border-emerald-500 text-emerald-700', label: 'כרטיס עסק חזק', color: '#059669' };
  if (score >= 75) return { ring: 'border-emerald-500 text-emerald-700', label: 'כרטיס עסק טוב, יש עוד מה לחזק', color: '#059669' };
  if (score >= 45) return { ring: 'border-amber-500 text-amber-700', label: 'יש פוטנציאל לשיפור', color: '#d97706' };
  return { ring: 'border-rose-500 text-rose-700', label: 'יש הרבה מה לחזק', color: '#e11d48' };
}

/** Numeric values like "10+" must keep their order inside an RTL page ("+10" otherwise). */
export const isNumericValue = (v: string): boolean => /^[\d.+★\s]+$/.test(v);

/** Points each item is worth in the score (they sum to 100; mirrors src/services/placesAudit.ts). */
export const WEIGHT: Record<string, number> = { reviews: 25, rating: 25, photos: 15, website: 10, phone: 8, hours: 7, category: 5, status: 5 };

/** Fixed targets used when no local benchmark exists (mirrors FALLBACK_TARGETS on the server). */
export const FALLBACK_TARGETS = { rating: 4.5, reviews: 50 } as const;

const BASIC = ['phone', 'website', 'hours', 'category', 'photos'] as const;

export interface SparseExplainer { title: string; text: string; gains: { key: string; label: string; points: number }[] }

/**
 * QA 24.11: a near-empty listing scored 5/100 with no explanation. The score is right (there is
 * almost nothing on the listing to score), but it must say WHY and what each missing detail is worth,
 * so a low number reads as a to-do list and not as a verdict on the business. null = not sparse.
 */
export function sparseExplainer(a: Pick<Audit, 'score' | 'items' | 'reviewCount'>): SparseExplainer | null {
  const missing = a.items.filter((i) => (BASIC as readonly string[]).includes(i.key) && i.level === 'weak');
  if (a.score >= 40 || missing.length < 3) return null;
  const gains = missing.map((i) => ({ key: i.key, label: i.label, points: WEIGHT[i.key] ?? 0 }));
  if (a.reviewCount === 0) gains.unshift({ key: 'reviews', label: 'ביקורות ודירוג', points: WEIGHT.reviews + WEIGHT.rating });
  gains.sort((x, y) => y.points - x.points);
  return {
    title: 'למה הציון נמוך כל כך?',
    text: 'בכרטיס העסק בגוגל חסרים כמעט כל הפרטים הבסיסיים, ולכן אין לנו הרבה מה למדוד. הציון לא אומר שהעסק לא טוב. כל פרט שתוסיפו בגוגל מעלה אותו, עד:',
    gains,
  };
}

/** The comparison line when no local benchmark could be built: says why (QA 24.11). */
export function benchmarkNote(a: Pick<Audit, 'items'>): string {
  const t = `דירוג ${FALLBACK_TARGETS.rating} ו-${FALLBACK_TARGETS.reviews} ביקורות`;
  const noCategory = a.items.some((i) => i.key === 'category' && i.level === 'weak');
  return noCategory
    ? `בכרטיס אין קטגוריה ראשית, ולכן לא יכולנו למצוא עסקים דומים באזור להשוואה. עד שתוגדר קטגוריה, הציון נמדד מול יעדים כלליים (${t}).`
    : `לא מצאנו מספיק עסקים דומים באזור להשוואה, ולכן הציון נמדד מול יעדים כלליים (${t}).`;
}

export interface ScoreExplainer {
  /** Short heading, as a question the customer is likely asking. */
  title: string;
  text: string;
  /** True when the business is at/above the median and so is measured against the highest in the area. */
  vsHighest: boolean;
}

/**
 * Plain-language note shown right next to the score (task #32). Since #22 a business at or above the
 * regional median is measured against the HIGHEST review count in the area, so its score can drop a
 * little compared with a measurement against the median. Without this note that looks like the
 * card got worse. States facts only: no ranking promise, nothing about Google's own ranking.
 * Returns null when there is no local benchmark (the card already says general targets are used).
 */
export function scoreExplainer(a: Pick<Audit, 'reviewCount' | 'benchmark'>): ScoreExplainer | null {
  const b = a.benchmark;
  if (!b || b.maxReviews === undefined) return null;
  const median = b.reviewsTargetKind === 'max' ? b.medianReviews : b.reviewsTarget;
  if (b.reviewsTargetKind === 'max') {
    const gap = Math.max(0, b.maxReviews - a.reviewCount);
    const gapText = gap > 0 ? ` כדי להגיע אליו חסרות בערך ${gap} ביקורות.` : ' כבר הגעתם אליו.';
    return {
      vsHighest: true,
      title: 'למה הציון נמדד מול הגבוה ביותר?',
      text: `יש לכם ${a.reviewCount} ביקורות, כלומר אתם בחציון באזור (${median}) או מעליו. לכן אנחנו מודדים אתכם מול העסק עם הכי הרבה ביקורות באזור (${b.maxReviews}).${gapText} אם הציון נמוך מעט ממה שהיה, זה לא אומר שהכרטיס נפגע: היעד פשוט עלה, כי אתם כבר בחציון או מעליו.`,
    };
  }
  return {
    vsHighest: false,
    title: 'מול מה הציון נמדד?',
    text: `הציון נמדד מול החציון באזור (${b.reviewsTarget} ביקורות). כשתגיעו אליו, נמדוד אתכם מול הגבוה ביותר באזור (${b.maxReviews}).`,
  };
}
