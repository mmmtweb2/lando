import { ArrowLeft, Check, ChevronLeft, FileCheck, Link2Off, MessageSquare, type LucideIcon } from 'lucide-react';
import type { LeadsSummary } from '../../../components/LeadsTable';
import { Skeleton } from '../../ui';
import { CARD, HOME } from '../autopilotCopy';
import { ActivityLines } from './ActivityFeed';
import NextPostCard from './NextPostCard';
import { LoadError } from './bits';
import { shortDate } from './format';
import { autoAvailable, isApproved } from './mode';
import { homeNumbers, type HomeNumbers } from './numbers';
import type { Autopilot } from './useAutopilot';

// The promotion home (docs/dashboard-v4-spec.md, part B). Four things and nothing else:
//   1. we are working for you, since when, and the month's one number
//   2. what waits for you (only what truly needs the owner; otherwise one calm line)
//   3. the next post, compact
//   4. what we did and what came in, in one block
// Until the business details are approved the home is ONE step, and nothing competes with it.

/** The first step, alone: approve the business details so we can start. */
export function FirstStep({ auto, onOpen }: { auto: Autopilot; onOpen: () => void }) {
  if (!autoAvailable(auto)) return null;
  const { truth } = auto;
  if (truth.status === 'loading') return <Skeleton className="h-56 !rounded-[24px]" />;
  if (truth.status === 'error') return <LoadError text={CARD.loadError} onRetry={auto.reload} />;
  if (truth.data?.approvedAt) return null;
  return (
    <section className="dv4-first" aria-labelledby="dv4-first">
      <h2 id="dv4-first">{CARD.rowTitle}</h2>
      <p>{truth.data !== null ? HOME.firstBody : HOME.firstBodyBefore}</p>
      <div className="dv4-first-foot">
        <button type="button" className="dv3-btn" onClick={onOpen}>{CARD.cta} <ArrowLeft size={18} aria-hidden /></button>
        <span>{HOME.firstTime}. {HOME.firstNote}</span>
      </div>
    </section>
  );
}

/** We are working, since when, and the month's one number. */
export function HomeHero({ auto, numbers }: { auto: Autopilot; numbers: HomeNumbers }) {
  const at = auto.truth.status === 'ok' ? auto.truth.data?.approvedAt ?? null : null;
  return (
    <section className="dv4-hero" aria-labelledby="dv4-hero">
      <div className="dv4-hero-text">
        <h2 id="dv4-hero"><span className="dv4-pulse" aria-hidden />{HOME.heroTitle}</h2>
        {at && <p>{HOME.heroSince(shortDate(at))}</p>}
      </div>
      <p className="dv4-hero-num">
        <strong className="tabular-nums">{numbers.total}</strong>
        <span>{HOME.heroNumber}</span>
      </p>
    </section>
  );
}

function toPost() {
  const el = document.getElementById('dv3-post');
  if (!el) return;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* keep the default */ }
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
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
      <p className="dv4-calm" role="status">
        <span className="dv4-calm-mark" aria-hidden><Check size={14} strokeWidth={3} /></span>
        <span><strong>{HOME.nothing}.</strong> {HOME.nothingSub}</span>
      </p>
    );
  }
  return (
    <section className="dv4-card dv4-waiting" aria-labelledby="dv3-waiting">
      <div className="dv4-card-head"><h3 id="dv3-waiting">{HOME.waitingTitle}</h3></div>
      <ul>
        {items.map(({ key, Icon, title, sub, cta, onClick }) => (
          <li key={key}>
            <span className="dv4-icon" aria-hidden><Icon size={20} /></span>
            <div className="dv4-waiting-text"><strong>{title}</strong><small>{sub}</small></div>
            <button type="button" className="dv3-btn dv3-a-small" onClick={onClick}>{cta} <ChevronLeft size={16} aria-hidden /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "מה עשינו ומה זה הביא": our last three actions next to what came in this month. */
export function Results({ auto, numbers, onAll }: { auto: Autopilot; numbers: HomeNumbers; onAll: () => void }) {
  return (
    <section className="dv4-card dv4-results" aria-labelledby="dv4-results">
      <div className="dv4-card-head"><h3 id="dv4-results">{HOME.resultsTitle}</h3></div>
      <div className="dv4-results-grid">
        <div>
          <h4>{HOME.resultsDid}</h4>
          <ActivityLines activity={auto.activity} limit={3} onRetry={auto.reload} empty={HOME.resultsEmpty} />
        </div>
        <div>
          <h4>{HOME.resultsGot}</h4>
          <dl className="dv4-nums">
            {numbers.tiles.map(({ key, label, value, Icon }) => (
              <div key={key}>
                <dt><Icon size={16} aria-hidden />{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="dv4-fine">{numbers.note}</p>
        </div>
      </div>
      <button type="button" className="dv4-more" onClick={onAll}>{HOME.resultsAll} <ChevronLeft size={16} aria-hidden /></button>
    </section>
  );
}

interface HomeProps extends WaitingProps {
  summary: LeadsSummary;
  onActivity: () => void;
  onExtras: () => void;
  onRefresh: () => void;
}

export function AutoHome({ auto, summary, pendingReplies, onReviews, onProfile, onActivity, onExtras, onRefresh }: HomeProps) {
  const numbers = homeNumbers(summary, auto.numbers);
  return (
    <>
      <HomeHero auto={auto} numbers={numbers} />
      <Waiting auto={auto} pendingReplies={pendingReplies} onReviews={onReviews} onProfile={onProfile} />
      <NextPostCard auto={auto} approved={isApproved(auto)} />
      <Results auto={auto} numbers={numbers} onAll={onActivity} />
      <div className="dv4-homefoot">
        <button type="button" className="dv3-linkbtn" onClick={onExtras}>{HOME.extrasLink}</button>
        <button type="button" className="dv3-linkbtn" onClick={onRefresh}>{HOME.refresh}</button>
      </div>
    </>
  );
}
