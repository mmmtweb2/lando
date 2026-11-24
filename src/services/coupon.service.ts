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

/**
 * The purposes a coupon can be restricted to. The first four mirror `payments.purpose` (landing-page
 * purchases). The two `seo_*` ones are the Google-promotion subscription (README part 148, migration
 * 056): it has no `payments` row, and a coupon reaches it only when one of them is listed EXPLICITLY.
 */
export const COUPON_PURPOSES = ['publish', 'renew', 'credits', 'bundle', 'seo_monthly', 'seo_annual'] as const;
export type CouponPurpose = (typeof COUPON_PURPOSES)[number];

export function isCouponPurpose(value: unknown): value is CouponPurpose {
  return typeof value === 'string' && (COUPON_PURPOSES as readonly string[]).includes(value);
}

export const SEO_COUPON_PURPOSES = ['seo_monthly', 'seo_annual'] as const;
export type SeoCouponPurpose = (typeof SEO_COUPON_PURPOSES)[number];
export function isSeoCouponPurpose(value: unknown): value is SeoCouponPurpose {
  return typeof value === 'string' && (SEO_COUPON_PURPOSES as readonly string[]).includes(value);
}

/** 'first' = only the first payment of the subscription is discounted; 'forever' = every payment. */
export type SeoDuration = 'first' | 'forever';
export const isSeoDuration = (v: unknown): v is SeoDuration => v === 'first' || v === 'forever';


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
  /** Migration 056. `undefined` on a database where 056 has not run: subscription coupons are then unavailable. */
  seo_duration?: SeoDuration;
  /** Migration 057 (README part 151): the code works only from this moment. Absent/NULL = from creation. */
  starts_at?: string | null;
}

/**
 * SUMIT will not accept a 0₪ charge, and a 0₪ "payment" would never come back
 * verified — the customer would be stranded with an unpublished page and no way
 * to complete. A 100%-off coupon therefore lands on 1₪, not on free.
 * On the subscription it is also what puts the card on file: a monthly standing order cannot be created
 * without one (README part 151, product decision). The customer is TOLD so ("₪1 בלבד לאימות אמצעי
 * התשלום", `minCharge: true` from validate-coupon), and the admin form warns when a code reaches it.
 */
export const MIN_CHARGE = 1;

/** Did the coupon push this price down to the MIN_CHARGE floor (a 100% code, or a fixed one at/above the price)? */
export function hitsMinCharge(coupon: Pick<CouponRow, 'discount_type' | 'discount_value'>, amount: number): boolean {
  const raw = coupon.discount_type === 'percent' ? (amount * Number(coupon.discount_value)) / 100 : Number(coupon.discount_value);
  return amount > MIN_CHARGE && amount - raw <= MIN_CHARGE;
}

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

/**
 * A subscription coupon priced against the plan's list price.
 *   firstAmount      what the checkout (the first payment) charges; never below MIN_CHARGE
 *   discountAmount   listPrice - firstAmount
 *   recurringAmount  what each later payment (the standing order) charges: the discounted price for
 *                    'forever', the list price for 'first'. Meaningless on the annual plan (no renewals).
 */
export function seoCouponPricing(coupon: CouponRow, listPrice: number): {
  firstAmount: number; discountAmount: number; recurringAmount: number; duration: SeoDuration;
} {
  const { finalAmount, discountAmount } = priceWithCoupon(coupon, listPrice);
  const duration: SeoDuration = coupon.seo_duration === 'forever' ? 'forever' : 'first';
  return { firstAmount: finalAmount, discountAmount, recurringAmount: duration === 'forever' ? finalAmount : listPrice, duration };
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

/**
 * Why a code cannot be used (README part 151). The customer sees a plain Hebrew sentence for each one
 * (couponReasonMessage) instead of a bare "not valid". `not_found` is the only answer that says nothing
 * about a real code; telling the other cases apart reveals that a code exists, which is acceptable behind
 * the rate limits of /api/payments/validate-coupon (per IP and per account, payment.routes.ts).
 */
export const COUPON_REASONS = [
  'not_found', 'expired', 'not_started', 'exhausted', 'already_used_by_you', 'wrong_plan', 'not_for_this_product',
  'unavailable', 'check_failed', 'test_mode',
] as const;
export type CouponReason = (typeof COUPON_REASONS)[number];

export type CouponCheck =
  | { ok: true; coupon: CouponRow }
  | { ok: false; error: string; reason: CouponReason; /** wrong_plan: the purposes the code DOES apply to. */ fits?: CouponPurpose[] };

const LANDING_PURPOSE_LABEL: Record<string, string> = {
  publish: 'פרסום דף', renew: 'חידוש דף', credits: 'קניית קרדיטים', bundle: 'חבילת דפים',
};

function dateHe(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Asia/Jerusalem, so the server and the customer agree on the day.
  return d.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
}

/** The one sentence the customer reads for each reason. Plain Hebrew, plural address, no jargon. */
export function couponReasonMessage(
  reason: CouponReason,
  ctx: { purpose?: string; fits?: readonly string[]; date?: string | null; perUser?: number | null } = {},
): string {
  switch (reason) {
    case 'not_found': return 'לא מצאנו קוד הנחה כזה. בדקו שהקוד הוקלד בדיוק כמו שקיבלתם אותו.';
    case 'expired': return ctx.date ? `תוקף הקוד הזה הסתיים ב-${dateHe(ctx.date)}, ולכן אי אפשר להשתמש בו.` : 'תוקף הקוד הזה הסתיים, ולכן אי אפשר להשתמש בו.';
    case 'not_started': return ctx.date ? `הקוד הזה עדיין לא פעיל. אפשר להשתמש בו החל מ-${dateHe(ctx.date)}.` : 'הקוד הזה עדיין לא פעיל.';
    case 'exhausted': return 'הקוד הזה כבר נוצל עד הסוף: כל השימושים שהוקצו לו נגמרו.';
    case 'already_used_by_you':
      return ctx.perUser && ctx.perUser > 1
        ? `כבר השתמשתם בקוד הזה ${ctx.perUser} פעמים, וזה המספר המרבי לכל חשבון.`
        : 'כבר השתמשתם בקוד הזה בחשבון שלכם, ואפשר להשתמש בו פעם אחת בלבד לכל חשבון.';
    case 'wrong_plan': {
      const fits = ctx.fits ?? [];
      if (fits.includes('seo_monthly') && !fits.includes('seo_annual')) return 'הקוד הזה חל רק על המסלול החודשי.';
      if (fits.includes('seo_annual') && !fits.includes('seo_monthly')) return 'הקוד הזה חל רק על המסלול השנתי.';
      const names = fits.map(f => LANDING_PURPOSE_LABEL[f]).filter(Boolean);
      return names.length ? `הקוד הזה חל רק על: ${names.join(', ')}.` : 'הקוד הזה לא חל על הרכישה הזו.';
    }
    case 'not_for_this_product':
      return isSeoCouponPurpose(ctx.purpose)
        ? 'הקוד הזה מיועד לרכישת דפי נחיתה ב-Pagey, ולא למנוי קידום העסק בגוגל.'
        : 'הקוד הזה מיועד למנוי קידום העסק בגוגל, ולא לרכישה הזו.';
    case 'unavailable': return 'קודי הנחה למנוי עדיין לא זמינים. אפשר להמשיך לתשלום במחיר הרגיל.';
    case 'check_failed': return 'לא הצלחנו לבדוק את הקוד כרגע. נסו שוב בעוד רגע.';
    case 'test_mode': return 'החשבון במצב בדיקת תשלום, ולכן קוד הנחה לא חל.';
  }
}

/** A refusal: the reason code, its sentence, and (wrong_plan) what the code does fit. */
export function couponRefusal(reason: CouponReason, ctx: Parameters<typeof couponReasonMessage>[1] = {}): Extract<CouponCheck, { ok: false }> {
  const fits = (ctx.fits ?? []).filter(isCouponPurpose);
  return { ok: false, reason, error: couponReasonMessage(reason, ctx), ...(reason === 'wrong_plan' && fits.length ? { fits } : {}) };
}

/**
 * The rules that need no redemption history: live, inside its dates, and for this purchase. Shared by
 * checkCoupon and checkCouponRetry, so both give the same reason for the same code. null = passes.
 */
function liveAndApplies(coupon: CouponRow, purpose: string, now = Date.now()): Extract<CouponCheck, { ok: false }> | null {
  // A code the admin switched off reads, to the customer, as a promotion that ended.
  if (!coupon.active) return couponRefusal('expired');
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() <= now) return couponRefusal('expired', { date: coupon.expires_at });
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) return couponRefusal('not_started', { date: coupon.starts_at });

  const purposes = coupon.applicable_purposes ?? [];
  const seoListed = purposes.filter(isSeoCouponPurpose);
  if (isSeoCouponPurpose(purpose)) {
    // The subscription is never covered by "any purpose": a landing-page promo must not quietly discount
    // a recurring charge. Without migration 056 there is no seo_duration, so nothing can say how long the
    // discount lasts: the code cannot be used there yet.
    if (seoListed.length === 0) return couponRefusal('not_for_this_product', { purpose });
    if (!seoListed.includes(purpose)) return couponRefusal('wrong_plan', { purpose, fits: seoListed });
    if (!isSeoDuration(coupon.seo_duration)) return couponRefusal('unavailable');
  } else if (purposes.length > 0 && !purposes.includes(purpose)) {
    const landing = purposes.filter(p => !isSeoCouponPurpose(p));
    if (landing.length === 0) return couponRefusal('not_for_this_product', { purpose });
    return couponRefusal('wrong_plan', { purpose, fits: landing });
  }
  return null;
}

/**
 * Every rule EXCEPT actually consuming a use: exists, active, inside its dates, applies to this purpose,
 * not exhausted, and this user is under their personal cap. Read-only, so it is safe to call from the
 * preview endpoint and again from startPayment. A refusal carries a reason code and its Hebrew sentence.
 *
 * The per-user check has a small race against the same user opening two
 * checkouts at once; that is accepted and documented at the call site in
 * startPayment. The GLOBAL cap is the one with real money exposure and it is
 * enforced by the CAS in redeemCoupon(), not here.
 */
export async function checkCoupon(code: string, purpose: string, email: string): Promise<CouponCheck> {
  const coupon = await findCouponByCode(code);
  if (!coupon) return couponRefusal('not_found');
  const rule = liveAndApplies(coupon, purpose);
  if (rule) return rule;

  if (coupon.max_redemptions !== null && coupon.redemptions_count >= coupon.max_redemptions) {
    return couponRefusal('exhausted');
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
      return couponRefusal('check_failed');
    }
    if ((count ?? 0) >= coupon.max_per_user) {
      return couponRefusal('already_used_by_you', { perUser: coupon.max_per_user });
    }
  }

  return { ok: true, coupon };
}

/**
 * The same customer re-opening the checkout of the SAME still-unpaid subscription with the SAME code
 * (they closed SUMIT's page, or asked for a link to pay from another device). Their use was already
 * counted when the first checkout opened, so this neither counts again nor trips the per-user cap: it
 * only re-checks that the coupon is still live and still valid for this plan. Read-only.
 */
export async function checkCouponRetry(code: string, purpose: string, couponId: string): Promise<CouponCheck> {
  const coupon = await findCouponByCode(code);
  if (!coupon || coupon.id !== couponId) return couponRefusal('not_found');
  return liveAndApplies(coupon, purpose) ?? { ok: true, coupon };
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
