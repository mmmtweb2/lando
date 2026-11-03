import { Card, Stat, State } from './adminUi';
import { ils, pctText, useAdminData, type Fetcher } from './adminData';

interface Revenue {
  mrr: { sumit: number; manual: number; total: number; goal: number; goalPct: number; payingCount: number; manualPayingCount: number };
  payingCustomers: number; plans: { amount: number; n: number }[];
  betaStarted: number; betaToPaid: number; betaToPaidPct: number | null; readyToPay: number; subsNeedingAttention: number;
  churn30: { canceled: number; pct: number | null };
}

export default function SeoRevenueTab({ adminFetch }: { adminFetch: Fetcher }) {
  const { data, error, loading, reload } = useAdminData<Revenue>(adminFetch, '/api/admin/seo/revenue');
  if (!data) return <State loading={loading} error={error} retry={reload} />;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="MRR כולל" value={ils(data.mrr.total)} sub={`${data.mrr.goalPct}% מיעד ${ils(data.mrr.goal)}`} />
        <Stat label="לקוחות משלמים (SUMIT)" value={data.payingCustomers} sub={ils(data.mrr.sumit)} />
        <Stat label="פרימיום ידני עם מחיר" value={data.mrr.manualPayingCount} sub={`${ils(data.mrr.manual)} נגבה ידנית`} />
        <Stat label="נטישה (30 יום)" value={pctText(data.churn30.pct)} sub={`${data.churn30.canceled} ביטולים`} />
      </div>
      <Card title="מבטא לתשלום" sub="בטא = גישה חינם. 'מוכנים לשלם' הם לקוחות בטא פעילים כרגע.">
        <dl className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div><dt className="text-xs text-slate-400">התחילו בטא</dt><dd className="text-lg font-bold text-slate-800">{data.betaStarted}</dd></div>
          <div><dt className="text-xs text-slate-400">עברו לתשלום</dt><dd className="text-lg font-bold text-slate-800">{data.betaToPaid} ({pctText(data.betaToPaidPct)})</dd></div>
          <div><dt className="text-xs text-slate-400">מוכנים לשלם (בטא פעיל)</dt><dd className="text-lg font-bold text-slate-800">{data.readyToPay}</dd></div>
        </dl>
      </Card>
      <Card title="מסלולי מנוי פעילים" sub="לפי סכום חודשי">
        {data.plans.length === 0 ? <p className="px-5 py-4 text-sm text-slate-400">אין מנויים משלמים. התשלום עדיין כבוי בבטא.</p> : (
          <ul className="divide-y divide-slate-100">
            {data.plans.map((p) => <li key={p.amount} className="px-5 py-3 text-sm flex justify-between"><span>{ils(p.amount)} לחודש</span><span className="text-slate-500">{p.n} מנויים</span></li>)}
          </ul>
        )}
        {data.subsNeedingAttention > 0 && <p className="px-5 py-3 text-sm text-amber-700 border-t border-slate-100">{data.subsNeedingAttention} מנויים דורשים טיפול (חיוב שנכשל או ביטול ידני ב-SUMIT).</p>}
      </Card>
    </div>
  );
}
