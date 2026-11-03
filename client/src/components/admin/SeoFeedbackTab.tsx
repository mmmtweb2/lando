import { Card, State } from './adminUi';
import { REC_LABEL, useAdminData, type Fetcher } from './adminData';
import FeedbackAdminPanel from './FeedbackAdminPanel';

interface Signals { conciergeClicks30: number; topRecommendations: { key: string; n: number }[] }

export default function SeoFeedbackTab({ adminFetch }: { adminFetch: Fetcher }) {
  const { data, error, loading, reload } = useAdminData<Signals>(adminFetch, '/api/admin/seo/feedback');
  return (
    <div className="flex flex-col gap-6">
      <FeedbackAdminPanel adminFetch={adminFetch} />
      {!data ? <State loading={loading} error={error} retry={reload} /> : (
        <>
          <Card title="לחיצות על 'תחברו אותי בוואטסאפ' (30 יום)" sub="מי שביקש עזרה בהקמה">
            <p className="px-5 py-4 text-3xl font-bold text-slate-800">{data.conciergeClicks30}</p>
          </Card>
          <Card title="הפער העיקרי שנמצא בבדיקות (30 יום)" sub="ההמלצה הראשונה שהוצגה בכל בדיקה: מה הכי חסר לעסקים">
            {data.topRecommendations.length === 0 ? <p className="px-5 py-4 text-sm text-slate-400">אין עדיין נתונים.</p> : (
              <ul className="divide-y divide-slate-100">
                {data.topRecommendations.map((r) => <li key={r.key} className="px-5 py-3 text-sm flex justify-between"><span>{REC_LABEL[r.key] ?? r.key}</span><span className="text-slate-500">{r.n}</span></li>)}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
