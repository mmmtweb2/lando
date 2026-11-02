import { useCallback, useEffect, useState } from 'react';

interface Grant { email: string; status: string; source: string; current_period_end: string | null; started_at: string; active: boolean }
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function endText(g: Grant): string {
  if (g.source === 'sumit') return 'מנוי משלם';
  if (!g.active) return 'הסתיים';
  return g.current_period_end ? `עד ${new Date(g.current_period_end).toLocaleDateString('he-IL')}` : 'ללא הגבלה';
}

/** Admin: free access to the Google-promotion product for testers. Same row an SQL grant would write. */
export default function BetaAccessPanel({ adminFetch }: { adminFetch: Fetcher }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('60');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    adminFetch('/api/admin/beta-access')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('טעינת הרשימה נכשלה'))))
      .then((b: { grants: Grant[] }) => setGrants(b.grants ?? []))
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [adminFetch]);
  useEffect(load, [load]);

  async function post(path: string, body: Record<string, unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await adminFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) { setMsg({ ok: false, text: b.error ?? 'הפעולה נכשלה.' }); return; }
      setMsg({ ok: true, text: okText }); load();
    } catch { setMsg({ ok: false, text: 'הפעולה נכשלה.' }); } finally { setBusy(false); }
  }

  const grant = (e: React.FormEvent) => {
    e.preventDefault();
    const d = days.trim() === '' ? null : Number(days);
    void post('/api/admin/beta-access', { email: email.trim(), days: d }, `הגישה ניתנה ל-${email.trim()}.`).then(() => setEmail(''));
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-700 text-sm">גישה חינם לבודקים (קידום בגוגל)</h2>
        <p className="text-xs text-slate-400 mt-0.5">האדם צריך להירשם ל-Pagey קודם. ימים ריק = ללא הגבלה. מנוי משלם לא משתנה מכאן.</p>
      </div>
      <form onSubmit={grant} className="px-5 py-4 flex flex-wrap items-end gap-3 border-b border-slate-100">
        <label className="text-xs text-slate-500">אימייל
          <input type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" placeholder="name@example.com" />
        </label>
        <label className="text-xs text-slate-500">ימים
          <input type="number" min={1} max={3650} dir="ltr" value={days} onChange={(e) => setDays(e.target.value)}
            className="mt-1 block w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
        </label>
        <button type="submit" disabled={busy || !email.trim()} className="rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">מתן גישה</button>
        {msg && <span role="status" className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </form>
      {grants.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs text-slate-400 border-b border-slate-100">
                <th className="px-4 py-2.5 font-medium">אימייל</th>
                <th className="px-4 py-2.5 font-medium">מצב</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.email} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 text-slate-700" dir="ltr">{g.email}</td>
                  <td className="px-4 py-3 text-slate-600">{endText(g)}</td>
                  <td className="px-4 py-3 text-left">
                    {g.source !== 'sumit' && g.active && (
                      <button type="button" disabled={busy} onClick={() => post('/api/admin/beta-access/revoke', { email: g.email }, `הגישה של ${g.email} הסתיימה.`)}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50">סיום גישה</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
