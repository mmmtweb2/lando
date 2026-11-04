// Pure logic of the guided setup ("מצב פשוט", spec v4): five steps, one screen at a time.
//
// No React, no network. The done/not-done state of every step comes from journey.ts (data we
// detect, or ticks the customer saved on the server). The only thing kept here is the ORDER of the
// steps the customer chose to postpone ("אעשה אחר כך"). That list lives in the browser: a skipped
// step is a soft preference, not a fact about the business, so it needs no table.
//
// A skipped step never blocks. The steps that were not skipped come first; the skipped ones come
// back at the end, oldest skip first. Skipping the same step again sends it to the back of the line.

import { deriveSetup, type OverviewInput } from './journey';

export type GuidedId = 'connect' | 'first_check' | 'profile_details' | 'profile_verified' | 'review_link_shared';
export const GUIDED_IDS: GuidedId[] = ['connect', 'first_check', 'profile_details', 'profile_verified', 'review_link_shared'];
export const GUIDED_TOTAL = GUIDED_IDS.length;

/** How long the short success screen stays (spec: up to 2 seconds). */
export const SUCCESS_MS = 1800;

export interface StepCopy {
  id: GuidedId;
  title: string;
  /** what to do: one sentence */
  what: string;
  /** why it matters: one sentence, no promise of a result */
  why: string;
  minutes: number;
  who: 'we' | 'you';
  /** we detect it ourselves, the customer does not have to press "done" */
  auto: boolean;
  /** can be postponed; the first two cannot (everything after them needs the business and the check) */
  skippable: boolean;
  cta: string;
}

export const GUIDED_COPY: Record<GuidedId, StepCopy> = {
  connect: {
    id: 'connect', skippable: false, title: 'חיבור העסק', who: 'you', auto: true, minutes: 2, cta: 'חיבור העסק',
    what: 'מחפשים את העסק שלך בגוגל מפות ושומרים אותו כאן.',
    why: 'ככה נוכל לבדוק את הכרטיס של העסק שלך בגוגל ולהשוות אותו למתחרים.',
  },
  first_check: {
    id: 'first_check', skippable: false, title: 'בדיקה ראשונה מול מתחרים', who: 'we', auto: true, minutes: 1, cta: 'התחלת הבדיקה',
    what: 'אנחנו משווים את הכרטיס שלך בגוגל לשלושת העסקים המובילים באזור.',
    why: 'כדי לדעת מה חסר בכרטיס שלך לעומת העסקים שמופיעים לפניך.',
  },
  profile_details: {
    id: 'profile_details', skippable: true, title: 'פרטי הכרטיס שלך בגוגל', who: 'you', auto: false, minutes: 10, cta: 'סיימתי',
    what: 'משלימים בכרטיס העסק שלך בגוגל טלפון, שעות פתיחה ותמונות אמיתיות.',
    why: 'לקוחות מחפשים בדיוק את הפרטים האלה לפני שהם מתקשרים או מגיעים.',
  },
  profile_verified: {
    id: 'profile_verified', skippable: true, title: 'אימות הכרטיס', who: 'you', auto: false, minutes: 5, cta: 'סיימתי',
    what: 'מאשרים לגוגל שהעסק באמת שלך, בשיחת טלפון, בהודעה או בגלויה.',
    why: 'בלי אימות, הכרטיס שלך בגוגל נשאר מוגבל.',
  },
  review_link_shared: {
    id: 'review_link_shared', skippable: true, title: 'בקשת ביקורת ראשונה', who: 'you', auto: false, minutes: 3, cta: 'סיימתי',
    what: 'שולחים ללקוח מרוצה בקשה לביקורת, בלחיצה אחת מהוואטסאפ שלך.',
    why: 'ביקורות אמיתיות הן מה שלקוחות חדשים קוראים לפני שהם בוחרים עסק.',
  },
};

export interface GuidedStepState { id: GuidedId; done: boolean; skipped: boolean }

export interface GuidedView {
  total: number;
  doneCount: number;
  steps: GuidedStepState[];
  /** the step to show now; null when everything is done */
  current: StepCopy | null;
  /** 1-based place of the current step in the five (the "צעד X מתוך 5" header) */
  position: number;
  /** true when the current step is one the customer postponed earlier */
  revisiting: boolean;
  /** steps still open after the current one, in the order they will come */
  upcoming: StepCopy[];
  /** the only open step is a postponed one: there is nothing else to move on to */
  onlyThisLeft: boolean;
  complete: boolean;
}

const isId = (v: unknown): v is GuidedId => typeof v === 'string' && (GUIDED_IDS as string[]).includes(v);

/** Browser-stored skip list: only known ids, no duplicates, order kept. */
export function parseSkips(raw: unknown): GuidedId[] {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  const out: GuidedId[] = [];
  for (const x of v) if (isId(x) && !out.includes(x)) out.push(x);
  return out;
}

/** Skip = to the back of the line (removes an older entry first). Undo = take it out. */
export function withSkip(skips: GuidedId[], id: GuidedId, on: boolean): GuidedId[] {
  const rest = skips.filter((s) => s !== id);
  return on ? [...rest, id] : rest;
}

export function deriveGuided(input: OverviewInput, skipsIn: readonly GuidedId[]): GuidedView {
  const setup = deriveSetup(input);
  const doneOf = (id: GuidedId) => setup.find((s) => s.id === id)?.done === true;
  const skips = skipsIn.filter((s) => !doneOf(s) && GUIDED_COPY[s].skippable);
  const steps: GuidedStepState[] = GUIDED_IDS.map((id) => ({ id, done: doneOf(id), skipped: skips.includes(id) }));
  const open = steps.filter((s) => !s.done);
  const fresh = open.filter((s) => !s.skipped).map((s) => s.id);
  const postponed = skips.filter((s) => open.some((o) => o.id === s));
  const order: GuidedId[] = [...fresh, ...postponed];
  const currentId = order[0] ?? null;
  return {
    total: GUIDED_TOTAL,
    doneCount: GUIDED_TOTAL - open.length,
    steps,
    current: currentId ? GUIDED_COPY[currentId] : null,
    position: currentId ? GUIDED_IDS.indexOf(currentId) + 1 : GUIDED_TOTAL,
    revisiting: currentId !== null && fresh.length === 0,
    upcoming: order.slice(1).map((id) => GUIDED_COPY[id]),
    onlyThisLeft: order.length === 1,
    complete: open.length === 0,
  };
}

export interface SuccessLine { title: string; before: string; after: string }

/** The short screen after a step: what it was before, what it is now. Score only when we have one. */
export function successLine(id: GuidedId, ctx: { name?: string | null; score?: number | null } = {}): SuccessLine {
  switch (id) {
    case 'connect':
      return { title: 'העסק חובר', before: 'העסק עוד לא היה כאן', after: ctx.name ? `מחובר: ${ctx.name}` : 'העסק מחובר' };
    case 'first_check':
      return {
        title: 'הבדיקה הסתיימה', before: 'לא ידענו איפה הכרטיס שלך עומד',
        after: typeof ctx.score === 'number' ? `הציון של הכרטיס שלך: ${ctx.score} מתוך 100` : 'יש לנו תמונת מצב ראשונה',
      };
    case 'profile_details':
      return { title: 'פרטי הכרטיס הושלמו', before: 'חסרו פרטים בכרטיס', after: 'הטלפון, השעות והתמונות מעודכנים' };
    case 'profile_verified':
      return { title: 'הכרטיס אומת', before: 'הכרטיס לא היה מאומת', after: 'הכרטיס מסומן כמאומת' };
    case 'review_link_shared':
      return { title: 'בקשת הביקורת הראשונה יצאה', before: 'עוד לא ביקשת ביקורות', after: 'בקשה ראשונה נשלחה ללקוח' };
  }
}

/** "5 דקות" / "דקה אחת" */
export function minutesText(n: number): string { return n === 1 ? 'דקה אחת' : `${n} דקות`; }

/** Ready-to-copy texts for the "card details" step. Built only from what the customer already gave us. */
export function cardTexts(businessName: string | null): { id: string; label: string; text: string }[] {
  const name = (businessName ?? '').trim();
  return [
    {
      id: 'about', label: 'תיאור העסק (להשלים את הסוגריים לפני ההדבקה)',
      text: `${name || '[שם העסק]'}: [מה אתם עושים] ב[עיר או אזור]. מוזמנים להתקשר או לשלוח הודעה בוואטסאפ.`,
    },
    {
      id: 'hours', label: 'שעות פתיחה (לעדכן לפי השעות האמיתיות שלך)',
      text: 'ראשון עד חמישי: 08:00 עד 18:00\nשישי: 08:00 עד 13:00\nשבת: סגור',
    },
    {
      id: 'photos', label: 'אילו תמונות להעלות',
      text: 'חזית העסק מהרחוב\nכניסה ושלט\nפנים העסק\nהצוות בעבודה\nדוגמאות מעבודות אמיתיות',
    },
  ];
}

/** Direct link to where the owner edits the card. Google decides what the page shows. */
export const GOOGLE_BUSINESS_URL = 'https://business.google.com/';
