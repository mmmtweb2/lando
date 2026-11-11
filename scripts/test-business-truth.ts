// The business card ("כרטיס האמת"): parsing Google's location, merging, the customer's edits,
// readiness, and the sync against a fake Google. No network.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'assert';
import { GbpError, LOCATION_DETAIL_MASK, createLocalPost, fetchLocationDetail, localPostBody } from '../src/services/gbpGoogle';
import { CardInputError, applyEdit, emptyCard, factsText, hoursText, isMobile, landingInputFromCard, line, mergeFromGoogle, parseLocation, readiness } from '../src/services/businessTruth';

const GOOGLE = {
  name: 'locations/123', title: 'אינסטלציה דני',
  phoneNumbers: { primaryPhone: '03-5551234' },
  websiteUri: 'https://dani.example.co.il',
  storefrontAddress: { addressLines: ['הרצל 10'], locality: 'גבעתיים', regionCode: 'IL' },
  categories: {
    primaryCategory: { name: 'categories/gcid:plumber', displayName: 'אינסטלטור', serviceTypes: [{ serviceTypeId: 'job_type_id:fix_leak', displayName: 'תיקון נזילות' }, { serviceTypeId: 'job_type_id:unclog', displayName: 'פתיחת סתימות' }] },
    additionalCategories: [{ displayName: 'שירותי ביוב' }],
  },
  profile: { description: 'אינסטלטור מוסמך בגבעתיים.\nזמינות גם בערב.' },
  serviceItems: [
    { structuredServiceItem: { serviceTypeId: 'job_type_id:fix_leak', description: 'איתור ותיקון' } },
    { structuredServiceItem: { serviceTypeId: 'job_type_id:unknown' } },                    // no display name: skipped
    { freeFormServiceItem: { category: 'categories/gcid:plumber', label: { displayName: 'התקנת דוד שמש', description: '' } } },
    { freeFormServiceItem: { label: { displayName: 'תיקון נזילות' } } },                    // duplicate name
    null,
  ],
  serviceArea: { places: { placeInfos: [{ placeName: 'רמת גן, ישראל' }, { placeName: 'תל אביב-יפו, ישראל' }] } },
  regularHours: { periods: [
    { openDay: 'SUNDAY', openTime: { hours: 8 }, closeDay: 'SUNDAY', closeTime: { hours: 18, minutes: 30 } },
    { openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 18, minutes: 30 } },
    { openDay: 'FRIDAY', openTime: { hours: 8 }, closeDay: 'FRIDAY', closeTime: { hours: 13 } },
    { openDay: 'FUNDAY', openTime: { hours: 8 }, closeTime: { hours: 9 } },                // unknown day
    { openDay: 'TUESDAY', openTime: { hours: 30 }, closeTime: { hours: 9 } },              // bad time
  ] },
  openInfo: { status: 'OPEN' },
  metadata: { placeId: 'ChIJxxx', mapsUri: 'https://maps.google.com/?cid=1', newReviewUri: 'https://search.google.com/local/writereview?placeid=ChIJxxx' },
};

(async () => {
  // ── parsing ──
  const c = parseLocation(GOOGLE);
  assert.equal(c.name, 'אינסטלציה דני');
  assert.equal(c.phone, '03-5551234');
  assert.equal(c.city, 'גבעתיים');
  assert.equal(c.address, 'הרצל 10, גבעתיים');
  assert.equal(c.category, 'אינסטלטור');
  assert.deepEqual(c.categories, ['שירותי ביוב']);
  assert.deepEqual(c.services.map((s) => s.name), ['תיקון נזילות', 'התקנת דוד שמש'], 'structured ids resolved through the category, unknown and duplicate dropped');
  assert.equal(c.services[0].description, 'איתור ותיקון');
  assert.ok(c.services.every((s) => s.source === 'google'));
  assert.deepEqual(c.areas, ['רמת גן', 'תל אביב-יפו', 'גבעתיים'], 'country suffix removed, the city added');
  assert.deepEqual(c.hours.map((h) => `${h.day} ${h.open}-${h.close}`), ['SUNDAY 08:00-18:30', 'MONDAY 08:00-18:30', 'FRIDAY 08:00-13:00']);
  assert.equal(hoursText(c.hours), 'ראשון, שני: 08:00-18:30; שישי: 08:00-13:00');
  assert.ok(c.description.includes('\n'), 'the description keeps its line break');
  assert.ok(c.reviewUrl.startsWith('https://search.google.com/'));
  assert.equal(c.open, true);
  assert.deepEqual(parseLocation(null), emptyCard());
  assert.deepEqual(parseLocation('x'), emptyCard());
  assert.equal(parseLocation({ openInfo: { status: 'CLOSED_TEMPORARILY' } }).open, false);
  assert.equal(parseLocation({ websiteUri: 'javascript:alert(1)' }).website, '', 'only http(s) links are kept');
  assert.equal(line('a‮b\u0000c  d', 50), 'a b c d', 'control and bidi-override characters never survive');

  // ── readiness ──
  const r = readiness(c);
  assert.equal(r.ready, true);
  assert.equal(r.checks.find((k) => k.key === 'services')!.state, 'weak', 'two services: usable, but we ask for more');
  assert.equal(r.checks.find((k) => k.key === 'notes')!.state, 'missing');
  assert.equal(readiness(emptyCard()).ready, false, 'an empty card cannot start');
  assert.equal(readiness({ ...c, phone: '' }).ready, false, 'no phone: required');
  assert.equal(readiness({ ...c, services: [] }).ready, false, 'no services: nothing true to write about');
  assert.equal(readiness({ ...c, open: false }).ready, false, 'a business Google marks closed');
  assert.equal(readiness({ ...c, website: '', hours: [] }).ready, true, 'website and hours are not required');

  // ── the customer's edit ──
  const e = applyEdit(c, { services: ['תיקון נזילות', { name: 'החלפת ברזים', description: 'כולל אספקה' }, 'החלפת ברזים'], areas: ['בני ברק'], notes: 'מגיעים תוך שעה בגבעתיים.', phone: '050-1234567' });
  assert.deepEqual(e.services.map((s) => `${s.name}:${s.source}`), ['תיקון נזילות:customer', 'החלפת ברזים:customer'], 'duplicate dropped; an item whose text changed becomes the customer\'s');
  assert.equal(applyEdit(c, { services: [{ name: 'תיקון נזילות', description: 'איתור ותיקון' }] }).services[0].source, 'google', 'an untouched Google item stays Google\'s');
  assert.deepEqual(e.areas, ['בני ברק']);
  assert.equal(e.name, c.name, 'the name is not editable here');
  assert.equal(applyEdit(c, { name: 'שם אחר', category: 'x' }).name, c.name);
  for (const [field, bad] of Object.entries({
    phone: { phone: 'call me' }, website: { website: 'ftp://x' }, services: { services: ['https://spam.example'] }, areas: { areas: ['a'] },
    hours: { hours: [{ day: 'SUNDAY', open: '8', close: '17:00' }] }, description: { description: 7 }, notes: { notes: 'x'.repeat(5000) },
  })) {
    assert.throws(() => applyEdit(c, bad), (err: unknown) => err instanceof CardInputError && err.field === field, `bad ${field} is refused, not silently dropped`);
  }
  assert.throws(() => applyEdit(c, { services: new Array(21).fill('שירות') }), CardInputError);
  assert.throws(() => applyEdit(c, null), CardInputError);

  // ── a fresh read from Google over an edited card ──
  const fresh = parseLocation({ ...GOOGLE, profile: {}, phoneNumbers: {}, regularHours: {} });
  const m = mergeFromGoogle(e, fresh);
  assert.ok(m.services.some((s) => s.name === 'החלפת ברזים' && s.source === 'customer'), 'the customer\'s own service survives a sync');
  assert.ok(m.areas.includes('בני ברק') && m.areas.includes('רמת גן'));
  assert.equal(m.notes, 'מגיעים תוך שעה בגבעתיים.');
  assert.equal(m.phone, '050-1234567', 'Google has no phone now: ours is kept');
  assert.equal(m.description, c.description, 'an empty Google description does not erase ours');
  assert.equal(m.hours.length, 3);
  assert.deepEqual(mergeFromGoogle(null, fresh), fresh);

  // ── facts for the writers ──
  const facts = factsText(e);
  assert.ok(facts.includes('תיקון נזילות') && facts.includes('בני ברק') && facts.includes('050-1234567'));
  assert.ok(!facts.includes('undefined') && !facts.includes('false'));
  assert.equal(factsText(emptyCard()), '');

  // ── a landing page from the card ──
  const li = landingInputFromCard(e);
  assert.equal(li.business_name, 'אינסטלציה דני');
  assert.equal(li.phone_number, '0501234567');
  assert.equal(li.cta_type, 'whatsapp', 'a mobile number: WhatsApp');
  assert.equal(landingInputFromCard(c).cta_type, 'phone', 'a landline: a call button');
  assert.ok(isMobile('+972-50-123-4567') && !isMobile('03-5551234') && !isMobile(''));
  assert.equal(li.vibe, 'אינסטלטור, שירותי ביוב');
  assert.ok(li.user_provided_text.includes('- החלפת ברזים: כולל אספקה') && li.user_provided_text.includes('אזורי שירות: בני ברק'));
  assert.ok(li.about_business.includes('אינסטלטור מוסמך') && li.about_business.includes('מגיעים תוך שעה'));
  assert.equal(li.business_hours.split('\n')[0], 'יום ראשון: 08:00–18:30');
  assert.deepEqual([li.image_source, li.enable_form, li.page_goal], ['stock', 'true', 'lead_gen']);

  // ── Google calls (fake fetch) ──
  const calls: Array<{ url: string; init?: any }> = [];
  const mk = (status: number, body: unknown) => (async (url: any, init?: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const raw = await fetchLocationDetail('AT', 'locations/123', mk(200, GOOGLE));
  assert.equal(raw.title, 'אינסטלציה דני');
  assert.equal(calls[0].url, `https://mybusinessbusinessinformation.googleapis.com/v1/locations/123?readMask=${LOCATION_DETAIL_MASK}`);
  assert.equal(calls[0].init.headers.authorization, 'Bearer AT');
  await assert.rejects(fetchLocationDetail('AT', 'locations/1/../2', mk(200, {})), GbpError);
  await assert.rejects(fetchLocationDetail('AT', 'locations/123', mk(401, {})), (err: unknown) => err instanceof GbpError && err.code === 'revoked');
  await assert.rejects(fetchLocationDetail('AT', 'locations/123', mk(429, { error: { status: 'RESOURCE_EXHAUSTED' } })), /http_429/);

  // ── publishing a post ──
  assert.deepEqual(localPostBody({ summary: 'x', cta: 'CALL', url: 'https://a.co' }), { languageCode: 'he', topicType: 'STANDARD', summary: 'x', callToAction: { actionType: 'CALL' } }, 'a call button carries no url');
  assert.deepEqual(localPostBody({ summary: 'x', cta: 'LEARN_MORE', url: 'http://a.co' }).callToAction, undefined, 'a non-https link is dropped');
  assert.deepEqual(localPostBody({ summary: 'x', cta: 'LEARN_MORE', url: 'https://a.co/p' }).callToAction, { actionType: 'LEARN_MORE', url: 'https://a.co/p' });
  calls.length = 0;
  const text = 'פוסט לדוגמה על תיקון נזילות אצל אינסטלציה דני בגבעתיים.';
  const made = await createLocalPost('AT', 'accounts/1', 'locations/123', { summary: `  ${text}  `, cta: 'CALL' }, mk(200, { name: 'accounts/1/locations/123/localPosts/9', state: 'LIVE' }));
  assert.deepEqual(made, { name: 'accounts/1/locations/123/localPosts/9', state: 'LIVE' });
  assert.equal(calls[0].url, 'https://mybusiness.googleapis.com/v4/accounts/1/locations/123/localPosts');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).summary, text, 'trimmed');
  await assert.rejects(createLocalPost('AT', 'accounts/1', 'locations/123', { summary: 'קצר' }, mk(200, {})), /bad_post_text/);
  await assert.rejects(createLocalPost('AT', 'accounts/1', 'locations/123', { summary: 'א'.repeat(1501) }, mk(200, {})), /bad_post_text/);
  await assert.rejects(createLocalPost('AT', 'x', 'locations/123', { summary: text }, mk(200, {})), /bad_location/);
  await assert.rejects(createLocalPost('AT', 'accounts/1', 'locations/123', { summary: text }, mk(429, { error: { status: 'RESOURCE_EXHAUSTED' } })), /post:http_429:RESOURCE_EXHAUSTED/);
  await assert.rejects(createLocalPost('AT', 'accounts/1', 'locations/123', { summary: text }, mk(401, {})), (err: unknown) => err instanceof GbpError && err.code === 'revoked');

  console.log('business truth: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
