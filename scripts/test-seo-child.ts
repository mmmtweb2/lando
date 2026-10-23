// Run: npx ts-node --transpile-only scripts/test-seo-child.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
delete process.env.ANTHROPIC_API_KEY;
import assert from 'node:assert/strict';
import { buildChildContent, normalizeChildText, textOf } from '../src/services/seoChildPage';
import { subSlugFromPhrase } from '../src/services/subdomain.service';

const parent = {
  hero: { title: 'שרברב דני', subtitle: 'שירות מהיר, זמינות 24 שעות', primary_cta_text: 'דברו איתנו' },
  about: { heading: 'עלינו', content: 'אנחנו מתקנים צנרת.' },
  services_or_benefits: [{ id: '1', title: 'תיקון נזילות', description: 'מהיר' }],
  design_system: { primary_color: '#123456' },
  contact: { phone: '050-1234567' },
  faq: [{ question: 'ישן?', answer: 'ישן.' }],
  seo_title: 'ישן',
};
const ctx = { businessName: 'שרברב דני', businessType: 'אינסטלטור', area: 'חיפה', phrase: 'אינסטלטור בחיפה', facts: 'פעילים בחיפה' };

assert.ok(textOf(parent).includes('24'), 'parent numbers are allowed sources');
const { text, dropped } = normalizeChildText({
  heroTitle: 'אינסטלטור בחיפה', heroSubtitle: 'זמינות 24 שעות. מעל 300 לקוחות.',
  aboutHeading: 'אינסטלציה בחיפה', aboutContent: 'שרברב דני משרת את חיפה. עם 15 שנות ניסיון.',
  faq: [{ question: 'כמה זמן מחכים?', answer: 'תלוי בעומס.' }, { question: 'כמה זה עולה?', answer: 'החל מ-200 שקל.' }],
  seoTitle: 'אינסטלטור בחיפה | שרברב דני', seoDescription: 'אינסטלטור בחיפה. זמינות 24 שעות.',
}, parent, ctx);
assert.equal(text.heroSubtitle, 'זמינות 24 שעות.', 'number from the parent kept, invented 300 dropped');
assert.equal(text.aboutContent, 'שרברב דני משרת את חיפה.');
assert.equal(text.faq.length, 1, 'FAQ entry with invented price removed');
assert.equal(dropped, 3);
assert.throws(() => normalizeChildText({ aboutContent: 'יש 500 לקוחות.' }, parent, ctx), /no usable about/);
assert.equal(normalizeChildText({ aboutContent: 'ok.' }, parent, ctx).text.heroTitle, 'אינסטלטור בחיפה', 'falls back to the phrase');

const child = buildChildContent(parent, text);
assert.equal(child.hero.title, 'אינסטלטור בחיפה');
assert.equal(child.hero.primary_cta_text, 'דברו איתנו', 'unrelated hero fields kept');
assert.equal(child.about.content, 'שרברב דני משרת את חיפה.');
assert.deepEqual(child.design_system, parent.design_system, 'look is inherited');
assert.deepEqual(child.contact, parent.contact, 'contact is inherited');
assert.equal(child.services_or_benefits[0].title, 'תיקון נזילות');
assert.equal(parent.hero.title, 'שרברב דני', 'parent object not mutated');
const noFaq = buildChildContent(parent, { ...text, faq: [] });
assert.equal(noFaq.faq[0].question, 'ישן?', 'keeps parent FAQ when none generated');

assert.match(subSlugFromPhrase('אינסטלטור בחיפה'), /^[a-z0-9-]{3,40}$/);
assert.match(subSlugFromPhrase('???'), /^page-[a-z0-9]+$/);

// ── controller (in-memory supabase) ──
import { createChildPage, getChildPages, linkPage, removeChildPage } from '../src/controllers/seoChild.controller';
import { supabase } from '../src/config/supabase';

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const BIZ = U(1), BIZ_OTHER = U(2), PAGE = U(3), PAGE_OTHER = U(4);
const db: Record<string, any[]> = {
  seo_businesses: [
    { id: BIZ, owner_email: 'a@b.co', name: 'שרברב דני', business_type: 'אינסטלטור', service_areas: ['חיפה'], long_tail_phrases: ['אינסטלטור בחיפה', 'שירותי אינסטלטור בחיפה'], facts: 'פעילים בחיפה', landing_page_id: null, google_place_id: 'p' },
    { id: BIZ_OTHER, owner_email: 'o@b.co', name: 'x', business_type: 'מוסך', service_areas: ['חיפה'], long_tail_phrases: ['מוסך בחיפה'], facts: null, landing_page_id: null, google_place_id: 'q' },
  ],
  landing_pages: [
    { id: PAGE, owner_email: 'a@b.co', parent_id: null, slug: 'danny', subdomain: 'danny', status: 'published', business_name: 'שרברב דני', phone_number: '050', ai_content: parent, created_at: '1' },
    { id: PAGE_OTHER, owner_email: 'o@b.co', parent_id: null, slug: 'other', subdomain: 'other', status: 'published', business_name: 'x', phone_number: '1', ai_content: {}, created_at: '1' },
  ],
  leads: [],
};
let conflictsLeft = 0;
(supabase as any).from = (table: string) => {
  const filters: Array<[string, string, unknown]> = [];
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  let patch: any = null; let lim = Infinity;
  const match = (r: any) => filters.every(([k, kind, v]) => kind === 'is' ? (r[k] ?? null) === v : r[k] === v);
  const rows = () => db[table].filter(match).slice(0, lim);
  const run = (): any => {
    if (op === 'update') { const m = rows(); m.forEach(r => Object.assign(r, patch)); return { data: m, error: null }; }
    if (op === 'delete') { const m = rows(); db[table] = db[table].filter(r => !m.includes(r)); return { data: m, error: null }; }
    if (op === 'insert') {
      if (conflictsLeft > 0) { conflictsLeft--; return { data: null, error: { code: '23505', message: 'dup' } }; }
      const row = { id: U(5 + db[table].length), created_at: String(db[table].length), ...patch }; db[table].push(row); return { data: row, error: null };
    }
    return { data: rows().map(r => ({ ...r, hero_title: r.ai_content?.hero?.title ?? null })), error: null };
  };
  const q: any = {
    select: () => q, order: () => q, limit: (n: number) => { lim = n; return q; },
    eq: (k: string, v: unknown) => { filters.push([k, 'eq', v]); return q; },
    is: (k: string, v: unknown) => { filters.push([k, 'is', v]); return q; },
    update: (p: any) => { op = 'update'; patch = p; return q; },
    insert: (p: any) => { op = 'insert'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => run(),
    then: (ok: any) => ok(run()),
  };
  return q;
};
function res() { const r: any = { code: 200, body: undefined }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; }
const req = (o: any) => ({ authEmail: 'a@b.co', params: {}, body: {}, ...o }) as any;

(async () => {
  let r = res(); await createChildPage(req({ params: { id: BIZ }, body: { phrase: 'אינסטלטור בחיפה' } }), r);
  assert.equal(r.code, 400); assert.equal(r.body.code, 'no_page', 'needs a linked page first');

  r = res(); await linkPage(req({ params: { id: BIZ }, body: { pageId: PAGE_OTHER } }), r);
  assert.equal(r.code, 404, "cannot link another account's page");
  r = res(); await linkPage(req({ params: { id: BIZ_OTHER }, body: { pageId: PAGE } }), r);
  assert.equal(r.code, 404); assert.equal(db.seo_businesses[1].landing_page_id, null, "cannot touch another account's business");
  r = res(); await linkPage(req({ params: { id: BIZ }, body: { pageId: 'nope' } }), r); assert.equal(r.code, 400);
  r = res(); await linkPage(req({ params: { id: BIZ }, body: { pageId: PAGE } }), r); assert.equal(r.code, 200);

  r = res(); await createChildPage(req({ params: { id: BIZ }, body: { phrase: 'ביטוי שלא נשמר' } }), r); assert.equal(r.code, 400);
  r = res(); await createChildPage(req({ params: { id: BIZ_OTHER }, body: { phrase: 'מוסך בחיפה' } }), r); assert.equal(r.code, 404);

  conflictsLeft = 1; // first sub_slug collides -> retried with a suffix
  r = res(); await createChildPage(req({ params: { id: BIZ }, body: { phrase: 'אינסטלטור בחיפה' } }), r);
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const child = db.landing_pages.find(p => p.parent_id === PAGE);
  assert.equal(child.status, 'published'); assert.equal(child.target_keyword, 'אינסטלטור בחיפה');
  assert.equal(child.owner_email, 'a@b.co'); assert.equal(child.business_name, 'שרברב דני');
  assert.match(child.sub_slug, /^[a-z0-9-]+-[a-z0-9]{4}$/, 'suffix added after the collision');
  assert.deepEqual(child.ai_content.design_system, parent.design_system, 'child inherits the parent look');
  assert.match(r.body.page.url, /^https:\/\/pagey\.co\.il\/b\/danny\//);

  r = res(); await createChildPage(req({ params: { id: BIZ }, body: { phrase: 'אינסטלטור בחיפה' } }), r);
  assert.equal(r.code, 409); assert.equal(r.body.code, 'exists');

  r = res(); await getChildPages(req({ params: { id: BIZ } }), r);
  assert.equal(r.body.pages.length, 1); assert.equal(r.body.parent.id, PAGE);

  // deletion: refused while the page has leads, allowed after, scoped to the owner
  db.leads.push({ id: 'l1', landing_page_id: child.id });
  r = res(); await removeChildPage(req({ params: { id: BIZ, pageId: child.id } }), r);
  assert.equal(r.code, 409); assert.equal(r.body.code, 'has_leads'); assert.ok(db.landing_pages.some(p => p.id === child.id));
  db.leads.length = 0;
  r = res(); await removeChildPage(req({ authEmail: 'o@b.co', params: { id: BIZ, pageId: child.id } }), r);
  assert.equal(r.code, 404); assert.ok(db.landing_pages.some(p => p.id === child.id), 'other account cannot delete');
  r = res(); await removeChildPage(req({ params: { id: BIZ, pageId: PAGE } }), r);
  assert.equal(r.code, 404, 'the parent itself can never be deleted through this route');
  r = res(); await removeChildPage(req({ params: { id: BIZ, pageId: child.id } }), r);
  assert.equal(r.code, 200); assert.ok(!db.landing_pages.some(p => p.id === child.id));

  // per-parent limit
  for (let i = 0; i < 5; i++) db.landing_pages.push({ id: U(6), parent_id: PAGE, target_keyword: `k${i}`, sub_slug: `s${i}`, slug: `s${i}`, ai_content: {} });
  r = res(); await createChildPage(req({ params: { id: BIZ }, body: { phrase: 'שירותי אינסטלטור בחיפה' } }), r);
  assert.equal(r.code, 409); assert.equal(r.body.code, 'child_limit');
  console.log('seo child page checks passed');
})().catch(e => { console.error(e); process.exit(1); });
