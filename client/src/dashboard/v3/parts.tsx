import { useId, type ReactNode } from 'react';
import {
  BarChart3, Check, ClipboardCheck, Inbox, Link2, MessageSquare, MousePointerClick, Pencil, PencilLine, Search, Settings2,
  ShieldCheck, Star, Target, User, ArrowLeft, type LucideIcon,
} from 'lucide-react';
import { minutesLine, waitingTitle, REST_TEXT, type NeedKind, type Summary, type V3Task } from './tasks';

/* ---------- icons per task ---------- */

const ICONS: Record<string, LucideIcon> = {
  connect: Link2, first_check: BarChart3, profile_details: PencilLine, profile_verified: ShieldCheck, review_link_shared: Star,
  review_requests: Star, review_replies: MessageSquare, search_phrases: Search, tracking: Inbox, business_card: ClipboardCheck,
};
export function TaskIcon({ id, size = 20 }: { id: string; size?: number }) {
  const I = ICONS[id] ?? Target;
  return <I size={size} aria-hidden />;
}

/* ---------- PartBand: one of the three fixed parts ---------- */

const PART: Record<1 | 2 | 3, { label: string; Icon: LucideIcon }> = {
  1: { label: 'מה צריך לעשות', Icon: Target },
  2: { label: 'איך אנחנו עושים את זה', Icon: Settings2 },
  3: { label: 'מה אתם צריכים לעשות', Icon: User },
};

export function PartBand({ part, children }: { part: 1 | 2 | 3; children: ReactNode }) {
  const id = useId();
  const { label, Icon } = PART[part];
  return (
    <section className={`dv3-band dv3-p${part}`} aria-labelledby={id}>
      <h3 id={id} className="dv3-band-label"><Icon size={18} aria-hidden /><span>{label}</span></h3>
      <div className="dv3-band-body">{children}</div>
    </section>
  );
}

/* ---------- NeedChip: four states, always with words ---------- */

const CHIP: Record<NeedKind, { text: string; Icon: LucideIcon }> = {
  none: { text: 'אין צורך להתערב', Icon: Check },
  approve: { text: 'אישור קצר', Icon: ClipboardCheck },
  one: { text: 'לחיצה אחת', Icon: MousePointerClick },
  need: { text: 'דורש מכם פעולה', Icon: Pencil },
};
export function NeedChip({ kind }: { kind: NeedKind }) {
  const { text, Icon } = CHIP[kind];
  return <span className={`dv3-chip dv3-chip-${kind}`}><Icon size={15} strokeWidth={2.6} aria-hidden />{text}</span>;
}

/* ---------- TaskRail (desktop) and SegmentsBar (mobile) ---------- */

export function TaskRail({ tasks, currentKey, label }: { tasks: readonly V3Task[]; currentKey: string | null; label: string }) {
  return (
    <nav aria-label={label} className="dv3-rail">
      <ol>
        {tasks.map((t, i) => {
          const current = t.key === currentKey;
          return (
            <li key={t.key} aria-current={current ? 'step' : undefined} data-state={t.done ? 'done' : current ? 'current' : 'todo'}>
              <span className="dv3-node" aria-hidden>{t.done ? <Check size={16} strokeWidth={3} /> : i + 1}</span>
              <span className="dv3-rail-text">
                <span className="dv3-rail-title">{t.title}</span>
                <span className="dv3-rail-state">{t.done ? 'הושלם' : current ? 'עכשיו' : t.skipped ? 'נדחה לסוף' : 'אחר כך'}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SegmentsBar({ done, total, position, label }: { done: number; total: number; position: number; label: string }) {
  return (
    <div className="dv3-segbar">
      <p className="dv3-segbar-head">{`שלב ${position} מתוך ${total} · הושלמו ${done}`}</p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label} className="dv3-segs" dir="rtl">
        {Array.from({ length: total }, (_, i) => <span key={i} data-on={i < done} />)}
      </div>
    </div>
  );
}

/* ---------- SummaryBar (overview) ---------- */

const R = 26;
const C = 2 * Math.PI * R;

export function SummaryBar({ s, onlyMine, onToggle }: { s: Summary; onlyMine: boolean; onToggle: () => void }) {
  const frac = s.total > 0 ? s.done / s.total : 0;
  return (
    <section className="dv3-summary" aria-label="סיכום החודש">
      <svg className="dv3-ring" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${s.done} מתוך ${s.total} משימות הושלמו`}>
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="7" />
        <circle cx="32" cy="32" r={R} fill="none" stroke="#5AE6A8" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 32 32)" />
        <text x="32" y="37" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700">{s.done}/{s.total}</text>
      </svg>
      <div className="dv3-summary-text">
        <h2>{waitingTitle(s.waiting)}</h2>
        <p>{s.waiting > 0 ? `${minutesLine(s.minutes).replace('מכם', 'מכם בסך הכול')}` : 'הכול בטיפול.'}</p>
      </div>
      <button type="button" className="dv3-toggle" aria-pressed={onlyMine} onClick={onToggle}>
        <span className="dv3-toggle-box" aria-hidden>{onlyMine && <Check size={14} strokeWidth={3.2} />}</span>
        רק מה שמחכה לי
      </button>
    </section>
  );
}

export function RestState() {
  return (
    <div className="dv3-rest" role="status">
      <span className="dv3-rest-mark" aria-hidden><Check size={22} strokeWidth={3} /></span>
      <p>{REST_TEXT}</p>
    </div>
  );
}

/* ---------- TaskRow (overview) ---------- */

export function TaskRow({ task, onOpen }: { task: V3Task; onOpen: () => void }) {
  return (
    <li className="dv3-row" data-done={task.done}>
      <div className="dv3-row-name">
        <span className="dv3-row-icon"><TaskIcon id={task.id} /></span>
        <div>
          <h3>{task.title}</h3>
          <span className={`dv3-state ${task.done ? 'is-done' : ''}`}>{task.done ? 'הושלם' : task.skipped ? 'נדחתה לסוף' : 'פתוחה'}</span>
        </div>
      </div>
      <p className="dv3-cell dv3-c1" data-h="מה צריך לעשות">{task.what}</p>
      <p className="dv3-cell dv3-c2" data-h="איך אנחנו עושים את זה">{task.how}</p>
      <div className="dv3-cell dv3-c3" data-h="מה אתם צריכים לעשות">
        <NeedChip kind={task.chip} />
        <p>{task.done ? 'הושלם. אין מה לעשות כאן.' : task.you}</p>
        {!task.done && <p className="dv3-min">{minutesLine(task.minutes)}</p>}
        <button type="button" className="dv3-btn" onClick={onOpen}>
          {task.done ? 'פרטים' : 'לפעולה'} <ArrowLeft size={16} aria-hidden />
          <span className="sr-only"> {task.title}</span>
        </button>
      </div>
    </li>
  );
}

export function RowHead() {
  return (
    <div className="dv3-rowhead" aria-hidden>
      <span />
      <span className="dv3-h1">{PART[1].label}</span>
      <span className="dv3-h2">{PART[2].label}</span>
      <span className="dv3-h3">{PART[3].label}</span>
    </div>
  );
}

/* ---------- DoneFlash: the cheer, announced politely ---------- */

export function DoneFlash({ message }: { message: string | null }) {
  return (
    <div role="status" aria-live="polite" className="dv3-flash-slot">
      {message && (
        <p className="dv3-flash"><span aria-hidden className="dv3-flash-tick"><Check size={18} strokeWidth={3.2} /></span>{message}</p>
      )}
    </div>
  );
}
