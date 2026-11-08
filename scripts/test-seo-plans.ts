// Run: npx tsx scripts/test-seo-plans.ts   (imports client ES modules)
// The pure helpers behind the /seo-plan selector. Also checks the client's plan ids/prices against the server catalog.
import assert from 'node:assert/strict';
import { addonPrice, cycleUnit, pageLine, pickPlan, planLabel, type Catalog } from '../client/src/lib/seoPlans';
import { publicSeoCatalog } from '../src/config/seoCatalog';

const cat = publicSeoCatalog() as unknown as Catalog;

// four plans, each reachable by (cycle, withPage)
assert.equal(cat.plans.length, 4);
const picks = [['month', false, 'monthly', 250], ['month', true, 'monthly_page', 265], ['year', false, 'annual', 2500], ['year', true, 'annual_page', 2650]] as const;
for (const [c, w, id, price] of picks) {
  const p = pickPlan(cat, c, w);
  assert.ok(p, `${id} found`);
  assert.equal(p.id, id);
  assert.equal(p.price, price, `${id} price`);
}
assert.equal(pickPlan(null, 'month', false), null);

// the selector's add-on line matches the difference between the plans (nothing typed twice)
assert.equal(addonPrice(cat, 'month'), pickPlan(cat, 'month', true)!.price - pickPlan(cat, 'month', false)!.price);
assert.equal(addonPrice(cat, 'year'), pickPlan(cat, 'year', true)!.price - pickPlan(cat, 'year', false)!.price);

// annual: saving shown against paying monthly; monthly: none
assert.equal(pickPlan(cat, 'year', false)!.savingVsMonthly, 250 * 12 - 2500);
assert.equal(pickPlan(cat, 'year', true)!.savingVsMonthly, 265 * 12 - 2650);
assert.equal(pickPlan(cat, 'month', false)!.savingVsMonthly, 0);

assert.equal(cycleUnit('year'), 'לשנה');
assert.equal(cycleUnit('month'), 'לחודש');
assert.equal(planLabel('year', true), 'מנוי שנתי, עם דף נחיתה');
assert.equal(planLabel('month', false), 'מנוי חודשי');

// included page line
assert.equal(pageLine(null), '');
assert.equal(pageLine({ included: false, pageId: null, status: null }), '');
assert.match(pageLine({ included: true, pageId: null, status: null }), /עדיין לא נוצר/);
assert.match(pageLine({ included: true, pageId: 'p', status: 'published' }), /באוויר/);
assert.match(pageLine({ included: true, pageId: 'p', status: 'frozen' }), /מוקפא/);
assert.match(pageLine({ included: true, pageId: 'p', status: 'draft' }), /מוכן לעריכה/);

// no ranking promise in the helper texts
for (const t of [pageLine({ included: true, pageId: null, status: null }), pageLine({ included: true, pageId: 'p', status: 'frozen' })]) {
  assert.ok(!/דירוג|מקום ראשון|מובטח|עדכון אוטומטי בגוגל/.test(t));
}
console.log('seo plans checks passed');
