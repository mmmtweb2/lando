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

// Since 12.11.2026 (Moshe's decision) the landing page and the search-phrase pages are part of
// the product itself: every plan includes one published page, and there is no page add-on to buy.
// Two plans are sold, monthly and annual. The two "_page" ids stay only so that rows written
// before the change still resolve to a plan; they cannot be bought any more.
export const SEO_PLANS: Record<SeoPlanId, SeoPlan> = {
  monthly:      { id: 'monthly',      cycle: 'month', withPage: true, price: SEO_MONTHLY_PRICE,                           months: 1 },
  monthly_page: { id: 'monthly_page', cycle: 'month', withPage: true, price: SEO_MONTHLY_PRICE + SEO_PAGE_ADDON_MONTHLY,  months: 1 },
  annual:       { id: 'annual',       cycle: 'year',  withPage: true, price: SEO_ANNUAL_PRICE,                            months: 12 },
  annual_page:  { id: 'annual_page',  cycle: 'year',  withPage: true, price: SEO_ANNUAL_PRICE + SEO_PAGE_ADDON_ANNUAL,    months: 12 },
};

/** The plans a customer can buy today. */
export const SEO_SELLABLE_IDS: SeoPlanId[] = ['monthly', 'annual'];
export const isSellable = (id: unknown): id is SeoPlanId => SEO_SELLABLE_IDS.includes(id as SeoPlanId);

export const SEO_PLAN_IDS = Object.keys(SEO_PLANS) as SeoPlanId[];

export function isSeoPlanId(v: unknown): v is SeoPlanId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SEO_PLANS, v);
}

export function getSeoPlan(id: unknown): SeoPlan | null {
  return isSeoPlanId(id) ? SEO_PLANS[id] : null;
}

/** The plan of a stored row that has no plan id (rows from before plan ids existed): by its cycle. */
export function planFor(cycle: SeoCycle, _withPage?: boolean): SeoPlan {
  return SEO_PLANS[cycle === 'year' ? 'annual' : 'monthly'];
}

/** What a year costs paid monthly vs. as a single annual payment (derived, never typed). */
export function annualSaving(_withPage?: boolean): number {
  return SEO_PLANS.monthly.price * 12 - SEO_PLANS.annual.price;
}

/** The read-only shape the client receives. Prices only: no switches, no secrets. */
export function publicSeoCatalog() {
  return {
    currency: 'ILS',
    vatIncluded: true,
    plans: SEO_SELLABLE_IDS.map(id => {
      const p = SEO_PLANS[id];
      return {
        id: p.id, cycle: p.cycle, withPage: p.withPage, price: p.price, months: p.months,
        // Per-month equivalent and the saving against paying monthly, so the page never computes money.
        pricePerMonth: Math.round((p.price / p.months) * 100) / 100,
        savingVsMonthly: p.cycle === 'year' ? annualSaving(p.withPage) : 0,
      };
    }),
    // No add-on is sold any more; the field stays (as zero) for clients built before the change.
    pageAddon: { monthly: 0, annual: 0 },
    // The cancellation terms that must be shown before payment (spec §1).
    terms: {
      annualSinglePayment: true,
      annualAutoRenew: false,
      annualRefundForRemainingMonths: false,
    },
  };
}
