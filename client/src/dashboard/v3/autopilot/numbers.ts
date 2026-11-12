import { FileText, Mail, MapPin, MessageCircle, Phone, type LucideIcon } from 'lucide-react';
import type { LeadFeedItem, LeadsSummary } from '../../../components/LeadsTable';
import { HOME } from '../autopilotCopy';
import type { GoogleNumbers } from './types';

// The numbers on the promotion home. Pure.
//
// ONE period per number. Google gives calls and direction requests for 30 days. Our own counters
// (`summary`) are month-to-date, but the inquiries list that arrives with them (GET
// /api/landing/my-leads, the newest 500, each with its time) lets us count the same 30 days here.
// So normally everything is "ב-30 הימים האחרונים" and the big number is the sum of the four tiles.
// Only when the list is cut before it reaches 30 days back (500 inquiries in less than a month) the
// two periods are shown apart, each under its own label, and nothing from different periods is summed.

export interface Tile { key: string; label: string; value: number; Icon: LucideIcon }
export interface NumberGroup { key: string; label: string; tiles: Tile[] }
export interface HomeNumbers {
  /** the hero: a sum of numbers that share one period, and the words that say which */
  total: number;
  totalLabel: string;
  groups: NumberGroup[];
  note: string;
}

export interface OwnNumbers { call: number; whatsapp: number; form: number; email: number }

/** The server sends at most this many inquiries (FEED_LIMIT in landing.controller.ts). */
export const FEED_CAP = 500;
const DAY = 86_400_000;

/**
 * Inquiries through our links in the last 30 days, counted from the list. Null when the list was
 * cut before it reaches 30 days back, because then the count would be too low.
 */
export function last30(items: readonly LeadFeedItem[], now: number = Date.now(), cap: number = FEED_CAP): OwnNumbers | null {
  const from = now - 30 * DAY;
  const times = items.map((i) => new Date(i.created_at).getTime());
  if (items.length >= cap && !times.some((t) => t < from)) return null;
  const n: OwnNumbers = { call: 0, whatsapp: 0, form: 0, email: 0 };
  items.forEach((i, idx) => { if (times[idx] >= from && i.kind in n) n[i.kind] += 1; });
  return n;
}

const sum = (tiles: Tile[]) => tiles.reduce((n, t) => n + t.value, 0);

/**
 * `own` = last30(items); null means our counters are known month-to-date only (`s`).
 * `g` = Google's 30 days of calls and direction requests, when the listing is connected.
 */
export function homeNumbers(s: LeadsSummary, own: OwnNumbers | null, g: GoogleNumbers | null): HomeNumbers {
  if (own) {
    const tiles: Tile[] = [
      { key: 'calls', label: HOME.numCalls, value: own.call + (g?.calls ?? 0), Icon: Phone },
      { key: 'wa', label: HOME.numWhatsapp, value: own.whatsapp, Icon: MessageCircle },
      { key: 'forms', label: HOME.numForms, value: own.form, Icon: FileText },
      g ? { key: 'dir', label: HOME.numDirections, value: g.directions, Icon: MapPin } : { key: 'mail', label: HOME.numEmail, value: own.email, Icon: Mail },
    ];
    return { total: sum(tiles), totalLabel: HOME.hero30, groups: [{ key: '30', label: HOME.period30, tiles }], note: g ? HOME.note30Google : HOME.note30Own };
  }
  const month: Tile[] = [
    { key: 'wa', label: HOME.numWhatsapp, value: s.month_whatsapp, Icon: MessageCircle },
    { key: 'forms', label: HOME.numForms, value: s.month_form, Icon: FileText },
    { key: 'calls-own', label: HOME.numCallsOwn, value: s.month_call, Icon: Phone },
    { key: 'mail', label: HOME.numEmail, value: s.month_email, Icon: Mail },
  ];
  if (!g) return { total: sum(month), totalLabel: HOME.heroMonth, groups: [{ key: 'month', label: HOME.periodMonth, tiles: month }], note: HOME.noteMonth };
  const google: Tile[] = [
    { key: 'calls', label: HOME.numCallsGoogle, value: g.calls, Icon: Phone },
    { key: 'dir', label: HOME.numDirections, value: g.directions, Icon: MapPin },
  ];
  return {
    total: sum(google), totalLabel: HOME.heroGoogle30,
    groups: [{ key: '30', label: HOME.period30Google, tiles: google }, { key: 'month', label: HOME.periodMonthOwn, tiles: month }],
    note: HOME.noteSplit,
  };
}
