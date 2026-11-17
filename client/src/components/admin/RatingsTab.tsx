import { useState } from 'react';
import { Card, State } from './adminUi';
import { useAdminData, type Fetcher } from './adminData';
import { StarsView } from '../ratings/Stars';

interface Row {
  id: string; email: string; product: 'pages' | 'seo'; stars: number; text: string; display_name: string; business_type: string;
  consent_publish: boolean; status: 'pending' | 'approved' | 'rejected'; updated_at: string;
}
const PRODUCT = { pages: 'דפים', seo: 'קידום בגוגל' } as const;
const STATUS = { pending: 'ממתין', approved: 'מאושר', rejected: 'נדחה' } as const;

/**
 * Approve or reject only; a customer's words are never edited. Policy: approve every real customer's
 * rating, low or high. Reject only abuse, personal details of others, or a rating that is not real.
 */
export default function RatingsTab({ adminFetch }: { adminFetch: Fetcher }) {
  const { data, error, loading, reload } = useAdminData<{ ratings: Row[] }>(adminFetch, '/api/admin/ratings');
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, what: 'approve' | 'reject') => {
    setBusy(id);
    await adminFetch(`/api/admin/ratings/${id}/${what}`, { method: 'POST' }).catch(() => null);
    setBusy(null); reload();
  };
  if (!data) return <State loading={loading} error={error} retry={reload} />;
  const pending = data.ratings.filter((r) => r.status === 'pending').length;
  return (
    <Card title={`דירוגי לקוחות (${data.ratings.length}, ${pending} ממתינים)`} sub="מאשרים כל דירוג של לקוח אמיתי, גם נמוך. דוחים רק פגיעה, פרטים אישיים של אחרים או דירוג לא אמיתי. אי אפשר לערוך את הטקסט.">
      {data.ratings.length === 0 ? <p className="px-5 py-4 text-sm text-slate-400">אין עדיין דירוגים.</p> : (
        <ul className="divide-y divide-slate-100">
          {data.ratings.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <StarsView value={r.stars} size={14} />
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{PRODUCT[r.product]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${r.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : r.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{STATUS[r.status]}</span>
                  {!r.consent_publish && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">בלי הסכמה לפרסום (נספר בממוצע בלבד)</span>}
                </p>
                {r.text && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-800">{r.text}</p>}
                <p className="mt-1 text-xs text-slate-500">{r.display_name || 'בלי שם'}{r.business_type ? ` · ${r.business_type}` : ''} · <span dir="ltr">{r.email}</span> · {r.updated_at.slice(0, 10)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" disabled={busy === r.id || r.status === 'approved'} onClick={() => act(r.id, 'approve')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">אישור</button>
                <button type="button" disabled={busy === r.id || r.status === 'rejected'} onClick={() => act(r.id, 'reject')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-40">דחייה</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
