// The words of "הכרטיס שלכם בגוגל" (docs/gbp-sync-spec.md). Plural, plain, no technical terms.
import type { FieldKey, FieldStatus, PhotoCategory, PhotoState } from './profileTypes';

export const PROFILE = {
  title: 'הכרטיס שלכם בגוגל',
  hint: 'מה שתשנו כאן מתעדכן גם בכרטיס העסק שלכם בגוגל.',
  /** the spec's banner wording, as is */
  syncOff: 'השינויים נשמרים אצלנו. העברה אוטומטית לגוגל תופעל בקרוב.',
  googleDelay: 'גוגל לפעמים בודקת שינוי עד כמה ימים לפני שהוא מופיע.',
  checked: (when: string) => `בדקנו את הכרטיס בגוגל ${when}`,
  openMaps: 'לצפייה בכרטיס בגוגל',
  loadError: 'לא הצלחנו לטעון את הכרטיס מגוגל כרגע.',
  edit: 'עריכה',
  save: 'שמירה',
  saving: 'שומרים...',
  cancel: 'ביטול',
  empty: 'עדיין לא מולא',
  saved: 'נשמר ונשלח לגוגל.',
  kept: 'עדכנו אצלנו לפי מה שבגוגל.',
  savedLocal: 'השינוי נשמר אצלנו. הוא יעבור לגוגל כשההעברה האוטומטית תופעל.',
  invalid: 'משהו בערך לא תקין. בדקו ונסו שוב.',
  rejected: (why: string) => (why ? `גוגל לא קיבלה את השינוי: ${why}` : 'גוגל לא קיבלה את השינוי.'),
  googleSaid: (why: string) => why,
  quota: 'גוגל עמוסה כרגע. ננסה שוב בעוד דקה.',
  // google_changed
  changedTitle: 'הערך בגוגל שונה ממה שאצלנו',
  changedBody: 'אולי שיניתם אותו ישירות בגוגל, או שגוגל עדכנה אותו. מה להשאיר?',
  oursLabel: 'אצלנו',
  googleLabel: 'בגוגל עכשיו',
  keepGoogle: 'להשאיר את מה שבגוגל',
  keepOurs: 'להחזיר את שלנו',
  moreDetails: 'אזורי שירות ופרטים נוספים לכתיבת הפוסטים',
  moreDetailsSub: 'הם לא מוצגים בכרטיס בגוגל, אבל עוזרים לנו לכתוב עליכם נכון.',
  back: 'חזרה לכרטיס בגוגל',
};

export const FIELD_LABEL: Record<FieldKey, string> = {
  website: 'אתר',
  description: 'תיאור העסק',
  phone: 'טלפון',
  hours: 'שעות פעילות',
  specialHours: 'חגים וימים מיוחדים',
  services: 'שירותים',
};

export const FIELD_HINT: Record<FieldKey, string> = {
  website: 'הכתובת שמופיעה בכפתור "אתר" בכרטיס. כתבו את הכתובת המלאה, כולל https בהתחלה.',
  description: 'עד 750 תווים. בלי קישורים ובלי מספרי טלפון: גוגל לא מאשרת אותם בתיאור.',
  phone: 'המספר הראשון הוא הראשי. אפשר להוסיף עד שני מספרים נוספים.',
  hours: 'השעות שמוצגות בגוגל בכל יום רגיל.',
  specialHours: 'ימים שבהם אתם סגורים או עובדים בשעות אחרות, כמו חגים. מופיעים בגוגל רק בתאריך עצמו.',
  services: 'מה שאתם עושים. השירותים שכבר מופיעים בגוגל נשארים שם גם אם לא תכתבו אותם כאן.',
};

export const STATUS_LABEL: Record<FieldStatus, string> = {
  live: 'מופיע בגוגל',
  pending: 'ממתין לאישור גוגל',
  google_changed: 'שונה בגוגל',
  local_only: 'נשמר אצלנו בלבד',
};

export const PHONE = {
  main: 'טלפון ראשי',
  extra: (n: number) => `טלפון נוסף ${n}`,
  add: 'הוספת מספר',
  remove: (n: string) => `הסרת המספר ${n}`,
};

export const SPECIAL = {
  none: 'אין ימים מיוחדים.',
  add: 'הוספת יום',
  date: 'תאריך',
  closed: 'סגור כל היום',
  from: 'מ-',
  to: 'עד',
  remove: (d: string) => `הסרת ${d}`,
  closedText: 'סגור',
  errDate: 'בחרו תאריך לכל יום.',
  errHours: 'בכל יום פתוח צריך שעת פתיחה לפני שעת סגירה.',
  errDup: 'אותו תאריך מופיע פעמיים.',
};

export const SERVICES = {
  name: 'שם השירות',
  desc: 'תיאור קצר (לא חובה)',
  add: 'הוספת שירות',
  remove: (n: string) => `הסרת ${n}`,
  none: 'עדיין אין שירותים.',
};

export const PHOTOS = {
  title: 'תמונות בכרטיס',
  hint: 'תמונות עדכניות של העסק, העבודה והצוות עוזרות ללקוחות לבחור בכם. תמונה חדשה מופיעה בגוגל אחרי עיבוד קצר.',
  add: 'הוספת תמונות',
  fromPage: 'מדף הנחיתה',
  fromPageTitle: 'בחרו תמונות מדף הנחיתה שלכם (אפשר כמה)',
  fromPageNone: 'לא מצאנו תמונות בדף הנחיתה.',
  pick: 'בחירת קובץ',
  category: 'סוג התמונה',
  upload: 'העלאה לגוגל',
  uploading: (p: number) => `מעלים... ${p}%`,
  chosen: (n: number) => `נבחרו ${n} תמונות`,
  pickOne: 'בחירת תמונה',
  uploadMany: (n: number) => (n > 1 ? `העלאת ${n} תמונות לגוגל` : 'העלאה לגוגל'),
  uploadingBatch: (b: { at: number; of: number } | null, p: number) => (b && b.of > 1 ? `מעלים ${b.at} מתוך ${b.of}... ${p}%` : `מעלים... ${p}%`),
  addedMany: (n: number) => `${n} תמונות נשלחו לגוגל. הן יופיעו אחרי שגוגל תעבד אותן.`,
  smallMany: (n: number) => `${n} מהן קטנות, כדאי להעלות גדולות יותר (לפחות 720 פיקסלים).`,
  partial: (sent: number, of: number) => `${sent} מתוך ${of} תמונות נשלחו.`,
  skippedType: (n: number) => `${n} קבצים דולגו כי הם לא JPG, PNG או WEBP.`,
  skippedBig: (n: number) => `${n} קבצים דולגו כי הם גדולים מ-10MB.`,
  skippedSmall: (n: number) => `${n} תמונות דולגו כי הן קטנות מ-250 פיקסלים.`,
  skippedMany: (n: number) => `אפשר להעלות עד ${n} תמונות בבת אחת. התמונות הנוספות לא נבחרו.`,
  remove: 'מחיקה',
  removeConfirm: 'למחוק את התמונה גם מהכרטיס בגוגל?',
  removeYes: 'כן, למחוק',
  removeNo: 'לא',
  empty: 'עדיין אין תמונות בכרטיס. כדאי להתחיל בתמונת שער ובלוגו.',
  loadError: 'לא הצלחנו לטעון את התמונות מגוגל.',
  badType: 'אפשר להעלות רק תמונות JPG, PNG או WEBP.',
  tooBig: 'התמונה גדולה מ-10MB. בחרו תמונה קטנה יותר.',
  tooSmall: 'התמונה קטנה מדי. גוגל מבקשת לפחות 250 פיקסלים בכל צד, ועדיף 720 ומעלה.',
  added: 'התמונה נשלחה לגוגל. היא תופיע אחרי שגוגל תעבד אותה.',
  small: 'התמונה קטנה, כדאי להעלות גדולה יותר (לפחות 720 פיקסלים).',
  removed: 'התמונה נמחקה.',
  uploadFailed: 'לא הצלחנו להעלות את התמונה. נסו שוב.',
  photoAlt: (cat: string) => `תמונה מסוג ${cat}`,
  syncOff: 'הוספה ומחיקה של תמונות יפעלו כשההעברה האוטומטית לגוגל תופעל.',
};

export const PHOTO_CATEGORY: Record<PhotoCategory, string> = {
  COVER: 'תמונת שער',
  PROFILE: 'לוגו',
  EXTERIOR: 'מבחוץ',
  INTERIOR: 'מבפנים',
  PRODUCT: 'מוצרים ועבודות',
  AT_WORK: 'בזמן עבודה',
  TEAMS: 'הצוות',
  ADDITIONAL: 'כללי',
};

export const PHOTO_STATE: Record<PhotoState, string | null> = {
  live: null,
  processing: 'בעיבוד בגוגל',
};

export const WEBSITE = {
  title: 'להציג בגוגל את דף הנחיתה שלכם?',
  subNone: 'בכרטיס בגוגל עדיין אין אתר. אפשר להוסיף את הדף בלחיצה.',
  subReplaceBefore: 'בכרטיס בגוגל מופיע עכשיו',
  subReplaceAfter: 'אפשר להציג במקומו את דף הנחיתה.',
  cta: 'כן, להציג',
  done: 'הדף נוסף כאתר בכרטיס בגוגל.',
};

export const WEBSITE_OPTIONS: { value: 'auto' | 'ask' | 'off'; label: string; hint: string }[] = [
  { value: 'auto', label: 'אוטומטי', hint: 'כשדף הנחיתה מתפרסם ובכרטיס אין אתר, נוסיף אותו בעצמנו. אתר קיים לא נדרס.' },
  { value: 'ask', label: 'לשאול אותי', hint: 'נציע לכם בדף הבית, ונעדכן רק אחרי שתאשרו.' },
  { value: 'off', label: 'כבוי', hint: 'לא נוגעים בקישור האתר בכרטיס.' },
];
export const WEBSITE_LEGEND = 'קישור הדף בכרטיס בגוגל';
