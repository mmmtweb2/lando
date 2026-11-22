// "מחובר לדף שלכם" in "הכרטיס בגוגל" (README part 143): what the business's landing page and its Google listing
// share (website, photos, reviews), and the two quiet settings (website link, photos). Everything is automatic by
// default; the settings are there to turn things off. Server: GET /api/seo/gbp/page-link,
// POST /api/seo/gbp/page-link/photos, PUT /api/seo/automation {websiteMode|photosMode}.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Images, Link2, Star } from 'lucide-react';
import { authFetch } from '../../../lib/api';
import { GENERIC_ERROR } from '../autopilotCopy';
import { LoadError, Notice } from './bits';
import { sampleFlag } from './sample';

export type Mode = 'auto' | 'ask' | 'off';
export interface PageLink {
  linked: boolean;
  ready: boolean;
  syncEnabled: boolean;
  page: { id: string; url: string; status: string } | null;
  websiteMode: Mode;
  photosMode: Mode;
  website: { onListing: boolean };
  photos: { sent: number; fromGoogle: number; pending: Array<{ url: string; thumb: string }> };
  reviews: { state: 'shown' | 'hidden' | 'below' | 'waiting' | 'not_active'; rating: number | null; count: number | null; minCount: number; minRating: number };
}

export interface PageLinkApi {
  get(): Promise<PageLink>;
  setMode(patch: { websiteMode?: Mode; photosMode?: Mode }): Promise<void>;
  sendPhotos(): Promise<number>;
}

const hebrew = (b: unknown) => (typeof (b as { error?: unknown })?.error === 'string' && /[֐-׿]/.test((b as { error: string }).error) ? (b as { error: string }).error : null);

export const serverPageLinkApi: PageLinkApi = {
  async get() {
    const r = await authFetch('/api/seo/gbp/page-link');
    const b = await r.json().catch(() => null);
    if (!r.ok || !b) throw new Error(hebrew(b) ?? GENERIC_ERROR);
    return b as PageLink;
  },
  async setMode(patch) {
    const r = await authFetch('/api/seo/automation', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!r.ok) throw new Error(hebrew(await r.json().catch(() => null)) ?? GENERIC_ERROR);
  },
  async sendPhotos() {
    const r = await authFetch('/api/seo/gbp/page-link/photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const b = await r.json().catch(() => null) as { queued?: number } | null;
    if (!r.ok) throw new Error(hebrew(b) ?? GENERIC_ERROR);
    return b?.queued ?? 0;
  },
};

/** Preview: `&link=none` not linked, `&link=below` reviews under the threshold, `&link=ask` photos waiting for a click. */
export function samplePageLinkApi(): PageLinkApi {
  const v = sampleFlag('link');
  const img = (id: string) => `https://images.unsplash.com/photo-${id}?w=240&q=60`;
  const s: PageLink = {
    linked: v !== 'none', ready: true, syncEnabled: sampleFlag('profile') !== 'off',
    page: v === 'none' ? null : { id: 'p1', url: 'https://dudi.pagey.co.il', status: 'published' },
    websiteMode: 'auto', photosMode: v === 'ask' ? 'ask' : 'auto',
    website: { onListing: v !== 'none' },
    photos: { sent: 3, fromGoogle: 2, pending: v === 'ask' ? [{ url: 'a', thumb: img('1581092160562-40aa08e78837') }, { url: 'b', thumb: img('1504328345606-18bbc8c9d7d1') }] : [] },
    reviews: v === 'below'
      ? { state: 'below', rating: null, count: null, minCount: 5, minRating: 4.3 }
      : { state: v === 'none' ? 'not_active' : 'shown', rating: 4.8, count: 37, minCount: 5, minRating: 4.3 },
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    get: async () => JSON.parse(JSON.stringify(s)) as PageLink,
    setMode: async (patch) => { await wait(300); Object.assign(s, patch); },
    sendPhotos: async () => { await wait(400); const n = s.photos.pending.length; s.photos.sent += n; s.photos.pending = []; return n; },
  };
}

const MODE_LABEL: Record<'website' | 'photos', Record<Mode, string>> = {
  website: { auto: 'אוטומטי', ask: 'לשאול אותי', off: 'כבוי' },
  photos: { auto: 'אוטומטי', ask: 'לשאול אותי', off: 'כבוי' },
};

function ModeSelect({ id, label, value, disabled, onPick, kind }: { id: string; label: string; value: Mode; disabled: boolean; onPick: (m: Mode) => void; kind: 'website' | 'photos' }) {
  return (
    <label className="dv3-pl-mode" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onPick(e.target.value as Mode)}>
        {(['auto', 'ask', 'off'] as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[kind][m]}</option>)}
      </select>
    </label>
  );
}

const fmt = (n: number) => n.toLocaleString('he-IL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function PageLinkSection({ preview }: { preview: boolean }) {
  const api = useMemo(() => (preview ? samplePageLinkApi() : serverPageLinkApi), [preview]);
  const [data, setData] = useState<{ status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; d: PageLink }>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get().then((d) => alive && setData({ status: 'ok', d }), (e) => alive && setData({ status: 'error', error: e instanceof Error ? e.message : GENERIC_ERROR }));
    return () => { alive = false; };
  }, [api, tick]);

  const setMode = useCallback(async (patch: { websiteMode?: Mode; photosMode?: Mode }) => {
    setBusy(true); setNote(null);
    try {
      await api.setMode(patch);
      setData((x) => (x.status === 'ok' ? { status: 'ok', d: { ...x.d, ...patch } } : x));
      setNote({ kind: 'ok', text: 'נשמר.' });
    } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : GENERIC_ERROR }); }
    finally { setBusy(false); }
  }, [api]);

  const send = useCallback(async () => {
    setBusy(true); setNote(null);
    try {
      const n = await api.sendPhotos();
      setNote({ kind: 'ok', text: n ? `${n === 1 ? 'התמונה נשלחת' : `${n} התמונות נשלחות`} לכרטיס בגוגל. גוגל בודקת כל תמונה לפני שהיא מוצגת.` : 'אין תמונות חדשות לשליחה.' });
      setTick((t) => t + 1);
    } catch (e) { setNote({ kind: 'error', text: e instanceof Error ? e.message : GENERIC_ERROR }); }
    finally { setBusy(false); }
  }, [api]);

  if (data.status === 'loading') return null;   // the rest of the screen does not wait for this block
  if (data.status === 'error') return <section className="dv4-card dv3-pl"><LoadError text={data.error} onRetry={() => setTick((t) => t + 1)} /></section>;
  const d = data.d;
  if (!d.page) return null;   // no page yet: nothing to connect

  const reviewsLine = (() => {
    const r = d.reviews;
    if (r.state === 'shown') return `מוצגות בדף: ${fmt(r.rating ?? 0)} מתוך 5, ${(r.count ?? 0).toLocaleString('he-IL')} ביקורות. אפשר להסתיר אותן בעריכת הדף.`;
    if (r.state === 'hidden') return 'הסתרתם אותן בדף. אפשר להחזיר אותן בעריכת הדף.';
    if (r.state === 'below') return `יופיעו בדף מ-${r.minCount} ביקורות ודירוג ${fmt(r.minRating)} ומעלה.`;
    if (r.state === 'waiting') return 'קוראים את הביקורות מגוגל. הן יופיעו בדף בקרוב.';
    return d.ready ? 'יופיעו בדף אחרי שהכרטיס בגוגל יהיה מחובר.' : 'יופעל בקרוב.';
  })();
  const photosLine = d.photosMode === 'off'
    ? 'תמונות חדשות בדף לא נשלחות לגוגל.'
    : `${d.photos.sent ? `${d.photos.sent} תמונות מהדף נוספו לכרטיס. ` : ''}${d.photosMode === 'auto' && d.syncEnabled ? 'תמונה חדשה שתעלו לדף תתווסף גם לכרטיס.' : 'תמונה חדשה שתעלו לדף תחכה כאן לאישור שלכם.'}${d.photos.fromGoogle ? ` ${d.photos.fromGoogle} תמונות מהכרטיס כבר בדף.` : ''}`;

  return (
    <section className="dv4-card dv3-pl" aria-labelledby="dv3-pl-title">
      <div className="dv4-card-head"><h3 id="dv3-pl-title"><Link2 size={18} aria-hidden /> מחובר לדף שלכם</h3></div>
      {!d.linked ? (
        <p className="dv3-a-hint">הדף שלכם יתחבר לכרטיס בגוגל ברגע שהכרטיס יהיה מחובר: האתר, התמונות והביקורות יעברו ביניהם לבד.</p>
      ) : (
        <ul className="dv3-pl-list">
          <li>
            <Globe size={18} aria-hidden />
            <div>
              <strong>אתר</strong>
              <p>{d.website.onListing ? 'הדף מופיע כאתר בכרטיס שלכם בגוגל.' : d.websiteMode === 'off' ? 'הדף לא נשלח לגוגל כאתר.' : 'הדף יופיע כאתר בכרטיס כשהוא יתפרסם.'}</p>
              <ModeSelect id="dv3-pl-web" kind="website" label="קישור הדף בכרטיס" value={d.websiteMode} disabled={busy} onPick={(m) => void setMode({ websiteMode: m })} />
            </div>
          </li>
          <li>
            <Images size={18} aria-hidden />
            <div>
              <strong>תמונות</strong>
              <p>{photosLine}</p>
              <p className="dv3-a-hint">תמונות מהכרטיס מוסיפים לדף בעריכת הדף, בכפתור "תמונות מהכרטיס בגוגל".</p>
              {d.photos.pending.length > 0 && d.photosMode !== 'off' && (
                <div className="dv3-pl-pending">
                  <ul aria-label="תמונות מהדף שעוד לא בכרטיס">{d.photos.pending.slice(0, 6).map((p) => <li key={p.url}><img src={p.thumb} alt="" loading="lazy" /></li>)}</ul>
                  {d.syncEnabled
                    ? <button type="button" className="dv3-btn" disabled={busy} onClick={() => void send()}>{d.photos.pending.length === 1 ? 'הוספת התמונה לכרטיס' : `הוספת ${d.photos.pending.length} התמונות לכרטיס`}</button>
                    : <p className="dv3-a-hint">התמונות יתווספו לכרטיס כשההעברה האוטומטית לגוגל תופעל.</p>}
                </div>
              )}
              <ModeSelect id="dv3-pl-photos" kind="photos" label="תמונות חדשות מהדף לכרטיס" value={d.photosMode} disabled={busy || !d.ready} onPick={(m) => void setMode({ photosMode: m })} />
            </div>
          </li>
          <li>
            <Star size={18} aria-hidden />
            <div>
              <strong>ביקורות</strong>
              <p>{reviewsLine}</p>
            </div>
          </li>
        </ul>
      )}
      <div aria-live="polite" className="dv3-a-live">{note && <Notice kind={note.kind}>{note.text}</Notice>}</div>
    </section>
  );
}
