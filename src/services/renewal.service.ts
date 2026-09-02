// ─────────────────────────────────────────────────────────────────────────────
// renewal.service.ts — the annual page-renewal lifecycle.
//
// Publishing has always stamped `expires_at = now + 1 year`, but until this
// file existed nothing ever read that column: expiry was a date in a row, with
// no email, no state change and no way to pay for another year. This is the one
// place that knows what an expiry MEANS.
//
//   T-30d / T-7d / T-0   reminder email (page stays fully live throughout)
//   T+0 … T+7d           GRACE PERIOD — page stays live and public, as normal
//   T+7d                 FREEZE  → status 'frozen'; offline to the public, but
//                                  the page and its leads are fully intact
//   frozen +12 months    HARD DELETE → leads first, then the page
//
// At any point from the first reminder until the hard delete, the owner can pay
// 99₪ (purpose 'renew', payment.controller.ts) and `grantRenewal` below puts the
// page back to 'published' for another year.
//
// See migrations/013_renewal_lifecycle.sql for the columns and the reasoning
// behind each one.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';
import { sendRenewalReminder, ReminderKind } from './renewal.mailer';

// ─── Lifecycle constants ─────────────────────────────────────────────────────

/** Days after `expires_at` during which the page stays fully live. */
export const GRACE_PERIOD_DAYS = 7;

/** Months a frozen page is retained before it (and its leads) are deleted. */
export const FROZEN_RETENTION_MONTHS = 12;

/**
 * How often the sweep runs. Six hours is the deliberate middle of the range:
 *
 *  • Every threshold in this lifecycle is measured in DAYS, so anything faster
 *    than a few hours is pure wasted queries — a reminder is no more correct at
 *    09:00 than at 13:00.
 *  • But once-a-day is fragile in this deployment: there is no cron, the sweep
 *    is a setInterval inside the web process, and a Coolify redeploy resets it.
 *    A daily timer that keeps getting restarted before it fires could skip a
 *    day entirely — and a skipped day is a reminder a customer never got.
 *    Four passes a day means a deploy has to be pathologically timed to cost a
 *    customer their warning.
 *  • Freeze and hard-delete latency is bounded at 6h, which is irrelevant
 *    against a 7-day grace period and a 12-month retention window.
 *
 * All the "due" queries below are `<=` (at-or-past threshold), never a window,
 * so even a genuinely missed pass sends late rather than never.
 */
export const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Delay before the first sweep, so boot / DB warm-up finishes first. */
const FIRST_SWEEP_DELAY_MS = 30 * 1000;

/** Safety cap on rows touched per stage per pass. */
const BATCH_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The three reminder thresholds, MOST URGENT FIRST. Order matters: a page is
 * sent at most ONE reminder per sweep, and sending one also marks every
 * less-urgent threshold as handled (see sendDueReminders).
 */
const REMINDERS: { kind: ReminderKind; daysBefore: number; column: string }[] = [
  { kind: 'expiry_day', daysBefore: 0,  column: 'renewal_reminder_0_at'  },
  { kind: 'week',       daysBefore: 7,  column: 'renewal_reminder_7_at'  },
  { kind: 'month',      daysBefore: 30, column: 'renewal_reminder_30_at' },
];

/** All reminder columns — cleared on renewal so the next year gets fresh ones. */
const REMINDER_COLUMNS = REMINDERS.map((r) => r.column);

function addYears(from: Date, years: number): Date {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Renewal grant — the paid path
// ─────────────────────────────────────────────────────────────────────────────

export interface RenewedPage {
  id: string;
  slug: string;
  status: string;
  expires_at: string;
  renewal_count: number;
}

/**
 * A page is renewable while it is 'published' (renewing early, straight from a
 * reminder email) or 'frozen' (renewing to bring it back online). A 'draft' page
 * is NOT renewable — it was never published, so there is nothing to extend; it
 * needs a 249₪ publish, not a 99₪ renewal. Selling a renewal for a draft would
 * take 99₪ and leave the page exactly as offline as before.
 */
export const RENEWABLE_STATUSES = ['published', 'frozen'] as const;

export interface RenewEligibility {
  ok: boolean;
  reason?: 'not_found' | 'not_owner' | 'not_renewable';
  status?: string | null;
  businessName?: string | null;
}

/**
 * Can `email` buy a renewal for page `id` right now?
 *
 * Called BOTH at startPayment (don't open a charge that cannot be fulfilled)
 * and again inside grantRenewal at grant time (the world can change between the
 * two, and the admin force-activate tool reaches the grant without ever passing
 * through startPayment).
 */
export async function checkRenewEligibility(email: string, id: string): Promise<RenewEligibility> {
  const { data, error } = await supabase
    .from('landing_pages')
    .select('owner_email, status, business_name')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: 'not_found' };

  const row = data as { owner_email?: string | null; status?: string | null; business_name?: string | null };
  const owner = (row.owner_email ?? '').trim().toLowerCase();
  if (!owner || owner !== email.trim().toLowerCase()) {
    return { ok: false, reason: 'not_owner', status: row.status ?? null };
  }
  if (!RENEWABLE_STATUSES.includes((row.status ?? '') as (typeof RENEWABLE_STATUSES)[number])) {
    return { ok: false, reason: 'not_renewable', status: row.status ?? null, businessName: row.business_name ?? null };
  }
  return { ok: true, status: row.status ?? null, businessName: row.business_name ?? null };
}

/**
 * Grant a paid renewal: another year for one page.
 *
 * New expiry is `max(now, current expires_at) + 1 year`. Renewing a FROZEN page
 * runs from now (the generous, obvious reading — the customer gets a full year
 * from the moment they pay, not a year eaten by the months it sat frozen).
 * Renewing an already-published page EARLY, straight from the T-30 reminder,
 * runs from the existing expiry instead — otherwise paying promptly would
 * silently destroy the 30 days still on the clock and punish the customers who
 * respond to the first email.
 *
 * All-or-nothing, and NOTHING else is touched:
 *  • `page_credits` is not read or written — a renewal is a flat 99₪ fee, not a
 *    249₪ page credit (see RENEWAL_PRICE in config/billing.ts).
 *  • the page's content, slug and leads are untouched — a frozen page comes back
 *    exactly as it was.
 *
 * Returns false without writing anything if the page is not renewable, so a
 * caller that sees `false` can safely retry the whole payment row later.
 */
export async function grantRenewal(email: string, id: string): Promise<boolean> {
  // Re-check ownership and eligibility AT GRANT TIME. The grant path is also
  // reachable from the admin re-verify / force-activate tools, and the page may
  // have been deleted, renewed by another in-flight payment, or hard-deleted
  // since the charge was opened.
  const eligibility = await checkRenewEligibility(email, id);
  if (!eligibility.ok) {
    console.error('[RENEW] refusing to renew — not eligible', { id, email, reason: eligibility.reason, status: eligibility.status });
    return false;
  }

  const { data: current } = await supabase
    .from('landing_pages')
    .select('expires_at, status, renewal_count')
    .eq('id', id)
    .maybeSingle();
  if (!current) return false;

  const cur = current as { expires_at?: string | null; status?: string | null; renewal_count?: number | null };
  const priorStatus = cur.status ?? '';
  const priorCount = cur.renewal_count ?? 0;

  const now = new Date();
  const currentExpiry = cur.expires_at ? new Date(cur.expires_at) : null;
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  const newExpiry = addYears(base, 1);

  const clearedReminders = Object.fromEntries(REMINDER_COLUMNS.map((c) => [c, null]));

  // Compare-and-swap on BOTH the status and the renewal count we just read.
  // Two verified payments for the same page arriving together (a double-click
  // on the SUMIT return, or a return racing an admin force-activate) would
  // otherwise both read the same row and both add a year — the customer would
  // be charged 99₪ twice and get two years, or worse, one grant would clobber
  // the other's expiry. Only the first update matches; the second finds
  // renewal_count already incremented and writes nothing.
  const { data, error } = await supabase
    .from('landing_pages')
    .update({
      status: 'published',
      expires_at: newExpiry.toISOString(),
      frozen_at: null,
      renewed_at: now.toISOString(),
      renewal_count: priorCount + 1,
      ...clearedReminders,
    })
    .eq('id', id)
    .eq('status', priorStatus)
    .eq('renewal_count', priorCount)
    .select('id, slug, status, expires_at, renewal_count')
    .maybeSingle();

  if (error) {
    console.error('[RENEW] update failed:', error.message, { id });
    return false;
  }
  if (!data) {
    // CAS lost. Someone else renewed this page in the same instant. Report
    // failure rather than retrying: the caller flags the payment for review, an
    // admin can see two charges against one page, and — crucially — we have NOT
    // handed out a second year off a possible double-charge.
    console.error('[RENEW] CAS lost — page changed mid-renewal, nothing written', { id, priorStatus, priorCount });
    return false;
  }

  const renewed = data as RenewedPage;
  console.log('[RENEW] page renewed', {
    id, email, from: priorStatus, expires_at: renewed.expires_at, renewal_count: renewed.renewal_count,
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep stage 1 — reminder emails
// ─────────────────────────────────────────────────────────────────────────────

interface ReminderRow {
  id: string;
  slug: string;
  business_name: string | null;
  owner_email: string | null;
  expires_at: string | null;
}

/**
 * Send at most one reminder per page per pass, most-urgent-first.
 *
 * Why one, and why marking the rest: when this ships, existing pages are already
 * somewhere in the middle of their year with all three reminder columns NULL. A
 * page that is already 3 days from expiry qualifies for T-30 AND T-7
 * simultaneously — naively sending every due threshold would put three
 * near-identical emails in that customer's inbox in one pass. So we send only
 * the most urgent one that is due, and stamp every LESS urgent threshold as
 * handled at the same time: those windows have already passed, and an email
 * saying "30 days left" is worse than no email once there are 3.
 *
 * The de-dup stamp is written BEFORE the send. If the process dies mid-send the
 * customer misses one reminder (and still gets the next two); if it were written
 * after, a crash loop would mail the same customer on every restart. Under-
 * sending is recoverable, spamming a customer is not.
 */
async function sendDueReminders(now: Date): Promise<number> {
  let sent = 0;

  for (let i = 0; i < REMINDERS.length; i++) {
    const { kind, daysBefore, column } = REMINDERS[i];
    // Less urgent thresholds = the ones LATER in the array (larger daysBefore).
    const lessUrgentColumns = REMINDERS.slice(i + 1).map((r) => r.column);

    // Due when the page is still published, this reminder has never been sent,
    // and expiry is at or inside the threshold. `<=` not a window: a pass that
    // was missed (redeploy, outage) still sends late instead of never.
    const threshold = new Date(now.getTime() + daysBefore * DAY_MS);

    const { data, error } = await supabase
      .from('landing_pages')
      .select('id, slug, business_name, owner_email, expires_at')
      .eq('status', 'published')
      .is(column, null)
      .not('expires_at', 'is', null)
      .lte('expires_at', threshold.toISOString())
      .limit(BATCH_LIMIT);

    if (error) {
      console.error(`[SWEEP] reminder query failed (${kind}):`, error.message);
      continue;
    }

    for (const row of (data ?? []) as ReminderRow[]) {
      const stamp = new Date().toISOString();
      const marks: Record<string, string> = { [column]: stamp };
      // Collapse the already-passed, less urgent thresholds in the same write.
      for (const c of lessUrgentColumns) marks[c] = stamp;

      // Claim the send atomically: only the pass that flips this column from
      // NULL gets to mail. Two overlapping sweeps (a slow pass still running
      // when the next fires) would otherwise both see NULL and both send.
      const { data: claimed, error: claimErr } = await supabase
        .from('landing_pages')
        .update(marks)
        .eq('id', row.id)
        .is(column, null)
        .select('id')
        .maybeSingle();

      if (claimErr) {
        console.error(`[SWEEP] failed to claim reminder ${kind} for ${row.id}:`, claimErr.message);
        continue;
      }
      if (!claimed) continue; // another pass took it

      if (!row.owner_email) {
        console.warn('[SWEEP] page has no owner_email — reminder skipped', { id: row.id, kind });
        continue;
      }

      // A failed send is logged and NOT retried (the column is already stamped).
      // The next threshold still fires, and the freeze itself is never blocked
      // by mail delivery — a page must not stay live forever because Resend was
      // down for an hour.
      const ok = await sendRenewalReminder({
        kind,
        to: row.owner_email,
        pageId: row.id,
        slug: row.slug,
        businessName: row.business_name ?? 'העסק שלך',
        expiresAt: row.expires_at,
      });
      if (ok) sent++;
    }
  }

  return sent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep stage 2 — freeze after the grace period
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Freeze every published page whose grace period has fully elapsed.
 *
 * A frozen page is offline to the public (landing.controller / og.controller
 * treat it like a draft) but is otherwise completely untouched: same content,
 * same slug, same leads. Nothing here deletes anything.
 */
async function freezeExpiredPages(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * DAY_MS);

  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, slug, business_name, owner_email, expires_at')
    .eq('status', 'published')
    .not('expires_at', 'is', null)
    .lte('expires_at', cutoff.toISOString())
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[SWEEP] freeze query failed:', error.message);
    return 0;
  }

  let frozen = 0;
  for (const row of (data ?? []) as ReminderRow[]) {
    // CAS on status: never freeze a page that was renewed or unpublished between
    // the read and the write.
    const { data: updated, error: updErr } = await supabase
      .from('landing_pages')
      .update({ status: 'frozen', frozen_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'published')
      .lte('expires_at', cutoff.toISOString())
      .select('id')
      .maybeSingle();

    if (updErr) {
      console.error('[SWEEP] freeze failed for', row.id, updErr.message);
      continue;
    }
    if (!updated) continue;

    frozen++;
    console.log('[SWEEP] froze page', { id: row.id, slug: row.slug, expires_at: row.expires_at });

    if (row.owner_email) {
      await sendRenewalReminder({
        kind: 'frozen',
        to: row.owner_email,
        pageId: row.id,
        slug: row.slug,
        businessName: row.business_name ?? 'העסק שלך',
        expiresAt: row.expires_at,
      });
    }
  }

  return frozen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sweep stage 3 — hard delete after 12 months frozen
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Permanently delete pages that have been frozen for the full retention window.
 *
 * ⚠️ ORDER IS LOAD-BEARING. `leads_landing_page_id_fkey` has no ON DELETE clause
 * (defaults to NO ACTION — see 006_consolidate_schema.sql), so deleting a page
 * that still has leads raises a foreign-key violation. Leads MUST go first.
 *
 * And if the leads delete fails, we STOP: the page is left frozen and retried on
 * the next sweep. Pressing on would either hit the FK error anyway or, if the FK
 * were ever relaxed, orphan the rows. A page surviving an extra 6 hours costs
 * nothing; getting this order wrong costs data integrity.
 */
async function hardDeleteFrozenPages(now: Date): Promise<number> {
  const cutoff = addMonths(now, -FROZEN_RETENTION_MONTHS);

  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, slug, business_name, owner_email, frozen_at')
    .eq('status', 'frozen')
    .not('frozen_at', 'is', null)
    .lte('frozen_at', cutoff.toISOString())
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[SWEEP] hard-delete query failed:', error.message);
    return 0;
  }

  let deleted = 0;
  for (const row of (data ?? []) as (ReminderRow & { frozen_at: string | null })[]) {
    // 1. Leads FIRST — the FK has no cascade.
    const { error: leadsErr } = await supabase
      .from('leads')
      .delete()
      .eq('landing_page_id', row.id);

    if (leadsErr) {
      console.error('[SWEEP] leads delete failed — page left frozen, will retry next sweep', {
        id: row.id, error: leadsErr.message,
      });
      continue;
    }

    // 2. Page SECOND, still guarded on 'frozen' so a page renewed in the last
    //    instant is never deleted. If the CAS loses here the leads are already
    //    gone — unavoidable without a transaction, and vanishingly unlikely
    //    after 12 months of no activity, but log it loudly if it ever happens.
    const { data: gone, error: pageErr } = await supabase
      .from('landing_pages')
      .delete()
      .eq('id', row.id)
      .eq('status', 'frozen')
      .select('id')
      .maybeSingle();

    if (pageErr) {
      console.error('[SWEEP] page delete failed AFTER leads were deleted', { id: row.id, error: pageErr.message });
      continue;
    }
    if (!gone) {
      console.error('[SWEEP] page was no longer frozen at delete time — leads already deleted!', { id: row.id });
      continue;
    }

    deleted++;
    console.warn('[SWEEP] hard-deleted expired page and its leads', {
      id: row.id, slug: row.slug, frozen_at: row.frozen_at,
    });
  }

  return deleted;
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One full pass over the lifecycle. Safe to call at any time, from anywhere:
 * every stage is idempotent and guarded, so an extra run is a no-op.
 *
 * Stage order is deliberate — reminders, then freeze, then delete — so a page
 * always gets its T-0 email in the same pass that it would otherwise be frozen
 * by, never after.
 */
export async function runRenewalSweep(): Promise<{ reminded: number; frozen: number; deleted: number }> {
  const now = new Date();
  const started = Date.now();

  const reminded = await sendDueReminders(now);
  const frozen = await freezeExpiredPages(now);
  const deleted = await hardDeleteFrozenPages(now);

  if (reminded || frozen || deleted) {
    console.log('[SWEEP] renewal sweep done', { reminded, frozen, deleted, ms: Date.now() - started });
  }
  return { reminded, frozen, deleted };
}

/**
 * Wire the sweep into the running server.
 *
 * There is no cron in this deployment and `node-cron` is deliberately not a
 * dependency, so this is a plain setInterval owned by the web process. The
 * consequences are accepted and designed around: the timer dies with the
 * process and restarts on boot (hence the at-or-past `<=` queries, which
 * tolerate missed passes), and if the app is ever scaled to more than one
 * instance every instance will sweep. That last case is safe — every write in
 * this file is a compare-and-swap, so a second sweeper finds nothing to claim —
 * but if it happens, this is the function to gate behind a leader lock.
 *
 * `.unref()` keeps the timer from holding the process open during shutdown.
 */
export function startRenewalSweep(): void {
  const kick = () => {
    runRenewalSweep().catch((err) => {
      // Never let a sweep failure take down the web server.
      console.error('[SWEEP] renewal sweep threw:', err);
    });
  };

  setTimeout(kick, FIRST_SWEEP_DELAY_MS).unref();
  setInterval(kick, SWEEP_INTERVAL_MS).unref();

  console.log(
    `[SWEEP] renewal sweep scheduled — every ${SWEEP_INTERVAL_MS / 3600000}h ` +
    `(grace ${GRACE_PERIOD_DAYS}d, frozen retention ${FROZEN_RETENTION_MONTHS}mo)`,
  );
}
