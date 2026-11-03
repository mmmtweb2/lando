import { useMemo, useState } from 'react';
import { Card, State } from './adminUi';
import { PREMIUM_LABEL, STATE_LABEL, day, ils, useAdminData, type Fetcher } from './adminData';

interface Premium { status: 'active' | 'paused' | 'ended'; lastCardUpdate: string | null; monthlyPrice: number | null; note: string | null }
interface Row { email: string; state: string; stage: string; registeredAt: string; lastProgressAt: string; stuck: boolean; source: string; premium: Premium | null; profilePending?: boolean; pendingName?: string | null }
interface Data { users: Row[]; premiumWithoutJourney: { email: string; status: Premium['status']; last_card_update: string | null; monthly_price: number | string | null; note: string | null }[] }

function PremiumEditor({ email, current, adminFetch, onDone, onCancel }: { email: string; current: Premium | null; adminFetch: Fetcher; onDone: () => void; onCancel: () => void }) {
  const [status, setStatus] = useState<Premium['status']>(current?.status ?? 'active');
  const [last, setLast] = useState(current?.lastCardUpdate ?? '');
  const [price, setPrice] = useState(current?.monthlyPrice != null ? String(current.monthlyPrice) : '');
  const [note, setNote] = useState(current?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await adminFetch('/api/admin/seo/manual-premium', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, status, lastCardUpdate: last || null, monthlyPrice: price.trim() === '' ? null : Number(price), note: note || null }),
      });
      const b = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) { setErr(b.error ?? 'השמירה נכשלה.'); return; }
      onDone();
    } catch { setErr('השמירה נכשלה.'); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="px-5 py-4 bg-slate-50 flex flex-wrap items-end gap-3">
      <span className="text-xs text-slate-500 w-full" dir="ltr">{email}</span>
      <label className="text-xs text-slate-500">סטטוס
        <select value={status} onChange={(e) => setStatus(e.target.value as Premium['status'])} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
          {(['active', 'paused', 'ended'] as const).map((s) => <option key={s} value={s}>{PREMIUM_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-500">עדכון אחרון של הכרטיס
        <input type="date" dir="ltr" value={last} onChange={(e) => setLast(e.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white" />
      </label>
      <label className="text-xs text-slate-500">מחיר חודשי (₪, חופשי)
        <input type="number" min={0} max={100000} step="any" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="ריק = לא נקבע"
          className="mt-1 block w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white" />
      </label>
      <label className="text-xs text-slate-500 flex-1 min-w-[12rem]">הערה
        <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white" />
      </label>
      <button type="submit" disabled={busy} className="rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">שמירה</button>
      <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600">ביטול</button>
      {err && <span role="alert" className="text-xs text-red-600 w-full">{err}</span>}
      <p className="text-xs text-slate-400 w-full">מעקב בלבד. לא נשלח כלום לגוגל או ל-SUMIT, והמחיר נגבה ידנית.</p>
    </form>
  );
}

export default function SeoUsersTab({ adminFetch }: { adminFetch: Fetcher }) {
  const { data, error, loading, reload } = useAdminData<Data>(adminFetch, '/api/admin/seo/users');
  const [state, setState] = useState('');
  const [stage, setStage] = useState('');
  const [from, setFrom] = useState('');
  const [onlyStuck, setOnlyStuck] = useState(false);
  const [onlyPremium, setOnlyPremium] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const rows = useMemo(() => (data?.users ?? []).filter((u) =>
    (!state || u.state === state) && (!stage || u.stage === stage) && (!from || u.registeredAt.slice(0, 10) >= from)
    && (!onlyStuck || u.stuck) && (!onlyPremium || !!u.premium) && (!q || u.email.toLowerCase().includes(q.toLowerCase()))), [data, state, stage, from, onlyStuck, onlyPremium, q]);

  if (!data) return <State loading={loading} error={error} retry={reload} />;
  const sel = 'rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white';
  return (
    <div className="flex flex-col gap-6">
      <Card title="לקוחות בקידום בגוגל" sub={`${rows.length} מתוך ${data.users.length}`}>
        <div className="px-5 py-3 flex flex-wrap items-center gap-3 border-b border-slate-100">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש מייל" dir="ltr" className={`${sel} w-48`} aria-label="חיפוש לפי מייל" />
          <select value={state} onChange={(e) => setState(e.target.value)} className={sel} aria-label="סטטוס">
            <option value="">כל הסטטוסים</option>{Object.entries(STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className={sel} aria-label="שלב הקמה">
            <option value="">כל שלבי ההקמה</option><option value="registered">נרשם</option><option value="setup">בהקמה</option><option value="ready_to_activate">סיים הקמה</option>
          </select>
          <label className="text-xs text-slate-500 flex items-center gap-2">נרשמו מ-<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className={sel} /></label>
          <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={onlyStuck} onChange={(e) => setOnlyStuck(e.target.checked)} /> תקועים בלבד</label>
          <label className="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" checked={onlyPremium} onChange={(e) => setOnlyPremium(e.target.checked)} /> פרימיום ידני בלבד</label>
        </div>
        {rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-400">אין לקוחות שתואמים.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-400 text-right">
                <th className="px-5 py-2 font-medium">לקוח</th><th className="px-3 py-2 font-medium">סטטוס</th><th className="px-3 py-2 font-medium">נרשם</th>
                <th className="px-3 py-2 font-medium">התקדמות אחרונה</th><th className="px-3 py-2 font-medium">מקור</th><th className="px-3 py-2 font-medium">פרימיום ידני</th><th className="px-3 py-2" />
              </tr></thead>
              <tbody className="divide-y divide-slate-50">
                {rows.flatMap((u) => [
                  <tr key={u.email}>
                    <td className="px-5 py-2 text-slate-700" dir="ltr">{u.email}</td>
                    <td className="px-3 py-2">{STATE_LABEL[u.state] ?? u.state}{u.stuck && <span className="mr-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">תקוע</span>}{u.profilePending && <span className="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700" title={u.pendingName ?? undefined}>ממתין לאימות פרופיל</span>}</td>
                    <td className="px-3 py-2 text-slate-500">{day(u.registeredAt)}</td>
                    <td className="px-3 py-2 text-slate-500">{day(u.lastProgressAt)}</td>
                    <td className="px-3 py-2 text-slate-500" dir="auto">{u.source}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {u.premium ? (
                        <span>{PREMIUM_LABEL[u.premium.status]} · כרטיס עודכן {day(u.premium.lastCardUpdate)}{u.premium.monthlyPrice != null && ` · ${ils(u.premium.monthlyPrice)}/חודש`}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2"><button type="button" onClick={() => setEditing(editing === u.email ? null : u.email)} className="text-xs text-[#2E63F6] underline">{u.premium ? 'עריכה' : 'סמן כפרימיום ידני'}</button></td>
                  </tr>,
                  ...(editing === u.email ? [<tr key={`${u.email}-edit`}><td colSpan={7} className="p-0"><PremiumEditor email={u.email} current={u.premium} adminFetch={adminFetch} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} /></td></tr>] : []),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data.premiumWithoutJourney.length > 0 && (
        <Card title="פרימיום ידני בלי מסלול הקמה" sub="חשבונות מסומנים שעדיין לא התחילו את ההקמה בעצמם">
          <ul className="divide-y divide-slate-100">
            {data.premiumWithoutJourney.map((p) => (
              <li key={p.email} className="px-5 py-3 text-sm flex items-center justify-between gap-3">
                <span dir="ltr">{p.email}</span>
                <span className="text-slate-500">{PREMIUM_LABEL[p.status]}{p.monthly_price != null && ` · ${ils(Number(p.monthly_price))}/חודש`}</span>
                <button type="button" onClick={() => setEditing(editing === p.email ? null : p.email)} className="text-xs text-[#2E63F6] underline">עריכה</button>
              </li>
            ))}
          </ul>
          {editing && data.premiumWithoutJourney.some((p) => p.email === editing) && (
            <PremiumEditor email={editing} adminFetch={adminFetch} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }}
              current={(() => { const p = data.premiumWithoutJourney.find((x) => x.email === editing)!; return { status: p.status, lastCardUpdate: p.last_card_update, monthlyPrice: p.monthly_price == null ? null : Number(p.monthly_price), note: p.note }; })()} />
          )}
        </Card>
      )}
      <ManualAdd adminFetch={adminFetch} onDone={reload} />
    </div>
  );
}

/** A manual-premium customer that is not in the list yet (for example, someone who never opened /start). */
function ManualAdd({ adminFetch, onDone }: { adminFetch: Fetcher; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="self-start text-xs text-[#2E63F6] underline">הוספת פרימיום ידני לפי מייל</button>;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 flex items-end gap-3">
        <label className="text-xs text-slate-500">מייל החשבון
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={() => { setOpen(false); setEmail(''); }} className="text-xs text-slate-500 underline">סגירה</button>
      </div>
      {email.includes('@') && <PremiumEditor key={email} email={email.trim().toLowerCase()} current={null} adminFetch={adminFetch} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); setEmail(''); onDone(); }} />}
    </div>
  );
}
