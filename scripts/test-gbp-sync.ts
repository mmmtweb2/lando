// Full sync with the Google listing (docs/gbp-sync-spec.md). No network, no database: Google and
// storage are fakes. Run: npx tsx scripts/test-gbp-sync.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'assert';
import sharp from 'sharp';
import { emptyCard, type TruthCard, parseLocation } from '../src/services/businessTruth';
import {
  GbpError, GbpQuota, GbpRejected, createMedia, deleteMedia, getGoogleUpdated, parseMedia, patchLocation, withQuotaRetry,
} from '../src/services/gbpGoogle';
import { adoptChanges, applyField, buildPatch, emptyState, fieldStatus, readState, sameField, type GoogleState } from '../src/services/gbpSync';
import {
  type PhotoDeps, type ProfileSweepDeps, type SyncDeps, SyncError, addPhoto, getProfile, onPagePublished, removePhoto, resolveField, saveField, sweepProfiles, websiteFromPage,
} from '../src/services/gbpSync.service';
import { PhotoInputError, allowedImageHost, fetchPageImage, toGooglePhoto } from '../src/services/gbpPhotos';

type Call = { url: string; init?: any };
const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fakeFetch(...answers: Response[]) {
  const calls: Call[] = [];
  const f = (async (url: any, init?: any) => { calls.push({ url: String(url), init }); return answers.shift() ?? resp(200, {}); }) as typeof fetch;
  return { f, calls };
}
const noSleep = { sleep: async () => undefined, random: () => 0 };

// A Google location as the Business Information API returns it.
const RAW: Record<string, any> = {
  name: 'locations/123', title: 'אינסטלציה דני',
  phoneNumbers: { primaryPhone: '03-5551234' },
  categories: { primaryCategory: { name: 'categories/gcid:plumber', displayName: 'אינסטלטור' } },
  profile: { description: 'אינסטלטור מוסמך.' },
  regularHours: { periods: [{ openDay: 'SUNDAY', openTime: { hours: 8 }, closeDay: 'SUNDAY', closeTime: { hours: 18 } }] },
  serviceItems: [{ freeFormServiceItem: { category: 'categories/gcid:plumber', label: { displayName: 'תיקון נזילות', languageCode: 'he' } } }],
  metadata: { mapsUri: 'https://maps.google.com/?cid=1', newReviewUri: 'https://g.page/r/x' },
};

(async () => {
  // ── Google client ─────────────────────────────────────────────────────────
  {
    // 429 is retried with backoff; other statuses are returned at once
    const slept: number[] = [];
    let n = 0;
    const r = await withQuotaRetry(async () => (++n < 3 ? resp(429) : resp(200)), { sleep: async (ms) => { slept.push(ms); }, random: () => 0 });
    assert.equal(r.status, 200); assert.equal(n, 3); assert.deepEqual(slept, [1000, 2000], 'exponential backoff');
    n = 0;
    assert.equal((await withQuotaRetry(async () => { n++; return resp(500); }, noSleep)).status, 500); assert.equal(n, 1, '500 is not retried');

    let g = fakeFetch(resp(200));
    await patchLocation('AT', 'locations/123', { websiteUri: 'https://a.co' }, ['websiteUri'], g.f, { validateOnly: true });
    assert.equal(g.calls[0].url, 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/123?updateMask=websiteUri&validateOnly=true');
    assert.equal(g.calls[0].init.method, 'PATCH');
    g = fakeFetch(resp(400, { error: { message: 'Invalid phone number', status: 'INVALID_ARGUMENT' } }));
    await assert.rejects(patchLocation('AT', 'locations/123', {}, ['phoneNumbers'], g.f, noSleep), (e: unknown) => e instanceof GbpRejected && e.googleMessage === 'Invalid phone number');
    g = fakeFetch(resp(429), resp(429), resp(429));
    await assert.rejects(patchLocation('AT', 'locations/123', {}, ['regularHours'], g.f, noSleep), (e: unknown) => e instanceof GbpQuota);
    assert.equal(g.calls.length, 3, 'three attempts, then quota');
    g = fakeFetch(resp(401));
    await assert.rejects(patchLocation('AT', 'locations/123', {}, ['websiteUri'], g.f, noSleep), (e: unknown) => e instanceof GbpError && e.code === 'revoked');
    for (const m of ['title', 'storefrontAddress', 'categories', 'openInfo']) {
      await assert.rejects(patchLocation('AT', 'locations/123', {}, [m], fakeFetch().f), /bad_mask/, `identity field ${m} is never written`);
    }

    g = fakeFetch(resp(200, { diffMask: 'websiteUri,regularHours', pendingMask: 'profile.description' }));
    assert.deepEqual(await getGoogleUpdated('AT', 'locations/123', g.f), { diffMask: ['websiteUri', 'regularHours'], pendingMask: ['profile.description'] });
    assert.ok(g.calls[0].url.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/locations/123:getGoogleUpdated?readMask='));

    assert.deepEqual(parseMedia({ mediaItems: [
      { name: 'accounts/1/locations/123/media/AbC_1', mediaFormat: 'PHOTO', googleUrl: 'https://lh3.googleusercontent.com/a', thumbnailUrl: 'https://lh3.googleusercontent.com/t', locationAssociation: { category: 'COVER' }, createTime: '2026-11-01T00:00:00Z' },
      { name: 'accounts/1/locations/123/media/vid1', mediaFormat: 'VIDEO', googleUrl: 'https://x/v' },
      { name: 'accounts/1/locations/123/media/proc', mediaFormat: 'PHOTO' },
      { name: '../../evil', mediaFormat: 'PHOTO', googleUrl: 'javascript:alert(1)' },
    ] }), [
      { id: 'AbC_1', url: 'https://lh3.googleusercontent.com/a', thumbUrl: 'https://lh3.googleusercontent.com/t', category: 'COVER', createdAt: '2026-11-01T00:00:00Z', state: 'live' },
      { id: 'proc', url: '', thumbUrl: '', category: 'ADDITIONAL', createdAt: null, state: 'processing' },
    ], 'videos and bad names skipped; a photo Google is still processing is shown as such');

    g = fakeFetch(resp(200, { name: 'accounts/1/locations/123/media/NEW1' }));
    assert.equal(await createMedia('AT', 'accounts/1', 'locations/123', 'https://cdn.example/a.jpg', 'COVER', g.f), 'NEW1');
    assert.deepEqual(JSON.parse(g.calls[0].init.body), { mediaFormat: 'PHOTO', locationAssociation: { category: 'COVER' }, sourceUrl: 'https://cdn.example/a.jpg' });
    await assert.rejects(createMedia('AT', 'accounts/1', 'locations/123', 'http://insecure/a.jpg', 'COVER', fakeFetch().f), /bad_media/);
    await assert.rejects(createMedia('AT', 'accounts/1', 'locations/123', 'https://a/a.jpg', 'LOGO' as any, fakeFetch().f), /bad_media/);
    g = fakeFetch(resp(404));
    await deleteMedia('AT', 'accounts/1', 'locations/123', 'AbC_1', g.f, noSleep);
    assert.equal(g.calls[0].init.method, 'DELETE', 'a photo already gone is not an error');
  }

  // ── Card model: special hours and extra phones are read from Google ─────────
  {
    const c = parseLocation({ ...RAW,
      phoneNumbers: { primaryPhone: '03-5551234', additionalPhones: ['050-1234567', '03-5551234', '052-7654321', '054-0000000'] },
      specialHours: { specialHourPeriods: [
        { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
        { startDate: { year: 2026, month: 12, day: 24 }, openTime: { hours: 9 }, closeTime: { hours: 13 } },
        { startDate: { year: 2026, month: 2, day: 31 }, closed: true },
      ] },
    });
    assert.deepEqual(c.extraPhones, ['050-1234567', '052-7654321'], 'the main number is not repeated; at most two');
    assert.deepEqual(c.specialHours, [
      { date: '2026-12-24', closed: false, open: '09:00', close: '13:00' },
      { date: '2026-12-25', closed: true, open: '', close: '' },
    ], 'sorted; an impossible date is dropped');
  }

  // ── Pure rules ───────────────────────────────────────────────────────────
  const base: TruthCard = parseLocation(RAW);
  {
    assert.throws(() => applyField(base, 'website', 'http://a.co'), /bad_website/, 'https only');
    assert.equal(applyField(base, 'website', 'https://dani.pagey.co.il').website, 'https://dani.pagey.co.il');
    assert.throws(() => applyField(base, 'description', 'בואו לאתר שלנו dani.co.il'), /bad_descriptionContent/, 'no bare domains');
    assert.throws(() => applyField(base, 'description', 'התקשרו 050-1234567'), /bad_descriptionContent/, 'no phone numbers');
    assert.throws(() => applyField(base, 'description', '   '), /bad_description/);
    assert.throws(() => applyField(base, 'phone', { primary: '', additional: [] }), /bad_phone/, 'the main number cannot be emptied');
    assert.throws(() => applyField(base, 'phone', { primary: '03-5551234', additional: ['1', '2', '3'] }), /bad_extraPhones/);
    assert.throws(() => applyField(base, 'specialHours', [{ date: '2026-13-01', closed: true }]), /bad_specialHours/);
    assert.throws(() => applyField(base, 'hours', [{ day: 'FUNDAY', open: '08:00', close: '10:00' }]), /bad_hours/);

    // hours: overnight closes on the next day; 24:00 stays on the same day
    const h = buildPatch('hours', applyField(base, 'hours', [{ day: 'SATURDAY', open: '20:00', close: '02:00' }, { day: 'MONDAY', open: '08:00', close: '24:00' }]), RAW)!;
    assert.deepEqual(h.mask, ['regularHours']);
    assert.deepEqual((h.body as any).regularHours.periods, [
      { openDay: 'SATURDAY', openTime: { hours: 20, minutes: 0 }, closeDay: 'SUNDAY', closeTime: { hours: 2, minutes: 0 } },
      { openDay: 'MONDAY', openTime: { hours: 8, minutes: 0 }, closeDay: 'MONDAY', closeTime: { hours: 24, minutes: 0 } },
    ]);
    const sp = buildPatch('specialHours', applyField(base, 'specialHours', [{ date: '2026-12-25', closed: true }, { date: '2026-12-31', closed: false, open: '18:00', close: '01:00' }]), RAW)!;
    assert.deepEqual((sp.body as any).specialHours.specialHourPeriods, [
      { startDate: { year: 2026, month: 12, day: 25 }, endDate: { year: 2026, month: 12, day: 25 }, closed: true },
      { startDate: { year: 2026, month: 12, day: 31 }, openTime: { hours: 18, minutes: 0 }, endDate: { year: 2027, month: 1, day: 1 }, closeTime: { hours: 1, minutes: 0 } },
    ], 'New Year\'s Eve after midnight ends next year');
    assert.throws(() => buildPatch('specialHours', { ...emptyCard(), specialHours: [{ date: '2026-12-25', closed: true, open: '', close: '' }] }, { ...RAW, regularHours: undefined }), /bad_specialHoursNeedHours/);

    // never clear Google from an empty local value
    for (const f of ['website', 'description', 'hours', 'specialHours'] as const) assert.equal(buildPatch(f, emptyCard(), RAW), null, `empty ${f} sends nothing`);
    // services: Google's list is sent back as read, ours appended; nothing removed
    const svc = buildPatch('services', applyField(base, 'services', [{ name: 'פתיחת סתימות', description: 'גם בלילה' }]), RAW)!;
    assert.deepEqual((svc.body as any).serviceItems, [
      RAW.serviceItems[0],
      { freeFormServiceItem: { category: 'categories/gcid:plumber', label: { displayName: 'פתיחת סתימות', description: 'גם בלילה', languageCode: 'he' } } },
    ], 'the customer dropped "תיקון נזילות" here, but Google keeps it');
    assert.equal(buildPatch('services', base, RAW), null, 'every service already in Google: nothing to send');

    // status
    const st: GoogleState = { ...emptyState(), google: base, checkedAt: '2026-11-17T00:00:00Z' };
    assert.equal(fieldStatus('description', base, st, true).status, 'live');
    const mine = { ...base, description: 'תיאור חדש לגמרי של העסק.' };
    assert.equal(fieldStatus('description', mine, st, true).status, 'google_changed');
    assert.equal(fieldStatus('description', mine, st, false).status, 'local_only', 'sync off: our change is not in Google yet');
    assert.equal(fieldStatus('description', mine, { ...st, pendingMask: ['profile.description'] }, true).status, 'pending');
    const err = fieldStatus('description', mine, { ...st, errors: { description: 'Google said no' } }, true);
    assert.equal(err.status, 'local_only'); assert.equal(err.error, 'Google said no');
    assert.equal(fieldStatus('website', base, emptyState(), true).status, 'local_only', 'never read from Google yet');
    assert.ok(sameField('website', { ...base, website: 'https://A.co/' }, { ...base, website: 'https://a.co' }), 'host case and trailing slash do not count');
    assert.ok(sameField('phone', { ...base, phone: '+972 3-555-1234' }, base), 'same number in another format');
    assert.equal(readState(null).google, null);

    // weekly adoption: Google changed hours; we changed the description ourselves
    const prevG = base;
    const nextG: TruthCard = { ...base, hours: [{ day: 'SUNDAY', open: '09:00', close: '17:00' }], description: 'נכתב בגוגל.' };
    const ours: TruthCard = { ...base, description: 'כתבנו כאן משהו אחר.' };
    const ad = adoptChanges(ours, prevG, nextG);
    assert.deepEqual(ad.adopted, ['hours']);
    assert.deepEqual(ad.card.hours, nextG.hours);
    assert.equal(ad.card.description, 'כתבנו כאן משהו אחר.', 'a field we changed ourselves is kept');
    assert.deepEqual(adoptChanges(ours, null, nextG).adopted, [], 'first read adopts nothing');
    assert.deepEqual(adoptChanges(base, base, { ...base, website: '' }).adopted, [], 'a value that disappeared in Google is not copied as empty');
  }

  // ── Service with fake Google and storage ─────────────────────────────────
  const NOW = new Date('2026-11-17T10:00:00Z');
  function world(over: Partial<SyncDeps> = {}) {
    const db = { row: { owner_email: 'o@x.co', location_name: 'locations/123', card: { ...base, notes: 'x' } as TruthCard, approved_at: '2026-11-01T00:00:00Z', google_state: null as unknown } };
    let google = JSON.parse(JSON.stringify(RAW));
    const log: { kind: string; title: string }[] = [];
    const steps: string[] = [];
    const deps: SyncDeps = {
      writeEnabled: () => true,
      row: async () => db.row as any,
      save: async (_e, p) => { steps.push('save'); if (p.card) db.row.card = p.card; if (p.google_state) db.row.google_state = p.google_state; },
      access: async () => 'AT',
      connected: async () => 'locations/123',
      detail: async () => { steps.push('read'); return JSON.parse(JSON.stringify(google)); },
      updated: async () => ({ diffMask: [], pendingMask: [] }),
      patch: async (_a, _l, body, mask, validateOnly) => {
        steps.push(validateOnly ? 'validate' : 'patch');
        if (!validateOnly) {
          if (mask.includes('websiteUri')) google.websiteUri = (body as any).websiteUri;
          if (mask.includes('profile.description')) google.profile = { description: (body as any).profile.description };
          if (mask.includes('regularHours')) google.regularHours = (body as any).regularHours;
          if (mask.includes('serviceItems')) google.serviceItems = (body as any).serviceItems;
        }
      },
      revoked: async () => { steps.push('revoked'); },
      log: async (_e, kind, title) => { log.push({ kind, title }); },
      pageUrl: async () => ({ pageId: 'P1', url: 'https://dani.pagey.co.il' }),
      websiteMode: async () => 'auto',
      ...over,
    };
    return { db, deps, log, steps, setGoogle: (g: any) => { google = g; }, google: () => google };
  }

  {
    // write-through: validate -> patch -> read back, and only then our card
    const w = world();
    const r = await saveField('o@x.co', 'description', 'תיאור חדש ומלא של העסק שלנו.', NOW, w.deps);
    assert.deepEqual(w.steps, ['read', 'validate', 'patch', 'read', 'save']);
    assert.equal(r.field.status, 'live'); assert.equal(r.syncEnabled, true); assert.equal(r.code, undefined);
    assert.equal(w.db.row.card.description, 'תיאור חדש ומלא של העסק שלנו.');
    assert.equal(w.db.row.card.notes, 'x', 'other fields untouched');
    assert.equal(w.log[0].kind, 'card_field_synced');

    // sync switch off: saved here only, nothing sent
    const off = world({ writeEnabled: () => false });
    const r2 = await saveField('o@x.co', 'website', 'https://dani.pagey.co.il', NOW, off.deps);
    assert.equal(r2.code, 'sync_off'); assert.equal(r2.field.status, 'local_only');
    assert.ok(!off.steps.includes('patch') && !off.steps.includes('validate'));
    assert.equal(off.db.row.card.website, 'https://dani.pagey.co.il');

    // Google refuses: our card keeps the old value, the reason is shown next to the field
    const rej = world({ patch: async () => { throw new GbpRejected('Description contains a URL'); } });
    await assert.rejects(saveField('o@x.co', 'description', 'תיאור אחר לגמרי שלא עובר.', NOW, rej.deps), (e: unknown) => e instanceof SyncError && e.code === 'google_rejected' && e.detail === 'Description contains a URL');
    assert.equal(rej.db.row.card.description, base.description);
    assert.equal(readState(rej.db.row.google_state).errors.description, 'Description contains a URL');

    const q = world({ patch: async () => { throw new GbpQuota(); } });
    await assert.rejects(saveField('o@x.co', 'description', 'תיאור אחר לגמרי שלא עובר.', NOW, q.deps), (e: unknown) => e instanceof SyncError && e.code === 'quota');

    const rv = world({ detail: async () => { throw new GbpError('revoked'); } });
    await assert.rejects(saveField('o@x.co', 'description', 'תיאור אחר לגמרי שלא עובר.', NOW, rv.deps), (e: unknown) => e instanceof SyncError && e.code === 'not_connected');
    assert.ok(rv.steps.includes('revoked'), 'a revoked token marks the connection');

    // a different business connected now: never written
    const other = world({ connected: async () => 'locations/999' });
    await assert.rejects(saveField('o@x.co', 'description', 'תיאור חדש ומלא של העסק שלנו.', NOW, other.deps), (e: unknown) => e instanceof SyncError && e.code === 'not_connected');
    assert.ok(!other.steps.includes('patch'));

    await assert.rejects(saveField('o@x.co', 'website', 'ftp://x', NOW, world().deps), (e: unknown) => e instanceof SyncError && e.code === 'invalid' && e.field === 'website');

    // services: removing one here never removes it in Google
    const s = world();
    await saveField('o@x.co', 'services', [{ name: 'פתיחת סתימות', description: '' }], NOW, s.deps);
    assert.deepEqual(parseLocation(s.google()).services.map((x) => x.name), ['תיקון נזילות', 'פתיחת סתימות']);

    // resolve: keep what Google shows
    const rs = world();
    rs.db.row.card = { ...base, hours: [{ day: 'MONDAY', open: '10:00', close: '12:00' }] };
    rs.db.row.google_state = { ...emptyState(), google: base, checkedAt: NOW.toISOString() };
    const kept = await resolveField('o@x.co', 'hours', 'google', NOW, rs.deps);
    assert.deepEqual(rs.db.row.card.hours, base.hours); assert.equal(kept.field.status, 'live');
    assert.ok(!rs.steps.includes('patch'));
    // resolve: push ours again
    rs.db.row.card = { ...base, hours: [{ day: 'MONDAY', open: '10:00', close: '12:00' }] };
    await resolveField('o@x.co', 'hours', 'ours', NOW, rs.deps);
    assert.ok(rs.steps.includes('patch')); assert.deepEqual(parseLocation(rs.google()).hours, [{ day: 'MONDAY', open: '10:00', close: '12:00' }]);

    // GET: reads Google when stale, shows the website suggestion
    const gp = world();
    gp.setGoogle({ ...RAW, websiteUri: 'https://old-site.co.il' });
    const view = await getProfile('o@x.co', NOW, gp.deps);
    assert.equal(view.syncEnabled, true); assert.equal(view.location, 'locations/123');
    assert.deepEqual(Object.keys(view.fields).sort(), ['description', 'hours', 'phone', 'services', 'specialHours', 'website']);
    assert.deepEqual(view.websiteSuggestion, { url: 'https://dani.pagey.co.il', current: 'https://old-site.co.il' });
    assert.equal(view.metadata.mapsUri, 'https://maps.google.com/?cid=1');
    assert.equal(view.checkedAt, NOW.toISOString());
    const reads = gp.steps.filter((x) => x === 'read').length;
    await getProfile('o@x.co', new Date(NOW.getTime() + 60_000), gp.deps);
    assert.equal(gp.steps.filter((x) => x === 'read').length, reads, 'a fresh read is reused for 15 minutes');
    const gpOff = world({ websiteMode: async () => 'off' });
    assert.equal((await getProfile('o@x.co', NOW, gpOff.deps)).websiteSuggestion, null, 'mode off: no suggestion');
    const down = world({ detail: async () => { throw new GbpError('google', 'location:http_503'); } });
    assert.equal((await getProfile('o@x.co', NOW, down.deps)).checkedAt, null, 'Google down: the screen still loads');

    // website from the page (the suggestion's button)
    const wf = world();
    await websiteFromPage('o@x.co', NOW, wf.deps);
    assert.equal(wf.google().websiteUri, 'https://dani.pagey.co.il');
    assert.equal(wf.log[0].title, 'הוספנו את הדף שלכם כאתר בכרטיס בגוגל');
    await assert.rejects(websiteFromPage('o@x.co', NOW, world({ pageUrl: async () => null }).deps), (e: unknown) => e instanceof SyncError && e.code === 'no_page');
  }

  {
    // website when the business's own page is published
    const empty = world();
    assert.equal(await onPagePublished('o@x.co', 'P1', NOW, empty.deps), 'set');
    assert.equal(empty.google().websiteUri, 'https://dani.pagey.co.il');
    const other = world(); other.setGoogle({ ...RAW, websiteUri: 'https://my-site.co.il' });
    assert.equal(await onPagePublished('o@x.co', 'P1', NOW, other.deps), 'suggested');
    assert.equal(other.google().websiteUri, 'https://my-site.co.il', 'an existing website is never replaced by itself');
    assert.equal(await onPagePublished('o@x.co', 'P1', NOW, world({ websiteMode: async () => 'off' }).deps), 'off');
    const ask = world({ websiteMode: async () => 'ask' });
    assert.equal(await onPagePublished('o@x.co', 'P1', NOW, ask.deps), 'suggested');
    assert.equal(ask.google().websiteUri, undefined);
    assert.equal(await onPagePublished('o@x.co', 'OTHER', NOW, world().deps), 'not_business_page');
    const offSync = world({ writeEnabled: () => false });
    offSync.db.row.card = { ...base, website: '' };
    assert.equal(await onPagePublished('o@x.co', 'P1', NOW, offSync.deps), 'local');
    assert.equal(offSync.db.row.card.website, 'https://dani.pagey.co.il');
    assert.equal(await onPagePublished('o@x.co', 'P1', NOW, world({ pageUrl: async () => { throw new Error('db down'); } }).deps), 'failed', 'never throws');
  }

  {
    // weekly re-read: adopts what changed in Google, one account failing does not stop the others
    const a = world();
    a.db.row.google_state = { ...emptyState(), google: base, checkedAt: '2026-11-01T00:00:00Z' };
    a.setGoogle({ ...RAW, regularHours: { periods: [{ openDay: 'SUNDAY', openTime: { hours: 9 }, closeDay: 'SUNDAY', closeTime: { hours: 17 } }] } });
    let calls = 0;
    const deps: ProfileSweepDeps = {
      ...a.deps,
      accounts: async () => ['bad@x.co', 'o@x.co', 'fresh@x.co', 'gone@x.co'],
      row: async (email) => {
        calls++;
        if (email === 'bad@x.co') throw new Error('db hiccup');
        if (email === 'fresh@x.co') return { ...a.db.row, google_state: { ...emptyState(), google: base, checkedAt: '2026-11-16T00:00:00Z' } } as any;
        return a.db.row as any;
      },
      connected: async (email) => (email === 'gone@x.co' ? null : 'locations/123'),
    };
    const res = await sweepProfiles(NOW, deps);
    assert.equal(calls, 4);
    assert.deepEqual(res, { accounts: 4, refreshed: 1, adopted: 1, failed: 1 }, 'fresh skipped, disconnected is not a failure');
    assert.deepEqual(a.db.row.card.hours, [{ day: 'SUNDAY', open: '09:00', close: '17:00' }]);
    assert.ok(a.log.some((l) => l.kind === 'card_synced' && l.title.includes('שעות הפעילות')));
  }

  {
    // photos
    const stored: string[] = [];
    const created: { url: string; cat: string }[] = [];
    const pd = (over: Partial<PhotoDeps> = {}): PhotoDeps => ({
      writeEnabled: () => true,
      row: async () => ({ owner_email: 'o@x.co', location_name: 'locations/123', card: base, approved_at: null, google_state: null }),
      access: async () => 'AT', connected: async () => 'locations/123', revoked: async () => undefined,
      account: async () => 'accounts/1',
      list: async () => [], create: async (_a, _acc, _l, url, cat) => { created.push({ url, cat }); return 'M1'; }, remove: async () => undefined,
      log: async () => undefined,
      ...over,
    });
    const store = async () => { stored.push('x'); return 'https://cdn/gbp/a.jpg'; };
    assert.deepEqual(await addPhoto('o@x.co', 'INTERIOR', store, pd()), { id: 'M1' });
    assert.deepEqual(created, [{ url: 'https://cdn/gbp/a.jpg', cat: 'INTERIOR' }]);
    await assert.rejects(addPhoto('o@x.co', 'COVER', store, pd({ writeEnabled: () => false })), (e: unknown) => e instanceof SyncError && e.code === 'sync_off');
    await assert.rejects(addPhoto('o@x.co', 'COVER', store, pd({ connected: async () => null })), (e: unknown) => e instanceof SyncError && e.code === 'not_connected');
    assert.equal(stored.length, 1, 'nothing stored for a listing we cannot reach');
    await assert.rejects(removePhoto('o@x.co', '../x', pd()), (e: unknown) => e instanceof SyncError && e.code === 'bad_photo');
    await removePhoto('o@x.co', 'AbC_1', pd());

    // conversion: any accepted image becomes a JPEG; too small is refused
    const png = await sharp({ create: { width: 1000, height: 800, channels: 4, background: { r: 200, g: 10, b: 10, alpha: 0.5 } } }).png().toBuffer();
    const j = await toGooglePhoto(png, 'image/png');
    assert.equal((await sharp(j.buffer).metadata()).format, 'jpeg'); assert.equal(j.width, 1000); assert.equal(j.small, false);
    const webp = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#0a0' } }).webp().toBuffer();
    assert.equal((await toGooglePhoto(webp, 'image/webp')).small, true, 'under 720px: accepted, flagged as small');
    const tiny = await sharp({ create: { width: 200, height: 600, channels: 3, background: '#000' } }).jpeg().toBuffer();
    await assert.rejects(toGooglePhoto(tiny, 'image/jpeg'), (e: unknown) => e instanceof PhotoInputError && e.code === 'small');
    await assert.rejects(toGooglePhoto(png, 'image/gif'), (e: unknown) => e instanceof PhotoInputError && e.code === 'type');
    await assert.rejects(toGooglePhoto(Buffer.from('not an image'), 'image/jpeg'), (e: unknown) => e instanceof PhotoInputError && e.code === 'unreadable');

    // an image from the page: only one the page holds, on an allowed host
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    assert.ok(allowedImageHost('https://proj.supabase.co/storage/v1/object/public/page-assets/uploads/a.webp'));
    assert.ok(allowedImageHost('https://images.unsplash.com/photo-1'));
    assert.ok(allowedImageHost('https://v3.fal.media/files/a.png'));
    assert.ok(!allowedImageHost('https://169.254.169.254/latest'), 'no metadata endpoints');
    assert.ok(!allowedImageHost('http://images.unsplash.com/photo-1'), 'https only');
    assert.ok(!allowedImageHost('https://user:pw@images.unsplash.com/a'));
    assert.ok(!allowedImageHost('https://evil.fal.media.attacker.com/a'));
    const onPage = async () => ['https://images.unsplash.com/photo-1'];
    await assert.rejects(fetchPageImage('o@x.co', 'https://images.unsplash.com/photo-2', fakeFetch().f, onPage), (e: unknown) => e instanceof PhotoInputError && e.code === 'not_on_page');
    const imgFetch = fakeFetch(new Response(new Uint8Array(webp), { status: 200, headers: { 'content-type': 'image/webp' } }));
    const got = await fetchPageImage('o@x.co', 'https://images.unsplash.com/photo-1', imgFetch.f, onPage);
    assert.equal(got.mime, 'image/webp'); assert.equal(got.buffer.length, webp.length);
    assert.equal(imgFetch.calls[0].init.redirect, 'error', 'redirects are never followed');
  }

  // ── Routes: every new endpoint is behind sign-in and the product ─────────────
  {
    const { default: router } = await import('../src/routes/seo.routes');
    const { requireAuth } = await import('../src/middleware/auth.middleware');
    const want = [['get', '/gbp/profile'], ['put', '/gbp/profile/:field'], ['post', '/gbp/profile/:field/resolve'], ['post', '/gbp/profile/website-from-page'], ['get', '/gbp/photos'], ['post', '/gbp/photos'], ['delete', '/gbp/photos/:id']];
    for (const [method, path] of want) {
      const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
      assert.ok(layer, `${method.toUpperCase()} ${path} exists`);
      const handles = layer.route.stack.map((s: any) => s.handle);
      const ai = handles.indexOf(requireAuth);
      assert.ok(ai >= 0, `${path}: requireAuth`);
      assert.ok(handles.length >= ai + 3, `${path}: requireProduct after requireAuth, then the handler`);
    }

    // controller answers
    const ctl = await import('../src/controllers/gbpProfile.controller');
    const res = () => { const r: any = { code: 200 }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
    let r = res(); await ctl.putField({ authEmail: 'o@x.co', params: { field: 'title' }, body: { value: 'x' } } as any, r);
    assert.equal(r.code, 400, 'the business name is not editable here');
    r = res(); await ctl.putField({ params: { field: 'website' }, body: { value: 'x' } } as any, r);
    assert.equal(r.code, 401);
    r = res(); await ctl.postPhoto({ authEmail: 'o@x.co', body: { category: 'LOGO' } } as any, r);
    assert.equal(r.code, 400, 'LOGO is deprecated by Google: PROFILE is the logo');
    r = res(); await ctl.resolve({ authEmail: 'o@x.co', params: { field: 'hours' }, body: { keep: 'mine' } } as any, r);
    assert.equal(r.code, 400);
  }

  console.log('gbp sync checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
