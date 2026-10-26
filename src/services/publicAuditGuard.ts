// Cost guard for the PUBLIC Audit (task #1). Anyone on the internet can reach /audit, and every
// Audit costs Google Places calls, so spending is bounded three ways:
//   1. per-IP hourly limits (middleware/rateLimit.ts, wired in seo/public routes),
//   2. a GLOBAL daily budget, below,
//   3. switched OFF until the owner sets PUBLIC_AUDIT_DAILY_CAP (nothing is spent by accident).
//
// Counters are in memory (single instance, like middleware/rateLimit.ts) and reset at UTC midnight.
// The previous day's totals are logged on rollover so the daily Places usage is visible in the logs.

export type Take = 'ok' | 'disabled' | 'cap';

/** Autocomplete calls allowed per Audit of the daily budget (typing triggers several). */
export const SEARCHES_PER_AUDIT = 8;

/** Max audits per day, or 0 = feature off (unset / not a positive number). */
export function publicAuditDailyCap(): number {
  const n = Number(process.env.PUBLIC_AUDIT_DAILY_CAP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
}

export function leadDailyCap(): number {
  const n = Number(process.env.AUDIT_LEAD_DAILY_CAP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 300;
}

interface Day { day: string; audit: number; search: number; lead: number }
let today: Day = { day: '', audit: 0, search: 0, lead: 0 };

function roll(now: Date): Day {
  const day = now.toISOString().slice(0, 10);
  if (today.day !== day) {
    if (today.day) {
      console.log(`[PUBLIC-AUDIT] day=${today.day} audits=${today.audit} searches=${today.search} leads=${today.lead}`);
    }
    today = { day, audit: 0, search: 0, lead: 0 };
  }
  return today;
}

export function takeAudit(now = new Date()): Take {
  const cap = publicAuditDailyCap();
  if (cap === 0) return 'disabled';
  const d = roll(now);
  if (d.audit >= cap) return 'cap';
  d.audit += 1;
  if (d.audit % 25 === 0) console.log(`[PUBLIC-AUDIT] day=${d.day} audits=${d.audit}/${cap} searches=${d.search}`);
  return 'ok';
}

export function takeSearch(now = new Date()): Take {
  const cap = publicAuditDailyCap();
  if (cap === 0) return 'disabled';
  const d = roll(now);
  if (d.search >= cap * SEARCHES_PER_AUDIT) return 'cap';
  d.search += 1;
  return 'ok';
}

/** Leads have their own, separate cap: spam must not be able to burn the Audit budget or vice versa. */
export function takeLead(now = new Date()): Take {
  const d = roll(now);
  if (d.lead >= leadDailyCap()) return 'cap';
  d.lead += 1;
  return 'ok';
}

export function usageToday(now = new Date()): { audit: number; search: number; lead: number } {
  const d = roll(now);
  return { audit: d.audit, search: d.search, lead: d.lead };
}

/** Test hook. */
export function resetPublicAuditCounters(): void {
  today = { day: '', audit: 0, search: 0, lead: 0 };
}
