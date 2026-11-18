import { useState } from 'react';
import { Card } from './adminUi';
import { day, ils, useAdminData, type Fetcher } from './adminData';

// Refunds owed after a cancel inside the 14-day window (decision 17.11, migration 051). The server never
// refunds: Moshe refunds in the SUMIT dashboard, then marks the request here.

interface RefundRow {
  id: string; email: string; sumit_payment_id: string | null; amount: number;
  requested_at: string; status: 'pending' | 'refunded' | 'rejected'; handled_at: string | null; note: string | null;
}

const STATUS: Record<RefundRow['status'], string> = { pending: 'החזר ממתין', refunded: 'הוחזר', rejected: 'נדחה' };

export default function RefundsPanel({ adminFetch }: { adminFetch: Fetcher }) {
  const { data, error, reload } = useAdminData<{ refunds: RefundRow[] }>(adminFetch, '/api/admin/seo/refunds');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  async function mark(id: string, status: 'refunded' | 'rejected') {
    setBusy(id); setMsg('');
    try {
      const r = await adminFetch(`/api/admin/seo/refunds/${id}/handled`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const b = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) setMsg(b.error ?? 'השמירה נכשלה.');
      reload();
    } catch { setMsg('השמירה נכשלה.'); } finally { setBusy(null); }
  }

  const rows = data?.refunds ?? [];
  const pending = rows.filter((r) => r.status === 'pending');
  return (
    <Card title="החזרים" sub="ביטול בתוך 14 יום מהתשלום הראשון. מחזירים בדשבורד של סאמיט, ואז מסמנים כאן.">
      {error && !data ? <p className="px-5 py-4 text-sm text-slate-400">{error}</p> : rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-400">אין בקשות החזר.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{ils(Number(r.amount))} · <span dir="ltr">{r.email}</span></p>
                <p className="text-xs text-slate-500">
                  {day(r.requested_at)} · תשלום בסאמיט: <span dir="ltr">{r.sumit_payment_id ?? '—'}</span> · {STATUS[r.status]}
                  {r.handled_at ? ` (${day(r.handled_at)})` : ''}
                </p>
              </div>
              {r.status === 'pending' && (
                <div className="flex gap-2">
                  <button type="button" disabled={busy === r.id} onClick={() => mark(r.id, 'refunded')}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">סומן כהוחזר</button>
                  <button type="button" disabled={busy === r.id} onClick={() => mark(r.id, 'rejected')}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-50">נדחה</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && <p className="px-5 py-3 text-sm text-amber-700 border-t border-slate-100">{pending.length} החזרים ממתינים.</p>}
      {msg && <p role="alert" className="px-5 py-2 text-sm text-red-600">{msg}</p>}
    </Card>
  );
}
