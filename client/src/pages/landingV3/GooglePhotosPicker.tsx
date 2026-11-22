// "תמונות מהכרטיס בגוגל": the editor's picker of the photos on the business's Google listing (README part 143).
// Nothing reaches the page without the owner's click: a listing can also hold photos that are not the owner's.
// The picked photos go through the page's own pipeline on the server (sizes, focal point, alt text, quality note).
import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { authFetch } from '../../lib/api';

export interface GooglePhotoItem { id: string; thumbUrl: string; category: string; onPage: boolean }
export interface GooglePhotosApi {
  list(): Promise<{ linked: boolean; photos: GooglePhotoItem[]; free: number }>;
  add(ids: string[]): Promise<{ user_images: string; added: number; warnings: string[] }>;
}

const said = async (r: Response, fallback: string) => {
  const b = await r.json().catch(() => null) as { error?: unknown } | null;
  return typeof b?.error === 'string' && /[֐-׿]/.test(b.error) ? b.error : fallback;
};

export const serverGooglePhotos = (pageId: string): GooglePhotosApi => ({
  async list() {
    const r = await authFetch(`/api/landing/${pageId}/google-photos`);
    if (!r.ok) throw new Error(await said(r, 'לא הצלחנו לטעון את התמונות מגוגל. נסו שוב.'));
    return r.json();
  },
  async add(ids) {
    const r = await authFetch(`/api/landing/${pageId}/google-photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!r.ok) throw new Error(await said(r, 'לא הצלחנו להוסיף את התמונות. נסו שוב.'));
    return r.json();
  },
});

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; photos: GooglePhotoItem[]; free: number };

export function GooglePhotosPicker({ api, onClose, onAdded, primaryColor }: {
  api: GooglePhotosApi; onClose: () => void; primaryColor: string;
  onAdded: (userImages: string, added: number, warning: string | null) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    setLoad({ state: 'loading' });
    api.list().then(
      (d) => { if (alive) setLoad({ state: 'ok', photos: d.photos, free: d.free }); },
      (e) => { if (alive) setLoad({ state: 'error', message: e instanceof Error ? e.message : 'לא הצלחנו לטעון את התמונות מגוגל. נסו שוב.' }); },
    );
    return () => { alive = false; };
  }, [api, tick]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const free = load.state === 'ok' ? load.free : 0;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < free ? [...p, id] : p));

  async function add() {
    if (!picked.length || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.add(picked);
      onAdded(r.user_images, r.added, r.warnings[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא הצלחנו להוסיף את התמונות. נסו שוב.');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="gpick-title" dir="rtl"
        className="relative w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden">
        <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: primaryColor }} />
        <div className="px-5 sm:px-6 pt-5 pb-3 flex items-start justify-between gap-4 shrink-0">
          <div>
            <h3 id="gpick-title" className="text-lg font-extrabold text-slate-900">תמונות מהכרטיס בגוגל</h3>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">בחרו תמונות להוספה לגלריה של הדף. רק מה שתבחרו יתווסף.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy} aria-label="סגירה"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition disabled:opacity-50">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 sm:px-6 pb-4 overflow-y-auto grow">
          {load.state === 'loading' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" aria-busy="true" aria-label="טוען">
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="aspect-[4/3] rounded-2xl bg-slate-100 animate-pulse" />)}
            </div>
          )}
          {load.state === 'error' && (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-center justify-between gap-3" role="alert">
              <span>{load.message}</span>
              <button type="button" className="min-h-[44px] px-4 rounded-xl bg-white border border-red-200 font-bold" onClick={() => setTick((t) => t + 1)}>ניסיון חוזר</button>
            </div>
          )}
          {load.state === 'ok' && load.photos.length === 0 && (
            <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">עוד אין תמונות בכרטיס שלכם בגוגל.</p>
          )}
          {load.state === 'ok' && load.photos.length > 0 && (
            <>
              {free === 0 && <p className="mb-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">הגלריה מלאה (12 תמונות). כדי להוסיף, הסירו קודם תמונה מהגלריה.</p>}
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {load.photos.map((p) => {
                  const on = picked.includes(p.id);
                  const disabled = p.onPage || (!on && picked.length >= free);
                  return (
                    <li key={p.id}>
                      <button type="button" aria-pressed={on} disabled={disabled} onClick={() => toggle(p.id)}
                        className={`relative block w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 ring-offset-2 transition ${on ? 'ring-4' : 'ring-0'} ${disabled && !p.onPage ? 'opacity-50' : ''}`}
                        style={on ? { ['--tw-ring-color' as string]: primaryColor } : undefined}>
                        <img src={p.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        {on && <span className="absolute top-2 left-2 w-8 h-8 rounded-full flex items-center justify-center text-white bg-slate-900 shadow"><Check size={18} /></span>}
                        {p.onPage && <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-xs font-bold py-1.5 text-center">כבר בדף</span>}
                        <span className="sr-only">{p.onPage ? 'התמונה כבר בדף' : on ? 'נבחרה' : 'בחירה'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-4 text-xs text-slate-500 leading-relaxed">אם בכרטיס יש תמונות שלקוחות צילמו, בחרו רק תמונות שלכם או כאלה שקיבלתם אישור להציג.</p>
            </>
          )}
          {error && <p className="mt-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex items-center gap-3 shrink-0 bg-white">
          <button type="button" onClick={() => void add()} disabled={!picked.length || busy}
            className="min-h-[48px] px-6 rounded-2xl font-extrabold text-white bg-slate-900 hover:bg-slate-800 transition disabled:opacity-40">
            {busy ? 'מוסיפים…' : picked.length ? `הוספה לגלריה (${picked.length})` : 'הוספה לגלריה'}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="min-h-[48px] px-4 rounded-2xl font-bold text-slate-600 hover:bg-slate-100">ביטול</button>
        </div>
      </div>
    </div>
  );
}
