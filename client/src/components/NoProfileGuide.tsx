import { ExternalLink, ArrowRight } from 'lucide-react';
import { RoleTag } from './RoleTag';

// "I don't have a Google Maps profile" — a business without one is a target customer of
// the product (Moshe, 2026-10-23). We cannot create the profile for them (Google requires
// the owner to create and verify it), so this guide makes the split explicit.

const STEPS: { who: 'we' | 'you'; soon?: boolean; title: string; body: string; href?: string; cta?: string }[] = [
  {
    who: 'you',
    title: 'פתחו פרופיל עסק בגוגל',
    body: 'זה חינם ולוקח כמה דקות. גוגל דורשת שבעל העסק ייצור את הפרופיל בעצמו.',
    href: 'https://business.google.com/create',
    cta: 'פתיחת פרופיל בגוגל',
  },
  {
    who: 'you',
    title: 'בחרו קטגוריה ראשית והגדירו כתובת או אזור שירות',
    body: 'אם אתם מגיעים ללקוח, בחרו "אזור שירות" ואפשר להסתיר את הכתובת.',
  },
  {
    who: 'we',
    soon: true,
    title: 'נכין לכם את הטקסטים והקטגוריה המומלצת',
    body: 'תיאור עסק, קטגוריה ושעות פעילות מוכנים להעתקה.',
  },
  {
    who: 'you',
    title: 'אמתו את הפרופיל',
    body: 'גוגל תבקש אימות בסרטון קצר, בטלפון או בדואר. זה השלב שבו רוב העסקים נתקעים, ואפשר לפנות אלינו.',
  },
  {
    who: 'we',
    title: 'חזרו לכאן, ונריץ בדיקה מלאה',
    body: 'נמדוד את הפרופיל מול העסקים הדומים לכם באזור ונבנה לכם תוכנית חיזוק.',
  },
];

export default function NoProfileGuide({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col gap-4 border-t border-slate-100 pt-5">
      <div>
        <p className="text-sm font-semibold text-slate-900">אין בעיה, מתחילים מפרופיל חדש</p>
        <p className="mt-1 text-sm text-slate-500">
          רוב הלקוחות שמחפשים עסק בגוגל מגיעים דרך המפות, ולכן הפרופיל הוא הבסיס. הנה מי עושה מה:
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={i} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-600 border border-slate-200">
              {i + 1}
            </span>
            <div className="min-w-0 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <RoleTag who={s.who} soon={s.soon} />
                <span className="text-sm font-medium text-slate-900">{s.title}</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">{s.body}</p>
              {s.href && (
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[#2E63F6] hover:underline"
                >
                  {s.cta} <ExternalLink size={13} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 self-start text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowRight size={14} /> יש לי כבר פרופיל, חזרה לחיפוש
      </button>
    </div>
  );
}
