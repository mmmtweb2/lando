// The Google-promotion product's plan catalog (task #30, docs/billing-spec.md §1).
// ONE place for the plans, their cycle, whether a landing page comes with them, and the price.
// The server charges from here; the client only receives it read-only (GET /api/seo/plans).
// All prices are in ₪ and include VAT.
//
// What is NOT here: whether selling is switched on (SEO_SUBSCRIPTION_ENABLED, config/seoPlan.ts),
// and coupons (manual, applied by a person; no coupon logic lives in this catalog).

export type SeoPlanId = 'monthly' | 'monthly_page' | 'annual' | 'annual_page';
export type SeoCycle = 'month' | 'year';

export interface SeoPlan {
  id: SeoPlanId;
  cycle: SeoCycle;
  /** Includes one published landing page while the subscription is active. */
  withPage: boolean;
  /** What the customer pays for one cycle. */
  price: number;
  /** Length of one paid period, in months (1 or 12). */
  months: 1 | 12;
}

/** Base monthly price, and the page add-on in each cycle. The annual figures are 10 months for 12. */
export const SEO_MONTHLY_PRICE = 250;
export const SEO_PAGE_ADDON_MONTHLY = 15;
export const SEO_ANNUAL_PRICE = 2500;
export const SEO_PAGE_ADDON_ANNUAL = 150;
/** Days before an annual period ends that the "your year is ending" reminder goes out. */
export const SEO_ANNUAL_REMINDER_DAYS = 14;

export const SEO_PLANS: Record<SeoPlanId, SeoPlan> = {
  monthly:      { id: 'monthly',      cycle: 'month', withPage: false, price: SEO_MONTHLY_PRICE,                           months: 1 },
  monthly_page: { id: 'monthly_page', cycle: 'month', withPage: true,  price: SEO_MONTHLY_PRICE + SEO_PAGE_ADDON_MONTHLY,  months: 1 },
  annual:       { id: 'annual',       cycle: 'year',  withPage: false, price: SEO_ANNUAL_PRICE,                            months: 12 },
  annual_page:  { id: 'annual_page',  cycle: 'year',  withPage: true,  price: SEO_ANNUAL_PRICE + SEO_PAGE_ADDON_ANNUAL,    months: 12 },
};

export const SEO_PLAN_IDS = Object.keys(SEO_PLANS) as SeoPlanId[];

export function isSeoPlanId(v: unknown): v is SeoPlanId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SEO_PLANS, v);
}

export function getSeoPlan(id: unknown): SeoPlan | null {
  return isSeoPlanId(id) ? SEO_PLANS[id] : null;
}

/** The plan matching a stored (cycle, with_page) pair; used for rows written before plan ids existed. */
export function planFor(cycle: SeoCycle, withPage: boolean): SeoPlan {
  return SEO_PLANS[cycle === 'year' ? (withPage ? 'annual_page' : 'annual') : (withPage ? 'monthly_page' : 'monthly')];
}

/** What a year costs paid monthly vs. as a single annual payment (derived, never typed). */
export function annualSaving(withPage: boolean): number {
  const monthly = SEO_PLANS[withPage ? 'monthly_page' : 'monthly'].price * 12;
  return monthly - SEO_PLANS[withPage ? 'annual_page' : 'annual'].price;
}

/** The read-only shape the client receives. Prices only: no switches, no secrets. */
export function publicSeoCatalog() {
  return {
    currency: 'ILS',
    vatIncluded: true,
    plans: SEO_PLAN_IDS.map(id => {
      const p = SEO_PLANS[id];
      return {
        id: p.id, cycle: p.cycle, withPage: p.withPage, price: p.price, months: p.months,
        // Per-month equivalent and the saving against paying monthly, so the page never computes money.
        pricePerMonth: Math.round((p.price / p.months) * 100) / 100,
        savingVsMonthly: p.cycle === 'year' ? annualSaving(p.withPage) : 0,
      };
    }),
    pageAddon: { monthly: SEO_PAGE_ADDON_MONTHLY, annual: SEO_PAGE_ADDON_ANNUAL },
    // The cancellation terms that must be shown before payment (spec §1).
    terms: {
      annualSinglePayment: true,
      annualAutoRenew: false,
      annualRefundForRemainingMonths: false,
    },
  };
}
