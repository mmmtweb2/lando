import { supabase } from '../config/supabase';
import { ensureUserProfile } from './profile.service';

/**
 * Checks the user's credit balance and atomically deducts `cost` credits.
 * Throws "Insufficient credits" (HTTP 402) if balance < cost.
 * Admins are never charged (used for internal testing / generation).
 * Creates the profile if missing (self-healing). Returns the resulting balance.
 */
export async function checkAndDeductCredits(email: string, cost: number): Promise<number> {
  const normalized = email.trim().toLowerCase();
  const profile = await ensureUserProfile(normalized);
  const current = profile.credits ?? 0;

  // Admins generate for free — no balance check, no deduction.
  if (profile.is_admin) {
    return current;
  }

  if (current < cost) {
    throw new Error('Insufficient credits');
  }

  // Conditional update: only succeeds if credits haven't dropped below cost since the read.
  const { data: updated, error: updateErr } = await supabase
    .from('user_profiles')
    .update({ credits: current - cost })
    .eq('email', normalized)
    .gte('credits', cost)
    .select('credits')
    .single();

  if (updateErr || !updated) {
    throw new Error('Insufficient credits');
  }

  return (updated as { credits: number }).credits;
}

/**
 * Adds `amount` credits to a balance WITHOUT losing a concurrent update.
 *
 * A plain read-then-write (`update({ credits: read + amount })`) drops one of
 * two grants that overlap: both read 100, both write 110, and the customer is
 * short 10 credits they paid for. This does a compare-and-swap on the value it
 * read (`.eq('credits', current)`) and retries against the fresh value if it
 * lost, so overlapping grants both land.
 *
 * Returns the new balance, or null if it could not be applied.
 */
export async function addCredits(email: string, amount: number): Promise<number | null> {
  if (amount === 0) return null;
  const normalized = email.trim().toLowerCase();

  for (let attempt = 0; attempt < 4; attempt++) {
    const profile = await ensureUserProfile(normalized);
    const current = profile.credits ?? 0;
    const { data, error } = await supabase
      .from('user_profiles')
      .update({ credits: current + amount })
      .eq('email', normalized)
      .eq('credits', current) // compare-and-swap: only if nothing changed since the read
      .select('credits')
      .maybeSingle();
    if (error) {
      console.error('[CREDITS] addCredits failed:', error.message);
      return null;
    }
    if (data) return (data as { credits: number }).credits;
    // Lost the swap — someone else changed the balance; re-read and retry.
  }

  console.error('[CREDITS] addCredits: gave up after 4 contended attempts', { email: normalized, amount });
  return null;
}

/**
 * Returns `amount` credits that were deducted for work that then produced
 * nothing (e.g. every image in a batch failed, or the AI call threw after the
 * charge). Never throws — a failed refund must not turn a "your generation
 * failed" response into a 500 on top of it; it is logged instead.
 *
 * Admins are skipped: checkAndDeductCredits never charges them, so refunding
 * one would mint credits out of nothing.
 */
export async function refundCredits(email: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const normalized = email.trim().toLowerCase();
  try {
    const profile = await ensureUserProfile(normalized);
    if (profile.is_admin) return; // was never charged
    const balance = await addCredits(normalized, amount);
    if (balance === null) throw new Error('addCredits returned null');
    console.log('[CREDITS] refunded', amount, 'to', normalized, '→', balance);
  } catch (e) {
    // Worst case the user is short by `amount` and support tops them up.
    console.error('[CREDITS] refund failed', { email: normalized, amount, error: e instanceof Error ? e.message : e });
  }
}
