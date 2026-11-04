// Abuse guard for the PUBLIC landing-page contact form. Every accepted lead is a database row AND
// an e-mail sent through our Resend quota to the page owner, so spam is bounded three ways:
//   1. per-IP limits (routes/landing.routes.ts, middleware/rateLimit.ts),
//   2. a per-PAGE daily cap  (PAGE_LEAD_PER_PAGE_DAILY_CAP, default 200): one flooded page cannot
//      bury its owner's inbox or burn the e-mail quota of everyone else,
//   3. a GLOBAL daily cap     (PAGE_LEAD_DAILY_CAP, default 3000): the whole form cannot be used
//      to exhaust the Resend quota.
// In-memory, single instance, reset at UTC midnight — same model as publicAuditGuard.ts.

export type LeadTake = 'ok' | 'page_cap' | 'global_cap';

const posInt = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : dflt;
};
export const pageLeadDailyCap = (): number => posInt(process.env.PAGE_LEAD_DAILY_CAP, 3000);
export const pageLeadPerPageDailyCap = (): number => posInt(process.env.PAGE_LEAD_PER_PAGE_DAILY_CAP, 200);

let day = '';
let total = 0;
let perPage = new Map<string, number>();

function roll(now: Date): void {
  const d = now.toISOString().slice(0, 10);
  if (d === day) return;
  if (day) console.log(`[PAGE-LEADS] day=${day} accepted=${total}`);
  day = d; total = 0; perPage = new Map();
}

/** Counts one lead if both caps allow it. Call only for a lead that is about to be stored. */
export function takePageLead(pageId: string, now = new Date()): LeadTake {
  roll(now);
  if (total >= pageLeadDailyCap()) return 'global_cap';
  const n = perPage.get(pageId) ?? 0;
  if (n >= pageLeadPerPageDailyCap()) return 'page_cap';
  total += 1;
  perPage.set(pageId, n + 1);
  if (total % 100 === 0) console.log(`[PAGE-LEADS] day=${day} accepted=${total}/${pageLeadDailyCap()}`);
  return 'ok';
}

/** Gives a counted slot back when the insert then failed. */
export function releasePageLead(pageId: string): void {
  if (total > 0) total -= 1;
  const n = perPage.get(pageId) ?? 0;
  if (n > 0) perPage.set(pageId, n - 1);
}

export function resetPageLeadCounters(): void { day = ''; total = 0; perPage = new Map(); }
