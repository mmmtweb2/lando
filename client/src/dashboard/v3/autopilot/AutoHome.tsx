import { ChevronLeft } from 'lucide-react';
import { Skeleton } from '../../ui';
import { TaskRow } from '../parts';
import type { V3Task } from '../tasks';
import { AUTOMATION, CARD, FIRST_LABEL } from '../autopilotCopy';
import ActivityFeed from './ActivityFeed';
import NextPostCard from './NextPostCard';
import { LoadError, SampleBanner } from './bits';
import type { Autopilot } from './useAutopilot';
import type { AutoScreen } from './types';

// What the automatic product adds to the overview: the first step (approve the business details),
// the next post, what we did, and the way to the settings.

/** Nothing of this is shown on an account where the feature is not open yet. */
function autoAvailable(auto: Autopilot): boolean {
  if (auto.notReady) return false;
  if (auto.truth.status === 'ok' && auto.truth.data === null && auto.gbp !== null && !auto.gbp.enabled) return false;
  return true;
}

const isApproved = (auto: Autopilot) => auto.truth.status === 'ok' && !!auto.truth.data?.approvedAt;

function cardTask(read: boolean): V3Task {
  return {
    key: 'a:card', kind: 'auto', id: 'business_card', title: CARD.rowTitle,
    what: CARD.what, how: read ? CARD.how : CARD.howBefore, you: CARD.you,
    chip: 'approve', minutes: CARD.minutes, done: false, skipped: false, cta: CARD.cta, confirmQ: '', skippable: false,
  };
}

/** Top of the overview while the business details are not approved: the one thing that starts everything. */
export function FirstStep({ auto, onOpen }: { auto: Autopilot; onOpen: (s: AutoScreen) => void }) {
  if (!autoAvailable(auto)) return null;
  const { truth } = auto;
  if (truth.status === 'loading') return <Skeleton className="h-32 !rounded-[24px]" />;
  if (truth.status === 'error') return <LoadError text={CARD.loadError} onRetry={auto.reload} />;
  if (truth.data?.approvedAt) return null;
  return (
    <section className="dv3-first" aria-label={FIRST_LABEL}>
      <p className="dv3-first-label">{FIRST_LABEL}</p>
      <ul className="dv3-rows"><TaskRow task={cardTask(truth.data !== null)} onOpen={() => onOpen('card')} /></ul>
    </section>
  );
}

export function AutoSections({ auto, onOpen }: { auto: Autopilot; onOpen: (s: AutoScreen) => void }) {
  if (!autoAvailable(auto)) return null;
  return (
    <>
      {auto.preview && <SampleBanner />}
      <NextPostCard auto={auto} approved={isApproved(auto)} />
      <ActivityFeed activity={auto.activity} onRetry={auto.reload} />
      <ul className="dv3-more" aria-label="הגדרות ופרטים">
        <li>
          <button type="button" onClick={() => onOpen('automation')}>
            <span><strong>{AUTOMATION.link}</strong><small>{AUTOMATION.linkHint}</small></span>
            <ChevronLeft size={18} aria-hidden />
          </button>
        </li>
        <li>
          <button type="button" onClick={() => onOpen('card')}>
            <span><strong>{CARD.title}</strong><small>{CARD.hint}</small></span>
            <ChevronLeft size={18} aria-hidden />
          </button>
        </li>
      </ul>
    </>
  );
}
