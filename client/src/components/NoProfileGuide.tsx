import { useState } from 'react';
import { ExternalLink, ArrowRight, Loader2 } from 'lucide-react';
import { RoleTag } from './RoleTag';
import ConciergeButton from './ConciergeButton';

// "I don't have a Google Maps business card" — a business without one is a target customer of
// the product (Moshe, 2026-10-23). We cannot create the profile for them (Google requires
// the owner to create and verify it), so this guide makes the split explicit.

const STEPS: { who: 'we' | 'you'; soon?: boolean; title: string; body: string; href?: string; cta?: string }[] = [
  {
    who: 'you',
    title: 'פתחו כרטיס עסק בגוגל',
    body: 'זה חינם ולוקח כמה דקות. גוגל דורשת שבעל העסק ייצור את הכרטיס בעצמו.',
    href: 'https://business.google.com/create',
    cta: 'פתיחת כרטיס עסק בגוגל',
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
    title: 'אמתו את כרטיס העסק',
    body: 'גוגל תבקש אימות בסרטון קצר, בטלפון או בדואר. האימות יכול לקחת כמה ימים, ואפשר להמשיך בהקמה בינתיים. זה השלב שבו רוב העסקים נתקעים, ואפשר לפנות אלינו.',
  },
  {
    who: 'we',
    title: 'חזרו לכאן, ונריץ בדיקה מלאה',
    body: 'נשווה את כרטיס העסק שלכם לעסקים דומים באזור ונכין לכם תוכנית עבודה.',
  },
];

/** Signed-in setup only: continue without a verified profile (it is being created or waits for Google). */
function PendingForm({ onPending }: { onPending: (name: string) => Promise<void> | void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length >= 2;
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3"
      onSubmit={async (e) => { e.preventDefault(); if (!ok || busy) return; setBusy(true); try { await onPending(name.trim()); } finally { setBusy(false); } }}
    >
      <p className="text-sm font-medium text-slate-900">כרטיס העסק עוד לא מוכן או ממתין לאימות? ממשיכים בהקמה בינתיים</p>
      <p className="text-xs leading-relaxed text-slate-600">לא צריך לחכות לגוגל. נכין אתכם מראש, וכשכרטיס העסק יאושר תחזרו לכאן ותחברו אותו בחיפוש.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[12rem] flex-1 text-xs text-slate-600">שם העסק
          <input
            type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <button type="submit" disabled={!ok || busy} className="inline-flex items-center gap-2 rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2552d0] disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} ממשיכים בלי כרטיס עסק
        </button>
      </div>
    </form>
  );
}

export default function NoProfileGuide({ onBack, onPending }: { onBack: () => void; onPending?: (name: string) => Promise<void> | void }) {
  return (
    <div className="flex flex-col gap-4 border-t border-slate-100 pt-5">
      <div>
        <p className="text-sm font-semibold text-slate-900">אין בעיה, מתחילים מכרטיס עסק חדש</p>
        <p className="mt-1 text-sm text-slate-500">
          רוב הלקוחות שמחפשים עסק בגוגל מגיעים דרך המפות, ולכן כרטיס העסק בגוגל הוא הבסיס. הנה מי עושה מה:
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
      {onPending && <PendingForm onPending={onPending} />}
      <ConciergeButton location="audit" />
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 self-start text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowRight size={14} /> יש לי כבר כרטיס עסק, חזרה לחיפוש
      </button>
    </div>
  );
}
