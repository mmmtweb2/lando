import type { ReactNode } from 'react';
import { Check as CheckIcon, ChevronLeft, FileText, Mail, MessageCircle, Phone, Search } from 'lucide-react';
import type { LeadsSummary } from '../../components/LeadsTable';
import { Tile } from '../Overview';
import { MONTHLY_COPY, remainingText } from '../monthly';
import { MORE_VIEWS, VIEW_LABEL, inquiriesText, type View } from '../journey';
import { VIEW_HINT } from './copy';
import type { Monthly } from '../useMonthly';

// Stage 2: the views that are not the home or a task screen. Each one gets the same gradient
// header as the task screen and a "skin" around the cards it already had. The cards themselves are
// not redesigned and keep all their logic; only radius, shadow and border colour change (CSS).

export function ViewShell({ kicker, title, hint, back, children }: { kicker: string; title: string; hint?: string; back?: { label: string; onClick: () => void }; children: ReactNode }) {
  return (
    <section className="dv3-view" aria-labelledby="dv3-view-title">
      {back && <button type="button" className="dv3-back" onClick={back.onClick}>{back.label}</button>}
      <header className="dv3-hero">
        <p className="dv3-kicker">{kicker}</p>
        <h2 id="dv3-view-title" className="dv3-view-title">{title}</h2>
        {hint && <p className="dv3-hero-note">{hint}</p>}
      </header>
      <div className="dv3-skin">{children}</div>
    </section>
  );
}

/** One of the other views: the gradient header, a way back to "עוד" when that is where it came from, and the skin. */
export function ViewFrame({ view, fromMore, go, children }: { view: View; fromMore: boolean; go: (v: View) => void; children: ReactNode }) {
  return (
    <ViewShell
      kicker="קידום בגוגל" title={VIEW_LABEL[view]} hint={VIEW_HINT[view]}
      back={fromMore && MORE_VIEWS.includes(view) ? { label: 'חזרה ל״עוד״', onClick: () => go('more') } : undefined}
    >{children}</ViewShell>
  );
}

/** "עוד": everything that is not home / reviews / progress, in one list. */
export interface MoreExtra { key: string; label: string; hint: string; onClick: () => void }

/** `extra`: screens that are not journey views (the automatic product's two screens), listed first. */
export function MoreV3({ go, extra = [] }: { go: (v: View) => void; extra?: MoreExtra[] }) {
  return (
    <ViewShell kicker="עוד" title="כל השאר, במקום אחד" hint="הגדרות, פרופיל, תוכן ומנוי.">
      <ul className="dv3-more">
        {extra.map((x) => (
          <li key={x.key}>
            <button type="button" onClick={x.onClick}>
              <span><strong>{x.label}</strong><small>{x.hint}</small></span>
              <ChevronLeft size={18} aria-hidden />
            </button>
          </li>
        ))}
        {MORE_VIEWS.map((v) => (
          <li key={v}>
            <button type="button" onClick={() => go(v)}>
              <span>
                <strong>{VIEW_LABEL[v]}</strong>
                {VIEW_HINT[v] && <small>{VIEW_HINT[v]}</small>}
              </span>
              <ChevronLeft size={18} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </ViewShell>
  );
}

/** "התקדמות": this month in numbers and where the monthly tasks stand. */
export function ProgressV3({ summary, monthly, go }: { summary: LeadsSummary; monthly: Monthly; go: (v: View) => void }) {
  const v = monthly.view;
  return (
    <ViewShell kicker="התקדמות" title={`פניות החודש: ${summary.month_total}`}
      hint={summary.month_total > 0 ? `${inquiriesText(summary.month_total)} מתחילת החודש.` : 'עדיין אין פניות החודש.'}>
      {summary.month_total > 0 && (
        <section aria-label="מאיפה הגיעו הפניות" className="dv3-block">
          <h3>מאיפה הגיעו הפניות</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={<MessageCircle size={18} />} label="וואטסאפ" value={summary.month_whatsapp} />
            <Tile icon={<Phone size={18} />} label="שיחות" value={summary.month_call} />
            <Tile icon={<FileText size={18} />} label="טפסים" value={summary.month_form} />
            <Tile icon={<Mail size={18} />} label="אימייל" value={summary.month_email} />
          </div>
        </section>
      )}
      <section aria-label="משימות החודש" className="dv3-block">
        <h3>משימות החודש <span>{remainingText(v)}</span></h3>
        <ul className="dv3-tasklist">
          {v.tasks.map((t) => (
            <li key={t.id} data-done={t.done}>
              <span className="dv3-tick" aria-hidden>{t.done && <CheckIcon size={16} strokeWidth={3} />}</span>
              <span className="dv3-tasklist-name">{MONTHLY_COPY[t.id].title}</span>
              <span className="dv3-state">{t.done ? 'הושלם' : t.skipped ? 'נדחה' : 'פתוח'}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="dv3-block dv3-recheck">
        <div>
          <h3>בדיקה מחודשת מול מתחרים</h3>
          <p>מומלץ פעם בחודש. רואים אם הפער מהעסקים שמופיעים לפניך השתנה.</p>
        </div>
        <button type="button" className="dv3-btn dv3-btn-ghost" onClick={() => go('profile')}><Search size={16} aria-hidden /> לבדיקה</button>
      </section>
    </ViewShell>
  );
}
