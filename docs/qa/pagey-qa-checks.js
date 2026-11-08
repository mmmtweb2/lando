// Pagey QA: in-page checks. Paste the whole file into the browser tool's JavaScript console
// (page context) after the page has finished loading. Read-only: it never clicks, types or submits,
// and only sends GET requests to links of the same site.
//
// Returns a JSON string: { url, title, viewport, perf, summary, findings[] }.
// Each finding: { sev: 'high'|'med'|'low'|'review', id, msg, ev? }.
//   high   = broken for the visitor (horizontal overflow, broken image, dead link, missing h1/title)
//   med    = accessibility or SEO gap
//   low    = polish
//   review = a human must read the evidence (wording rules, contrast)
// Run it at the widths you want to cover (narrow pane ~390px, then a wide window ~1280px).
(async () => {
  const out = { url: location.href, title: document.title, viewport: [innerWidth, innerHeight], perf: {}, findings: [] };
  const add = (sev, id, msg, ev) => out.findings.push(ev === undefined ? { sev, id, msg } : { sev, id, msg, ev });
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const short = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('alt') || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}> ${t}`;
  };

  // ---- document basics
  const html = document.documentElement;
  if (!html.lang) add('med', 'DOC-LANG', 'html has no lang attribute');
  if (html.lang && html.lang.startsWith('he') && html.dir !== 'rtl' && getComputedStyle(document.body).direction !== 'rtl') add('high', 'DOC-RTL', 'Hebrew page is not RTL');
  const title = document.title.trim();
  if (!title) add('high', 'SEO-TITLE', 'empty <title>');
  else if (title.length > 70) add('low', 'SEO-TITLE-LEN', `title is ${title.length} chars`, title);
  const meta = (n, attr = 'name') => document.querySelector(`meta[${attr}="${n}"]`)?.getAttribute('content')?.trim() || '';
  if (!meta('description')) add('med', 'SEO-DESC', 'no meta description');
  if (!document.querySelector('link[rel="canonical"]')) add('low', 'SEO-CANON', 'no canonical link');
  for (const p of ['og:title', 'og:description', 'og:image']) if (!meta(p, 'property')) add('low', 'SEO-OG', `missing ${p}`);
  const h1s = [...document.querySelectorAll('h1')].filter(visible);
  if (h1s.length === 0) add('med', 'DOC-H1', 'no visible h1');
  if (h1s.length > 1) add('low', 'DOC-H1-MANY', `${h1s.length} visible h1`, h1s.map(short));

  // ---- layout: horizontal overflow
  const sw = html.scrollWidth, vw = innerWidth;
  if (sw > vw + 1) {
    const wide = [...document.querySelectorAll('body *')].filter((e) => visible(e) && e.getBoundingClientRect().right > vw + 1).slice(0, 5).map(short);
    add('high', 'LAY-OVERFLOW', `page is ${sw}px wide in a ${vw}px viewport (horizontal scroll)`, wide);
  }

  // ---- images
  const imgs = [...document.querySelectorAll('img')].filter(visible);
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0);
  if (broken.length) add('high', 'IMG-BROKEN', `${broken.length} broken image(s)`, broken.slice(0, 5).map((i) => i.currentSrc || i.src));
  const noAlt = imgs.filter((i) => !i.hasAttribute('alt'));
  if (noAlt.length) add('med', 'IMG-ALT', `${noAlt.length} image(s) without an alt attribute (use alt="" if decorative)`, noAlt.slice(0, 5).map((i) => i.currentSrc || i.src));

  // ---- controls: names, labels, tap size
  const ctrls = [...document.querySelectorAll('a[href],button,[role="button"],input:not([type="hidden"]),select,textarea')].filter(visible);
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.textContent || el.getAttribute('title') || el.getAttribute('alt') || el.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
  const unnamed = ctrls.filter((el) => !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !nameOf(el));
  if (unnamed.length) add('med', 'A11Y-NAME', `${unnamed.length} link/button without an accessible name`, unnamed.slice(0, 5).map(short));
  const fields = ctrls.filter((el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['submit', 'button', 'checkbox', 'radio'].includes(el.type));
  const unlabeled = fields.filter((el) => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) && !el.closest('label'));
  if (unlabeled.length) add('med', 'A11Y-LABEL', `${unlabeled.length} field(s) without a label (a placeholder alone is not a label)`, unlabeled.slice(0, 5).map((e) => e.name || e.placeholder || e.type));
  const small = ctrls.filter((el) => {
    if (el.tagName === 'A' && el.closest('p,li,span') && getComputedStyle(el).display === 'inline') return false;   // inline text links
    const r = el.getBoundingClientRect();
    return r.width < 44 || r.height < 44;
  });
  if (small.length) add('low', 'A11Y-TAP', `${small.length} control(s) under 44x44px`, small.slice(0, 6).map((e) => { const r = e.getBoundingClientRect(); return `${short(e)} ${Math.round(r.width)}x${Math.round(r.height)}`; }));

  // ---- links: dead internal links, unsafe new-tab links
  const blank = [...document.querySelectorAll('a[target="_blank"]')].filter((a) => !/noopener|noreferrer/.test(a.rel));
  if (blank.length) add('low', 'SEC-BLANK', `${blank.length} target=_blank link(s) without rel=noopener`, blank.slice(0, 3).map(short));
  const internal = [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => h.startsWith(location.origin) && !h.includes('#') && !/logout|signout/i.test(h)))].slice(0, 40);
  const dead = [];
  await Promise.all(internal.map(async (h) => {
    try { const r = await fetch(h, { method: 'GET', credentials: 'same-origin' }); if (r.status >= 400) dead.push(`${r.status} ${h}`); } catch (e) { dead.push(`ERR ${h}`); }
  }));
  if (dead.length) add('high', 'LNK-DEAD', `${dead.length} internal link(s) failing`, dead.slice(0, 8));
  if (location.protocol === 'https:') {
    const mixed = [...document.querySelectorAll('img[src^="http:"],script[src^="http:"],link[href^="http:"],iframe[src^="http:"]')];
    if (mixed.length) add('high', 'SEC-MIXED', `${mixed.length} http: resource(s) on an https page`, mixed.slice(0, 3).map((e) => e.src || e.href));
  }

  // ---- wording: fair-promotion rules (a human confirms every hit)
  const text = (document.body.innerText || '');
  const RULES = [
    ['WORD-RANK', /(מקום|מקומות)\s+(ראשון|ראשונים)|עמוד\s+ראשון\s+בגוגל|ראשון\s+בגוגל|מובטח|מבטיח(?:ים)?\s+(?:דירוג|מיקום|קידום|תוצאות|פניות|לקוחות)|דירוג\s+מובטח|guarantee/gi],
    ['WORD-AI', /ChatGPT\s*(?:ימליץ|ממליץ|יציע)|הבינה\s+המלאכותית\s+תמליץ/g],
    ['WORD-AUTO', /מתעדכן\s+אוטומטית\s+בגוגל|מתעדכן\s+בגוגל\s+אוטומטית|מעדכנים?\s+את\s+גוגל\s+אוטומטית/g],
    ['WORD-FAKE', /ביקורות\s+(?:מזויפות|קנויות|מפוברקות)|קונים\s+ביקורות/g],
    ['WORD-PRICE', /(?:מנוי|חבילה|פרימיום)[^.\n]{0,40}\d{3,4}\s*₪(?:\s*(?:לחודש|\/חודש))?/g]
  ];
  for (const [id, re] of RULES) {
    // a sentence that denies the claim ("אנחנו לא מבטיחים מקום ראשון") is the fair wording, not a violation
    const hits = [...text.matchAll(re)].filter((m) => !/(לא|בלי|אין|ללא)\s*(?:\S+\s+){0,2}$/.test(text.slice(Math.max(0, m.index - 24), m.index))).slice(0, 4).map((m) => text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25).replace(/\s+/g, ' '));
    if (hits.length) add('review', id, `wording to confirm against the fair-promotion rules (${hits.length})`, hits);
  }

  // ---- performance (what the browser already measured)
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) out.perf = { ttfbMs: Math.round(nav.responseStart), domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd) };
    const lcp = performance.getEntriesByType('largest-contentful-paint').pop();
    if (lcp) out.perf.lcpMs = Math.round(lcp.startTime);
    const res = performance.getEntriesByType('resource');
    out.perf.requests = res.length;
    out.perf.transferKB = Math.round(res.reduce((n, r) => n + (r.transferSize || 0), 0) / 1024);
    if (out.perf.lcpMs > 2500) add('med', 'PERF-LCP', `LCP ${out.perf.lcpMs}ms (target 2500ms)`);
    if (out.perf.loadMs > 4000) add('med', 'PERF-LOAD', `load ${out.perf.loadMs}ms (target 4000ms)`);
    if (out.perf.ttfbMs > 800) add('low', 'PERF-TTFB', `TTFB ${out.perf.ttfbMs}ms`);
  } catch (e) { /* not measurable */ }

  const count = (s) => out.findings.filter((f) => f.sev === s).length;
  out.summary = { high: count('high'), med: count('med'), low: count('low'), review: count('review') };
  return JSON.stringify(out);
})()
