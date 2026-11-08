// The ONE place the client takes displayed prices from (marketing page, dashboard, publish
// dialog, terms). Display only: the charge is always computed on the server, where
// src/config/billing.ts (and CREDIT_PACKS in user.controller.ts) stay the source of truth.
// scripts/test-pricing-sync.ts fails the build if these numbers drift from the server's,
// or if a displayed price is typed by hand again in the files that use this module.
// All prices are in ₪ and include VAT.

export const PRICING = {
  singlePage: { price: 250, aiCredits: 10, createAllowance: 2 },
  bundle5: { pages: 5, price: 1000, aiCredits: 75, createAllowance: 10 },
  bundle10: { pages: 10, price: 1500, aiCredits: 150, createAllowance: 20 },
  whiteLabelAddon: { price: 350 },
  renewal: { base: 99, atFivePages: 79, atTenPages: 59 },
  creditPacks: {
    small: { credits: 10, price: 50 },
    large: { credits: 100, price: 400 },
  },
} as const;

export type BundleId = 'bundle5' | 'bundle10';

/** 1500 -> "1,500" (the same grouping the pages already used). */
export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Price per page inside a bundle (derived, never typed). */
export function perPage(id: BundleId): number {
  const b = PRICING[id];
  return Math.round(b.price / b.pages);
}

/** Saving versus buying the same number of single pages, in whole percent (derived). */
export function savingPercent(id: BundleId): number {
  const b = PRICING[id];
  return Math.round((1 - b.price / (b.pages * PRICING.singlePage.price)) * 100);
}

/** Mirrors renewalPriceFor() in src/config/billing.ts (display only). */
export function renewalPriceFor(pageCreditsTotal: number): number {
  if (pageCreditsTotal >= PRICING.bundle10.pages) return PRICING.renewal.atTenPages;
  if (pageCreditsTotal >= PRICING.bundle5.pages) return PRICING.renewal.atFivePages;
  return PRICING.renewal.base;
}
