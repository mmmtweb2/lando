// ─────────────────────────────────────────────────────────────────────────────
// referral.service.ts — the referral credit bonus (+5 referrer / +5 referee).
//
// Previously granted to BOTH sides at signup (user.controller.ts's authUser),
// with no purchase or usage requirement at all. That let anyone mint free AI
// credits indefinitely: sign up under your own referral link with a burner
// email, collect +5/+5, repeat. Flagged (unfixed) in the README's own backlog
// as exactly this — a self-referral credit-mint loop.
//
// Fix: the bonus now fires on the referred user's FIRST PUBLISHED PAGE instead
// of at signup — the simplest real usage milestone available, and the one
// choke point every publish (balance-covered or paid) already passes through
// (`publishPageById`, src/controllers/landing.controller.ts). A signup with no
// real page ever published now earns nothing, closing the mint.
//
// Same amounts as before (REFERRAL_BONUS = 5, both sides) — only the timing
// changed. `addCredits` (credits.service.ts) already does the CAS the AI
// credit balance needs; the new piece here is the CAS on
// `referral_bonus_granted` itself, which makes the whole grant idempotent: a
// page can only ever "first publish" once for a given owner in the sense that
// matters here, but this guards against any race (double-click, a retried
// request) trying to claim the grant twice for the same referee.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';
import { addCredits } from './credits.service';

/** Credits granted to BOTH the referrer and the referee, unchanged from before. */
export const REFERRAL_BONUS = 5;

interface RefereeRow {
  email?: string | null;
  referred_by_code?: string | null;
  referral_bonus_granted?: boolean | null;
}

interface ReferrerRow {
  email?: string | null;
  earned_coupons?: number | null;
}

/**
 * Grants the referral bonus for `refereeEmail`, but only the first time this
 * is called for a referee who:
 *   (a) actually signed up under a referral code (`referred_by_code` is set), and
 *   (b) has not already been granted the bonus (`referral_bonus_granted` is false).
 *
 * Safe to call on EVERY page publish (not just conceptually "the first one") —
 * it early-outs cheaply for the vast majority of publishes (no referral, or
 * already granted) and the actual grant is claimed via compare-and-swap, so
 * two concurrent publishes for the same brand-new referred account can never
 * both win the claim and double-grant.
 *
 * Never throws — a referral-bonus failure must not block or fail a page
 * publish. Failures are logged instead.
 */
export async function grantReferralBonusOnFirstPublish(refereeEmail: string): Promise<void> {
  const normalized = refereeEmail.trim().toLowerCase();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('email, referred_by_code, referral_bonus_granted')
    .eq('email', normalized)
    .maybeSingle();

  if (error) {
    console.error('[REFERRAL] profile lookup failed', { email: normalized, error: error.message });
    return;
  }

  const row = data as RefereeRow | null;
  if (!row || !row.referred_by_code || row.referral_bonus_granted) return; // not referred, or already paid out

  // Claim the grant atomically: only the caller that flips this flag from
  // false to true gets to hand out credits. Everyone else (a concurrent
  // publish, a retried request) finds it already true and does nothing.
  const { data: claimed, error: claimErr } = await supabase
    .from('user_profiles')
    .update({ referral_bonus_granted: true })
    .eq('email', normalized)
    .eq('referral_bonus_granted', false)
    .select('email')
    .maybeSingle();

  if (claimErr) {
    console.error('[REFERRAL] claim failed', { email: normalized, error: claimErr.message });
    return;
  }
  if (!claimed) return; // lost the race — someone else's call already claimed this grant

  // Referee's own bonus. addCredits is itself a CAS on the credit balance, so
  // this can't clobber (or be clobbered by) any other concurrent balance
  // change (a spend, another grant).
  await addCredits(normalized, REFERRAL_BONUS);

  // Referrer's bonus — looked up by code at grant time (not stored redundantly
  // on the referee row), so a referrer who changes their affiliate code, or is
  // deleted, is handled by "not found" below rather than acting on stale data.
  const { data: referrerData, error: referrerErr } = await supabase
    .from('user_profiles')
    .select('email, earned_coupons')
    .eq('affiliate_code', row.referred_by_code)
    .maybeSingle();

  if (referrerErr) {
    console.error('[REFERRAL] referrer lookup failed — referee bonus granted, referrer bonus skipped', {
      code: row.referred_by_code, error: referrerErr.message,
    });
    return;
  }

  const referrer = referrerData as ReferrerRow | null;
  if (!referrer?.email) {
    console.error('[REFERRAL] referrer not found for code — referee bonus granted, referrer bonus skipped', {
      code: row.referred_by_code,
    });
    return;
  }

  await addCredits(referrer.email, REFERRAL_BONUS);
  // Coupon counter (surfaced on the referrer's dashboard as "X referrals").
  // Plain increment, same as the pre-existing signup-time code — a low-stakes
  // display counter, not a money balance, so it doesn't need the CAS discipline
  // addCredits gives the actual credit grant above.
  await supabase
    .from('user_profiles')
    .update({ earned_coupons: (referrer.earned_coupons ?? 0) + 1 })
    .eq('affiliate_code', row.referred_by_code);

  console.log('[REFERRAL] bonus granted on first publish', { referee: normalized, referrer: referrer.email });
}
