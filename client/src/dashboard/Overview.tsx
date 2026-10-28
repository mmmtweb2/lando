import type { ReactNode } from 'react';
import {
  ArrowLeft, Check, Search, Star, QrCode, FileText, Inbox, MessageCircle, Phone, Mail, ClipboardList,
} from 'lucide-react';
import type { LeadsSummary } from '../components/LeadsTable';
import { ProgressBar, SectionTitle, Skeleton, SoonChip, StateChip, Who } from './ui';
import {
  deriveJourney, deriveNextStep, inquiriesText, journeyProgress, statusLine,
  type JourneyStep, type OverviewInput, type View,
} from './journey';

interface Props {
  input: OverviewInput;
  summary: LeadsSummary;
  loading: boolean;
  failed: boolean;
  go: (v: View) => void;
  onRetry: () => void;
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="טוען">
      <Skeleton className="h-32" /><Skeleton className="h-36" /><Skeleton className="h-64" />
    </div>
  );
}

function StepRow({ s, index, go }: { s: JourneyStep; index: number; go: (v: View) => void }) {
  const done = s.state === 'done';
  return (
    <li className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
      <span
        className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          done ? 'bg-[var(--dv2-ok-bg)] text-[var(--dv2-ok-ink)]' : 'bg-[var(--dv2-tint)] text-[var(--dv2-accent-strong)]'
        }`}
        aria-hidden
      >
        {done ? <Check size={16} strokeWidth={3} /> : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-[15px] font-bold text-[var(--dv2-ink)]">{s.title}</h3>
          <Who who={s.who} />
          <StateChip state={s.state}>{s.chip}</StateChip>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dv2-muted)]">{s.detail}</p>
        {s.state !== 'waiting' && (
          <button type="button" onClick={() => go(s.view)} className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-[var(--dv2-accent-strong)] hover:underline">
            {done ? 'לצפייה' : 'לפתיחה'} <ArrowLeft size={14} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

interface Feature { icon: ReactNode; title: string; benefit: string; who: 'we' | 'you'; view: View; cta: string }
const FEATURES: Feature[] = [
  { icon: <Search size={20} />, title: 'בדיקת פרופיל מול המובילים', who: 'we', view: 'profile', cta: 'בדוק עכשיו',
    benefit: 'ציון לפרופיל בגוגל מפות, והשוואה לשלושת העסקים המובילים באזור.' },
  { icon: <Star size={20} />, title: 'קישור לביקורות 5 כוכבים', who: 'we', view: 'reviews', cta: 'לקישור',
    benefit: 'קישור אחד ללקוחות מרוצים, שפותח ישר את חלון הביקורת.' },
  { icon: <QrCode size={20} />, title: 'קוד QR לדלפק או לחשבונית', who: 'we', view: 'reviews', cta: 'ל-QR',
    benefit: 'מדפיסים פעם אחת, והלקוח סורק וכותב ביקורת.' },
  { icon: <Star size={20} />, title: 'ווידג׳ט ביקורות לאתר', who: 'we', view: 'reviews', cta: 'לווידג׳ט',
    benefit: 'הביקורות האמיתיות שלכם על האתר, מתעדכנות לבד.' },
  { icon: <FileText size={20} />, title: 'דפי חיפוש וערכות תוכן', who: 'we', view: 'content', cta: 'לתוכן',
    benefit: 'דפים וטקסטים עם שאלות ותשובות לחיפושים כמו ״מנעולן בחיפה״.' },
  { icon: <Inbox size={20} />, title: 'מעקב פניות מכל המקורות', who: 'we', view: 'leads', cta: 'לפניות',
    benefit: 'שיחות, וואטסאפ וטפסים מדפי Pagey ומהאתר שלכם, במקום אחד.' },
];
const SOON: { title: string; benefit: string }[] = [
  { title: 'ביקורות אוטומטיות מחשבוניות', benefit: 'בקשת ביקורת נשלחת ללקוח אחרי שהשירות הסתיים.' },
  { title: 'סטטיסטיקות פרופיל מגוגל', benefit: 'כמה אנשים התקשרו, ביקשו הגעה או נכנסו לאתר מהפרופיל.' },
  { title: 'סיכום חודשי', benefit: 'דוח קצר בסוף החודש: מה השתפר ומה עושים הלאה.' },
];

function ResultTile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[var(--dv2-surface)] p-4">
      <div className="flex items-center gap-2 text-[var(--dv2-muted)]" aria-hidden>{icon}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-[var(--dv2-ink)]">{value}</div>
      <div className="text-sm text-[var(--dv2-muted)]">{label}</div>
    </div>
  );
}

export default function Overview({ input, summary, loading, failed, go, onRetry }: Props) {
  if (loading && !input.loaded) return <OverviewSkeleton />;
  if (failed) {
    return (
      <div className="dv2-card p-6 text-center">
        <p className="text-[var(--dv2-ink)] font-semibold">לא הצלחנו לטעון את הסקירה</p>
        <p className="mt-1 text-sm text-[var(--dv2-muted)]">בדקו את החיבור ונסו שוב. שאר המסכים עובדים כרגיל.</p>
        <button type="button" onClick={onRetry} className="dv2-btn mt-4">נסו שוב</button>
      </div>
    );
  }

  const steps = deriveJourney(input);
  const progress = journeyProgress(steps);
  const next = deriveNextStep(input);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Opening: one plain sentence about where things stand */}
      <section className="dv2-card p-5 sm:p-6" aria-labelledby="dv2-status">
        <h2 id="dv2-status" className="text-xl font-bold text-[var(--dv2-ink)]">הקידום שלכם בגוגל</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--dv2-muted)]">{statusLine(input)}</p>
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--dv2-muted)]">
            <span>התקדמות במסע</span><span>{progress.done} מתוך {progress.total} שלבים</span>
          </div>
          <ProgressBar percent={progress.percent} label={`${progress.done} מתוך ${progress.total} שלבים הושלמו`} />
        </div>
      </section>

      {/* 2. The next step: one card, one button */}
      <section
        aria-labelledby="dv2-next"
        className={`rounded-[var(--dv2-radius)] p-5 sm:p-6 shadow-[var(--dv2-shadow)] ${
          next.urgent ? 'bg-[var(--dv2-warn-bg)] text-[var(--dv2-warn-ink)]' : 'bg-[var(--dv2-accent)] text-white'
        }`}
      >
        <p className={`text-xs font-bold tracking-wide ${next.urgent ? '' : 'text-white/80'}`}>הצעד הבא שלכם</p>
        <h2 id="dv2-next" className="mt-1 text-xl font-bold">{next.title}</h2>
        <p className={`mt-1.5 text-[15px] leading-relaxed ${next.urgent ? '' : 'text-white/90'}`}>{next.body}</p>
        <button
          type="button" onClick={() => go(next.view)}
          className={`mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-[14px] px-5 text-[15px] font-bold transition-colors ${
            next.urgent ? 'bg-[var(--dv2-warn-ink)] text-white hover:opacity-90' : 'bg-white text-[var(--dv2-accent-strong)] hover:bg-[var(--dv2-tint)]'
          }`}
        >
          {next.cta} <ArrowLeft size={16} aria-hidden />
        </button>
      </section>

      {/* 3. The journey */}
      <section aria-labelledby="dv2-journey">
        <SectionTitle id="dv2-journey" title="מסע הקידום" hint="שישה שלבים. בכל שלב כתוב מי עושה מה." />
        <ol className="dv2-card divide-y divide-[var(--dv2-line)] p-5 sm:p-6">
          {steps.map((s, i) => <StepRow key={s.id} s={s} index={i} go={go} />)}
        </ol>
      </section>

      {/* 4. What is included */}
      <section aria-labelledby="dv2-included">
        <SectionTitle id="dv2-included" title="מה כלול" hint="כל מה שהמוצר נותן לכם, ומה עוד בדרך." />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="dv2-card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--dv2-tint)] text-[var(--dv2-accent-strong)]" aria-hidden>{f.icon}</span>
                <Who who={f.who} />
              </div>
              <h3 className="mt-3 text-[15px] font-bold text-[var(--dv2-ink)]">{f.title}</h3>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-[var(--dv2-muted)]">{f.benefit}</p>
              <button type="button" onClick={() => go(f.view)} className="dv2-btn-quiet mt-3 self-start">{f.cta}</button>
            </li>
          ))}
          {SOON.map((f) => (
            <li key={f.title} className="flex flex-col rounded-[var(--dv2-radius)] border border-dashed border-[var(--dv2-line)] bg-transparent p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-[var(--dv2-muted)]" aria-hidden><ClipboardList size={20} /></span>
                <SoonChip />
              </div>
              <h3 className="mt-3 text-[15px] font-bold text-[var(--dv2-ink)]">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--dv2-muted)]">{f.benefit}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Results: only real numbers; an empty state explains how inquiries arrive */}
      <section aria-labelledby="dv2-results">
        <SectionTitle id="dv2-results" title="לידים (פניות) החודש" />
        <div className="dv2-card p-5 sm:p-6">
          {summary.month_total > 0 ? (
            <>
              <p className="text-sm text-[var(--dv2-muted)]">סך הכול החודש</p>
              <p className="text-4xl font-bold tabular-nums text-[var(--dv2-ink)]">{summary.month_total}</p>
              <p className="sr-only">{inquiriesText(summary.month_total)}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ResultTile icon={<MessageCircle size={18} />} label="וואטסאפ" value={summary.month_whatsapp} />
                <ResultTile icon={<Phone size={18} />} label="שיחות" value={summary.month_call} />
                <ResultTile icon={<FileText size={18} />} label="טפסים" value={summary.month_form} />
                <ResultTile icon={<Mail size={18} />} label="אימייל" value={summary.month_email} />
              </div>
            </>
          ) : (
            <div>
              <p className="font-semibold text-[var(--dv2-ink)]">עדיין אין פניות החודש</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--dv2-muted)]">
                פניות מגיעות מדף Pagey של העסק, ומהאתר שלכם אם מוסיפים את קוד המעקב (שורה אחת). אנחנו סופרים לחיצות על טלפון, וואטסאפ ואימייל, ופניות מטפסים.
              </p>
              <button type="button" onClick={() => go('leads')} className="dv2-btn-quiet mt-3">איך מתחילים לקבל פניות</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
