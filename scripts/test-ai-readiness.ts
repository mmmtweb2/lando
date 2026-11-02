// AI-readiness (website checks), SSRF guard and the category comparison. No network except a local test server.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
import assert from 'assert';
import http from 'http';
import type { AddressInfo } from 'net';
import {
  buildChecks, checkAiReadiness, hasLocalBusinessSchema, hasPrices, hasServiceArea, parseRobots, robotsAllows, visibleText,
} from '../src/services/aiReadiness';
import { acceptableUrl, createSafeGet, isPublicAddress, safeGetText } from '../src/services/safeFetch';
import { compareCategory } from '../src/services/placesAudit';

(async () => {
  // ── robots.txt ─────────────────────────────────────────────
  const g1 = parseRobots('User-agent: *\nDisallow: /\n');
  assert.equal(robotsAllows(g1, 'Googlebot'), false, 'wildcard disallow blocks everyone');
  const g2 = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n');
  assert.equal(robotsAllows(g2, 'Googlebot'), true, 'a specific group beats the wildcard');
  assert.equal(robotsAllows(g2, 'Bingbot'), false);
  const g3 = parseRobots('User-agent: GPTBot\nDisallow: /\n');
  assert.equal(robotsAllows(g3, 'OAI-SearchBot'), true, 'blocking GPTBot does not block OAI-SearchBot');
  assert.equal(robotsAllows(g3, 'GPTBot'), false);
  const g4 = parseRobots('User-agent: PerplexityBot\nUser-agent: Bingbot\nDisallow: /\n');
  assert.equal(robotsAllows(g4, 'Bingbot'), false, 'consecutive user-agent lines share a group');
  assert.equal(robotsAllows(g4, 'PerplexityBot'), false);
  const g5 = parseRobots('User-agent: *\nDisallow: /private\nDisallow:\n');
  assert.equal(robotsAllows(g5, 'Googlebot', '/'), true, 'a partial disallow does not block the home page');
  assert.equal(robotsAllows(g5, 'Googlebot', '/private/x'), false);
  const g6 = parseRobots('User-agent: *\nDisallow: /\nAllow: /$\n');
  assert.equal(robotsAllows(g6, 'Googlebot', '/'), true, 'longer Allow pattern wins');
  assert.equal(robotsAllows(g6, 'Googlebot', '/about'), false);
  const g7 = parseRobots('# comment\nUSER-AGENT: *   # trailing\nDISALLOW: /\n');
  assert.equal(robotsAllows(g7, 'Googlebot'), false, 'case-insensitive keys and comments');
  assert.equal(robotsAllows([], 'Googlebot'), true);
  assert.equal(robotsAllows(parseRobots('garbage \u0000 text'), 'Googlebot'), true);

  // ── content / schema / facts ───────────────────────────────
  assert.equal(visibleText('<html><script>var a=1</script><style>p{}</style><body><p>שלום&nbsp;עולם</p><!-- x --></body></html>'), 'שלום עולם');
  const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  assert.equal(hasLocalBusinessSchema(ld({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'x' })), true);
  assert.equal(hasLocalBusinessSchema(ld({ '@graph': [{ '@type': 'WebSite' }, { '@type': ['Thing', 'Plumber'] }] })), true, '@graph and arrays');
  assert.equal(hasLocalBusinessSchema(ld({ '@type': 'https://schema.org/Dentist' })), true, 'full-URL types');
  assert.equal(hasLocalBusinessSchema(ld({ '@type': 'Organization' })), false);
  assert.equal(hasLocalBusinessSchema('<script type="application/ld+json">{broken</script>'), false, 'malformed JSON is ignored');
  assert.equal(hasLocalBusinessSchema('<html></html>'), false);
  assert.equal(hasPrices('הטיפול עולה החל מ-200 ₪'), true);
  assert.equal(hasPrices('מחירון'), true);
  assert.equal(hasPrices('צרו קשר לפרטים'), false);
  assert.equal(hasServiceArea('אנו משרתים את כל אזור המרכז'), true);
  assert.equal(hasServiceArea('אזורי שירות: תל אביב, רמת גן'), true);
  assert.equal(hasServiceArea('שלום וברוכים הבאים'), false);

  const longText = 'טקסט ' .repeat(120);
  const goodHtml = `<html><body><p>${longText} החל מ-150 ₪. אנו משרתים את כל אזור המרכז.</p>${ld({ '@type': 'LocalBusiness' })}</body></html>`;
  let checks = buildChecks({ state: 'missing' }, goodHtml);
  assert.deepEqual(checks.map(c => c.state), ['pass', 'pass', 'pass', 'pass']);
  checks = buildChecks({ state: 'found', text: 'User-agent: *\nDisallow: /' }, '<html><body><div id="root"></div><script>app()</script></body></html>');
  assert.deepEqual(checks.map(c => c.state), ['fail', 'fail', 'fail', 'fail']);
  assert.ok(checks[0].detail.includes('ChatGPT') && checks[0].detail.includes('Bing'), 'names the blocked bots');
  assert.ok(checks.every(c => c.fix), 'every failure says how to fix it');
  assert.equal(buildChecks({ state: 'unknown' }, goodHtml)[0].state, 'unknown', 'unreadable robots.txt is unknown, not failed');

  // ── checkAiReadiness with fake fetches ─────────────────────
  const resp = (status: number, text: string) => ({ status, text, finalUrl: '', contentType: 'text/html' });
  assert.equal((await checkAiReadiness(null)).status, 'no_website');
  assert.equal((await checkAiReadiness('not a url', { get: async () => null })).status, 'unreachable');
  const down = await checkAiReadiness('https://slow.example/', { get: async () => null });
  assert.deepEqual([down.status, down.checks.length], ['unreachable', 0], 'timeout does not throw');
  const boom = await checkAiReadiness('https://x.example/', { get: async () => { throw new Error('boom'); } });
  assert.equal(boom.status, 'unreachable', 'a throwing fetch is contained');
  const e403 = await checkAiReadiness('https://x.example/', { get: async () => resp(403, '') });
  assert.equal(e403.status, 'unreachable');
  const seen: string[] = [];
  const ok = await checkAiReadiness('https://www.shop.example/home?a=1', {
    get: async (u) => { seen.push(u); return u.endsWith('/robots.txt') ? resp(404, '') : resp(200, goodHtml); },
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.host, 'shop.example', 'only the host is returned');
  assert.ok(seen.includes('https://www.shop.example/robots.txt'));
  assert.ok(ok.checks.every(c => c.state === 'pass'));
  const r5 = await checkAiReadiness('https://x.example/', { get: async (u) => (u.endsWith('/robots.txt') ? resp(503, '') : resp(200, goodHtml)) });
  assert.equal(r5.checks[0].state, 'unknown');

  // ── SSRF guard ─────────────────────────────────────────────
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '172.31.255.255', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'ff02::1', '224.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, `${ip} must be blocked`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, `${ip} is public`);
  assert.equal(isPublicAddress('not-an-ip'), false);
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://localhost/', 'http://a.localhost/', 'file:///etc/passwd', 'ftp://x.example/', 'http://user:pw@x.example/', 'http://x.example:8080/', 'http://169.254.169.254/latest/meta-data', 'http://metadata.internal/', 'javascript:alert(1)', 'http://0x7f.1/', 'http://2130706433/']) {
    assert.equal(acceptableUrl(u), null, `${u} must be rejected`);
  }
  assert.ok(acceptableUrl('https://example.com/a?b=1'));
  assert.equal(await safeGetText('http://127.0.0.1:1/'), null, 'literal loopback refused');

  const srv = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { Location: '/ok' }); res.end(); return; }
    if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
    if (req.url === '/to-meta') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); res.end(); return; }
    if (req.url === '/big') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('x'.repeat(2_000_000)); return; }
    if (req.url === '/bin') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('PNG'); return; }
    if (req.url === '/slow') { return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<p>שלום</p>');
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const port = String((srv.address() as AddressInfo).port);
  const base = `http://127.0.0.1:${port}`;
  // The default getter refuses this very server (loopback, odd port).
  assert.equal(await safeGetText(`${base}/`), null, 'default getter never connects to loopback');
  // A test-only getter that allows loopback exercises the rest of the logic.
  const testGet = createSafeGet(() => true, [port]);
  assert.equal((await testGet(`${base}/`))?.text, '<p>שלום</p>');
  assert.equal((await testGet(`${base}/redir`))?.text, '<p>שלום</p>', 'redirects are followed');
  assert.equal(await testGet(`${base}/loop`), null, 'redirect loops stop');
  const strict = createSafeGet((ip) => ip === '127.0.0.1', [port]);
  assert.equal(await strict(`${base}/to-meta`), null, 'a redirect to a blocked address is refused');
  const big = await testGet(`${base}/big`, { maxBytes: 50_000 });
  assert.ok(big && big.text.length <= 50_000, 'body is capped');
  assert.equal((await testGet(`${base}/bin`))?.text, '', 'non-text content is not read');
  const t0 = Date.now();
  assert.equal(await testGet(`${base}/slow`, { timeoutMs: 300 }), null, 'timeout returns null');
  assert.ok(Date.now() - t0 < 2000);
  srv.close();

  console.log('ai readiness checks passed');
})().catch(e => { console.error(e); process.exit(1); });

// ── category comparison (sync) ───────────────────────────────
const peer = (id: string, type: string, label: string, n: number) => ({ id, primaryType: type, primaryTypeDisplayName: { text: label }, userRatingCount: n });
const me = { id: 'me', primaryType: 'plumber', primaryTypeDisplayName: { text: 'אינסטלטור' } };
let c = compareCategory(me, [peer('a', 'plumber', 'אינסטלטור', 90), peer('b', 'plumber', 'אינסטלטור', 80), peer('c', 'contractor', 'קבלן', 70)]);
assert.equal(c?.status, 'same');
c = compareCategory(me, [peer('a', 'general_contractor', 'קבלן שיפוצים', 90), peer('b', 'general_contractor', 'קבלן שיפוצים', 80), peer('c', 'plumber', 'אינסטלטור', 70), peer('me', 'plumber', 'אינסטלטור', 999)]);
assert.equal(c?.status, 'different');
assert.equal(c?.line, 'המתחרים מוגדרים כ-קבלן שיפוצים ואתם כ-אינסטלטור. כדאי לבדוק שהקטגוריה שלכם מתאימה למה שלקוחות מחפשים.');
assert.equal(compareCategory(me, [peer('a', 'plumber', 'אינסטלטור', 90)]), null, 'too few peers → skipped');
assert.equal(compareCategory({ id: 'me' }, [peer('a', 'x', 'x', 5), peer('b', 'x', 'x', 4)]), null, 'no category of ours → skipped');
assert.equal(compareCategory(me, [{ id: 'a', userRatingCount: 5 }, { id: 'b', userRatingCount: 4 }]), null, 'peers without category → skipped');
// A tie between two categories goes to the more-reviewed business.
c = compareCategory(me, [peer('a', 'x1', 'איקס', 100), peer('b', 'y1', 'ווי', 90)]);
assert.equal(c?.theirs, 'איקס');
