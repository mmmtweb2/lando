import { CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import type { AiReadiness, ReadinessCheck } from '../lib/auditShared';

// Public Audit: can search engines and AI assistants read the business website? (task #8)
// Four plain checks, each ✓/✗ with one sentence and how to fix it. An unreachable site never
// breaks the audit; it only says it could not be checked.

const ICON = {
  pass: <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" aria-label="עבר" />,
  fail: <XCircle size={16} className="mt-0.5 flex-shrink-0 text-rose-600" aria-label="לא עבר" />,
  unknown: <HelpCircle size={16} className="mt-0.5 flex-shrink-0 text-slate-400" aria-label="לא נבדק" />,
} as const;

function Row({ c }: { c: ReadinessCheck }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white p-3">
      {ICON[c.state]}
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{c.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{c.detail}</p>
        {c.state !== 'pass' && c.fix && <p className="mt-1 text-xs leading-relaxed text-slate-700"><span className="font-semibold">איך מתקנים: </span>{c.fix}</p>}
      </div>
    </li>
  );
}

export default function AiReadinessBlock({ data }: { data: AiReadiness }) {
  if (data.status === 'no_website') {
    return (
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <p className="text-sm font-semibold text-slate-900">מוכנות ל-AI</p>
        <p className="mt-1">לא מקושר אתר לפרופיל בגוגל, ולכן אין מה שעוזרי חיפוש ו-AI יוכלו לקרוא.</p>
      </div>
    );
  }
  if (data.status === 'unreachable') {
    return (
      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
        <p className="text-sm font-semibold text-slate-900">מוכנות ל-AI</p>
        <p className="mt-1">לא הצלחנו לפתוח את האתר{data.host ? ` (${data.host})` : ''} כרגע, ולכן לא בדקנו אותו. זה לא משפיע על הציון.</p>
      </div>
    );
  }
  const passed = data.checks.filter(c => c.state === 'pass').length;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold text-slate-900">מוכנות ל-AI: {passed} מתוך {data.checks.length}</p>
        <p className="text-xs text-slate-500">האם ChatGPT, Perplexity, גוגל ו-Bing יכולים לקרוא את האתר {data.host && <span dir="ltr">{data.host}</span>}. זה לא מבטיח שהוא יופיע בתשובות, והבדיקה לא משפיעה על הציון.</p>
      </div>
      <ul className="flex flex-col gap-2">{data.checks.map(c => <Row key={c.key} c={c} />)}</ul>
    </div>
  );
}
