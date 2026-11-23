// Run: npx tsx scripts/test-page-refresh.ts   (no network, no DB)
// README part 146: "עדכון הדף לפי פרטי העסק". The writer's input from the card, the services from the card (with
// their descriptions, never invented), the merge (what is replaced and what is kept: testimonials, team, spoken
// languages, headings, images, design), the per-section choice, the review, the stale translations after
// applying, the daily counter, the candidate store, and the orchestration against a fake writer.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { type TruthCard, emptyCard } from '../src/services/businessTruth';
import { type AiContent, type GenerateInput, GenerationUnavailable, generateAiContent } from '../src/services/ai.service';
import {
  CANDIDATE_TTL_MS, CandidateStore, REFRESH_DAILY_LIMIT, REFRESH_SECTIONS, RefreshCounter, buildCandidate, cardFactsText, cardToGenerateInput,
  cardUsable, mergeRefresh, nextCategory, previewSections, sectionView, servicesFromCard, serviceKey,
} from '../src/services/pageRefresh';
import { RefreshError, adminRefresh, applyRefresh, previewRefresh, type RefreshDeps, type RefreshPageRow } from '../src/services/pageRefresh.service';
import { flattenTranslatable, mergeTranslated, staleKeys } from '../src/services/landingLanguages';

const CARD: TruthCard = {
  ...emptyCard(),
  name: 'אינסטלציה דני', phone: '04-8123456', address: 'הרצל 10, חיפה', city: 'חיפה', category: 'אינסטלטור',
  description: 'אינסטלטור בחיפה והקריות. מגיעים מהר ונותנים הצעת מחיר לפני שמתחילים.',
  services: [
    { name: 'פתיחת סתימות', description: 'במטבח ובאמבטיה, עם ציוד מקצועי', source: 'google' },
    { name: 'החלפת דוד שמש', description: '', source: 'customer' },
    { name: 'איתור נזילות', description: 'בלי לשבור קירות', source: 'google' },
  ],
  areas: ['חיפה', 'קריית ביאליק'],
  serviceArea: { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: [{ name: 'נשר', placeId: 'ChIJ_nesher_xx' }] },
  hours: [{ day: 'SUNDAY', open: '08:00', close: '18:00' }, { day: 'MONDAY', open: '08:00', close: '18:00' }],
  attributes: { 'attributes/wheelchair_accessible_entrance': true, 'attributes/has_parking': false },
  notes: 'עובדים נקי ומסבירים כל שלב.',
};
const META = [{ name: 'attributes/wheelchair_accessible_entrance', label: 'כניסה נגישה לכיסאות גלגלים', group: 'נגישות' }];

// The page as it was built from the card before the card had good details.
const IMAGES = JSON.stringify({ hero_image_url: 'https://img.test/hero.webp', icon_urls: ['https://img.test/a.webp', 'https://img.test/b.webp'], gallery_urls: [] });
const OLD: AiContent = {
  hero: { title: 'אינסטלציה דני', subtitle: 'שירותי אינסטלציה.', primary_cta_text: 'צרו קשר', hero_image_prompt: 'OLD HERO PROMPT' },
  about: { heading: 'הסיפור שלי', content: 'כאן כדאי לכתוב כמה משפטים על העסק.' },
  services_or_benefits: [
    { id: 's1', title: 'שירות ראשון', description: 'כאן מתארים את השירות.', service_image_prompt: 'p1' },
    { id: 's2', title: 'איתור נזילות', description: 'ישן', service_image_prompt: 'leak photo', service_icon_keyword: 'pipe' },
  ],
  services_heading: 'מה אני עושה',
  benefits: [{ title: 'יתרון ראשון', description: 'כאן כותבים יתרון.' }],
  faq: [{ question: 'איך מתחילים?', answer: 'משאירים פרטים.' }],
  faq_heading: 'שאלות נפוצות',
  process_steps: [{ step_number: 1, title: 'יצירת קשר', description: 'משאירים פרטים.' }],
  testimonials: [{ quote: 'הגיע תוך שעה ופתח את הסתימה.', author: 'רונית', role: 'חיפה' }],
  testimonials_heading: 'לקוחות מספרים',
  team: [{ name: 'דני כהן', role: 'אינסטלטור', credentials: '', experience: '' }],
  spoken_languages: ['עברית', 'רוסית'],
  practical_info: { parking: 'חניה ברחוב' },
  contact: { phone: '0501111111', address: 'ישן 1', business_hours: 'תמיד', whatsapp_message: 'היי', cta_type: 'whatsapp' },
  design_system: { primary_color: '#123456', secondary_color: '#654321' },
  color_palette: { primary: '#123456', secondary_accent: '#ff0000', surface_bg: '#ffffff' },
  layout_composition: ['hero_center', 'services_grid', 'faq_accordion', 'cta_banner'],
  hidden_sections: ['process'],
  cta_banner_subline: 'אפשר ליצור קשר בכל שאלה',
  seo_title: 'אינסטלציה דני', seo_description: 'פרטים על העסק.',
};

// What the writer returns for the current card (stands for generateAiContent's answer).
const WRITTEN: AiContent = {
  hero: { title: 'אינסטלטור בחיפה שמגיע מהר', subtitle: 'פתיחת סתימות ואיתור נזילות, עם הצעת מחיר לפני שמתחילים.', primary_cta_text: 'שלחו הודעה עכשיו', hero_image_prompt: 'NEW PROMPT' },
  about: { heading: 'על דני', content: 'אינסטלטור בחיפה ובקריות. מסבירים כל שלב ומשאירים נקי.' },
  services_or_benefits: [
    { id: '1', title: 'פתיחת סתימות', description: 'סתימה במטבח? פותחים מהר.' },
    { id: '2', title: 'החלפת דוד', description: 'מחליפים דוד שמש ישן בחדש.' },
    { id: '3', title: 'ניקוי מרזבים', description: 'שירות שהכותב המציא.' },
  ],
  services_heading: 'אינסטלציה לבית',
  benefits: [{ title: 'הצעת מחיר מראש', description: 'יודעים כמה זה עולה לפני שמתחילים.' }],
  benefits_heading: 'למה דני',
  faq: [{ question: 'אתם מגיעים לנשר?', answer: 'כן, גם לנשר ולקריית ביאליק.' }],
  faq_heading: 'שאלות על אינסטלציה',
  process_steps: [{ step_number: 1, title: 'שולחים הודעה', description: 'מספרים מה קרה.' }],
  testimonials: [{ quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' }],
  team: [{ name: 'מומצא', role: '', credentials: '', experience: '' }],
  spoken_languages: ['עברית'],
  trust_badges: [{ label: 'הצעת מחיר מראש' }],
  cta_banner_subline: 'סתימה? כתבו לנו ונגיע.',
  seo_title: 'אינסטלציה דני | אינסטלטור בחיפה', seo_description: 'פתיחת סתימות ואיתור נזילות בחיפה.',
  design_system: { primary_color: '#000000' },
  color_palette: { primary: '#000000', secondary_accent: '#000000', surface_bg: '#000000' },
  layout_composition: ['hero_split', 'cta_banner'],
  contact: { phone: '04-8123456', address: 'הרצל 10, חיפה' },
};

async function main() {
  // ── the card ────────────────────────────────────────────────────────────────
  assert.equal(cardUsable(CARD), true);
  assert.equal(cardUsable({ ...emptyCard(), name: 'x' }), false, 'a name alone is not enough to write from');
  assert.equal(cardUsable({ ...emptyCard(), name: 'x', services: [{ name: 'שירות', description: '', source: 'google' }] }), true);
  assert.equal(cardUsable(null), false);

  const facts = cardFactsText(CARD, META);
  assert.match(facts, /פתיחת סתימות: במטבח ובאמבטיה, עם ציוד מקצועי/, 'services go to the writer WITH their descriptions');
  assert.match(facts, /• החלפת דוד שמש\n/, 'a service without a description is still listed');
  assert.match(facts, /רק אלה/);
  assert.match(facts, /נשר/); assert.match(facts, /קריית ביאליק/);
  assert.match(facts, /כניסה נגישה לכיסאות גלגלים/); assert.doesNotMatch(facts, /has_parking/, 'only YES attributes, by name');
  assert.match(facts, /א׳-ב׳ 08:00-18:00/, 'hours');
  assert.match(facts, /עובדים נקי/, 'notes are facts for the writer');
  assert.doesNotMatch(cardFactsText({ ...CARD, open: false }, META), /שעות פעילות:/, 'a closed business: no hours');

  const page = { business_name: 'ישן', phone_number: '050', design_style: 'warm', page_goal: 'lead_gen', ai_content: OLD, category: 'general', category_source: 'auto' };
  const input = cardToGenerateInput(CARD, META, page, 'general');
  assert.equal(input.business_name, 'אינסטלציה דני');
  assert.equal(input.about_business, CARD.description);
  assert.equal(input.address, 'הרצל 10, חיפה');
  assert.equal(input.design_style, 'warm'); assert.equal(input.page_goal, 'lead_gen'); assert.equal(input.cta_type, 'whatsapp');
  assert.equal(input.include_testimonials, false, 'the writer never writes testimonials here');
  assert.equal(input.image_source, 'none');
  assert.equal(cardToGenerateInput({ ...CARD, serviceArea: { type: 'CUSTOMER_LOCATION_ONLY', places: [] } }, [], page, 'general').address, undefined, 'a hidden address is never written');

  // category: re-detected only when not chosen by hand
  const dentist: TruthCard = { ...emptyCard(), name: 'מרפאת שיניים לוי', category: 'רופא שיניים', description: 'מרפאת שיניים ברעננה. טיפולי שורש והלבנת שיניים.' };
  assert.equal(nextCategory({ category: 'general', category_source: 'auto' }, dentist), 'health');
  assert.equal(nextCategory({ category: null, category_source: null }, dentist), 'health');
  assert.equal(nextCategory({ category: 'general', category_source: 'manual' }, dentist), 'general', 'manual stays');
  assert.equal(nextCategory({ category: 'general', category_source: 'auto' }, CARD), 'trades', 'a plumber is a trade (renders as the general template)');

  // ── services: the card's list, with its descriptions, never invented ───────
  const svc = servicesFromCard(CARD.services, WRITTEN.services_or_benefits, OLD.services_or_benefits)!;
  assert.deepEqual(svc.map((s) => s.title).sort(), ['איתור נזילות', 'החלפת דוד שמש', 'פתיחת סתימות'].sort(), 'exactly the card services');
  assert.ok(!svc.some((s) => s.title === 'ניקוי מרזבים'), 'an invented service is dropped');
  assert.equal(svc.find((s) => s.title === 'פתיחת סתימות')!.description, 'במטבח ובאמבטיה, עם ציוד מקצועי', 'the card description wins');
  assert.equal(svc.find((s) => s.title === 'החלפת דוד שמש')!.description, 'מחליפים דוד שמש ישן בחדש.', 'no card description: the writer sentence for it');
  const leak = svc.find((s) => s.title === 'איתור נזילות')!;
  assert.equal(leak.description, 'בלי לשבור קירות');
  assert.equal(leak.id, 's2'); assert.equal(leak.service_image_prompt, 'leak photo'); assert.equal(leak.service_icon_keyword, 'pipe');
  assert.equal(svc.indexOf(leak), 1, 'a service the page had keeps its position (its per-position picture stays with it)');
  assert.equal(servicesFromCard([], WRITTEN.services_or_benefits, OLD.services_or_benefits), null, 'no services on the card: not offered');
  assert.equal(serviceKey('תיקון  נזילות.'), 'תיקון נזילות');
  // a written list of the same length with other names: matched by position for the description only
  const byPos = servicesFromCard([{ name: 'א', description: '', source: 'google' }], [{ id: '1', title: 'ב', description: 'תיאור' }], [])!;
  assert.deepEqual(byPos.map((s) => [s.title, s.description]), [['א', 'תיאור']]);

  const cand = buildCandidate(WRITTEN, CARD, OLD);
  assert.equal(cand.services_or_benefits!.length, 3);
  assert.equal(buildCandidate(WRITTEN, { ...CARD, services: [] }, OLD).services_or_benefits, undefined);

  // ── merge: everything selected ─────────────────────────────────────────────
  const ALL = REFRESH_SECTIONS.map((s) => s.id);
  const m = mergeRefresh(OLD, cand, ALL);
  assert.equal(m.hero!.title, WRITTEN.hero!.title); assert.equal(m.hero!.subtitle, WRITTEN.hero!.subtitle); assert.equal(m.hero!.primary_cta_text, 'שלחו הודעה עכשיו');
  assert.equal(m.hero!.hero_image_prompt, 'OLD HERO PROMPT', 'the image prompt is the page\'s (images untouched)');
  assert.equal(m.about!.content, WRITTEN.about!.content);
  assert.equal(m.about!.heading, 'הסיפור שלי', 'a heading the page has stays');
  assert.equal(m.services_heading, 'מה אני עושה'); assert.equal(m.faq_heading, 'שאלות נפוצות');
  assert.equal(m.benefits_heading, 'למה דני', 'an empty heading is filled');
  assert.deepEqual(m.services_or_benefits, cand.services_or_benefits);
  assert.deepEqual(m.benefits, WRITTEN.benefits); assert.deepEqual(m.faq, WRITTEN.faq); assert.deepEqual(m.process_steps, WRITTEN.process_steps);
  assert.equal(m.cta_banner_subline, WRITTEN.cta_banner_subline); assert.deepEqual(m.trust_badges, WRITTEN.trust_badges);
  assert.equal(m.seo_title, WRITTEN.seo_title); assert.equal(m.seo_description, WRITTEN.seo_description);
  // kept
  assert.deepEqual(m.testimonials, OLD.testimonials, 'real testimonials stay');
  assert.equal(m.testimonials_heading, 'לקוחות מספרים');
  assert.deepEqual(m.team, OLD.team, 'the team stays');
  assert.deepEqual(m.spoken_languages, ['עברית', 'רוסית'], 'spoken languages stay');
  assert.deepEqual(m.practical_info, OLD.practical_info);
  assert.deepEqual(m.contact, OLD.contact, 'contact details (and the contact method) stay');
  assert.deepEqual(m.design_system, OLD.design_system); assert.deepEqual(m.color_palette, OLD.color_palette);
  assert.deepEqual(m.layout_composition, OLD.layout_composition); assert.deepEqual(m.hidden_sections, ['process'], 'hidden sections stay');
  assert.equal(JSON.stringify(OLD).includes('אינסטלטור בחיפה שמגיע מהר'), false, 'the old content object is not mutated');

  // a section heading changes with a new template
  assert.equal(mergeRefresh(OLD, cand, ['faq'], { categoryChanged: true }).faq_heading, 'שאלות על אינסטלציה');

  // ── per-section choice ─────────────────────────────────────────────────────
  const some = mergeRefresh(OLD, cand, ['hero', 'faq']);
  assert.equal(some.hero!.title, WRITTEN.hero!.title); assert.deepEqual(some.faq, WRITTEN.faq);
  assert.deepEqual(some.about, OLD.about, 'unticked: old text'); assert.deepEqual(some.services_or_benefits, OLD.services_or_benefits);
  assert.deepEqual(some.benefits, OLD.benefits); assert.equal(some.seo_title, OLD.seo_title);
  assert.deepEqual(mergeRefresh(OLD, cand, []), OLD, 'nothing ticked = nothing changes');
  // empty candidate sections never wipe the page (the second writer call failed)
  const thin = mergeRefresh(OLD, { ...cand, benefits: [], faq: [], process_steps: [] }, ALL);
  assert.deepEqual(thin.benefits, OLD.benefits); assert.deepEqual(thin.faq, OLD.faq); assert.deepEqual(thin.process_steps, OLD.process_steps);
  // a v1 page with `services` only gets services_or_benefits and loses the stale copy
  const v1 = mergeRefresh({ ...OLD, services_or_benefits: undefined, services: [{ id: 'x', title: 'ישן', description: '' }] }, cand, ['services']);
  assert.equal(v1.services, undefined); assert.equal(v1.services_or_benefits!.length, 3);
  // hero.slogan (v1) gives way to the new subtitle
  assert.equal(mergeRefresh({ ...OLD, hero: { title: 't', slogan: 'סלוגן' } }, cand, ['hero']).hero!.slogan, undefined);

  // ── the review ─────────────────────────────────────────────────────────────
  const prev = previewSections(OLD, cand);
  assert.deepEqual(prev.map((s) => s.id), ['hero', 'about', 'services', 'benefits', 'process', 'faq', 'closing', 'seo'], 'page order');
  const hero = prev.find((s) => s.id === 'hero')!;
  assert.equal(hero.label, 'הפתיחה');
  assert.deepEqual(hero.before[0], { title: 'אינסטלציה דני', text: 'שירותי אינסטלציה.' });
  assert.deepEqual(hero.after[1], { text: 'כפתור: שלחו הודעה עכשיו' });
  const svcPrev = prev.find((s) => s.id === 'services')!;
  assert.deepEqual(svcPrev.after[0], { title: 'מה אני עושה' }, 'the kept heading shows as it will be');
  assert.ok(svcPrev.after.some((l) => l.title === 'פתיחת סתימות' && l.text === 'במטבח ובאמבטיה, עם ציוד מקצועי'));
  assert.deepEqual(previewSections(OLD, OLD), [], 'nothing to change: no sections');
  assert.ok(!previewSections(OLD, { ...cand, faq: OLD.faq }).some((s) => s.id === 'faq'), 'an unchanged section is not offered');
  assert.deepEqual(sectionView({}, 'faq'), []);

  // ── translations become stale by themselves (source hashes) ───────────────
  const flatOld = flattenTranslatable(OLD, IMAGES);
  const row = mergeTranslated(flatOld, { content: {}, source_hash: {}, manual_keys: [] }, Object.fromEntries(Object.keys(flatOld).map((k) => [k, `FR ${k}`])), []);
  assert.deepEqual(staleKeys(flatOld, row), [], 'fresh translation: nothing stale');
  const flatHeroOnly = flattenTranslatable(mergeRefresh(OLD, cand, ['hero']), IMAGES);
  assert.deepEqual(staleKeys(flatHeroOnly, row).sort(), ['hero.primary_cta_text', 'hero.subtitle', 'hero.title'], 'only the replaced texts are stale');
  const staleAll = staleKeys(flattenTranslatable(m, IMAGES), row);
  for (const k of ['about.content', 'services_or_benefits.0.title', 'faq.0.question', 'seo_title', 'cta_banner_subline']) assert.ok(staleAll.includes(k), k);
  for (const k of ['testimonials.0.quote', 'team.0.role', 'spoken_languages.1', 'about.heading', 'contact.business_hours', 'faq_heading']) assert.ok(!staleAll.includes(k), `kept text is not stale: ${k}`);

  // ── the daily counter ──────────────────────────────────────────────────────
  assert.equal(REFRESH_DAILY_LIMIT, 3);
  const ctr = new RefreshCounter();
  const day = new Date('2026-11-23T10:00:00Z');
  for (let i = 0; i < 3; i++) assert.equal(ctr.take('p1', 'owner', day), true);
  assert.equal(ctr.take('p1', 'owner', day), false, 'the 4th today is refused');
  assert.equal(ctr.take('p2', 'owner', day), true, 'per page');
  assert.equal(ctr.take('p1', 'admin', day), true, 'admin has its own count');
  ctr.refund('p1', 'owner', day);
  assert.equal(ctr.remaining('p1', 'owner', day), 1); assert.equal(ctr.take('p1', 'owner', day), true);
  assert.equal(ctr.take('p1', 'owner', new Date('2026-11-23T22:30:00Z')), true, 'a new day in Israel (00:30) renews');

  // ── the candidate store ────────────────────────────────────────────────────
  const st = new CandidateStore();
  st.put('t1', { pageId: 'p1', candidate: cand, category: 'general', categoryChanged: false, at: 1000 });
  assert.equal(st.get('t1', 'p2', 1000), null, 'another page');
  assert.ok(st.get('t1', 'p1', 1000 + CANDIDATE_TTL_MS));
  assert.equal(st.get('t1', 'p1', 1001 + CANDIDATE_TTL_MS), null, 'expired');

  // ── orchestration against a fake writer ────────────────────────────────────
  const saved: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let pageRow: RefreshPageRow = { id: 'p1', owner_email: 'a@b.c', parent_id: null, business_name: 'ישן', phone_number: '050', design_style: 'warm', page_goal: 'lead_gen', about_business: null, ai_content: OLD, category: 'general', category_source: 'auto' };
  let calls = 0;
  let writer: (i: GenerateInput) => Promise<AiContent> = async () => { calls++; return WRITTEN; };
  let tokens = 0;
  const deps = (over: Partial<RefreshDeps> = {}): RefreshDeps => ({
    page: async (id) => (id === pageRow.id ? JSON.parse(JSON.stringify(pageRow)) : null),
    card: async () => ({ card: CARD, meta: META }),
    generate: (i) => writer(i),
    save: async (id, patch) => { saved.push({ id, patch }); pageRow = { ...pageRow, ai_content: patch.ai_content, ...(patch.category ? { category: patch.category, category_source: patch.category_source } : {}) }; },
    hasKey: () => true,
    now: () => day,
    counter: new RefreshCounter(),
    store: new CandidateStore(),
    token: () => `tok${++tokens}`,
    ...over,
  });
  const d = deps();
  const pv = await previewRefresh('p1', d);
  assert.equal(pv.token, 'tok1'); assert.equal(pv.remaining, 2); assert.equal(saved.length, 0, 'the review saves nothing');
  assert.equal(pv.sections.length, 8);
  // the owner edits something else in the meantime: applying works on the page as it is NOW
  pageRow = { ...pageRow, ai_content: { ...OLD, testimonials: [...OLD.testimonials!, { quote: 'עוד אחת', author: 'משה', role: '' }] } };
  const ap = await applyRefresh('p1', pv.token, ['hero', 'services', 'nonsense'], d);
  assert.deepEqual(ap.applied, ['hero', 'services']);
  assert.equal(saved.length, 1);
  const after = saved[0].patch.ai_content as AiContent;
  assert.equal(after.hero!.title, WRITTEN.hero!.title); assert.equal(after.services_or_benefits!.length, 3);
  assert.deepEqual(after.about, OLD.about); assert.equal(after.testimonials!.length, 2, 'the testimonial added meanwhile stays');
  assert.equal(saved[0].patch.category, 'trades', 'the re-detected category is stored (auto)');
  for (const k of Object.keys(saved[0].patch)) assert.ok(['ai_content', 'category', 'category_source'].includes(k), `only text (and category) is saved, not ${k}`);
  await assert.rejects(applyRefresh('p1', pv.token, ['hero'], d), (e: RefreshError) => e.code === 'expired', 'a candidate is applied once');
  await assert.rejects(applyRefresh('p1', 'x', [], d), (e: RefreshError) => e.code === 'invalid');

  // limit: 3 a day, a failure gives it back
  await previewRefresh('p1', d); await previewRefresh('p1', d);
  await assert.rejects(previewRefresh('p1', d), (e: RefreshError) => e.code === 'limit' && e.status === 429);
  const d2 = deps();
  writer = async () => { throw new Error('boom'); };
  await assert.rejects(previewRefresh('p1', d2), (e: RefreshError) => e.code === 'failed' && e.status === 502);
  assert.equal(d2.counter.remaining('p1', 'owner', day), 3, 'a failure is not counted');
  writer = async () => { throw new GenerationUnavailable(); };
  await assert.rejects(previewRefresh('p1', d2), (e: RefreshError) => e.code === 'unavailable' && e.status === 503);
  writer = async () => { calls++; return WRITTEN; };
  const before = calls;
  await assert.rejects(previewRefresh('p1', deps({ hasKey: () => false })), (e: RefreshError) => e.code === 'unavailable' && /לא זמינה כרגע/.test(e.message));
  assert.equal(calls, before, 'no key: the writer is not called');
  await assert.rejects(previewRefresh('p1', deps({ card: async () => null })), (e: RefreshError) => e.code === 'no_card');
  await assert.rejects(previewRefresh('nope', deps()), (e: RefreshError) => e.code === 'not_found');
  writer = () => new Promise(() => undefined);   // never answers
  const dt = deps({ timeoutMs: 30 });
  await assert.rejects(previewRefresh('p1', dt), (e: RefreshError) => e.code === 'failed', 'a writer that never answers times out');
  assert.equal(dt.counter.remaining('p1', 'owner', day), 3, 'a timeout is not counted');
  const { REFRESH_TIMEOUT_MS } = await import('../src/services/pageRefresh.service');
  assert.ok(REFRESH_TIMEOUT_MS <= 90_000, 'a bounded wait');
  writer = async () => ({ ...WRITTEN, page_strategy: { detected_goal: 'UNCLEAR_INPUT' } });
  await assert.rejects(previewRefresh('p1', deps()), (e: RefreshError) => e.code === 'failed');
  writer = async () => { calls++; return WRITTEN; };

  // category: re-detected (auto) for a dentist card; a manual choice is never changed
  saved.length = 0;
  pageRow = { ...pageRow, ai_content: OLD, category: 'general', category_source: 'auto' };
  let seen: GenerateInput | null = null;
  writer = async (i) => { seen = i; return WRITTEN; };
  const dd = deps({ card: async () => ({ card: { ...dentist, services: [{ name: 'טיפולי שורש', description: '', source: 'google' }] }, meta: [] }) });
  const r1 = await adminRefresh('p1', dd);
  assert.equal(seen!.category, 'health', 'the writer writes for the re-detected template');
  assert.equal(r1.category, 'health'); assert.equal(saved[0].patch.category, 'health'); assert.equal(saved[0].patch.category_source, 'auto');
  assert.ok(r1.applied.length >= 5, 'admin applies every changed section');
  const adminOut = saved[0].patch.ai_content as AiContent;
  assert.deepEqual(adminOut.testimonials, OLD.testimonials, 'admin keeps the owner testimonials');
  assert.deepEqual(adminOut.team, OLD.team, 'admin keeps the team');
  assert.ok(adminOut.hidden_sections!.includes('process') && adminOut.hidden_sections!.includes('before_after'), 'the new template adds its off-by-default sections, the old ones stay');
  saved.length = 0;
  pageRow = { ...pageRow, ai_content: OLD, category: 'general', category_source: 'manual' };
  await adminRefresh('p1', dd);
  assert.equal(seen!.category, 'general'); assert.equal('category' in saved[0].patch, false, 'manual category untouched');
  writer = async () => OLD;
  pageRow = { ...pageRow, ai_content: OLD };
  await assert.rejects(adminRefresh('p1', deps({ card: async () => ({ card: { ...CARD, services: [] }, meta: [] }) })), (e: RefreshError) => e.code === 'nothing');

  // ── the real pipeline: strict never falls back to the neutral template ────
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(generateAiContent(input, { strict: true }), (e: unknown) => e instanceof GenerationUnavailable);
  const mock = await generateAiContent(input);   // page creation keeps its fallback
  assert.ok(mock.hero?.title);
  if (key) process.env.ANTHROPIC_API_KEY = key;

  // ── the words: plain Hebrew, never "AI" ────────────────────────────────────
  const fs = await import('node:fs');
  for (const f of ['client/src/lib/pageRefresh.ts', 'client/src/components/PageRefreshDialog.tsx']) {
    const words = (fs.readFileSync(f, 'utf8').match(/'[^'\n]*[֐-׿][^'\n]*'|`[^`\n]*[֐-׿][^`\n]*`/g) ?? []).join('\n');
    assert.doesNotMatch(words, /\bAI\b|בינה מלאכותית/, f);
  }
  for (const code of ['not_found', 'no_card', 'limit', 'unavailable', 'failed', 'expired', 'invalid', 'nothing'] as const) {
    assert.doesNotMatch(new RefreshError(code).message, /\bAI\b|בינה מלאכותית/);
  }
  assert.equal(new RefreshError('unavailable').message, 'האפשרות הזו לא זמינה כרגע. נסו שוב מאוחר יותר.');

  console.log('test-page-refresh: all passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
