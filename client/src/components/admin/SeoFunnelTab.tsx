import { Card, State } from './adminUi';
import { hoursText, pctText, useAdminData, type Fetcher } from './adminData';

type Counts = { registered: number; setup: number; ready: number; activated: number };
interface Funnel {
  stages: { key: string; label: string; n: number; conv: number | null }[];
  medianHours: { registeredToSetup: number | null; setupToReady: number | null; readyToActivated: number | null };
  bySource: (Counts & { source: string })[];
  cohorts: (Counts & { week: string })[];
}

function CountsTable({ rows, first, firstLabel }: { rows: (Counts & Record<string, unknown>)[]; first: string; firstLabel: string }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-slate-400">אין עדיין נתונים.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-slate-400 text-right">
          <th className="px-5 py-2 font-medium">{firstLabel}</th><th className="px-3 py-2 font-medium">נרשמו</th><th className="px-3 py-2 font-medium">התחילו הקמה</th>
          <th className="px-3 py-2 font-medium">סיימו הקמה</th><th className="px-3 py-2 font-medium">הופעלו</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r) => (
            <tr key={String(r[first])}>
              <td className="px-5 py-2 text-slate-700" dir="auto">{String(r[first])}</td>
              <td className="px-3 py-2">{r.registered}</td><td className="px-3 py-2">{r.setup}</td><td className="px-3 py-2">{r.ready}</td><td className="px-3 py-2">{r.activated}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SeoFunnelTab({ adminFetch }: { adminFetch: Fetcher }) {
  const { data, error, loading, reload } = useAdminData<Funnel>(adminFetch, '/api/admin/seo/funnel');
  if (!data) return <State loading={loading} error={error} retry={reload} />;
  const max = Math.max(1, ...data.stages.map((s) => s.n));
  return (
    <div className="flex flex-col gap-6">
      <Card title="משפך: מבדיקה להפעלה" sub="ספירת מבקרים בבדיקה נעשית לפי מזהה אנונימי. אחוז ההמרה הוא מהשלב שלפניו.">
        <ol className="px-5 py-4 flex flex-col gap-3">
          {data.stages.map((s) => (
            <li key={s.key}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-700">{s.label}</span>
                <span className="text-slate-500"><b className="text-slate-800">{s.n}</b> · {pctText(s.conv)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-[#2E63F6]" style={{ width: `${Math.round((s.n / max) * 100)}%` }} /></div>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="זמן חציוני בין שלבים">
        <dl className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div><dt className="text-xs text-slate-400">נרשם ← התחיל הקמה</dt><dd className="text-lg font-bold text-slate-800">{hoursText(data.medianHours.registeredToSetup)}</dd></div>
          <div><dt className="text-xs text-slate-400">התחיל הקמה ← סיים</dt><dd className="text-lg font-bold text-slate-800">{hoursText(data.medianHours.setupToReady)}</dd></div>
          <div><dt className="text-xs text-slate-400">סיים הקמה ← הופעל</dt><dd className="text-lg font-bold text-slate-800">{hoursText(data.medianHours.readyToActivated)}</dd></div>
        </dl>
      </Card>
      <Card title="לפי מקור" sub="UTM או מקור ההפניה בהרשמה הראשונה"><CountsTable rows={data.bySource} first="source" firstLabel="מקור" /></Card>
      <Card title="קוהורטים שבועיים" sub="לפי שבוע הרשמה (שבוע מתחיל ביום ראשון), 8 אחרונים"><CountsTable rows={data.cohorts} first="week" firstLabel="שבוע" /></Card>
    </div>
  );
}
