// Pure helpers for the automatic product's screens: dates in Hebrew, compact hours, what changed in a form.
import type { Day, TruthCard, TruthHours, TruthPatch } from './types';

const TZ = 'Asia/Jerusalem';
const MIN = 60_000, HOUR = 60 * MIN, DAY_MS = 24 * HOUR;

function parts(d: Date, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('he-IL', { timeZone: TZ, ...opts }).formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "12.11.2026" */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d, { day: 'numeric', month: 'numeric', year: 'numeric' });
  return `${p.day}.${p.month}.${p.year}`;
}

/** "לפני שעתיים", "אתמול", "לפני 4 ימים"; older than two weeks: the date. */
export function relTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now.getTime() - t);
  const m = Math.floor(diff / MIN), h = Math.floor(diff / HOUR), d = Math.floor(diff / DAY_MS);
  if (m < 1) return 'ממש עכשיו';
  if (m === 1) return 'לפני דקה';
  if (m < 60) return `לפני ${m} דקות`;
  if (h === 1) return 'לפני שעה';
  if (h === 2) return 'לפני שעתיים';
  if (h < 24) return `לפני ${h} שעות`;
  if (d === 1) return 'אתמול';
  if (d === 2) return 'שלשום';
  if (d < 7) return `לפני ${d} ימים`;
  if (d < 14) return 'לפני שבוע';
  return shortDate(iso);
}

/** "יום שלישי, 17.11, בשעה 09:30" (Israel time). */
export function dayAndHour(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d, { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p.weekday}, ${p.day}.${p.month}, בשעה ${p.hour}:${p.minute}`;
}

export const DAYS: Day[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
export const DAY_HE: Record<Day, string> = { SUNDAY: 'ראשון', MONDAY: 'שני', TUESDAY: 'שלישי', WEDNESDAY: 'רביעי', THURSDAY: 'חמישי', FRIDAY: 'שישי', SATURDAY: 'שבת' };

/** Days with the same hours on one line; a run of days is written "ראשון עד חמישי". */
export function hoursLines(hours: readonly TruthHours[]): { days: string; spans: string }[] {
  const groups: { spans: string; idx: number[] }[] = [];
  DAYS.forEach((day, i) => {
    const spans = hours.filter((h) => h.day === day).map((h) => `${h.open}–${h.close}`).join(', ');
    if (!spans) return;
    const g = groups.find((x) => x.spans === spans);
    if (g) g.idx.push(i); else groups.push({ spans, idx: [i] });
  });
  return groups.map((g) => {
    const run = g.idx.length > 2 && g.idx.every((n, k) => k === 0 || n === g.idx[k - 1] + 1);
    const days = run ? `${DAY_HE[DAYS[g.idx[0]]]} עד ${DAY_HE[DAYS[g.idx[g.idx.length - 1]]]}` : g.idx.map((n) => DAY_HE[DAYS[n]]).join(', ');
    return { days, spans: g.spans };
  });
}

/** "8:00" as the time inputs need it ("08:00"); anything that is not a time stays as it is. */
const hhmm = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t.trim()); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : t.trim(); };

/** The hours by day, Sunday first, a day's ranges in the order they were given. */
export function sortedHours(hours: readonly TruthHours[]): TruthHours[] {
  return DAYS.flatMap((day) => hours.filter((h) => h.day === day).map((h) => ({ day, open: hhmm(h.open), close: hhmm(h.close) })));
}

export type HoursProblem = 'missing' | 'order' | 'overlap';
/** What stops the hours from being saved, by day: a missing time, a close that is not after the open, a second range that starts too early. */
export function hoursProblems(hours: readonly TruthHours[]): Partial<Record<Day, HoursProblem>> {
  const out: Partial<Record<Day, HoursProblem>> = {};
  for (const day of DAYS) {
    const ranges = hours.filter((h) => h.day === day);
    if (ranges.some((r) => r.open && r.close && r.close <= r.open)) out[day] = 'order';
    else if (ranges.some((r, i) => i > 0 && r.open && ranges[i - 1].close && r.open < ranges[i - 1].close)) out[day] = 'overlap';
    else if (ranges.some((r) => !r.open || !r.close)) out[day] = 'missing';
  }
  return out;
}

export interface CardForm { phone: string; website: string; description: string; notes: string; areas: string[]; services: { name: string; description: string }[]; hours: TruthHours[] }

export function formOf(c: TruthCard): CardForm {
  return {
    phone: c.phone, website: c.website, description: c.description, notes: c.notes, areas: [...c.areas],
    services: c.services.map((s) => ({ name: s.name, description: s.description })),
    hours: sortedHours(c.hours ?? []),
  };
}

/** Only the fields that differ from the saved card. Empty service rows are not sent. */
export function patchOf(saved: TruthCard, form: CardForm): TruthPatch {
  const base = formOf(saved);
  const out: TruthPatch = {};
  const services = form.services.map((s) => ({ name: s.name.trim(), description: s.description.trim() })).filter((s) => s.name || s.description);
  if (form.phone.trim() !== base.phone) out.phone = form.phone.trim();
  if (form.website.trim() !== base.website) out.website = form.website.trim();
  if (form.description.trim() !== base.description.trim()) out.description = form.description;
  if (form.notes.trim() !== base.notes.trim()) out.notes = form.notes;
  if (JSON.stringify(form.areas) !== JSON.stringify(base.areas)) out.areas = form.areas;
  if (JSON.stringify(services) !== JSON.stringify(base.services)) out.services = services;
  const hours = sortedHours(form.hours);
  if (JSON.stringify(hours) !== JSON.stringify(base.hours)) out.hours = hours;
  return out;
}
