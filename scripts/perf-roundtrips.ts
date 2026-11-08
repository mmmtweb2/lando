// Run: npx tsx scripts/perf-roundtrips.ts [delayMs]
// Not a test (not run by `npm test`): counts the Supabase round trips behind each dashboard route.
// A fake Supabase (auth + PostgREST) sits in front of the REAL express app with a fixed delay per
// call, so total time ~ calls x delay, the same shape as production where every call crosses the
// network. Use it before and after a change to see how many sequential round trips a route needs.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:0'; // replaced below once the fake is listening
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'fake';
process.env.SERVER_TIMING = 'true';
process.env.SLOW_REQUEST_MS = '999999';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const DELAY = Number(process.argv[2] ?? 100);
const EMAIL = 'perf@example.com';
const seed: Record<string, unknown[]> = {
  user_profiles: [{ email: EMAIL, is_admin: false, credits: 5, plan: 'free', created_at: '2026-01-01T00:00:00Z' }],
  user_products: [{ email: EMAIL, product: 'seo_autopilot', status: 'active', source: 'manual', current_period_end: '2099-01-01T00:00:00Z' }],
  seo_businesses: [{ id: '11111111-1111-4111-8111-111111111111', owner_email: EMAIL, google_place_id: 'ChIJperf', name: 'Perf', website_url: null, created_at: '2026-01-01T00:00:00Z', landing_page_id: null }],
};

let calls: { kind: string; path: string }[] = [];
const fake = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => setTimeout(() => {
    const kind = url.pathname.startsWith('/auth/') ? 'auth' : url.pathname.startsWith('/rest/') ? 'db' : 'other';
    calls.push({ kind, path: `${req.method} ${url.pathname}` });
    res.setHeader('content-type', 'application/json');
    if (kind === 'auth') { res.end(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', email: EMAIL, aud: 'authenticated' })); return; }
    if (kind === 'db') {
      const table = url.pathname.split('/').pop() ?? '';
      const rows = (seed[table] ?? []) as unknown[];
      const single = String(req.headers.accept ?? '').includes('pgrst.object');
      if (req.method !== 'GET') { res.statusCode = req.method === 'POST' ? 201 : 200; res.end(req.headers.prefer?.toString().includes('return=representation') ? JSON.stringify(single ? (rows[0] ?? {}) : rows) : ''); return; }
      if (single) { if (rows.length === 0) { res.statusCode = 406; res.end(JSON.stringify({ code: 'PGRST116', message: 'no rows', details: '', hint: '' })); return; } res.end(JSON.stringify(rows[0])); return; }
      res.end(JSON.stringify(rows));
      return;
    }
    res.end('{}');
  }, DELAY));
});

function get(port: number, path: string): Promise<{ status: number; timing: string; ms: number; body: string }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { authorization: 'Bearer good' } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c));
      r.on('end', () => resolve({ status: r.statusCode ?? 0, timing: String(r.headers['server-timing'] ?? ''), ms: Date.now() - t0, body: b }));
    }).on('error', reject);
  });
}

const ROUTES = [
  '/api/users/plan', '/api/users/credits', '/api/landing/my-pages', '/api/landing/my-leads',
  '/api/seo/journey', '/api/seo/businesses', '/api/seo/subscription', '/api/seo/setup', '/api/seo/premium',
];

fake.listen(0, '127.0.0.1', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const app = require('../src/app').default as import('express').Express;
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  console.log(`fake Supabase delay = ${DELAY}ms per call\n`);
  console.log('route'.padEnd(26), 'status', 'calls(auth+db)', ' total ms');
  const summary: Record<string, string> = {};
  for (const route of ROUTES) {
    calls = [];
    const r = await get(port, route);
    const auth = calls.filter((c) => c.kind === 'auth').length;
    const db = calls.filter((c) => c.kind === 'db').length;
    console.log(route.padEnd(26), String(r.status).padEnd(6), `${auth}+${db}`.padEnd(14), String(r.ms).padStart(8));
    summary[route] = `${r.status} ${auth}+${db} ${r.ms}ms | ${r.timing}`;
    if (process.env.VERBOSE) console.log('   ', calls.map((c) => c.path.replace('/rest/v1/', '')).join(', '));
  }
  server.close(); fake.close();
  process.exit(0);
});
