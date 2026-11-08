import { useState, type ReactNode, type Ref } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { NeedChip, PartBand, TaskIcon } from './parts';
import { minutesLine, type V3Task } from './tasks';

// One task on its own screen: a gradient title and the three fixed parts. Part 3 is the loud one:
// chip, minutes, what to do, the task's own working area (`body`), one button and "אחר כך".
// Buttons keep the behaviour of the v2 screens: the main button asks "all set?" first, and
// "אחר כך" is only offered when there is something else to move on to.

interface Props {
  task: V3Task;
  kicker: string;
  /** shown under the title when the customer postponed this one earlier */
  revisiting?: boolean;
  /** whole-screen heading ref, focused by the parent when the task changes */
  headRef?: Ref<HTMLHeadingElement>;
  /** the existing working area of the task (forms, cards) */
  body: ReactNode;
  /** null = no main button (the step finishes by itself, or the task is already done) */
  onConfirm: (() => void) | null;
  /** null = no "אחר כך" */
  onLater: (() => void) | null;
  back?: { label: string; onClick: () => void } | null;
}

export default function TaskView({ task, kicker, revisiting, headRef, body, onConfirm, onLater, back }: Props) {
  const [confirming, setConfirming] = useState(false);
  return (
    <article className="dv3-task" aria-labelledby="dv3-task-title">
      {back && (
        <button type="button" className="dv3-back" onClick={back.onClick}><ArrowRight size={16} aria-hidden /> {back.label}</button>
      )}
      <header className="dv3-hero">
        <p className="dv3-kicker">{kicker}</p>
        <div className="dv3-hero-row">
          <span className="dv3-hero-icon"><TaskIcon id={task.id} size={24} /></span>
          <h2 id="dv3-task-title" ref={headRef} tabIndex={-1}>{task.title}</h2>
        </div>
        {revisiting && <p className="dv3-hero-note">דחיתם את זה קודם. אפשר לעשות את זה עכשיו.</p>}
      </header>

      <PartBand part={1}><p>{task.what}</p></PartBand>
      <PartBand part={2}><p>{task.how}</p></PartBand>
      <PartBand part={3}>
        <div className="dv3-need-row">
          <NeedChip kind={task.chip} />
          {!task.done && <span className="dv3-min">{minutesLine(task.minutes)}</span>}
        </div>
        <p className="dv3-you">{task.done ? 'הושלם. אין מה לעשות כאן.' : task.you}</p>
        <div className="dv3-work">{body}</div>
        {!task.done && (onConfirm || onLater) && (
          <div className="dv3-ctas">
            {onConfirm && (confirming ? (
              <div className="dv3-confirm" role="group" aria-label="אישור">
                <p>{task.confirmQ}</p>
                <div>
                  <button type="button" className="dv3-btn" onClick={onConfirm}>כן, סיימתי</button>
                  <button type="button" className="dv3-btn dv3-btn-ghost" onClick={() => setConfirming(false)}>עוד לא</button>
                </div>
              </div>
            ) : (
              <button type="button" className="dv3-btn" onClick={() => setConfirming(true)}>{task.cta} <ArrowLeft size={16} aria-hidden /></button>
            ))}
            {onLater && !confirming && <button type="button" className="dv3-later" onClick={onLater}>אעשה אחר כך</button>}
          </div>
        )}
      </PartBand>
    </article>
  );
}
