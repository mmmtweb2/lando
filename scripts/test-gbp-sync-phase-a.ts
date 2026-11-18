// Phase A of the Google listing sync (docs/gbp-sync-spec.md): service areas, yes/no attributes and the
// Israeli holiday suggestions. No network, no database: Google and storage are fakes.
// Run: npx tsx scripts/test-gbp-sync-phase-a.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'assert';
import { CardInputError, emptyCard, parseLocation, type TruthCard } from '../src/services/businessTruth';
import {
  GbpError, GbpQuota, GbpRejected, WRITABLE_MASKS, fetchAttributes, getGoogleUpdated, listAttributeMetadata, patchAttributes, patchLocation,
} from '../src/services/gbpGoogle';
import {
  adoptAttributes, applyAttributes, buildAttributesPatch, onlyKnown, parseAttributeMetadata, parseAttributes, sameAttributes, takeGoogleAttributes,
} from '../src/services/gbpAttributes';
import {
  applyServiceArea, areaValue, findRegion, resolveMissing, sameAreas, serviceAreaPatch,
} from '../src/services/gbpServiceArea';
import { HOLIDAYS, HOLIDAYS_TABLE_FROM, HOLIDAYS_TABLE_TO, HOLIDAY_WINDOW_DAYS, suggestHolidays } from '../src/services/israeliHolidays';
import {
  adoptChanges, applyField, attributesView, buildPatch, emptyState, fieldStatus, fieldValue, isProfileField, isSyncField, readState, sameField, seedNewFields, type GoogleState,
} from '../src/services/gbpSync';
import {
  type SyncDeps, type ProfileSweepDeps, SyncError, getProfile, resolveField, saveAttributes, saveField, sweepProfiles,
} from '../src/services/gbpSync.service';
import { addHolidayRows, pendingHolidays, usuallyClosed, MAX_SPECIAL_DAYS } from '../client/src/dashboard/v3/autopilot/holidays';
import { AREA_OPTIONS } from '../client/src/dashboard/v3/autopilot/serviceAreaOptions';
import { AREA, ATTRS, FIELD_HINT, FIELD_LABEL, HOLIDAYS as HOLIDAY_COPY } from '../client/src/dashboard/v3/autopilot/profileCopy';
import { FIELD_KEYS } from '../client/src/dashboard/v3/autopilot/profileTypes';

const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { url: string; init?: any };
function fakeFetch(...answers: Response[]) {
  const calls: Call[] = [];
  const f = (async (url: any, init?: any) => { calls.push({ url: String(url), init }); return answers.shift() ?? resp(200, {}); }) as typeof fetch;
  return { f, calls };
}
const noSleep = { sleep: async () => undefined, random: () => 0 };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const HAIFA = 'ChIJ_haifa_000001', NESHER = 'ChIJ_nesher_00001', ACRE = 'ChIJ_acre_0000001';
const WC = 'attributes/has_wheelchair_accessible_entrance', CC = 'attributes/pay_credit_card', NFC = 'attributes/pay_mobile_nfc', WIFI = 'attributes/wi_fi', MENU = 'attributes/url_menu';

// A Google listing as the Business Information API returns it, with a service area.
const RAW: Record<string, any> = {
  name: 'locations/123', title: 'אינסטלציה דני',
  phoneNumbers: { primaryPhone: '03-5551234' },
  categories: { primaryCategory: { name: 'categories/gcid:plumber', displayName: 'אינסטלטור' } },
  storefrontAddress: { addressLines: ['הרצל 1'], locality: 'חיפה' },
  profile: { description: 'אינסטלטור מוסמך.' },
  regularHours: { periods: [{ openDay: 'SUNDAY', openTime: { hours: 8 }, closeDay: 'SUNDAY', closeTime: { hours: 18 } }] },
  serviceArea: { businessType: 'CUSTOMER_AND_BUSINESS_LOCATION', places: { placeInfos: [{ placeName: 'חיפה, ישראל', placeId: HAIFA }, { placeName: 'נשר', placeId: NESHER }] } },
  metadata: { mapsUri: 'https://maps.google.com/?cid=1', newReviewUri: 'https://g.page/r/x' },
};
// What exists for the category: only the BOOL ones may show.
const META_RAW = [
  { parent: WC, valueType: 'BOOL', displayName: 'כניסה נגישה לכיסא גלגלים', groupDisplayName: 'נגישות' },
  { parent: CC, valueType: 'BOOL', displayName: 'כרטיסי אשראי', groupDisplayName: 'תשלומים' },
  { parent: NFC, valueType: 'BOOL', displayName: 'תשלום בנייד', groupDisplayName: 'תשלומים' },
  { parent: WIFI, valueType: 'ENUM', displayName: 'Wi-Fi', valueMetadata: [{ value: 'FREE_WI_FI', displayName: 'חינם' }] },
  { parent: MENU, valueType: 'URL', displayName: 'קישור לתפריט' },
  { parent: 'attributes/amenities', valueType: 'REPEATED_ENUM', repeatable: true, displayName: 'שירותים' },
  { parent: 'attributes/old_thing', valueType: 'BOOL', displayName: 'ישן', deprecated: true },
  { parent: 'attributes/no_name', valueType: 'BOOL' },
  { parent: 'attributes/bad name!', valueType: 'BOOL', displayName: 'שם לא תקין' },
  { parent: 'attributes/repeat_bool', valueType: 'BOOL', repeatable: true, displayName: 'חוזר' },
];
const ATTR_RAW = {
  name: 'locations/123/attributes',
  attributes: [
    { name: WC, valueType: 'BOOL', values: [true] },
    { name: CC, valueType: 'BOOL', values: [false] },
    { name: WIFI, valueType: 'ENUM', values: ['FREE_WI_FI'] },
    { name: MENU, valueType: 'URL', uriValues: [{ uri: 'https://x.co/menu' }] },
    { name: 'attributes/two', valueType: 'BOOL', values: [true, false] },
    { name: 'attributes/str', valueType: 'BOOL', values: ['true'] },
  ],
};

(async () => {
  // ── Holidays: the table and the suggestions ─────────────────────────────────
  {
    const names = new Set(HOLIDAYS.map((h) => h.name));
    for (const n of ['ראש השנה', 'יום כיפור', 'סוכות', 'שמחת תורה', 'פסח', 'שביעי של פסח', 'יום העצמאות', 'שבועות']) assert.ok(names.has(n), `${n} is in the table`);
    assert.ok(![...names].some((n) => /חנוכה|פורים/.test(n)), 'Hanukkah and Purim are not closure days');
    for (const y of ['2026', '2027', '2028']) assert.equal(HOLIDAYS.filter((h) => h.date.startsWith(y)).length, 9, `${y}: 9 closure days (Rosh Hashana has two)`);
    assert.ok(HOLIDAYS.every((h) => h.date >= HOLIDAYS_TABLE_FROM && h.date <= HOLIDAYS_TABLE_TO));
    assert.equal(new Set(HOLIDAYS.map((h) => h.date)).size, HOLIDAYS.length, 'no two holidays on one day');

    // every date really is that day of the Hebrew calendar (ICU), independently of how the table was made
    const fmt = new Intl.DateTimeFormat('en-u-ca-hebrew-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const heb = (iso: string) => { const p = Object.fromEntries(fmt.formatToParts(new Date(`${iso}T00:00:00Z`)).map((x) => [x.type, x.value])); return `${p.month} ${p.day}`; };
    const want: Record<string, string[]> = {
      pesach: ['Nisan 15'], pesach7: ['Nisan 21'], shavuot: ['Sivan 6'], rosh1: ['Tishri 1'], rosh2: ['Tishri 2'], yomkippur: ['Tishri 10'],
      sukkot: ['Tishri 15'], simchat: ['Tishri 22'], independence: ['Iyar 3', 'Iyar 4', 'Iyar 5', 'Iyar 6'],
    };
    for (const h of HOLIDAYS) assert.ok(want[h.id].includes(heb(h.date)), `${h.id} ${h.date} is ${heb(h.date)}`);
    // Independence Day: 5 Iyar, moved off Friday/Saturday to Thursday and off Monday to Tuesday
    const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
    for (const h of HOLIDAYS.filter((x) => x.id === 'independence')) assert.ok(![5, 6].includes(dow(h.date)), `${h.date}: not on Friday or Saturday`);
    assert.equal(HOLIDAYS.find((h) => h.id === 'independence' && h.date.startsWith('2028'))!.date, '2028-05-02', '5 Iyar 2028 is a Monday: moved to Tuesday');
    assert.equal(HOLIDAYS.find((h) => h.id === 'pesach' && h.date.startsWith('2027'))!.date, '2027-04-22');

    // suggestions: the next ~120 days from "now", today included, in order
    const s = suggestHolidays(new Date('2027-03-22T09:00:00Z'));
    assert.deepEqual(s.map((x) => x.date), ['2027-04-22', '2027-04-28', '2027-05-12', '2027-06-11'], 'Pesach, its seventh day, Independence Day, Shavuot');
    assert.deepEqual(s.map((x) => x.name), ['פסח', 'שביעי של פסח', 'יום העצמאות', 'שבועות']);
    assert.equal(HOLIDAY_WINDOW_DAYS, 120);
    // the window edges: today is in, yesterday is out; day 120 is in, day 121 is out
    assert.deepEqual(suggestHolidays(new Date('2027-06-11T08:00:00Z'), [], 0).map((x) => x.date), ['2027-06-11'], 'today counts');
    assert.deepEqual(suggestHolidays(new Date('2027-06-12T08:00:00Z'), [], 0).map((x) => x.date), [], 'yesterday does not');
    const rosh = (from: string) => suggestHolidays(new Date(`${from}T08:00:00Z`)).map((x) => x.date).filter((d) => d === '2027-10-02' || d === '2027-10-03');
    assert.deepEqual(rosh('2027-06-03'), [], '2 Oct is 121 days away: out');
    assert.deepEqual(rosh('2027-06-04'), ['2027-10-02'], '2 Oct is 120 days away: in; 3 Oct is 121: out');
    assert.deepEqual(rosh('2027-06-05'), ['2027-10-02', '2027-10-03'], '119 and 120 days: both in');
    // a day the owner already has is not offered again
    assert.deepEqual(suggestHolidays(new Date('2027-03-22T09:00:00Z'), ['2027-04-22']).map((x) => x.date), ['2027-04-28', '2027-05-12', '2027-06-11']);
    // today (18.11.2026) there is none within 120 days; after the table ends there are none either
    assert.deepEqual(suggestHolidays(new Date('2026-11-18T09:00:00Z')), []);
    assert.deepEqual(suggestHolidays(new Date('2029-01-01T00:00:00Z')), []);
    assert.deepEqual(suggestHolidays(new Date('2026-08-20T00:00:00Z')).map((x) => x.name), ['ראש השנה', 'ראש השנה (יום שני)', 'יום כיפור', 'סוכות', 'שמחת תורה'], 'the autumn holidays of 2026, in order');

    // the client helper: closed rows, only for days not there, sorted, never saved by itself
    const cur = [{ date: '2027-05-12', closed: false, open: '09:00', close: '13:00' }];
    const picks = s;
    assert.deepEqual(pendingHolidays(picks, cur).map((x) => x.date), ['2027-04-22', '2027-04-28', '2027-06-11'], 'a day already in the list is not offered');
    const rows = addHolidayRows(cur, picks);
    assert.deepEqual(rows.map((r) => r.date), ['2027-04-22', '2027-04-28', '2027-05-12', '2027-06-11']);
    assert.deepEqual(rows[2], cur[0], 'an existing row is left as it is (the owner set hours that day)');
    assert.ok(rows.filter((r) => r.date !== '2027-05-12').every((r) => r.closed && r.open === '' && r.close === ''), 'added as closed');
    assert.deepEqual(addHolidayRows(rows, picks), rows, 'adding twice changes nothing');
    assert.equal(addHolidayRows([{ date: '', closed: true, open: '', close: '' }], [picks[0]])[1].date, '', 'a row still being filled in stays last');
    const full = Array.from({ length: MAX_SPECIAL_DAYS }, (_, i) => ({ date: `2030-01-${String(i + 1).padStart(2, '0')}`, closed: true, open: '', close: '' }));
    assert.equal(addHolidayRows(full, picks).length, MAX_SPECIAL_DAYS, 'the cap of 40 days holds');
    // a holiday on a day the business is closed anyway is said so
    assert.equal(usuallyClosed('2026-09-12', [{ day: 'SUNDAY', open: '08:00', close: '18:00' }]), true, 'Saturday, open only on Sunday');
    assert.equal(usuallyClosed('2027-04-22', [{ day: 'THURSDAY', open: '08:00', close: '18:00' }]), false);
    assert.equal(usuallyClosed('2027-04-22', []), false, 'no regular hours: nothing to say');
    // and the suggestion saved as special hours is accepted by the existing rules (closed, no hours)
    const card = applyField(parseLocation(RAW), 'specialHours', rows);
    assert.equal(card.specialHours.length, 4);
    assert.deepEqual((buildPatch('specialHours', card, RAW)!.body as any).specialHours.specialHourPeriods[0], { startDate: { year: 2027, month: 4, day: 22 }, endDate: { year: 2027, month: 4, day: 22 }, closed: true });
  }

  // ── Service area: reading, validating, the PATCH ────────────────────────────
  const base: TruthCard = parseLocation(RAW);
  {
    assert.deepEqual(base.serviceArea, { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: [{ name: 'חיפה', placeId: HAIFA }, { name: 'נשר', placeId: NESHER }] }, 'read with the Place IDs, ", ישראל" dropped');
    assert.deepEqual(parseLocation({ ...RAW, serviceArea: undefined }).serviceArea, { type: null, places: [] });
    assert.deepEqual(parseLocation({ ...RAW, serviceArea: { businessType: 'WHATEVER', places: { placeInfos: [{ placeName: 'עכו', placeId: 'x y' }, {}, { placeName: 'עכו' }] } } }).serviceArea, { type: null, places: [{ name: 'עכו', placeId: '' }] }, 'a bad type and a bad id are not trusted; the same name twice is one');
    assert.deepEqual(areaValue(base.serviceArea), { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: ['חיפה', 'נשר'] });
    assert.ok(emptyCard().serviceArea === undefined && emptyCard().attributes === undefined, 'a card saved before phase A has neither');

    // validation
    assert.throws(() => applyServiceArea(base, { places: [] }), /bad_serviceArea/, 'never empty: an empty list never clears Google');
    assert.throws(() => applyServiceArea(base, { places: 'חיפה' }), /bad_serviceArea/);
    assert.throws(() => applyServiceArea(base, { places: ['חיפה', 'a'] }), /bad_serviceArea/, 'too short');
    assert.throws(() => applyServiceArea(base, { places: ['https://evil.co'] }), /bad_serviceArea/, 'no links');
    assert.throws(() => applyServiceArea(base, { places: ['050-1234567'] }), /bad_serviceArea/, 'no phone numbers');
    assert.throws(() => applyServiceArea(base, { places: Array.from({ length: 21 }, (_, i) => `עיר מספר ${i}x`) }), /bad_serviceArea/, 'at most 20');
    assert.equal(applyServiceArea(base, { places: Array.from({ length: 20 }, (_, i) => `עיר מספר ${i}x`) }).serviceArea!.places.length, 20);
    const next = applyServiceArea(base, { places: ['חיפה', ' חיפה ', 'עכו', 'נשר'] });
    assert.deepEqual(next.serviceArea!.places, [{ name: 'חיפה', placeId: HAIFA }, { name: 'עכו', placeId: '' }, { name: 'נשר', placeId: NESHER }], 'known names keep their Place ID, a new one has none yet, duplicates collapse');
    assert.equal(next.serviceArea!.type, 'CUSTOMER_AND_BUSINESS_LOCATION', 'the kind is carried, never chosen here');
    assert.deepEqual(applyField(base, 'serviceArea', ['חיפה']).serviceArea!.places, [{ name: 'חיפה', placeId: HAIFA }], 'a plain list of names works too');
    assert.ok(isSyncField('serviceArea') && !isSyncField('attributes') && isProfileField('attributes') && !isProfileField('title') && !isProfileField('storefrontAddress'));

    // resolving: Google's own list first, then the lookup; a name that cannot be found stops the save
    const looked: string[] = [];
    const found = async (n: string) => { looked.push(n); return n === 'עכו' ? { name: n, placeId: ACRE } : null; };
    const resolved = await resolveMissing(next, base, found);
    assert.deepEqual(resolved.serviceArea!.places.map((p) => p.placeId), [HAIFA, ACRE, NESHER]);
    assert.deepEqual(looked, ['עכו'], 'only the new name is looked up');
    const viaGoogle = await resolveMissing(applyServiceArea(base, { places: ['חיפה', 'נשר', 'עכו'] }), { ...base, serviceArea: { type: null, places: [...base.serviceArea!.places, { name: 'עכו', placeId: ACRE }] } }, async () => { throw new Error('must not look up'); });
    assert.ok(viaGoogle.serviceArea!.places.some((p) => p.placeId === ACRE), 'a name Google already lists for the listing is not looked up');
    await assert.rejects(resolveMissing(applyServiceArea(base, { places: ['חיפה', 'עיר שלא קיימת'] }), base, found), (e: unknown) => e instanceof CardInputError && e.field === 'serviceAreaPlace:עיר שלא קיימת');

    // the PATCH: only the regions, the kind as Google holds it, never the address
    const p = serviceAreaPatch(resolved, RAW)!;
    assert.deepEqual(p.mask, ['serviceArea']);
    assert.deepEqual(p.body, { serviceArea: { businessType: 'CUSTOMER_AND_BUSINESS_LOCATION', places: { placeInfos: [{ placeName: 'חיפה', placeId: HAIFA }, { placeName: 'עכו', placeId: ACRE }, { placeName: 'נשר', placeId: NESHER }] } } });
    assert.ok(!('storefrontAddress' in p.body) && !JSON.stringify(p.body).includes('הרצל'), 'the business address is never in the body');
    const hidden = serviceAreaPatch(resolved, { ...RAW, serviceArea: { ...RAW.serviceArea, businessType: 'CUSTOMER_LOCATION_ONLY', regionCode: 'IL' } })!;
    assert.equal((hidden.body as any).serviceArea.businessType, 'CUSTOMER_LOCATION_ONLY', 'a listing that hides its address keeps hiding it');
    assert.equal((hidden.body as any).serviceArea.regionCode, 'IL');
    assert.equal((serviceAreaPatch(resolved, { ...RAW, serviceArea: undefined })!.body as any).serviceArea.businessType, 'CUSTOMER_AND_BUSINESS_LOCATION', 'no kind yet + has a street address');
    assert.equal((serviceAreaPatch(resolved, { ...RAW, serviceArea: undefined, storefrontAddress: undefined })!.body as any).serviceArea.businessType, 'CUSTOMER_LOCATION_ONLY', 'no kind yet + no street address');
    assert.equal(serviceAreaPatch({ ...resolved, serviceArea: { type: null, places: [] } }, RAW), null, 'an empty list sends nothing');
    assert.throws(() => serviceAreaPatch(next, RAW), /bad_serviceAreaPlace/, 'a region without a Place ID is never sent');
    assert.equal(buildPatch('serviceArea', resolved, RAW)!.mask[0], 'serviceArea');

    // comparing
    assert.ok(sameAreas([{ name: 'חיפה', placeId: HAIFA }], [{ name: 'Haifa', placeId: HAIFA }]), 'same Place ID, different spelling');
    assert.ok(sameAreas([{ name: 'חיפה', placeId: '' }, { name: 'נשר', placeId: NESHER }], base.serviceArea!.places), 'no id on our side: by name, any order');
    assert.ok(!sameAreas(base.serviceArea!.places, resolved.serviceArea!.places));
    assert.ok(sameField('serviceArea', base, parseLocation(RAW)));
    assert.ok(!sameField('serviceArea', resolved, base));
    assert.ok(sameField('serviceArea', { ...base, serviceArea: undefined }, { ...base, serviceArea: { type: null, places: [] } }), 'absent = empty');

    // status model, same as the other fields
    const st: GoogleState = { ...emptyState(), google: base, checkedAt: '2026-11-17T00:00:00Z' };
    assert.equal(fieldStatus('serviceArea', base, st, true).status, 'live');
    assert.equal(fieldStatus('serviceArea', resolved, st, true).status, 'google_changed');
    assert.equal(fieldStatus('serviceArea', resolved, st, false).status, 'local_only', 'sync off');
    assert.equal(fieldStatus('serviceArea', resolved, { ...st, pendingMask: ['serviceArea'] }, true).status, 'pending');
    const bad = fieldStatus('serviceArea', resolved, { ...st, errors: { serviceArea: 'Invalid place' } }, true);
    assert.equal(bad.status, 'local_only'); assert.equal(bad.error, 'Invalid place');
    assert.deepEqual(fieldValue('serviceArea', resolved), { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: ['חיפה', 'עכו', 'נשר'] });

    // weekly adoption: Google gained a region; and the first read seeds a card saved before phase A
    const nextG: TruthCard = { ...base, serviceArea: { type: base.serviceArea!.type, places: [...base.serviceArea!.places, { name: 'עכו', placeId: ACRE }] } };
    const ad = adoptChanges(base, base, nextG);
    assert.deepEqual(ad.adopted, ['serviceArea']); assert.equal(ad.card.serviceArea!.places.length, 3);
    assert.deepEqual(adoptChanges({ ...base, serviceArea: applyServiceArea(base, { places: ['חיפה'] }).serviceArea }, base, nextG).adopted, [], 'we changed it ourselves: kept');
    const seeded = seedNewFields({ ...base, serviceArea: undefined, attributes: undefined }, { ...base, attributes: { [WC]: true } });
    assert.ok(seeded.changed); assert.deepEqual(seeded.card.serviceArea, base.serviceArea); assert.deepEqual(seeded.card.attributes, { [WC]: true });
    assert.ok(!seedNewFields(base, base).changed, 'nothing to seed when ours has the fields');
    assert.deepEqual(seedNewFields({ ...base, serviceArea: undefined }, { ...base, attributes: undefined }).card.attributes, undefined, 'attributes are seeded only once they were read');
  }

  // ── Places lookup ───────────────────────────────────────────────────────────
  {
    const ok = fakeFetch(resp(200, { places: [{ id: 'ChIJ_wrong_poi_001', displayName: { text: 'מסעדה' }, types: ['restaurant'] }, { id: ACRE, displayName: { text: 'עכו' }, types: ['locality', 'political'] }] }));
    assert.deepEqual(await findRegion('עכו', ok.f, 'KEY'), { name: 'עכו', placeId: ACRE }, 'the first result that is a region, not a restaurant');
    assert.equal(ok.calls[0].url, 'https://places.googleapis.com/v1/places:searchText');
    assert.equal(ok.calls[0].init.headers['x-goog-api-key'], 'KEY');
    assert.equal(ok.calls[0].init.headers['x-goog-fieldmask'], 'places.id,places.displayName,places.types', 'a minimal field mask');
    assert.equal(JSON.parse(ok.calls[0].init.body).regionCode, 'IL');
    assert.equal(await findRegion('עכו', fakeFetch().f, ''), null, 'no key: nothing is sent');
    assert.equal(await findRegion('x', fakeFetch().f, 'KEY'), null, 'too short');
    assert.equal(await findRegion('עכו', fakeFetch(resp(500)).f, 'KEY'), null);
    assert.equal(await findRegion('עכו', fakeFetch(resp(200, { places: [{ id: 'ChIJ_wrong_poi_001', types: ['store'] }] })).f, 'KEY'), null);
    assert.equal(await findRegion('עכו', (async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'KEY'), null, 'a network failure is "not found", never a throw');
  }

  // ── Google client: masks, attributes ────────────────────────────────────────
  {
    assert.ok((WRITABLE_MASKS as readonly string[]).includes('serviceArea'));
    for (const m of ['storefrontAddress', 'title', 'categories', 'openInfo', 'serviceArea,storefrontAddress']) {
      await assert.rejects(patchLocation('AT', 'locations/123', {}, [m], fakeFetch().f), /bad_mask/, `${m} is never written`);
    }
    let g = fakeFetch(resp(200));
    await patchLocation('AT', 'locations/123', { serviceArea: {} }, ['serviceArea'], g.f, { validateOnly: true });
    assert.equal(g.calls[0].url, 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/123?updateMask=serviceArea&validateOnly=true');
    g = fakeFetch(resp(200, { diffMask: 'serviceArea', pendingMask: '' }));
    assert.deepEqual(await getGoogleUpdated('AT', 'locations/123', g.f), { diffMask: ['serviceArea'], pendingMask: [] });
    assert.ok(g.calls[0].url.includes('serviceArea'), 'the review state of the service area is asked for');

    // what exists / what is set
    assert.deepEqual(parseAttributeMetadata(META_RAW), [
      { name: WC, label: 'כניסה נגישה לכיסא גלגלים', group: 'נגישות' },
      { name: CC, label: 'כרטיסי אשראי', group: 'תשלומים' },
      { name: NFC, label: 'תשלום בנייד', group: 'תשלומים' },
    ], 'only BOOL: enum, URL, repeated, deprecated, nameless and badly named ones are skipped');
    assert.deepEqual(parseAttributeMetadata([{ name: WC, valueType: 'BOOL', displayName: 'x' }]).map((m) => m.name), [WC], '`name` is accepted as well as `parent`');
    assert.deepEqual(parseAttributeMetadata(null), []);
    assert.deepEqual(parseAttributes(ATTR_RAW), { [WC]: true, [CC]: false }, 'only single true/false values of BOOL attributes');
    assert.deepEqual(parseAttributes(null), {});
    assert.deepEqual(onlyKnown({ [WC]: true, [WIFI as string]: true }, parseAttributeMetadata(META_RAW)), { [WC]: true });

    g = fakeFetch(resp(200, ATTR_RAW));
    assert.deepEqual(parseAttributes(await fetchAttributes('AT', 'locations/123', g.f)), { [WC]: true, [CC]: false });
    assert.equal(g.calls[0].url, 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/123/attributes');
    g = fakeFetch(resp(200, { attributeMetadata: META_RAW.slice(0, 2), nextPageToken: 'P2' }), resp(200, { attributeMetadata: META_RAW.slice(2, 3) }));
    assert.equal((await listAttributeMetadata('AT', 'categories/gcid:plumber', g.f)).length, 3, 'follows the next page');
    const q = new URL(g.calls[0].url);
    assert.equal(q.pathname, '/v1/attributes');
    assert.equal(q.searchParams.get('categoryName'), 'categories/gcid:plumber');
    assert.equal(q.searchParams.get('regionCode'), 'IL'); assert.equal(q.searchParams.get('languageCode'), 'he');
    assert.equal(new URL(g.calls[1].url).searchParams.get('pageToken'), 'P2');
    await assert.rejects(listAttributeMetadata('AT', 'plumber', fakeFetch().f), /bad_category/);
    await assert.rejects(fetchAttributes('AT', 'accounts/1', fakeFetch().f), /bad_location/);

    // writing: one call, an attributeMask of exactly the names sent, booleans only
    const body = { attributes: [{ name: CC, valueType: 'BOOL', values: [true] }, { name: WC, valueType: 'BOOL', values: [false] }] };
    g = fakeFetch(resp(200, {}));
    await patchAttributes('AT', 'locations/123', [CC, WC], body, g.f);
    assert.equal(g.calls[0].init.method, 'PATCH');
    assert.equal(g.calls[0].url, `https://mybusinessbusinessinformation.googleapis.com/v1/locations/123/attributes?attributeMask=${encodeURIComponent(CC)},${encodeURIComponent(WC)}`);
    assert.deepEqual(JSON.parse(g.calls[0].init.body), { name: 'locations/123/attributes', attributes: body.attributes });
    await assert.rejects(patchAttributes('AT', 'locations/123', [CC], body, fakeFetch().f), /bad_mask/, 'the mask must be exactly what is sent');
    await assert.rejects(patchAttributes('AT', 'locations/123', [], { attributes: [] }, fakeFetch().f), /bad_mask/, 'nothing to send is not a call (and never "delete all")');
    await assert.rejects(patchAttributes('AT', 'locations/123', ['attributes'], { attributes: [{ name: 'attributes', valueType: 'BOOL', values: [true] }] }, fakeFetch().f), /bad_mask/, 'the whole-set mask is refused');
    await assert.rejects(patchAttributes('AT', 'locations/123', [WIFI], { attributes: [{ name: WIFI, valueType: 'ENUM', values: ['FREE_WI_FI'] }] }, fakeFetch().f), /bad_attribute/, 'enum attributes are never written');
    await assert.rejects(patchAttributes('AT', 'locations/123', [MENU], { attributes: [{ name: MENU, valueType: 'URL', values: ['https://x'] }] }, fakeFetch().f), /bad_attribute/, 'URL (menu / ordering links) attributes are never written');
    g = fakeFetch(resp(400, { error: { message: 'Attribute not available for category', status: 'INVALID_ARGUMENT' } }));
    await assert.rejects(patchAttributes('AT', 'locations/123', [CC, WC], body, g.f), (e: unknown) => e instanceof GbpRejected && e.googleMessage === 'Attribute not available for category');
    g = fakeFetch(resp(429), resp(429), resp(429));
    await assert.rejects(patchAttributes('AT', 'locations/123', [CC, WC], body, g.f, noSleep), (e: unknown) => e instanceof GbpQuota);
    assert.equal(g.calls.length, 3, 'three tries on quota, like every other edit');
    g = fakeFetch(resp(401));
    await assert.rejects(patchAttributes('AT', 'locations/123', [CC, WC], body, g.f, noSleep), (e: unknown) => e instanceof GbpError && e.code === 'revoked');
  }

  // ── Attributes: the rules ───────────────────────────────────────────────────
  const allowed = new Set([WC, CC, NFC]);
  {
    const c0: TruthCard = { ...base, attributes: { [WC]: true, [CC]: false } };
    assert.throws(() => applyAttributes(c0, { [WIFI]: true }, allowed), /bad_attributes/, 'a name Google does not offer here (an enum attribute) is refused');
    assert.throws(() => applyAttributes(c0, { [CC]: 'yes' }, allowed), /bad_attributes/, 'booleans only');
    assert.throws(() => applyAttributes(c0, [WC], allowed), /bad_attributes/);
    assert.throws(() => applyAttributes(c0, null, allowed), /bad_attributes/);
    const c1 = applyAttributes(c0, { [NFC]: true, [CC]: true }, allowed);
    assert.deepEqual(c1.attributes, { [WC]: true, [CC]: true, [NFC]: true }, 'what is not mentioned keeps its value: nothing is ever unset');

    // the PATCH holds only what differs from Google, and never a delete
    const google = { [WC]: true, [CC]: false };
    assert.deepEqual(buildAttributesPatch(c1.attributes, google, allowed)!.names, [CC, NFC].sort());
    assert.deepEqual(buildAttributesPatch(c1.attributes, google, allowed)!.body.attributes, [{ name: CC, valueType: 'BOOL', values: [true] }, { name: NFC, valueType: 'BOOL', values: [true] }].sort((a, b) => a.name.localeCompare(b.name)));
    assert.equal(buildAttributesPatch({ [WC]: true }, google, allowed), null, 'same as Google: nothing to send');
    assert.equal(buildAttributesPatch({}, google, allowed), null, 'an attribute we have no value for is not sent (not an unset)');
    assert.equal(buildAttributesPatch({ [WIFI]: true as any }, google, allowed), null, 'a name outside the boolean list is never sent');
    assert.deepEqual(buildAttributesPatch({ [WC]: false }, google, allowed)!.body.attributes, [{ name: WC, valueType: 'BOOL', values: [false] }], 'switching off sends an explicit "no"');

    // comparing, taking Google's, adopting
    assert.ok(sameAttributes({ [WC]: true }, { [WC]: true }));
    assert.ok(!sameAttributes({ [WC]: true }, {}), 'set on one side only is a difference');
    assert.ok(sameAttributes({ [WC]: true, [NFC]: false }, { [WC]: true, [NFC]: true }, new Set([WC])), 'only the offered names count');
    assert.deepEqual(takeGoogleAttributes({ [WC]: true, [CC]: true, [NFC]: true }, { [WC]: false, [CC]: true }), { [WC]: false, [CC]: true }, 'Google\'s value wins; one Google does not set is dropped from ours (it is not sent back)');
    assert.deepEqual(adoptAttributes({ [WC]: true }, { [WC]: true }, { [WC]: false, [NFC]: true }), { values: { [WC]: false, [NFC]: true }, changed: true });
    assert.deepEqual(adoptAttributes({ [WC]: false }, { [WC]: true }, { [WC]: true, [CC]: true }).values, { [WC]: false, [CC]: true }, 'we changed [WC] ourselves: kept');
    assert.equal(adoptAttributes({ [WC]: true }, undefined, { [WC]: false }).changed, false, 'the first read adopts nothing');
    assert.equal(adoptAttributes({ [WC]: true }, { [WC]: true }, {}).changed, false, 'an attribute that disappeared in Google is not copied as "nothing"');

    // the view
    const items = parseAttributeMetadata(META_RAW);
    const st: GoogleState = { ...emptyState(), google: { ...base, attributes: { [WC]: true, [CC]: false, [WIFI]: true as any } }, checkedAt: 'x', attributeMeta: { category: 'categories/gcid:plumber', fetchedAt: '2026-11-17T00:00:00Z', items } };
    const v = attributesView({ ...base, attributes: { [WC]: true, [CC]: false } }, st, true)!;
    assert.equal(v.status, 'live'); assert.deepEqual(v.google, { [WC]: true, [CC]: false }, 'the view carries only the attributes the screen offers');
    assert.equal(attributesView({ ...base, attributes: { [WC]: false, [CC]: false } }, st, true)!.status, 'google_changed');
    assert.equal(attributesView({ ...base, attributes: { [WC]: false, [CC]: false } }, st, false)!.status, 'local_only', 'sync off');
    assert.equal(attributesView({ ...base, attributes: { [WC]: true } }, { ...st, errors: { attributes: 'x' } }, true)!.status, 'local_only');
    assert.equal(attributesView(base, { ...st, attributeMeta: null }, true), null, 'nothing offered (not read, or the category has none): no card');
    assert.equal(attributesView(base, { ...st, google: { ...base } }, true)!.status, 'local_only', 'Google\'s attributes not read yet');
  }

  // ── Service with fake Google and storage ────────────────────────────────────
  const NOW = new Date('2026-11-17T10:00:00Z');
  function world(over: Partial<SyncDeps> = {}) {
    const db = { row: { owner_email: 'o@x.co', location_name: 'locations/123', card: { ...base, notes: 'x', attributes: { [WC]: true, [CC]: false } } as TruthCard, approved_at: '2026-11-01T00:00:00Z', google_state: null as unknown } };
    let google = clone(RAW);
    let attrs: Record<string, boolean> = { [WC]: true, [CC]: false };
    const steps: string[] = [];
    const sent: { masks: string[][]; attrs: { names: string[]; body: any }[]; looked: string[] } = { masks: [], attrs: [], looked: [] };
    const log: { kind: string; title: string }[] = [];
    const deps: SyncDeps = {
      writeEnabled: () => true,
      row: async () => db.row as any,
      save: async (_e, p) => { steps.push('save'); if (p.card) db.row.card = p.card; if (p.google_state) db.row.google_state = p.google_state; },
      access: async () => 'AT',
      connected: async () => 'locations/123',
      detail: async () => { steps.push('read'); return clone(google); },
      updated: async () => ({ diffMask: [], pendingMask: [] }),
      patch: async (_a, _l, body, mask, validateOnly) => {
        steps.push(validateOnly ? 'validate' : 'patch');
        if (!validateOnly) {
          sent.masks.push(mask);
          if (mask.includes('serviceArea')) google.serviceArea = (body as any).serviceArea;
          if (mask.includes('regularHours')) google.regularHours = (body as any).regularHours;
          if (mask.includes('specialHours')) google.specialHours = (body as any).specialHours;
          if (mask.includes('profile.description')) google.profile = (body as any).profile;
        }
      },
      attributes: async () => { steps.push('attrs-read'); return { name: 'locations/123/attributes', attributes: Object.entries(attrs).map(([name, b]) => ({ name, valueType: 'BOOL', values: [b] })) }; },
      attributeMeta: async () => { steps.push('meta-read'); return clone(META_RAW); },
      patchAttributes: async (_a, _l, names, body) => { steps.push('patch-attrs'); sent.attrs.push({ names, body }); for (const a of body.attributes) attrs[a.name] = a.values[0] as boolean; },
      resolvePlace: async (name) => { sent.looked.push(name); return name === 'עכו' ? { name, placeId: ACRE } : null; },
      revoked: async () => { steps.push('revoked'); },
      log: async (_e, kind, title) => { log.push({ kind, title }); },
      pageUrl: async () => null,
      websiteMode: async () => 'auto',
      ...over,
    };
    return { db, deps, steps, sent, log, attrs: () => attrs, setAttrs: (a: Record<string, boolean>) => { attrs = a; }, google: () => google, setGoogle: (g: any) => { google = g; } };
  }
  const state = (w: ReturnType<typeof world>) => readState(w.db.row.google_state);

  {
    // GET: reads the attributes and the list of what exists once; a card saved before phase A is seeded, not "changed"
    const w = world();
    delete (w.db.row.card as any).serviceArea; delete (w.db.row.card as any).attributes;
    const view = await getProfile('o@x.co', NOW, w.deps);
    assert.deepEqual(Object.keys(view.fields).sort(), ['attributes', 'description', 'hours', 'phone', 'serviceArea', 'services', 'specialHours', 'website']);
    assert.equal(view.fields.serviceArea.status, 'live', 'seeded from Google, not a conflict');
    assert.deepEqual(view.fields.serviceArea.ours, { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: ['חיפה', 'נשר'] });
    assert.equal(view.fields.attributes!.status, 'live');
    assert.deepEqual(view.fields.attributes!.ours, { [WC]: true, [CC]: false });
    assert.deepEqual(view.attributeItems.map((i) => i.name), [WC, CC, NFC], 'boolean attributes only, with Hebrew names');
    assert.equal(view.attributeItems[0].label, 'כניסה נגישה לכיסא גלגלים');
    assert.deepEqual(view.holidays, [], 'no closure day in the next 120 days (18.11.2026)');
    assert.ok(!w.steps.includes('patch') && !w.steps.includes('patch-attrs') && !w.steps.includes('validate'), 'reading never writes');
    assert.deepEqual(w.db.row.card.serviceArea, state(w).google!.serviceArea, 'the seeded service area is saved in the card');
    const metaReads = () => w.steps.filter((x) => x === 'meta-read').length;
    assert.equal(metaReads(), 1);
    await getProfile('o@x.co', new Date(NOW.getTime() + 20 * 60_000), w.deps);   // stale again: attributes re-read, the list of what exists is not
    assert.equal(w.steps.filter((x) => x === 'attrs-read').length, 2); assert.equal(metaReads(), 1, 'the list of what exists is kept for a week');
    await getProfile('o@x.co', new Date(NOW.getTime() + 8 * 86_400_000), w.deps);
    assert.equal(metaReads(), 2, '...and read again after a week');
    // suggestions in the view: from a date with holidays ahead, minus the days already saved
    const h = world();
    h.db.row.card = { ...h.db.row.card, specialHours: [{ date: '2027-04-22', closed: true, open: '', close: '' }] };
    const hv = await getProfile('o@x.co', new Date('2027-03-22T09:00:00Z'), h.deps);
    assert.deepEqual(hv.holidays.map((x) => x.date), ['2027-04-28', '2027-05-12', '2027-06-11'], 'a day already saved is not suggested; nothing was saved by suggesting');
    assert.deepEqual((h.db.row.card.specialHours ?? []).map((d) => d.date), ['2027-04-22']);
    assert.ok(!h.steps.includes('patch'));
  }

  {
    // service area: validate, then patch, then read back; the card only after Google accepted
    const w = world();
    await getProfile('o@x.co', NOW, w.deps); w.steps.length = 0;
    const r = await saveField('o@x.co', 'serviceArea', { places: ['חיפה', 'נשר', 'עכו'] }, NOW, w.deps);
    assert.deepEqual(w.steps, ['read', 'validate', 'patch', 'read', 'save']);
    assert.deepEqual(w.sent.looked, ['עכו'], 'only the new region is looked up');
    assert.deepEqual(w.sent.masks, [['serviceArea']], 'nothing but the service area is sent');
    assert.deepEqual((w.google().serviceArea.places.placeInfos as any[]).map((p) => p.placeId), [HAIFA, NESHER, ACRE]);
    assert.equal(w.google().storefrontAddress.addressLines[0], 'הרצל 1', 'the address is untouched');
    assert.equal(r.field.status, 'live'); assert.equal(r.syncEnabled, true);
    assert.deepEqual(w.db.row.card.serviceArea!.places.map((p) => p.placeId), [HAIFA, NESHER, ACRE], 'the card keeps the Place IDs');
    assert.equal(w.log[0].kind, 'card_field_synced');

    // a region that cannot be identified stops the save before anything reaches Google
    const u = world();
    await assert.rejects(saveField('o@x.co', 'serviceArea', { places: ['חיפה', 'עיר שלא קיימת'] }, NOW, u.deps), (e: unknown) => e instanceof SyncError && e.code === 'invalid' && e.field === 'serviceAreaPlace' && e.detail === 'עיר שלא קיימת');
    assert.ok(!u.steps.includes('validate') && !u.steps.includes('patch'));
    assert.equal(u.db.row.card.serviceArea!.places.length, 2, 'the card is as it was');
    await assert.rejects(saveField('o@x.co', 'serviceArea', { places: [] }, NOW, world().deps), (e: unknown) => e instanceof SyncError && e.code === 'invalid' && e.field === 'serviceArea');

    // Google refuses at validateOnly: nothing is sent for real, the card is as it was, the reason is kept
    const rej = world({ patch: async (_a, _l, _b, _m, validateOnly) => { if (validateOnly) throw new GbpRejected('Service area place is not a region'); } });
    await assert.rejects(saveField('o@x.co', 'serviceArea', { places: ['חיפה', 'עכו'] }, NOW, rej.deps), (e: unknown) => e instanceof SyncError && e.code === 'google_rejected' && e.detail === 'Service area place is not a region');
    assert.equal(rej.db.row.card.serviceArea!.places.length, 2);
    assert.equal(readState(rej.db.row.google_state).errors.serviceArea, 'Service area place is not a region');
    const q = world({ patch: async () => { throw new GbpQuota(); } });
    await assert.rejects(saveField('o@x.co', 'serviceArea', { places: ['חיפה', 'עכו'] }, NOW, q.deps), (e: unknown) => e instanceof SyncError && e.code === 'quota');

    // Google changed the regions: shown as a conflict, both ways out
    const c = world();
    c.setGoogle({ ...RAW, serviceArea: { ...RAW.serviceArea, places: { placeInfos: [...RAW.serviceArea.places.placeInfos, { placeName: 'עכו', placeId: ACRE }] } } });
    const cv = await getProfile('o@x.co', NOW, c.deps);
    assert.equal(cv.fields.serviceArea.status, 'google_changed');
    assert.deepEqual((cv.fields.serviceArea.google as any).places, ['חיפה', 'נשר', 'עכו']); assert.deepEqual((cv.fields.serviceArea.ours as any).places, ['חיפה', 'נשר']);
    const kept = await resolveField('o@x.co', 'serviceArea', 'google', NOW, c.deps);
    assert.equal(kept.field.status, 'live'); assert.equal(c.db.row.card.serviceArea!.places.length, 3);
    assert.ok(!c.steps.includes('patch'), 'keeping Google\'s sends nothing');
    const o = world();
    o.db.row.card = { ...o.db.row.card, serviceArea: { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: [{ name: 'חיפה', placeId: HAIFA }] } };
    o.setGoogle(clone(RAW));
    assert.equal((await getProfile('o@x.co', NOW, o.deps)).fields.serviceArea.status, 'google_changed');
    await resolveField('o@x.co', 'serviceArea', 'ours', NOW, o.deps);
    assert.deepEqual((o.google().serviceArea.places.placeInfos as any[]).map((p) => p.placeId), [HAIFA], 'keeping ours sends ours again');
  }

  {
    // attributes: only what differs, one call, read back, card after
    const w = world();
    await getProfile('o@x.co', NOW, w.deps); w.steps.length = 0;
    const r = await saveAttributes('o@x.co', { [WC]: true, [CC]: true, [NFC]: true }, NOW, w.deps);
    assert.deepEqual(w.sent.attrs.map((a) => a.names), [[CC, NFC].sort()], 'WC is already "yes" in Google: not sent');
    assert.equal(w.sent.attrs.length, 1, 'one call');
    assert.deepEqual(w.attrs(), { [WC]: true, [CC]: true, [NFC]: true });
    assert.ok(!w.steps.includes('validate'), 'Google has no validateOnly for attributes');
    assert.equal(w.steps.indexOf('patch-attrs') < w.steps.lastIndexOf('attrs-read'), true, 'read back after the write');
    assert.equal(r.field.status, 'live'); assert.equal(r.code, undefined);
    assert.deepEqual(w.db.row.card.attributes, { [WC]: true, [CC]: true, [NFC]: true });
    assert.equal(w.log[0].title, 'עדכנו בכרטיס שלכם בגוגל: המאפיינים');
    assert.ok(!w.sent.masks.length, 'attributes never go through locations.patch');

    // unknown / non-boolean names are refused before anything is sent
    await assert.rejects(saveAttributes('o@x.co', { [WIFI]: true }, NOW, w.deps), (e: unknown) => e instanceof SyncError && e.code === 'invalid' && e.field === 'attributes');
    await assert.rejects(saveAttributes('o@x.co', { [WC]: 1 }, NOW, w.deps), (e: unknown) => e instanceof SyncError && e.code === 'invalid');
    await assert.rejects(saveAttributes('o@x.co', { [WC]: true }, NOW, world().deps), (e: unknown) => e instanceof SyncError && e.code === 'invalid', 'before the list of what exists was ever read: nothing can be offered');
    assert.equal(w.sent.attrs.length, 1);

    // nothing changed: nothing sent
    const n = world(); await getProfile('o@x.co', NOW, n.deps);
    await saveAttributes('o@x.co', { [WC]: true }, NOW, n.deps);
    assert.equal(n.sent.attrs.length, 0);

    // switching off sends an explicit "no"; it never unsets
    const off = world(); await getProfile('o@x.co', NOW, off.deps);
    await saveAttributes('o@x.co', { [WC]: false }, NOW, off.deps);
    assert.deepEqual(off.sent.attrs[0].body.attributes, [{ name: WC, valueType: 'BOOL', values: [false] }]);

    // Google refuses: the card is as it was and the reason shows next to the field
    const rj = world({ patchAttributes: async () => { throw new GbpRejected('Attribute not available for this category'); } });
    await getProfile('o@x.co', NOW, rj.deps);
    await assert.rejects(saveAttributes('o@x.co', { [NFC]: true }, NOW, rj.deps), (e: unknown) => e instanceof SyncError && e.code === 'google_rejected');
    assert.equal(rj.db.row.card.attributes![NFC], undefined);
    assert.equal(readState(rj.db.row.google_state).errors.attributes, 'Attribute not available for this category');

    // conflict
    const cf = world(); await getProfile('o@x.co', NOW, cf.deps);
    cf.setAttrs({ [WC]: false, [CC]: false, [NFC]: true });
    cf.db.row.google_state = { ...state(cf), checkedAt: '2026-11-01T00:00:00Z' };
    const cv = await getProfile('o@x.co', NOW, cf.deps);
    assert.equal(cv.fields.attributes!.status, 'google_changed');
    const keepG = await resolveField('o@x.co', 'attributes', 'google', NOW, cf.deps);
    assert.equal(keepG.field.status, 'live'); assert.deepEqual(cf.db.row.card.attributes, { [WC]: false, [CC]: false, [NFC]: true });
    assert.equal(cf.sent.attrs.length, 0, 'keeping Google\'s sends nothing');
    const cf2 = world(); await getProfile('o@x.co', NOW, cf2.deps);
    cf2.setAttrs({ [WC]: false, [CC]: false });
    cf2.db.row.google_state = { ...state(cf2), checkedAt: '2026-11-01T00:00:00Z' };
    await getProfile('o@x.co', NOW, cf2.deps);
    await resolveField('o@x.co', 'attributes', 'ours', NOW, cf2.deps);
    assert.deepEqual(cf2.sent.attrs.map((a) => a.names), [[WC]], 'keeping ours sends only the attribute that differs');
    assert.equal(cf2.attrs()[WC], true);
  }

  // ── The sync switch off: nothing reaches Google ─────────────────────────────
  {
    const w = world({ writeEnabled: () => false });
    await getProfile('o@x.co', NOW, w.deps); w.steps.length = 0;
    const a = await saveField('o@x.co', 'serviceArea', { places: ['חיפה', 'עכו'] }, NOW, w.deps);
    assert.equal(a.code, 'sync_off'); assert.equal(a.field.status, 'local_only'); assert.equal(a.syncEnabled, false);
    assert.deepEqual(w.db.row.card.serviceArea!.places.map((p) => p.name), ['חיפה', 'עכו'], 'kept here');
    assert.equal(w.db.row.card.serviceArea!.places[1].placeId, '', 'not looked up while the switch is off');
    const b = await saveAttributes('o@x.co', { [NFC]: true }, NOW, w.deps);
    assert.equal(b.code, 'sync_off'); assert.equal(b.field.status, 'local_only');
    assert.equal(w.db.row.card.attributes![NFC], true);
    const c = await saveField('o@x.co', 'specialHours', [{ date: '2027-04-22', closed: true, open: '', close: '' }], NOW, w.deps);
    assert.equal(c.code, 'sync_off'); assert.equal(w.db.row.card.specialHours[0].date, '2027-04-22');
    // resolve: keeping ours while the switch is off still sends nothing
    await resolveField('o@x.co', 'attributes', 'ours', NOW, w.deps);
    await resolveField('o@x.co', 'serviceArea', 'ours', NOW, w.deps);
    for (const bad of ['read', 'validate', 'patch', 'patch-attrs', 'revoked']) assert.ok(!w.steps.includes(bad), `no "${bad}" with the switch off`);
    assert.deepEqual([w.sent.masks.length, w.sent.attrs.length, w.sent.looked.length], [0, 0, 0]);
    // reading is still allowed: the screen shows where each field stands
    const v = await getProfile('o@x.co', new Date(NOW.getTime() + 3_600_000), w.deps);
    assert.equal(v.syncEnabled, false); assert.equal(v.fields.serviceArea.status, 'local_only'); assert.equal(v.fields.attributes!.status, 'local_only');
    assert.ok(!w.steps.includes('patch') && !w.steps.includes('patch-attrs'));
  }

  // ── One field failing never blocks the others ───────────────────────────────
  {
    // Google refuses the service area; the attributes and the special hours go through, each on its own
    const w = world({
      patch: async (_a, _l, body, mask, validateOnly) => {
        if (mask.includes('serviceArea')) throw new GbpRejected('Place is not a region');
        if (!validateOnly && mask.includes('specialHours')) (w.google() as any).specialHours = (body as any).specialHours;
      },
    });
    await getProfile('o@x.co', NOW, w.deps);
    await assert.rejects(saveField('o@x.co', 'serviceArea', { places: ['חיפה', 'עכו'] }, NOW, w.deps), (e: unknown) => e instanceof SyncError && e.code === 'google_rejected');
    const a = await saveAttributes('o@x.co', { [NFC]: true }, NOW, w.deps);
    assert.equal(a.field.status, 'live');
    const s = await saveField('o@x.co', 'specialHours', [{ date: '2027-04-22', closed: true, open: '', close: '' }], NOW, w.deps);
    assert.equal(s.field.status, 'live');
    const e = state(w).errors;
    assert.ok(e.serviceArea && !e.attributes && !e.specialHours, 'the failure is remembered for that field only');
    assert.equal((await getProfile('o@x.co', new Date(NOW.getTime() + 3_600_000), w.deps)).fields.serviceArea.error, 'Place is not a region');

    // the other way round: the attributes call fails, the service area still saves
    const x = world({ patchAttributes: async () => { throw new GbpQuota(); } });
    await getProfile('o@x.co', NOW, x.deps);
    await assert.rejects(saveAttributes('o@x.co', { [NFC]: true }, NOW, x.deps), (e2: unknown) => e2 instanceof SyncError && e2.code === 'quota');
    const sa = await saveField('o@x.co', 'serviceArea', { places: ['חיפה', 'נשר', 'עכו'] }, NOW, x.deps);
    assert.equal(sa.field.status, 'live');

    // reading the attributes fails (or the list of what exists does): every other field still loads
    const f1 = world({ attributes: async () => { throw new GbpError('google', 'attributes:http_500'); } });
    const v1 = await getProfile('o@x.co', NOW, f1.deps);
    assert.equal(v1.checkedAt, NOW.toISOString(), 'the profile was read');
    assert.equal(v1.fields.website.status, 'live'); assert.equal(v1.fields.serviceArea.status, 'live');
    assert.equal(v1.fields.attributes!.status, 'local_only'); assert.ok(v1.fields.attributes!.error, 'with a sentence that says why');
    assert.equal(readState(f1.db.row.google_state).errors.attributes?.includes('לא הצלחנו'), true);
    // ...and the next successful read clears it
    f1.deps.attributes = async () => ({ attributes: [{ name: WC, valueType: 'BOOL', values: [true] }, { name: CC, valueType: 'BOOL', values: [false] }] });
    const v1b = await getProfile('o@x.co', new Date(NOW.getTime() + 20 * 60_000), f1.deps);
    assert.equal(v1b.fields.attributes!.status, 'live'); assert.equal(v1b.fields.attributes!.error, undefined);
    const f2 = world({ attributeMeta: async () => { throw new GbpError('google', 'attributes_list:http_503'); } });
    const v2 = await getProfile('o@x.co', NOW, f2.deps);
    assert.equal(v2.fields.serviceArea.status, 'live'); assert.equal(v2.fields.attributes, undefined, 'no list of what exists yet: the card is simply not shown'); assert.deepEqual(v2.attributeItems, []);
    // a token revoked while reading the attributes is a revoked connection, not a quiet failure
    const f3 = world({ attributes: async () => { throw new GbpError('revoked'); } });
    const v3 = await getProfile('o@x.co', NOW, f3.deps);
    assert.ok(f3.steps.includes('revoked')); assert.equal(v3.checkedAt, null);
  }

  {
    // the weekly re-read adopts service area and attribute changes; one account failing does not stop the others
    const a = world();
    await getProfile('o@x.co', NOW, a.deps);
    a.db.row.google_state = { ...state(a), checkedAt: '2026-11-01T00:00:00Z' };
    a.setAttrs({ [WC]: false, [CC]: false, [NFC]: true });
    a.setGoogle({ ...RAW, serviceArea: { ...RAW.serviceArea, places: { placeInfos: [...RAW.serviceArea.places.placeInfos, { placeName: 'עכו', placeId: ACRE }] } }, regularHours: { periods: [{ openDay: 'SUNDAY', openTime: { hours: 9 }, closeDay: 'SUNDAY', closeTime: { hours: 17 } }] } });
    const deps: ProfileSweepDeps = {
      ...a.deps,
      accounts: async () => ['bad@x.co', 'o@x.co', 'noattrs@x.co'],
      row: async (email) => { if (email === 'bad@x.co') throw new Error('db hiccup'); return a.db.row as any; },
    };
    const res = await sweepProfiles(NOW, deps);
    assert.equal(res.failed, 1); assert.equal(res.adopted >= 1, true);
    assert.deepEqual(a.db.row.card.serviceArea!.places.map((p) => p.name), ['חיפה', 'נשר', 'עכו']);
    assert.deepEqual(a.db.row.card.attributes, { [WC]: false, [CC]: false, [NFC]: true });
    assert.deepEqual(a.db.row.card.hours, [{ day: 'SUNDAY', open: '09:00', close: '17:00' }]);
    assert.ok(a.log.some((l) => l.kind === 'card_synced' && l.title.includes('אזורי השירות') && l.title.includes('המאפיינים') && l.title.includes('שעות הפעילות')));
    // the attributes failing to read does not stop the hours from being adopted
    const b = world({ attributes: async () => { throw new GbpError('google', 'attributes:http_500'); } });
    b.db.row.google_state = { ...emptyState(), google: { ...base, attributes: { [WC]: true, [CC]: false } }, checkedAt: '2026-11-01T00:00:00Z' };
    b.setGoogle({ ...RAW, regularHours: { periods: [{ openDay: 'SUNDAY', openTime: { hours: 9 }, closeDay: 'SUNDAY', closeTime: { hours: 17 } }] } });
    const rb = await sweepProfiles(NOW, { ...b.deps, accounts: async () => ['o@x.co'] });
    assert.deepEqual(rb, { accounts: 1, refreshed: 1, adopted: 1, failed: 0 });
    assert.deepEqual(b.db.row.card.hours, [{ day: 'SUNDAY', open: '09:00', close: '17:00' }]);
    assert.deepEqual(b.db.row.card.attributes, { [WC]: true, [CC]: false }, 'unchanged');
  }

  // ── Routes and the controller ───────────────────────────────────────────────
  {
    const ctl = await import('../src/controllers/gbpProfile.controller');
    const res = () => { const r: any = { code: 200 }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
    let r = res(); await ctl.putField({ params: { field: 'attributes' }, body: { value: {} } } as any, r);
    assert.equal(r.code, 401, 'attributes need a signed-in owner');
    r = res(); await ctl.putField({ authEmail: 'o@x.co', params: { field: 'attributes' }, body: {} } as any, r);
    assert.equal(r.code, 400, 'a body without a value');
    for (const f of ['title', 'storefrontAddress', 'categories', 'openInfo', 'placeActionLinks', 'attributes/x']) {
      r = res(); await ctl.putField({ authEmail: 'o@x.co', params: { field: f }, body: { value: 'x' } } as any, r);
      assert.equal(r.code, 400, `${f} is not editable here`);
    }
    r = res(); await ctl.resolve({ authEmail: 'o@x.co', params: { field: 'attributes' }, body: { keep: 'mine' } } as any, r);
    assert.equal(r.code, 400);
    // the routes already in place serve the new fields: same limiter, same sign-in and product gate
    const { default: router } = await import('../src/routes/seo.routes');
    const { requireAuth } = await import('../src/middleware/auth.middleware');
    for (const [method, path] of [['put', '/gbp/profile/:field'], ['post', '/gbp/profile/:field/resolve'], ['get', '/gbp/profile']]) {
      const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} exists`);
      const handles = layer.route.stack.map((s: any) => s.handle);
      const ai = handles.indexOf(requireAuth);
      assert.ok(ai >= 0 && handles.length >= ai + 3, `${path}: requireAuth, requireProduct, handler`);
      assert.ok(ai >= 1, `${path}: behind the rate limiter`);
    }
  }

  // ── The words on the screen ─────────────────────────────────────────────────
  {
    for (const k of ['serviceArea', 'attributes'] as const) {
      assert.ok(FIELD_KEYS.includes(k)); assert.ok(FIELD_LABEL[k] && FIELD_HINT[k]);
    }
    const all = [FIELD_LABEL.serviceArea, FIELD_LABEL.attributes, FIELD_HINT.serviceArea, FIELD_HINT.attributes, AREA.none, AREA.hidesAddress, AREA.showsAddress, AREA.lookup, AREA.errNone, ATTRS.none, ATTRS.keepNote, HOLIDAY_COPY.title, HOLIDAY_COPY.hint, HOLIDAY_COPY.add, HOLIDAY_COPY.addAll, HOLIDAY_COPY.usuallyClosed, HOLIDAY_COPY.added(3)].join(' ');
    assert.ok(!/\bAI\b|בינה מלאכותית|API|JSON|פיצ'ר/.test(all), 'no jargon, no "AI"');
    assert.ok(!/(^|\s)(תוסיף|תעדכן|בדוק|סמן|כתוב|לחץ)(\s|$)/.test(all), 'plural second person, never singular imperative');
    assert.ok(HOLIDAY_COPY.addLabel('פסח').includes('פסח'));
    assert.ok(AREA_OPTIONS.length > 40 && new Set(AREA_OPTIONS).size === AREA_OPTIONS.length);
  }

  console.log('gbp sync phase A checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
