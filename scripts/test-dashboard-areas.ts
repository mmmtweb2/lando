// Run: npx tsx scripts/test-dashboard-areas.ts   (imports client ES modules)
// The dashboard's one navigation model (docs/dashboard-v4-spec.md): who sees which group, where a
// URL lands, and that the old deep links keep working.
import assert from 'node:assert/strict';
import { AREA_LABEL, accountKind, areaFromQuery, navFor, navParent, queryWithArea, resolveArea } from '../client/src/dashboard/shell/areas';

// three kinds of account
assert.equal(accountKind({ hasSeo: false, pageCount: 3, pageCredits: 2, pageCreditsTotal: 5 }), 'pages');
assert.equal(accountKind({ hasSeo: true, pageCount: 0, pageCredits: 0, pageCreditsTotal: 0 }), 'promo');
assert.equal(accountKind({ hasSeo: true, pageCount: 1, pageCredits: 0, pageCreditsTotal: 0 }), 'promo', 'the included page alone is not the pages product');
assert.equal(accountKind({ hasSeo: true, pageCount: 2, pageCredits: 0, pageCreditsTotal: 0 }), 'both');
assert.equal(accountKind({ hasSeo: true, pageCount: 1, pageCredits: 0, pageCreditsTotal: 5 }), 'both');

// promotion only: no pages group, no credits anywhere, one soft link to more pages
const promo = navFor('promo', 'auto');
assert.deepEqual(promo.groups.map((g) => g.product), ['promo']);
assert.deepEqual(promo.groups[0].items, ['home', 'reviews', 'site', 'business', 'automation']);
assert.equal(promo.offer, 'pages');
assert.ok(!promo.groups.flatMap((g) => g.items).includes('credits'));
// pages only: the pages group and one quiet entry to the promotion product
const pages = navFor('pages', 'unknown');
assert.deepEqual(pages.groups.map((g) => g.product), ['pages']);
assert.deepEqual(pages.groups[0].items, ['pages', 'leads', 'credits']);
assert.equal(pages.offer, 'promo');
// both: two groups, promotion first, no offer
const both = navFor('both', 'auto');
assert.deepEqual(both.groups.map((g) => g.product), ['promo', 'pages']);
assert.equal(both.offer, null);
assert.deepEqual(both.bottom, ['settings']);
// an account where the automatic product is not open keeps its screens; older dashboards get one entry
assert.deepEqual(navFor('promo', 'legacy').groups[0].items, ['home', 'reviews', 'progress', 'more']);
assert.deepEqual(navFor('promo', 'classic').groups[0].items, ['home']);
assert.deepEqual(navFor('promo', 'setup').groups[0].items, ['home']);

// every entry has a name; no entry appears twice (the old "סקירה כללית" / "הדפים שלי" pair)
for (const kind of ['promo', 'pages', 'both'] as const) for (const mode of ['auto', 'legacy', 'setup', 'classic', 'unknown'] as const) {
  const n = navFor(kind, mode);
  const all = [...n.groups.flatMap((g) => g.items), ...n.bottom];
  assert.equal(new Set(all).size, all.length);
  for (const a of all) assert.ok(AREA_LABEL[a]);
}

// where a request lands
assert.equal(resolveArea('promo', null), 'home');
assert.equal(resolveArea('pages', null), 'pages');
assert.equal(resolveArea('both', null), 'home');
assert.equal(resolveArea('promo', 'pages'), 'site', 'promotion only: the page lives under the promotion product');
assert.equal(resolveArea('promo', 'credits'), 'home');
assert.equal(resolveArea('pages', 'reviews'), 'pages');
assert.equal(resolveArea('both', 'credits'), 'credits');
assert.equal(resolveArea('pages', 'settings'), 'settings');

// URL: the canonical form and the old deep links
assert.equal(areaFromQuery('?area=reviews'), 'reviews');
assert.equal(areaFromQuery('?area=nonsense'), null);
assert.equal(areaFromQuery('?area=plan'), 'settings');
assert.equal(areaFromQuery('?leads=1'), 'leads');
assert.equal(areaFromQuery('?renew=abc'), 'pages');
assert.equal(areaFromQuery('?upgrade=1'), 'credits');
assert.equal(areaFromQuery('?bundles=1'), 'credits');
assert.equal(areaFromQuery('?screen=card&dash=v3&preview=ongoing'), 'business');
assert.equal(areaFromQuery('?screen=automation'), 'automation');
assert.equal(areaFromQuery('?gbp=connected'), 'profile');
assert.equal(areaFromQuery('?seo_subscription=ok'), null, 'the return banner shows on the default area');
assert.equal(areaFromQuery('?dash=v2'), null);
assert.equal(areaFromQuery(''), null);
// the rest of the query survives; one-shot params are dropped
assert.equal(queryWithArea('?dash=v3&preview=ongoing&sample=approved', 'site', false), '?dash=v3&preview=ongoing&sample=approved&area=site');
assert.equal(queryWithArea('?leads=1', 'leads', false), '?area=leads');
assert.equal(queryWithArea('?screen=card&preview=ongoing', 'business', false), '?preview=ongoing&area=business');
assert.equal(queryWithArea('?area=reviews&seo_subscription=ok', 'home', false), '?area=home&seo_subscription=ok');

// which entry is lit for a screen without one
assert.equal(navParent('activity', 'auto'), 'home');
assert.equal(navParent('extras', 'auto'), 'home');
assert.equal(navParent('profile', 'auto'), 'business');
assert.equal(navParent('profile', 'legacy'), 'more');
assert.equal(navParent('reviews', 'classic'), 'home');
assert.equal(navParent('credits', 'auto'), 'credits');

console.log('dashboard areas: ok');
