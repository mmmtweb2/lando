// The words of the three fixed parts of every task (spec docs/dashboard-v3-spec.md, section 5).
//   part 1 "מה צריך לעשות"      -> `what`
//   part 2 "איך אנחנו עושים את זה" -> `how`
//   part 3 "מה אתם צריכים לעשות"  -> `you` (the sentence; the chip, minutes and button are derived)
// Titles, minutes, who and auto stay where they are (guided.ts / monthly.ts); this file only adds text.
// Fair promotion: no ranking promise, no claim that Google updates by itself.

import type { GuidedId } from '../guided';
import type { MonthlyId } from '../monthly';

export interface PartsCopy {
  what: string;
  how: string;
  you: string;
  /** manual-premium customer: we fill in the card and the customer approves */
  youPremium?: string;
  howPremium?: string;
}

export const SETUP_PARTS: Record<GuidedId, PartsCopy> = {
  connect: {
    what: 'למצוא את העסק בגוגל מפות ולשמור אותו כאן.',
    how: 'מציגים רשימת עסקים תואמים כדי שתבחרו את הנכון. אם אין כרטיס, מראים איך פותחים אחד.',
    you: 'להקליד את שם העסק ולבחור אותו מהרשימה.',
  },
  first_check: {
    what: 'לראות איפה הכרטיס שלכם עומד מול העסקים המובילים באזור.',
    how: 'משווים את הכרטיס לשלושת המובילים באזור (פרטים, תמונות, ביקורות) ומציגים מה חסר.',
    you: 'כלום. הבדיקה מתחילה לבד ולוקחת כחצי דקה.',
  },
  profile_details: {
    what: 'להשלים טלפון, שעות פתיחה ותמונות אמיתיות.',
    how: 'מכינים טקסטים מוכנים להעתקה: תיאור העסק, שעות פתיחה ורשימת תמונות להעלאה.',
    you: 'לעדכן את הפרטים בחשבון הגוגל שמנהל את העסק. רק בעל העסק יכול.',
    howPremium: 'אנחנו משלימים בשבילכם את הטלפון, שעות הפתיחה והתמונות בכרטיס.',
    youPremium: 'לראות את הכרטיס המעודכן ולאשר את מה שהכנו.',
  },
  profile_verified: {
    what: 'לאשר לגוגל שהעסק באמת שלכם. בלי אימות הכרטיס מוגבל.',
    how: 'מסבירים איזו שיטת אימות גוגל מציעה ומה לצפות בכל שלב.',
    you: 'לבצע את האימות שגוגל שולחת: שיחה, הודעה או גלויה.',
  },
  review_link_shared: {
    what: 'לבקש ביקורת מלקוח מרוצה אחד.',
    how: 'מכינים קישור והודעה מוכנה לוואטסאפ, בלחיצה אחת.',
    you: 'לבחור לקוח מרוצה ולשלוח לו את ההודעה.',
  },
};

export const MONTH_PARTS: Record<MonthlyId, PartsCopy> = {
  review_requests: {
    what: 'לשלוח בקשת ביקורת לשלושה לקוחות מרוצים מהחודש.',
    how: 'מכינים קישור והודעה לוואטסאפ וסופרים את הבקשות שיצאו.',
    you: 'לשלוח את ההודעה לשלושה לקוחות.',
  },
  review_replies: {
    what: 'לענות לביקורות שעוד לא נענו.',
    how: 'כותבים לכל ביקורת טיוטת מענה.',
    you: 'לקרוא את הטיוטה, לתקן אם צריך, ולהדביק אותה בגוגל.',
  },
  search_phrases: {
    what: 'להתאים את התוכן למה שלקוחות מחפשים באזור שלכם.',
    how: 'אתם בוחרים ביטוי, ואנחנו מכינים לו ערכת תוכן או דף חיפוש.',
    you: 'לבחור ביטוי חיפוש אחד.',
  },
  tracking: {
    what: 'לדעת כמה פניות מגיעות מהקידום.',
    how: 'סופרים את הפניות שמגיעות דרך הקישורים שלכם.',
    you: 'להטמיע את הקישור באתר שלכם. אם פניות כבר מגיעות, המשימה נסגרת לבד.',
  },
};
