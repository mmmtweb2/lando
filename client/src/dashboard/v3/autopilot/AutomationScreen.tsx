import { useId, useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Skeleton } from '../../ui';
import { ViewShell } from '../Views';
import { AUTOMATION, BACK_HOME, POSTS_OPTIONS, REPLIES_OPTIONS } from '../autopilotCopy';
import { LoadError, Notice, SampleBanner } from './bits';
import type { Autopilot } from './useAutopilot';
import type { AutomationPatch } from './types';

// What we publish by ourselves and what waits for the owner: two plain choices, three options each.
// A choice is saved the moment it is made.

function Choice<T extends string>({ legend, options, value, disabled, onPick }: { legend: string; options: { value: T; label: string; hint: string }[]; value: T; disabled: boolean; onPick: (v: T) => void }) {
  const name = useId();
  return (
    <fieldset className="dv3-block dv3-a-choice">
      <legend>{legend}</legend>
      <div className="dv3-a-options">
        {options.map((o) => (
          <label key={o.value} data-on={o.value === value}>
            <input type="radio" name={name} value={o.value} checked={o.value === value} disabled={disabled} onChange={() => onPick(o.value)} />
            <span><strong>{o.label}</strong><small>{o.hint}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function AutomationScreen({ auto, onBack, onCard }: { auto: Autopilot; onBack: () => void; onCard: () => void }) {
  const a = auto.automation;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const pick = async (patch: AutomationPatch) => {
    setBusy(true); setNote(null);
    const err = await auto.setAutomation(patch);
    setBusy(false);
    setNote(err ? { kind: 'error', text: err } : { kind: 'ok', text: AUTOMATION.saved });
  };
  return (
    <ViewShell kicker={AUTOMATION.kicker} title={AUTOMATION.title} hint={AUTOMATION.hint} back={{ label: BACK_HOME, onClick: onBack }}>
      {auto.preview && <SampleBanner />}
      {a.status === 'loading' && <div className="flex flex-col gap-4" aria-busy="true" aria-label="טוען"><Skeleton className="h-56 !rounded-[24px]" /><Skeleton className="h-56 !rounded-[24px]" /></div>}
      {a.status === 'error' && <LoadError text={`${AUTOMATION.error} ${a.error}`} onRetry={auto.reload} />}
      {a.status === 'ok' && (
        <>
          {!a.data.consentAt ? (
            <div className="dv3-a-msg dv3-a-msg-info" role="note">
              <p>{AUTOMATION.noConsent}</p>
              <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={onCard}>{AUTOMATION.toCard} <ArrowLeft size={16} aria-hidden /></button>
            </div>
          ) : !a.data.live && <Notice kind="info">{AUTOMATION.notLive}</Notice>}
          <Choice legend={AUTOMATION.postsLegend} options={POSTS_OPTIONS} value={a.data.postsMode} disabled={busy} onPick={(v) => void pick({ postsMode: v })} />
          <Choice legend={AUTOMATION.repliesLegend} options={REPLIES_OPTIONS} value={a.data.repliesMode} disabled={busy} onPick={(v) => void pick({ repliesMode: v })} />
          <div className="dv3-a-always">
            <ShieldCheck size={20} aria-hidden />
            <p><strong>{AUTOMATION.always}</strong> {AUTOMATION.quiet}</p>
          </div>
          <div aria-live="polite" className="dv3-a-live">
            {busy && <p className="dv3-a-hint">{AUTOMATION.saving}</p>}
            {!busy && note && <Notice kind={note.kind}>{note.text}</Notice>}
          </div>
        </>
      )}
    </ViewShell>
  );
}
