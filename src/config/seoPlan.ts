// The Google-promotion product's monthly plan (Stage 9.2). Everything is configuration, not
// code, until Moshe decides the price and the name: nothing is charged while the switch is off.
//
//   SEO_SUBSCRIPTION_ENABLED=true   turns the whole feature on (default: off)
//   SEO_PLAN_PRICE=<₪ per month, VAT included>   required when enabled
//   SEO_PLAN_NAME=<name the customer sees>
//   SEO_SUBSCRIPTION_WEBHOOK_SECRET=<random string>   protects the SUMIT trigger endpoint

export function seoSubscriptionEnabled(): boolean {
  return process.env.SEO_SUBSCRIPTION_ENABLED === 'true';
}

/** Monthly price in ₪, or null when it is not configured / not a sane number. */
export function seoPlanPrice(): number | null {
  const n = Number(process.env.SEO_PLAN_PRICE);
  if (!Number.isFinite(n) || n < 1 || n > 10000) return null;
  return Math.round(n * 100) / 100;
}

export function seoPlanName(): string {
  return (process.env.SEO_PLAN_NAME || 'קידום העסק בגוגל').trim().slice(0, 80);
}
