// The Google-promotion product's monthly plan (Stage 9.2). Everything is configuration, not
// code, until Moshe decides the price and the name: nothing is charged while the switch is off.
//
//   SEO_SUBSCRIPTION_ENABLED=true   turns the whole feature on (default: off)
//   (prices and plans live in config/seoCatalog.ts; SEO_PLAN_PRICE is no longer read)
//   SEO_PLAN_NAME=<name the customer sees>
//   SEO_SUBSCRIPTION_WEBHOOK_SECRET=<random string>   protects the SUMIT trigger endpoint
//   SEO_TEST_PRICE=<₪>  with  SEO_TEST_EMAILS=<a@x.com,b@y.com>   payment test mode: ONLY those emails pay
//     SEO_TEST_PRICE (instead of the catalog price) on any plan, monthly or annual. Off unless BOTH are
//     set and valid; everyone else always pays the catalog price. Used for the first real ₪1 charge.

export function seoSubscriptionEnabled(): boolean {
  return process.env.SEO_SUBSCRIPTION_ENABLED === 'true';
}

export function seoPlanName(): string {
  return (process.env.SEO_PLAN_NAME || 'קידום העסק בגוגל').trim().slice(0, 80);
}

/**
 * Test-mode price for this account, or null (normal catalog price). Needs a positive SEO_TEST_PRICE
 * AND the exact email in SEO_TEST_EMAILS (comma separated, case-insensitive). A missing, empty,
 * zero, negative, non-numeric or absurd (> 1000) price turns the mode off, so a typo can never make
 * the whole customer base pay a few agorot.
 */
export function seoTestPrice(email: string, env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = (env.SEO_TEST_PRICE ?? '').trim();
  const price = Number(raw);
  if (!raw || !Number.isFinite(price) || price <= 0 || price > 1000) return null;
  const list = (env.SEO_TEST_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!list.length || !list.includes(email.trim().toLowerCase())) return null;
  return Math.round(price * 100) / 100;
}

/** True when this account is in payment test mode (a valid SEO_TEST_PRICE and the email is listed). */
export function seoTestMode(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return seoTestPrice(email, env) !== null;
}
