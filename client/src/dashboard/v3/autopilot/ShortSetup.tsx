import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import NoProfileGuide from '../../../components/NoProfileGuide';
import type { IncludedPage } from '../../shell/bridge';
import { Skeleton } from '../../ui';
import { CARD, SETUP3 } from '../autopilotCopy';
import BusinessCardScreen from './BusinessCardScreen';
import NextPostCard from './NextPostCard';
import { IncludedCard } from './SiteScreen';
import { LoadError, Notice, SampleBanner } from './bits';
import { samplePage } from './sample';
import type { SetupStep } from './mode';
import type { Autopilot } from './useAutopilot';

// The short setup of the automatic product: exactly three steps, shown as one progress.
//   1. connect the Google listing   2. approve the business details   3. "from here we work"
// Nothing else is required from the customer. The older manual tasks stay under
// "רוצים לעשות עוד בעצמכם?" and never appear here.

function gbpReturn(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get('gbp');
    return v === 'denied' ? SETUP3.denied : v === 'error' ? SETUP3.failed : null;
  } catch { return null; }
}

function Connect({ auto }: { auto: Autopilot }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(gbpReturn);
  const [guide, setGuide] = useState(false);
  const { gbp } = auto;
  if (guide) return <div className="dv4-card"><NoProfileGuide onBack={() => setGuide(false)} /></div>;
  if (!gbp || !gbp.enabled) return <div className="dv4-card"><p className="dv4-lead">{CARD.connectOff}</p></div>;
  const again = gbp.connected && gbp.needsReconnect;
  const connect = async () => {
    setBusy(true); setErr(null);
    const e = await auto.connectGoogle();
    if (e) { setErr(e); setBusy(false); }   // on success the browser is already leaving for Google
  };
  return (
    <div className="dv4-card">
      <p className="dv4-lead">{again ? SETUP3.reconnectBody : SETUP3.connectBody}</p>
      <p className="dv4-quiet">{SETUP3.connectNote}</p>
      {err && <Notice kind="error">{err}</Notice>}
      <div className="dv4-setup-actions">
        <button type="button" className="dv3-btn" disabled={busy} aria-busy={busy} onClick={() => void connect()}>
          {busy ? SETUP3.connecting : again ? SETUP3.reconnectCta : SETUP3.connectCta} <ArrowLeft size={18} aria-hidden />
        </button>
        <button type="button" className="dv3-a-inlinelink" onClick={() => setGuide(true)}>{SETUP3.noListing}</button>
      </div>
    </div>
  );
}

function Finish({ auto, page, onHome, onBusiness, onPlan }: { auto: Autopilot; page: IncludedPage | null; onHome: () => void; onBusiness: () => void; onPlan: () => void }) {
  const live = auto.automation.status !== 'ok' || auto.automation.data.live;
  return (
    <>
      <NextPostCard auto={auto} approved title={SETUP3.firstPost} />
      <section className="dv4-card" aria-labelledby="dv4-setup-now">
        <div className="dv4-card-head"><h3 id="dv4-setup-now">{SETUP3.nowTitle}</h3></div>
        <ul className="dv4-bullets">{SETUP3.now.map((t) => <li key={t}>{t}</li>)}</ul>
        {!live && <Notice kind="info">{SETUP3.nowNotLive}</Notice>}
      </section>
      <IncludedCard auto={auto} page={page} onBusiness={onBusiness} onPlan={onPlan} />
      <div className="dv4-setup-end">
        <button type="button" className="dv3-btn" onClick={onHome}>{SETUP3.home} <ArrowLeft size={18} aria-hidden /></button>
        <p className="dv4-quiet">{SETUP3.optional}</p>
      </div>
    </>
  );
}

interface Props {
  auto: Autopilot;
  step: SetupStep;
  page: IncludedPage | null;
  onHome: () => void;
  onSettings: () => void;
  onBusiness: () => void;
  onPlan: () => void;
}

export default function ShortSetup({ auto, step, page, onHome, onSettings, onBusiness, onPlan }: Props) {
  const headRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  // A new step is announced by moving focus to its heading (not on the first render).
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headRef.current?.focus({ preventScroll: true });
    try { window.scrollTo({ top: 0 }); } catch { /* old browsers */ }
  }, [step]);

  const { truth } = auto;
  // The preview never shows a real page: its page is the sample's (?page=draft|live|frozen), as on the site screen.
  const sample = auto.preview ? samplePage() : null;
  const shown: IncludedPage | null = auto.preview ? (sample ? { id: sample.id, slug: sample.slug, status: sample.status, url: 'https://pagey.co.il/p/sample-page' } : null) : page;
  const lead = step === 1 ? null : step === 2 ? (truth.status === 'ok' && truth.data ? SETUP3.approveBody : null) : SETUP3.doneBody;
  return (
    <section className="dv4-setup" aria-labelledby="dv4-setup-title">
      {auto.preview && <SampleBanner />}
      <div className="dv4-setup-top">
        <p>{SETUP3.label} · <strong>{SETUP3.progress(step)}</strong></p>
        <ol className="dv4-setup-bar" aria-label={SETUP3.label}>
          {SETUP3.short.map((name, i) => {
            const n = i + 1;
            const state = n < step || (step === 3 && n === 3) ? 'done' : n === step ? 'current' : 'todo';
            return (
              <li key={name} data-state={state} aria-current={n === step ? 'step' : undefined}>
                <span>{state === 'done' && <Check size={14} strokeWidth={3} aria-hidden />}{name}{state === 'done' && <span className="sr-only"> (הושלם)</span>}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <header className="dv4-setup-head">
        <h2 id="dv4-setup-title" ref={headRef} tabIndex={-1}>{SETUP3.names[step - 1]}</h2>
        {lead && <p>{lead}</p>}
      </header>
      {truth.status === 'loading' && <div aria-busy="true" aria-label="טוען"><Skeleton className="h-56 !rounded-[24px]" /></div>}
      {truth.status === 'error' && <LoadError text={CARD.loadError} onRetry={auto.reload} />}
      {truth.status === 'ok' && step === 1 && <Connect auto={auto} />}
      {truth.status === 'ok' && step === 2 && <BusinessCardScreen bare auto={auto} onSettings={onSettings} onProfile={onBusiness} />}
      {truth.status === 'ok' && step === 3 && <Finish auto={auto} page={shown} onHome={onHome} onBusiness={onBusiness} onPlan={onPlan} />}
    </section>
  );
}
