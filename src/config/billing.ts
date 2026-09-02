// ─────────────────────────────────────────────────────────────────────────────
// Billing configuration — what a customer can buy, and what it grants.
//
// ── The model (2026-09-01, Moshe's call — replaces yearly subscriptions) ─────
//
// There are no subscriptions any more. Everything is a ONE-TIME purchase that
// tops up a non-expiring PAGE-PUBLISH BALANCE (`user_profiles.page_credits`).
// Publishing a page costs exactly one page credit, whichever way it was bought:
//
//   • Single page — 249₪, buys 1 page credit. UNCHANGED, deliberately: Moshe
//     wants the core product to stay a one-time purchase, as differentiation
//     against the subscription-only market.
//   • חבילת 5 דפים  —   930₪  → 5 page credits  (186₪/page, ~25% off)
//   • חבילת 10 דפים — 1,250₪  → 10 page credits (125₪/page, exactly half price)
//                              + PERMANENT white-label (hide the Pagey badge)
//
// A bundle never expires and has no renewal date. It is not a plan: there is no
// `plan_expires_at` cliff, no monthly refill, no "active plan" state. Buy once,
// spend whenever. (Each individual PUBLISHED page still expires and renews
// annually — that is a separate, pre-existing mechanism, untouched here.)
//
// The old `freelancer`/`agency` yearly plans are gone. Existing active
// subscribers are converted to an equivalent page balance by
// migrations/012_page_bundles.sql; `grantLegacyPlan()` in billing.service.ts
// still honours any in-flight `purpose:'plan'` payment for the same reason.
// ─────────────────────────────────────────────────────────────────────────────

import { CREDIT_COSTS } from './credits';

/** One-time price of publishing a single page, bought on its own. Unchanged. */
export const SINGLE_PAGE_PRICE = 249;

/**
 * Annual renewal of ONE already-published page — 99₪, one-time, manual.
 *
 * This number is not a new pricing decision: pagey.co.il's marketing page has
 * been promising "חידוש שנתי — 99 ₪ בלבד" since launch, while no renewal
 * mechanism existed at all. It is fixed here so the promise and the charge come
 * from the same constant.
 *
 * A renewal is deliberately NOT a page credit. Page credits buy the right to
 * publish a NEW page (249₪ of value); a renewal buys another year for a page
 * that is already the customer's. Charging a renewal against `page_credits`
 * would silently spend 249₪ of balance on a 99₪ product, so `grantRenewal`
 * never touches the balance in either direction.
 *
 * NOT a subscription: there is no SUMIT standing order and no auto-charge. The
 * customer is emailed at T-30/T-7/T-0 and pays by hand, each year, on purpose.
 */
export const RENEWAL_PRICE = 99;

// ─── Monthly page-CREATION caps ──────────────────────────────────────────────
// This is the anti-abuse cap on how many DRAFT pages an account can generate per
// calendar month. It is completely separate from the page-publish balance: a
// draft costs no page credit, but it does burn real AI spend, so it is metered.

export interface TierDef {
  key: 'free' | 'paid';
  label: string;
  /** Max NEW pages that can be created per calendar month. <= 0 means no cap. */
  monthlyCreate: number;
}

/**
 * Free tier — SHIPPED 2026-08-31, deliberately unchanged by the bundle work.
 * 5 new pages/month is Moshe's number, closing the abuse surface that survived
 * the credit-mint fix (uncapped creation was still possible, just no longer
 * profitable). Do not change without a product decision.
 */
export const FREE_TIER: TierDef = {
  key: 'free',
  label: 'חינם',
  monthlyCreate: 5,
};

/**
 * Anyone who has ever bought page credits (single page or bundle).
 *
 * JUDGMENT CALL (open question #1, delegated to this change): a bundle holder
 * has paid real money and is a far lower abuse risk than an anonymous free
 * signup, so the cap is a runaway-script backstop rather than a product limit —
 * but it is NOT removed, because "unmetered" is exactly the hole that was closed
 * for the free tier earlier today.
 *
 * 60/month is derived, not guessed: the largest bundle is 10 pages, and a real
 * customer iterating hard might throw away ~5 drafts per page they finally
 * publish. 6 drafts per bundle page per month is comfortably above any honest
 * workflow, while still bounding a compromised account or a looping script to a
 * knowable amount of AI spend (60 generations) instead of an unbounded one.
 */
export const PAID_TIER: TierDef = {
  key: 'paid',
  label: 'בעל חבילת דפים',
  monthlyCreate: 60,
};

// ─── Bundles ─────────────────────────────────────────────────────────────────

export type BundleKey = 'bundle5' | 'bundle10';

export interface BundleDef {
  key: BundleKey;
  label: string;
  /** Page credits granted — one is spent per page published. Never expires. */
  pages: number;
  /** One-time price in ₪. */
  price: number;
  /** One-time AI-credit top-up granted with the bundle (see derivation below). */
  aiCredits: number;
  /** Permanently grants white-label (hide the "נוצר באמצעות Pagey" badge). */
  whiteLabel: boolean;
}

/**
 * AI-CREDIT TOP-UP (open question #2, delegated to this change).
 *
 * The old plans refilled `monthlyCredits` (30/150) every year on renewal. That
 * mental model does not survive a one-time purchase — there is no month and no
 * renewal to refill on — so a bundle instead grants a single, one-time top-up
 * that scales with the bundle's size.
 *
 * The per-page figure is derived from the ALREADY-SHIPPED price table in
 * src/config/credits.ts (not re-derived here — those prices are final):
 *
 *   CREATE_IMAGE_SET  4  — generate this page's images with AI at creation
 *   TEXT_FULL_PAGE    6  — rewrite all of its copy once afterwards
 *   ────────────────────
 *                    10  credits per page in the bundle
 *
 * So: 5-page bundle → 50 credits, 10-page bundle → 100 credits. The promise a
 * buyer can actually be told, and that the numbers actually keep, is "every page
 * in the bundle comes with enough credits to build it with AI images and rewrite
 * all its text once". Anything beyond that is a credit pack, same as today.
 *
 * A single 249₪ page grants NO AI credits, deliberately: new accounts already
 * start with STARTING_CREDITS (24) and credit packs exist. Bundling credits into
 * the per-page price would quietly reprice the one product Moshe asked to leave
 * exactly as it is.
 */
const CREDITS_PER_BUNDLE_PAGE = CREDIT_COSTS.CREATE_IMAGE_SET + CREDIT_COSTS.TEXT_FULL_PAGE; // = 10

export const BUNDLES: Record<BundleKey, BundleDef> = {
  bundle5: {
    key: 'bundle5',
    label: 'חבילת 5 דפים',
    pages: 5,
    price: 930, // 186₪/page — ~25% off the 249₪ single-page price
    aiCredits: 5 * CREDITS_PER_BUNDLE_PAGE, // 50
    whiteLabel: false,
  },
  bundle10: {
    key: 'bundle10',
    label: 'חבילת 10 דפים',
    pages: 10,
    price: 1250, // 125₪/page — exactly half the 249₪ single-page price
    aiCredits: 10 * CREDITS_PER_BUNDLE_PAGE, // 100
    whiteLabel: true, // the 10-bundle's bonus perk (was the old agency tier's)
  },
};

export function isBundleKey(key: string | undefined | null): key is BundleKey {
  return key === 'bundle5' || key === 'bundle10';
}

/** Price per page inside a bundle, for "save X%" copy. Rounded to whole ₪. */
export function bundlePerPagePrice(b: BundleDef): number {
  return Math.round(b.price / b.pages);
}

/** Whole-percent saving vs. buying the same number of pages one at a time. */
export function bundleSavingPercent(b: BundleDef): number {
  return Math.round((1 - b.price / (b.pages * SINGLE_PAGE_PRICE)) * 100);
}

// ─── Legacy subscription conversion (read-only compatibility) ────────────────
/**
 * How many page credits an old yearly plan is worth, used in exactly two places:
 * the one-time grandfather migration (012) and `grantLegacyPlan()`, which
 * honours a `purpose:'plan'` payment that was already in flight when this
 * shipped. Numbers are the old plans' `maxActivePages`.
 */
export const LEGACY_PLAN_CONVERSION: Record<string, { pages: number; whiteLabel: boolean }> = {
  freelancer: { pages: 10, whiteLabel: false },
  agency: { pages: 40, whiteLabel: true },
};
