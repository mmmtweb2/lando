// The Google-promotion product's monthly plan (Stage 9.2). Everything is configuration, not
// code, until Moshe decides the price and the name: nothing is charged while the switch is off.
//
//   SEO_SUBSCRIPTION_ENABLED=true   turns the whole feature on (default: off)
//   (prices and plans live in config/seoCatalog.ts; SEO_PLAN_PRICE is no longer read)
//   SEO_PLAN_NAME=<name the customer sees>
//   SEO_SUBSCRIPTION_WEBHOOK_SECRET=<random string>   protects the SUMIT trigger endpoint

export function seoSubscriptionEnabled(): boolean {
  return process.env.SEO_SUBSCRIPTION_ENABLED === 'true';
}

export function seoPlanName(): string {
  return (process.env.SEO_PLAN_NAME || 'קידום העסק בגוגל').trim().slice(0, 80);
}
