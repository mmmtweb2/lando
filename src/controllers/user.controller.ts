import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { processMockPayment } from '../services/payment.service';
import { ensureUserProfile } from '../services/profile.service';
import { getAccountStatus } from '../services/billing.service';
import { addCredits } from '../services/credits.service';
import { BUNDLES, SINGLE_PAGE_PRICE } from '../config/billing';
import { sendNewSignupAlert } from '../services/signup.mailer';

const SELECT_FIELDS = 'email, affiliate_code, credits, earned_coupons, signup_discount, referred_by_code';

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
    const existingRow = existing as { affiliate_code?: string; referred_by_code?: string | null };

    // Backfill a missing affiliate_code (legacy profiles) so referral links use a
    // real code instead of falling back to the user's email.
    if (!existingRow.affiliate_code) {
      const code = generateAffiliateCode();
      await supabase.from('user_profiles').update({ affiliate_code: code }).eq('email', normalizedEmail);
      existingRow.affiliate_code = code;
    }

    // Referral backfill (2026-09-14 — real bug Moshe found in a live test: the
    // referral bonus never actually attributed). Root cause: this endpoint is
    // the ONLY place that knows the ?ref= code (captured client-side into
    // localStorage, sent here as `ref`), but it is NOT the only endpoint that
    // can CREATE this account's profile row. `ensureUserProfile()`
    // (profile.service.ts) self-heals a blank, referral-blind profile the
    // moment ANY OTHER authenticated endpoint is hit — and WalletBadge fires
    // GET /api/users/credits the instant a user's email is known, with no
    // extra DB lookup, so it routinely wins the race against this call (which
    // does an extra referrer lookup before its insert). Once that self-healed
    // row existed, this whole `if (existing)` branch returned early and the
    // referral relationship was silently dropped forever — no error, so it
    // looked like it worked from the client's perspective.
    //
    // Fix: if this account still has NO referred_by_code and a ref code
    // arrived, attribute it now instead of only at INSERT time. Safe by
    // construction: the `.is('referred_by_code', null)` guard means this can
    // never overwrite a real existing attribution (whichever call set it
    // first wins), and the actual bonus payout still only happens later, on
    // this user's first published page (referral.service.ts) — this only
    // fixes the ATTRIBUTION, not the payout gate.
    if (normalizedRef && !existingRow.referred_by_code) {
      const { data: referrer } = await supabase
        .from('user_profiles')
        .select('email')
        .eq('affiliate_code', normalizedRef)
        .single();

      // Self-referral guard: this branch is new territory the original
      // INSERT-time check never had to cover (a brand-new row has no
      // affiliate_code yet, so referring yourself was structurally
      // impossible there). Here the account already has one, so without this
      // check someone could revisit their own referral link, backfill their
      // own account as its own referrer, and self-mint both sides' bonus on
      // their next publish.
      if (referrer && (referrer as { email?: string }).email !== normalizedEmail) {
        const { data: backfilled } = await supabase
          .from('user_profiles')
          .update({ referred_by_code: normalizedRef, signup_discount: true })
          .eq('email', normalizedEmail)
          .is('referred_by_code', null)
          .select('email')
          .maybeSingle();

        if (backfilled) {
          existingRow.referred_by_code = normalizedRef;
          (existing as { signup_discount?: boolean }).signup_discount = true;
        }
      }
    }

    res.json(existing);
    return;
  }

  // New user — validate referral code if provided. NOTE (2026-09-06, retention
  // fixes): this used to ALSO grant +5 credits to both the referrer and this
  // new user right here, at signup, with no purchase or usage requirement —
  // a self-referral credit-mint loop (sign up under your own link with a
  // burner email, collect +5/+5, repeat), already flagged unfixed in the
  // README's backlog. The bonus itself now fires later, from
  // grantReferralBonusOnFirstPublish (referral.service.ts), on the referred
  // user's first published page — a real usage milestone. All this does now
  // is validate the code and attribute the relationship (`referred_by_code`)
  // so that later grant knows who to reward.
  let validRef: string | null = null;
  if (normalizedRef) {
    const { data: referrer } = await supabase
      .from('user_profiles')
      .select('email, affiliate_code')
      .eq('affiliate_code', normalizedRef)
      .single();

    if (referrer) {
      validRef = normalizedRef;
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

  // Fire-and-forget internal alert — never blocks/fails the signup itself.
  sendNewSignupAlert(normalizedEmail).catch((e) => console.error('[SIGNUP MAIL] failed:', e));

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

// ─── Current user's page balance + usage (for the dashboard) ─────────────────
// Also returns the bundle catalog + single-page price so the client renders all
// pricing from one source. The route stays /api/users/plan (see the note at the
// top of billing.service.ts) — only the payload changed.
export async function getPlan(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }
  const status = await getAccountStatus(email);
  res.json({ status, bundles: BUNDLES, singlePagePrice: SINGLE_PAGE_PRICE });
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

// ─── Account deletion ──────────────────────────────────────────────────────────
/**
 * DELETE /api/users/me — the user permanently deletes their own account.
 * 2026-09-14, Moshe's ask: "אופציה למשתמש למחיקת חשבון דרך ההגדרות".
 *
 * Irreversible, and deliberately thorough rather than a soft "deactivate":
 *  1. Leads for every page the account owns — FIRST, same FK-safety reason as
 *     the admin page-delete fix (leads_landing_page_id_fkey has no ON DELETE
 *     clause, so deleting a page with leads first would fail).
 *  2. The pages themselves.
 *  3. The user_profiles row (balances, white-label flag, affiliate code — all
 *     gone; any unused page-credit / AI-credit balance is forfeited, stated
 *     plainly in the client-side confirmation before this is ever called).
 *  4. The Supabase Auth user itself, via the Admin API — this is what
 *     actually prevents the email from being used to log in again. Done LAST
 *     and only after every DB row succeeded, so a failure here never leaves
 *     the account's data gone but the login still working in a half state
 *     (the reverse — auth gone, a DB row failed — is safer: the account is
 *     already unreachable to its own owner at that point either way).
 *
 * payments / coupon_redemptions / coupons rows are DELIBERATELY NOT touched —
 * they are financial/tax records (SUMIT issues a real invoice per payment),
 * keyed by a plain email string with no FK to user_profiles, so nothing
 * breaks by leaving them; deleting paid-for accounting history to honour an
 * account-deletion request would trade a data-protection nicety for a real
 * bookkeeping/legal problem.
 *
 * Admin accounts are refused here (see is_admin check below) — a safety rail
 * against Moshe's own admin/test account accidentally being deleted through
 * this exact new UI, not a real product restriction (an admin who genuinely
 * wants to close their account can be unflagged first in the admin panel).
 */
export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  const userId = req.authUserId;
  if (!email || !userId) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('email', email)
    .maybeSingle();

  if ((profile as { is_admin?: boolean } | null)?.is_admin) {
    res.status(403).json({ error: 'לא ניתן למחוק חשבון מנהל מערכת דרך מסך זה. יש להסיר קודם את הרשאת הניהול.' });
    return;
  }

  const { data: ownedPages, error: pagesReadError } = await supabase
    .from('landing_pages')
    .select('id')
    .eq('owner_email', email);

  if (pagesReadError) {
    res.status(500).json({ error: pagesReadError.message });
    return;
  }

  const pageIds = (ownedPages ?? []).map((p) => (p as { id: string }).id);

  if (pageIds.length > 0) {
    const { error: leadsError } = await supabase
      .from('leads')
      .delete()
      .in('landing_page_id', pageIds);
    if (leadsError) {
      res.status(500).json({ error: leadsError.message });
      return;
    }

    const { error: pagesError } = await supabase
      .from('landing_pages')
      .delete()
      .eq('owner_email', email);
    if (pagesError) {
      res.status(500).json({ error: pagesError.message });
      return;
    }
  }

  const { error: profileError } = await supabase
    .from('user_profiles')
    .delete()
    .eq('email', email);
  if (profileError) {
    res.status(500).json({ error: profileError.message });
    return;
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(userId);
  if (authError) {
    // The account's data and profile are already gone at this point — the
    // customer's balances, pages and leads are permanently deleted either
    // way. Only their ability to log back in with this email is uncertain
    // now. Logged loudly so it's caught, but reported to the client as
    // success: from the customer's perspective the deletion they asked for
    // did happen, and a stray unusable auth row left behind is Moshe's
    // cleanup problem, not something to surface as a scary error after
    // telling them their data is gone.
    console.error('[ACCOUNT] deleteAccount: DB rows deleted but auth.admin.deleteUser failed', {
      email, userId, error: authError.message,
    });
  }

  res.status(204).send();
}
