import { Check as CheckIcon, ChevronLeft, Search } from 'lucide-react';
import type { LeadsSummary } from '../components/LeadsTable';
import { Check, SectionTitle } from './ui';
import { Tile } from './Overview';
import { MessageCircle, Phone, FileText, Mail } from 'lucide-react';
import { MONTHLY_COPY, remainingText } from './monthly';
import { inquiriesText, VIEW_LABEL, MORE_VIEWS, type View } from './journey';
import type { Monthly } from './useMonthly';

/** "עוד": everything that is not one of the three main views, in one plain list. */
export function MoreView({ go }: { go: (v: View) => void }) {
  const hint: Partial<Record<View, string>> = {
    profile: 'כרטיס העסק בגוגל והבדיקה מול מתחרים',
    content: 'ביטויי חיפוש, ערכות תוכן ודפי חיפוש',
    leads: 'שיחות, וואטסאפ וטפסים במקום אחד',
    plan: 'מנוי, חיוב והגדרות',
    setup: 'חמשת צעדי ההקמה',
  };
  return (
    <section aria-labelledby="dv2-more">
      <SectionTitle id="dv2-more" title="עוד" hint="כל השאר, במקום אחד." />
      <ul className="flex flex-col gap-2">
        {MORE_VIEWS.map((v) => (
          <li key={v}>
            <button type="button" onClick={() => go(v)} className="dv2-card-flat flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2 text-right hover:bg-[var(--tint)]">
              <span>
                <span className="block text-[15px] font-bold text-[var(--ink)]">{VIEW_LABEL[v]}</span>
                {hint[v] && <span className="block text-sm text-[var(--muted)]">{hint[v]}</span>}
              </span>
              <ChevronLeft size={18} className="flex-none text-[var(--muted)]" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "התקדמות": this month in numbers, and where the monthly tasks stand. */
export function ProgressView({ summary, monthly, go }: { summary: LeadsSummary; monthly: Monthly; go: (v: View) => void }) {
  const v = monthly.view;
  return (
    <div className="flex flex-col gap-6">
      <section className="dv2-hero p-5 sm:p-6" aria-labelledby="dv2-prog">
        <h2 id="dv2-prog" className="text-xl font-bold">פניות החודש</h2>
        <div className="mt-2 flex items-baseline gap-3"><span className="text-5xl font-bold leading-none tabular-nums sm:text-6xl">{summary.month_total}</span></div>
        <p className="mt-1 text-sm text-[var(--muted)]">{summary.month_total > 0 ? `${inquiriesText(summary.month_total)} מתחילת החודש.` : 'עדיין אין פניות החודש.'}</p>
      </section>

      {summary.month_total > 0 && (
        <section aria-labelledby="dv2-prog-ch">
          <SectionTitle id="dv2-prog-ch" title="מאיפה הגיעו הפניות" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={<MessageCircle size={18} />} label="וואטסאפ" value={summary.month_whatsapp} />
            <Tile icon={<Phone size={18} />} label="שיחות" value={summary.month_call} />
            <Tile icon={<FileText size={18} />} label="טפסים" value={summary.month_form} />
            <Tile icon={<Mail size={18} />} label="אימייל" value={summary.month_email} />
          </div>
        </section>
      )}

      <section aria-labelledby="dv2-prog-tasks">
        <SectionTitle id="dv2-prog-tasks" title="משימות החודש" hint={remainingText(v)} />
        <ul className="dv2-card-flat flex flex-col gap-2.5 p-4">
          {v.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3">
              <Check done={t.done}>{t.done && <CheckIcon size={18} strokeWidth={3} />}</Check>
              <span className="flex-1 text-[15px] font-semibold text-[var(--ink)]">{MONTHLY_COPY[t.id].title}</span>
              <span className="text-sm text-[var(--muted)]">{t.done ? 'הושלם' : t.skipped ? 'נדחה' : 'פתוח'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dv2-card-flat flex flex-col items-start gap-2 p-4">
        <h3 className="text-[15px] font-bold text-[var(--ink)]">בדיקה מחודשת מול מתחרים</h3>
        <p className="text-sm text-[var(--muted)]">מומלץ פעם בחודש. רואים אם הפער מהעסקים שמופיעים לפניך השתנה.</p>
        <button type="button" className="dv2-btn-ghost" onClick={() => go('profile')}><Search size={16} aria-hidden /> לבדיקה</button>
      </section>
    </div>
  );
}
