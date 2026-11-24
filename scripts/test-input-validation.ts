// Run: npx tsx scripts/test-input-validation.ts   (pure rules + controllers with a mocked Supabase, no network)
// README part 150, the QA pass of 23-24 Nov 2026: the page wizard's input rules (shared by the wizard and the
// server), the server rejecting bad input on create and edit, older pages staying editable, the published
// page's title, the honesty rules of the page writer, and the mixed-alphabet check.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'fake';
delete process.env.ANTHROPIC_API_KEY;
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COUNTED_FIELDS, INPUT_MESSAGES, PAGE_INPUT_LIMITS, USER_TEXT_COMBINED_MAX, canonicalHttpUrl, checkLink, counterText, fieldError,
  isValidEmail, isValidIlPhone, normalizeIlPhone, phoneKind, validatePageInput,
} from '../src/shared/pageInput';
import { TITLE_FALLBACK_DESCRIPTOR, buildPageTitle, isolate, stripBidi, textDir } from '../src/shared/pageText';
import * as clientInput from '../client/src/lib/pageInput';
import * as clientText from '../client/src/lib/pageText';
import { EDIT_TEXT_MAX, validateContentEdit, validateTranslationChanges } from '../src/utils/pageEditInput';
import {
  FAQ_MIN_OWNER_TEXT, enforceFaqGate, faqAllowed, faqRule, hasMixedScript, lintScripts, mixedScriptWords,
} from '../src/services/pageHonesty';
/* eslint-disable @typescript-eslint/no-var-requires */
const { supabase } = require('../src/config/supabase') as typeof import('../src/config/supabase');
const { NO_FABRICATION_RULE, buildCoreSystem, buildTrustSystem, generateAiContent } = require('../src/services/ai.service') as typeof import('../src/services/ai.service');
const { createLandingPage, updateLandingPage } = require('../src/controllers/landing.controller') as typeof import('../src/controllers/landing.controller');
const { servePageWithOgTags } = require('../src/controllers/og.controller') as typeof import('../src/controllers/og.controller');

const RLM = String.fromCharCode(0x200f);
const RLI = String.fromCharCode(0x2067);
const LRI = String.fromCharCode(0x2066);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

async function main() {
// ─── one rule set: the client copies are byte-identical ─────────────────────
const root = join(__dirname, '..');
assert.equal(readFileSync(join(root, 'client/src/lib/pageInput.ts'), 'utf8'), readFileSync(join(root, 'src/shared/pageInput.ts'), 'utf8'),
  'client/src/lib/pageInput.ts must be an exact copy of src/shared/pageInput.ts');
assert.equal(readFileSync(join(root, 'client/src/lib/pageText.ts'), 'utf8'), readFileSync(join(root, 'src/shared/pageText.ts'), 'utf8'),
  'client/src/lib/pageText.ts must be an exact copy of src/shared/pageText.ts');
assert.deepEqual(clientInput.PAGE_INPUT_LIMITS, PAGE_INPUT_LIMITS);
assert.equal(clientInput.fieldError('phone_number', '12345'), fieldError('phone_number', '12345'));
assert.equal(clientText.buildPageTitle({ businessName: 'x' }), buildPageTitle({ businessName: 'x' }));

// ─── phones ───────────────────────────────────────────────────────────────────
const goodPhones: Array<[string, string, string]> = [
  ['0501234567', '0501234567', 'mobile'], ['050-123-4567', '0501234567', 'mobile'], ['050 123 4567', '0501234567', 'mobile'],
  ['054.123.4567', '0541234567', 'mobile'], ['+972501234567', '0501234567', 'mobile'], ['+972-50-123-4567', '0501234567', 'mobile'],
  ['972501234567', '0501234567', 'mobile'], ['00972501234567', '0501234567', 'mobile'], ['+972 050 1234567', '0501234567', 'mobile'],
  ['03-1234567', '031234567', 'landline'], ['031234567', '031234567', 'landline'], ['(03) 123-4567', '031234567', 'landline'],
  ['02-6234567', '026234567', 'landline'], ['04 8123456', '048123456', 'landline'], ['08-9123456', '089123456', 'landline'],
  ['09-7654321', '097654321', 'landline'], ['+97231234567', '031234567', 'landline'], ['+972-3-123-4567', '031234567', 'landline'],
  ['072-2123456', '0722123456', 'voip'], ['077-1234567', '0771234567', 'voip'],
  ['1-700-123-456', '1700123456', 'special'], ['1700123456', '1700123456', 'special'], ['1-800-123-456', '1800123456', 'special'],
  ['1-801-234-567', '1801234567', 'special'], ['1-599-123-456', '1599123456', 'special'], ['  0501234567  ', '0501234567', 'mobile'],
];
for (const [raw, national, kind] of goodPhones) {
  assert.equal(normalizeIlPhone(raw), national, `phone ok: ${raw}`);
  assert.equal(phoneKind(raw), kind, `phone kind: ${raw}`);
  assert.equal(fieldError('phone_number', raw, { required: true }), null, `no error: ${raw}`);
}
for (const bad of [
  'not-a-phone', '12345', '0501234', '05012345678', '050-123-45678', '+1 805 535 6461', '+44 20 7946 0958', '+18055356461',
  '06-1234567', '0101234567', '070-1234567', '050-123-456a', '*2345', '#1234', '+972-1-700-123-456', '+9721700123456',
  '0501234567 ext 5', '050 123 4567 / 03 1234567', '05O1234567', '+', '0', '000000000', '0501234567890123456789',
]) {
  assert.equal(isValidIlPhone(bad), false, `phone rejected: ${bad}`);
  assert.equal(fieldError('phone_number', bad, { required: true }), INPUT_MESSAGES.phone, `phone message: ${bad}`);
}
for (const nonStr of [undefined, null, 501234567, {}, ['0501234567']]) assert.equal(isValidIlPhone(nonStr), false);
assert.equal(fieldError('phone_number', '', { required: true }), INPUT_MESSAGES.required, 'required phone');
assert.equal(fieldError('phone_number', '   ', { required: true }), INPUT_MESSAGES.required, 'blank phone');

// ─── emails ───────────────────────────────────────────────────────────────────
for (const ok of ['info@mybusiness.co.il', 'dani.cohen+page@gmail.com', 'a@b.io', 'x_y-z@sub.domain.org', ' info@x.co.il ']) {
  assert.ok(isValidEmail(ok), `email ok: ${ok}`);
  assert.equal(fieldError('email', ok), null);
}
for (const bad of ['not-an-email', 'a@b', '@b.co', 'a@.co', 'a@b.c', 'a b@c.co', 'a@b..co', '.a@b.co', 'a.@b.co', 'a..b@c.co',
  'a@b.co>', 'a@-b.co', 'דני@מייל.קום', 'a@b.co,c@d.co', `${'a'.repeat(65)}@b.co`, `a@${'b'.repeat(250)}.co`]) {
  assert.equal(isValidEmail(bad), false, `email rejected: ${bad}`);
  assert.ok(fieldError('email', bad), `email error: ${bad}`);
  if (bad.length <= 254) assert.equal(fieldError('email', bad), INPUT_MESSAGES.email, `email message: ${bad}`);
}
assert.equal(fieldError('email', ''), null, 'email is optional');

// ─── links, per field ────────────────────────────────────────────────────────
const fbOk: Array<[string, string]> = [
  ['https://facebook.com/mybiz', 'https://facebook.com/mybiz'], ['facebook.com/mybiz', 'https://facebook.com/mybiz'],
  ['www.facebook.com/mybiz/', 'https://www.facebook.com/mybiz/'], ['https://m.facebook.com/x', 'https://m.facebook.com/x'],
  ['https://www.facebook.com/profile.php?id=1000', 'https://www.facebook.com/profile.php?id=1000'], ['https://fb.me/x', 'https://fb.me/x'],
  ['http://he-il.facebook.com/x', 'http://he-il.facebook.com/x'],
];
for (const [raw, href] of fbOk) assert.deepEqual(checkLink('facebook_url', raw), { ok: true, value: href }, `fb ok: ${raw}`);
for (const bad of ['not a url', 'facebook', 'https://facebook.com', 'https://facebook.com/', 'https://evilfacebook.com/x', 'https://facebook.com.evil.co/x',
  'javascript:alert(1)', 'https://instagram.com/x', 'https://example.co.il/fb', 'ftp://facebook.com/x', 'https://user:pw@facebook.com/x', 'https://facebook.com/x y']) {
  const r = checkLink('facebook_url', bad);
  assert.equal(r.ok, false, `fb rejected: ${bad}`);
  assert.equal(fieldError('facebook_url', bad), INPUT_MESSAGES.facebook_url);
}
for (const ok of ['https://instagram.com/mybiz', 'instagram.com/mybiz', 'https://www.instagram.com/mybiz/?hl=he', 'https://instagr.am/p/x'])
  assert.equal(checkLink('instagram_url', ok).ok, true, `ig ok: ${ok}`);
for (const bad of ['https://instagram.com', 'https://facebook.com/x', 'https://notinstagram.com/x', 'instagram', 'data:text/html,1'])
  assert.equal(checkLink('instagram_url', bad).ok, false, `ig rejected: ${bad}`);
for (const ok of ['https://example.co.il', 'paybox.co.il/abc', 'https://www.bitpay.co.il/app/me/123?x=1#y', 'http://shop.example.com/p/1'])
  assert.equal(checkLink('external_link', ok).ok, true, `link ok: ${ok}`);
for (const bad of ['ftp://x.com', 'http://localhost:3000', 'localhost:3000/x', 'https://user:pw@x.com', 'http://1.2.3.4/x', 'https://x', 'javascript:alert(1)',
  '//evil.co/x', 'https://x.co/"onmouseover="1', 'mailto:a@b.co', `https://x.co/${'a'.repeat(600)}`])
  assert.equal(checkLink('external_link', bad).ok, false, `link rejected: ${bad.slice(0, 40)}`);
assert.deepEqual(checkLink('external_link', ''), { ok: true, value: null }, 'empty link is fine');
assert.deepEqual(checkLink('external_link', undefined), { ok: true, value: null });
assert.equal(canonicalHttpUrl('HTTPS://Example.CO.IL/A'), 'https://example.co.il/A');

// ─── lengths and lines ──────────────────────────────────────────────────────
const long = (n: number) => 'א'.repeat(n);
assert.equal(fieldError('address', long(508)), INPUT_MESSAGES.tooLong(PAGE_INPUT_LIMITS.address, 508), 'a 508-character address (QA)');
assert.equal(fieldError('business_name', long(416), { required: true }), INPUT_MESSAGES.tooLong(PAGE_INPUT_LIMITS.business_name, 416), 'a 416-character name (QA)');
assert.equal(fieldError('intake_answer', long(1200)), INPUT_MESSAGES.tooLong(PAGE_INPUT_LIMITS.intake_answer, 1200), 'a 1,200-character answer (QA)');
assert.equal(fieldError('business_name', long(PAGE_INPUT_LIMITS.business_name)), null, 'exactly the limit is fine');
assert.equal(fieldError('business_name', `  ${long(PAGE_INPUT_LIMITS.business_name)}  `), null, 'the limit is measured after trimming');
assert.ok(fieldError('user_provided_text', long(PAGE_INPUT_LIMITS.user_provided_text + 1)), 'free text over the wizard limit');
assert.equal(fieldError('user_provided_text', long(4000), { max: USER_TEXT_COMBINED_MAX }), null, 'the server measures the combined text');
assert.equal(fieldError('business_name', 'מאפייה\nשל דני'), INPUT_MESSAGES.oneLine, 'a name is one line');
assert.equal(fieldError('business_hours', "א'-ה' 9:00-19:00\nו' 8:00-14:00"), null, 'hours may hold several lines');
assert.equal(fieldError('vibe', `מאפייה${String.fromCharCode(7)}`), INPUT_MESSAGES.badChars, 'control characters');
assert.equal(fieldError('vibe', 5 as unknown as string), INPUT_MESSAGES.badChars, 'not a string');
assert.equal(counterText('  שלום  ', 'user_provided_text'), `4/${PAGE_INPUT_LIMITS.user_provided_text}`);
assert.ok(COUNTED_FIELDS.has('user_provided_text') && COUNTED_FIELDS.has('intake_answer') && !COUNTED_FIELDS.has('phone_number'));
for (const [k, v] of Object.entries(PAGE_INPUT_LIMITS)) assert.ok(v > 0 && v <= 5000, `sensible limit: ${k}`);

// ─── the whole form ─────────────────────────────────────────────────────────
const QA_INPUT = {
  business_name: long(416), vibe: 'מאפייה', phone_number: 'not-a-phone', email: 'bad@', address: long(508),
  facebook_url: 'not-a-facebook-url', user_provided_text: long(10),
};
const qa = validatePageInput(QA_INPUT, { combinedUserText: true });
assert.equal(qa.ok, false);
assert.deepEqual(Object.keys(qa.errors).sort(), ['address', 'business_name', 'email', 'facebook_url', 'phone_number'], 'every QA field has its error');
const good = validatePageInput({ business_name: 'QA מאפיית בדיקה', vibe: 'מאפייה ביתית', phone_number: '050-1234567', facebook_url: 'facebook.com/qa.bakery' });
assert.equal(good.ok, true, JSON.stringify(good.errors));
assert.equal(good.links.facebook_url, 'https://facebook.com/qa.bakery', 'canonical link');
assert.deepEqual(Object.keys(validatePageInput({}).errors).sort(), ['business_name', 'phone_number', 'vibe'], 'the three required fields');
const ctaLink = validatePageInput({ business_name: 'x', vibe: 'y', phone_number: '0501234567', cta_type: 'link' });
assert.equal(ctaLink.errors.external_link, INPUT_MESSAGES.linkRequired, 'a link button needs its link');
assert.equal(validatePageInput({ business_name: 'x', vibe: 'y', phone_number: '0501234567', cta_type: 'link', external_link: 'https://pay.co.il/x' }).ok, true);

// ─── the server rejects on create, before any cost ──────────────────────────
const fromCalls: string[] = [];
(supabase as any).from = (table: string) => { fromCalls.push(table); throw new Error(`no database in this test (${table})`); };
const call = async (fn: (req: any, res: any) => Promise<void>, req: any) => {
  const out: { code: number; body: any } = { code: 200, body: null };
  const res: any = { locals: {}, status: (c: number) => { out.code = c; return res; }, json: (b: any) => { out.body = b; return res; }, setHeader: () => res, send: (b: any) => { out.body = b; return res; } };
  const log = console.log; const seen: string[] = [];
  console.log = (...a: unknown[]) => { seen.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  try { await fn(req, res); } finally { console.log = log; }
  return { ...out, logged: seen.join('\n') };
};
{
  const r = await call(createLandingPage, { body: { ...QA_INPUT }, files: {}, authEmail: 'o@x.co' });
  assert.equal(r.code, 400, 'QA input is rejected');
  assert.equal(r.body.code, 'bad_input');
  for (const f of ['business_name', 'phone_number', 'email', 'address', 'facebook_url']) assert.ok(r.body.field_errors[f], `server field error: ${f}`);
  assert.match(r.body.error, /:/, 'a readable first error for older clients');
  assert.ok(!/not-a-phone|o@x\.co/.test(r.logged), 'the request body is not logged');
  assert.equal(fromCalls.length, 0, 'rejected before any database (and AI) work');
}
for (const [field, value] of [['phone_number', '12345'], ['email', 'x@y'], ['instagram_url', 'https://facebook.com/x'], ['external_link', 'javascript:alert(1)'],
  ['user_provided_text', long(USER_TEXT_COMBINED_MAX + 1)], ['testimonial_author', long(81)], ['business_hours', long(501)]] as const) {
  const r = await call(createLandingPage, { body: { business_name: 'קפה', phone_number: '0501234567', vibe: 'בית קפה', [field]: value }, files: {}, authEmail: 'o@x.co' });
  assert.equal(r.code, 400, `server rejects ${field}`);
  assert.ok(r.body.field_errors[field], `field error for ${field}`);
}
{
  const r = await call(createLandingPage, { body: { business_name: 'קפה', phone_number: '0501234567', vibe: 'בית קפה', cta_type: 'link' }, files: {}, authEmail: 'o@x.co' });
  assert.equal(r.code, 400, 'a link button with no link');
  assert.equal(r.body.field_errors.external_link, INPUT_MESSAGES.linkRequired);
}

// ─── edit: only what changed is checked; older pages keep saving ─────────────
const OLD_PAGE = {
  hero: { title: 'כותרת ישנה', subtitle: 'x' },
  contact: { phone: 'call me maybe', email: 'not-an-email', address: long(700), business_hours: long(900) },
  faq: [{ question: 'ש', answer: 'ת' }],
};
assert.deepEqual(validateContentEdit(OLD_PAGE, { ...OLD_PAGE, hero: { ...OLD_PAGE.hero, title: 'כותרת חדשה' } }), {}, 'an old page with bad stored values saves a headline fix');
assert.deepEqual(validateContentEdit(OLD_PAGE, OLD_PAGE), {}, 'saving unchanged content always works');
assert.deepEqual(validateContentEdit(null, { hero: { title: 'x' } }), {}, 'a page with no content yet');
assert.equal(validateContentEdit(OLD_PAGE, { ...OLD_PAGE, contact: { ...OLD_PAGE.contact, phone: 'abc' } })['contact.phone'], INPUT_MESSAGES.phone, 'a changed phone is checked');
assert.deepEqual(validateContentEdit(OLD_PAGE, { ...OLD_PAGE, contact: { ...OLD_PAGE.contact, phone: '03-1234567' } }), {}, 'a changed valid phone');
assert.deepEqual(validateContentEdit(OLD_PAGE, { ...OLD_PAGE, contact: { ...OLD_PAGE.contact, phone: '' } }), {}, 'an emptied phone falls back to the page column');
assert.equal(validateContentEdit(OLD_PAGE, { ...OLD_PAGE, contact: { ...OLD_PAGE.contact, email: 'x@' } })['contact.email'], INPUT_MESSAGES.email);
assert.ok(validateContentEdit(OLD_PAGE, { ...OLD_PAGE, contact: { ...OLD_PAGE.contact, address: long(701) } })['contact.address'], 'a changed address is length-checked');
assert.ok(validateContentEdit(OLD_PAGE, { ...OLD_PAGE, faq: [{ question: 'ש', answer: long(EDIT_TEXT_MAX + 1) }] })['faq.0.answer'], 'any changed text is bounded');
assert.ok(validateContentEdit(OLD_PAGE, 'x').ai_content && validateContentEdit(OLD_PAGE, [1]).ai_content, 'not an object');
assert.ok(validateContentEdit(null, { big: 'x'.repeat(4000), more: Array.from({ length: 60 }, () => 'y'.repeat(4000)) }).ai_content, 'whole content size');
assert.deepEqual(validateTranslationChanges({ 'hero.title': 'Hello' }), {});
assert.ok(validateTranslationChanges({ 'hero.title': 'x'.repeat(EDIT_TEXT_MAX + 1) })['hero.title']);
{
  let updated: unknown = null;
  (supabase as any).from = () => {
    const q: any = {
      select: () => q, eq: () => q,
      maybeSingle: () => Promise.resolve({ data: { ai_content: OLD_PAGE }, error: null }),
      update: (v: unknown) => { updated = v; return q; },
      single: () => Promise.resolve({ data: { id: 'p1', ai_content: (updated as any)?.ai_content }, error: null }),
    };
    return q;
  };
  const bad = await call(updateLandingPage, { params: { id: 'p1' }, body: { ai_content: { ...OLD_PAGE, contact: { ...OLD_PAGE.contact, phone: 'not-a-phone' } } } });
  assert.equal(bad.code, 400, 'PATCH rejects a changed invalid phone');
  assert.equal(bad.body.field_errors['contact.phone'], INPUT_MESSAGES.phone);
  assert.equal(updated, null, 'nothing was written');
  const ok = await call(updateLandingPage, { params: { id: 'p1' }, body: { ai_content: { ...OLD_PAGE, hero: { title: 'חדש' } } } });
  assert.equal(ok.code, 200, 'PATCH saves an old page with bad stored contact values');
  assert.ok(updated, 'written');
}

// ─── the page title ─────────────────────────────────────────────────────────
assert.equal(buildPageTitle({ seoTitle: 'מאפיית דני | לחם שאור בחיפה', businessName: 'מאפיית דני' }), 'מאפיית דני | לחם שאור בחיפה | Pagey');
assert.equal(buildPageTitle({ businessName: 'מאפיית דני', descriptor: 'לחמים מהתנור' }), 'מאפיית דני | לחמים מהתנור | Pagey');
assert.equal(buildPageTitle({ businessName: 'מאפיית דני' }), `מאפיית דני | ${TITLE_FALLBACK_DESCRIPTOR.he} | Pagey`, 'no descriptor: a fixed one');
assert.equal(buildPageTitle({ businessName: 'מאפיית דני', descriptor: 'מאפיית דני בחיפה' }), `מאפיית דני | ${TITLE_FALLBACK_DESCRIPTOR.he} | Pagey`, 'a descriptor repeating the name is not used');
assert.equal(buildPageTitle({ businessName: 'מאפיית דני', whiteLabel: true }), `מאפיית דני | ${TITLE_FALLBACK_DESCRIPTOR.he}`, 'white-label: no Pagey');
assert.equal(buildPageTitle({ businessName: 'Dani Bakery', lang: 'en' }), 'Dani Bakery | Business page | Pagey');
assert.equal(buildPageTitle({ businessName: 'Boulangerie', lang: 'fr', seoTitle: 'Boulangerie Dani à Haïfa' }), 'Boulangerie Dani à Haïfa | Pagey');
assert.equal(buildPageTitle({}), 'דף נחיתה | Pagey', 'never empty');
assert.equal(buildPageTitle({ businessName: '  ', seoTitle: ' ' }), 'דף נחיתה | Pagey');
assert.equal(buildPageTitle({ businessName: 'QA מאפיית בדיקה' }), `${RLM}QA מאפיית בדיקה | ${TITLE_FALLBACK_DESCRIPTOR.he} | Pagey`, 'Hebrew title that starts in Latin: RLM first');
assert.ok(!buildPageTitle({ businessName: 'QA bakery', lang: 'en' }).startsWith(RLM));
assert.ok(buildPageTitle({ seoTitle: long(200) }).length < 90, 'a long seo_title is cut');
assert.equal(typeof buildPageTitle({ businessName: 'x' }), 'string', 'one string, never an array');

// ─── direction of owner-typed text ──────────────────────────────────────────
assert.equal(textDir('QA מאפיית בדיקה'), 'rtl', 'any Hebrew letter: right-to-left (the browser would guess LTR from "QA")');
assert.equal(textDir("Joe's Pizza"), 'ltr');
assert.equal(textDir('123'), 'auto');
assert.equal(textDir(null), 'auto');
assert.equal(isolate('QA מאפיית בדיקה'), `${RLI}QA מאפיית בדיקה${PDI}`);
assert.equal(isolate('Pizza 4U'), `${LRI}Pizza 4U${PDI}`);
assert.equal(isolate('24/7'), `${FSI}24/7${PDI}`);
assert.equal(isolate(''), '');
assert.equal(stripBidi(`מוכנים להתחיל עם ${isolate('QA מאפיה')}?`), 'מוכנים להתחיל עם QA מאפיה?');

// ─── the server shell: a real <title> and description for every visitor ─────
{
  const PAGE = {
    id: 'pg1', business_name: 'QA מאפיית בדיקה', slug: 'su65m5a', subdomain: null, status: 'published', owner_email: null, parent_id: null, sub_slug: null,
    address: null, phone_number: '0501234567', facebook_url: null, instagram_url: null, logo_url: null, user_images: null,
    ai_content: { seo_title: '', seo_description: 'מאפייה ביתית בחיפה.', services_heading: 'לחמים ועוגות', hero: { title: 'לחם', subtitle: 'x' } },
  };
  (supabase as any).from = (table: string) => {
    const empty = { data: table === 'landing_pages' ? PAGE : null, error: null };
    const q: any = new Proxy(() => undefined, {
      get(_t, k) {
        if (k === 'then') return (res: (v: unknown) => void) => res({ data: [], error: null, count: 0 });
        if (k === 'single' || k === 'maybeSingle') return () => Promise.resolve(empty);
        return () => q;
      },
    });
    return q;
  };
  const err = console.error; console.error = () => undefined;
  const warn = console.warn; console.warn = () => undefined;
  try {
    for (const ua of ['Mozilla/5.0 (Windows NT 10.0) Chrome/130', 'facebookexternalhit/1.1']) {
      const r = await call(servePageWithOgTags, { params: { slug: 'su65m5a' }, headers: { 'user-agent': ua }, get: () => ua });
      const html = String(r.body);
      const titles = html.match(/<title>([^<]*)<\/title>/g) ?? [];
      assert.equal(titles.length, 1, `exactly one <title> (${ua})`);
      assert.equal(titles[0], `<title>${buildPageTitle({ businessName: PAGE.business_name, descriptor: 'לחמים ועוגות' })}</title>`, `the page title (${ua})`);
      assert.ok(html.includes('<meta name="description" content="מאפייה ביתית בחיפה." />'), `meta description (${ua})`);
      assert.equal((html.match(/<meta name="description"/g) ?? []).length, 1, 'one description');
    }
  } finally { console.error = err; console.warn = warn; }
}

// ─── honesty: what the writer may say ───────────────────────────────────────
const thin = { about_business: '', user_provided_text: 'מאפייה' };
const rich = { user_provided_text: 'אנחנו מאפייה משפחתית בחיפה. אופים לחם שאור כל בוקר מקמח מלא, ויש גם עוגות שמרים ועוגיות. פתוח א׳-ה׳ 7:00-14:00, ושישי עד 12:00. אפשר להזמין מראש בוואטסאפ.' };
assert.ok(rich.user_provided_text.length >= FAQ_MIN_OWNER_TEXT);
assert.equal(faqAllowed(thin), false, 'too little owner text: no FAQ');
assert.equal(faqAllowed(rich), true);
assert.match(faqRule(thin), /EMPTY array/);
assert.match(faqRule(rich), /ONLY questions whose answer is written in the input/);
assert.ok(NO_FABRICATION_RULE.includes('קרום פריך') && /ingredients/.test(NO_FABRICATION_RULE), 'product details are in the no-fabrication rule');
const genInput = { business_name: 'QA מאפיית בדיקה', phone_number: '0501234567', vibe: 'מאפייה', image_source: 'none', ...thin };
const trustThin = buildTrustSystem(genInput);
assert.ok(trustThin.includes('faq: return [] (an EMPTY array)'), 'trust prompt asks for no FAQ');
assert.ok(!trustThin.includes('3 to 5 items'), 'the old "3 to 5 FAQ items" rule is gone');
assert.ok(buildTrustSystem({ ...genInput, ...rich }).includes('ONLY questions whose answer is written in the input'));
for (const sys of [buildCoreSystem(genInput), trustThin]) {
  assert.ok(sys.includes('HEBREW SPELLING (CRITICAL)'), 'spelling rule in every writer prompt');
  assert.ok(sys.includes('Never mix alphabets inside one word'));
  assert.ok(sys.includes('קרום פריך'), 'product-detail rule in every writer prompt');
}
assert.ok(buildCoreSystem(genInput).includes('SERVICES RULE'), 'services: only what was named, or general niche words');
{
  const mockThin = await generateAiContent(genInput as any);
  assert.deepEqual(mockThin.faq, [], 'generated page with thin input: no FAQ');
  assert.ok(!(mockThin.layout_composition ?? []).includes('faq_accordion'), 'and no FAQ block');
  const mockRich = await generateAiContent({ ...genInput, ...rich } as any);
  assert.ok((mockRich.faq ?? []).length > 0, 'rich input keeps the FAQ');
  assert.equal((mockRich.testimonials ?? []).length, 0);
  const withQuote = await generateAiContent({ ...genInput, include_testimonials: true, testimonial_quote: 'מעולה' } as any);
  assert.equal(withQuote.testimonials?.[0]?.author, 'מלקוחות העסק', 'no "לקוח/ה" fallback author');
}
assert.deepEqual(enforceFaqGate({ faq: [{ q: 1 }], faq_heading: 'h', layout_composition: ['hero_center', 'faq_accordion'] }, thin),
  { faq: [], faq_heading: undefined, faq_kicker: undefined, layout_composition: ['hero_center'] });

// ─── mixed alphabets ────────────────────────────────────────────────────────
assert.deepEqual(mixedScriptWords('לחם טרי מהתנור'), []);
assert.deepEqual(mixedScriptWords('מצאו אותנו ב-Google ובInstagram'), [], 'a Hebrew prefix on a Latin brand is fine');
assert.deepEqual(mixedScriptWords('QA מאפיית בדיקה, Joe’s Pizza'), [], 'separate words in two alphabets are fine');
assert.deepEqual(mixedScriptWords('לחם טבעוniי'), ['טבעוniי'], 'Latin inside a Hebrew word');
assert.deepEqual(mixedScriptWords('עוגה вкусно'), ['вкусно'], 'Cyrillic on a Hebrew page');
assert.deepEqual(mixedScriptWords('מאפה خبز'), ['خبز'], 'Arabic letters');
assert.ok(hasMixedScript('שירותiם') && !hasMixedScript('') && !hasMixedScript(null));
{
  const { content, dropped, flagged } = lintScripts({
    faq: [{ question: 'איך מזמינים?', answer: 'בוואטסאפ.' }, { question: 'יש משלוחiם?', answer: 'כן' }],
    benefits: [{ title: 'טרי', description: 'כל בוקר' }],
    trust_badges: [{ label: 'вкусно' }, { label: 'שירות מהיר' }],
    hero: { title: 'לחם טרi', hero_image_prompt: 'fresh bread לחם' },
    design_system: { image_keywords: ['bread'] },
  });
  assert.deepEqual(content.faq, [{ question: 'איך מזמינים?', answer: 'בוואטסאפ.' }], 'a mixed FAQ item is dropped');
  assert.deepEqual(content.trust_badges, [{ label: 'שירות מהיר' }]);
  assert.deepEqual(dropped.sort(), ['faq.1', 'trust_badges.0']);
  assert.deepEqual(flagged, ['hero.title'], 'other fields are reported, image prompts are not page copy');
}

console.log('input validation, page title and honesty checks passed');
process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
