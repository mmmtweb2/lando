// "מה מקדם עסק בגוגל": the small collapsible explainer on the dashboard home (task #18).
//
// Open the first time this account sees it, collapsed afterwards. The only state is one flag in this
// browser; it is a convenience (like the skip list), not a fact about the business, so no table.
//
// The wording below is David's text, approved by Avi. LEGAL REVIEW (Moshe) is still pending on the
// sentence that says one cannot pay Google for a better ranking: it paraphrases Google's own help
// page, which is why the source line sits right under the text. Change the wording only with David.

export const WHAT_PROMOTES_TITLE = 'מה מקדם עסק בגוגל';

export const WHAT_PROMOTES_INTRO = 'גוגל מחליטה מי מופיע לפי שלושה דברים: התאמה למה שמחפשים, מרחק מהמחפש, ומידת ההיכרות עם העסק.';

export interface WhatPromotesPoint { label: string; text: string }
export const WHAT_PROMOTES_POINTS: WhatPromotesPoint[] = [
  {
    label: 'התאמה',
    text: 'אנחנו מכינים טקסטים מוכנים לכרטיס, ואתה מעתיק ומאשר. כרטיס מאומת, מלא ומדויק (שעות, קטגוריה, שירותים) מתאים ליותר חיפושים.',
  },
  {
    label: 'היכרות',
    text: 'ביקורות אמיתיות ותשובות אליהן. אנחנו עוזרים לבקש ביקורת ומכינים טיוטת תשובה. הלקוח כותב, ואתה מאשר.',
  },
];

export const WHAT_PROMOTES_CLOSING = 'מרחק אי אפשר לשנות, ואי אפשר לשלם לגוגל על דירוג טוב יותר, לכן אנחנו לא מבטיחים מקום.';

export const WHAT_PROMOTES_SOURCE = { label: 'מקור: מרכז העזרה של גוגל', url: 'https://support.google.com/business/answer/7091' };

/** Browser key, one per account email. The value is "1" once the block was shown. */
export const SEEN_KEY = 'pagey_what_promotes:';

/** First visit (nothing stored, or anything but "1") = open. Every later visit = collapsed. */
export function initialOpen(stored: string | null | undefined): boolean {
  return stored !== '1';
}
