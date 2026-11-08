// Pure Business-Audit logic (Stage 5.5.2, v2) — no I/O, so it is trivially testable.
//
// v2 (Moshe, 2026-10-23): the score is RELATIVE — it compares the business to its top
// local competitors (same primary type, ~5 km) — and it covers EVERY parameter we check
// v2.1: the bar is the TOP 3 most-reviewed competitors (what it takes to reach the map's
// top three), not the median — the median made a below-average profile look "strong".
// v2.2 (#22, Moshe): a target a small business can actually reach. The FIRST target is the
// regional median; a business already at/above the median is aimed at the highest in the area.
// Both numbers are always shown as facts ("חציון באזור: X. הגבוה ביותר: Y").
// and offer an upgrade for. Every item also says plainly who does what:
//   weDo  — what the product does for the customer (with an honest availability flag)
//   youDo — what the customer has to do themselves
//
// Known data limits (Places API, not our choice):
//   • `photos` holds at most 10 entries → the photo count is a lower bound ("10+") and
//     cannot be benchmarked; the real count needs the GBP API (pending, case 7-2629000042147).
//   • With fewer than MIN_COMPETITORS usable competitors we fall back to fixed targets
//     and say so (benchmark === null).

/** Fixed targets, used only when no local benchmark could be built. */
export const FALLBACK_TARGETS = { rating: 4.5, reviews: 50 } as const;
export const PHOTO_GOAL = 100; // product goal; measurable only once the GBP API is approved
export const PLACES_PHOTO_CAP = 10; // Places returns at most this many photo references
export const MIN_COMPETITORS = 3;
/** How many leading competitors set the bar. */
export const TOP_N = 3;

export interface PlaceSnapshot {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  regularOpeningHours?: unknown;
  location?: { latitude?: number; longitude?: number };
  photos?: unknown[];
}

export interface CompetitorSnapshot { id: string; rating?: number; userRatingCount?: number }

/** A nearby business found for the category check. Only what the comparison needs; never stored. */
export interface CategoryPeer { id: string; userRatingCount?: number; primaryType?: string; primaryTypeDisplayName?: { text?: string } }

export interface CategoryComparison {
  /** same → our primary category equals the leaders'; different → it does not. */
  status: 'same' | 'different';
  ours: string;
  theirs: string;
  line: string;
}

export interface Benchmark {
  /** Usable competitors the numbers are based on. */
  count: number;
  medianRating: number;
  medianReviews: number;
  /** Reviews of the TOP_N-th most-reviewed competitor: the bar to join the top three. */
  topReviews: number;
  /** The most reviews any usable competitor in the area has. Always shown as a fact. */
  maxReviews: number;
  /** Targets this business is measured against. */
  ratingTarget: number;
  /**
   * Reviews target for THIS business. buildBenchmark sets it to the regional median (the first
   * target); buildAudit raises it to `maxReviews` once the business is at or above the median.
   */
  reviewsTarget: number;
  /** Which of the two `reviewsTarget` is. */
  reviewsTargetKind: 'median' | 'max';
}

export type AuditLevel = 'good' | 'ok' | 'weak';
export type Availability = 'now' | 'soon';

export interface AuditItem {
  key: 'rating' | 'reviews' | 'photos' | 'phone' | 'website' | 'hours' | 'category' | 'status';
  label: string;
  level: AuditLevel;
  /** Short value for display, e.g. "4.6 ★" or "10+". */
  value: string;
  /** One-sentence finding with numbers, empty when nothing to improve. */
  tip: string;
  /** What the product does for the customer on this item. */
  weDo: string;
  weDoAvailability: Availability;
  /** What the customer must do themselves (empty when nothing is needed). */
  youDo: string;
}

export interface BusinessAudit {
  placeId: string;
  name: string;
  address: string | null;
  category: string | null;
  mapsUrl: string | null;
  rating: number | null;
  reviewCount: number;
  photoCount: number;
  /** true → photoCount is a lower bound (Places returns ≤10). */
  photosCapped: boolean;
  /** 0–100, relative to local competitors when `benchmark` is set. */
  score: number;
  benchmark: Benchmark | null;
  items: AuditItem[];
  reviewsMissing: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Build the local benchmark from nearby same-type competitors (the business itself excluded). */
export function buildBenchmark(selfId: string, competitors: CompetitorSnapshot[]): Benchmark | null {
  const usable = competitors.filter(
    c => c.id !== selfId && typeof c.rating === 'number' && typeof c.userRatingCount === 'number' && c.userRatingCount > 0,
  );
  if (usable.length < MIN_COMPETITORS) return null;
  const medianRating = median(usable.map(c => c.rating as number));
  const medianReviews = median(usable.map(c => c.userRatingCount as number));
  // The bar comes from the leaders: the TOP_N most-reviewed competitors.
  const leaders = [...usable].sort((x, y) => (y.userRatingCount as number) - (x.userRatingCount as number)).slice(0, TOP_N);
  const topReviews = leaders[leaders.length - 1].userRatingCount as number;
  const maxReviews = leaders[0].userRatingCount as number;
  const leadersRating = median(leaders.map(c => c.rating as number));
  return {
    count: usable.length,
    medianRating: Math.round(medianRating * 10) / 10,
    medianReviews: Math.round(medianReviews),
    topReviews: Math.round(topReviews),
    // Ratings cluster in 4.3–4.8 everywhere; keep the bar meaningful and reachable.
    maxReviews: Math.round(maxReviews),
    ratingTarget: Math.round(Math.max(4.3, Math.min(4.8, leadersRating)) * 10) / 10,
    // First target = the regional median, as displayed (rounded), never below 1.
    reviewsTarget: Math.max(1, Math.round(medianReviews)),
    reviewsTargetKind: 'median',
  };
}

export function buildAudit(place: PlaceSnapshot, benchmark: Benchmark | null = null): BusinessAudit {
  const rating = typeof place.rating === 'number' ? place.rating : null;
  const reviewCount = Math.max(0, Math.floor(place.userRatingCount ?? 0));
  const photoCount = Array.isArray(place.photos) ? Math.min(place.photos.length, PLACES_PHOTO_CAP) : 0;
  const photosCapped = photoCount >= PLACES_PHOTO_CAP;
  const hasPhone = !!place.nationalPhoneNumber;
  const hasWebsite = !!place.websiteUri;
  const hasHours = !!place.regularOpeningHours;
  const hasCategory = !!place.primaryType;
  const operational = !place.businessStatus || place.businessStatus === 'OPERATIONAL';

  const ratingTarget = benchmark?.ratingTarget ?? FALLBACK_TARGETS.rating;
  // Reviews target: the regional median first; at/above the median, the highest in the area.
  // (The displayed, rounded median decides, so what the customer reads matches what we do.)
  const atOrAboveMedian = !!benchmark && reviewCount >= benchmark.reviewsTarget;
  const reviewsTarget = benchmark
    ? (atOrAboveMedian ? Math.max(benchmark.maxReviews, benchmark.reviewsTarget) : benchmark.reviewsTarget)
    : FALLBACK_TARGETS.reviews;
  const reviewsTargetKind: 'median' | 'max' = benchmark && atOrAboveMedian ? 'max' : 'median';
  const reviewsMissing = Math.max(0, reviewsTarget - reviewCount);
  const vs = benchmark ? `העסקים הדומים באזור` : 'יעד כללי';
  const ratingVs = benchmark ? 'שלושת העסקים המובילים באזור' : 'יעד כללי'; // the rating bar still comes from the leaders
  const auditBenchmark: Benchmark | null = benchmark ? { ...benchmark, reviewsTarget, reviewsTargetKind } : null;

  const ratingLevel: AuditLevel =
    rating === null ? 'weak' : rating >= ratingTarget ? 'good' : rating >= ratingTarget - 0.4 ? 'ok' : 'weak';
  // Below the median (or no benchmark): reaching the target is "good", 40% of it "ok".
  // At/above the median: "good" once in the area's top three (or at the highest), otherwise "ok".
  const reviewsLevel: AuditLevel = benchmark && atOrAboveMedian
    ? (reviewCount >= Math.min(benchmark.topReviews, reviewsTarget) ? 'good' : 'ok')
    : reviewCount >= reviewsTarget ? 'good' : reviewCount >= reviewsTarget * 0.4 ? 'ok' : 'weak';
  const reviewsTip = (() => {
    if (!benchmark) return reviewsMissing > 0 ? `חסרות בערך ${reviewsMissing} ביקורות כדי להגיע ל-${reviewsTarget}, ${vs}.` : '';
    const facts = `חציון באזור: ${benchmark.reviewsTarget}. הגבוה ביותר: ${benchmark.maxReviews}.`;
    if (!atOrAboveMedian) return `חסרות בערך ${reviewsMissing} ביקורות כדי להגיע לחציון באזור. ${facts}`;
    return reviewsMissing > 0
      ? `אתם בחציון או מעליו. היעד הבא הוא הגבוה ביותר באזור, וחסרות בערך ${reviewsMissing} ביקורות. ${facts}`
      : '';
  })();
  const photosLevel: AuditLevel = photoCount >= PLACES_PHOTO_CAP ? 'good' : photoCount >= 4 ? 'ok' : 'weak';

  const items: AuditItem[] = [
    {
      key: 'rating',
      label: 'דירוג',
      level: ratingLevel,
      value: rating === null ? 'אין דירוג' : `${rating.toFixed(1)} ★`,
      tip:
        rating === null
          ? 'עדיין אין דירוג לעסק. הביקורת הראשונה היא הצעד הכי חשוב.'
          : rating >= ratingTarget
            ? ''
            : `הדירוג שלכם נמוך מ-${ratingTarget.toFixed(1)}, היעד לפי ${ratingVs}.`,
      weDo: 'נכין לכם בקשות ביקורת מוכנות לשליחה ללקוחות.',
      weDoAvailability: 'soon',
      youDo: rating !== null && rating >= ratingTarget ? '' : 'לתת שירות טוב ולענות לביקורות שליליות בנימוס.',
    },
    {
      key: 'reviews',
      label: 'ביקורות',
      level: reviewsLevel,
      value: String(reviewCount),
      tip: reviewsTip,
      weDo: 'נשלח בקשת ביקורת בוואטסאפ ללקוח, מיד אחרי שהוא מקבל חשבונית.',
      weDoAvailability: 'soon',
      youDo: reviewsMissing > 0 ? 'לחבר את מערכת החשבוניות שלכם (iCount או SUMIT) כשנבקש.' : '',
    },
    {
      key: 'photos',
      label: 'תמונות',
      level: photosLevel,
      value: photosCapped ? `${PLACES_PHOTO_CAP}+` : String(photoCount),
      tip: photosCapped
        ? `יש לפחות ${PLACES_PHOTO_CAP} תמונות. היעד הוא ${PHOTO_GOAL}, והספירה המדויקת תתאפשר לאחר חיבור כרטיס העסק.`
        : `יש רק ${photoCount} תמונות. מומלץ להעלות תמונות אמיתיות מהעבודה בשטח.`,
      weDo: 'נכין לכם רשימת תמונות מומלצות והוראות קצרות להעלאה לכרטיס העסק. ההעלאה עצמה נעשית אצלכם בגוגל.',
      weDoAvailability: 'soon',
      youDo: 'לצלם בסיום כל עבודה ולשלוח לנו את התמונות. עד אז, אפשר להעלות ישירות לכרטיס העסק שלכם בגוגל.',
    },
    {
      key: 'phone',
      label: 'טלפון',
      level: hasPhone ? 'good' : 'weak',
      value: hasPhone ? 'מוגדר' : 'חסר',
      tip: hasPhone ? '' : 'לא מוגדר טלפון בכרטיס העסק, ולקוחות לא יכולים להתקשר ישירות מהמפה.',
      weDo: 'נתריע לכם אם הפרטים בכרטיס העסק חסרים או משתנים.',
      weDoAvailability: 'soon',
      youDo: hasPhone ? '' : 'להוסיף מספר טלפון בכרטיס העסק שלכם בגוגל.',
    },
    {
      key: 'website',
      label: 'אתר',
      level: hasWebsite ? 'good' : 'weak',
      value: hasWebsite ? 'מוגדר' : 'חסר',
      tip: hasWebsite ? '' : 'לא מקושר אתר או דף נחיתה לכרטיס העסק, ולקוחות שרוצים לדעת עוד אין להם לאן להמשיך.',
      weDo: 'נבנה לכם דף נחיתה ב-Pagey, ונתן לכם את הקישור להוספה בכרטיס העסק שלכם בגוגל.',
      weDoAvailability: 'now',
      youDo: hasWebsite ? '' : 'להוסיף את הקישור לדף בכרטיס העסק שלכם בגוגל.',
    },
    {
      key: 'hours',
      label: 'שעות פעילות',
      level: hasHours ? 'good' : 'weak',
      value: hasHours ? 'מוגדרות' : 'חסרות',
      tip: hasHours ? '' : 'לא מוגדרות שעות פעילות, ולקוחות לא יודעים מתי אפשר להגיע או להתקשר.',
      weDo: 'נתריע לכם אם הפרטים בכרטיס העסק חסרים או משתנים.',
      weDoAvailability: 'soon',
      youDo: hasHours ? '' : 'להגדיר שעות פעילות בכרטיס העסק שלכם בגוגל.',
    },
    {
      key: 'category',
      label: 'קטגוריה',
      level: hasCategory ? 'good' : 'weak',
      value: place.primaryTypeDisplayName?.text ?? (hasCategory ? 'מוגדרת' : 'חסרה'),
      tip: hasCategory ? '' : 'לא נבחרה קטגוריה ראשית, והיא מסבירה ללקוחות איזה סוג עסק אתם.',
      weDo: 'נמליץ על הקטגוריה המתאימה ביותר לעסק שלכם.',
      weDoAvailability: 'soon',
      youDo: hasCategory ? '' : 'לבחור קטגוריה ראשית בכרטיס העסק שלכם בגוגל.',
    },
    {
      key: 'status',
      label: 'סטטוס',
      level: operational ? 'good' : 'weak',
      value: operational ? 'פעיל' : 'סגור',
      tip: operational ? '' : 'גוגל מציגה את העסק כסגור.',
      weDo: 'נתריע לכם אם הסטטוס משתנה.',
      weDoAvailability: 'soon',
      youDo: operational ? '' : 'לעדכן את הסטטוס בכרטיס העסק שלכם בגוגל.',
    },
  ];

  // Weights sum to 100. Rating/reviews are relative to the local benchmark; reviews use a
  // square-root scale: review counts are heavy-tailed (a 2,000-review leader must not zero
  // the score of a 60-review business) but a gap to the leaders must still cost points.
  const ratingPart = rating === null ? 0 : clamp01((rating - 3) / (ratingTarget - 3));
  const reviewsPart = clamp01(Math.sqrt(reviewCount / reviewsTarget));
  const score = Math.round(
    25 * ratingPart +
      25 * reviewsPart +
      15 * clamp01(photoCount / PLACES_PHOTO_CAP) +
      10 * (hasWebsite ? 1 : 0) +
      8 * (hasPhone ? 1 : 0) +
      7 * (hasHours ? 1 : 0) +
      5 * (hasCategory ? 1 : 0) +
      5 * (operational ? 1 : 0),
  );

  return {
    placeId: place.id,
    name: place.displayName?.text ?? '',
    address: place.formattedAddress ?? null,
    category: place.primaryTypeDisplayName?.text ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    rating,
    reviewCount,
    photoCount,
    photosCapped,
    score,
    benchmark: auditBenchmark,
    items,
    reviewsMissing,
  };
}

/**
 * "The competitors are defined as X and you as Y." Looks only at the TOP_N most-reviewed
 * same-area businesses that carry our category among their types, and at their PRIMARY category.
 * Any missing piece (our category, too few peers with a category) returns null: the block is skipped.
 * Only a "different" result is ever returned: ≥2 of the leaders share another primary category.
 */
export function compareCategory(
  self: { id: string; primaryType?: string; primaryTypeDisplayName?: { text?: string } },
  peers: CategoryPeer[],
): CategoryComparison | null {
  const ours = self.primaryTypeDisplayName?.text?.trim();
  if (!self.primaryType || !ours) return null;
  const leaders = peers
    .filter(p => p.id !== self.id && p.primaryType && p.primaryTypeDisplayName?.text?.trim() && typeof p.userRatingCount === 'number')
    .sort((a, b) => (b.userRatingCount as number) - (a.userRatingCount as number))
    .slice(0, TOP_N);
  if (leaders.length < 2) return null;
  // #22 ב: say something only when at least TWO of the leaders share one primary category that is
  // NOT ours. A split group, or leaders who match us, show nothing (no "same" line either): a
  // statement from a single outlier would be noise, and "all fine" is not worth a line.
  const tally = new Map<string, { n: number; label: string }>();
  for (const p of leaders) {
    const t = p.primaryType as string;
    const cur = tally.get(t) ?? { n: 0, label: (p.primaryTypeDisplayName?.text as string).trim() };
    cur.n++;
    tally.set(t, cur);
  }
  const shared = [...tally.entries()].find(([t, v]) => v.n >= 2 && t !== self.primaryType);
  if (!shared) return null;
  const theirs = shared[1];
  return {
    status: 'different', ours, theirs: theirs.label,
    line: `המתחרים מוגדרים כ-${theirs.label} ואתם כ-${ours}. כדאי לבדוק שהקטגוריה שלכם מתאימה למה שלקוחות מחפשים.`,
  };
}
