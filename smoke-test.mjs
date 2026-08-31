#!/usr/bin/env node
// smoke-test.mjs — Pagey post-deploy smoke test
//
// Usage:
//   node smoke-test.mjs [baseUrl]
//   node smoke-test.mjs https://pagey.co.il
//   BASE_URL=https://staging.pagey.co.il node smoke-test.mjs
//
// Requires Node 18+ (built-in fetch). No dependencies.
//
// Exit code: 0 if all checks pass, 1 if any check fails.
// Designed to be wired into CI / a post-deploy hook so this class of bug
// (brand leaks, dead localhost links, empty <title>, broken robots.txt,
// missing meta tags, malformed WhatsApp numbers, missing alt text) is
// caught automatically instead of found manually.

const BASE_URL = (process.argv[2] || process.env.BASE_URL || 'https://pagey.co.il').replace(/\/$/, '');

// Known landing-page slugs to spot-check in addition to the homepage/auth
// pages. Update this list as you create/retire demo or canary pages —
// ideally point it at pages you intentionally keep around for this purpose.
const SAMPLE_PAGE_SLUGS = [
  'fsmb2in',
  'lhzvd6z',
];

const OLD_BRAND_STRINGS = ['Tirnoer Digital', 'Tirnoer'];

// ── tiny test harness ───────────────────────────────────────────────────────

const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const icon = pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

async function fetchText(path) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  return { url, res, text };
}

// ── individual checks ───────────────────────────────────────────────────────
// Each check function fetches what it needs and calls record(). Checks are
// independent — one failing/throwing doesn't stop the others (see runAll).

async function checkNoOldBrand(path, label) {
  const { text } = await fetchText(path);
  const hit = OLD_BRAND_STRINGS.find((s) => text.includes(s));
  record(
    `No old-brand leak on ${label}`,
    !hit,
    hit ? `found "${hit}" in page source (${path})` : undefined
  );
}

async function checkNoLocalhost(path, label) {
  const { text } = await fetchText(path);
  const hasLocalhost = /localhost(:\d+)?/i.test(text);
  record(
    `No "localhost" reference on ${label}`,
    !hasLocalhost,
    hasLocalhost ? `dead dev-server reference found on ${path}` : undefined
  );
}

async function checkTitleNotEmpty(path, label) {
  const { text } = await fetchText(path);
  const match = text.match(/<title>([^<]*)<\/title>/i);
  const title = match ? match[1].trim() : '';
  record(
    `<title> not empty on ${label}`,
    title.length > 0,
    title.length > 0 ? `"${title}"` : `<title></title> is empty on ${path}`
  );
}

async function checkRobotsTxt() {
  const { res, text } = await fetchText('/robots.txt');
  const contentType = res.headers.get('content-type') || '';
  const isPlainText = contentType.includes('text/plain');
  const looksLikeSpaShell = text.includes('<div id="root">') || text.includes('<html');
  record(
    'robots.txt is a real text file (not the SPA shell)',
    isPlainText && !looksLikeSpaShell,
    `content-type: ${contentType || '(none)'}${looksLikeSpaShell ? ', body looks like index.html' : ''}`
  );
}

async function checkSitemapXml() {
  const { res, text } = await fetchText('/sitemap.xml');
  const contentType = res.headers.get('content-type') || '';
  const isXml = contentType.includes('xml');
  const looksLikeSpaShell = text.includes('<div id="root">');
  record(
    'sitemap.xml is real XML (not the SPA shell)',
    isXml && !looksLikeSpaShell,
    `content-type: ${contentType || '(none)'}${looksLikeSpaShell ? ', body looks like index.html' : ''}`
  );
}

async function checkHomepageMeta() {
  const { text } = await fetchText('/');
  const hasDescription = /<meta[^>]+name=["']description["']/i.test(text);
  const hasOgTitle = /<meta[^>]+property=["']og:title["']/i.test(text);
  const hasOgImage = /<meta[^>]+property=["']og:image["']/i.test(text);
  record(
    'Homepage has meta description',
    hasDescription
  );
  record(
    'Homepage has og:title + og:image (link-preview safe)',
    hasOgTitle && hasOgImage,
    !hasOgTitle ? 'missing og:title' : !hasOgImage ? 'missing og:image' : undefined
  );
}

async function checkWhatsAppNumbers(path, label) {
  const { text } = await fetchText(path);
  const matches = [...text.matchAll(/wa\.me\/(\d+)/g)].map((m) => m[1]);
  if (matches.length === 0) {
    record(`WhatsApp links valid on ${label}`, true, 'no wa.me links found (skipped)');
    return;
  }
  // Valid Israeli mobile in international format: 972 + 5X + 7 digits = 12 digits total.
  const bad = matches.filter((n) => !/^9725\d{8}$/.test(n));
  record(
    `WhatsApp links valid on ${label}`,
    bad.length === 0,
    bad.length ? `malformed number(s): ${bad.join(', ')}` : `${matches.length} link(s) OK`
  );
}

async function checkImagesHaveAlt(path, label) {
  const { text } = await fetchText(path);
  const imgTags = text.match(/<img\b[^>]*>/gi) || [];
  if (imgTags.length === 0) {
    record(`Images have alt text on ${label}`, true, 'no <img> tags found (skipped)');
    return;
  }
  const missing = imgTags.filter((tag) => {
    const m = tag.match(/alt=["']([^"']*)["']/i);
    return !m || m[1].trim() === '';
  });
  record(
    `Images have alt text on ${label}`,
    missing.length === 0,
    missing.length ? `${missing.length}/${imgTags.length} <img> tags have empty/missing alt` : `${imgTags.length} image(s) OK`
  );
}

// ── run everything ──────────────────────────────────────────────────────────

async function runAll() {
  console.log(`Pagey smoke test — ${BASE_URL}\n`);

  const corePages = [
    ['/', 'homepage'],
    ['/login', 'login page'],
  ];

  for (const [path, label] of corePages) {
    await safe(() => checkNoOldBrand(path, label));
    await safe(() => checkNoLocalhost(path, label));
  }

  await safe(() => checkTitleNotEmpty('/', 'homepage'));
  await safe(() => checkRobotsTxt());
  await safe(() => checkSitemapXml());
  await safe(() => checkHomepageMeta());

  for (const slug of SAMPLE_PAGE_SLUGS) {
    const path = `/p/${slug}`;
    const label = `sample page /p/${slug}`;
    await safe(() => checkNoOldBrand(path, label));
    await safe(() => checkNoLocalhost(path, label));
    await safe(() => checkTitleNotEmpty(path, label));
    await safe(() => checkWhatsAppNumbers(path, label));
    await safe(() => checkImagesHaveAlt(path, label));
  }

  if (SAMPLE_PAGE_SLUGS.length === 0) {
    console.log(
      '\n(!) SAMPLE_PAGE_SLUGS is empty — add a couple of real /p/<slug> pages ' +
        'at the top of this file to also check generated-page checks: title, ' +
        'WhatsApp numbers, image alt text, brand/localhost leaks.'
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);

  if (failed.length > 0) {
    console.log('\nFailed checks:');
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

async function safe(fn) {
  try {
    await fn();
  } catch (e) {
    record(fn.name || 'check', false, `threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

runAll();