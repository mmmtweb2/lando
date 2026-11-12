// Pure helpers for the Google-promotion plan selector (/seo-plan) and the subscription card.
// The numbers all come from the server catalog (GET /api/seo/plans); nothing here types a price.

export type SeoCycle = 'month' | 'year';
export type SeoPlanId = 'monthly' | 'monthly_page' | 'annual' | 'annual_page';

export interface CatalogPlan {
  id: SeoPlanId;
  cycle: SeoCycle;
  withPage: boolean;
  price: number;
  months: 1 | 12;
  pricePerMonth: number;
  savingVsMonthly: number;
}

export interface Catalog {
  plans: CatalogPlan[];
  pageAddon: { monthly: number; annual: number };
  terms: { annualSinglePayment: boolean; annualAutoRenew: boolean; annualRefundForRemainingMonths: boolean };
}

export function pickPlan(catalog: Catalog | null | undefined, cycle: SeoCycle, withPage: boolean): CatalogPlan | null {
  // Every plan includes a page now; `withPage` is kept only so older callers compile.
  void withPage;
  return catalog?.plans.find(p => p.cycle === cycle) ?? null;
}

/** Add-on price shown next to the "with a landing page" choice, per the chosen cycle. */
export function addonPrice(catalog: Catalog, cycle: SeoCycle): number {
  return cycle === 'year' ? catalog.pageAddon.annual : catalog.pageAddon.monthly;
}

export function cycleUnit(cycle: SeoCycle): string {
  return cycle === 'year' ? 'לשנה' : 'לחודש';
}

/** "מנוי חודשי" / "מנוי שנתי, עם דף נחיתה" for a plan id/cycle pair (used by the dashboard card). */
export function planLabel(cycle: SeoCycle, withPage: boolean): string {
  void withPage;
  return `מנוי ${cycle === 'year' ? 'שנתי' : 'חודשי'}`;
}

export type AddonPageStatus = 'published' | 'frozen' | 'draft' | null;

/** One plain line about the included landing page, or '' when the plan has none. */
export function pageLine(page: { included: boolean; pageId: string | null; status: string | null } | null | undefined): string {
  if (!page?.included) return '';
  if (!page.pageId) return 'דף הנחיתה שכלול במנוי עדיין לא נוצר. אפשר ליצור אותו ולפרסם בלי לממש קרדיט דף.';
  if (page.status === 'published') return 'דף הנחיתה שכלול במנוי באוויר.';
  if (page.status === 'frozen') return 'דף הנחיתה שכלול במנוי מוקפא. הוא חוזר לאוויר כשהמנוי פעיל שוב, והתוכן והפניות נשמרים.';
  return 'דף הנחיתה שכלול במנוי מוכן לעריכה ולפרסום.';
}
