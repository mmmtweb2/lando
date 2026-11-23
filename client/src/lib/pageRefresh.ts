// "עדכון הדף לפי פרטי העסק" on the client (README part 146): the words and the two calls. The server side is
// src/services/pageRefresh(.service).ts. Hebrew, plural second person, plain.
import { authFetch } from './api';

export type RefreshSectionId = 'hero' | 'about' | 'services' | 'benefits' | 'process' | 'faq' | 'closing' | 'seo';
export interface RefreshLine { title?: string; text?: string }
export interface RefreshPreviewSection { id: RefreshSectionId; label: string; before: RefreshLine[]; after: RefreshLine[] }
export interface RefreshPreview { token: string; sections: RefreshPreviewSection[]; remaining: number }
export interface RefreshApplied { ai_content: unknown; applied: RefreshSectionId[]; category?: string; category_source?: 'auto' }

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface RefreshApi {
  preview(pageId: string): Promise<Result<RefreshPreview>>;
  apply(pageId: string, token: string, sections: RefreshSectionId[]): Promise<Result<RefreshApplied>>;
}

export const REFRESH = {
  button: 'עדכון הדף לפי פרטי העסק',
  buttonShort: 'עדכון לפי פרטי העסק',
  buttonHint: 'כותבים מחדש את הטקסטים בדף לפי הפרטים העדכניים של העסק. לפני שמשהו משתנה, תראו מה יוחלף.',
  saveFirst: 'שמרו קודם את השינויים שעשיתם, ואז אפשר לעדכן.',
  title: 'עדכון הדף לפי פרטי העסק',
  intro: 'אנחנו כותבים מחדש את הטקסטים בדף לפי הפרטים העדכניים של העסק. סמנו מה להחליף. מה שלא תסמנו יישאר כמו שהוא.',
  untouched: 'לא משתנים: התמונות, הלוגו, הצבעים והעיצוב, פרטי הקשר, המלצות שכתבתם, הצוות והשפות שבהן מדברים.',
  loading: 'כותבים את הטקסטים לפי פרטי העסק. זה לוקח עד דקה.',
  ready: (n: number) => `מוכן. ${n === 1 ? 'חלק אחד' : `${n} חלקים`} לבדיקה.`,
  before: 'עכשיו בדף',
  after: 'אחרי העדכון',
  replaceThis: (label: string) => `להחליף את ${label}`,
  willReplace: 'יוחלף',
  willKeep: 'יישאר כמו שהוא',
  summary: (n: number, of: number) => (n === 0 ? 'לא סימנתם אף חלק' : `יוחלפו ${n} מתוך ${of} חלקים`),
  selectAll: 'סימון הכול',
  selectNone: 'ניקוי הסימון',
  replace: 'החלפה',
  replacing: 'מחליפים…',
  cancel: 'ביטול',
  close: 'סגירה',
  nothing: 'הטקסטים בדף כבר מתאימים לפרטי העסק. אין מה להחליף.',
  remaining: (n: number) => (n === 0 ? 'זה היה העדכון האחרון להיום.' : n === 1 ? 'נשאר עוד עדכון אחד להיום.' : `נשארו עוד ${n} עדכונים להיום.`),
  done: (n: number) => `הדף עודכן. ${n === 1 ? 'חלק אחד הוחלף' : `${n} חלקים הוחלפו`}.`,
  doneLangs: 'התרגומים לשפות האחרות מסומנים עכשיו כלא מעודכנים. אפשר לעדכן אותם מ"שפות הדף".',
  failed: 'משהו השתבש. הדף לא השתנה. נסו שוב בעוד כמה דקות.',
  empty: '(ריק)',
} as const;

async function call<T>(url: string, body?: unknown): Promise<Result<T>> {
  try {
    const r = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})) as T & { code?: string; error?: string };
    if (!r.ok) return { ok: false, code: j.code ?? String(r.status), message: j.error ?? REFRESH.failed };
    return { ok: true, data: j };
  } catch {
    return { ok: false, code: 'network', message: REFRESH.failed };
  }
}

export const serverRefreshApi: RefreshApi = {
  preview: (id) => call<RefreshPreview>(`/api/landing/${id}/refresh-from-card`),
  apply: (id, token, sections) => call<RefreshApplied>(`/api/landing/${id}/refresh-from-card/apply`, { token, sections }),
};
