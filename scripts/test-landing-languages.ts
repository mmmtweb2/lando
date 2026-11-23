// Run: npx tsx scripts/test-landing-languages.ts   (pure helpers, no network, no DB)
// README part 142: page languages. Flatten/apply, the model answer's validation, stale detection and the
// owner's own wording, addresses and hreflang, the first-visit redirect rule, direction, status rules, the
// lead email, the fixed words per language, and the tolerance of a database without migration 054.
import assert from 'node:assert/strict';
import {
  DB_TRANSLATION_LANGS, LANGUAGES, TRANSLATION_LANGS, applyAltTranslation, applyManualEdits, applyTranslation, buildHreflang,
  buildTranslationSystem, canAddLanguage, flattenTranslatable, hashText, initialStatus, isMissingTranslationsTable, isTranslationLang,
  langDir, langUrl, lintForeignHealth, mergeTranslated, planRefresh, protectedTokens, softenForeignHealth, sourceHashes, staleKeys,
  tokensPreserved, translateFlat, validateTranslation,
} from '../src/services/landingLanguages';
import { loadTranslations, ownerTranslations, publicTranslations, translateLeadMessageToHebrew } from '../src/services/landingTranslations.service';
import { renderSeoBody, buildJsonLdScripts } from '../src/services/seoRender';
import { buildEmailHtml } from '../src/controllers/lead.controller';
import * as client from '../client/src/i18n/landingLanguages';
import { PAGE_STRINGS, pageStrings } from '../client/src/i18n/pageStrings';
import type { AiContent } from '../src/services/ai.service';

async function main() {
// ─── a dental clinic page ─────────────────────────────────────────────────────
const content: AiContent = {
  hero: { title: 'מרפאת שיניים בחיפה, בקצב שלכם', subtitle: 'מרפאה משפחתית שקטה.', primary_cta_text: 'לקביעת תור בוואטסאפ', hero_image_prompt: 'dental clinic' },
  about: { heading: 'על המרפאה', content: 'ד״ר כהן מטפל במשפחות כבר 12 שנה. טלפון: 04-8123456' },
  services_or_benefits: [
    { id: 's1', title: 'בדיקה וניקוי', description: 'בדיקות תקופתיות וניקוי אבנית.', service_image_prompt: 'x' },
    { id: 's2', title: 'טיפולי שורש', description: '' },
  ],
  faq: [{ question: 'כמה זה עולה?', answer: 'בדיקה ראשונה 250 ₪. פרטים באתר https://example.co.il/prices' }],
  testimonials: [
    { quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' },
    { quote: 'יחס סבלני ונעים.', author: 'רונית לוי', role: 'מטופלת' },
  ],
  contact: { phone: '0501234567', address: 'הרצל 12, חיפה', business_hours: 'א׳-ה׳ 9:00-19:00', whatsapp_message: 'שלום, אשמח לקבוע תור' },
  team: [{ name: 'ד״ר משה כהן', role: 'רופא שיניים', credentials: 'בוגר האוניברסיטה העברית', experience: '12 שנות ניסיון', license_number: '12345' }],
  spoken_languages: ['עברית', 'צרפתית', 'אנגלית'],
  trust_badges: [{ label: 'פתוח גם בערב' }],
  seo_title: 'מרפאת שיניים בחיפה', seo_description: 'מרפאת שיניים משפחתית בחיפה.',
  hidden_sections: ['before_after'],
  design_system: { primary_color: '#123456' },
};
const userImages = JSON.stringify({ hero_image_url: 'https://img.test/a.webp', gallery_urls: ['https://img.test/b.webp'], img_meta: {
  'https://img.test/a.webp': { alt: 'חדר הטיפולים במרפאה', w: 1600, h: 1000 }, 'https://img.test/b.webp': { w: 10, h: 10 },
} });

// ─── flatten ──────────────────────────────────────────────────────────────────
const flat = flattenTranslatable(content, userImages);
for (const k of ['hero.title', 'hero.subtitle', 'hero.primary_cta_text', 'about.content', 'services_or_benefits.0.title', 'services_or_benefits.0.description',
  'services_or_benefits.1.title', 'faq.0.question', 'faq.0.answer', 'testimonials.1.quote', 'testimonials.1.role', 'contact.business_hours',
  'contact.whatsapp_message', 'team.0.role', 'team.0.credentials', 'team.0.experience', 'spoken_languages.2', 'trust_badges.0.label',
  'seo_title', 'seo_description', 'img_alt:https://img.test/a.webp']) assert.ok(k in flat, `flattened: ${k}`);
// never translated: names, licence, phone, address, prompts, ids, empty texts, colours, placeholder testimonial
assert.ok(flat['team.0.name'], 'team names are transliterated (decision 23.11)');
for (const k of ['team.0.license_number', 'contact.phone', 'contact.address', 'hero.hero_image_prompt', 'services_or_benefits.0.id',
  'services_or_benefits.1.description', 'testimonials.1.author', 'testimonials.0.quote', 'testimonials.0.role', 'design_system.primary_color',
  'services_or_benefits.0.service_image_prompt', 'img_alt:https://img.test/b.webp']) assert.ok(!(k in flat), `not flattened: ${k}`);
assert.deepEqual(flattenTranslatable(null), {});
assert.deepEqual(flattenTranslatable({ hero: { title: '   ' } }), {});

// ─── round trip: applying the flattened texts gives the page back; a translation lands in its place ──
assert.deepEqual(applyTranslation(content, flat), content);
assert.deepEqual(client.applyTranslation(content, flat), content);
const fr: Record<string, string> = {};
for (const [k, v] of Object.entries(flat)) fr[k] = `FR(${v})`;
const out = applyTranslation(content, fr);
assert.equal(out.hero?.title, `FR(${content.hero!.title})`);
assert.equal(out.services_or_benefits?.[0].title, 'FR(בדיקה וניקוי)');
assert.equal(out.services_or_benefits?.[0].id, 's1');
assert.equal(out.team?.[0].name, 'FR(ד״ר משה כהן)');
assert.equal(out.team?.[0].license_number, '12345');
assert.equal(out.spoken_languages?.[1], 'FR(צרפתית)');
assert.equal(out.contact?.phone, '0501234567');
assert.equal(out.testimonials?.[0].quote, content.testimonials![0].quote, 'placeholder stays Hebrew (the page hides it by its text)');
assert.deepEqual(out.hidden_sections, ['before_after']);
assert.equal(content.hero?.title, 'מרפאת שיניים בחיפה, בקצב שלכם', 'the source is not changed');
// keys whose place is gone, or that would create new structure, are ignored
const odd = applyTranslation(content, { 'faq.7.answer': 'x', 'nope.deep.key': 'y', 'hero.title.extra': 'z', 'design_system': 'w', '__proto__.polluted': 'p' });
assert.deepEqual(odd, content);
assert.equal(({} as Record<string, unknown>).polluted, undefined);
// server and client agree
assert.deepEqual(client.applyTranslation(content, fr), out);
const alts = applyAltTranslation(userImages, fr) as string;
assert.equal(JSON.parse(alts).img_meta['https://img.test/a.webp'].alt, 'FR(חדר הטיפולים במרפאה)');
assert.equal(JSON.parse(alts).img_meta['https://img.test/a.webp'].w, 1600);
assert.deepEqual(client.translatedAlts(fr), { 'https://img.test/a.webp': 'FR(חדר הטיפולים במרפאה)' });

// ─── validation of the model's answer ─────────────────────────────────────────
const src = { a: 'שלום', b: 'התקשרו 050-1234567', c: 'באתר https://x.co.il/p ובמייל a@b.co', d: 'מחיר 250 ₪', e: 'טקסט' };
const good = { a: 'Bonjour', b: 'Appelez le 050 123 4567', c: 'Sur https://x.co.il/p et par e-mail a@b.co', d: 'Prix 250 ₪', e: 'Texte' };
let v = validateTranslation(src, good);
assert.deepEqual(Object.keys(v.value).sort(), ['a', 'b', 'c', 'd', 'e']);
assert.deepEqual([v.missing, v.extra, v.invalid], [[], [], []]);
v = validateTranslation(src, { a: good.a, b: good.b, c: good.c, d: good.d, x: 'extra' });
assert.deepEqual(v.missing, ['e']);
assert.deepEqual(v.extra, ['x']);
v = validateTranslation(src, { ...good, a: 42, e: '  ' });
assert.deepEqual(v.invalid.map((i) => `${i.key}:${i.reason}`).sort(), ['a:not_string', 'e:empty']);
v = validateTranslation(src, { ...good, b: 'Appelez-nous', c: 'Sur notre site', d: 'Prix 300 ₪' });
assert.deepEqual(v.invalid.map((i) => i.key).sort(), ['b', 'c', 'd'], 'phone / URL / price must survive');
assert.equal(validateTranslation(src, null).missing.length, 5);
assert.equal(validateTranslation(src, ['a']).missing.length, 5);
assert.deepEqual(protectedTokens('טל׳ 04-8123456, https://a.co').phones, ['048123456']);
assert.ok(tokensPreserved('050-1234567', '+972 50 123 4567'.replace('+972 ', '0')));
assert.ok(!tokensPreserved('a@b.co', 'by email'));

// ─── translateFlat: one call, one retry for what broke, health tone ───────────
let calls: string[] = [];
const mock = (answers: Array<(input: Record<string, string>) => unknown>) => async (_system: string, user: string) => {
  calls.push(user);
  const input = JSON.parse(user) as Record<string, string>;
  const a = answers.shift();
  return '```json\n' + JSON.stringify(a ? a(input) : {}) + '\n```';
};
calls = [];
let r = await translateFlat(src, 'fr', { health: false, businessName: 'X', call: mock([
  (i) => ({ ...Object.fromEntries(Object.keys(i).map((k) => [k, (good as Record<string, string>)[k]])), b: 'Appelez-nous' }),
  (i) => ({ b: 'Appelez le 0501234567', ...(i.zz ? {} : {}) }),
]) });
assert.equal(calls.length, 2);
assert.deepEqual(Object.keys(JSON.parse(calls[1])), ['b'], 'the retry asks only for what failed');
assert.deepEqual(r.failed, []);
assert.equal(r.value.b, 'Appelez le 0501234567');
calls = [];
r = await translateFlat(src, 'en', { health: false, businessName: 'X', call: async () => { calls.push('x'); throw new Error('down'); } });
assert.deepEqual(r.value, {});
assert.equal(r.failed.length, 5);
assert.equal(calls.length, 2);
r = await translateFlat({ t: 'טיפול עדין' }, 'en', { health: true, businessName: 'X', call: mock([() => ({ t: 'A gentle treatment! Painless and guaranteed. We listen first.' })]) });
assert.equal(r.value.t, 'A gentle treatment. We listen first.');
assert.deepEqual(r.softened, ['t']);
assert.ok(lintForeignHealth('Soins sans douleur, résultats garantis !', 'fr').length >= 2);
assert.deepEqual(lintForeignHealth('Un cabinet calme.', 'fr'), []);
assert.equal(softenForeignHealth('Le meilleur cabinet.', 'fr'), 'Le meilleur cabinet.', 'nothing left = keep');
const sys = buildTranslationSystem('fr', { health: true, businessName: 'מרפאת כהן' });
assert.match(sys, /French/);
assert.match(sys, /מרפאת כהן/);
assert.match(sys, /medical/);
assert.doesNotMatch(buildTranslationSystem('en', { health: false, businessName: 'x' }), /medical/);

// ─── stale detection and the owner's own wording ──────────────────────────────
const row = { content: { ...fr }, source_hash: sourceHashes(flat), manual_keys: [] as string[] };
assert.deepEqual(staleKeys(flat, row), []);
const changed = { ...flat, 'hero.title': 'כותרת חדשה', 'about.heading': 'חדש לגמרי' };
assert.deepEqual(staleKeys(changed, row).sort(), ['about.heading', 'hero.title']);
assert.equal(hashText(' שלום '), hashText('שלום'));
// manual edit: becomes "manual" and up to date
const ed = applyManualEdits(changed, row, { 'hero.title': 'Mon titre', 'not.a.key': 'x', 'faq.0.answer': 5, 'seo_title': '   ' });
assert.deepEqual(ed.applied, ['hero.title']);
assert.deepEqual(ed.row.manual_keys, ['hero.title']);
assert.deepEqual(staleKeys(changed, ed.row), ['about.heading']);
// the Hebrew changes again: the manual key is stale but protected
const changed2 = { ...changed, 'hero.title': 'כותרת שלישית' };
let plan = planRefresh(changed2, ed.row);
assert.deepEqual(plan.manualConflicts, ['hero.title']);
assert.deepEqual(plan.translate, ['about.heading'], 'without a choice the manual key is not re-translated');
plan = planRefresh(changed2, ed.row, 'overwrite');
assert.deepEqual(plan.translate.sort(), ['about.heading', 'hero.title']);
plan = planRefresh(changed2, ed.row, 'keep');
assert.deepEqual(plan.translate, ['about.heading']);
// merge: kept manual key is now up to date and still manual; overwritten keys stop being manual; gone keys drop
const kept = mergeTranslated(changed2, ed.row, { 'about.heading': 'Tout nouveau' }, ['hero.title']);
assert.equal(kept.content['hero.title'], 'Mon titre');
assert.deepEqual(kept.manual_keys, ['hero.title']);
assert.deepEqual(staleKeys(changed2, kept), []);
const over = mergeTranslated(changed2, ed.row, { 'about.heading': 'Tout nouveau', 'hero.title': 'Troisième titre' });
assert.equal(over.content['hero.title'], 'Troisième titre');
assert.deepEqual(over.manual_keys, []);
const shrunk = { ...changed2 } as Record<string, string>;
delete shrunk['faq.0.answer'];
assert.ok(!('faq.0.answer' in mergeTranslated(shrunk, ed.row, {}).content));
// owner view counts stale keys; the public view has published languages only
const ov = ownerTranslations([{ lang: 'fr', status: 'draft', ...ed.row }, { lang: 'ru', status: 'published', content: {}, source_hash: {}, manual_keys: [] }], { ...content, hero: { ...content.hero, title: 'כותרת שלישית' }, about: { ...content.about, heading: 'חדש לגמרי' } }, userImages);
assert.equal(ov.length, 1, 'a language that is not enabled is not shown');
assert.deepEqual(ov[0].stale_keys.sort(), ['about.heading', 'hero.title']);
assert.equal(ov[0].total_keys, Object.keys(flat).length);
assert.deepEqual(publicTranslations([{ lang: 'fr', status: 'draft', ...row }, { lang: 'en', status: 'published', ...row }]).map((t) => t.lang), ['en']);

// ─── addresses ────────────────────────────────────────────────────────────────
assert.deepEqual(client.parseLangPath('/p/dr-cohen/fr'), { lang: 'fr', base: '/p/dr-cohen' });
assert.deepEqual(client.parseLangPath('/p/dr-cohen/en/'), { lang: 'en', base: '/p/dr-cohen' });
assert.deepEqual(client.parseLangPath('/p/dr-cohen'), { lang: 'he', base: '/p/dr-cohen' });
assert.deepEqual(client.parseLangPath('/b/drcohen/en'), { lang: 'en', base: '/b/drcohen' });
assert.deepEqual(client.parseLangPath('/b/drcohen/teeth-whitening'), { lang: 'he', base: '/b/drcohen/teeth-whitening' });
assert.deepEqual(client.parseLangPath('/b/drcohen/teeth-whitening/fr'), { lang: 'he', base: '/b/drcohen/teeth-whitening/fr' }, 'child pages: Hebrew only');
assert.deepEqual(client.parseLangPath('/fr', true), { lang: 'fr', base: '/' });
assert.deepEqual(client.parseLangPath('/', true), { lang: 'he', base: '/' });
assert.deepEqual(client.parseLangPath('/fr', false), { lang: 'he', base: '/fr' }, 'the main site has no /fr page');
assert.deepEqual(client.parseLangPath('/p/x/ru'), { lang: 'he', base: '/p/x/ru' }, 'a language that is not enabled');
assert.deepEqual(client.parseLangPath('/p/x/de'), { lang: 'he', base: '/p/x/de' });
assert.equal(client.langPath('/', 'fr'), '/fr');
assert.equal(client.langPath('/p/x', 'en'), '/p/x/en');
assert.equal(client.langPath('/p/x', 'he'), '/p/x');
assert.equal(langUrl('https://pagey.co.il/b/drcohen', 'fr'), 'https://pagey.co.il/b/drcohen/fr');
assert.equal(langUrl('https://pagey.co.il/b/drcohen/', 'he'), 'https://pagey.co.il/b/drcohen/');
assert.deepEqual(buildHreflang('https://pagey.co.il/b/drcohen', ['en', 'fr', 'ru']), [
  { hreflang: 'he', href: 'https://pagey.co.il/b/drcohen' },
  { hreflang: 'fr', href: 'https://pagey.co.il/b/drcohen/fr' },
  { hreflang: 'en', href: 'https://pagey.co.il/b/drcohen/en' },
  { hreflang: 'x-default', href: 'https://pagey.co.il/b/drcohen' },
]);
assert.deepEqual(buildHreflang('https://p.co/p/x', []).map((a) => a.hreflang), ['he', 'x-default']);

// ─── first visit: follow the browser's language ───────────────────────────────
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const base = { urlLang: 'he' as const, navigatorLanguages: ['fr-FR', 'fr', 'en'], userAgent: CHROME, published: ['fr', 'en'], explicitChoice: null, alreadyRedirected: false, isOwner: false };
assert.equal(client.decideRedirect(base), 'fr');
assert.equal(client.decideRedirect({ ...base, navigatorLanguages: ['en-US'] }), 'en');
assert.equal(client.decideRedirect({ ...base, navigatorLanguages: ['de-DE', 'en-GB'] }), 'en');
assert.equal(client.decideRedirect({ ...base, navigatorLanguages: ['he-IL', 'en-US'] }), null, 'Hebrew first: stay');
assert.equal(client.decideRedirect({ ...base, navigatorLanguages: ['fr'], published: ['en'] }), null, 'no published French');
assert.equal(client.decideRedirect({ ...base, urlLang: 'en' }), null, 'the address already has a language');
assert.equal(client.decideRedirect({ ...base, userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }), null);
assert.equal(client.decideRedirect({ ...base, userAgent: 'WhatsApp/2.23' }), null);
assert.equal(client.decideRedirect({ ...base, userAgent: 'facebookexternalhit/1.1' }), null);
assert.equal(client.decideRedirect({ ...base, userAgent: '' }), null);
assert.equal(client.decideRedirect({ ...base, explicitChoice: 'he' }), null, 'the visitor chose Hebrew');
assert.equal(client.decideRedirect({ ...base, explicitChoice: 'en' }), 'en', 'the visitor chose English before');
assert.equal(client.decideRedirect({ ...base, explicitChoice: 'en', published: ['fr'] }), null);
assert.equal(client.decideRedirect({ ...base, alreadyRedirected: true }), null, 'once');
assert.equal(client.decideRedirect({ ...base, isOwner: true }), null);
assert.equal(client.decideRedirect({ ...base, navigatorLanguages: [] }), null);

// ─── direction, config, status rules, gate ────────────────────────────────────
assert.equal(langDir('he'), 'rtl');
assert.equal(langDir('fr'), 'ltr');
assert.equal(langDir('en'), 'ltr');
assert.equal(langDir('ar'), 'rtl', 'Arabic is ready as right-to-left');
assert.equal(client.langDir('fr'), 'ltr');
assert.equal(client.langDir(undefined), 'rtl');
assert.deepEqual(TRANSLATION_LANGS, ['fr', 'en'], 'only French and English are on');
assert.deepEqual(client.TRANSLATION_LANGS, TRANSLATION_LANGS);
for (const l of Object.keys(LANGUAGES) as Array<keyof typeof LANGUAGES>) {
  assert.equal(client.LANGUAGES[l].dir, LANGUAGES[l].dir, `dir mirror ${l}`);
  assert.equal(client.LANGUAGES[l].enabled, LANGUAGES[l].enabled, `enabled mirror ${l}`);
  assert.equal(client.LANGUAGES[l].heName, LANGUAGES[l].heName);
}
assert.ok(isTranslationLang('fr') && isTranslationLang('en') && !isTranslationLang('he') && !isTranslationLang('ru') && !isTranslationLang('FR'));
const sql = (await import('node:fs')).readFileSync(new URL('../migrations/054_landing_languages.sql', import.meta.url), 'utf8');
for (const l of DB_TRANSLATION_LANGS) assert.ok(sql.includes(`'${l}'`), `054 accepts ${l}`);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /FORCE ROW LEVEL SECURITY/);
assert.match(sql, /ON DELETE CASCADE/);
assert.match(sql, /CREATE TABLE IF NOT EXISTS/);
assert.match(sql, /ADD COLUMN IF NOT EXISTS lang/);
for (const c of ['health', 'general', null, undefined, 'food', 'beauty']) assert.equal(initialStatus(c), 'published');
assert.equal(canAddLanguage({ id: 'p1' }), true);
assert.deepEqual(client.editPathToKeys('services.1.title', 'T', { services_or_benefits: [] }), { 'services_or_benefits.1.title': 'T' });
assert.deepEqual(client.editPathToKeys('services.0.title', 'T', { services: [] }), { 'services.0.title': 'T' });
assert.deepEqual(client.editPathToKeys('spoken_languages', 'hébreu, français et anglais', {}), { 'spoken_languages.0': 'hébreu', 'spoken_languages.1': 'français', 'spoken_languages.2': 'anglais' });
assert.deepEqual(client.editPathToKeys('faq.0.answer', 'A', {}), { 'faq.0.answer': 'A' });

// ─── a database without migration 054 ─────────────────────────────────────────
assert.ok(isMissingTranslationsTable({ code: '42P01', message: 'relation "landing_translations" does not exist' }));
assert.ok(isMissingTranslationsTable({ code: 'PGRST205', message: "Could not find the table 'public.landing_translations' in the schema cache" }));
assert.ok(isMissingTranslationsTable({ code: '42703', message: 'column leads.lang does not exist' }));
assert.ok(isMissingTranslationsTable({ code: 'PGRST204', message: "Could not find the 'lang' column of 'leads' in the schema cache" }));
assert.ok(!isMissingTranslationsTable({ code: '23505', message: 'duplicate key' }));
assert.ok(!isMissingTranslationsTable(null));
// the real read against an unreachable database: no languages, no throw (pages are served as before)
const loaded = await loadTranslations('00000000-0000-0000-0000-000000000000');
assert.deepEqual(loaded, { ready: false, rows: [] });

// ─── server-rendered body and JSON-LD in a language ───────────────────────────
const page = { business_name: 'מרפאת כהן', ai_content: applyTranslation(content, { 'faq.0.question': 'How much?', 'faq.0.answer': 'First visit 250 ₪.' }) };
const body = renderSeoBody({ ...page, ai_content: { ...page.ai_content, about: { content: 'x' } } }, { lang: 'en', dir: 'ltr' });
assert.match(body, /^<main dir="ltr" lang="en"/);
assert.match(body, /<h2>About us<\/h2>/);
assert.match(renderSeoBody(page), /^<main dir="rtl" lang="he"/);
const ld = buildJsonLdScripts(page, 'https://pagey.co.il/b/x/en', '', { inLanguage: 'en', multilingual: true });
assert.match(ld, /"inLanguage":"en"/);
assert.match(ld, /"@type":"WebPage"/);
assert.doesNotMatch(buildJsonLdScripts(page, 'https://pagey.co.il/b/x', ''), /WebPage/, 'a one-language page: as before');

// ─── the lead email is Hebrew, says the language, keeps the original ──────────
const mail = buildEmailHtml({ businessName: 'מרפאת כהן', name: 'Marie', phone: '0501234567', email: null, message: 'Bonjour, je voudrais un rendez-vous.', lang: 'fr', messageHe: 'שלום, אשמח לקבוע תור.' });
assert.match(mail, /הפונה כתב\/ה מהדף בצרפתית/);
assert.match(mail, /Bonjour, je voudrais un rendez-vous\./);
assert.match(mail, /שלום, אשמח לקבוע תור\./);
const mailFail = buildEmailHtml({ businessName: 'x', name: 'John', phone: '050', email: null, message: 'Hi', lang: 'en', messageHe: null });
assert.match(mailFail, /לא הצלחנו לתרגם את ההודעה/);
assert.match(mailFail, />Hi</);
assert.doesNotMatch(buildEmailHtml({ businessName: 'x', name: 'a', phone: '050', email: null, message: 'שלום' }), /שפת הפנייה/);
assert.equal(await translateLeadMessageToHebrew('Hello', 'en', async () => 'שלום'), 'שלום');
assert.equal(await translateLeadMessageToHebrew('Hello', 'en', async () => 'Hello'), null, 'not Hebrew = failed');
assert.equal(await translateLeadMessageToHebrew('Hello', 'en', async () => { throw new Error('down'); }), null);

// ─── the fixed words: every language has every word; French/English have no Hebrew ──
const shape = (o: unknown): string[] => (o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => [k, ...shape(v).map((x) => `${k}.${x}`)]) : []);
const heShape = shape(PAGE_STRINGS.he).sort();
for (const l of ['fr', 'en'] as const) {
  assert.deepEqual(shape(PAGE_STRINGS[l]).sort(), heShape, `${l} has every word`);
  const s = PAGE_STRINGS[l]!;
  const texts = [
    s.call, s.askOnWhatsApp, s.gallery, s.visit, s.waze, s.waPreview, s.closingHealth, s.ctaDefault, s.license, s.baNote, s.credit,
    ...Object.values(s.headings), ...Object.values(s.health), ...Object.values(s.guide),
    ...Object.values(s.lead).map((x) => (typeof x === 'function' ? x('N') : x)),
    s.legal.toggle, s.legal.termsTitle, s.legal.accTitle, ...s.legal.terms('N'), ...s.legal.acc('N'), s.legal.accContactLead, s.legal.responsibility('N'),
    s.waDefault('N'), s.waService('T'), s.closingGeneral('N'), s.spokenLine(['hébreu', 'français', 'anglais']),
  ];
  for (const t of texts) assert.doesNotMatch(t, /[א-ת]/, `${l}: no Hebrew in "${t.slice(0, 40)}"`);
  assert.match(s.legal.acc('N')[0], /5758-1998/);
  assert.match(s.legal.acc('N')[1], /5568/);
}
assert.equal(pageStrings('fr').spokenLine(['hébreu', 'français', 'anglais']), 'Nous parlons hébreu, français et anglais');
assert.equal(pageStrings('en').spokenLine(['Hebrew', 'French']), 'We speak Hebrew and French');
assert.equal(pageStrings('he').spokenLine(['עברית', 'צרפתית', 'אנגלית']), 'מדברים עברית, צרפתית ואנגלית');
assert.equal(pageStrings('he').ctaDefault, 'צרו קשר עכשיו', 'Hebrew words unchanged');
assert.equal(pageStrings('ru'), PAGE_STRINGS.he, 'a language with no words yet falls back to Hebrew');

console.log('landing languages: all tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
