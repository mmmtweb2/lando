// Run: NEXT_PUBLIC_SUPABASE_URL=http://localhost:1 SUPABASE_SERVICE_ROLE_KEY=fake npx tsx scripts/test-gtm.ts
import assert from 'node:assert/strict';
import { GTM_ID, gtmSrc, marketingPath } from '../client/src/lib/gtm';
import { gtmContainerId, publicConfig } from '../src/controllers/publicAudit.controller';

assert.ok(GTM_ID.test('GTM-ABC1234'));
assert.equal(gtmSrc('GTM-ABC1234'), 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234');
for (const bad of ['', 'gtm-abc1234', 'GTM-', 'GTM-AB', 'GTM-ABC1234"><script>', 'UA-123', 'GTM-ABC1234 x']) assert.equal(gtmSrc(bad), null, `rejects ${bad}`);

// only public marketing pages
assert.equal(marketingPath('/'), true); assert.equal(marketingPath('/audit'), true); assert.equal(marketingPath('/seo'), true);
for (const p of ['/dashboard', '/admin', '/p/cafe', '/b/cafe', '/login', '/seo-plan', '/privacy']) assert.equal(marketingPath(p), false, p);

// server side: invalid ids are never exposed
delete process.env.GTM_CONTAINER_ID; assert.equal(gtmContainerId(), null);
process.env.GTM_CONTAINER_ID = ' GTM-ABC1234 '; assert.equal(gtmContainerId(), 'GTM-ABC1234');
process.env.GTM_CONTAINER_ID = '<script>'; assert.equal(gtmContainerId(), null);
process.env.GTM_CONTAINER_ID = 'GTM-ABC1234';
const r: any = { body: null, setHeader() {}, json(b: any) { this.body = b; } };
publicConfig({} as any, r); assert.equal(r.body.gtmId, 'GTM-ABC1234');
console.log('gtm checks passed');
