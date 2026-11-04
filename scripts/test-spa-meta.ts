import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applySpaMeta, metaForPath, SPA_META } from '../src/services/spaMeta';

function ok(c: unknown, m: string) { if (!c) { console.error('FAIL:', m); process.exit(1); } }

const html = readFileSync(join(__dirname, '..', 'client', 'index.html'), 'utf-8');

ok(metaForPath('/seo')?.path === '/seo', '/seo known');
ok(metaForPath('/seo/')?.path === '/seo', 'trailing slash');
ok(metaForPath('/audit')?.path === '/audit', '/audit known');
ok(metaForPath('/') === null && metaForPath('/dashboard') === null && metaForPath('/p/x') === null, 'others untouched');
ok(metaForPath('/__proto__') === null && metaForPath('/constructor') === null, 'no prototype lookups');

for (const k of Object.keys(SPA_META)) {
  const m = SPA_META[k];
  const out = applySpaMeta(html, m);
  ok(out.includes(`<title>${m.title}</title>`), `${k} title`);
  ok(out.includes(`<meta name="description" content="${m.description}"`), `${k} description`);
  ok(out.includes(`<meta property="og:title" content="${m.title}"`), `${k} og:title`);
  ok(out.includes(`<meta property="og:url" content="https://pagey.co.il${k}"`), `${k} og:url`);
  ok(out.includes(`<link rel="canonical" href="https://pagey.co.il${k}" />`), `${k} canonical`);
  ok((out.match(/<title>/g) ?? []).length === 1 && (out.match(/rel="canonical"/g) ?? []).length === 1, `${k} no duplicates`);
  ok(!out.includes('Pagey — דף נחיתה מקצועי בדקה בערך'), `${k} home title gone`);
}
// Escaping: a hostile value can never break out of the attribute.
const evil = applySpaMeta(html, { path: '/x', title: 'a"><script>1</script>', description: 'd"&<' });
ok(!evil.includes('<script>1'), 'escaped title');
ok(evil.includes('&quot;&gt;&lt;script&gt;'), 'escaped form');
console.log('spa meta checks passed');
