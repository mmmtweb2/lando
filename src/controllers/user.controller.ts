import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { processMockPayment } from '../services/payment.service';
import { ensureUserProfile } from '../services/profile.service';
import { getPlanStatus } from '../services/plan.service';
import { addCredits } from '../services/credits.service';
import { PLANS } from '../config/plans';

const SELECT_FIELDS = 'email, affiliate_code, credits, earned_coupons, signup_discount, referred_by_code';
const REFERRAL_BONUS = 5; // credits granted to BOTH the referrer and the new user

// Credit packs. Prices in ₪.
export const CREDIT_PACKS: Record<string, { credits: number; price: number }> = {
  small: { credits: 10, price: 49 },
  large: { credits: 100, price: 399 },
};

/**
 * Adds a pack's credits to a user's balance. Shared by the (legacy mock)
 * purchase endpoint and the real SUMIT payment-return handler.
 * Returns the new balance, or null on failure / unknown pack.
 */
export async function grantCreditsForPack(email: string, packKey: string): Promise<number | null> {
  const pack = CREDIT_PACKS[packKey];
  if (!pack) return null;
  // These are credits the customer PAID for — a lost update here means money
  // taken and value not delivered. addCredits does a compare-and-swap instead
  // of the read-then-write this used to do, so a grant that overlaps with any
  // other balance change (a deduction, another grant) can't be silently
  // clobbered.
  return addCredits(email, pack.credits);
}

function generateAffiliateCode(): string {
  return randomBytes(3).toString('hex').toUpperCase(); // 6 chars e.g. "A3F9C1"
}

export async function authUser(req: Request, res: Response): Promise<void> {
  // Identity comes ONLY from the verified Supabase session (req.authEmail, set
  // by requireAuth) — never from the request body. Previously this endpoint
  // trusted a client-supplied email with no auth check at all, so anyone could
  // fetch (or silently create) any other user's profile — including their
  // affiliate_code, credits, earned_coupons and referral info — just by
  // guessing/knowing their email address.
  const { ref } = req.body as { ref?: string };
  const email = req.authEmail;

  if (!email) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRef   = ref ? ref.trim().toUpperCase() : null;

  // Returning user — just send back their profile
  const { data: existing } = await supabase
    .from('user_profiles')
    .select(SELECT_FIELDS)
    .eq('email', normalizedEmail)
    .single();

  if (existing) {
    // Backfill a missing affiliate_code (legacy profiles) so referral links use a
    // real code instead of falling back to the user's email.
    if (!(existing as { affiliate_code?: string }).affiliate_code) {
      const code = generateAffiliateCode();
      await supabase.from('user_profiles').update({ affiliate_code: code }).eq('email', normalizedEmail);
      (existing as { affiliate_code?: string }).affiliate_code = code;
    }
    res.json(existing);
    return;
  }

  // New user — validate referral code if provided
  let validRef: string | null = null;
  if (normalizedRef) {
    const { data: referrer } = await supabase
      .from('user_profiles')
      .select('email, affiliate_code, earned_coupons, credits')
      .eq('affiliate_code', normalizedRef)
      .single();

    if (referrer) {
      validRef = normalizedRef;
      // Reward the referrer: +1 coupon (for tracking) AND +5 real credits.
      // The coupon counter can stay a plain write, but the credit balance goes
      // through addCredits: the referrer is an active user whose balance may be
      // changing at the same moment, and a read-then-write here would undo
      // whatever they spent in between (restoring spent credits = a mint).
      const referrerEmail = (referrer as { email?: string }).email;
      await supabase
        .from('user_profiles')
        .update({ earned_coupons: (referrer.earned_coupons ?? 0) + 1 })
        .eq('affiliate_code', normalizedRef);
      if (referrerEmail) {
        await addCredits(referrerEmail, REFERRAL_BONUS);
      } else {
        console.error('[REFERRAL] referrer row has no email — credit bonus skipped', { code: normalizedRef });
      }
    }
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .insert({
      email:           normalizedEmail,
      affiliate_code:  generateAffiliateCode(),
      earned_coupons:  0,
      signup_discount: validRef !== null,
      referred_by_code: validRef,
    })
    .select(SELECT_FIELDS)
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Reward the referred new user: +5 credits on top of the signup default.
  if (validRef && data) {
    const profile = data as { credits?: number };
    const newCredits = await addCredits(normalizedEmail, REFERRAL_BONUS);
    if (newCredits !== null) profile.credits = newCredits;
  }

  res.status(201).json(data);
}

// ─── Current user's credit balance ────────────────────────────────────────────
// Routed through the backend (service-role) so the browser's WalletBadge doesn't
// read user_profiles directly — lets us lock RLS to deny-all for the anon key.
export async function getCredits(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }
  const profile = await ensureUserProfile(email);
  res.json({ credits: profile.credits ?? 0 });
}

// ─── Current user's plan + usage (for the dashboard) ──────────────────────────
// Also returns the plan catalog so the client renders pricing from one source.
export async function getPlan(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }
  const status = await getPlanStatus(email);
  res.json({ status, plans: PLANS });
}

// ─── Credit pack purchase (mock checkout — DEV/TEST ONLY, see below) ──────────
export async function purchaseCredits(req: Request, res: Response): Promise<void> {
  // This endpoint uses processMockPayment(), which always "succeeds" without
  // charging anything. It must never run in production — SUMIT
  // (payment.controller.ts) is the real, verified checkout path. Previously
  // this route also trusted req.body.email (spoofable) instead of the
  // verified session; it now requires requireAuth (see routes) and uses that
  // identity only, so it can no longer be used to credit an arbitrary account.
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Mock checkout is disabled in production. Use the real checkout.' });
    return;
  }
  const email = req.authEmail;
  const { pack } = req.body as { pack?: string };
  if (!email) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }
  const chosen = pack ? CREDIT_PACKS[pack] : undefined;
  if (!chosen) {
    res.status(400).json({ error: `pack must be one of: ${Object.keys(CREDIT_PACKS).join(', ')}` });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  let result;
  try {
    result = await processMockPayment(`credits_${normalizedEmail}`, chosen.price);
  } catch {
    res.status(402).json({ error: 'Payment failed' });
    return;
  }
  if (!result.success) {
    res.status(402).json({ error: 'Payment declined' });
    return;
  }

  const profile = await ensureUserProfile(normalizedEmail);
  const newBalance = (profile.credits ?? 0) + chosen.credits;
  const { error } = await supabase
    .from('user_profiles')
    .update({ credits: newBalance })
    .eq('email', normalizedEmail);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ credits: newBalance, added: chosen.credits, transactionId: result.transactionId });
}
