import { supabase } from '../config/supabase';

/**
 * Checks the user's credit balance and atomically deducts `cost` credits.
 * Throws "Insufficient credits" (HTTP 402) if balance < cost.
 * Returns the new balance after deduction.
 */
export async function checkAndDeductCredits(email: string, cost: number): Promise<number> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('credits')
    .eq('email', email)
    .single();

  if (error || !data) {
    throw new Error('User profile not found');
  }

  const current = (data as { credits: number }).credits ?? 0;
  if (current < cost) {
    throw new Error('Insufficient credits');
  }

  // Conditional update: only succeeds if credits haven't dropped below cost since the read.
  const { data: updated, error: updateErr } = await supabase
    .from('user_profiles')
    .update({ credits: current - cost })
    .eq('email', email)
    .gte('credits', cost)
    .select('credits')
    .single();

  if (updateErr || !updated) {
    throw new Error('Insufficient credits');
  }

  return (updated as { credits: number }).credits;
}
