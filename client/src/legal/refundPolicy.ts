// ─────────────────────────────────────────────────────────────────────────────
// Refund / cancellation policy — the legal research behind it, and the exact
// strings the UI and the ToS both render.
//
// QUESTION (Moshe, 2026-09-06): can Pagey run a NO-refund, NO-cancellation
// policy? The customer builds and sees the COMPLETE page for free, then makes
// one deliberate one-time payment to publish that specific page.
//
// ── CONCLUSION: yes, a no-refund policy is legally supportable here, on two
// independent grounds — provided the exclusion is DISCLOSED and AFFIRMATIVELY
// ACKNOWLEDGED before payment (which is what REFUND_ACK_* below is for).
//
// Ground 1 — the buyer is usually not a "צרכן" at all.
//   חוק הגנת הצרכן, התשמ"א-1981, s.1 defines צרכן as someone who buys goods or
//   receives a service from an עוסק "למטרה שעיקרה אישית, ביתית או משפחתית".
//   Pagey's buyer is a business buying a marketing page FOR ITS BUSINESS. That
//   is not a personal/household/family purpose, so the consumer cancellation
//   regime (s.14ג and תקנות הגנת הצרכן (ביטול עסקה), התשע"א-2010) does not
//   attach in the first place. This is the broader ground but also the softer
//   one — a sole trader buying "for himself" can argue the edges — so it is
//   NOT relied on alone.
//
// Ground 2 (the load-bearing one) — the statutory "מידע" exception.
//   s.14ג(ד) lists the distance-sale transactions the 14-day cancellation
//   right does NOT apply to. One item on that list is, unconditionally:
//       "מידע כהגדרתו בחוק המחשבים, התשנ"ה-1995"
//   Note what is NOT attached to it: unlike the neighbouring item about
//   "טובין הניתנים להקלטה, לשעתוק או לשכפול", the מידע exception carries NO
//   "opened the original packaging" condition and no other precondition. חוק
//   המחשבים defines מידע as data/signs/concepts/instructions expressed in
//   machine-readable form and stored on a computer or storage medium — which is
//   exactly what Pagey delivers: generated Hebrew copy, generated images, and a
//   rendered page served from a server.
//   => The publish purchase (and the page bundles and AI credits, which are the
//      same digital information delivered the same way) falls squarely inside
//      14ג(ד)(3). No cooling-off period applies.
//
// Why NOT to rely on the "service" framing instead: s.14ג(ג)(2) gives a service
// buyer 14 days from the transaction, "ובלבד שביטול כאמור ייעשה לפחות שני ימים
// ... קודם למועד שבו אמור השירות להינתן". For a service performed instantly on
// payment that proviso can never be satisfied, which is a decent argument — but
// it is an argument about a proviso, not a listed exception, and it invites the
// counter-framing that hosting-for-a-year is an ongoing service. The מידע
// exception is cleaner, so the ToS frames the purchase as the supply of digital
// information (with hosting as an incident of it), not as a standalone service.
//
// Fallback if a regulator/court ever rejected both grounds: the exposure is
// bounded and small. s.14ה(ב) caps cancellation fees at the LOWER of 5% of the
// transaction price or ₪100 (₪12.45 on a ₪249 page; ₪100 on a ₪1,490 bundle),
// i.e. worst case Pagey refunds the price minus that cap. That is a
// per-dispute cost, not a systemic one — it does not change the recommendation.
//
// ── What the law still REQUIRES us to do, and what we do about it ────────────
// s.14ג(א) obliges the עוסק to disclose, BEFORE the transaction, the details of
// the consumer's cancellation right. Disclosing that a transaction is not
// cancellable is part of that duty. Israeli law does not (unlike the EU CRD)
// mandate a tick-box that waives the right — but:
//   • burying the exclusion in a ToS page nobody opened is exactly how a
//     no-refund clause gets struck down as a תנאי מקפח in a חוזה אחיד
//     (חוק החוזים האחידים, התשמ"ג-1982), and
//   • an affirmative, timestamped acknowledgment is the single cheapest piece
//     of evidence in a chargeback or a Consumer Protection Authority complaint.
// So we implement a REQUIRED checkbox that blocks the pay button, at every
// paid entry point, rendering REFUND_ACK_PUBLISH / REFUND_ACK_PURCHASE.
//
// Sources consulted (2026-09-06): חוק הגנת הצרכן, התשמ"א-1981 ss.1, 14ג, 14ה;
// תקנות הגנת הצרכן (ביטול עסקה), התשע"א-2010; חוק המחשבים, התשנ"ה-1995 s.1.
// Drafted by a non-lawyer from primary-source reading — the exclusion clause is
// one of the two spots flagged for a paid legal review before launch.
// ─────────────────────────────────────────────────────────────────────────────

/** One-line disclosure shown next to a pay button. Short by design. */
export const REFUND_NOTICE_SHORT =
  'המוצר הוא תוכן דיגיטלי המסופק מיידית. בהתאם לסעיף 14ג(ד) לחוק הגנת הצרכן, העסקה אינה ניתנת לביטול ואינה מזכה בהחזר כספי לאחר האספקה.';

/** Required-checkbox label — publishing a page you already previewed in full. */
export const REFUND_ACK_PUBLISH =
  'ראיתי את הדף המלא לפני התשלום ואני מאשר/ת את פרסומו. ידוע לי שמדובר בתוכן דיגיטלי המסופק מיידית, ושהעסקה אינה ניתנת לביטול ואינה מזכה בהחזר כספי לאחר הפרסום.';

/** Required-checkbox label — buying a bundle / add-on / AI credits up front. */
export const REFUND_ACK_PURCHASE =
  'ידוע לי שמדובר ברכישה חד־פעמית של תוכן ושירותים דיגיטליים המסופקים מיידית, ושהעסקה אינה ניתנת לביטול ואינה מזכה בהחזר כספי לאחר ביצועה.';

/**
 * The refund clause as it appears in the ToS (/terms). Kept here, beside the
 * research it rests on, so the page text and the checkout text can never drift
 * apart — Terms.tsx renders this array verbatim.
 */
export const TERMS_REFUND_CLAUSE: string[] = [
  'המוצר של Pagey הוא תוכן דיגיטלי: תוכן שנכתב ונוצר עבורכם, תמונות שנוצרו עבורכם, ודף שמועלה לרשת ומסופק מיידית עם השלמת התשלום. בטרם התשלום אתם בונים את הדף, רואים אותו במלואו ועורכים אותו ללא כל תשלום — כך שההחלטה לשלם מתקבלת לאחר שראיתם בדיוק מה אתם רוכשים.',
  'בהתאם לסעיף 14ג(ד) לחוק הגנת הצרכן, התשמ"א-1981, זכות הביטול בעסקת מכר מרחוק אינה חלה על "מידע כהגדרתו בחוק המחשבים, התשנ"ה-1995". רכישת פרסום דף, רכישת חבילת דפים, רכישת תוסף הסרת המיתוג ורכישת קרדיטי AI הן רכישות של מידע דיגיטלי מסוג זה. לפיכך, ובכפוף לאמור להלן, העסקאות אינן ניתנות לביטול ואינן מזכות בהחזר כספי לאחר האספקה.',
  'בנוסף, שירותי Pagey מיועדים לעסקים ולעצמאים לצורכי עיסוקם. רכישה שנעשית למטרות עסקיות אינה "עסקה צרכנית" כהגדרתה בחוק הגנת הצרכן, וממילא הוראות הביטול הצרכניות אינן חלות עליה.',
  'לפני כל תשלום מוצגת הודעה על כך שהעסקה אינה ניתנת לביטול, ונדרש אישור מפורש שלכם. ללא אישור זה לא ניתן להשלים את התשלום.',
  'החזר במקרה של תקלה: אם דף ששולם עבורו לא פורסם בפועל בשל תקלה טכנית אצלנו, ולא הצלחנו לתקן אותה בתוך זמן סביר ממועד הפנייה, נזכה אתכם במלוא הסכום ששולם עבור אותו דף או נעניק לכם יתרת פרסום חלופית, לפי בחירתכם. זכות זו אינה גורעת מכל סעד אחר על פי דין.',
  'חיוב כפול או חיוב שגוי יוחזר במלואו לאחר בדיקה, ללא תלות בסעיף זה.',
  'ככל שייקבע על ידי גורם מוסמך כי חלה על עסקה מסוימת זכות ביטול על פי דין, יחולו הוראות הדין, לרבות זכותנו לגבות דמי ביטול בשיעור הנמוך מבין 5% ממחיר העסקה או 100 ש"ח, כאמור בסעיף 14ה(ב) לחוק הגנת הצרכן.',
  'יתרת דפים שנרכשה במסגרת חבילה אינה פגה, אינה ניתנת להעברה לאדם או לחשבון אחר, ואינה ניתנת לפדיון בכסף.',
];
