import { useCallback, useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import RatingForm from './RatingForm';
import { StarsView } from './Stars';
import { PRODUCT_LABEL, dismissAsk, fetchMine, type MyRatings, type RatingProduct } from './ratingsApi';

const STATUS_LABEL = { pending: 'ממתין לבדיקה', approved: 'מוצג באתר', rejected: 'לא יוצג באתר' } as const;

/**
 * variant "ask": one quiet card in the dashboard, only when the server says it is the right moment
 * (a page was published / 30 days with the Google-promotion product), never after "not now".
 * variant "settings": the customer's own ratings, always reachable from settings, to add or edit.
 */
export default function RatingAsk({ variant = 'ask' }: { variant?: 'ask' | 'settings' }) {
  const [mine, setMine] = useState<MyRatings | null>(null);
  const [open, setOpen] = useState<RatingProduct | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => { void fetchMine().then(setMine); }, []);
  useEffect(load, [load]);

  if (!mine) return null;
  const products = (Object.keys(mine) as RatingProduct[]).filter((p) => mine[p]?.eligible);
  const form = open && <RatingForm product={open} initial={mine[open].rating} onClose={() => setOpen(null)} onSaved={load} />;

  if (variant === 'settings') {
    if (!products.length) return null;
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="הדירוג שלכם">
        <h3 className="font-bold text-slate-900">הדירוג שלכם</h3>
        <p className="mt-1 text-sm text-slate-500">דירוג מוצג באתר רק אם הסכמתם, ורק אחרי בדיקה קצרה. אנחנו לא עורכים את המילים שלכם.</p>
        <ul className="mt-3 divide-y divide-slate-100">
          {products.map((p) => {
            const r = mine[p].rating;
            return (
              <li key={p} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{PRODUCT_LABEL[p]}</p>
                  {r ? (
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500"><StarsView value={r.stars} size={13} />{r.consentPublish ? STATUS_LABEL[r.status] : 'לא יוצג באתר (בלי הסכמה)'}</p>
                  ) : <p className="mt-0.5 text-xs text-slate-500">עוד לא דירגתם</p>}
                </div>
                <button type="button" onClick={() => setOpen(p)} className="min-h-[44px] rounded-full border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300">
                  {r ? 'עריכת הדירוג' : 'לדרג'}
                </button>
              </li>
            );
          })}
        </ul>
        {form}
      </section>
    );
  }

  const p = products.find((x) => mine[x].ask);
  if (!p || hidden) return form || null;
  const notNow = () => { setHidden(true); void dismissAsk(p); };
  return (
    <>
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4" role="region" aria-label="בקשה לדירוג">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600"><Star size={20} aria-hidden className="fill-amber-400" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900">איך היה עד עכשיו?</p>
          <p className="text-sm text-slate-600">דרגו את {PRODUCT_LABEL[p]} בחצי דקה. זה עוזר לבעלי עסקים אחרים, ולנו.</p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
          <button type="button" onClick={() => setOpen(p)} className="min-h-[40px] rounded-full bg-[#2E63F6] px-4 text-sm font-bold text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300">לדרג</button>
          <button type="button" onClick={notNow} className="min-h-[40px] rounded-full px-3 text-sm text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300">לא עכשיו</button>
        </div>
        <button type="button" onClick={notNow} aria-label="סגירה" className="hidden rounded-full p-1 text-slate-400 hover:bg-amber-100 sm:block"><X size={16} aria-hidden /></button>
      </div>
      {form}
    </>
  );
}
