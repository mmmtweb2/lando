// Pure Business-Audit logic (Stage 5.5.2, v2) — no I/O, so it is trivially testable.
//
// v2 (Moshe, 2026-10-23): the score is RELATIVE — it compares the business to its top
// local competitors (same primary type, ~5 km) — and it covers EVERY parameter we check
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

export interface Benchmark {
  /** Usable competitors the numbers are based on. */
  count: number;
  medianRating: number;
  medianReviews: number;
  /** Targets this business is measured against. */
  ratingTarget: number;
  reviewsTarget: number;
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
  return {
    count: usable.length,
    medianRating: Math.round(medianRating * 10) / 10,
    medianReviews: Math.round(medianReviews),
    // Ratings cluster in 4.3–4.8 everywhere; keep the bar meaningful and reachable.
    ratingTarget: Math.round(Math.max(4.3, Math.min(4.8, medianRating)) * 10) / 10,
    reviewsTarget: Math.max(20, Math.round(medianReviews)),
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
  const reviewsTarget = benchmark?.reviewsTarget ?? FALLBACK_TARGETS.reviews;
  const reviewsMissing = Math.max(0, reviewsTarget - reviewCount);
  const vs = benchmark ? `המתחרים באזור (חציון של ${benchmark.count} עסקים דומים)` : 'יעד כללי';

  const ratingLevel: AuditLevel =
    rating === null ? 'weak' : rating >= ratingTarget ? 'good' : rating >= ratingTarget - 0.4 ? 'ok' : 'weak';
  const reviewsLevel: AuditLevel =
    reviewCount >= reviewsTarget ? 'good' : reviewCount >= reviewsTarget * 0.4 ? 'ok' : 'weak';
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
            : `הדירוג שלכם נמוך מ-${ratingTarget.toFixed(1)}, היעד לפי ${vs}.`,
      weDo: 'נשלח בקשות ביקורת אוטומטיות ללקוחות מרוצים, ונעקוב אחרי הדירוג.',
      weDoAvailability: 'soon',
      youDo: rating !== null && rating >= ratingTarget ? '' : 'לתת שירות טוב ולענות לביקורות שליליות בנימוס.',
    },
    {
      key: 'reviews',
      label: 'ביקורות',
      level: reviewsLevel,
      value: String(reviewCount),
      tip:
        reviewsMissing > 0
          ? `חסרות בערך ${reviewsMissing} ביקורות כדי להגיע ל-${reviewsTarget}, היעד לפי ${vs}.`
          : '',
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
        ? `יש לפחות ${PLACES_PHOTO_CAP} תמונות. היעד הוא ${PHOTO_GOAL}, והספירה המדויקת תתאפשר לאחר חיבור הפרופיל.`
        : `יש רק ${photoCount} תמונות. מומלץ להעלות תמונות אמיתיות מהעבודה בשטח.`,
      weDo: 'נאסוף תמונות שתשלחו לנו בוואטסאפ ונעלה אותן לפרופיל.',
      weDoAvailability: 'soon',
      youDo: 'לצלם בסיום כל עבודה ולשלוח לנו את התמונות. עד אז, אפשר להעלות ישירות לפרופיל בגוגל.',
    },
    {
      key: 'phone',
      label: 'טלפון',
      level: hasPhone ? 'good' : 'weak',
      value: hasPhone ? 'מוגדר' : 'חסר',
      tip: hasPhone ? '' : 'לא מוגדר טלפון בפרופיל, ולקוחות לא יכולים להתקשר ישירות מהמפה.',
      weDo: 'נעקוב ונתריע אם הפרטים בפרופיל חסרים או משתנים.',
      weDoAvailability: 'soon',
      youDo: hasPhone ? '' : 'להוסיף מספר טלפון בפרופיל העסק בגוגל.',
    },
    {
      key: 'website',
      label: 'אתר',
      level: hasWebsite ? 'good' : 'weak',
      value: hasWebsite ? 'מוגדר' : 'חסר',
      tip: hasWebsite ? '' : 'לא מקושר אתר או דף נחיתה לפרופיל, וגוגל לא יודעת לאן להפנות לקוחות.',
      weDo: 'נבנה לכם דף נחיתה ב-Pagey ממוקד בגוגל, ונודיע על הקישור שכדאי לשים בפרופיל.',
      weDoAvailability: 'now',
      youDo: hasWebsite ? '' : 'להוסיף את הקישור לדף בפרופיל העסק בגוגל.',
    },
    {
      key: 'hours',
      label: 'שעות פעילות',
      level: hasHours ? 'good' : 'weak',
      value: hasHours ? 'מוגדרות' : 'חסרות',
      tip: hasHours ? '' : 'לא מוגדרות שעות פעילות. עסקים בלי שעות מוצגים פחות.',
      weDo: 'נעקוב ונתריע אם הפרטים בפרופיל חסרים או משתנים.',
      weDoAvailability: 'soon',
      youDo: hasHours ? '' : 'להגדיר שעות פעילות בפרופיל העסק בגוגל.',
    },
    {
      key: 'category',
      label: 'קטגוריה',
      level: hasCategory ? 'good' : 'weak',
      value: place.primaryTypeDisplayName?.text ?? (hasCategory ? 'מוגדרת' : 'חסרה'),
      tip: hasCategory ? '' : 'לא נבחרה קטגוריה ראשית, והיא קובעת באילו חיפושים העסק יופיע.',
      weDo: 'נמליץ על הקטגוריה המתאימה ביותר לעסק שלכם.',
      weDoAvailability: 'soon',
      youDo: hasCategory ? '' : 'לבחור קטגוריה ראשית בפרופיל העסק בגוגל.',
    },
    {
      key: 'status',
      label: 'סטטוס',
      level: operational ? 'good' : 'weak',
      value: operational ? 'פעיל' : 'סגור',
      tip: operational ? '' : 'גוגל מציגה את העסק כסגור.',
      weDo: 'נתריע אם הסטטוס משתנה.',
      weDoAvailability: 'soon',
      youDo: operational ? '' : 'לעדכן את הסטטוס בפרופיל העסק בגוגל.',
    },
  ];

  // Weights sum to 100. Rating/reviews are relative to the local benchmark; reviews use a
  // log scale because review counts are heavy-tailed (1,000 vs 50 must not zero the score).
  const ratingPart = rating === null ? 0 : clamp01((rating - 3) / (ratingTarget - 3));
  const reviewsPart = clamp01(Math.log1p(reviewCount) / Math.log1p(reviewsTarget));
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
    benchmark,
    items,
    reviewsMissing,
  };
}
