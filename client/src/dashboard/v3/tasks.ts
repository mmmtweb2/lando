// Pure model of the v3 screens: turns what guided.ts / monthly.ts already derive into one list of
// "tasks", each with its three parts and its part-3 chip. No React, no network, no new state.

import { GUIDED_COPY, GUIDED_IDS, PREMIUM_DETAILS, deriveGuided, type GuidedId } from '../guided';
import { MONTHLY_COPY, type MonthlyId, type MonthlyView } from '../monthly';
import type { OverviewInput } from '../journey';
import { MONTH_PARTS, SETUP_PARTS } from './copy';

/** The four states of the part-3 chip (spec section 5). */
export type NeedKind = 'none' | 'approve' | 'one' | 'need';

export interface V3Task {
  /** unique over both kinds: "s:connect", "m:tracking" */
  key: string;
  kind: 'setup' | 'month';
  id: GuidedId | MonthlyId;
  title: string;
  what: string;
  how: string;
  you: string;
  chip: NeedKind;
  /** minutes it takes from the customer; 0 when the chip says nothing is needed */
  minutes: number;
  done: boolean;
  skipped: boolean;
  /** label of the main button and the question asked before the task is closed */
  cta: string;
  confirmQ: string;
  skippable: boolean;
}

export const CONFIRM_SETUP = 'הכול מוכן? אחרי האישור עוברים לצעד הבא.';
export const CONFIRM_MONTH = 'הכול מוכן? אחרי האישור עוברים למשימה הבאה.';

/**
 * Chip order from the spec: done -> nothing needed; manual premium -> short approval; the first
 * check starts by itself when the step opens (there is no button to press, see GuidedSetup), so
 * nothing is needed from the customer; anything else -> action needed. "one" (a single click that
 * only triggers a check of ours) is kept for the day such a button exists; nothing uses it today.
 */
export function needOf(kind: V3Task['kind'], id: V3Task['id'], done: boolean, premium: boolean): NeedKind {
  if (done) return 'none';
  if (kind === 'setup' && id === 'first_check') return 'none';
  if (kind === 'setup' && id === 'profile_details' && premium) return 'approve';
  return 'need';
}

export function buildSetupTasks(input: OverviewInput, skips: readonly GuidedId[]): { tasks: V3Task[]; currentKey: string | null; view: ReturnType<typeof deriveGuided> } {
  const view = deriveGuided(input, skips);
  const premium = !!input.premium;
  const tasks = GUIDED_IDS.map((id): V3Task => {
    const st = view.steps.find((s) => s.id === id)!;
    const copy = premium && id === 'profile_details' ? PREMIUM_DETAILS : GUIDED_COPY[id];
    const parts = SETUP_PARTS[id];
    const chip = needOf('setup', id, st.done, premium);
    return {
      key: `s:${id}`, kind: 'setup', id, title: copy.title,
      what: parts.what,
      how: premium && parts.howPremium ? parts.howPremium : parts.how,
      you: premium && parts.youPremium ? parts.youPremium : parts.you,
      chip, minutes: chip === 'none' ? 0 : copy.minutes,
      done: st.done, skipped: st.skipped, cta: copy.cta, confirmQ: copy.confirm ?? CONFIRM_SETUP, skippable: copy.skippable,
    };
  });
  return { tasks, currentKey: view.current ? `s:${view.current.id}` : null, view };
}

export function buildMonthTasks(view: MonthlyView): V3Task[] {
  return view.tasks.map((t): V3Task => {
    const copy = MONTHLY_COPY[t.id];
    const parts = MONTH_PARTS[t.id];
    const chip = needOf('month', t.id, t.done, false);
    return {
      key: `m:${t.id}`, kind: 'month', id: t.id, title: copy.title,
      what: parts.what, how: parts.how, you: parts.you,
      chip, minutes: chip === 'none' ? 0 : copy.minutes,
      done: t.done, skipped: t.skipped, cta: copy.cta, confirmQ: CONFIRM_MONTH, skippable: true,
    };
  });
}

export interface Summary {
  total: number;
  done: number;
  /** open tasks whose chip is not "nothing needed" */
  waiting: number;
  /** sum of minutes of those */
  minutes: number;
  /** nothing open at all */
  allDone: boolean;
}

export function summarize(tasks: readonly V3Task[]): Summary {
  const open = tasks.filter((t) => !t.done);
  const mine = open.filter((t) => t.chip !== 'none');
  return {
    total: tasks.length, done: tasks.length - open.length, waiting: mine.length,
    minutes: mine.reduce((n, t) => n + t.minutes, 0), allDone: open.length === 0,
  };
}

/** Rows shown by the overview: everything, or only what waits for the customer. */
export function visibleRows(tasks: readonly V3Task[], onlyMine: boolean): V3Task[] {
  return onlyMine ? tasks.filter((t) => !t.done && t.chip !== 'none') : [...tasks];
}

/** "Later" in the monthly phase only moves on: the next open task after this one, else the first other open one. */
export function nextOpenAfter(tasks: readonly V3Task[], key: string): V3Task | null {
  const idx = tasks.findIndex((t) => t.key === key);
  const open = (t: V3Task) => !t.done && t.key !== key;
  const after = tasks.slice(idx + 1).filter(open);
  const before = tasks.slice(0, Math.max(idx, 0)).filter(open);
  const all = [...after, ...before];
  return all.find((t) => !t.skipped) ?? all[0] ?? null;
}

export function waitingTitle(waiting: number): string {
  if (waiting <= 0) return 'אין כרגע משהו שמחכה לכם';
  return waiting === 1 ? 'מחכה לכם משימה אחת' : `מחכות לכם ${waiting} משימות`;
}

export function minutesLine(minutes: number): string {
  return minutes <= 0 ? 'בלי זמן מכם' : `כ-${minutes} דקות מכם`;
}

export const REST_TEXT = 'אין כרגע משהו שמחכה לכם. הכול בטיפול.';
export const SETUP_DONE_FLASH = 'ההקמה הושלמה. עוברים לניהול השוטף.';

export function flashText(title: string, nextTitle: string | null): string {
  return nextTitle ? `כל הכבוד, ״${title}״ הושלם. הבא בתור: ${nextTitle}.` : `כל הכבוד, ״${title}״ הושלם. אין עוד משימות פתוחות.`;
}
