// Pure Business-Audit logic (Stage 5.5.2) — no I/O, so it is trivially testable.
//
// Input is the SUBSET of a Places API (New) place we request (see PLACE_FIELD_MASK in
// places.service.ts). Output is what the dashboard's Audit card renders.
//
// Known data limits (Places API, not our choice):
//   • `photos` holds at most 10 entries → the photo count is a lower bound ("10+").
//     The real count needs the GBP API (pending Google approval, case 7-2629000042147).
//   • reviews are not used here; only rating + userRatingCount.
// The targets below are an initial product assumption, to be tuned with real data.

export const AUDIT_TARGETS = {
  rating: 4.5,
  reviews: 50,
  photos: 100, // product goal; measurable only once the GBP API is approved
} as const;

/** Places returns at most this many photo references per place. */
export const PLACES_PHOTO_CAP = 10;

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
  primaryTypeDisplayName?: { text?: string };
  photos?: unknown[];
}

export type AuditLevel = 'good' | 'ok' | 'weak';

export interface AuditItem {
  key: 'rating' | 'reviews' | 'photos' | 'phone' | 'website' | 'status';
  label: string;
  level: AuditLevel;
  /** Short value for display, e.g. "4.6 ★" or "10+". */
  value: string;
  /** One actionable Hebrew sentence, empty when there is nothing to improve. */
  tip: string;
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
  hasPhone: boolean;
  hasWebsite: boolean;
  operational: boolean;
  /** 0–100. */
  score: number;
  items: AuditItem[];
  targets: typeof AUDIT_TARGETS;
  reviewsMissing: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function buildAudit(place: PlaceSnapshot): BusinessAudit {
  const rating = typeof place.rating === 'number' ? place.rating : null;
  const reviewCount = Math.max(0, Math.floor(place.userRatingCount ?? 0));
  const photoCount = Array.isArray(place.photos) ? Math.min(place.photos.length, PLACES_PHOTO_CAP) : 0;
  const photosCapped = photoCount >= PLACES_PHOTO_CAP;
  const hasPhone = !!place.nationalPhoneNumber;
  const hasWebsite = !!place.websiteUri;
  const operational = !place.businessStatus || place.businessStatus === 'OPERATIONAL';
  const reviewsMissing = Math.max(0, AUDIT_TARGETS.reviews - reviewCount);

  const ratingLevel: AuditLevel =
    rating === null ? 'weak' : rating >= AUDIT_TARGETS.rating ? 'good' : rating >= 4.0 ? 'ok' : 'weak';
  const reviewsLevel: AuditLevel =
    reviewCount >= AUDIT_TARGETS.reviews ? 'good' : reviewCount >= 15 ? 'ok' : 'weak';
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
          : rating >= AUDIT_TARGETS.rating
            ? ''
            : 'כדי לעלות לדירוג של 4.5 ומעלה, כדאי לבקש ביקורת מכל לקוח מרוצה.',
    },
    {
      key: 'reviews',
      label: 'ביקורות',
      level: reviewsLevel,
      value: String(reviewCount),
      tip:
        reviewsMissing > 0
          ? `חסרות בערך ${reviewsMissing} ביקורות כדי להגיע ליעד של ${AUDIT_TARGETS.reviews}.`
          : '',
    },
    {
      key: 'photos',
      label: 'תמונות',
      level: photosLevel,
      value: photosCapped ? `${PLACES_PHOTO_CAP}+` : String(photoCount),
      tip:
        photosCapped
          ? 'יש לפחות 10 תמונות. היעד הוא 100 ומעלה, והספירה המדויקת תתאפשר לאחר חיבור הפרופיל.'
          : `יש רק ${photoCount} תמונות. מומלץ להעלות תמונות אמיתיות מהעבודה בשטח.`,
    },
    {
      key: 'phone',
      label: 'טלפון',
      level: hasPhone ? 'good' : 'weak',
      value: hasPhone ? 'מוגדר' : 'חסר',
      tip: hasPhone ? '' : 'מומלץ להוסיף מספר טלפון לפרופיל, כדי שלקוחות יוכלו להתקשר ישירות מהמפה.',
    },
    {
      key: 'website',
      label: 'אתר',
      level: hasWebsite ? 'good' : 'weak',
      value: hasWebsite ? 'מוגדר' : 'חסר',
      tip: hasWebsite ? '' : 'מומלץ לקשר לפרופיל אתר או דף נחיתה, כדי שגוגל תראה לאן להפנות לקוחות.',
    },
    {
      key: 'status',
      label: 'סטטוס',
      level: operational ? 'good' : 'weak',
      value: operational ? 'פעיל' : 'סגור',
      tip: operational ? '' : 'גוגל מציגה את העסק כסגור. כדאי לעדכן את הפרופיל.',
    },
  ];

  // Weights sum to 100. Photos weigh by what we can see (cap 10).
  const score = Math.round(
    30 * (rating === null ? 0 : clamp01((rating - 3) / (AUDIT_TARGETS.rating - 3))) +
      30 * clamp01(reviewCount / AUDIT_TARGETS.reviews) +
      15 * clamp01(photoCount / PLACES_PHOTO_CAP) +
      10 * (hasPhone ? 1 : 0) +
      10 * (hasWebsite ? 1 : 0) +
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
    hasPhone,
    hasWebsite,
    operational,
    score,
    items,
    targets: AUDIT_TARGETS,
    reviewsMissing,
  };
}
