import { useEffect, useRef, useState } from 'react';
import GbpCard from '../../../components/GbpCard';
import { Skeleton } from '../../ui';
import { ViewShell } from '../Views';
import { CARD, RETRY } from '../autopilotCopy';
import CardSteps, { type CardNotice, type Step } from './CardSteps';
import { LoadError, SampleBanner } from './bits';
import type { Autopilot } from './useAutopilot';

// "פרטי העסק": the business card everything automatic is written from, in three steps (CardSteps):
// what we found, filling in the gaps, and the one approval the customer gives.

interface Props { auto: Autopilot; onSettings: () => void; onProfile: () => void }

export default function BusinessCardScreen({ auto, onSettings, onProfile }: Props) {
  const { truth, gbp } = auto;
  const [notice, setNotice] = useState<CardNotice>(null);
  // An account that already approved comes here to update details; a new one starts from what we found.
  const [step, setStep] = useState<Step | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const tried = useRef(false);
  const empty = truth.status === 'ok' && truth.data === null && !auto.notReady;
  const canRead = empty && !!gbp && gbp.enabled && gbp.connected && !gbp.needsReconnect;

  // First visit after connecting Google: read the card once, without asking.
  const { sync } = auto;
  useEffect(() => {
    if (!canRead || tried.current) return;
    tried.current = true;
    void sync().then(setSyncError);
  }, [canRead, sync]);
  const retrySync = () => { setSyncError(null); void sync().then(setSyncError); };

  let body;
  if (truth.status === 'loading') {
    body = <div className="flex flex-col gap-4" aria-busy="true" aria-label="טוען"><Skeleton className="h-20 !rounded-[24px]" /><Skeleton className="h-56 !rounded-[24px]" /><Skeleton className="h-72 !rounded-[24px]" /></div>;
  } else if (truth.status === 'error') {
    body = <LoadError text={`${CARD.loadError} ${truth.error}`} onRetry={auto.reload} />;
  } else if (auto.notReady) {
    body = <div className="dv3-block"><p>{CARD.notReady}</p></div>;
  } else if (truth.data === null) {
    body = !gbp || !gbp.enabled ? (
      <div className="dv3-block"><p>{CARD.connectOff}</p></div>
    ) : canRead ? (
      syncError ? (
        <div className="dv3-a-msg dv3-a-msg-error" role="alert">
          <p>{syncError}</p>
          <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={retrySync}>{RETRY}</button>
        </div>
      ) : (
        <div className="dv3-block dv3-a-reading" role="status" aria-busy="true">
          <span className="dv3-a-spinner" aria-hidden />
          <div><h3>{CARD.syncing}</h3><p>{CARD.syncingSub}</p></div>
        </div>
      )
    ) : (
      <>
        <div className="dv3-block"><h3>{CARD.connectTitle}</h3><p>{CARD.connectBody}</p></div>
        <GbpCard />
      </>
    );
  } else {
    const t = truth.data;
    const cur: Step = step ?? (t.approvedAt ? 2 : 1);
    body = (
      <>
        <CardSteps
          key={auto.truthVersion} truth={t} auto={auto} step={cur} notice={notice} onNotice={setNotice} onSettings={onSettings}
          onStep={(n) => { setStep(n); if (n !== cur) setNotice((x) => (x?.kind === 'ok' ? x : null)); }}
        />
        <button type="button" className="dv3-linkbtn" onClick={onProfile}>{CARD.toProfile}</button>
      </>
    );
  }

  return (
    <ViewShell title={CARD.title} hint={CARD.hint}>
      {auto.preview && <SampleBanner />}
      {body}
    </ViewShell>
  );
}
