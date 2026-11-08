// Tests for src/services/serverTiming.ts (perf/server-latency): classification, header format,
// read timeout (GET /rest/v1 only), and the Server-Timing header on a real app response.
// Run: NEXT_PUBLIC_SUPABASE_URL=http://localhost:1 SUPABASE_SERVICE_ROLE_KEY=fake npx tsx scripts/test-server-timing.ts
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { classify, makeTimedFetch, newTiming, readTimeoutMs, record, serverTimingHeader, slowMs, timingEnabled } from '../src/services/serverTiming';

let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message}`); }
}

(async () => {
  await t('classify urls', () => {
    assert.equal(classify('https://x.supabase.co/auth/v1/user'), 'auth');
    assert.equal(classify('https://x.supabase.co/rest/v1/user_profiles?select=*'), 'db');
    assert.equal(classify('https://x.supabase.co/storage/v1/object/a'), 'storage');
    assert.equal(classify('https://example.com/'), 'other');
  });

  await t('env parsing', () => {
    assert.equal(readTimeoutMs({}), 15000);
    assert.equal(readTimeoutMs({ SUPABASE_READ_TIMEOUT_MS: '0' }), 0);
    assert.equal(readTimeoutMs({ SUPABASE_READ_TIMEOUT_MS: '2500' }), 2500);
    assert.equal(readTimeoutMs({ SUPABASE_READ_TIMEOUT_MS: 'abc' }), 15000);
    assert.equal(slowMs({}), 1500);
    assert.equal(slowMs({ SLOW_REQUEST_MS: '300' }), 300);
    assert.equal(timingEnabled({}), false);
    assert.equal(timingEnabled({ SERVER_TIMING: 'true' }), true);
  });

  await t('header lists only used buckets', () => {
    const tm = newTiming(1000);
    record(tm, 'auth', 30);
    record(tm, 'db', 20);
    record(tm, 'db', 25);
    const h = serverTimingHeader(tm, 1100);
    assert.equal(h, 'total;dur=100.0, auth;dur=30.0;desc="1 calls", db;dur=45.0;desc="2 calls"');
    assert.ok(!h.includes('storage'));
  });

  await t('read timeout: GET /rest/v1 is aborted, writes and auth are not', async () => {
    // A server that never answers quickly.
    const srv = http.createServer((_req, res) => { setTimeout(() => { res.end('{}'); }, 400); });
    await new Promise<void>((r) => srv.listen(0, r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const f = makeTimedFetch(fetch, { SUPABASE_READ_TIMEOUT_MS: '100' } as NodeJS.ProcessEnv);
    try {
      await assert.rejects(f(`${base}/rest/v1/x`), (e: Error) => /abort|timeout/i.test(`${e.name} ${e.message}`));
      const post = await f(`${base}/rest/v1/x`, { method: 'POST', body: '{}' });
      assert.equal(post.status, 200);
      const auth = await f(`${base}/auth/v1/user`);
      assert.equal(auth.status, 200);
      const off = makeTimedFetch(fetch, { SUPABASE_READ_TIMEOUT_MS: '0' } as NodeJS.ProcessEnv);
      assert.equal((await off(`${base}/rest/v1/x`)).status, 200);
    } finally { srv.close(); }
  });

  await t('Server-Timing header only when SERVER_TIMING=true', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:1';
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fake';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||= 'fake';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = require('../src/app').default;
    const srv = app.listen(0);
    await new Promise<void>((r) => srv.once('listening', r));
    const port = (srv.address() as AddressInfo).port;
    try {
      delete process.env.SERVER_TIMING;
      const off = await fetch(`http://127.0.0.1:${port}/api/users/plan`);
      assert.equal(off.headers.get('server-timing'), null);
      process.env.SERVER_TIMING = 'true';
      const on = await fetch(`http://127.0.0.1:${port}/api/users/plan`);
      assert.match(on.headers.get('server-timing') ?? '', /^total;dur=\d/);
    } finally { delete process.env.SERVER_TIMING; srv.close(); }
  });

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
