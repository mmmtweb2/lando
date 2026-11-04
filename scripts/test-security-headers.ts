// Run: npx ts-node --transpile-only scripts/test-security-headers.ts
// Baseline security headers (helmet) on the real express app, and that they do not break the
// embeddable reviews widget, the tracking snippet, the OG route or inline-script pages.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../src/app').default as import('express').Express;

async function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ port, path, headers, host: '127.0.0.1' }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: b }));
    }).on('error', reject);
  });
}

(async () => {
  const server = app.listen(0); const port = (server.address() as AddressInfo).port;
  try {
    // tracking snippet: loaded cross-origin by customers' sites -> must NOT carry CORP/COOP/COEP
    let r = await get(port, '/w/track.js');
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(r.headers['x-powered-by'], undefined);
    assert.equal(r.headers['cross-origin-resource-policy'], undefined, 'CORP would block cross-origin script use');
    assert.equal(r.headers['cross-origin-opener-policy'], undefined);
    assert.equal(r.headers['cross-origin-embedder-policy'], undefined);
    assert.equal(r.headers['access-control-allow-origin'], '*', 'existing CORS of the snippet intact');
    assert.equal(r.headers['content-type'], 'application/javascript; charset=utf-8');
    const csp = String(r.headers['content-security-policy']);
    assert.ok(csp.includes("base-uri 'self'") && csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'self'"));
    assert.ok(!/script-src|default-src|style-src|connect-src|img-src/.test(csp), 'no CSP that could block inline scripts / GTM / images');
    assert.equal(r.headers['strict-transport-security'], undefined, 'HSTS is production-only');

    // reviews widget: must stay embeddable anywhere and keep its own CSP
    r = await get(port, '/w/reviews/not-a-uuid');
    assert.equal(r.status, 404);
    assert.equal(r.headers['x-frame-options'], undefined, 'widget drops X-Frame-Options');
    assert.equal(r.headers['content-security-policy'], "frame-ancestors *; default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    assert.equal(r.headers['x-content-type-options'], 'nosniff');

    // headers also present on API 404s
    r = await get(port, '/api/does-not-exist');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');

    // preflight/CORS unaffected
    r = await get(port, '/api/health', { Origin: 'http://localhost:5173' });
    assert.ok(r.headers['x-content-type-options']);
  } finally { server.close(); }

  // production: HSTS present, without includeSubDomains/preload
  process.env.NODE_ENV = 'production';
  delete require.cache[require.resolve('../src/app')];
  const prodApp = require('../src/app').default as import('express').Express;
  const s2 = prodApp.listen(0); const p2 = (s2.address() as AddressInfo).port;
  try {
    const r = await get(p2, '/w/track.js');
    assert.equal(r.headers['strict-transport-security'], 'max-age=15552000');
  } finally { s2.close(); }
  console.log('security headers checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
