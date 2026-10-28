import type { ReactNode } from 'react';
import { ArrowLeft, Check as CheckIcon, FileText, Inbox, Mail, MessageCircle, Phone, QrCode, Search, Star } from 'lucide-react';
import { LandoBot } from '../components/Lando';
import type { LeadsSummary } from '../components/LeadsTable';
import { Check, SectionTitle, Segments, Skeleton, SoonChip, Who } from './ui';
import {
  deriveOngoingNext, deriveSetup, inquiriesText, readiness,
  type OverviewInput, type Phase, type SetupItem, type View,
} from './journey';

interface Props {
  input: OverviewInput;
  summary: LeadsSummary;
  phase: Phase;
  loading: boolean;
  failed: boolean;
  ticksOnServer: boolean;
  go: (v: View) => void;
  setTick: (key: string, done: boolean) => Promise<void>;
  onRetry: () => void;
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="טוען">
      <Skeleton className="h-44" /><Skeleton className="h-28" /><Skeleton className="h-64" />
    </div>
  );
}

function PastDue({ go }: { go: (v: View) => void }) {
  return (
    <section className="dv2-card-flat flex flex-wrap items-center justify-between gap-3 border-[var(--warn)] bg-[#FFF1EF] p-4" role="alert">
      <div>
        <p className="font-extrabold text-[var(--warn-ink)]">התשלום החודשי לא עבר</p>
        <p className="text-sm text-[var(--ink)]">כדי שהקידום ימשיך בלי הפרעה, כדאי לעדכן את אמצעי התשלום בימים הקרובים.</p>
      </div>
      <button type="button" className="dv2-btn" onClick={() => go('plan')}>לפרטי המנוי <ArrowLeft size={16} aria-hidden /></button>
    </section>
  );
}

/* ---------- Stage 1: the setup checklist ---------- */

export function SetupList({ items, ticks, go, setTick, doneOpen = false }: {
  items: SetupItem[]; ticks: string[]; go: (v: View) => void; setTick: (key: string, done: boolean) => Promise<void>; doneOpen?: boolean;
}) {
  const open = items.filter((s) => !s.done);
  const done = items.filter((s) => s.done);
  return (
    <div className="flex flex-col gap-3">
      {open.length > 0 && (
        <ol className="flex flex-col gap-3">
          {open.map((s, i) => {
            const first = i === 0;
            return (
              <li key={s.id} className={`${first ? 'dv2-card' : 'dv2-card-flat'} p-4 sm:p-5`}>
                <div className="flex items-start gap-3">
                  <Check done={false} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-[16px] font-extrabold text-[var(--ink)]">{s.title}</h3>
                      <Who who={s.who} />
                      {first && <span className="dv2-stamp">הבא בתור</span>}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{s.how}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" className={first ? 'dv2-btn' : 'dv2-btn-ghost'} onClick={() => go(s.view)}>
                        {s.cta} <ArrowLeft size={16} aria-hidden />
                      </button>
                      {s.manual && (
                        <button type="button" className="dv2-btn-ghost" onClick={() => void setTick(s.id, true)}>
                          <CheckIcon size={16} aria-hidden /> סימנתי כבוצע
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {done.length > 0 && (
        <details open={doneOpen || open.length === 0} className="dv2-card-flat p-4 sm:p-5">
          <summary className="cursor-pointer text-[15px] font-extrabold text-[var(--ink)]">הושלמו ({done.length})</summary>
          <ul className="mt-3 flex flex-col gap-2.5">
            {done.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <Check done><CheckIcon size={18} strokeWidth={3} /></Check>
                <span className="flex-1 text-[15px] font-semibold text-[var(--ink)]">{s.title}</span>
                {s.manual && ticks.includes(s.id) && (
                  <button type="button" className="min-h-[44px] px-2 text-sm font-semibold text-[var(--muted)] underline" onClick={() => void setTick(s.id, false)}>
                    ביטול סימון
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const TIER_LINE: Record<string, string> = {
  start: 'בונים את העסק שלכם בגוגל צעד אחר צעד. בכל צעד כתוב מי עושה מה.',
  way: 'כבר עשיתם חלק גדול מהדרך. נשארו עוד כמה צעדים.',
  almost: 'עוד קצת ואתם שם. נשארו רק הצעדים האחרונים.',
  ready: 'כל צעדי ההקמה הושלמו.',
};

function SetupOverview({ input, go, setTick, ticksOnServer }: Pick<Props, 'input' | 'go' | 'setTick' | 'ticksOnServer'>) {
  const items = deriveSetup(input);
  const r = readiness(items);
  return (
    <div className="flex flex-col gap-6">
      <section className="dv2-ink p-5 sm:p-6" aria-labelledby="dv2-ready">
        <p className="text-xs font-extrabold tracking-wide text-[var(--glow)]">שלב 1 מתוך 2 · הקמה חד פעמית</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="dv2-ready" className="text-xl font-extrabold">מוכנות <span className="rounded bg-[var(--glow)] px-1.5 text-[var(--navy)]">העסק</span></h2>
          <div className="flex items-baseline gap-2" dir="ltr">
            <span className="text-6xl font-extrabold leading-none tabular-nums sm:text-7xl">{r.done}</span>
            <span className="text-2xl font-extrabold text-white/70">/ {r.total}</span>
          </div>
        </div>
        <div className="mt-4"><Segments done={r.done} total={r.total} label={`${r.done} מתוך ${r.total} צעדי הקמה הושלמו`} /></div>
        <p className="mt-3 text-[15px] leading-relaxed text-white/90">
          <strong className="font-extrabold text-[var(--glow)]">{r.label}.</strong> {TIER_LINE[r.tier]}
        </p>
        <p className="mt-1 text-sm text-white/70">אחרי שהכול מסומן, עוברים אוטומטית לשלב השני: ניטור וצמיחה.</p>
      </section>

      {input.subscriptionStatus === 'past_due' && <PastDue go={go} />}

      <section aria-labelledby="dv2-checklist">
        <SectionTitle id="dv2-checklist" no="1" title="רשימת ההקמה" mark="ההקמה" hint="מה עושים עכשיו, ומה כבר מוכן." />
        <SetupList items={items} ticks={input.ticks} go={go} setTick={setTick} />
        {!ticksOnServer && <p className="mt-3 text-xs text-[var(--muted)]">הסימונים נשמרים בדפדפן הזה בלבד.</p>}
      </section>

      <section aria-labelledby="dv2-after" className="dv2-card-flat border-dashed p-4 sm:p-5">
        <h2 id="dv2-after" className="text-[16px] font-extrabold text-[var(--ink)]">מה מחכה בשלב השני</h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm text-[var(--muted)]">
          <li>בדיקה חוזרת מול המתחרים, כדי לראות אם הפער השתנה.</li>
          <li>איסוף עוד ביקורות ופניות באמצעות הקישור שלכם.</li>
          <li>מספרי הפניות החודשיות ועצה אחת לחודש.</li>
        </ul>
      </section>
    </div>
  );
}

/* ---------- Transition: shown once, when the last setup step is done ---------- */

function Welcome({ setTick }: { setTick: Props['setTick'] }) {
  return (
    <section className="dv2-card flex flex-col items-center gap-4 p-6 text-center sm:p-8" aria-labelledby="dv2-welcome">
      <LandoBot mood="success" size={120} />
      <div>
        <p className="dv2-stamp">שלב 1 הושלם</p>
        <h2 id="dv2-welcome" className="mt-3 text-2xl font-extrabold text-[var(--ink)]">העסק <span className="dv2-mark">מוקם</span>. עוברים לשלב השני.</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
          כל צעדי ההקמה מאחוריכם, ואין צורך לחזור אליהם. מעכשיו הדשבורד הוא לניטור ולצמיחה: מתחרים, ביקורות ופניות. רשימת ההקמה נשארת זמינה בתפריט, בלשונית ״ההקמה שלי״.
        </p>
      </div>
      <button type="button" className="dv2-btn" onClick={() => void setTick('phase2_ack', true)}>מעבר לשלב השני <ArrowLeft size={16} aria-hidden /></button>
    </section>
  );
}

/* ---------- Stage 2: ongoing monitoring ---------- */

interface Action { icon: ReactNode; title: string; body: string; who: 'we' | 'you'; view: View; cta: string }
const ACTIONS: Action[] = [
  { icon: <Search size={20} />, title: 'בדיקה מחודשת מול המתחרים', who: 'we', view: 'profile', cta: 'בדוק עכשיו',
    body: 'מומלץ פעם בחודש. רואים אם הפער מהמובילים באזור השתנה.' },
  { icon: <Star size={20} />, title: 'עוד ביקורות מלקוחות', who: 'you', view: 'reviews', cta: 'לקישור הביקורות',
    body: 'שולחים את הקישור או מציגים את קוד ה-QR ללקוחות מרוצים.' },
  { icon: <FileText size={20} />, title: 'תוכן חדש לחיפוש', who: 'we', view: 'content', cta: 'לתוכן',
    body: 'עוד דף או ערכת תוכן לביטוי חיפוש שעדיין לא כיסיתם.' },
  { icon: <Inbox size={20} />, title: 'מעבר על הפניות', who: 'you', view: 'leads', cta: 'לפניות',
    body: 'שיחות, וואטסאפ וטפסים במקום אחד. כדאי לחזור לכל פנייה.' },
];
const SOON: { title: string; body: string }[] = [
  { title: 'סטטיסטיקות פרופיל מגוגל', body: 'כמה התקשרו, ביקשו הגעה או נכנסו לאתר מהפרופיל.' },
  { title: 'ביקורות אוטומטיות', body: 'בקשת ביקורת נשלחת ללקוח אחרי שהשירות הסתיים.' },
  { title: 'סיכום חודשי', body: 'דוח קצר בסוף החודש: מה השתפר ומה עושים הלאה.' },
];

function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="dv2-card-flat p-3">
      <div className="text-[var(--muted)]" aria-hidden>{icon}</div>
      <div className="mt-1.5 text-3xl font-extrabold leading-none tabular-nums text-[var(--ink)]">{value}</div>
      <div className="mt-1 text-sm text-[var(--muted)]">{label}</div>
    </div>
  );
}

function OngoingOverview({ input, summary, go }: Pick<Props, 'input' | 'summary' | 'go'>) {
  const next = deriveOngoingNext(input);
  return (
    <div className="flex flex-col gap-6">
      <section className="dv2-ink p-5 sm:p-6" aria-labelledby="dv2-month">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs font-extrabold tracking-wide text-[var(--glow)]">שלב 2 מתוך 2 · ניהול שוטף</p>
          <button type="button" onClick={() => go('setup')} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-bold text-white/85 underline underline-offset-4">
            <CheckIcon size={14} strokeWidth={3} aria-hidden /> ההקמה שלי
          </button>
        </div>
        <h2 id="dv2-month" className="mt-1 text-xl font-extrabold">פניות <span className="rounded bg-[var(--glow)] px-1.5 text-[var(--navy)]">החודש</span></h2>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-6xl font-extrabold leading-none tabular-nums sm:text-7xl">{summary.month_total}</span>
        </div>
        <p className="mt-1 text-sm text-white/80">
          {summary.month_total > 0 ? inquiriesText(summary.month_total) + ' מתחילת החודש.' : 'עדיין אין פניות החודש.'}
        </p>
      </section>

      {input.subscriptionStatus === 'past_due' && <PastDue go={go} />}

      <section aria-labelledby="dv2-reco">
        <SectionTitle id="dv2-reco" no="★" title="ההמלצה לחודש" mark="לחודש" />
        <div className={`${next.urgent ? 'dv2-card-flat border-[var(--warn)] bg-[#FFF1EF]' : 'dv2-card'} p-4 sm:p-5`}>
          <h3 className="text-[17px] font-extrabold text-[var(--ink)]">{next.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{next.body}</p>
          <button type="button" className="dv2-btn mt-3" onClick={() => go(next.view)}>{next.cta} <ArrowLeft size={16} aria-hidden /></button>
        </div>
      </section>

      {summary.month_total > 0 && (
        <section aria-labelledby="dv2-channels">
          <SectionTitle id="dv2-channels" title="מאיפה הגיעו הפניות" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={<MessageCircle size={18} />} label="וואטסאפ" value={summary.month_whatsapp} />
            <Tile icon={<Phone size={18} />} label="שיחות" value={summary.month_call} />
            <Tile icon={<FileText size={18} />} label="טפסים" value={summary.month_form} />
            <Tile icon={<Mail size={18} />} label="אימייל" value={summary.month_email} />
          </div>
        </section>
      )}

      <section aria-labelledby="dv2-actions">
        <SectionTitle id="dv2-actions" no="2" title="מה אפשר לעשות" mark="לעשות" hint="פעולות קבועות שמשפרות את המקום שלכם בגוגל." />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ACTIONS.map((a) => (
            <li key={a.title} className="dv2-card-flat flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-[var(--ink)] bg-[var(--tint)] text-[var(--ink)]" aria-hidden>{a.icon}</span>
                <Who who={a.who} />
              </div>
              <h3 className="mt-3 text-[15px] font-extrabold text-[var(--ink)]">{a.title}</h3>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-[var(--muted)]">{a.body}</p>
              <button type="button" className="dv2-btn-ghost mt-3 self-start" onClick={() => go(a.view)}>{a.cta} <ArrowLeft size={16} aria-hidden /></button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dv2-soon">
        <SectionTitle id="dv2-soon" title="בדרך אליכם" />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SOON.map((f) => (
            <li key={f.title} className="dv2-card-flat border-dashed p-4">
              <div className="flex items-center justify-between gap-2">
                <QrCode size={18} className="text-[var(--muted)]" aria-hidden /><SoonChip />
              </div>
              <h3 className="mt-2 text-[15px] font-extrabold text-[var(--ink)]">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The ״ההקמה שלי״ view reachable from stage 2: the whole checklist, all done. */
export function SetupArchive({ input, go, setTick, ticksOnServer }: Pick<Props, 'input' | 'go' | 'setTick' | 'ticksOnServer'>) {
  const items = deriveSetup(input);
  const r = readiness(items);
  return (
    <div className="flex flex-col gap-4">
      <section className="dv2-card p-5" aria-labelledby="dv2-archive">
        <h2 id="dv2-archive" className="text-xl font-extrabold text-[var(--ink)]">ההקמה <span className="dv2-mark">שלי</span></h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{r.done === r.total ? 'שלב 1 הושלם. הרשימה כאן רק לעיון.' : `${r.done} מתוך ${r.total} צעדים הושלמו.`}</p>
        <div className="mt-3"><Segments done={r.done} total={r.total} label={`${r.done} מתוך ${r.total} צעדי הקמה הושלמו`} /></div>
      </section>
      <SetupList items={items} ticks={input.ticks} go={go} setTick={setTick} doneOpen />
      {!ticksOnServer && <p className="text-xs text-[var(--muted)]">הסימונים נשמרים בדפדפן הזה בלבד.</p>}
      <button type="button" className="dv2-btn-ghost self-start" onClick={() => go('overview')}>חזרה לסקירה</button>
    </div>
  );
}

export default function Overview({ input, summary, phase, loading, failed, ticksOnServer, go, setTick, onRetry }: Props) {
  if (loading && !input.loaded) return <OverviewSkeleton />;
  if (failed) {
    return (
      <div className="dv2-card p-6 text-center">
        <p className="font-extrabold text-[var(--ink)]">לא הצלחנו לטעון את הסקירה</p>
        <p className="mt-1 text-sm text-[var(--muted)]">בדקו את החיבור ונסו שוב. שאר המסכים עובדים כרגיל.</p>
        <button type="button" onClick={onRetry} className="dv2-btn mt-4">נסו שוב</button>
      </div>
    );
  }
  if (phase === 'welcome') return <Welcome setTick={setTick} />;
  if (phase === 'ongoing') return <OngoingOverview input={input} summary={summary} go={go} />;
  return <SetupOverview input={input} go={go} setTick={setTick} ticksOnServer={ticksOnServer} />;
}
