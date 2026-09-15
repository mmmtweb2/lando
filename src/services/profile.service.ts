import { randomBytes } from 'crypto';
import { supabase } from '../config/supabase';
import { STARTING_CREDITS } from '../config/credits';
import { sendNewSignupAlert } from './signup.mailer';

export interface MinimalProfile {
  email: string;
  credits: number;
  is_admin: boolean;
}

/**
 * Returns the user's profile, creating a default one (with the standard
 * starting credit grant, STARTING_CREDITS) if it doesn't exist yet. This makes the backend self-healing: a
 * logged-in user who somehow has no profile row gets one instead of being
 * blocked with "profile not found".
 *
 * Requires the backend to use the SERVICE-ROLE key (config/supabase.ts) so the
 * read + insert bypass RLS.
 */
export async function ensureUserProfile(email: string): Promise<MinimalProfile> {
  const normalized = email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from('user_profiles')
    .select('email, credits, is_admin')
    .eq('email', normalized)
    .maybeSingle();

  if (existing) return existing as MinimalProfile;

  const { data: created, error } = await supabase
    .from('user_profiles')
    .insert({
      email: normalized,
      affiliate_code: randomBytes(3).toString('hex').toUpperCase(),
      // Written explicitly rather than leaning on the DB default so the app and
      // the schema can never drift apart on a money value. The DB default is
      // kept in sync by migrations/011_credit_repricing.sql; the derivation of
      // this number lives in src/config/credits.ts.
      credits: STARTING_CREDITS,
    })
    .select('email, credits, is_admin')
    .single();

  if (error || !created) {
    throw new Error(`Failed to create user profile: ${error?.message ?? 'unknown error'}`);
  }

  // Fire-and-forget internal alert — this is the SECOND insert path for a new
  // user_profiles row (see user.controller.ts's authUser for the first); both
  // must trigger the alert since either can win the self-heal race (same
  // reasoning as the referral-attribution fix — see README).
  sendNewSignupAlert(normalized).catch((e) => console.error('[SIGNUP MAIL] failed:', e));

  return created as MinimalProfile;
}
