import { Card, Stat, State } from './adminUi';
import { ils, useAdminData, type Fetcher } from './adminData';

interface Alert { level: 'warn' | 'bad'; text: string; tab?: string }
interface Overview {
  signupsWeek: number; signupsPrev: number; setupsCompleted: number; setupsWeek: number; activeBeta: number; activePaid: number; stuck: number;
  manualPremiumActive: number; alerts: Alert[];
  todo: { stuck: number; pendingActivation: number; auditLeadsUnhandled: number | null; premiumStale: number };
  mrr: { sumit: number; manual: number; total: number; goal: number; goalPct: number };
}

export default function SeoOverviewTab({ adminFetch, goTab }: { adminFetch: Fetcher; goTab: (t: string) => void }) {
  const { data, error, loading, reload } = useAdminData<Overview>(adminFetch, '/api/admin/seo/overview');
  if (!data) return <State loading={loading} error={error} retry={reload} />;
  const delta = data.signupsWeek - data.signupsPrev;
  const t = data.todo;
  const todo: { label: string; n: number | null; tab: string }[] = [
    { label: 'לקוחות תקועים (ללא התקדמות 48 שעות)', n: t.stuck, tab: 'users' },
    { label: 'בקשות הפעלה שממתינות לכם', n: t.pendingActivation, tab: 'users' },
    { label: 'פניות מהבדיקה החינמית שלא טופלו (30 ימים)', n: t.auditLeadsUnhandled, tab: 'funnel' },
    { label: 'לקוחות פרימיום ידני שהכרטיס שלהם לא עודכן 30 יום', n: t.premiumStale, tab: 'users' },
  ];
  const open = todo.filter((x) => x.n);
  return (
    <div className="flex flex-col gap-6">
      <Card title="מה לעשות היום" sub={open.length ? undefined : 'אין משימות פתוחות. הכול מטופל.'}>
        <ul className="divide-y divide-slate-100">
          {todo.map((x) => (
            <li key={x.label} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
              <span className={x.n ? 'text-slate-800' : 'text-slate-400'}>
                <span className={`inline-block min-w-[2rem] font-bold ${x.n ? 'text-amber-600' : 'text-slate-300'}`}>{x.n ?? '—'}</span> {x.label}
                {x.n === null && <span className="text-xs text-slate-400"> (לא זמין, חסרה מיגרציה 042)</span>}
              </span>
              {x.n ? <button type="button" onClick={() => goTab(x.tab)} className="text-xs text-[#2E63F6] underline shrink-0">פתח</button> : null}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="נרשמו ב-7 ימים" value={data.signupsWeek} sub={`${delta >= 0 ? '+' : ''}${delta} לעומת השבוע הקודם`} />
        <Stat label="סיימו הקמה" value={data.setupsCompleted} sub={`${data.setupsWeek} מהם השבוע`} />
        <Stat label="לקוחות פעילים" value={data.activeBeta + data.activePaid} sub={`${data.activeBeta} בטא, ${data.activePaid} משלמים`} />
        <Stat label="תקועים" value={data.stuck} sub="נרשמו, ללא התקדמות 48 שעות" tone={data.stuck ? 'warn' : undefined} />
      </div>

      <Card title="הכנסה חודשית (MRR)" sub="מנויי SUMIT פעילים + פרימיום ידני שיש לו מחיר ופעיל. היעד שהוגדר: ₪2,500">
        <div className="px-5 py-4 flex flex-col gap-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-bold text-slate-800">{ils(data.mrr.total)}</span>
            <span className="text-xs text-slate-400">SUMIT {ils(data.mrr.sumit)} · ידני {ils(data.mrr.manual)} · {data.manualPremiumActive} פרימיום ידני פעילים</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={data.mrr.goalPct} aria-valuemin={0} aria-valuemax={100} aria-label="התקדמות ליעד MRR">
            <div className="h-2 rounded-full bg-[#2E63F6]" style={{ width: `${data.mrr.goalPct}%` }} />
          </div>
          <p className="text-xs text-slate-400">{data.mrr.goalPct}% מהיעד ({ils(data.mrr.goal)})</p>
        </div>
      </Card>

      <Card title="התראות פעילות" sub={data.alerts.length ? undefined : 'אין התראות פעילות.'}>
        {data.alerts.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {data.alerts.map((a, i) => (
              <li key={i} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                <span className={a.level === 'bad' ? 'text-red-600' : 'text-amber-700'}>{a.text}</span>
                {a.tab && <button type="button" onClick={() => goTab(a.tab!)} className="text-xs text-[#2E63F6] underline shrink-0">פתח</button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
