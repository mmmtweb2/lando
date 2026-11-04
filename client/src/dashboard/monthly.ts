// Pure logic of "משימת החודש" (spec v4, ongoing phase): one task at a time, same structure as the
// setup steps (what / why / minutes / who / when). Four monthly tasks.
//
// Where we can see the result in data we detect it (leads this month, review requests sent this
// month, new search content since the month began, replies still waiting). Otherwise the customer
// says "סיימתי". What the customer ticked or postponed this month is kept in this browser, and it
// starts over each calendar month. No table, no migration.

import type { OverviewInput } from './journey';

export type MonthlyId = 'search_phrases' | 'tracking' | 'review_requests' | 'review_replies';
export const MONTHLY_IDS: MonthlyId[] = ['review_requests', 'review_replies', 'search_phrases', 'tracking'];
/** Review requests that count as "done" for the month. */
export const REQUESTS_GOAL = 3;

export interface MonthlyCopy {
  id: MonthlyId;
  title: string;
  what: string;
  why: string;
  minutes: number;
  who: 'we' | 'you';
  /** detected from data; no "done" button needed when it flips by itself */
  auto: boolean;
  cta: string;
}

export const MONTHLY_COPY: Record<MonthlyId, MonthlyCopy> = {
  review_requests: {
    id: 'review_requests', title: 'שלוש בקשות ביקורת', who: 'you', auto: true, minutes: 5, cta: 'סיימתי',
    what: `שולחים בקשת ביקורת לשלושה לקוחות מרוצים מהחודש, בלחיצה מהוואטסאפ.`,
    why: 'ביקורות חדשות מראות ללקוחות שהעסק פעיל ושמרוצים ממנו.',
  },
  review_replies: {
    id: 'review_replies', title: 'מענה לביקורות שמחכות', who: 'you', auto: true, minutes: 5, cta: 'סיימתי',
    what: 'עוברים על הביקורות שעוד לא נענו, ועונים להן עם טיוטה מוכנה.',
    why: 'מענה מראה ללקוחות שמישהו קורא את מה שהם כותבים.',
  },
  search_phrases: {
    id: 'search_phrases', title: 'ביטויי חיפוש חדשים', who: 'we', auto: true, minutes: 10, cta: 'סיימתי',
    what: 'בוחרים ביטוי חיפוש חדש, ואנחנו מכינים לו ערכת תוכן או דף חיפוש.',
    why: 'כל ביטוי חדש הוא דרך נוספת שבה לקוחות יכולים למצוא את העסק.',
  },
  tracking: {
    id: 'tracking', title: 'בדיקת מעקב אחרי פניות', who: 'you', auto: true, minutes: 5, cta: 'סיימתי',
    what: 'מוודאים שהפניות מהאתר, מהדף ומהוואטסאפ נספרות כאן.',
    why: 'בלי מעקב אי אפשר לדעת מאיפה הגיעו הפניות.',
  },
};

export interface MonthState {
  /** "YYYY-MM"; a different month starts a fresh state */
  month: string;
  done: MonthlyId[];
  /** postponed this month, oldest first */
  skipped: MonthlyId[];
  /** number of content items when the month began (new content = more than this) */
  baseContent: number;
  /** replies were waiting at some point this month, so "answer them" stays a task until none wait */
  repliesSeen: boolean;
}

export interface MonthlyData {
  input: OverviewInput;
  /** review requests with a sent date inside the current month (all businesses we looked at) */
  requestsSent: number;
  /** replies waiting for an answer; null = we could not load them (or Google is not connected) */
  pendingReplies: number | null;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function inMonth(iso: string | null | undefined, key: string): boolean {
  if (!iso) return false;
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) && monthKey(t) === key;
}

const isId = (v: unknown): v is MonthlyId => typeof v === 'string' && (MONTHLY_IDS as string[]).includes(v);
const ids = (v: unknown): MonthlyId[] => {
  const out: MonthlyId[] = [];
  if (Array.isArray(v)) for (const x of v) if (isId(x) && !out.includes(x)) out.push(x);
  return out;
};

export function freshMonth(key: string, contentCount: number): MonthState {
  return { month: key, done: [], skipped: [], baseContent: Math.max(0, contentCount), repliesSeen: false };
}

/** Reads the browser value; anything wrong or from another month becomes a fresh month. */
export function parseMonth(raw: unknown, key: string, contentCount: number): MonthState {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return freshMonth(key, contentCount); } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return freshMonth(key, contentCount);
  const o = v as Record<string, unknown>;
  if (o.month !== key) return freshMonth(key, contentCount);
  const base = typeof o.baseContent === 'number' && Number.isFinite(o.baseContent) && o.baseContent >= 0 ? o.baseContent : contentCount;
  return { month: key, done: ids(o.done), skipped: ids(o.skipped), baseContent: base, repliesSeen: o.repliesSeen === true };
}

/** Remembers that replies were waiting, so the task does not vanish when the last one is answered. */
export function observe(s: MonthState, d: MonthlyData): MonthState {
  return !s.repliesSeen && d.pendingReplies !== null && d.pendingReplies > 0 ? { ...s, repliesSeen: true } : s;
}

export function markDone(s: MonthState, id: MonthlyId): MonthState {
  return { ...s, done: s.done.includes(id) ? s.done : [...s.done, id], skipped: s.skipped.filter((x) => x !== id) };
}
/** Skipping again sends the task to the back of the line. */
export function markSkipped(s: MonthState, id: MonthlyId): MonthState {
  return { ...s, skipped: [...s.skipped.filter((x) => x !== id), id] };
}

export interface MonthlyTaskState { id: MonthlyId; done: boolean; skipped: boolean }
export interface MonthlyView {
  /** the tasks that apply this month (a reply task without waiting replies is not shown) */
  tasks: MonthlyTaskState[];
  total: number;
  doneCount: number;
  current: MonthlyCopy | null;
  revisiting: boolean;
  onlyThisLeft: boolean;
  /** open tasks after the current one, in order */
  upcoming: MonthlyCopy[];
  complete: boolean;
}

export function deriveMonthly(d: MonthlyData, s: MonthState): MonthlyView {
  const detected: Record<MonthlyId, boolean> = {
    review_requests: d.requestsSent >= REQUESTS_GOAL,
    review_replies: d.pendingReplies === 0,
    search_phrases: d.input.contentCount > s.baseContent,
    tracking: d.input.monthLeads > 0,
  };
  const applies = (id: MonthlyId) => id !== 'review_replies' || (d.pendingReplies !== null && (d.pendingReplies > 0 || s.repliesSeen));
  const tasks: MonthlyTaskState[] = MONTHLY_IDS.filter(applies).map((id) => ({
    id, done: detected[id] || s.done.includes(id), skipped: s.skipped.includes(id),
  }));
  const open = tasks.filter((t) => !t.done);
  const fresh = open.filter((t) => !t.skipped).map((t) => t.id);
  const later = s.skipped.filter((id) => open.some((t) => t.id === id));
  const order = [...fresh, ...later];
  return {
    tasks,
    total: tasks.length,
    doneCount: tasks.length - open.length,
    current: order[0] ? MONTHLY_COPY[order[0]] : null,
    revisiting: order.length > 0 && fresh.length === 0,
    onlyThisLeft: order.length === 1,
    upcoming: order.slice(1).map((id) => MONTHLY_COPY[id]),
    complete: open.length === 0,
  };
}

export interface MonthlySuccess { title: string; before: string; after: string }
export function monthlySuccess(id: MonthlyId): MonthlySuccess {
  switch (id) {
    case 'review_requests': return { title: 'בקשות הביקורת יצאו', before: 'החודש עוד לא ביקשת ביקורות', after: 'שלוש בקשות נשלחו ללקוחות' };
    case 'review_replies': return { title: 'ענית לביקורות', before: 'היו ביקורות שמחכות למענה', after: 'אין ביקורות שמחכות' };
    case 'search_phrases': return { title: 'ביטוי חדש נוסף', before: 'לא היה תוכן חדש החודש', after: 'יש תוכן לביטוי חיפוש חדש' };
    case 'tracking': return { title: 'המעקב בודק', before: 'לא ידענו אם הפניות נספרות', after: 'הפניות נספרות כאן' };
  }
}

/** Keeps the "still to do this month" line short and plain. */
export function remainingText(v: MonthlyView): string {
  const left = v.total - v.doneCount;
  if (left <= 0) return 'כל משימות החודש הושלמו.';
  return left === 1 ? 'נשארה משימה אחת החודש.' : `נשארו ${left} משימות החודש.`;
}
