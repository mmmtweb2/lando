import { Check, ChevronLeft, FileCheck, Link2Off, MessageSquare, Sparkles, type LucideIcon } from 'lucide-react';
import { Skeleton } from '../../ui';
import { TaskRow } from '../parts';
import type { V3Task } from '../tasks';
import { AUTOMATION, CARD, FIRST_LABEL, HOME } from '../autopilotCopy';
import ActivityFeed from './ActivityFeed';
import LandingPageCard from './LandingPageCard';
import NextPostCard from './NextPostCard';
import { LoadError, SampleBanner } from './bits';
import { shortDate } from './format';
import { autoAvailable, isApproved } from './mode';
import type { Autopilot } from './useAutopilot';
import type { AutoScreen } from './types';

// What the automatic product puts on the home. Order (docs/mvp-plan.md): we work for you, what
// truly waits for you, the next post, what we did. Until the business details are approved, the
// one first step stands alone at the top.

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

/** Top of the approved home: we are working, and since when. No counter and nothing to do. */
export function HomeHero({ auto }: { auto: Autopilot }) {
  const at = auto.truth.status === 'ok' ? auto.truth.data?.approvedAt ?? null : null;
  return (
    <section className="dv3-summary dv3-a-homehero" aria-labelledby="dv3-homehero">
      <span className="dv3-a-homehero-mark" aria-hidden><Sparkles size={24} /></span>
      <div className="dv3-summary-text">
        <h2 id="dv3-homehero">{HOME.heroTitle}</h2>
        {at && <p>{HOME.heroSince(shortDate(at))}</p>}
      </div>
    </section>
  );
}

function toPost() {
  const el = document.getElementById('dv3-post');
  if (!el) return;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* keep the default */ }
  el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

interface WaitingProps {
  auto: Autopilot;
  /** review reply drafts that wait for approval */
  pendingReplies: number;
  onReviews: () => void;
  onProfile: () => void;
}

/** "מה מחכה לכם": only what cannot move without the owner. Otherwise one calm line. */
export function Waiting({ auto, pendingReplies, onReviews, onProfile }: WaitingProps) {
  const a = auto.automation.status === 'ok' ? auto.automation.data : null;
  const posts = auto.posts.status === 'ok' ? auto.posts.data : [];
  const postWaits = !!a && a.live && a.postsMode === 'approve' && posts.some((p) => p.status === 'scheduled');
  const lost = !!auto.gbp && auto.gbp.enabled && (auto.gbp.needsReconnect || !auto.gbp.connected);
  const items: { key: string; Icon: LucideIcon; title: string; sub: string; cta: string; onClick: () => void }[] = [];
  if (lost) items.push({ key: 'gbp', Icon: Link2Off, title: HOME.reconnect, sub: HOME.reconnectSub, cta: HOME.reconnectCta, onClick: onProfile });
  if (pendingReplies > 0) items.push({ key: 'replies', Icon: MessageSquare, title: HOME.replies(pendingReplies), sub: HOME.repliesSub, cta: HOME.repliesCta, onClick: onReviews });
  if (postWaits) items.push({ key: 'post', Icon: FileCheck, title: HOME.post, sub: HOME.postSub, cta: HOME.postCta, onClick: toPost });

  if (items.length === 0) {
    return (
      <p className="dv3-a-calm" role="status">
        <span className="dv3-a-calm-mark" aria-hidden><Check size={16} strokeWidth={3} /></span>
        <span><strong>{HOME.nothing}.</strong> {HOME.nothingSub}</span>
      </p>
    );
  }
  return (
    <section className="dv3-block dv3-a-waiting" aria-labelledby="dv3-waiting">
      <h3 id="dv3-waiting">{HOME.waitingTitle}</h3>
      <ul>
        {items.map(({ key, Icon, title, sub, cta, onClick }) => (
          <li key={key}>
            <span className="dv3-row-icon" aria-hidden><Icon size={20} /></span>
            <div className="dv3-a-waiting-text"><strong>{title}</strong><small>{sub}</small></div>
            <button type="button" className="dv3-btn dv3-a-small" onClick={onClick}>{cta} <ChevronLeft size={16} aria-hidden /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "הפוסט הבא" and "מה עשינו בשבילכם". */
export function AutoWork({ auto }: { auto: Autopilot }) {
  return (
    <>
      {auto.preview && <SampleBanner />}
      <NextPostCard auto={auto} approved={isApproved(auto)} />
      <ActivityFeed activity={auto.activity} onRetry={auto.reload} />
    </>
  );
}

/** Under the numbers: the landing page offer (once the details are approved) and the way to the two screens. */
export function AutoMore({ auto, onOpen }: { auto: Autopilot; onOpen: (s: AutoScreen) => void }) {
  return (
    <>
      {isApproved(auto) && <LandingPageCard auto={auto} />}
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
