import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import BusinessAuditCard from './BusinessAuditCard';
import ReviewsCard from './ReviewsCard';
import { RoleTag } from './RoleTag';

/**
 * Placeholder surface for the Google-promotion product (seo_autopilot, Stage 5.5.1).
 * Deliberately minimal: it only has to make the product exist as its own thing in
 * the customer's eyes. The real screens (business connection, audit, recommendations)
 * arrive in Stage 5.5.2+ and the full branding pass later.
 */
const HOW_IT_WORKS: { who: 'we' | 'you'; soon?: boolean; text: string }[] = [
  { who: 'you', text: 'מחפשים את העסק שלכם בגוגל מפות, או פותחים פרופיל אם עדיין אין.' },
  { who: 'we', text: 'בודקים את הפרופיל מול עסקים דומים באזור, ובונים לכם תוכנית חיזוק ברורה.' },
  { who: 'you', text: 'מבצעים את מה שרק בעל העסק יכול לעשות, כמו עדכון פרטים בפרופיל, והאימות.' },
  { who: 'we', text: "נותנים לכם קישור לביקורת ללקוחות, ווידג'ט ביקורות לאתר שלכם." },
  { who: 'we', soon: true, text: 'מעלים תמונות, בונים דפים לחיפושים ספציפיים ומראים כמה פניות הגיעו.' },
];

export default function SeoProductPanel({ showPageUpsell = false }: { showPageUpsell?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Search size={16} />
          </span>
          <h3 className="text-base font-semibold text-slate-900">קידום העסק בגוגל, מי עושה מה</h3>
        </div>
        <ul className="flex flex-col gap-2">
          {HOW_IT_WORKS.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <RoleTag who={r.who} soon={r.soon} /> <span>{r.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <BusinessAuditCard />
      <ReviewsCard />
      {showPageUpsell && (
        <div className="text-center">
          <Link to="/create" className="text-sm font-medium text-[#2E63F6] hover:underline">
            רוצים גם דף נחיתה לעסק? יצירת דף ב-Pagey
          </Link>
        </div>
      )}
    </div>
  );
}

/** Product switcher — shown only to an account that holds BOTH products. */
export function ProductSwitch({
  value, onChange,
}: { value: 'pages' | 'seo'; onChange: (v: 'pages' | 'seo') => void }) {
  const btn = (id: 'pages' | 'seo', label: string) => (
    <button
      type="button"
      onClick={() => onChange(id)}
      aria-pressed={value === id}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
        value === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex self-start rounded-xl bg-slate-100 p-1" role="group" aria-label="בחירת מוצר">
      {btn('pages', 'Pagey – דפי נחיתה')}
      {btn('seo', 'קידום בגוגל')}
    </div>
  );
}
