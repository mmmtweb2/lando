// Run: npx tsx scripts/test-dashboard-nav.ts   (imports client ES modules)
// README part 149: the URL decides the screen. Area parsing and aliases, which screen shows per area and setup
// state, the menu switch, and the order of the account's pages.
import assert from 'node:assert/strict';
import { AREA_LABEL, areaFromQuery, navFor, navParent, resolveArea, type PromoArea } from '../client/src/dashboard/shell/areas';
import { MENU_COPY, promoScreen, showsMenuSwitch } from '../client/src/dashboard/shell/setupMode';
import { defaultPageId, orderPages } from '../client/src/dashboard/v3/pageOrder';
import type { PageSummary } from '../client/src/dashboard/shell/bridge';

// ── the inquiries have two names; every link lands on the one the account has ──
assert.equal(areaFromQuery('?area=inquiries'), 'inquiries');
assert.equal(areaFromQuery('?leads=1'), 'leads', 'the old link of the publish modal keeps working');
assert.equal(areaFromQuery('?area=leads'), 'leads');
assert.equal(resolveArea('promo', 'leads'), 'inquiries', 'promotion only: ?leads=1 / ?area=leads open the inquiries, not the home');
assert.equal(resolveArea('promo', 'inquiries'), 'inquiries');
assert.equal(resolveArea('pages', 'inquiries'), 'leads', 'pages only: the new link opens the leads');
assert.equal(resolveArea('pages', 'leads'), 'leads');
assert.equal(resolveArea('both', 'inquiries'), 'inquiries');
assert.equal(resolveArea('both', 'leads'), 'leads');

// ── the promotion product inside the dashboard, for an account without it ──
assert.equal(areaFromQuery('?area=promote'), 'promote');
assert.equal(resolveArea('pages', 'promote'), 'promote');
assert.equal(resolveArea('promo', 'promote'), 'home', 'an account that holds it goes to its own home');
assert.equal(resolveArea('both', 'promote'), 'home');
assert.equal(navFor('pages', 'unknown').offer, 'promo');
assert.equal(navParent('promote', 'unknown'), 'promote', 'the entry is lit on its own screen');
assert.equal(AREA_LABEL.promote, 'קידום העסק בגוגל');

// ── which screen shows ──
const AREAS: PromoArea[] = ['home', 'reviews', 'progress', 'more', 'profile', 'content', 'inquiries', 'setup', 'site', 'business', 'automation', 'activity', 'extras'];

// no setup open: every area shows its own screen, no banner, no switch
for (const area of AREAS) for (const menu of ['setup', 'full'] as const) {
  assert.deepEqual(promoScreen({ area, setup: 'none', menu }), { screen: 'area', menu: 'full', banner: false });
}
assert.equal(showsMenuSwitch('none'), false);

// a setup is open: ONLY the home in the setup menu is the setup; every other area shows its own screen with
// the banner, on a click, a direct link and a reload alike (the input is the same in all three)
for (const setup of ['guided', 'short'] as const) {
  const setupScreen = setup === 'guided' ? 'guided-setup' : 'short-setup';
  assert.deepEqual(promoScreen({ area: 'home', setup, menu: 'setup' }), { screen: setupScreen, menu: 'setup', banner: false });
  assert.deepEqual(promoScreen({ area: 'home', setup, menu: 'full' }), { screen: 'area', menu: 'full', banner: false }, 'the full menu has a regular home');
  for (const area of AREAS.filter((a) => a !== 'home')) {
    for (const menu of ['setup', 'full'] as const) {
      const c = promoScreen({ area, setup, menu });
      assert.equal(c.screen, 'area', `${setup}/${area}/${menu}: the area's own screen, never the setup`);
      assert.equal(c.menu, 'full', `${setup}/${area}/${menu}: another area is the full menu`);
      assert.equal(c.banner, area !== 'setup', `${setup}/${area}: the banner, except on the setup list itself`);
    }
  }
  assert.equal(showsMenuSwitch(setup), true);
}
// the QA cases: reload of reviews / progress / inquiries in the setup menu, after connecting a business
for (const area of ['reviews', 'progress', 'inquiries'] as const) {
  assert.equal(promoScreen({ area, setup: 'guided', menu: 'setup' }).screen, 'area');
}

// the short setup's last screen: the setup is done, it stays on the home only, no banner, no switch
assert.deepEqual(promoScreen({ area: 'home', setup: 'none', menu: 'setup', finishing: true }), { screen: 'short-setup', menu: 'full', banner: false });
assert.deepEqual(promoScreen({ area: 'reviews', setup: 'none', menu: 'setup', finishing: true }), { screen: 'area', menu: 'full', banner: false });
assert.equal(showsMenuSwitch('short', true), false);

// the words: plain, plural, the two actions name the other menu
assert.equal(MENU_COPY.setup.action, 'לתפריט המלא');
assert.equal(MENU_COPY.full.action, 'חזרה להגדרה');
assert.equal(MENU_COPY.banner.title, 'השלימו קודם את ההגדרה');
for (const t of [MENU_COPY.setup.line, MENU_COPY.full.line, MENU_COPY.banner.line]) assert.ok(!/\//.test(t), 'no mixed-gender slashes');

// ── the account's pages ──
const P = (id: string, createdAt: string | null, status = 'published'): PageSummary => ({ id, slug: id, name: id, status, url: `https://pagey.co.il/p/${id}`, createdAt });
const pages = [P('old', '2026-10-01T00:00:00Z', 'draft'), P('new', '2026-11-23T00:00:00Z'), P('mid', '2026-11-01T00:00:00Z')];
assert.deepEqual(orderPages(pages, null).map((p) => p.id), ['new', 'mid', 'old'], 'newest first');
assert.deepEqual(orderPages(pages, 'old').map((p) => p.id), ['old', 'new', 'mid'], "the business's own page first");
assert.deepEqual(orderPages(pages, 'missing').map((p) => p.id), ['new', 'mid', 'old']);
assert.deepEqual(orderPages([], null), []);
// the selector's first choice: own page, else the page with the business card behind it, else the newest; never an old test page
const rows = [{ id: 'test', created_at: '2026-09-01T00:00:00Z' }, { id: 'biz', created_at: '2026-11-20T00:00:00Z' }, { id: 'card', created_at: '2026-10-10T00:00:00Z', card_refresh: true }];
assert.equal(defaultPageId(rows, 'biz'), 'biz');
assert.equal(defaultPageId(rows, null), 'card');
assert.equal(defaultPageId(rows.filter((r) => r.id !== 'card'), null), 'biz', 'the newest, not the old test page');
assert.equal(defaultPageId(rows, 'gone'), 'card', 'an own page that is not in the list is ignored');
assert.equal(defaultPageId([], null), '');

console.log('test-dashboard-nav: all assertions passed');
