// Display prices (client/src/config/pricing.ts) must equal what the server charges, and the
// pages that show prices must take them from that module instead of typing them again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLES, SINGLE_PAGE_PRICE, SINGLE_PAGE_AI_CREDITS, RENEWAL_PRICE, renewalPriceFor as serverRenewal, CREATION_ALLOWANCE_MULTIPLIER } from '../src/config/billing';
import { PRICING, perPage, savingPercent, renewalPriceFor, fmt } from '../client/src/config/pricing';

function ok(c: unknown, m: string) { if (!c) { console.error('FAIL:', m); process.exit(1); } }
const root = join(__dirname, '..');

ok(PRICING.singlePage.price === SINGLE_PAGE_PRICE, 'single page price');
ok(PRICING.singlePage.aiCredits === SINGLE_PAGE_AI_CREDITS, 'single page AI credits');
ok(PRICING.singlePage.createAllowance === CREATION_ALLOWANCE_MULTIPLIER, 'single page create allowance');
for (const id of ['bundle5', 'bundle10'] as const) {
  const s = BUNDLES[id], c = PRICING[id];
  ok(c.pages === s.pages && c.price === s.price && c.aiCredits === s.aiCredits, `${id} pages/price/credits`);
  ok(c.createAllowance === s.pages * CREATION_ALLOWANCE_MULTIPLIER, `${id} create allowance`);
}
ok(PRICING.whiteLabelAddon.price === BUNDLES.whitelabel_addon.price, 'white-label add-on price');
ok(PRICING.renewal.base === RENEWAL_PRICE, 'renewal base');
for (const n of [0, 1, 4, 5, 9, 10, 25]) ok(renewalPriceFor(n) === serverRenewal(n), `renewal tier at ${n}`);

// Credit packs live in the controller; read the literal rather than importing the whole controller.
const ctl = readFileSync(join(root, 'src/controllers/user.controller.ts'), 'utf-8');
for (const k of ['small', 'large'] as const) {
  const m = ctl.match(new RegExp(`${k}:\\s*\\{\\s*credits:\\s*(\\d+),\\s*price:\\s*(\\d+)\\s*\\}`));
  ok(m && Number(m[1]) === PRICING.creditPacks[k].credits && Number(m[2]) === PRICING.creditPacks[k].price, `credit pack ${k}`);
}

// Derived numbers that the copy used to hard-code.
ok(perPage('bundle5') === 200 && perPage('bundle10') === 150, 'per-page derived');
ok(savingPercent('bundle5') === 20 && savingPercent('bundle10') === 40, 'saving derived');
ok(fmt(1500) === '1,500' && fmt(250) === '250', 'fmt');

// No hand-typed prices in the pages that display them (comments are ignored).
const files = ['client/src/pages/MarketingLanding.tsx', 'client/src/pages/Dashboard.tsx', 'client/src/pages/LandingViewer.tsx', 'client/src/pages/legal/Terms.tsx'];
// Old odd prices are caught anywhere; the new round ones (250, 1,000, ...) only next to a currency sign,
// because plain 200 / 400 / 150 also appear as pixel sizes and animation numbers.
const stale = /(^|[^0-9A-Za-z.,/\[-])(249|990|1,490|198|149|399)(?![0-9])/;
const money = /(?:₪\s*(?:250|1,000|1,500|350|200|150|400)(?![0-9,])|(?<![0-9,.])(?:250|1,000|1,500|350|200|150|400)\s*(?:₪|ש"ח|שקלים))/;
const banned = { test: (code: string) => stale.test(code) || money.test(code) };
for (const f of files) {
  const lines = readFileSync(join(root, f), 'utf-8').split('\n');
  let inBlock = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    const wasIn = inBlock;
    if (t.includes('/*') && !t.includes('*/')) inBlock = true;
    if (wasIn && t.includes('*/')) inBlock = false;
    if (wasIn || inBlock) return;
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return;
    const code = line.replace(/\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '').replace(/rgba?\([^)]*\)|#[0-9A-Fa-f]{3,8}|M[\d.\s,a-zA-Z-]*/g, '');
    ok(!banned.test(code), `${f}:${i + 1} has a hand-typed price: ${t.slice(0, 90)}`);
  });
}
console.log('pricing sync checks passed');
