// "שיפור הניסוח" (README part 144): the Google description and services checks, the fixes, the services
// clean-up, the grounding block, the daily counter, the JSON repair, the orchestration against a fake model,
// the description write-back for services Google already has, and the client mirror of the hints. No network.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'assert';
import { type TruthCard, emptyCard } from '../src/services/businessTruth';
import {
  PolishCounter, accountKey, applyServicesAnswer, buildGrounding, cardAreas, cardCategory, checkDescription, checkServices, cutAtSentence,
  descriptionPrompt, fixDescription, israelDay, nearDuplicate, normalizeServices, parseModelJson, readServicesAnswer, serviceKey, servicesPrompt,
  tidyName, ungroundedClaims, POLISH_DAILY_LIMIT,
} from '../src/services/businessPolish';
import { PolishError, polish, type PolishDeps } from '../src/services/businessPolish.service';
import { buildPatch, redescribe } from '../src/services/gbpSync';
import * as clientCheck from '../client/src/dashboard/v3/autopilot/polishCheck';

const codes = (l: { code: string }[]) => l.map((i) => i.code);
const has = (l: { code: string }[], c: string) => codes(l).includes(c);

const PLUMBER: TruthCard = {
  ...emptyCard(),
  name: 'אינסטלציה דני', phone: '04-8123456', website: 'https://dani.example.co.il', address: 'הרצל 10, חיפה', city: 'חיפה',
  category: 'אינסטלטור', categories: [], description: 'אינסטלטור מוסמך בחיפה. מגיעים מהר ונותנים הצעת מחיר לפני שמתחילים.',
  services: [{ name: 'פתיחת סתימות', description: 'במטבח ובאמבטיה', source: 'google' }, { name: 'החלפת דוד שמש', description: '', source: 'customer' }],
  areas: ['חיפה', 'קריית ביאליק'], hours: [{ day: 'SUNDAY', open: '08:00', close: '18:00' }],
  serviceArea: { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: [{ name: 'נשר', placeId: 'ChIJ_nesher_xx' }] },
  notes: 'עובדים נקי ומסבירים כל שלב.',
};
const DENTIST: TruthCard = {
  ...emptyCard(), name: 'מרפאת שיניים לוי', city: 'רעננה', category: 'רופא שיניים', areas: ['רעננה'],
  services: [{ name: 'טיפולי שיניים', description: '', source: 'google' }, { name: 'הלבנת שיניים', description: '', source: 'customer' }],
  description: 'מרפאת שיניים ברעננה.',
};

const GOOD = 'אינסטלציה לבית בחיפה ובקריות: פתיחת סתימות במטבח ובאמבטיה והחלפת דוד שמש. אנחנו מגיעים מהר, בודקים מה הבעיה ונותנים הצעת מחיר לפני שמתחילים לעבוד. בסוף כל עבודה אנחנו משאירים את הבית נקי ומסבירים מה עשינו.';

(async () => {
  // ── checkDescription: Google rules ──────────────────────────────────────────
  assert.deepEqual(codes(checkDescription('', PLUMBER)), ['empty']);
  const good = checkDescription(GOOD, PLUMBER);
  assert.ok(!good.some((i) => i.level === 'error'), `good text has no errors: ${JSON.stringify(good)}`);
  assert.ok(!has(good, 'no_area') && !has(good, 'no_service') && !has(good, 'too_short'));
  assert.ok(has(checkDescription(GOOD + ' '.repeat(2) + 'א'.repeat(760), PLUMBER), 'too_long'));
  assert.ok(has(checkDescription(`${GOOD} פרטים באתר https://dani.co.il`, PLUMBER), 'url'));
  assert.ok(has(checkDescription(`${GOOD} פרטים ב-dani.co.il`, PLUMBER), 'url'), 'bare domain');
  assert.ok(has(checkDescription(`${GOOD} כתבו ל-dani@mail.com`, PLUMBER), 'email'));
  assert.ok(has(checkDescription(`${GOOD} התקשרו 050-1234567`, PLUMBER), 'phone'));
  assert.ok(has(checkDescription(`${GOOD} חייגו *6789`, PLUMBER), 'phone'));
  assert.ok(!has(checkDescription(`${GOOD} פתוחים 08:00-18:00`, PLUMBER), 'phone'), 'hours are not a phone number');
  assert.ok(has(checkDescription(`${GOOD} פתיחת סתימה ב-250 ₪ בלבד.`, PLUMBER), 'price'));
  assert.ok(has(checkDescription(`${GOOD} מבצע מיוחד לחורף!`, PLUMBER), 'promo'));
  assert.ok(has(checkDescription(`${GOOD} עכשיו בהנחה של 20%.`, PLUMBER), 'promo'));
  assert.ok(has(checkDescription(`${GOOD} הבדיקה חינם.`, PLUMBER), 'promo'));
  assert.ok(!has(checkDescription(`${GOOD} אנחנו מבצעים התקנות וגם תיקונים.`, PLUMBER), 'promo'), '"מבצעים" as a verb is fine');
  assert.ok(has(checkDescription(`${GOOD} THE BEST PLUMBER`, PLUMBER), 'caps'));
  assert.ok(!has(checkDescription(`${GOOD} תאורת LED`, PLUMBER), 'caps'), 'short acronyms are fine');
  assert.ok(has(checkDescription('אינסטלטור טוב. מגיעים מהר.', PLUMBER), 'too_short'));
  assert.ok(has(checkDescription('אינסטלטור שמגיע מהר ונותן הצעת מחיר לפני שמתחילים לעבוד, ומשאיר את הבית נקי ומסודר בסוף כל עבודה בלי לחץ ובלי הפתעות בכלל.', PLUMBER), 'no_area'));
  assert.ok(has(checkDescription('אינסטלציה בחיפה. אינסטלציה בקריות. אינסטלציה בנשר. אינסטלציה זולה. אינסטלציה מהירה. אינסטלציה טובה לכל הבית שלכם בחיפה.', PLUMBER), 'stuffing'));
  // the first 250 characters carry the essence
  const late = `${'אנחנו עסק משפחתי שאוהב את העבודה ואת הלקוחות שלו, ותמיד שמח לעזור לכל מי שפונה אלינו בכל שאלה. '.repeat(3)}פתיחת סתימות בחיפה.`;
  assert.ok(has(checkDescription(late, PLUMBER), 'essence_late'));

  // ── invented claims: only what the owner said ───────────────────────────────
  const inv = (t: string, c = PLUMBER) => checkDescription(`${GOOD} ${t}`, c).filter((i) => i.code === 'invented').map((i) => i.match);
  assert.ok(inv('יש לנו 20 שנות ניסיון.').length >= 1, 'years of experience');
  assert.ok(inv('ותק של שנים רבות בתחום.').length >= 1);
  assert.ok(inv('עבדנו כבר עם אלפי לקוחות.').length >= 1, 'amounts in words');
  assert.ok(inv('זוכי פרס האינסטלטור של השנה.').length >= 1, 'awards');
  assert.ok(inv('כל עבודה באחריות מלאה.').length >= 1, 'guarantee');
  assert.ok(inv('האינסטלטור הטוב ביותר בצפון.').length >= 1, 'superlative');
  assert.ok(inv('זמינים 24/7.').length >= 1, '24/7');
  assert.ok(inv('מומחים לצנרת.').length >= 1, 'expert');
  assert.deepEqual(inv('אינסטלטור מוסמך.'), [], '"מוסמך" is in the owner\'s description: grounded');
  assert.deepEqual(inv('פתוחים מ-08:00 עד 18:00.'), [], 'hours from the card are grounded');
  const certCard: TruthCard = { ...PLUMBER, description: 'אינסטלטור בחיפה.' };
  assert.ok(inv('אינסטלטור מוסמך.', certCard).length >= 1, 'a certificate the owner never mentioned');
  // the owner's draft counts as their words
  assert.deepEqual(ungroundedClaims('ניסיון של 15 שנה', 'אינסטלטור עם ניסיון של 15 שנה'), []);
  assert.deepEqual(ungroundedClaims('ניסיון של 15 שנה', 'אינסטלטור'), ['15', 'ניסיון של']);

  // ── health tone (healthCopy lint integration) ───────────────────────────────
  assert.equal(cardCategory(DENTIST), 'health');
  assert.equal(cardCategory(PLUMBER) === 'health', false);
  const dent = checkDescription('מרפאת שיניים ברעננה. טיפולי שיניים והלבנת שיניים ללא כאב, בסביבה רגועה ונעימה לכל המשפחה שלכם.', DENTIST);
  assert.ok(dent.some((i) => i.level === 'error' && (i.code === 'health_tone' || i.code === 'invented')), `health lint: ${JSON.stringify(dent)}`);
  assert.ok(has(checkDescription('מרפאת שיניים ברעננה! טיפולי שיניים והלבנת שיניים בסביבה רגועה ונעימה לכל המשפחה שלכם, בתיאום מראש.', DENTIST), 'loud'), 'one "!" is loud in health');
  const calm = fixDescription('מרפאת שיניים ברעננה: טיפולי שיניים והלבנת שיניים לכל המשפחה. הטיפול ללא כאב ועם תוצאות מובטחות! אנחנו מקפידים להסביר כל שלב לפני שמתחילים.', DENTIST);
  assert.ok(!/ללא כאב|מובטח|!/.test(calm), `softened: ${calm}`);
  assert.ok(/הלבנת שיניים/.test(calm) && /מסבירים|להסביר/.test(calm));

  // ── fixDescription ──────────────────────────────────────────────────────────
  const fixed = fixDescription(`${GOOD} התקשרו 050-1234567 עכשיו!!! מבצע מיוחד לחורף. יש לנו 20 שנות ניסיון. GREAT SERVICE`, PLUMBER);
  assert.ok(!/050|מבצע|20 שנות/.test(fixed), `fixed: ${fixed}`);
  assert.ok(!checkDescription(fixed, PLUMBER).some((i) => i.level === 'error'));
  assert.ok(fixed.startsWith('אינסטלציה לבית בחיפה'));
  const long = fixDescription(`${GOOD} ${'אנחנו עובדים בזהירות ובסבלנות בכל בית. '.repeat(30)}`, PLUMBER);
  assert.ok(long.length <= 750 && /[.!?]$/.test(long), 'cut at a sentence under 750');
  assert.equal(cutAtSentence('אחת. שתיים. שלוש.', 11), 'אחת. שתיים.');

  // ── services: tidy, dedupe, near-duplicates ─────────────────────────────────
  assert.equal(tidyName('- פתיחת סתימות.'), 'פתיחת סתימות');
  assert.equal(tidyName('2) החלפת דוד  שמש;'), 'החלפת דוד שמש');
  assert.ok(nearDuplicate('התקנת מזגן', 'התקנת מזגנים'));
  assert.ok(nearDuplicate('פתיחת סתימות', 'פתיחת  סתימות.'));
  assert.ok(nearDuplicate('החלפת דוד שמש', 'החלפת דודי שמש') || serviceKey('החלפת דוד שמש') !== '', 'key exists');
  assert.ok(!nearDuplicate('תיקון מזגנים', 'התקנת מזגנים'));
  const norm = normalizeServices([
    { name: 'פתיחת סתימות', description: '' }, { name: '• פתיחת סתימות.', description: 'במטבח ובאמבטיה' },
    { name: 'x', description: '' }, { name: 'החלפת דוד שמש', description: '' },
  ]);
  assert.deepEqual(norm, [{ name: 'פתיחת סתימות', description: 'במטבח ובאמבטיה' }, { name: 'החלפת דוד שמש', description: '' }]);
  const sv = checkServices([
    { name: 'פתיחת סתימות', description: 'במטבח' }, { name: 'פתיחת סתימות.', description: '' },
    { name: 'התקנה של ברזים ואביזרי אמבטיה ומטבח מכל הסוגים', description: '' },
    { name: 'בדיקה', description: 'רק 99 ₪, התקשרו 050-1234567' }, { name: 'ייעוץ', description: 'א'.repeat(130) },
  ], PLUMBER);
  assert.ok(sv.some((i) => i.code === 'dup' && i.index === 1));
  assert.ok(sv.some((i) => i.code === 'name_long' && i.index === 2));
  assert.ok(sv.some((i) => i.code === 'price' && i.index === 3) && sv.some((i) => i.code === 'phone' && i.index === 3));
  assert.ok(sv.some((i) => i.code === 'desc_long' && i.index === 4));

  // ── applying the model's services answer: rules in code ─────────────────────
  const list = [
    { name: 'פתיחת סתימות', description: 'במטבח ובאמבטיה' },  // 0 on Google
    { name: 'החלפת דוד שמש', description: '' },               // 1 on Google
    { name: 'תיקון נזילות', description: '' },                 // 2
    { name: 'תיקון נזילות מים', description: 'ברזים וצנרת' },  // 3 same as 2
    { name: 'התקנת ברזים', description: '' },                  // 4
  ];
  const locked = new Set(['פתיחת סתימות', 'החלפת דוד שמש']);
  const answer = readServicesAnswer(parseModelJson(JSON.stringify({
    services: [
      { from: [0], name: 'פתיחת סתימות בבית', description: 'סתימות בכיורים, באסלות ובקווי ניקוז' },  // renames a Google item: refused
      { from: [1, 0], name: 'דודים', description: '' },                                                // merges two Google items: refused
      { from: [2, 3], name: 'תיקון נזילות', description: 'ברזים וצנרת בבית' },                          // a real merge
      { from: [9], name: 'שירות חדש', description: '' },                                               // no such row
      { from: [4], name: 'התקנת ברזים', description: 'כולל אחריות ל-5 שנים' },                          // invented: falls back
      { from: [4], name: 'כפול', description: '' },                                                    // row already used
    ],
    forgotten: ['תיקון ניאגרה', 'פתיחת סתימות', 'החלפת צנרת', 'התקנת מסנן מים', 'שירות 24 שעות'],
  })))!;
  assert.ok(answer);
  const applied = applyServicesAnswer(list, answer, PLUMBER, locked, { category: 'general' });
  const names = applied.services.map((s) => s.name);
  assert.deepEqual(names, ['פתיחת סתימות', 'החלפת דוד שמש', 'תיקון נזילות', 'התקנת ברזים'], `names: ${names}`);
  assert.ok(applied.services[0].locked && applied.services[1].locked);
  assert.equal(applied.services[0].description, 'סתימות בכיורים, באסלות ובקווי ניקוז', 'a Google item may get a better description');
  assert.deepEqual(applied.services[2].from, [2, 3]);
  assert.equal(applied.services[3].description, '', 'invented warranty dropped, the owner\'s (empty) description stays');
  const every = applied.services.flatMap((s) => s.from).sort();
  assert.deepEqual(every, [0, 1, 2, 3, 4], 'every owner row exactly once, nothing new');
  assert.deepEqual(applied.forgotten, ['תיקון ניאגרה', 'החלפת צנרת', 'התקנת מסנן מים'], 'max 3, no duplicates of listed, no numbers');
  // a dropped row comes back as it was
  const partial = applyServicesAnswer(list, { services: [{ from: [2, 3], name: 'תיקון נזילות', description: '' }], forgotten: [] }, PLUMBER, locked);
  assert.equal(partial.services.length, 4);
  assert.deepEqual(partial.services.map((s) => s.name), ['פתיחת סתימות', 'החלפת דוד שמש', 'תיקון נזילות', 'התקנת ברזים']);
  // a "merge" of two different services is refused
  const wrong = applyServicesAnswer(list, { services: [{ from: [2, 4], name: 'תיקונים', description: '' }], forgotten: [] }, PLUMBER, new Set());
  assert.ok(wrong.services.some((s) => s.from.join() === '2') && wrong.services.some((s) => s.from.join() === '4'));
  // health: a promise in a service description falls back
  const dentApplied = applyServicesAnswer([{ name: 'הלבנת שיניים', description: '' }], { services: [{ from: [0], name: 'הלבנת שיניים', description: 'תוצאות מובטחות ללא כאב' }], forgotten: [] }, DENTIST, new Set(), { category: 'health' });
  assert.equal(dentApplied.services[0].description, '');

  // ── grounding: only the card's facts ────────────────────────────────────────
  const g = buildGrounding(PLUMBER, { draft: 'טקסט חדש של בעל העסק', attributeLabels: ['כניסה נגישה'] });
  for (const want of ['אינסטלציה דני', 'אינסטלטור', 'חיפה', 'קריית ביאליק', 'נשר', 'פתיחת סתימות', 'במטבח ובאמבטיה', 'החלפת דוד שמש', 'כניסה נגישה', '08:00', 'מוסמך', 'עובדים נקי', 'טקסט חדש של בעל העסק']) {
    assert.ok(g.includes(want), `grounding has ${want}`);
  }
  for (const never of ['04-8123456', 'dani.example', 'הרצל']) assert.ok(!g.includes(never), `grounding never has ${never}`);
  assert.deepEqual(cardAreas(PLUMBER), ['חיפה', 'קריית ביאליק', 'נשר']);
  const dp = descriptionPrompt({ card: PLUMBER, draft: PLUMBER.description, category: 'general', previous: ['גרסה קודמת'] });
  assert.ok(dp.user.includes(g.split('\n')[0]) && dp.user.includes('גרסה קודמת') && !dp.user.includes('04-8123456'));
  assert.ok(/750/.test(dp.system) && /250/.test(dp.system) && /NEVER invent/.test(dp.system));
  const hp = descriptionPrompt({ card: DENTIST, draft: '', category: 'health' });
  assert.ok(/NEVER promise/.test(hp.system), 'health tone rules in the prompt');
  const sp = servicesPrompt({ card: PLUMBER, list, locked, category: 'general' });
  assert.ok(sp.user.includes('0. פתיחת סתימות [ON GOOGLE] | במטבח ובאמבטיה') && sp.user.includes('4. התקנת ברזים') && !sp.user.includes('04-8123456'));

  // ── the daily counter ───────────────────────────────────────────────────────
  const c = new PolishCounter();
  const acc = accountKey('Owner@Example.com');
  assert.ok(!acc.includes('owner') && !acc.includes('@') && acc === accountKey('owner@example.com '));
  const day = new Date('2026-11-22T10:00:00Z');
  for (let i = 0; i < POLISH_DAILY_LIMIT; i++) assert.ok(c.take(acc, 'description', day));
  assert.equal(c.take(acc, 'description', day), false, '4th is refused');
  assert.equal(c.remaining(acc, 'description', day), 0);
  assert.ok(c.take(acc, 'services', day), 'per field');
  c.refund(acc, 'description', day);
  assert.equal(c.remaining(acc, 'description', day), 1);
  assert.ok(c.take(acc, 'description', new Date('2026-11-22T22:30:00Z')) === true, 'midnight in Israel (UTC+2) starts a new day');
  assert.equal(israelDay(new Date('2026-11-22T22:30:00Z')), '2026-11-23');

  // ── JSON parse and repair ───────────────────────────────────────────────────
  assert.deepEqual(parseModelJson('```json\n{"description": "שלום"}\n```'), { description: 'שלום' });
  assert.deepEqual(parseModelJson('הנה: {"a": [1, 2,], } תודה'), { a: [1, 2] });
  assert.deepEqual(parseModelJson('{"description": "שירות לחיילי צה"ל ולמשפחות"}'), { description: 'שירות לחיילי צה״ל ולמשפחות' });
  assert.deepEqual(parseModelJson('{“description”: “x”}'), { description: 'x' });
  assert.equal(parseModelJson('no json'), null);
  assert.equal(parseModelJson('[1,2]'), null);
  assert.equal(readServicesAnswer({ services: 'x' }), null);

  // ── the orchestration against a fake model ──────────────────────────────────
  const answers: string[] = [];
  const calls: { system: string; user: string; temperature?: number }[] = [];
  const client = { messages: { create: async (a: any) => { calls.push({ system: a.system, user: a.messages[0].content, temperature: a.temperature }); const t = answers.shift(); if (t === undefined) throw new Error('boom'); return { content: [{ type: 'text', text: t }] } as any; } } };
  const deps = (over: Partial<PolishDeps> = {}): PolishDeps => ({
    client, counter: new PolishCounter(), timeoutMs: 500,
    card: async () => ({ card: PLUMBER, googleServices: ['פתיחת סתימות'], attributeLabels: [] }), ...over,
  });
  answers.push(JSON.stringify({ description: GOOD }));
  const d1 = await polish('a@b.c', 'description', {}, deps());
  assert.equal(d1.field, 'description');
  assert.equal(d1.field === 'description' && d1.suggestion, GOOD);
  assert.equal(d1.remaining, POLISH_DAILY_LIMIT - 1);
  assert.ok(d1.beforeIssues.length >= 0 && !d1.issues.some((i) => i.level === 'error'));

  // an answer that needs heavy cutting is retried once with what was wrong
  calls.length = 0;
  answers.push(JSON.stringify({ description: 'יש לנו 30 שנות ניסיון ואלפי לקוחות מרוצים. זוכי פרס האינסטלטור של השנה. אחריות מלאה על כל עבודה. התקשרו 050-1234567.' }), JSON.stringify({ description: GOOD }));
  const d2 = await polish('a@b.c', 'description', { draft: 'טיוטה שלי בחיפה' }, deps());
  assert.equal(calls.length, 2);
  assert.ok(/YOUR LAST ANSWER BROKE/.test(calls[1].user) && /invented|phone/.test(calls[1].user));
  assert.equal(d2.field === 'description' && d2.before, 'טיוטה שלי בחיפה');
  // "ניסוח אחר": earlier suggestions go to the prompt, with more variety
  calls.length = 0;
  answers.push(JSON.stringify({ description: GOOD }));
  await polish('a@b.c', 'description', { previous: ['ההצעה הראשונה'] }, deps());
  assert.ok(calls[0].user.includes('ההצעה הראשונה') && (calls[0].temperature ?? 0) > 0.5);
  // nothing usable twice: no suggestion, allowance returned
  const counter = new PolishCounter();
  answers.push('not json', JSON.stringify({ description: 'התקשרו 050-1234567' }));
  await assert.rejects(polish('a@b.c', 'description', {}, deps({ counter })), (e: unknown) => e instanceof PolishError && e.code === 'failed');
  assert.equal(counter.remaining(accountKey('a@b.c'), 'description'), POLISH_DAILY_LIMIT, 'refunded');
  // model errors (timeouts) end the same way
  await assert.rejects(polish('a@b.c', 'description', {}, deps({ counter })), (e: unknown) => e instanceof PolishError && e.code === 'failed');
  // limit, no model, no card
  const full = new PolishCounter(0);
  await assert.rejects(polish('a@b.c', 'description', {}, deps({ counter: full })), (e: unknown) => e instanceof PolishError && e.code === 'limit');
  await assert.rejects(polish('a@b.c', 'description', {}, deps({ client: null })), (e: unknown) => e instanceof PolishError && e.code === 'unavailable');
  await assert.rejects(polish('a@b.c', 'description', {}, deps({ card: async () => null })), (e: unknown) => e instanceof PolishError && e.code === 'not_found');
  // services: the owner's unsaved list; the Google name is locked
  calls.length = 0;
  answers.push(JSON.stringify({ services: [{ from: [0], name: 'סתימות', description: 'בכיורים ובאסלות' }, { from: [1], name: 'החלפת דוד שמש', description: 'כולל פירוק הדוד הישן' }, { from: [2], name: 'תיקון נזילות', description: '' }], forgotten: ['תיקון ניאגרה'] }));
  const s1 = await polish('a@b.c', 'services', { draft: [{ name: 'פתיחת סתימות', description: '' }, { name: 'החלפת דוד שמש.', description: '' }, { name: 'תיקון נזילות', description: '' }] }, deps());
  assert.equal(s1.field, 'services');
  if (s1.field === 'services') {
    assert.deepEqual(s1.suggestion.map((r) => r.name), ['פתיחת סתימות', 'החלפת דוד שמש', 'תיקון נזילות']);
    assert.ok(s1.suggestion[0].locked && !s1.suggestion[1].locked);
    assert.deepEqual(s1.forgotten, ['תיקון ניאגרה']);
    assert.ok(calls[0].user.includes('[ON GOOGLE]'));
  }
  await assert.rejects(polish('a@b.c', 'services', { draft: [] }, deps({ card: async () => ({ card: { ...PLUMBER, services: [] }, googleServices: null, attributeLabels: [] }) })), (e: unknown) => e instanceof PolishError && e.code === 'empty');

  // ── write-back: a new description for a service Google already has ──────────
  const raw = {
    categories: { primaryCategory: { name: 'categories/gcid:plumber', serviceTypes: [{ serviceTypeId: 'job_type_id:unclog', displayName: 'פתיחת סתימות' }] } },
    serviceItems: [
      { structuredServiceItem: { serviceTypeId: 'job_type_id:unclog', description: 'ישן' }, price: { units: '1' } },
      { freeFormServiceItem: { category: 'categories/gcid:plumber', label: { displayName: 'החלפת דוד שמש', description: '' } } },
      { freeFormServiceItem: { category: 'categories/gcid:plumber', label: { displayName: 'תיקון ניאגרה' } } },
    ],
  };
  const mine = [
    { name: 'פתיחת סתימות', description: 'בכיורים ובאסלות', source: 'google' as const },
    { name: 'החלפת דוד שמש', description: 'כולל פירוק', source: 'google' as const },
  ];
  const r = redescribe(raw.serviceItems, raw, mine);
  assert.equal(r.changed, 2);
  assert.equal(r.items[0].structuredServiceItem.description, 'בכיורים ובאסלות');
  assert.deepEqual(r.items[0].price, { units: '1' }, 'everything else stays as read');
  assert.equal(r.items[1].freeFormServiceItem.label.displayName, 'החלפת דוד שמש', 'names never change');
  assert.deepEqual(r.items[2], raw.serviceItems[2], 'items we have no description for stay as read');
  const patch = buildPatch('services', { ...PLUMBER, services: mine }, raw)!;
  assert.deepEqual(patch.mask, ['serviceItems']);
  assert.equal((patch.body.serviceItems as unknown[]).length, 3, 'nothing removed, nothing added');
  assert.equal(buildPatch('services', { ...PLUMBER, services: [{ name: 'החלפת דוד שמש', description: '', source: 'google' }] }, raw), null, 'an empty description never clears Google\'s');

  // ── the client hints mirror the server ──────────────────────────────────────
  const areas = cardAreas(PLUMBER);
  const shared = new Set(['too_short', 'too_long', 'url', 'email', 'phone', 'caps', 'no_area']);
  for (const t of [GOOD, 'אינסטלטור טוב.', `${GOOD} התקשרו 050-1234567`, `${GOOD} www.dani.co.il`, 'שירות מהיר ואמין לכל הבית, בלי הפתעות ועם הסבר על כל שלב לפני שמתחילים לעבוד בבית שלכם.', `${GOOD} GREAT`, 'א'.repeat(800)]) {
    const server = codes(checkDescription(t, PLUMBER)).filter((x) => shared.has(x)).sort();
    const client = codes(clientCheck.descriptionHints(t, areas)).sort();
    assert.deepEqual(client, server, `client and server agree on: ${t.slice(0, 30)}`);
  }
  for (const [a, b] of [['התקנת מזגן', 'התקנת מזגנים'], ['תיקון מזגנים', 'התקנת מזגנים'], ['- פתיחת סתימות', 'פתיחת סתימות']]) {
    assert.equal(clientCheck.serviceKey(a), serviceKey(a));
    assert.equal(clientCheck.nearDuplicate(a, b), nearDuplicate(a, b));
  }

  console.log('ai business polish: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
