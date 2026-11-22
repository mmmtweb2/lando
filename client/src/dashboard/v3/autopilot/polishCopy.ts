// The words of "שיפור הניסוח" (README part 144). Plural, plain, no technical terms, and never the
// word "AI": the owner sees a better wording, not a technology.
import type { PolishField } from './profileTypes';

export const POLISH = {
  button: 'שיפור הניסוח',
  buttonLabel: (what: string) => `שיפור הניסוח: ${what}`,
  title: { description: 'שיפור הניסוח של התיאור', services: 'שיפור הניסוח של השירותים' } as Record<PolishField, string>,
  intro: {
    description: 'הכנו לכם הצעה לפי הפרטים שבכרטיס בלבד. אפשר לשנות בה כל מילה לפני ההחלפה.',
    services: 'סידרנו את הרשימה: שמות קצרים, בלי כפילויות, ותיאור קצר לכל שירות. לא הוספנו שירות שלא כתבתם.',
  } as Record<PolishField, string>,
  loading: 'מנסחים לכם הצעה...',
  ready: 'ההצעה מוכנה.',
  before: 'הניסוח שלכם',
  after: 'ההצעה שלנו',
  afterEditLabel: 'ההצעה, אפשר לערוך',
  emptyBefore: 'עדיין אין תיאור. כתבנו אחד מהפרטים שבכרטיס.',
  unchanged: 'הניסוח שלכם כבר טוב. כמעט לא היה מה לשנות.',
  replace: 'החלפה',
  replacing: 'מחליפים...',
  another: 'ניסוח אחר',
  anotherLeft: (n: number) => `ניסוח אחר (עוד ${n} היום)`,
  noMoreToday: 'זה הניסוח האחרון להיום לשדה הזה.',
  cancel: 'ביטול',
  close: 'סגירה',
  counter: (n: number) => `${n} / 750`,
  aim: 'מומלץ 250 עד 600 תווים. השורות הראשונות מוצגות בגוגל לפני "עוד".',
  fixFirst: 'כדי להחליף, תקנו קודם את מה שמסומן.',
  // services
  merged: (names: string[]) => `אוחד מ: ${names.join(' + ')}`,
  lockedName: 'השם נשאר כמו בגוגל',
  lockedWhy: 'השם כבר מופיע בגוגל. שם חדש היה מוסיף שם שירות כפול.',
  nameLabel: (n: number) => `שם השירות ${n}`,
  descLabel: (name: string) => `תיאור קצר: ${name}`,
  descPlaceholder: 'תיאור קצר (לא חובה)',
  remove: (name: string) => `הסרת ${name} מההצעה`,
  forgottenTitle: 'שירותים שאולי שכחתם',
  forgottenHint: 'שירותים שעסקים כמו שלכם נותנים לא פעם. סמנו רק מה שאתם באמת עושים.',
  count: (n: number) => (n === 1 ? 'שירות אחד' : `${n} שירותים`),
  // after accepting
  doneSaved: 'הניסוח החדש נשמר ונשלח לגוגל.',
};

/** Hints on the owner's own text, before any suggestion (same wording as the server's checks). */
export const HINT = {
  too_short: 'התיאור קצר מדי. כמה משפטים על מה שאתם עושים ואיפה יעזרו ללקוחות לבחור בכם.',
  too_long: 'התיאור ארוך מ-750 תווים, וגוגל תחתוך אותו.',
  url: 'גוגל לא מקבלת קישורים בתיאור.',
  email: 'גוגל לא מקבלת כתובת מייל בתיאור.',
  phone: 'גוגל לא מקבלת מספר טלפון בתיאור. הטלפון כבר מופיע בכרטיס.',
  no_area: 'חסר האזור: כתבו באיזו עיר או באיזה אזור אתם עובדים.',
  caps: 'מילים באותיות גדולות נראות כמו צעקה.',
  dup: 'יש שירותים כמעט זהים ברשימה.',
  name_long: 'יש שמות שירות ארוכים. 2 עד 5 מילים קל יותר לקרוא.',
  desc_long: 'יש תיאורי שירות ארוכים מ-120 תווים.',
  tryPolish: 'אפשר ללחוץ על "שיפור הניסוח".',
};
