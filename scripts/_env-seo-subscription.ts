// Side-effect-only module: imported first by test-seo-subscription.ts (imports are hoisted under tsx).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
process.env.SUMIT_COMPANY_ID = '123';
process.env.SUMIT_API_KEY = 'k';
process.env.PUBLIC_API_URL = 'https://api.test';
process.env.PUBLIC_APP_URL = 'https://app.test';
export {};
