// The calls of "הכרטיס שלכם בגוגל" (docs/gbp-sync-spec.md, API table). Like api.ts: one interface,
// the server and the preview's in-memory sample. Every answer is normalized here, so the screens
// only ever see the shapes in profileTypes.ts.
import { authFetch } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import { GENERIC_ERROR } from '../autopilotCopy';
import { PHOTOS, PROFILE } from './profileCopy';
import { sampleFlag } from './sample';
import type { Day, TruthHours } from './types';
import {
  FIELD_KEYS, type AreaValue, type AttributeItem, type AttributeValues, type FieldKey, type FieldStatus, type FieldValues, type GbpPhoto, type GbpProfile,
  type HolidaySuggestion, type PhotoCategory, type PhotoState, type ProfileField, type ProfileFields, type SaveResult, type ServiceItem, type SpecialDay,
} from './profileTypes';

export interface ProfileApi {
  profile(): Promise<GbpProfile>;
  save<K extends FieldKey>(field: K, value: FieldValues[K]): Promise<SaveResult>;
  resolve(field: FieldKey, keep: 'google' | 'ours'): Promise<SaveResult>;
  acceptWebsite(): Promise<void>;
  photos(): Promise<GbpPhoto[]>;
  /** `onProgress` gets 0..1 while the file goes up */
  /** resolves `small: true` when the photo went up but is under 720px */
  upload(file: File, category: PhotoCategory, onProgress: (p: number) => void): Promise<{ small: boolean }>;
  addFromPage(url: string, category: PhotoCategory): Promise<{ small: boolean }>;
  remove(id: string): Promise<void>;
}

export class ProfileError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null) { super(message); this.code = code; }
}

const HEBREW = /[֐-׿]/;
const said = (b: Record<string, unknown> | null): string | null => (typeof b?.error === 'string' && HEBREW.test(b.error) ? b.error : null);

// ── normalizing ──────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const DAYS: Day[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const hhmm = (v: unknown): string => { const m = /^(\d{1,2}):(\d{2})/.exec(str(v)); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };

function phones(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean).slice(0, 3);
  if (typeof v === 'string') return v ? [v] : [];
  if (v && typeof v === 'object') {
    const o = v as { primary?: unknown; additional?: unknown };
    return [str(o.primary), ...(Array.isArray(o.additional) ? o.additional.map(str) : [])].filter(Boolean).slice(0, 3);
  }
  return [];
}
function hours(v: unknown): TruthHours[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((h) => {
    const o = (h ?? {}) as Record<string, unknown>;
    const day = str(o.day).toUpperCase() as Day;
    return DAYS.includes(day) && hhmm(o.open) && hhmm(o.close) ? [{ day, open: hhmm(o.open), close: hhmm(o.close) }] : [];
  });
}
function special(v: unknown): SpecialDay[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(o.date)) ? str(o.date) : '';
    if (!date) return [];
    const closed = o.closed === true || (!hhmm(o.open) && !hhmm(o.close));
    return [{ date, closed, open: closed ? '' : hhmm(o.open), close: closed ? '' : hhmm(o.close) }];
  });
}
function services(v: unknown): ServiceItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s) => { const o = (s ?? {}) as Record<string, unknown>; return str(o.name) ? [{ name: str(o.name), description: str(o.description) }] : []; });
}
function serviceArea(v: unknown): AreaValue {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as { type?: unknown; places?: unknown };
  const list = Array.isArray(v) ? v : Array.isArray(o.places) ? o.places : [];
  const places = list.map((p) => str(typeof p === 'object' && p ? (p as { name?: unknown }).name : p).trim()).filter(Boolean);
  return { type: o.type === 'CUSTOMER_AND_BUSINESS_LOCATION' || o.type === 'CUSTOMER_LOCATION_ONLY' ? o.type : null, places: [...new Set(places)].slice(0, 20) };
}
function attributes(v: unknown): AttributeValues {
  const out: AttributeValues = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, b] of Object.entries(v)) if (typeof b === 'boolean' && /^attributes\//.test(k)) out[k] = b;
  return out;
}
export function attributeItems(v: unknown): AttributeItem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a) => {
    const o = (a ?? {}) as Record<string, unknown>;
    return /^attributes\//.test(str(o.name)) && str(o.label) ? [{ name: str(o.name), label: str(o.label), group: str(o.group) }] : [];
  });
}
export function holidays(v: unknown): HolidaySuggestion[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((h) => {
    const o = (h ?? {}) as Record<string, unknown>;
    return /^\d{4}-\d{2}-\d{2}$/.test(str(o.date)) && str(o.name) ? [{ id: str(o.id) || `${str(o.name)}-${str(o.date)}`, name: str(o.name), date: str(o.date) }] : [];
  });
}
const NORMALIZE: { [K in FieldKey]: (v: unknown) => FieldValues[K] } = {
  website: str, description: str, phone: phones, hours, specialHours: special, services, serviceArea, attributes,
};
const STATUSES: FieldStatus[] = ['live', 'pending', 'google_changed', 'local_only'];

function field<K extends FieldKey>(key: K, raw: unknown): ProfileField<K> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const status = STATUSES.includes(o.status as FieldStatus) ? (o.status as FieldStatus) : 'local_only';
  return {
    ours: o.ours === null || o.ours === undefined ? null : NORMALIZE[key](o.ours),
    google: o.google === null || o.google === undefined ? null : NORMALIZE[key](o.google),
    status,
    error: typeof o.error === 'string' && o.error ? o.error : null,
  };
}

export function normalizeProfile(raw: unknown): GbpProfile {
  const b = (raw ?? {}) as Record<string, unknown>;
  const f = (b.fields ?? {}) as Record<string, unknown>;
  const fields: ProfileFields = {};
  for (const k of FIELD_KEYS) { const v = field(k, f[k]); if (v) (fields as Record<string, unknown>)[k] = v; }
  const m = (b.metadata ?? {}) as Record<string, unknown>;
  const ws = b.websiteSuggestion as Record<string, unknown> | null | undefined;
  return {
    syncEnabled: b.syncEnabled === true,
    location: typeof b.location === 'string' ? b.location : null,
    fields,
    metadata: { mapsUri: str(m.mapsUri) || null, newReviewUri: str(m.newReviewUri) || null },
    websiteSuggestion: ws && str(ws.url) ? { url: str(ws.url), current: str(ws.current) || null } : null,
    attributeItems: attributeItems(b.attributeItems),
    holidays: holidays(b.holidays),
    checkedAt: typeof b.checkedAt === 'string' ? b.checkedAt : null,
  };
}

const PHOTO_STATES: PhotoState[] = ['live', 'processing'];
export function normalizePhotos(raw: unknown): GbpPhoto[] {
  const list = Array.isArray((raw as { photos?: unknown })?.photos) ? (raw as { photos: unknown[] }).photos : [];
  return list.flatMap((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const url = str(o.url) || str(o.thumbUrl);
    if (!str(o.id) || !/^https?:\/\//.test(url)) return [];
    const st = str(o.state).toLowerCase();
    const state: PhotoState = PHOTO_STATES.includes(st as PhotoState) ? (st as PhotoState) : 'live';
    return [{ id: str(o.id), url, thumbUrl: /^https?:\/\//.test(str(o.thumbUrl)) ? str(o.thumbUrl) : url, category: str(o.category) || 'ADDITIONAL', createdAt: str(o.createdAt) || null, state }];
  });
}

// ── server ───────────────────────────────────────────────────────────────────

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; b: Record<string, unknown> | null }> {
  let r: Response;
  try {
    r = await authFetch(url, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new ProfileError(GENERIC_ERROR); }
  const b = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: r.ok, status: r.status, b };
}

function saveResult(key: FieldKey, res: { ok: boolean; status: number; b: Record<string, unknown> | null }): SaveResult {
  const code = typeof res.b?.code === 'string' ? res.b.code : null;
  const raw = res.b && typeof res.b.field === 'object' && res.b.field ? res.b.field : res.b;
  // sync_off: kept with us, nothing went to Google. It is a successful save either way.
  if (code === 'sync_off') {
    const f = field(key, raw);
    const m = typeof res.b?.message === 'string' && HEBREW.test(res.b.message) ? res.b.message : PROFILE.savedLocal;
    return f ? { ok: true, field: { ...f, status: 'local_only' }, localOnly: true, message: m } : { ok: false, code: 'error', message: m };
  }
  if (res.ok) {
    const f = field(key, raw);
    if (f) return { ok: true, field: f, localOnly: f.status === 'local_only', message: f.status === 'local_only' ? (f.error ?? PROFILE.savedLocal) : null };
    return { ok: false, code: 'error', message: GENERIC_ERROR };
  }
  if (code === 'invalid') return { ok: false, code, message: said(res.b) ?? PROFILE.invalid };
  if (code === 'google_rejected') {
    const why = typeof res.b?.googleMessage === 'string' ? res.b.googleMessage.slice(0, 200) : '';
    const base = said(res.b);
    return { ok: false, code, message: base ?? PROFILE.rejected(''), ...(why ? { detail: PROFILE.googleSaid(why) } : {}) };
  }
  if (code === 'quota' || res.status === 429) return { ok: false, code: 'quota', message: said(res.b) ?? PROFILE.quota };
  return { ok: false, code: 'error', message: said(res.b) ?? GENERIC_ERROR };
}

const fieldUrl = (k: FieldKey, tail = '') => `/api/seo/gbp/profile/${encodeURIComponent(k)}${tail}`;

export const serverProfileApi: ProfileApi = {
  profile: async () => {
    const r = await send('/api/seo/gbp/profile', 'GET');
    if (!r.ok || !r.b) throw new ProfileError(said(r.b) ?? GENERIC_ERROR, typeof r.b?.code === 'string' ? r.b.code : null);
    return normalizeProfile(r.b);
  },
  save: async (k, value) => {
    // phone travels as { primary, additional[] } (server: gbpSync.ts); everything else as is
    const body = k === 'phone' ? { primary: (value as string[])[0] ?? '', additional: (value as string[]).slice(1) } : value;
    return saveResult(k, await send(fieldUrl(k), 'PUT', { value: body }));
  },
  resolve: async (k, keep) => saveResult(k, await send(fieldUrl(k, '/resolve'), 'POST', { keep })),
  acceptWebsite: async () => {
    const r = await send('/api/seo/gbp/profile/website-from-page', 'POST');
    if (!r.ok) throw new ProfileError(said(r.b) ?? (r.b?.code === 'quota' ? PROFILE.quota : GENERIC_ERROR));
  },
  photos: async () => {
    const r = await send('/api/seo/gbp/photos', 'GET');
    if (!r.ok) throw new ProfileError(said(r.b) ?? GENERIC_ERROR);
    return normalizePhotos(r.b);
  },
  upload: async (file, category, onProgress) => {
    // XMLHttpRequest, not fetch: it reports upload progress.
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const form = new FormData();
    form.append('file', file);
    form.append('category', category);
    return new Promise<{ small: boolean }>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/seo/gbp/photos');
      if (token) x.setRequestHeader('Authorization', `Bearer ${token}`);
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onerror = () => reject(new ProfileError(GENERIC_ERROR));
      x.onload = () => {
        let b: Record<string, unknown> | null = null;
        try { b = JSON.parse(x.responseText) as Record<string, unknown>; } catch { /* no body */ }
        if (x.status >= 200 && x.status < 300) { onProgress(1); resolve({ small: b?.small === true }); return; }
        reject(new ProfileError(said(b) ?? (b?.code === 'quota' ? PROFILE.quota : PHOTOS.uploadFailed)));
      };
      x.send(form);
    });
  },
  addFromPage: async (url, category) => {
    const r = await send('/api/seo/gbp/photos', 'POST', { fromPageImage: url, category });
    if (!r.ok) throw new ProfileError(said(r.b) ?? (r.b?.code === 'quota' ? PROFILE.quota : PHOTOS.uploadFailed));
    return { small: r.b?.small === true };
  },
  remove: async (id) => {
    const r = await send(`/api/seo/gbp/photos/${encodeURIComponent(id)}`, 'DELETE');
    if (!r.ok) throw new ProfileError(said(r.b) ?? GENERIC_ERROR);
  },
};

/** The images of the business's own landing page, for "מדף הנחיתה". Never throws: [] = none to offer. */
export async function pageImages(slug: string): Promise<string[]> {
  try {
    const r = await authFetch(`/api/landing/${encodeURIComponent(slug)}`);
    if (!r.ok) return [];
    const b = (await r.json()) as Record<string, unknown>;
    let store: unknown = b.user_images ?? b.images ?? null;
    if (typeof store === 'string') { try { store = JSON.parse(store); } catch { store = null; } }
    const urls: string[] = [];
    const add = (v: unknown) => { if (typeof v === 'string' && /^https?:\/\//.test(v) && !urls.includes(v)) urls.push(v); };
    if (Array.isArray(store)) store.forEach(add);
    else if (store && typeof store === 'object') {
      const o = store as Record<string, unknown>;
      add(o.hero_image_url);
      for (const k of ['icon_urls', 'gallery_urls']) if (Array.isArray(o[k])) (o[k] as unknown[]).forEach(add);
    }
    return urls.slice(0, 12);
  } catch { return []; }
}

// ── preview ──────────────────────────────────────────────────────────────────

const SAMPLE_IMG = (n: number) => `https://images.unsplash.com/photo-${['1581092160562-40aa08e78837', '1504328345606-18bbc8c9d7d1', '1621905251189-08b45d6a269e', '1558618666-fcd25c85cd64'][n % 4]}?w=480&q=60`;

const SAMPLE_AREAS = ['חיפה', 'קריית ביאליק', 'קריית מוצקין', 'קריית אתא', 'נשר', 'טירת כרמל'];
const SAMPLE_ATTRIBUTES: AttributeItem[] = [
  { name: 'attributes/has_wheelchair_accessible_entrance', label: 'כניסה נגישה לכיסא גלגלים', group: 'נגישות' },
  { name: 'attributes/has_wheelchair_accessible_parking_lot', label: 'חניה נגישה', group: 'נגישות' },
  { name: 'attributes/has_wheelchair_accessible_restroom', label: 'שירותים נגישים', group: 'נגישות' },
  { name: 'attributes/pay_credit_card', label: 'כרטיסי אשראי', group: 'תשלומים' },
  { name: 'attributes/pay_debit_card', label: 'כרטיסי חיוב', group: 'תשלומים' },
  { name: 'attributes/pay_mobile_nfc', label: 'תשלום בנייד', group: 'תשלומים' },
  { name: 'attributes/offers_onsite_services', label: 'שירות בבית הלקוח', group: 'שירותים' },
  { name: 'attributes/requires_appointments', label: 'בתיאום מראש', group: 'שירותים' },
  { name: 'attributes/has_free_parking_lot', label: 'חניה חינם בחניון', group: 'חניה' },
];
const SAMPLE_ATTRS_OURS: AttributeValues = {
  'attributes/has_wheelchair_accessible_entrance': true, 'attributes/pay_credit_card': true, 'attributes/pay_debit_card': true,
  'attributes/offers_onsite_services': true, 'attributes/requires_appointments': true, 'attributes/has_free_parking_lot': false,
};
const SAMPLE_HOLIDAYS: HolidaySuggestion[] = [
  { id: 'pesach-2027-04-22', name: 'פסח', date: '2027-04-22' },
  { id: 'pesach7-2027-04-28', name: 'שביעי של פסח', date: '2027-04-28' },
  { id: 'independence-2027-05-12', name: 'יום העצמאות', date: '2027-05-12' },
  { id: 'shavuot-2027-06-11', name: 'שבועות', date: '2027-06-11' },
];

/** Preview: the same calls over a sample in memory. `&profile=off` shows the screen with sync switched off. */
export function sampleProfileApi(): ProfileApi {
  const off = sampleFlag('profile') === 'off';
  const st = (s: FieldStatus): FieldStatus => (off ? 'local_only' : s);
  const p: GbpProfile = {
    syncEnabled: !off, location: 'locations/1', checkedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    metadata: { mapsUri: 'https://maps.google.com/?cid=1', newReviewUri: 'https://g.page/r/CSample1234/review' },
    websiteSuggestion: sampleFlag('website') === 'replace' ? { url: 'https://dudi.pagey.co.il', current: 'https://old-site.co.il' } : null,
    attributeItems: SAMPLE_ATTRIBUTES,
    // The sample's "today" for the holidays is 22.3.2027, so the suggestions are there whenever it is looked at.
    holidays: sampleFlag('holidays') === 'none' ? [] : SAMPLE_HOLIDAYS,
    fields: {
      website: { ours: 'https://dudi.pagey.co.il', google: off ? '' : 'https://dudi.pagey.co.il', status: st('live'), error: null },
      description: { ours: 'אינסטלטור מוסמך בחיפה והקריות. מגיעים מהר, נותנים הצעת מחיר לפני שמתחילים, ומשאירים את הבית נקי.', google: 'אינסטלטור בחיפה.', status: st('pending'), error: null },
      phone: { ours: ['04-8123456'], google: ['04-8123456'], status: st('live'), error: null },
      hours: {
        ours: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'].map((day) => ({ day: day as Day, open: '08:00', close: '18:00' })),
        google: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'].map((day) => ({ day: day as Day, open: '08:00', close: '17:00' })),
        status: st('google_changed'), error: null,
      },
      specialHours: { ours: [{ date: '2026-12-25', closed: true, open: '', close: '' }], google: [], status: st(sampleFlag('special') === 'error' ? 'local_only' : 'pending'), error: sampleFlag('special') === 'error' ? 'גוגל לא קיבלה את השינוי: צריך להגדיר קודם שעות פעילות רגילות.' : null },
      services: { ours: [{ name: 'פתיחת סתימות', description: 'במטבח, באמבטיה ובשירותים' }, { name: 'החלפת דוד שמש', description: '' }], google: [{ name: 'פתיחת סתימות', description: 'במטבח, באמבטיה ובשירותים' }, { name: 'החלפת דוד שמש', description: '' }], status: st('live'), error: null },
      serviceArea: {
        ours: { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: SAMPLE_AREAS },
        google: { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: sampleFlag('area') === 'changed' ? [...SAMPLE_AREAS.slice(0, 4), 'עכו'] : SAMPLE_AREAS },
        status: st(sampleFlag('area') === 'changed' ? 'google_changed' : 'live'), error: null,
      },
      attributes: {
        ours: SAMPLE_ATTRS_OURS,
        google: sampleFlag('attrs') === 'changed' ? { ...SAMPLE_ATTRS_OURS, 'attributes/has_wheelchair_accessible_entrance': false, 'attributes/pay_mobile_nfc': true } : SAMPLE_ATTRS_OURS,
        status: st(sampleFlag('attrs') === 'changed' ? 'google_changed' : 'live'), error: null,
      },
    },
  };
  let photos: GbpPhoto[] = sampleFlag('photos') === 'none' ? [] : [
    { id: 'm1', url: SAMPLE_IMG(0), thumbUrl: SAMPLE_IMG(0), category: 'COVER', createdAt: new Date().toISOString(), state: 'live' },
    { id: 'm2', url: SAMPLE_IMG(1), thumbUrl: SAMPLE_IMG(1), category: 'AT_WORK', createdAt: new Date().toISOString(), state: 'live' },
    { id: 'm3', url: SAMPLE_IMG(2), thumbUrl: SAMPLE_IMG(2), category: 'PRODUCT', createdAt: new Date().toISOString(), state: 'processing' },
    { id: 'm4', url: SAMPLE_IMG(3), thumbUrl: SAMPLE_IMG(3), category: 'ADDITIONAL', createdAt: new Date().toISOString(), state: 'live' },
  ];
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    profile: async () => copy(p),
    save: async (k, value) => {
      await wait(500);
      if (k === 'website' && value && !/^https:\/\//.test(String(value))) return { ok: false, code: 'invalid', message: 'כתובת אתר צריכה להתחיל ב-https://' };
      const f = { ours: value, google: off ? (p.fields[k]?.google ?? null) : value, status: (off ? 'local_only' : 'pending') as FieldStatus, error: null };
      (p.fields as Record<string, unknown>)[k] = f;
      return { ok: true, field: copy(f) as ProfileField, localOnly: off, message: off ? PROFILE.savedLocal : null };
    },
    resolve: async (k, keep) => {
      await wait(400);
      const cur = p.fields[k] as ProfileField | undefined;
      if (!cur) return { ok: false, code: 'error', message: GENERIC_ERROR };
      const f: ProfileField = keep === 'google' ? { ...cur, ours: cur.google, status: 'live' } : { ...cur, google: cur.ours, status: 'pending' };
      (p.fields as Record<string, unknown>)[k] = f;
      return { ok: true, field: copy(f), localOnly: false, message: null };
    },
    acceptWebsite: async () => { await wait(400); if (p.websiteSuggestion) p.fields.website = { ours: p.websiteSuggestion.url, google: p.websiteSuggestion.url, status: 'pending', error: null }; p.websiteSuggestion = null; },
    photos: async () => copy(photos),
    upload: async (file, category, onProgress) => {
      for (let i = 1; i <= 5; i++) { await wait(250); onProgress(i / 5); }
      const url = URL.createObjectURL(file);
      photos = [{ id: `u${photos.length}`, url, thumbUrl: url, category, createdAt: new Date().toISOString(), state: 'processing' }, ...photos];
      return { small: false };
    },
    addFromPage: async (url, category) => { await wait(600); photos = [{ id: `pg${photos.length}`, url, thumbUrl: url, category, createdAt: new Date().toISOString(), state: 'processing' }, ...photos]; return { small: false }; },
    remove: async (id) => { await wait(300); photos = photos.filter((x) => x.id !== id); },
  };
}
