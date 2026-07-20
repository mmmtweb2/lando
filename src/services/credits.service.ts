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
