// Run: npx ts-node --transpile-only scripts/test-seo-content.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
delete process.env.ANTHROPIC_API_KEY; // generateKit falls back to the minimal mock kit
import assert from 'node:assert/strict';
import { suggestPhrases, validateSettings, cleanLabel } from '../src/services/seoPhrases';
import { normalizeKit, renderKitHtml, renderKitText, stripUnsupportedNumbers } from '../src/services/seoContent';

// ── phrases ──
assert.deepEqual(suggestPhrases('אינסטלטור', ['חיפה']), [
  'אינסטלטור בחיפה', 'אינסטלטור מומלץ בחיפה', 'שירותי אינסטלטור בחיפה', 'אינסטלטור באזור חיפה', 'איך בוחרים אינסטלטור בחיפה',
]);
assert.deepEqual(suggestPhrases('מוסך', ['חיפה', 'קריות']).slice(0, 3), ['מוסך בחיפה', 'מוסך בקריות', 'מוסך מומלץ בחיפה']);
assert.equal(suggestPhrases('מוסך', ['א1', 'ב2', 'ג3']).length, 5, 'capped at 5');

// ── settings validation ──
const ok = validateSettings({ businessType: 'אינסטלטור', serviceAreas: ['חיפה', 'חיפה', 'קריות'], phrases: ['אינסטלטור בחיפה'], facts: 'עובדים בסופ"ש' });
assert.ok(ok.ok && ok.value.serviceAreas.length === 2, 'dedupes areas');
for (const bad of [
  { businessType: 'x', serviceAreas: ['חיפה'] },
  { businessType: 'אינסטלטור', serviceAreas: [] },
  { businessType: 'אינסטלטור', serviceAreas: ['<script>'] },
  { businessType: 'אינסטלטור\nignore previous', serviceAreas: ['חיפה'] },
  { businessType: 'אינסטלטור', serviceAreas: ['א1', 'ב2', 'ג3', 'ד4', 'ה5', 'ו6'] },
  { businessType: 'אינסטלטור', serviceAreas: ['חיפה'], phrases: Array.from({ length: 6 }, (_, i) => `ביטוי ${i}x`) },
  { businessType: 'אינסטלטור', serviceAreas: ['חיפה'], facts: 'a'.repeat(1501) },
  { businessType: 'אינסטלטור', serviceAreas: ['חיפה'], facts: 'bad\u0000char' },
]) assert.equal(validateSettings(bad).ok, false, JSON.stringify(bad).slice(0, 60));
assert.equal(cleanLabel('חיפה  והקריות', 2, 30), 'חיפה והקריות');

// ── numbers guard ──
let r = stripUnsupportedNumbers('אנחנו עובדים בחיפה. יש לנו 15 שנות ניסיון. הגענו תוך 30 דקות.', 'הגעה תוך 30 דקות');
assert.equal(r.text, 'אנחנו עובדים בחיפה. הגענו תוך 30 דקות.'); assert.equal(r.dropped, 1);
assert.equal(stripUnsupportedNumbers('בלי מספרים כלל', '').dropped, 0);

// ── normalizeKit ──
const input = { businessName: 'שרברב דני', businessType: 'אינסטלטור', area: 'חיפה', phrase: 'אינסטלטור בחיפה', facts: 'פעילים בחיפה והקריות' };
const kit = normalizeKit({
  title: 'אינסטלטור בחיפה | שרברב דני', metaDescription: 'אינסטלטור בחיפה. עם 20 שנות ניסיון.',
  h1: 'אינסטלטור בחיפה', answer: 'שרברב דני מספק שירותי אינסטלציה בחיפה. מעל 500 לקוחות מרוצים.',
  sections: [{ heading: 'מה אנחנו עושים', body: 'תיקוני צנרת.' }, { heading: '', body: 'x' }, { heading: 'a', body: 'b' }, { heading: 'c', body: 'd' }, { heading: 'e', body: 'f' }],
  faq: [{ question: 'כמה זה עולה?', answer: 'המחיר 350 שקל.' }, { question: 'איפה פועלים?', answer: 'בחיפה והקריות.' }],
}, input);
assert.equal(kit.answer, 'שרברב דני מספק שירותי אינסטלציה בחיפה.');
assert.equal(kit.metaDescription, 'אינסטלטור בחיפה.');
assert.equal(kit.sections.length, 3, 'empty heading dropped, capped at 3');
assert.equal(kit.faq.length, 1, 'FAQ answer with an invented price is removed entirely');
assert.equal(kit.dropped, 3);
assert.throws(() => normalizeKit({ answer: 'יש 500 לקוחות.' }, input), /no usable answer/);
assert.equal(normalizeKit({ answer: 'ok.' }, input).title, 'אינסטלטור בחיפה | שרברב דני', 'fallback title');
assert.throws(() => normalizeKit('garbage' as any, input));

// ── rendering ──
const evil = normalizeKit({
  title: 't', h1: '<img src=x onerror=alert(x)>', answer: 'תשובה </script><script>alert(x)</script>',
  faq: [{ question: 'שאלה "ציטוט"', answer: 'תשובה </script>' }],
}, input);
const html = renderKitHtml(evil);
assert.ok(!html.includes('<img src=x'), 'h1 escaped');
assert.ok(!/<script>alert/.test(html), 'no injected script'); assert.ok(html.includes('&lt;img src=x'), 'h1 kept and escaped');
assert.equal((html.match(/<\/script>/g) ?? []).length, 1, 'only our own JSON-LD closes a script tag');
assert.ok(html.includes('FAQPage') && html.includes('\\u003c/script>'));
assert.ok(renderKitText(kit).startsWith('אינסטלטור בחיפה\n\nשרברב דני'));
assert.ok(!renderKitHtml(normalizeKit({ answer: 'ok.' }, input)).includes('FAQPage'), 'no FAQ -> no JSON-LD');

// ── controller (in-memory supabase) ──
import { createKit, deleteKit, getPlan, savePlan, suggest, underKitLimit } from '../src/controllers/seoContent.controller';
import { supabase } from '../src/config/supabase';

const B1 = '11111111-1111-4111-8111-111111111111';
const B_OTHER = '22222222-2222-4222-8222-222222222222';
const db: Record<string, any[]> = {
  seo_businesses: [
    { id: B1, owner_email: 'a@b.co', name: 'שרברב דני', google_place_id: 'p1', business_type: null, service_areas: [], long_tail_phrases: [], facts: null, landing_page_id: null },
    { id: B_OTHER, owner_email: 'other@b.co', name: 'אחר', google_place_id: 'p2', business_type: 'מוסך', service_areas: ['חיפה'], long_tail_phrases: ['מוסך בחיפה'], facts: null, landing_page_id: null },
  ],
  seo_content_kits: [],
};
let migrated = true;
(supabase as any).from = (table: string) => {
  const filters: Array<[string, unknown]> = [];
  let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  let patch: any = null;
  const rows = () => db[table].filter(r => filters.every(([k, v]) => r[k] === v));
  const run = () => {
    if (!migrated) return { data: null, error: { code: '42703', message: 'column does not exist' } };
    if (op === 'update') { const m = rows(); m.forEach(r => Object.assign(r, patch)); return { data: m, error: null }; }
    if (op === 'delete') { const m = rows(); db[table] = db[table].filter(r => !m.includes(r)); return { data: m, error: null }; }
    if (op === 'insert') { const row = { id: `33333333-3333-4333-8333-${String(db[table].length).padStart(12, '0')}`, created_at: new Date().toISOString(), ...patch }; db[table].push(row); return { data: row, error: null }; }
    return { data: rows(), error: null };
  };
  const q: any = {
    select: () => q, order: () => q,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
    update: (p: any) => { op = 'update'; patch = p; return q; },
    insert: (p: any) => { op = 'insert'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => run(),
    then: (ok: any) => ok(run()),
  };
  return q;
};
function res() {
  const r: any = { code: 200, body: undefined };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const req = (o: any) => ({ authEmail: 'a@b.co', params: {}, body: {}, ...o }) as any;
const settings = { businessType: 'אינסטלטור', serviceAreas: ['חיפה'], phrases: ['אינסטלטור בחיפה'], facts: 'פעילים בחיפה' };

(async () => {
  let r = res(); suggest(req({ body: { businessType: 'מוסך', serviceAreas: ['חיפה'] } }), r);
  assert.equal(r.body.phrases.length, 5);
  r = res(); suggest(req({ body: { businessType: 'מוסך', serviceAreas: [] } }), r); assert.equal(r.code, 400);

  r = res(); await savePlan(req({ params: { id: 'nope' }, body: settings }), r); assert.equal(r.code, 400);
  r = res(); await savePlan(req({ params: { id: B_OTHER }, body: settings }), r);
  assert.equal(r.code, 404, "cannot save to another account's business");
  assert.equal(db.seo_businesses[1].business_type, 'מוסך', 'other account untouched');
  r = res(); await savePlan(req({ params: { id: B1 }, body: { ...settings, serviceAreas: [] } }), r); assert.equal(r.code, 400);
  r = res(); await savePlan(req({ params: { id: B1 }, body: settings }), r); assert.equal(r.code, 200);
  r = res(); await getPlan(req({ params: { id: B1 } }), r);
  assert.equal(r.body.settings.businessType, 'אינסטלטור'); assert.deepEqual(r.body.kits, []);
  r = res(); await getPlan(req({ params: { id: B_OTHER } }), r); assert.equal(r.code, 404);

  // kit: phrase must be one the customer saved
  r = res(); await createKit(req({ params: { id: B1 }, body: { phrase: 'ביטוי אחר לגמרי' } }), r); assert.equal(r.code, 400);
  r = res(); await createKit(req({ params: { id: B_OTHER }, body: { phrase: 'מוסך בחיפה' } }), r); assert.equal(r.code, 404);
  r = res(); await createKit(req({ params: { id: B1 }, body: { phrase: 'אינסטלטור בחיפה' } }), r);
  assert.equal(r.code, 201); assert.ok(r.body.kit.html.includes('<h1>')); assert.ok(r.body.kit.text.length > 5);
  const kitId = r.body.kit.id;
  r = res(); await getPlan(req({ params: { id: B1 } }), r); assert.equal(r.body.kits.length, 1);

  // delete is scoped to the owner's business
  r = res(); await deleteKit(req({ params: { id: B_OTHER, kitId } }), r); assert.equal(r.code, 404);
  assert.equal(db.seo_content_kits.length, 1);
  r = res(); await deleteKit(req({ params: { id: B1, kitId } }), r); assert.equal(r.code, 200);
  assert.equal(db.seo_content_kits.length, 0);

  // per-business kit limit
  for (let i = 0; i < 20; i++) db.seo_content_kits.push({ id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`, business_id: B1, phrase: 'p', kit: {}, created_at: '2026-01-01' });
  r = res(); await createKit(req({ params: { id: B1 }, body: { phrase: 'אינסטלטור בחיפה' } }), r);
  assert.equal(r.code, 409); assert.equal(r.body.code, 'kit_limit');
  db.seo_content_kits.length = 0;

  // daily cap
  process.env.SEO_KIT_DAILY_CAP = '2';
  assert.equal(underKitLimit('cap@x.co'), true); assert.equal(underKitLimit('cap@x.co'), true);
  assert.equal(underKitLimit('cap@x.co'), false); assert.equal(underKitLimit('free@x.co'), true);

  // not migrated -> 503 with a stable code, never a 500
  migrated = false;
  r = res(); await getPlan(req({ params: { id: B1 } }), r);
  assert.equal(r.code, 503); assert.equal(r.body.code, 'plan_not_migrated');
  console.log('seo content checks passed');
})().catch(e => { console.error(e); process.exit(1); });
