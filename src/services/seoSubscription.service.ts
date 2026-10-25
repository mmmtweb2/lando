// Monthly subscription for the Google-promotion product (Stage 9.2). Owns the DB side:
// seo_subscriptions (our state), seo_subscription_events (replay guard), and the mirror into
// user_products (the entitlement everything else reads). The state rules are in
// subscriptionState.ts; the SUMIT field names are in sumitRecurring.ts.

import { supabase } from '../config/supabase';
import { seoPlanName, seoPlanPrice, seoSubscriptionEnabled } from '../config/seoPlan';
import { isEntitled } from './entitlements.service';
import { summitConfigured } from './summit.service';
import { beginRecurringRedirect, cancelRecurring } from './sumitRecurring';
import {
  SubState, SubStatus, applyCancel, applyChargeFailed, applyChargeOk, expire, sameState, toEntitlementRow,
} from './subscriptionState';

const API_URL = (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export type SubErrorCode = 'not_migrated' | 'db' | 'disabled' | 'already_has_access' | 'already_subscribed' | 'no_subscription' | 'sumit';
export class SubError extends Error {
  constructor(public code: SubErrorCode, message?: string) { super(message ?? code); }
}

export interface SubRow {
  id: string;
  email: string;
  status: SubStatus;
  amount: number;
  sumit_customer_id: string | null;
  sumit_recurring_item_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  needs_manual_cancel: boolean;
}

const COLS = 'id, email, status, amount, sumit_customer_id, sumit_recurring_item_id, current_period_end, cancel_at_period_end, needs_manual_cancel';

function dbError(e: { code?: string; message: string }): SubError {
  // 42P01 = undefined_table: the code was deployed before migration 030 was run.
  if (e.code === '42P01' || /seo_subscriptions/.test(e.message) && /does not exist|schema cache/.test(e.message)) {
    return new SubError('not_migrated');
  }
  console.error('[SUBSCRIPTION] db error:', e.message);
  return new SubError('db', e.message);
}

export function stateOf(r: SubRow): SubState {
  return {
    status: r.status,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end) : null,
    cancelAtPeriodEnd: r.cancel_at_period_end,
  };
}

export async function getSubscription(email: string): Promise<SubRow | null> {
  const { data, error } = await supabase
    .from('seo_subscriptions').select(COLS).eq('email', email.trim().toLowerCase()).maybeSingle();
  if (error) throw dbError(error);
  return (data as SubRow | null) ?? null;
}

async function getById(id: string): Promise<SubRow | null> {
  const { data, error } = await supabase.from('seo_subscriptions').select(COLS).eq('id', id).maybeSingle();
  if (error) throw dbError(error);
  return (data as SubRow | null) ?? null;
}

/** Writes the subscription state and mirrors it into user_products (never over a manual grant). */
async function saveState(row: SubRow, next: SubState, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.from('seo_subscriptions').update({
    status: next.status,
    current_period_end: next.currentPeriodEnd ? next.currentPeriodEnd.toISOString() : null,
    cancel_at_period_end: next.cancelAtPeriodEnd,
    updated_at: new Date().toISOString(),
    ...extra,
  }).eq('id', row.id);
  if (error) throw dbError(error);
  await mirrorEntitlement(row.email, next);
}

async function mirrorEntitlement(email: string, s: SubState): Promise<void> {
  const mirror = toEntitlementRow(s);
  if (!mirror) return;
  const { data: existing, error: readErr } = await supabase
    .from('user_products').select('source, status').eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  if (readErr) { console.error('[SUBSCRIPTION] entitlement read failed:', readErr.message); return; }
  const ex = existing as { source: string; status: string } | null;
  // A manual grant (pilot customer, gift) is never overwritten by a payment event.
  if (ex && ex.source !== 'sumit' && ex.status === 'active') return;
  const { error } = await supabase.from('user_products').upsert(
    { email, product: 'seo_autopilot', status: mirror.status, current_period_end: mirror.current_period_end, source: 'sumit' },
    { onConflict: 'email,product' },
  );
  if (error) console.error('[SUBSCRIPTION] entitlement mirror failed:', error.message);
}

// ─── Start ──────────────────────────────────────────────────────────────────

export async function startSubscription(email: string): Promise<{ redirectUrl: string }> {
  const price = seoPlanPrice();
  if (!seoSubscriptionEnabled() || price === null || !summitConfigured()) throw new SubError('disabled');

  // Already has the product some other way (e.g. a manual grant)? Do not bill them for it.
  const { data: prod } = await supabase
    .from('user_products').select('status, current_period_end, source').eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  const p = prod as { status: string; current_period_end: string | null; source: string } | null;
  if (p && p.source !== 'sumit' && isEntitled(p)) throw new SubError('already_has_access');

  const existing = await getSubscription(email);
  if (existing && existing.status === 'active' && !existing.cancel_at_period_end
      && isEntitled({ status: existing.status, current_period_end: existing.current_period_end })) {
    throw new SubError('already_subscribed');
  }
  // A customer whose last charge failed re-enters their card through a NEW standing order.
  // Stop the old one first, or both could charge them once the card works again.
  if (existing?.status === 'past_due' && existing.sumit_recurring_item_id) {
    const stopped = await cancelRecurring(existing.sumit_customer_id, existing.sumit_recurring_item_id);
    if (!stopped) throw new SubError('sumit', 'לא הצלחנו לעדכן את המנוי הקודם. נסו שוב או פנו אלינו.');
    await supabase.from('seo_subscriptions').update({ sumit_recurring_item_id: null }).eq('id', existing.id);
  }

  let subId: string;
  if (!existing) {
    const { data, error } = await supabase.from('seo_subscriptions')
      .insert({ email, status: 'pending', amount: price }).select('id').single();
    if (error || !data) throw dbError(error ?? { message: 'insert failed' });
    subId = (data as { id: string }).id;
  } else {
    subId = existing.id;
    const patch: Record<string, unknown> = { amount: price, updated_at: new Date().toISOString() };
    if (existing.status === 'canceled' || existing.status === 'pending') patch.status = 'pending';
    const { error } = await supabase.from('seo_subscriptions').update(patch).eq('id', subId);
    if (error) throw dbError(error);
  }

  try {
    return await beginRecurringRedirect({
      itemName: seoPlanName(),
      amount: price,
      externalIdentifier: subId,
      redirectUrl: `${API_URL}/api/seo/subscription/return?ref=${subId}`,
      cancelRedirectUrl: `${API_URL}/api/seo/subscription/return?ref=${subId}&cancel=1`,
      customerEmail: email,
    });
  } catch (e) {
    throw new SubError('sumit', e instanceof Error ? e.message : undefined);
  }
}

// ─── A SUMIT payment was reported (return redirect, trigger, or sweep) ──────

export type PaymentOutcome = 'activated' | 'failed' | 'duplicate' | 'underpaid' | 'ignored' | 'unknown';

export async function applyVerifiedPayment(
  subscriptionId: string,
  payment: { sumitPaymentId: string; valid: boolean; amount: number },
  extra: { sumitCustomerId?: string; sumitRecurringItemId?: string } = {},
  now = new Date(),
): Promise<PaymentOutcome> {
  const row = await getById(subscriptionId);
  if (!row) return 'unknown';

  const sufficient = payment.valid && payment.amount + 0.01 >= Number(row.amount);
  const kind = sufficient ? 'charge_ok' : 'charge_failed';

  // Replay guard FIRST: one SUMIT payment id can move a subscription once, ever.
  const { error: evErr } = await supabase.from('seo_subscription_events').insert({
    subscription_id: row.id, kind, sumit_payment_id: payment.sumitPaymentId, amount: payment.amount,
  });
  if (evErr) {
    if (evErr.code === '23505') return 'duplicate';
    throw dbError(evErr);
  }

  const current = stateOf(row);
  if (sufficient) {
    const { state, ignored } = applyChargeOk(current, now);
    if (ignored) {
      console.error('[SUBSCRIPTION] payment on a canceled subscription — needs a human (refund?)', { id: row.id, payment: payment.sumitPaymentId });
      return 'ignored';
    }
    await saveState(row, state, {
      needs_manual_cancel: false,
      ...(extra.sumitCustomerId ? { sumit_customer_id: extra.sumitCustomerId } : {}),
      ...(extra.sumitRecurringItemId ? { sumit_recurring_item_id: extra.sumitRecurringItemId } : {}),
    });
    return 'activated';
  }

  if (payment.valid) {
    console.error('[SUBSCRIPTION] payment valid but below the plan price — not activating', { id: row.id, paid: payment.amount, due: row.amount });
  }
  const failed = applyChargeFailed(current);
  if (!sameState(failed, current)) await saveState(row, failed);
  return payment.valid ? 'underpaid' : 'failed';
}

export async function subscriptionIdExists(id: string): Promise<boolean> {
  return (await getById(id)) !== null;
}

// ─── Cancel ─────────────────────────────────────────────────────────────────

export async function cancelSubscription(email: string, now = new Date()): Promise<SubRow> {
  const row = await getSubscription(email);
  if (!row || row.status === 'canceled') throw new SubError('no_subscription');

  // Stop the charges at SUMIT first. If that fails, the customer's cancellation is still
  // honoured here (access ends at period end) and a human is told to stop it at SUMIT.
  const stopped = row.status === 'pending' && !row.sumit_recurring_item_id
    ? true
    : await cancelRecurring(row.sumit_customer_id, row.sumit_recurring_item_id);
  if (!stopped) {
    console.error('[SUBSCRIPTION] MANUAL ACTION: cancel the standing order in the SUMIT dashboard for', row.email);
  }

  const next = applyCancel(stateOf(row), now);
  await saveState(row, next, { needs_manual_cancel: !stopped });
  await supabase.from('seo_subscription_events').insert({ subscription_id: row.id, kind: 'canceled' });
  return (await getById(row.id)) as SubRow;
}

// ─── Time-driven housekeeping ────────────────────────────────────────────────

export async function sweepSubscriptions(now = new Date()): Promise<number> {
  const { data, error } = await supabase.from('seo_subscriptions').select(COLS).in('status', ['active', 'past_due']);
  if (error) {
    const e = dbError(error);
    if (e.code !== 'not_migrated') console.error('[SUBSCRIPTION] sweep read failed:', error.message);
    return 0;
  }
  let changed = 0;
  for (const row of (data ?? []) as SubRow[]) {
    const cur = stateOf(row);
    const next = expire(cur, now);
    if (sameState(cur, next)) continue;
    try {
      await saveState(row, next);
      changed += 1;
    } catch (e) {
      console.error('[SUBSCRIPTION] sweep update failed:', row.id, e instanceof Error ? e.message : e);
    }
  }
  return changed;
}

const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
export function startSubscriptionSweep(): void {
  const run = () => { sweepSubscriptions().catch(e => console.error('[SUBSCRIPTION] sweep crashed:', e)); };
  setTimeout(run, 60 * 1000);
  setInterval(run, SWEEP_EVERY_MS).unref?.();
}
