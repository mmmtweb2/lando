import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import BusinessAuditCard from './BusinessAuditCard';

/**
 * Placeholder surface for the Google-promotion product (seo_autopilot, Stage 5.5.1).
 * Deliberately minimal: it only has to make the product exist as its own thing in
 * the customer's eyes. The real screens (business connection, audit, recommendations)
 * arrive in Stage 5.5.2+ and the full branding pass later.
 */
export default function SeoProductPanel({ showPageUpsell = false }: { showPageUpsell?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <BusinessAuditCard />
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col items-center gap-3 text-center">
        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
          <Search size={20} />
        </div>
        <p className="text-sm text-slate-500 max-w-md">
          המוצר פעיל בחשבון שלכם. חיבור העסק לקידום, ביקורות ולידים יתווספו כאן בקרוב.
        </p>
        {showPageUpsell && (
          <Link to="/create" className="text-sm font-medium text-[#2E63F6] hover:underline">
            רוצים גם דף נחיתה לעסק? יצירת דף ב-Pagey
          </Link>
        )}
      </div>
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
