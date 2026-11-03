import type { Audit } from '../lib/auditShared';
import { IMPACT_LABEL, buildRecommendations, type Impact } from '../lib/recommendations';

// All recommendations for a business, most impactful first: why it matters, how to fix it, and
// what we handle for the customer after sign-up. Shown on the public /audit and inside /start.

const IMPACT_STYLE: Record<Impact, string> = {
  high: 'bg-rose-50 text-rose-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

export default function RecommendationsList({ audit }: { audit: Pick<Audit, 'items'> }) {
  const recs = buildRecommendations(audit);
  if (recs.length === 0) {
    return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">לא מצאנו כרגע מה לשפר בכרטיס העסק שלכם בגוגל.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-slate-900">מה כדאי לשפר, לפי ההשפעה על הציון</p>
      <ol className="flex flex-col gap-2">
        {recs.map((r, i) => (
          <li key={r.key} className="rounded-lg border border-slate-100 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900"><span className="text-slate-600">{i + 1}.</span> {r.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${IMPACT_STYLE[r.impact]}`}>{IMPACT_LABEL[r.impact]}</span>
            </div>
            {r.why && <p className="mt-1.5 text-xs leading-relaxed text-slate-600"><span className="font-semibold text-slate-700">למה זה חשוב: </span>{r.why}</p>}
            {r.how && <p className="mt-1 text-xs leading-relaxed text-slate-600"><span className="font-semibold text-slate-700">איך מתקנים: </span>{r.how}</p>}
            {r.weDoLabel && <p className={`mt-1.5 inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${r.weDo === 'now' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{r.weDoLabel}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
