// "שיפור הניסוח" in the preview (?preview=ongoing): written-by-hand suggestions for the sample plumber, so
// the dialog can be looked at and screenshotted without a server or a model. Nothing is sent anywhere.
// `&polish=limit` the day's three suggestions are used up · `&polish=fail` no suggestion this time ·
// `&services=messy` (profileApi) a list worth tidying.
import { nearDuplicate } from './polishCheck';
import type { PolishField, PolishRequest, PolishResult, PolishedService, ServiceItem } from './profileTypes';
import { sampleFlag } from './sample';

export const POLISH_LIMIT = 'הגעתם ל-3 הצעות היום לשדה הזה. אפשר לנסות שוב מחר, או לערוך בעצמכם.';
export const POLISH_UNAVAILABLE = 'שיפור הניסוח לא זמין כרגע. אפשר לערוך בעצמכם.';
export const POLISH_FAILED = 'לא הצלחנו להציע ניסוח טוב יותר הפעם. נסו שוב בעוד רגע, או ערכו בעצמכם.';

const DAILY = 3;

const DESCRIPTIONS = [
  'אינסטלציה לבית בחיפה ובקריות: פתיחת סתימות במטבח, באמבטיה ובשירותים, והחלפת דוד שמש. אנחנו מגיעים אליכם מהר, בודקים מה הבעיה ונותנים הצעת מחיר לפני שמתחילים לעבוד, כדי שתדעו מראש למה לצפות.\n\nאינסטלטור מוסמך שעובד בחיפה, בקריות, בנשר ובטירת כרמל. בסוף כל עבודה אנחנו משאירים את הבית נקי, כמו שהיה לפני שהגענו.',
  'נתקעה סתימה או שהדוד הפסיק לחמם? אנחנו אינסטלטור מוסמך בחיפה ובקריות, ופותחים סתימות במטבח, באמבטיה ובשירותים ומחליפים דודי שמש.\n\nלפני כל עבודה תקבלו הצעת מחיר, בלי הפתעות. אנחנו מגיעים מהר, עובדים בזהירות ומשאירים את הבית נקי.',
  'פתיחת סתימות והחלפת דוד שמש בחיפה, בקריות ובסביבה. כשמשהו בצנרת לא עובד, אנחנו מגיעים מהר ומסבירים בפשטות מה צריך לעשות.\n\nהצעת המחיר ניתנת לפני שמתחילים, ואת הבית אנחנו משאירים נקי. אינסטלטור מוסמך, לבתים בחיפה, בקריות, בנשר ובטירת כרמל.',
];

/** Names the sample's Google listing already has: kept as they are. */
const ON_GOOGLE = new Set(['פתיחת סתימות', 'החלפת דוד שמש']);
const NICER: Record<string, string> = { 'תיקון נזילות מים': 'תיקון נזילות', 'התקנה של ברזים ואביזרי אמבטיה ומטבח מכל הסוגים': 'התקנת ברזים ואביזרים' };
const DESC: Record<string, [string, string]> = {
  'פתיחת סתימות': ['במטבח, באמבטיה ובשירותים', 'סתימות בכיורים, באסלות ובקווי ניקוז בבית'],
  'החלפת דוד שמש': ['פירוק הדוד הישן, התקנת דוד חדש וחיבור לצנרת', 'החלפה של דוד שהפסיק לחמם, כולל חיבור לצנרת הקיימת'],
  'תיקון נזילות': ['בברזים ובצנרת', 'נזילות מברזים ומצנרת בבית'],
  'התקנת ברזים ואביזרים': ['במטבח ובאמבטיה, לכל סוגי הברזים', 'ברזים ואביזרים לאמבטיה ולמטבח'],
  'איתור נזילות': ['מוצאים מאיפה המים נוזלים לפני שמתקנים', 'בדיקה שמוצאת את מקור הנזילה'],
};
const FORGOTTEN = ['תיקון ניאגרה', 'החלפת צנרת', 'התקנת מסנן מים'];

const tidy = (n: string) => n.replace(/^(?:[-–—•*·]+|\d{1,2}[.)-])\s*/, '').replace(/[\s.,;:!-]+$/, '').replace(/\s+/g, ' ').trim();

function servicesSuggestion(list: ServiceItem[], variant: number): { rows: PolishedService[]; forgotten: string[] } {
  const rows: PolishedService[] = [];
  list.forEach((s, i) => {
    const locked = ON_GOOGLE.has(s.name.trim());
    const name = locked ? s.name : NICER[tidy(s.name)] ?? tidy(s.name);
    const twin = rows.find((r) => nearDuplicate(r.name, name));
    if (twin) { twin.from.push(i); if (!twin.description && s.description) twin.description = s.description; return; }
    rows.push({ name, description: DESC[name]?.[variant % 2] ?? s.description, from: [i], locked });
  });
  const forgotten = FORGOTTEN.filter((f) => !rows.some((r) => nearDuplicate(r.name, f)));
  return { rows, forgotten };
}

export function samplePolish() {
  const used: Record<PolishField, number> = { description: sampleFlag('polish') === 'limit' ? DAILY : 0, services: sampleFlag('polish') === 'limit' ? DAILY : 0 };
  return async <F extends PolishField>(field: F, req: PolishRequest<F>): Promise<PolishResult> => {
    await new Promise((r) => setTimeout(r, sampleFlag('polish') === 'slow' ? 60_000 : 900));
    if (used[field] >= DAILY) return { ok: false, code: 'limit', message: POLISH_LIMIT };
    if (sampleFlag('polish') === 'fail') return { ok: false, code: 'failed', message: POLISH_FAILED };
    const n = used[field]++;
    const remaining = DAILY - used[field];
    if (field === 'description') {
      const before = String(req.draft ?? '');
      return { ok: true, field: 'description', before, suggestion: DESCRIPTIONS[n % DESCRIPTIONS.length], issues: [], unchanged: false, remaining };
    }
    const before = req.draft as ServiceItem[];
    const s = servicesSuggestion(before, n);
    return { ok: true, field: 'services', before, suggestion: s.rows, forgotten: s.forgotten, issues: [], unchanged: false, remaining };
  };
}
