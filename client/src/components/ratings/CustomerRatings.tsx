import { useEffect, useState } from 'react';
import { StarsView } from './Stars';
import { fetchPublic, type PublicSummary, type RatingProduct } from './ratingsApi';

/**
 * Public ratings block. Renders nothing until the product has at least 3 approved ratings (the
 * server decides: `show`). Every approved rating is published, good or bad, word for word.
 */
export default function CustomerRatings({ product, className = '' }: { product: RatingProduct; className?: string }) {
  const [data, setData] = useState<PublicSummary | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchPublic(product).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [product]);

  if (!data?.show || data.average == null) return null;
  return (
    <section className={`px-5 py-16 sm:py-20 ${className}`} aria-labelledby={`ratings-${product}`}>
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id={`ratings-${product}`} className="text-2xl font-black tracking-tight text-[#0E2148] sm:text-3xl">דירוגים של לקוחות Pagey</h2>
            <p className="mt-2 max-w-xl text-slate-600">
              כל דירוג שמגיע מלקוח אמיתי מתפרסם כאן כפי שנכתב, גם כשהוא לא מחמיא. אנחנו רק מסננים פרטים אישיים ופגיעה.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
            <span className="text-3xl font-black text-[#0E2148]">{data.average.toFixed(1)}</span>
            <span>
              <StarsView value={data.average} />
              <span className="block text-xs text-slate-500">{data.count} דירוגים</span>
            </span>
          </div>
        </div>
        {data.ratings.length > 0 && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.ratings.map((r, i) => (
              <li key={`${r.date}-${i}`} className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <StarsView value={r.stars} />
                {r.text && <p className="mt-3 flex-1 leading-relaxed text-slate-700">{r.text}</p>}
                <p className="mt-4 text-sm font-bold text-slate-900">{r.name}</p>
                {r.businessType && <p className="text-xs text-slate-500">{r.businessType}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
