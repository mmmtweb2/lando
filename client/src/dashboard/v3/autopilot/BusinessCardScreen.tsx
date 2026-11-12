import { useEffect, useRef, useState } from 'react';
import GbpCard from '../../../components/GbpCard';
import { Skeleton } from '../../ui';
import { ViewShell } from '../Views';
import { NeedChip, PartBand } from '../parts';
import { minutesLine } from '../tasks';
import { BACK_HOME, CARD, RETRY } from '../autopilotCopy';
import LandingPageCard from './LandingPageCard';
import CardEditor, { type CardNotice } from './CardEditor';
import ReadinessList from './ReadinessList';
import { LoadError, SampleBanner } from './bits';
import type { Autopilot } from './useAutopilot';

// "פרטי העסק": the business card everything automatic is written from. One task in the three fixed
// parts: what has to be right, what we read and checked, and the one approval the customer gives.

interface Props { auto: Autopilot; onBack: () => void; onSettings: () => void; backLabel?: string }

export default function BusinessCardScreen({ auto, onBack, onSettings, backLabel = BACK_HOME }: Props) {
  const { truth, gbp } = auto;
  const [notice, setNotice] = useState<CardNotice>(null);
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
    const approved = !!t.approvedAt;
    body = (
      <>
        <div className="dv3-task">
        <PartBand part={1}><p>{CARD.what}</p></PartBand>
        <PartBand part={2}>
          <p>{approved ? CARD.howApproved : CARD.how}</p>
          <ReadinessList readiness={t.readiness} />
        </PartBand>
        <PartBand part={3}>
          <div className="dv3-need-row">
            <NeedChip kind={approved ? 'none' : 'approve'} />
            {!approved && <span className="dv3-min">{minutesLine(CARD.minutes)}</span>}
          </div>
          <p className="dv3-you">{approved ? CARD.youDone : CARD.you}</p>
          <CardEditor key={auto.truthVersion} truth={t} auto={auto} notice={notice} onNotice={setNotice} onSettings={onSettings} />
        </PartBand>
        </div>
        <LandingPageCard auto={auto} ready={t.readiness.ready} />
      </>
    );
  }

  return (
    <ViewShell kicker={CARD.kicker} title={CARD.title} hint={CARD.hint} back={{ label: backLabel, onClick: onBack }}>
      {auto.preview && <SampleBanner />}
      {body}
    </ViewShell>
  );
}
