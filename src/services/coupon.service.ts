// ─────────────────────────────────────────────────────────────────────────────
// Coupon service — validating a discount code and consuming one use of it.
//
// A coupon only ever changes the ₪ AMOUNT of a single payment. It never decides
// what the customer receives: that is still driven entirely by
// `payments.purpose` on the verified return (grantPaymentValue). So the worst a
// broken coupon can do is undercharge — it can never mint page credits, AI
// credits or white-label.
//
// Two entry points, and the difference between them matters:
//   • checkCoupon()   — READ-ONLY. Used by POST /api/payments/validate-coupon
//                       so the client can preview a discounted price. Counts
//                       nothing, changes nothing, and is never trusted later.
//   • redeemCoupon()  — CONSUMES one use, by compare-and-swap. Called exactly
//                       once, inside startPayment, after checkCoupon has passed
//                       again server-side.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';

export type DiscountType = 'percent' | 'fixed';

/** The purposes a coupon can be restricted to — mirrors `payments.purpose`. */
export const COUPON_PURPOSES = ['publish', 'renew', 'credits', 'bundle'] as const;
export type CouponPurpose = (typeof COUPON_PURPOSES)[number];

export function isCouponPurpose(value: unknown): value is CouponPurpose {
  return typeof value === 'string' && (COUPON_PURPOSES as readonly string[]).includes(value);
}

export interface CouponRow {
  id: string;
  created_at: string;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  applicable_purposes: string[] | null;
  max_redemptions: number | null;
  redemptions_count: number;
  max_per_user: number | null;
  active: boolean;
  expires_at: string | null;
  created_by: string | null;
  notes: string | null;
}

/**
 * SUMIT will not accept a 0₪ charge, and a 0₪ "payment" would never come back
 * verified — the customer would be stranded with an unpublished page and no way
 * to complete. A 100%-off coupon therefore lands on 1₪, not on free.
 */
export const MIN_CHARGE = 1;

/** Codes are stored UPPERCASE; every lookup normalizes the same way. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * The ₪ discount this coupon gives on `amount`, and the amount actually
 * charged. Rounded to agorot so the charge, the invoice and
 * `payments.discount_amount` all agree to the last digit.
 */
export function priceWithCoupon(coupon: CouponRow, amount: number): { finalAmount: number; discountAmount: number } {
  const raw = coupon.discount_type === 'percent'
    ? (amount * Number(coupon.discount_value)) / 100
    : Number(coupon.discount_value);

  const round = (n: number) => Math.round(n * 100) / 100;
  // Clamp to the floor first, then derive the discount from it, so the two
  // numbers can never disagree (discountAmount is always amount - finalAmount).
  const finalAmount = round(Math.max(MIN_CHARGE, amount - raw));
  return { finalAmount, discountAmount: round(amount - finalAmount) };
}

/** Case-insensitive lookup. Codes are written uppercase, so the normalized
 *  equality match IS the case-insensitive one — no ILIKE, and therefore no way
 *  for a `%` in the input to turn a lookup into a pattern scan. */
export async function findCouponByCode(code: string): Promise<CouponRow | null> {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('code', normalized)
    .maybeSingle();
  if (error) {
    console.error('[COUPON] lookup failed:', error.message);
    return null;
  }
  return (data as CouponRow | null) ?? null;
}

export type CouponCheck =
  | { ok: true; coupon: CouponRow }
  | { ok: false; error: string };

/**
 * Every rule EXCEPT actually consuming a use: exists, active, unexpired,
 * applies to this purpose, not exhausted, and this user is under their personal
 * cap. Read-only, so it is safe to call from the preview endpoint and again
 * from startPayment.
 *
 * The per-user check has a small race against the same user opening two
 * checkouts at once; that is accepted and documented at the call site in
 * startPayment. The GLOBAL cap is the one with real money exposure and it is
 * enforced by the CAS in redeemCoupon(), not here.
 */
export async function checkCoupon(code: string, purpose: string, email: string): Promise<CouponCheck> {
  const coupon = await findCouponByCode(code);
  if (!coupon) return { ok: false, error: 'קוד הקופון אינו קיים.' };
  if (!coupon.active) return { ok: false, error: 'הקופון אינו פעיל.' };
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'תוקף הקופון פג.' };
  }

  const purposes = coupon.applicable_purposes ?? [];
  if (purposes.length > 0 && !purposes.includes(purpose)) {
    return { ok: false, error: 'הקופון אינו תקף לרכישה זו.' };
  }

  if (coupon.max_redemptions !== null && coupon.redemptions_count >= coupon.max_redemptions) {
    return { ok: false, error: 'הקופון מוצה — נעשה בו שימוש במלוא מספר הפעמים.' };
  }

  if (coupon.max_per_user !== null) {
    const normalizedEmail = email.trim().toLowerCase();
    const { count, error } = await supabase
      .from('coupon_redemptions')
      .select('id', { count: 'exact', head: true })
      .eq('coupon_id', coupon.id)
      .eq('user_email', normalizedEmail);
    if (error) {
      // Fail CLOSED: an unreadable redemption history must not become a free
      // pass around a per-user cap the admin deliberately set.
      console.error('[COUPON] per-user cap check failed:', error.message);
      return { ok: false, error: 'לא ניתן לאמת את הקופון כרגע. נסו שוב.' };
    }
    if ((count ?? 0) >= coupon.max_per_user) {
      return { ok: false, error: 'כבר השתמשת בקופון הזה את מספר הפעמים המותר.' };
    }
  }

  return { ok: true, coupon };
}

/**
 * Consumes ONE use of the coupon, atomically. Returns the updated row, or null
 * if the use could not be claimed (exhausted, deactivated, or lost the race).
 *
 * PostgREST cannot express `redemptions_count = redemptions_count + 1`, so this
 * is the same compare-and-swap the rest of the codebase uses for money-adjacent
 * counters (addCredits in credits.service.ts, the payment claim in
 * paymentReturn): re-read the row, then write `n + 1` conditional on the column
 * still being exactly `n`. Two concurrent checkouts for the last use of a
 * limited coupon therefore cannot both win — one of them matches zero rows.
 *
 * `active` is re-asserted in the same statement so an admin who switches a
 * coupon off mid-race stops it immediately.
 */
export async function redeemCoupon(couponId: string): Promise<CouponRow | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: fresh, error: readErr } = await supabase
      .from('coupons')
      .select('*')
      .eq('id', couponId)
      .maybeSingle();
    if (readErr || !fresh) {
      console.error('[COUPON] redeem: re-read failed', readErr?.message ?? 'not found');
      return null;
    }
    const coupon = fresh as CouponRow;
    if (!coupon.active) return null;
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= Date.now()) return null;
    if (coupon.max_redemptions !== null && coupon.redemptions_count >= coupon.max_redemptions) return null;

    const { data, error } = await supabase
      .from('coupons')
      .update({ redemptions_count: coupon.redemptions_count + 1 })
      .eq('id', couponId)
      .eq('redemptions_count', coupon.redemptions_count) // CAS: nothing consumed since the read
      .eq('active', true)
      .select('*')
      .maybeSingle();
    if (error) {
      console.error('[COUPON] redeem CAS failed:', error.message);
      return null;
    }
    if (data) return data as CouponRow;
    // Lost the swap — another checkout consumed a use. Re-read and try again;
    // if that use was the last one, the exhaustion check above ends the loop.
  }
  console.error('[COUPON] redeem: gave up after 4 contended attempts', { couponId });
  return null;
}

/**
 * Hands back a use claimed by redeemCoupon() when the checkout it was claimed
 * for never actually opened (the payments insert or the SUMIT redirect failed).
 * Best-effort and never throws: an un-returned use costs the promo one slot,
 * which is a far smaller problem than failing a customer's checkout on top of
 * an already-failed checkout.
 */
export async function releaseRedemption(couponId: string, countAfterRedeem: number): Promise<void> {
  const { error } = await supabase
    .from('coupons')
    .update({ redemptions_count: countAfterRedeem - 1 })
    .eq('id', couponId)
    .eq('redemptions_count', countAfterRedeem); // only if nobody else has moved it since
  if (error) console.error('[COUPON] failed to release an unused redemption', { couponId, error: error.message });
}

/**
 * The audit row. Written right after the counter CAS wins.
 *
 * Deliberately NOT blocking: if this insert fails the checkout still proceeds
 * and we log loudly. The counter is the source of truth for the global cap; the
 * audit row is secondary (its only functional use is the per-user cap, which is
 * explicitly the best-effort half of this design). Supabase gives us no
 * multi-statement transaction here, so the alternative — failing a paid
 * checkout because an audit insert hiccuped — is strictly worse.
 */
export async function recordRedemption(couponId: string, email: string, paymentId: string | null): Promise<void> {
  const { error } = await supabase.from('coupon_redemptions').insert({
    coupon_id: couponId,
    user_email: email.trim().toLowerCase(),
    payment_id: paymentId,
  });
  if (error) {
    console.error('[COUPON] audit row insert FAILED — redemption counted but not attributed', {
      couponId, email, paymentId, error: error.message,
    });
  }
}
