import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, FileText, Mail, MessageCircle, Phone } from 'lucide-react';
import { trackAccount } from '../../lib/journeyClient';
import { LandoBot } from '../../components/Lando';
import type { LeadsSummary } from '../../components/LeadsTable';
import { Skeleton } from '../ui';
import { Tile } from '../Overview';
import WhatPromotes from '../WhatPromotes';
import GoogleDraftLink from '../GoogleDraftLink';
import { StepBody } from '../GuidedSetup';
import { Body as MonthlyBody } from '../MonthlyTask';
import { remainingText, type MonthlyView } from '../monthly';
import type { GuidedView } from '../guided';
import type { OverviewInput } from '../journey';
import { DoneFlash, RestState, RowHead, SegmentsBar, SummaryBar, TaskRail, TaskRow } from './parts';
import TaskView from './TaskView';
import { summarize, visibleRows, type V3Task } from './tasks';

/* ---------- loading: the shape of the new home (summary + rows), not a spinner ---------- */

export function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="טוען">
      <Skeleton className="h-24 !rounded-[24px]" />
      <Skeleton className="h-44 !rounded-[24px]" /><Skeleton className="h-44 !rounded-[24px]" /><Skeleton className="h-44 !rounded-[24px]" />
    </div>
  );
}

/* ---------- setup: rail + one task screen ---------- */

interface SetupProps {
  input: OverviewInput;
  email: string;
  ticksOnServer: boolean;
  tasks: V3Task[];
  view: GuidedView;
  currentKey: string | null;
  flash: string | null;
  setTick: (key: string, done: boolean) => Promise<void>;
  reload: () => void;
  onSkip: (id: V3Task['id']) => void;
  onFullMenu: () => void;
}

export function SetupScreen({ input, email, ticksOnServer, tasks, view, currentKey, flash, setTick, reload, onSkip, onFullMenu }: SetupProps) {
  const cur = tasks.find((t) => t.key === currentKey) ?? null;
  const headRef = useRef<HTMLHeadingElement>(null);
  const viewed = useRef<Set<string>>(new Set());
  const focusedFor = useRef<string | null>(null);

  // Same events as the v2 screen: each step is reported once per visit; focus moves to the heading.
  useEffect(() => {
    if (!cur) return;
    if (focusedFor.current !== null && focusedFor.current !== cur.key) headRef.current?.focus({ preventScroll: true });
    focusedFor.current = cur.key;
    if (!viewed.current.has(cur.key)) { viewed.current.add(cur.key); trackAccount('step_viewed', { step_id: cur.id }); }
  }, [cur]);

  if (!cur) return null;   // everything is done: the dashboard shows the welcome screen
  const label = `${view.doneCount} מתוך ${view.total} צעדי הקמה הושלמו`;
  const auto = cur.id === 'connect' || cur.id === 'first_check';   // these finish by themselves (guided.ts `auto`)
  return (
    <div className="dv3-setup">
      <DoneFlash message={flash} />
      <div className="dv3-setup-grid">
        <aside className="dv3-side">
          <div className="dv3-rail-wrap"><TaskRail tasks={tasks} currentKey={currentKey} label="מסלול ההקמה" /></div>
          <div className="dv3-segbar-wrap"><SegmentsBar done={view.doneCount} total={view.total} position={view.position} label={label} /></div>
        </aside>
        <div className="dv3-main">
          <TaskView
            key={cur.key} task={cur} headRef={headRef} revisiting={view.revisiting}
            kicker={`הקמה · צעד ${view.position} מתוך ${view.total}`}
            body={
              <StepBody
                id={cur.id as Parameters<typeof StepBody>[0]['id']} input={input}
                onSaved={reload} onScore={() => undefined}
                onAutoDone={() => setTick('first_check', true)}
                onSent={() => void setTick('review_link_shared', true)}
              />
            }
            onConfirm={auto ? null : () => void setTick(cur.id, true)}
            onLater={cur.skippable && !view.onlyThisLeft ? () => onSkip(cur.id) : null}
          />
          <WhatPromotes email={email} />
          <p className="dv3-fine">
            ההתקדמות נשמרת אוטומטית, ואפשר לחזור בכל רגע לאותו מקום.
            {!ticksOnServer && ' כרגע היא נשמרת בדפדפן הזה בלבד.'}
          </p>
          <button type="button" onClick={onFullMenu} className="dv3-linkbtn">מעבר לתפריט המלא</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- welcome: shown once, when the last setup step is done ---------- */

export function WelcomeV3({ setTick }: { setTick: (key: string, done: boolean) => Promise<void> }) {
  return (
    <section className="dv3-welcome" aria-labelledby="dv3-welcome">
      <LandoBot mood="success" size={110} />
      <h2 id="dv3-welcome">ההקמה הושלמה. עוברים לניהול השוטף.</h2>
      <p>כל צעדי ההקמה מאחוריכם ואין צורך לחזור אליהם. מעכשיו הדשבורד הוא לניהול שוטף: משימה קטנה בכל פעם, ביקורות ופניות. את רשימת ההקמה אפשר לראות תחת ״עוד״.</p>
      <button type="button" className="dv3-btn" onClick={() => void setTick('phase2_ack', true)}>מעבר לניהול השוטף <ArrowLeft size={16} aria-hidden /></button>
    </section>
  );
}

/* ---------- ongoing: the overview (summary, toggle, rows) ---------- */

interface OverviewProps {
  tasks: V3Task[];
  summary: LeadsSummary;
  input: OverviewInput;
  email: string;
  flash: string | null;
  pastDue: boolean;
  goPlan: () => void;
  onOpen: (id: V3Task['id']) => void;
  onRetry: () => void;
  /** the automatic product: its first step (above everything) and its sections (under the tasks) */
  first?: ReactNode;
  autopilot?: ReactNode;
}

export function OverviewV3({ tasks, summary, input, email, flash, pastDue, goPlan, onOpen, onRetry, first, autopilot }: OverviewProps) {
  const [onlyMine, setOnlyMine] = useState(false);
  const s = summarize(tasks);
  const rows = visibleRows(tasks, onlyMine);
  return (
    <div className="dv3-overview">
      <DoneFlash message={flash} />
      {pastDue && (
        <section className="dv3-pastdue" role="alert">
          <div>
            <p><strong>התשלום החודשי לא עבר</strong></p>
            <p>כדי שהקידום ימשיך בלי הפרעה, כדאי לעדכן את אמצעי התשלום בימים הקרובים.</p>
          </div>
          <button type="button" className="dv3-btn" onClick={goPlan}>לפרטי המנוי <ArrowLeft size={16} aria-hidden /></button>
        </section>
      )}
      {first}
      <SummaryBar s={s} onlyMine={onlyMine} onToggle={() => setOnlyMine((v) => !v)} />
      {tasks.length === 0 ? <RestState /> : rows.length === 0 ? <RestState /> : (
        <section aria-label="משימות החודש">
          <RowHead />
          <ul className="dv3-rows">{rows.map((t) => <TaskRow key={t.key} task={t} onOpen={() => onOpen(t.id)} />)}</ul>
        </section>
      )}
      {autopilot}
      <WhatPromotes email={email} />
      <GoogleDraftLink input={input} />
      <section aria-label="פניות החודש" className="dv3-leads">
        <h2>פניות החודש: <span className="tabular-nums">{summary.month_total}</span></h2>
        {summary.month_total > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={<MessageCircle size={18} />} label="וואטסאפ" value={summary.month_whatsapp} />
            <Tile icon={<Phone size={18} />} label="שיחות" value={summary.month_call} />
            <Tile icon={<FileText size={18} />} label="טפסים" value={summary.month_form} />
            <Tile icon={<Mail size={18} />} label="אימייל" value={summary.month_email} />
          </div>
        ) : <p>עדיין אין פניות החודש.</p>}
      </section>
      <button type="button" className="dv3-linkbtn" onClick={onRetry}>רענון הנתונים</button>
    </div>
  );
}

/* ---------- ongoing: one month task on its own screen ---------- */

const viewedThisLoad = new Set<string>();

interface MonthProps {
  task: V3Task;
  tasks: V3Task[];
  mview: MonthlyView;
  requestsSent: number;
  flash: string | null;
  reload: () => void;
  onDone: (id: V3Task['id']) => void;
  onLater: (id: V3Task['id']) => void;
  onBack: () => void;
}

export function MonthScreen({ task, tasks, mview, requestsSent, flash, reload, onDone, onLater, onBack }: MonthProps) {
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    if (!viewedThisLoad.has(task.key)) { viewedThisLoad.add(task.key); trackAccount('step_viewed', { step_id: `month_${task.id}` }); }
  }, [task.key, task.id]);
  const othersOpen = tasks.some((t) => !t.done && t.key !== task.key);
  return (
    <div className="dv3-setup">
      <DoneFlash message={flash} />
      <TaskView
        key={task.key} task={task} headRef={headRef}
        revisiting={mview.revisiting && mview.current?.id === task.id}
        kicker={`משימת החודש · ${remainingText(mview)}`}
        body={<MonthlyBody id={task.id as Parameters<typeof MonthlyBody>[0]['id']} requestsSent={requestsSent} reload={reload} />}
        onConfirm={() => onDone(task.id)}
        onLater={othersOpen ? () => onLater(task.id) : null}
        back={{ label: 'חזרה לסקירת החודש', onClick: onBack }}
      />
    </div>
  );
}
