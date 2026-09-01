// ─────────────────────────────────────────────────────────────────────────────
// Subscription plan definitions.
//
// Prepaid, yearly. A plan covers publishing up to `maxActivePages` live pages
// (no per-page 249₪ charge), caps how many pages can be CREATED per calendar
// month (protects AI cost / anti-abuse), and refills `monthlyCredits` AI credits
// on activation.
//
// ⚙️  These numbers are business placeholders — tune prices/limits here freely.
//     Nothing else in the code hard-codes them.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanDef {
  key: 'free' | 'freelancer' | 'agency';
  label: string;
  /** Max concurrently-published (live) pages the plan covers. */
  maxActivePages: number;
  /** Max NEW pages that can be created per calendar month. */
  monthlyCreate: number;
  /** AI image credits granted on each activation/renewal. */
  monthlyCredits: number;
  /** Yearly price in ₪ (0 = not purchasable; free = pay-per-page). */
  priceYear: number;
  /** Agency perk — pages can hide Pagey branding. */
  whiteLabel: boolean;
}

export const PLANS: Record<PlanDef['key'], PlanDef> = {
  free: {
    key: 'free',
    label: 'חינם',
    maxActivePages: 0, // free users pay 249₪ per published page (existing flow)
    monthlyCreate: 5, // free tier's own real cap — 5 new pages/month (Moshe's call, 2026-08-31: close the abuse surface the credit-mint fix didn't fully cover)
    monthlyCredits: 0,
    priceYear: 0,
    whiteLabel: false,
  },
  freelancer: {
    key: 'freelancer',
    label: 'פרילנסר',
    maxActivePages: 10,
    monthlyCreate: 30,
    monthlyCredits: 30,
    priceYear: 1490,
    whiteLabel: false,
  },
  agency: {
    key: 'agency',
    label: 'סוכנות',
    maxActivePages: 40,
    monthlyCreate: 200,
    monthlyCredits: 150,
    priceYear: 3990,
    whiteLabel: true,
  },
};

export type PlanKey = PlanDef['key'];

/** True for a real, purchasable paid plan (not 'free'). */
export function isPaidPlan(key: string | undefined | null): key is 'freelancer' | 'agency' {
  return key === 'freelancer' || key === 'agency';
}
