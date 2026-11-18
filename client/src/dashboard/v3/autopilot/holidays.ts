// "חגים קרובים" (docs/gbp-sync-spec.md, phase A): turns the server's holiday suggestions into closed
// days in the special-hours editor. Suggestion only: the rows go into the editor, the owner can edit
// them, and nothing is saved until they press "שמירה". Pure, no I/O.
import type { TruthHours } from './types';
import type { HolidaySuggestion, SpecialDay } from './profileTypes';

/** The same cap as the server (MAX_SPECIAL_HOURS). */
export const MAX_SPECIAL_DAYS = 40;

/** Suggestions for days that are not in the list yet, in date order. */
export function pendingHolidays(all: readonly HolidaySuggestion[], current: readonly SpecialDay[]): HolidaySuggestion[] {
  const have = new Set(current.map((d) => d.date));
  return all.filter((h) => !have.has(h.date)).sort((a, b) => a.date.localeCompare(b.date));
}

/** The list with each picked holiday added as a closed day (a date already there is left as it is), sorted by date, capped. */
export function addHolidayRows(current: readonly SpecialDay[], picks: readonly HolidaySuggestion[]): SpecialDay[] {
  const out: SpecialDay[] = current.map((d) => ({ ...d }));
  for (const h of picks) {
    if (out.length >= MAX_SPECIAL_DAYS) break;
    if (out.some((d) => d.date === h.date)) continue;
    out.push({ date: h.date, closed: true, open: '', close: '' });
  }
  // rows without a date yet (a day the owner is still filling in) stay where they are, after the dated ones
  const dated = out.filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date));
  return [...dated, ...out.filter((d) => !d.date)];
}

const DAY_OF_WEEK = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

/** True when the regular hours have no opening on that date's weekday: the business is closed that day anyway. */
export function usuallyClosed(date: string, hours: readonly TruthHours[]): boolean {
  if (!hours.length) return false;                                   // no regular hours known: say nothing
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const day = DAY_OF_WEEK[d.getUTCDay()];
  return !hours.some((h) => h.day === day);
}
