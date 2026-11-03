import { Card, Stat, State } from './adminUi';
import { day, useAdminData, type Fetcher } from './adminData';

interface Health {
  at: string; db: { ok: boolean; ms: number | null };
  places: { rows: { sku: string; calls: number; cap: number; pct: number; alert: boolean }[]; tracked: boolean };
  jobs: { rows: { job: string; label: string; status: 'ok' | 'late' | 'failing' | 'never'; lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; runs: number }[]; tracked: boolean };
  gbp: { connections: number; needsReconnect: number; quota: 'pending' | 'ok' | 'unknown'; lastError: string | null; oldestConnectionDays: number | null };
  sumit: { webhookFailing: boolean; lastWebhookOkAt: string | null; lastWebhookError: string | null; chargeFailed7d: number; needAttention: number };
  http: { hours: number; total: number; s5xx: number; ratePct: number };
  alerts: { level: 'warn' | 'bad'; text: string }[];
}
const JOB_STATUS = { ok: 'תקין', late: 'מאחר', failing: 'נכשל', never: 'טרם רץ' } as const;
const JOB_TONE = { ok: 'text-emerald-600', late: 'text-amber-600', failing: 'text-red-600', never: 'text-slate-400' } as const;
const QUOTA = { pending: 'ממתין לאישור גוגל (מכסה 0)', ok: 'פעיל', unknown: 'לא ידוע עדיין' } as const;
const SKU = { autocomplete: 'Autocomplete', details: 'Place Details', nearby: 'Nearby Search' } as Record<string, string>;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function SystemHealthTab({ adminFetch }: { adminFetch: Fetcher }) {
  const { data, error, loading, reload } = useAdminData<Health>(adminFetch, '/api/admin/seo/health');
  if (!data) return <State loading={loading} error={error} retry={reload} />;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="שרת ומסד נתונים" value={data.db.ok ? 'תקין' : 'תקלה'} sub={data.db.ms != null ? `${data.db.ms} אלפיות שנייה` : undefined} tone={data.db.ok ? undefined : 'bad'} />
        <Stat label="שגיאות 5xx (24 שעות)" value={`${data.http.ratePct}%`} sub={`${data.http.s5xx} מתוך ${data.http.total} בקשות מאז הפריסה האחרונה`} tone={data.http.ratePct >= 5 && data.http.total >= 20 ? 'bad' : undefined} />
        <Stat label="חיבורי גוגל" value={data.gbp.connections} sub={data.gbp.needsReconnect ? `${data.gbp.needsReconnect} דורשים חיבור מחדש` : 'כולם תקינים'} tone={data.gbp.needsReconnect ? 'warn' : undefined} />
        <Stat label="כשלי חיוב (7 ימים)" value={data.sumit.chargeFailed7d} sub={data.sumit.needAttention ? `${data.sumit.needAttention} מנויים לטיפול` : undefined} tone={data.sumit.chargeFailed7d ? 'warn' : undefined} />
      </div>

      {data.alerts.length > 0 && (
        <Card title="דורש תשומת לב"><ul className="divide-y divide-slate-100">
          {data.alerts.map((a, i) => <li key={i} className={`px-5 py-3 text-sm ${a.level === 'bad' ? 'text-red-600' : 'text-amber-700'}`}>{a.text}</li>)}
        </ul></Card>
      )}

      <Card title="Google Places: שימוש החודש מול המכסה החינמית" sub={data.places.tracked ? 'התראה במייל ב-80% (כשההתראות פעילות)' : 'הספירה עדיין לא פעילה: חסרה מיגרציה 040'}>
        <ul className="px-5 py-4 flex flex-col gap-4">
          {data.places.rows.map((p) => (
            <li key={p.sku}>
              <div className="flex justify-between text-sm"><span>{SKU[p.sku] ?? p.sku}</span><span className={p.alert ? 'text-red-600 font-medium' : 'text-slate-500'}>{p.calls.toLocaleString('he-IL')} / {p.cap.toLocaleString('he-IL')} ({p.pct}%)</span></div>
              <div className="mt-1 h-2 rounded-full bg-slate-100"><div className={`h-2 rounded-full ${p.alert ? 'bg-red-500' : 'bg-[#2E63F6]'}`} style={{ width: `${Math.min(100, p.pct)}%` }} /></div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="משימות רקע" sub={data.jobs.tracked ? 'ריצה אחרונה של כל סוויפ' : 'הדופק עדיין לא פעיל: חסרה מיגרציה 040'}>
        {data.jobs.rows.length === 0 ? <p className="px-5 py-4 text-sm text-slate-400">אין משימות פעילות.</p> : (
          <ul className="divide-y divide-slate-100">
            {data.jobs.rows.map((j) => (
              <li key={j.job} className="px-5 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
                <span>{j.label}</span>
                <span className="text-xs text-slate-500">ריצה אחרונה {time(j.lastRunAt)} · הצלחה אחרונה {time(j.lastOkAt)}</span>
                <span className={`font-medium ${JOB_TONE[j.status]}`}>{JOB_STATUS[j.status]}</span>
                {j.lastError && <span className="w-full text-xs text-red-600" dir="auto">{j.lastError}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Google Business Profile ו-SUMIT">
        <dl className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div><dt className="text-xs text-slate-400">מכסת ה-API של גוגל</dt><dd className="font-medium text-slate-800">{QUOTA[data.gbp.quota]}</dd></div>
          <div><dt className="text-xs text-slate-400">החיבור הוותיק ביותר</dt><dd className="font-medium text-slate-800">{data.gbp.oldestConnectionDays == null ? '—' : `${data.gbp.oldestConnectionDays} ימים`}</dd></div>
          <div><dt className="text-xs text-slate-400">webhook של SUMIT</dt><dd className={`font-medium ${data.sumit.webhookFailing ? 'text-red-600' : 'text-slate-800'}`}>{data.sumit.webhookFailing ? 'נכשל לאחרונה' : data.sumit.lastWebhookOkAt ? `תקין (${day(data.sumit.lastWebhookOkAt)})` : 'לא התקבל עדיין'}</dd></div>
          {data.gbp.lastError && <div><dt className="text-xs text-slate-400">שגיאה אחרונה מגוגל</dt><dd className="text-slate-700" dir="auto">{data.gbp.lastError}</dd></div>}
        </dl>
      </Card>
    </div>
  );
}
