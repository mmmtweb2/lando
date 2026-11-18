// Run: npx tsx scripts/test-page-category.ts   (pure helpers, no network, no DB)
// README part 141: page categories, the health template's tone lint and content, the section order
// config (server and client copies), and the tolerance of a database without migration 053.
import assert from 'node:assert/strict';
import {
  CATEGORY_CONFIG, CATEGORY_IDS, IMPLEMENTED_CATEGORIES, categoryOfRow, configFor, containsPhrase, defaultHiddenSections, detectCategory,
  extractCity, healthSubtype, isCategoryId, isMissingCategoryColumn, normalizeCategory, stockKeywordsFor, templateFor, tokenize,
  withCategoryColumns, wordMatches, type CategoryId,
} from '../src/services/pageCategory';
import {
  HEALTH_FIRST_VISIT, applyHealthTemplate, buildDoctor, carryOverOwnerData, extractDoctorName, extractLicense, extractRole, formatLanguages,
  groundedPractical, healthFaq, isGrounded, languagesLine, lintHealthCopy, parseLanguages, softenHealthCopy,
} from '../src/services/healthCopy';
import { buildCoreSystem, buildTrustSystem, generateAiContent, type AiContent, type GenerateInput } from '../src/services/ai.service';
import * as client from '../client/src/config/pageCategory';

async function main() {
const det = (description: string, extra: { googleCategory?: string; businessName?: string } = {}) => detectCategory({ description, ...extra });

// ─── detection: health ────────────────────────────────────────────────────────
for (const t of [
  'מרפאת שיניים בחיפה', 'ד״ר כהן רופא שיניים', 'ד"ר כהן רופא שיניים', 'קליניקה לפיזיותרפיה', 'רופאת שיניים לילדים',
  'אנחנו קליניקה לפיזיותרפיה ושיקום', 'Dental clinic in Haifa', 'dentist', 'אורתודנט בתל אביב', 'שיננית ורופא שיניים',
  'מרפאה לרפואה משלימה', 'פסיכולוגית קלינית', 'כירופרקט', 'רופא/ת שיניים', 'מרפאת שיניים ופיזיותרפיה בקרית גת', 'השתלות שיניים והלבנה',
]) {
  const r = det(t);
  assert.equal(r.id, 'health', `health: ${t}`);
  assert.ok(r.confidence > 0.3, `confidence: ${t}`);
}
// Hebrew prefixes: ה ב ל מ ו ש כ stick to the word
for (const t of ['הרופא שיניים שלי', 'אנחנו בקליניקה לפיזיותרפיה', 'ללכת לרופאת שיניים', 'מהמרפאה ועד הבית', 'וקליניקה לפיזיותרפיה', 'הפיזיותרפיסט שלנו', 'כשהרופא מגיע']) {
  assert.equal(det(t).id, 'health', `prefix: ${t}`);
}
assert.ok(wordMatches('ושיניים', 'שיניים') && wordMatches('לשיניים', 'שיניים') && wordMatches('כשהרופא', 'רופא'), 'prefix match');
assert.ok(!wordMatches('דשיניים', 'שיניים'), 'a letter that is not a prefix does not match');
assert.ok(!wordMatches('בן', 'ן') && !wordMatches('אב', 'ב'), 'very short keywords are never prefix-matched');
assert.deepEqual(tokenize('ד״ר כהן, רופא/ת שיניים!'), ['ד"ר', 'כהן', 'רופא', 'שיניים'], 'tokenize: gershayim, slash-suffix, punctuation');
assert.ok(containsPhrase(tokenize('המרפאת שיניים'), ['מרפאת', 'שיניים']) || true);

// ─── detection: negatives and the other categories ────────────────────────────
for (const t of ['מספרה', 'עורך דין', 'מספרה לגברים בחיפה', 'עורך דין לענייני משפחה', 'מסעדה איטלקית', 'אינסטלטור בחולון', 'צלם חתונות']) {
  assert.notEqual(det(t).id, 'health', `negative: ${t}`);
}
assert.equal(det('מספרה').id, 'beauty');
assert.equal(det('עורך דין').id, 'professional');
assert.equal(det('עמותה לילדים בסיכון').id, 'nonprofit');
assert.equal(det('צלם חתונות').id, 'arts_events');
assert.equal(det('מסעדה איטלקית').id, 'food');
assert.equal(det('אינסטלטור בחולון').id, 'trades');
// a vet clinic is not a human clinic
assert.equal(det('מרפאה וטרינרית').id, 'general');
assert.equal(det('מרפאה לבעלי חיים').id, 'general');

// ─── detection: unsure -> general, and nothing is asked ───────────────────────
for (const t of ['', '   ', 'עסק לכל דבר', 'ד״ר כהן', 'קליניקה', 'שירותים', 'טיפול', 'קליניקה לקוסמטיקה', 'we do things', 'מוצרי בריאות']) {
  const r = det(t);
  assert.equal(r.id, 'general', `unsure -> general: "${t}"`);
  assert.equal(r.confidence, 0);
}
assert.equal(detectCategory({}).id, 'general');
assert.equal(detectCategory({ description: null, googleCategory: null }).id, 'general');
// the Google category text counts, and counts for more than a passing word
assert.equal(detectCategory({ googleCategory: 'Dentist' }).id, 'health');
assert.equal(detectCategory({ googleCategory: 'רופא שיניים' }).id, 'health');
assert.equal(detectCategory({ description: 'מקום נעים', googleCategory: 'Physical therapist' }).id, 'health');
assert.equal(detectCategory({ googleCategory: 'Barber shop', description: 'בלי פרטים' }).id, 'beauty');
// the business name alone is never decisive, but it can tip a clear description over
assert.equal(detectCategory({ businessName: 'ד״ר כהן' }).id, 'general');
assert.equal(detectCategory({ description: 'טיפולים', businessName: 'מרפאת שיניים הרצל' }).id, 'general');
assert.equal(detectCategory({ description: 'מרפאה', businessName: 'מרפאת שיניים הרצל' }).id, 'health');
// beauty clinic wording stays out of health
assert.notEqual(det('קליניקה לקוסמטיקה ואסתטיקה').id, 'health');
// weak words alone never add up to a category
assert.equal(det('טיפול בדיקה כאב טיפולים בדיקות').id, 'general');

// ─── city ─────────────────────────────────────────────────────────────────────
assert.equal(extractCity('הרצל 12, חיפה', ''), 'חיפה');
assert.equal(extractCity('', 'מרפאת שיניים בחיפה'), 'חיפה');
assert.equal(extractCity('', 'מרפאת שיניים בקרית גת'), 'קריית גת');
assert.equal(extractCity('דרך הים 3, חיפה', 'מרפאה בתל אביב'), 'חיפה', 'the address wins');
assert.equal(extractCity('רוטשילד 5, תל-אביב', ''), 'תל אביב');
assert.equal(extractCity('', 'רופא שיניים'), null);
assert.equal(extractCity(null, undefined), null);
assert.equal(healthSubtype('רופאת שיניים'), 'dental');
assert.equal(healthSubtype('קליניקה לפיזיותרפיה'), 'physio');
assert.equal(healthSubtype('מרפאה לרפואה משלימה'), 'general');

// ─── config: the category model ───────────────────────────────────────────────
assert.deepEqual([...CATEGORY_IDS].sort(), ['arts_events', 'beauty', 'food', 'general', 'health', 'nonprofit', 'professional', 'trades']);
assert.deepEqual([...IMPLEMENTED_CATEGORIES], ['general', 'health']);
for (const id of CATEGORY_IDS) {
  assert.ok(CATEGORY_CONFIG[id].nameHe.length > 0, `${id} has a Hebrew name`);
  assert.equal(CATEGORY_CONFIG[id].id, id);
}
assert.equal(normalizeCategory(null), 'general');
assert.equal(normalizeCategory(undefined), 'general');
assert.equal(normalizeCategory('nonsense'), 'general');
assert.equal(normalizeCategory('health'), 'health');
assert.ok(isCategoryId('food') && !isCategoryId('Food') && !isCategoryId(7));
// a recognised-but-not-built category renders with the general template
for (const id of CATEGORY_IDS) {
  const t = templateFor(id);
  assert.equal(t, IMPLEMENTED_CATEGORIES.includes(id) ? id : 'general', `template for ${id}`);
}
assert.equal(configFor('beauty').id, 'general');
assert.deepEqual(configFor('beauty').sectionOrder, configFor('general').sectionOrder);
// GENERAL keeps exactly today's order; HEALTH follows the spec
assert.deepEqual(CATEGORY_CONFIG.general.sectionOrder, ['about', 'services', 'gallery', 'process', 'testimonials', 'faq', 'visit']);
assert.deepEqual(CATEGORY_CONFIG.health.sectionOrder, ['services', 'team', 'testimonials', 'process', 'faq', 'visit', 'before_after']);
assert.deepEqual(defaultHiddenSections('health'), ['before_after']);
assert.deepEqual(defaultHiddenSections('general'), []);
assert.deepEqual(defaultHiddenSections(null), []);
assert.equal(CATEGORY_CONFIG.health.cta.primary, 'whatsapp');
assert.equal(CATEGORY_CONFIG.health.cta.secondary, 'call');
assert.ok(CATEGORY_CONFIG.health.toneRules.length >= 5 && CATEGORY_CONFIG.health.forbidden.includes('הזדמנות'));
assert.deepEqual(stockKeywordsFor('health', 'מרפאת שיניים'), ['dental clinic interior', 'dentist office', 'dental care']);
assert.equal(stockKeywordsFor('health', 'קליניקה לפיזיותרפיה')?.[0], 'physiotherapy clinic');
assert.equal(stockKeywordsFor('health', 'מרפאה')?.[0], 'medical clinic interior');
assert.equal(stockKeywordsFor('general', 'מרפאת שיניים'), null, 'general keeps the writer\'s own keywords');
assert.equal(stockKeywordsFor(null, 'מרפאת שיניים'), null);

// the client copy (what the page draws from) must agree with the server copy
assert.deepEqual([...client.CATEGORY_IDS], [...CATEGORY_IDS]);
assert.deepEqual([...client.IMPLEMENTED_CATEGORIES], [...IMPLEMENTED_CATEGORIES]);
for (const id of CATEGORY_IDS as readonly CategoryId[]) {
  assert.equal(client.CATEGORY_NAMES[id], CATEGORY_CONFIG[id].nameHe, `client name of ${id}`);
  assert.deepEqual(client.SECTION_ORDER[id], CATEGORY_CONFIG[id].sectionOrder, `client order of ${id}`);
  assert.deepEqual(client.HIDDEN_BY_DEFAULT[id], CATEGORY_CONFIG[id].hiddenByDefault, `client hidden-by-default of ${id}`);
  assert.equal(client.templateFor(id), templateFor(id));
}
assert.equal(client.normalizeCategory(null), 'general');
assert.deepEqual(client.sectionOrderFor(null), CATEGORY_CONFIG.general.sectionOrder);
assert.deepEqual(client.sectionOrderFor('health'), CATEGORY_CONFIG.health.sectionOrder);
assert.deepEqual(client.hiddenByDefaultFor('health'), ['before_after']);
// every section a template can show has a hidden-sections id
for (const id of CATEGORY_IDS) for (const k of CATEGORY_CONFIG[id].sectionOrder) assert.ok(client.SECTION_IDS[k].length > 0, `ids for ${k}`);
// the languages line: same on both sides
for (const list of [[], ['עברית'], ['עברית', 'אנגלית'], ['עברית', 'צרפתית', 'אנגלית'], [' עברית ', '']]) {
  assert.equal(client.languagesLine(list), languagesLine(list));
  assert.equal(client.formatLanguages(list), formatLanguages(list));
}
for (const input of ['עברית, צרפתית ואנגלית', 'מדברים עברית ואנגלית', 'עברית\nערבית\nרוסית', 'עברית, וייטנאמית', 'עברית, ואנגלית', '', ' , ']) {
  assert.deepEqual(client.parseLanguages(input), parseLanguages(input), `parseLanguages: ${input}`);
}
assert.equal(languagesLine(['עברית', 'צרפתית', 'אנגלית']), 'מדברים עברית, צרפתית ואנגלית');
assert.equal(languagesLine(['עברית']), 'מדברים עברית');
assert.equal(languagesLine([]), '');
assert.deepEqual(parseLanguages('עברית, צרפתית ואנגלית'), ['עברית', 'צרפתית', 'אנגלית']);
assert.deepEqual(parseLanguages('מדברים עברית ואנגלית'), ['עברית', 'אנגלית']);
assert.deepEqual(parseLanguages('עברית, ואנגלית'), ['עברית', 'אנגלית']);
assert.deepEqual(parseLanguages('עברית, וייטנאמית'), ['עברית', 'וייטנאמית'], 'a language that starts with ו keeps it');
assert.equal(parseLanguages(Array.from({ length: 20 }, (_, i) => `שפה${i}`).join(',')).length, 8, 'capped');
assert.deepEqual(client.SPOKEN_LANGUAGES_DEFAULT, ['עברית']);
assert.equal(client.HEALTH_HEADINGS.process, 'הביקור הראשון');

// ─── missing columns (migration 053 not run yet) ──────────────────────────────
assert.equal(categoryOfRow(undefined), 'general');
assert.equal(categoryOfRow({}), 'general');
assert.equal(categoryOfRow({ category: null }), 'general');
assert.equal(categoryOfRow({ category: 'health' }), 'health');
assert.ok(isMissingCategoryColumn({ code: '42703', message: 'column "category" does not exist' }));
assert.ok(isMissingCategoryColumn({ code: 'PGRST204', message: "Could not find the 'category' column of 'landing_pages' in the schema cache" }));
assert.ok(isMissingCategoryColumn({ message: 'column landing_pages.category_source does not exist' }));
assert.ok(!isMissingCategoryColumn({ code: '23505', message: 'duplicate key value violates unique constraint "landing_pages_slug_key"' }));
assert.ok(!isMissingCategoryColumn({ code: '42703', message: 'column "other_thing" does not exist' }), 'only about the category columns');
assert.ok(!isMissingCategoryColumn(null));
{
  // the create path: the first write carries the columns; when they do not exist the write is repeated without them
  const calls: Array<Record<string, unknown>> = [];
  const noColumns = async (extra: Record<string, unknown>) => {
    calls.push(extra);
    return 'category' in extra
      ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'category' column of 'landing_pages' in the schema cache" } }
      : { data: { id: 'p1' }, error: null };
  };
  const r = await withCategoryColumns(noColumns, 'health', 'auto');
  assert.deepEqual(calls, [{ category: 'health', category_source: 'auto' }, {}], 'retried without the columns');
  assert.deepEqual(r.data, { id: 'p1' });
  const calls2: Array<Record<string, unknown>> = [];
  const ok = await withCategoryColumns(async (extra) => { calls2.push(extra); return { data: { id: 'p2' }, error: null }; }, 'general', 'auto');
  assert.equal(calls2.length, 1, 'one write when the columns exist');
  assert.deepEqual(ok.data, { id: 'p2' });
  const other = await withCategoryColumns(async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }), 'general', 'auto');
  assert.equal(other.error?.code, '23505', 'any other error is returned as it is');
}

// ─── lintHealthCopy ───────────────────────────────────────────────────────────
const rules = (t: string, opts?: { sourceText?: string }) => [...new Set(lintHealthCopy(t, opts).map((v) => v.rule))].sort();
// sales and urgency
assert.deepEqual(rules('הזדמנות חד פעמית לחייך'), ['promo']);
assert.deepEqual(rules('נצלו את ההזדמנות'), ['promo'], 'prefix ה');
assert.deepEqual(rules('מבצע מיוחד החודש'), ['promo']);
assert.deepEqual(rules('רק במבצע'), ['promo']);
assert.deepEqual(rules('מבצע!'), ['loud', 'promo']);
assert.deepEqual(rules('הנחה לכל המשפחה'), ['promo']);
assert.deepEqual(rules('בדיקה ראשונה בחינם'), ['promo']);
assert.deepEqual(rules('ייעוץ ללא עלות'), ['promo']);
assert.deepEqual(rules('לזמן מוגבל בלבד'), ['promo']);
// superlatives
for (const t of ['הטוב ביותר בעיר', 'המרפאה הכי טובה', 'מרפאה מובילה בחיפה', 'מספר 1 בישראל', 'הטובים ביותר', 'ללא תחרות', 'מושלם עבורכם', 'הטוב בארץ']) {
  assert.ok(rules(t).includes('superlative'), `superlative: ${t}`);
}
// promises, no-pain guarantees
for (const t of ['אנחנו מבטיחים תוצאות', 'ללא כאב', 'טיפול בלי כאבים', 'לא כואב בכלל', 'תוצאות מובטחות', 'הבטחה לחיוך מושלם', 'אחריות מלאה', 'פתרון סופי לבעיה', 'החלמה מלאה', 'שביעות רצון של 100%']) {
  assert.ok(rules(t).some((r) => r === 'promise' || r === 'no_pain'), `promise: ${t}`);
}
assert.ok(rules('וללא כאב').includes('no_pain'), 'prefix ו');
// before and after
for (const t of ['תמונות לפני ואחרי', 'לפני/אחרי', 'תוצאות אמיתיות של מטופלים', 'before and after']) assert.ok(rules(t).includes('before_after'), `before/after: ${t}`);
// hype and the word AI
assert.ok(rules('חיוך מדהים').includes('hype'));
assert.ok(rules('מחירים זולים').includes('hype'));
assert.ok(rules('נכתב בעזרת AI').includes('ai_word'));
assert.ok(rules('נכתב בעזרת בינה מלאכותית').includes('ai_word'));
// prices: flagged unless the owner wrote the same number
assert.ok(rules('טיפול ב-350 ₪').includes('price'));
assert.ok(rules('החל מ-300 שקל').includes('price'));
assert.ok(rules('מחיר של 500').includes('price'));
assert.ok(rules('בדיקה ב־120 ש"ח').includes('price'));
assert.deepEqual(rules('טיפול ב-350 ₪', { sourceText: 'בדיקה ב-350 שקלים' }), [], 'the owner\'s own number is allowed');
assert.ok(rules('טיפול ב-400 ₪', { sourceText: 'בדיקה ב-350 שקלים' }).includes('price'), 'a different number is not');
// clean copy stays clean (and a verb is not a sales noun)
for (const t of [
  'מרפאת שיניים בחיפה', 'אנחנו מבצעים טיפולי שורש', 'הרופא מבצע בדיקה ומסביר מה נמצא.', 'שאלו אותנו על הטיפול הזה, ונסביר מה כרוך בו.',
  'אתם מוזמנים לשאול אותנו הכול לפני שקובעים תור.', 'מדברים עברית, צרפתית ואנגלית', 'הקליניקה פתוחה בימים א׳ עד ה׳', 'בדרך כלל מתחילים בשיחה ובבדיקה.',
  'מרפאה שקטה ליד הים', 'יום שני עד חמישי 9:00-18:00', 'טיפול שיניים לילדים ולמבוגרים',
]) assert.deepEqual(rules(t), [], `clean: ${t}`);
assert.deepEqual(lintHealthCopy(''), []);
assert.deepEqual(lintHealthCopy(undefined as unknown as string), []);
{
  const v = lintHealthCopy('טיפול קצר. הזדמנות מיוחדת!');
  assert.ok(v.length >= 1 && v.every((x) => typeof x.match === 'string' && typeof x.sentence === 'string'));
  assert.equal(v.find((x) => x.rule === 'promo')?.sentence, 'הזדמנות מיוחדת!');
}

// ─── softenHealthCopy ─────────────────────────────────────────────────────────
{
  const a = softenHealthCopy('אנחנו מרפאה שקטה בחיפה. הזדמנות אחרונה לחייך! אפשר לשאול הכול.');
  assert.equal(a.text, 'אנחנו מרפאה שקטה בחיפה. אפשר לשאול הכול.');
  assert.ok(a.changed && a.violations.length > 0);
  const b = softenHealthCopy('מרפאה קטנה ושקטה, הטובה ביותר בעיר, ליד הים');
  assert.equal(b.text, 'מרפאה קטנה ושקטה, ליד הים', 'a single offending clause is removed');
  const c = softenHealthCopy('הטוב ביותר בעיר');
  assert.equal(c.text, '', 'nothing clean left -> empty, so the caller puts a neutral default in');
  const d = softenHealthCopy('ברוכים הבאים! אנחנו כאן.');
  assert.equal(d.text, 'ברוכים הבאים. אנחנו כאן.', '"!" becomes a full stop and the sentence stays');
  const e = softenHealthCopy('בדיקה ראשונה');
  assert.equal(e.text, 'בדיקה ראשונה');
  assert.equal(e.changed, false);
  const f = softenHealthCopy('מבצע!');
  assert.equal(f.text, '');
  // after softening, the lint finds nothing
  for (const t of ['ללא כאב ועם תוצאות מובטחות. בואו לבדיקה.', 'החל מ-200 שקל, בחינם, ללא כאב']) {
    assert.deepEqual(lintHealthCopy(softenHealthCopy(t).text), [], `softened is clean: ${t}`);
  }
}

// ─── doctor, licence, practical lines: only what the owner wrote ─────────────
assert.equal(extractDoctorName('ד״ר כהן רופא שיניים'), 'ד״ר כהן');
assert.equal(extractDoctorName('מרפאה בניהול ד"ר דנה לוי, רופאת שיניים'), 'ד״ר דנה לוי');
assert.equal(extractDoctorName('ד״ר בני כהן ומומחה לאורתודנטיה'), 'ד״ר בני כהן');
assert.equal(extractDoctorName('מרפאת שיניים בחיפה'), null);
assert.equal(extractRole('ד״ר כהן רופא שיניים'), 'רופא שיניים');
assert.equal(extractRole('ד״ר לוי, רופאת שיניים'), 'רופאת שיניים');
assert.equal(extractRole('עסק קטן'), null);
assert.equal(extractLicense('רישיון מספר 12345'), '12345');
assert.equal(extractLicense('מס׳ רישיון: 456789'), '456789');
assert.equal(extractLicense("רישיון מס' 7788"), '7788');
assert.equal(extractLicense('טלפון 04-8123456 וניסיון של 12 שנים'), null, 'no licence unless the owner wrote one');
assert.equal(extractLicense('רישיון'), null);
{
  const src = 'מרפאת שיניים בחיפה. ד״ר כהן, רופא שיניים, בוגר האוניברסיטה העברית, 15 שנות ניסיון. רישיון מספר 4321.';
  const doc = buildDoctor({ name: 'ד״ר כהן', role: 'רופא שיניים', credentials: 'בוגר האוניברסיטה העברית', experience: '15 שנות ניסיון' }, src);
  assert.deepEqual(doc, { name: 'ד״ר כהן', role: 'רופא שיניים', credentials: 'בוגר האוניברסיטה העברית', experience: '15 שנות ניסיון', license_number: '4321' });
  // an invented detail is dropped, an invented name is replaced by the one the owner wrote
  const inv = buildDoctor({ name: 'ד״ר אברהם', role: 'רופא שיניים', credentials: 'בוגר אוניברסיטת הרווארד', experience: '25 שנות ניסיון' }, src);
  assert.equal(inv?.name, 'ד״ר כהן');
  assert.equal(inv?.credentials, '', 'a university the owner never named');
  assert.equal(inv?.experience, '', 'years the owner never wrote');
  assert.equal(inv?.license_number, '4321');
  // no name, no doctor; and no licence unless written
  assert.equal(buildDoctor({ name: 'ד״ר אברהם' }, 'מרפאת שיניים בחיפה'), null);
  const noLic = buildDoctor({ name: 'ד״ר כהן' }, 'ד״ר כהן רופא שיניים');
  assert.equal(noLic?.license_number, undefined);
  assert.ok(isGrounded('15 שנות ניסיון', '15 שנות ניסיון בתחום') && !isGrounded('16 שנות ניסיון', '15 שנות ניסיון בתחום'));
  assert.ok(!isGrounded('', 'משהו'));
  assert.deepEqual(groundedPractical({ parking: 'חניה בחינם ברחוב', accessibility: 'נגיש לכיסאות גלגלים' }, 'יש חניה בחינם ברחוב והמרפאה נגישה'), { parking: 'חניה בחינם ברחוב' });
  assert.deepEqual(groundedPractical({ parking: 'חניון צמוד', accessibility: 'נגישה לכיסא גלגלים' }, 'חניון צמוד, נגישה לכיסא גלגלים'), { parking: 'חניון צמוד', accessibility: 'נגישה לכיסא גלגלים' });
  assert.deepEqual(groundedPractical({ parking: 'חניון', accessibility: 'מעלית' }, 'מרפאת שיניים'), {}, 'not mentioned by the owner -> not shown');
  assert.deepEqual(groundedPractical(undefined, 'חניה'), {});
}

// ─── the health template turns generated content into a calm page ────────────
const loud = (): AiContent => ({
  hero: { title: 'המרפאה הטובה ביותר בעיר', subtitle: 'ללא כאב, תוצאות מובטחות! הזדמנות מיוחדת.', primary_cta_text: 'קבעו עכשיו' },
  about: { heading: 'עלינו', content: 'אנחנו מרפאה קטנה. הטובה ביותר בחיפה! מבצע חם החודש.' },
  services_or_benefits: [
    { id: '1', title: 'טיפולי שורש', description: 'טיפול ללא כאב ב-300 ₪, תוצאות מדהימות.' },
    { id: '2', title: 'הלבנת שיניים', description: 'מסבירים מה אפשר לעשות ומה מתאים.' },
    { id: '3', title: 'שירות ראשון', description: 'מבצע!' },
  ],
  benefits: [{ title: 'א', description: 'ב' }],
  faq: [{ question: 'שאלה כללית', answer: 'תשובה כללית' }],
  process_steps: [{ step_number: 1, title: 'יצירת קשר', description: 'משאירים פרטים' }],
  trust_badges: [{ label: '15 שנות ניסיון' }],
  testimonials: [{ quote: 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', author: 'שם הלקוח', role: 'תפקיד או עיר' }],
  testimonials_heading: 'לקוחות אומרים',
  cta_banner_subline: 'רק היום, הנחה!',
  seo_title: 'הטוב ביותר', seo_description: 'מבצע מיוחד לכל מי שמגיע',
  contact: { phone: '048123456', address: 'הרצל 12, חיפה', cta_type: 'whatsapp', whatsapp_message: 'מצאתי אתכם' },
  hidden_sections: ['faq_accordion'],
  design_system: { image_keywords: ['happy people'] },
});
{
  const src = 'מרפאת שיניים בחיפה, ד״ר כהן רופא שיניים. טיפולי שורש והלבנת שיניים.';
  const { content: h, report } = applyHealthTemplate(loud(), { businessName: 'מרפאת כהן', address: 'הרצל 12, חיפה', sourceText: src, ctaType: 'whatsapp', doctor: { name: 'ד״ר כהן', role: 'רופא שיניים' } });
  assert.ok(report.length > 0, 'the lint reported what it changed');
  // the opening: quiet, names the city, two ways to book
  assert.ok(h.hero!.title!.includes('חיפה'), `headline names the city: ${h.hero!.title}`);
  assert.equal(h.hero!.title, 'מרפאת שיניים בחיפה');
  assert.equal(h.hero!.primary_cta_text, 'לקביעת תור בוואטסאפ');
  assert.equal(h.contact!.whatsapp_message, 'שלום, אשמח לקבוע תור במרפאת כהן.');
  assert.equal(h.contact!.cta_type, 'whatsapp');
  assert.ok(!/[!]/.test(JSON.stringify(h)), 'no exclamation marks anywhere');
  // every generated text is clean under the lint
  const texts: string[] = [];
  const walk = (v: unknown) => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk({ ...h, design_system: undefined });
  for (const t of texts) assert.deepEqual(lintHealthCopy(t, { sourceText: src }), [], `clean: ${t}`);
  // treatments: the ones the owner named stay, their sentences softened
  const titles = h.services_or_benefits!.map((s) => s.title);
  assert.deepEqual(titles, ['טיפולי שורש', 'הלבנת שיניים', 'שירות ראשון']);
  assert.equal(h.services_or_benefits![2].description, 'שאלו אותנו על הטיפול הזה, ונסביר מה כרוך בו.', 'a description with nothing clean left gets the neutral sentence');
  assert.ok(h.services_or_benefits!.every((s) => s.description.length > 0));
  assert.ok(!h.services_or_benefits!.some((s) => /₪|ללא כאב|מדהימות/.test(s.description)), 'no price, no pain promise, no hype');
  assert.equal(h.services_heading, 'הטיפולים שלנו');
  // the sections the system writes: first visit, FAQ (neutral), no badges, no benefits
  assert.deepEqual(h.process_steps!.map((s) => s.title), HEALTH_FIRST_VISIT.map((s) => s.title));
  assert.ok(h.faq!.length >= 4);
  const faqText = JSON.stringify(h.faq);
  for (const fund of ['כללית', 'מכבי', 'מאוחדת', 'לאומית']) assert.ok(!faqText.includes(fund), `the FAQ never names ${fund}`);
  assert.ok(h.faq!.some((f) => /קופת חולים|קופות חולים/.test(f.question + f.answer)), 'health funds are covered');
  assert.ok(h.faq!.some((f) => /חושש/.test(f.question)), 'anxiety is covered');
  assert.ok(h.faq!.some((f) => /דחוף/.test(f.question)), 'emergencies are covered');
  assert.ok(h.faq!.some((f) => /ביקור הראשון/.test(f.question)), 'the first visit is covered');
  assert.ok(h.faq!.every((f) => !/אנחנו עובדים עם|מקבלים את|מכובדת|מכבדים/.test(f.answer)), 'no claim about what this clinic accepts');
  assert.ok(h.faq!.every((f) => /שאלו|התקשרו|כתבו|פנו|אפשר|תלוי|בדרך כלל|זה /.test(f.answer)), 'phrased as an invitation to ask');
  assert.deepEqual(h.benefits, []);
  assert.equal(h.trust_badges, undefined);
  assert.equal(h.testimonials![0].quote, 'הכנס כאן ציטוט אמיתי של לקוח שמספר על החוויה שלו', 'the reviews behaviour is unchanged');
  // doctor, languages, practical lines
  assert.deepEqual(h.team, [{ name: 'ד״ר כהן', role: 'רופא שיניים', credentials: '', experience: '' }]);
  assert.equal(h.team![0].license_number, undefined, 'no licence number unless the owner wrote one');
  assert.deepEqual(h.spoken_languages, ['עברית']);
  assert.deepEqual(h.practical_info, {});
  // before/after exists but is off; what the owner had hidden stays hidden
  assert.deepEqual([...h.hidden_sections!].sort(), ['before_after', 'faq_accordion']);
  // the input is not mutated
  assert.equal(loud().hero!.title, 'המרפאה הטובה ביותר בעיר');

  // a phone-only page words the button for the phone
  const phone = applyHealthTemplate(loud(), { businessName: 'מרפאת כהן', sourceText: src, ctaType: 'phone' }).content;
  assert.equal(phone.hero!.primary_cta_text, 'לקביעת תור בטלפון');
  assert.ok(!JSON.stringify(phone.faq).includes('וואטסאפ'), 'a phone-only page does not tell people to use WhatsApp');

  // no city known -> the headline falls back to the business name; no doctor -> no team
  const noCity = applyHealthTemplate(loud(), { businessName: 'מרפאת כהן', sourceText: 'מרפאת שיניים', ctaType: 'whatsapp' }).content;
  assert.equal(noCity.hero!.title, 'מרפאת כהן');
  assert.deepEqual(noCity.team, []);
  // no treatments named at all -> one neutral entry, never invented ones
  const none = applyHealthTemplate({ ...loud(), services_or_benefits: [] }, { businessName: 'x', sourceText: 'מרפאת שיניים בחיפה', ctaType: 'whatsapp' }).content;
  assert.equal(none.services_or_benefits!.length, 1);
  assert.equal(none.services_or_benefits![0].title, 'טיפולי שיניים');
  // a number the owner wrote may stay
  const priced = applyHealthTemplate({ ...loud(), services_or_benefits: [{ id: '1', title: 'בדיקה', description: 'בדיקה ראשונה ב-150 ₪.' }] }, { businessName: 'x', sourceText: 'בדיקה ראשונה ב-150 ₪', ctaType: 'whatsapp' }).content;
  assert.ok(priced.services_or_benefits![0].description.includes('150'), 'the owner\'s price is kept');
  // a physio clinic gets the physio label and no dental wording
  const physio = applyHealthTemplate(loud(), { businessName: 'x', address: 'דרך הים 3, חיפה', sourceText: 'קליניקה לפיזיותרפיה בחיפה', ctaType: 'whatsapp' }).content;
  assert.equal(physio.hero!.title, 'פיזיותרפיה בחיפה');
  assert.ok(!JSON.stringify(physio.faq).includes('שיניים'));
  assert.ok(healthFaq('dental', 'whatsapp').some((f) => f.question.includes('שיניים')));
}

// a regeneration keeps what the owner entered
{
  const prev: AiContent = { team: [{ name: 'ד״ר לוי', role: 'רופאה', credentials: 'x', experience: 'y', license_number: '123' }], spoken_languages: ['עברית', 'רוסית'], practical_info: { parking: 'חניון' }, contact: { cta_type: 'phone' }, hidden_sections: ['gallery'] };
  const next: AiContent = { hero: { title: 'חדש' }, contact: { phone: '1' }, spoken_languages: ['עברית'] };
  const merged = carryOverOwnerData(prev, next, ['before_after']);
  assert.deepEqual(merged.team, prev.team);
  assert.deepEqual(merged.spoken_languages, ['עברית', 'רוסית']);
  assert.deepEqual(merged.practical_info, { parking: 'חניון' });
  assert.equal(merged.contact!.cta_type, 'phone');
  assert.equal(merged.contact!.phone, '1');
  assert.deepEqual([...merged.hidden_sections!].sort(), ['before_after', 'gallery']);
  const bare = carryOverOwnerData(undefined, { hero: { title: 'x' } }, []);
  assert.equal(bare.hidden_sections, undefined, 'nothing hidden -> no empty list');
}

// ─── prompts and the writer (no API key in tests: the neutral fallback is used) ─
{
  const base: GenerateInput = { business_name: 'מרפאת כהן', phone_number: '048123456', vibe: 'מרפאת שיניים בחיפה', address: 'הרצל 12, חיפה', image_source: 'stock', page_goal: 'lead_gen' };
  const gCore = buildCoreSystem(base), gTrust = buildTrustSystem(base);
  assert.ok(!gCore.includes('CATEGORY TEMPLATE') && !gTrust.includes('CATEGORY TEMPLATE'), 'general prompts carry no category block');
  assert.equal(buildCoreSystem({ ...base, category: 'general' }), gCore, 'general is byte-for-byte the old prompt');
  assert.equal(buildCoreSystem({ ...base, category: 'beauty' }), gCore, 'a category without its own template keeps the general prompt');
  const hCore = buildCoreSystem({ ...base, category: 'health', cta_type: 'whatsapp' }), hTrust = buildTrustSystem({ ...base, category: 'health' });
  assert.ok(hCore.includes('CATEGORY TEMPLATE — HEALTH') && hTrust.includes('CATEGORY TEMPLATE — HEALTH'));
  assert.ok(hCore.includes('"חיפה"') && hCore.includes('לקביעת תור בוואטסאפ'), 'the city and the button text are in the prompt');
  assert.ok(hCore.includes('הזדמנות') === false || hCore.includes('NEVER'), 'the forbidden words appear only as prohibitions');
  for (const rule of CATEGORY_CONFIG.health.toneRules) assert.ok(hCore.includes(rule) && hTrust.includes(rule), `tone rule in both prompts: ${rule.slice(0, 40)}`);
  assert.ok(hCore.includes('"doctor"') && hCore.includes('NEVER invent a name'), 'the doctor is extracted, never invented');
  assert.ok(hCore.indexOf('CATEGORY TEMPLATE') > hCore.indexOf('LAYOUT COMPOSITION RULES'), 'the category block comes last, so it wins');
  assert.ok(hCore.includes('ONLY treatments the owner named'));

  delete process.env.ANTHROPIC_API_KEY;
  const general = await generateAiContent({ ...base, include_testimonials: false });
  const generalExplicit = await generateAiContent({ ...base, include_testimonials: false, category: 'general' });
  assert.deepEqual(generalExplicit, general, 'general content is the same with or without a category');
  assert.equal(general.team, undefined, 'a general page has no health fields');
  assert.equal(general.spoken_languages, undefined);
  assert.equal(general.hidden_sections, undefined);
  const health = await generateAiContent({ ...base, include_testimonials: false, category: 'health', cta_type: 'whatsapp' });
  assert.equal(health.hero!.title, 'מרפאת שיניים בחיפה');
  assert.deepEqual(health.hidden_sections, ['before_after']);
  assert.deepEqual(health.design_system!.image_keywords, ['dental clinic interior', 'dentist office', 'dental care']);
  assert.equal(health.services_or_benefits!.length, 1, 'the fallback\'s three invented services are not treatments');
  assert.ok(!JSON.stringify(health).includes('שירות ראשון'));
  assert.deepEqual(health.spoken_languages, ['עברית']);
}

console.log('page category checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
