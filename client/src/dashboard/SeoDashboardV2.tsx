import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import BusinessAuditCard from '../components/BusinessAuditCard';
import ReviewsCard from '../components/ReviewsCard';
import ReviewRequestsCard from '../components/ReviewRequestsCard';
import ReviewDraftsCard from '../components/ReviewDraftsCard';
import ContentPlanCard from '../components/ContentPlanCard';
import ExternalSiteCard from '../components/ExternalSiteCard';
import SeoSubscriptionCard from '../components/SeoSubscriptionCard';
import GbpCard from '../components/GbpCard';
import FeedbackBox from './FeedbackBox';
import GuidedSetup from './GuidedSetup';
import { useAuth } from '../context/AuthContext';
import LeadsTable from '../components/LeadsTable';
import Overview, { OverviewSkeleton, SetupArchive } from './Overview';
import { useSeoOverview, type SeoOverview } from './useSeoOverview';
import { useMonthly } from './useMonthly';
import { MoreView, ProgressView } from './AfterSetupViews';
import { MORE_VIEWS, NAV_AFTER_SETUP, NAV_LABEL_AFTER_SETUP, VIEW_LABEL, VIEW_ORDER, derivePhase, type View } from './journey';
import './dashboard.css';

/**
 * Dashboard v2 for the Google-promotion product. Replaces the old single stack of cards with
 * separate views and a real overview. The existing cards are reused as they are (no logic changes);
 * only their placement is new. Behind a flag (see flag.ts).
 */
export default function SeoDashboardV2({ showPageUpsell = false }: { showPageUpsell?: boolean }) {
  const data = useSeoOverview();
  // The monthly state starts from what the business has when the page first loads, so nothing is
  // built before the data is here.
  if (!data.input.loaded) return <div className="dv2 rounded-[18px] p-3 sm:p-5" dir="rtl"><OverviewSkeleton /></div>;
  return <Loaded data={data} showPageUpsell={showPageUpsell} />;
}

function Loaded({ data, showPageUpsell }: { data: SeoOverview; showPageUpsell: boolean }) {
  const [view, setView] = useState<View>(() => {
    // coming back from Google's consent page: show the place where the result is explained
    try { return new URLSearchParams(window.location.search).has('gbp') ? 'profile' : 'overview'; } catch { return 'overview'; }
  });
  // Guided setup shows alone (no tabs) until the five steps are done. Coming back from Google's
  // consent page (?gbp) or choosing the full menu shows the normal views instead.
  const [fullMenu, setFullMenu] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).has('gbp'); } catch { return false; }
  });
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);
  const phase = derivePhase(data.input);
  const monthly = useMonthly(user?.email ?? 'anonymous', data.input, data.requestsSent, data.pendingReplies);
  // Once setup is done: home / reviews / progress, the rest under "עוד". The old six views stay
  // only for someone who left the guided setup through "מעבר לתפריט המלא".
  const simpleNav = phase !== 'setup';
  const navViews: View[] = simpleNav ? NAV_AFTER_SETUP : VIEW_ORDER;
  const navActive = (v: View) => (simpleNav && v === 'more' ? view === 'more' || MORE_VIEWS.includes(view) : v === view);

  const go = useCallback((v: View) => {
    setView(v);
    if (v === 'overview') data.reload();   // numbers may have changed in another view
    top.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [data, reduce]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.18 } };

  if (phase === 'setup' && !fullMenu && data.input.loaded && !data.failed) {
    return (
      <div className="dv2 rounded-[18px] p-3 sm:p-5" dir="rtl">
        <GuidedSetup
          input={data.input} email={user?.email ?? 'anonymous'} ticksOnServer={data.ticksOnServer}
          setTick={data.setTick} reload={data.reload} onFullMenu={() => setFullMenu(true)}
        />
        <FeedbackBox page="setup" />
      </div>
    );
  }

  return (
    <div className="dv2 rounded-[18px] p-3 sm:p-5" dir="rtl">
      <div ref={top} className="scroll-mt-4" />
      <nav aria-label="תצוגות הקידום" className="dv2-nav -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-2 pr-1">
        {navViews.map((v) => {
          const active = navActive(v);
          return (
            <button
              key={v} type="button" onClick={() => go(v)} aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] flex-shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors motion-reduce:transition-none ${
                active ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[var(--line)] bg-white text-[var(--navy)] hover:bg-[var(--tint)]'
              }`}
            >
              {simpleNav ? (NAV_LABEL_AFTER_SETUP[v] ?? VIEW_LABEL[v]) : VIEW_LABEL[v]}
            </button>
          );
        })}
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} {...motionProps}>
          {view === 'overview' && (
            <Overview input={data.input} summary={data.summary} phase={phase} loading={data.loading} failed={data.failed} ticksOnServer={data.ticksOnServer} gbpEnabled={data.gbpEnabled} go={go} setTick={data.setTick} onRetry={data.reload} monthly={monthly} requestsSent={data.requestsSent} email={user?.email ?? 'anonymous'} />
          )}
          {view === 'progress' && <ProgressView summary={data.summary} monthly={monthly} go={go} />}
          {view === 'more' && <MoreView go={go} />}
          {simpleNav && MORE_VIEWS.includes(view) && (
            <button type="button" onClick={() => go('more')} className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-bold text-[var(--accent-strong)] underline underline-offset-4">
              חזרה ל״עוד״
            </button>
          )}
          {view === 'setup' && <SetupArchive input={data.input} go={go} setTick={data.setTick} ticksOnServer={data.ticksOnServer} />}
          {view === 'profile' && (
            <div className="flex flex-col gap-4">
              <GbpCard />
              <BusinessAuditCard />
            </div>
          )}
          {view === 'reviews' && (
            <div className="flex flex-col gap-4">
              <ReviewsCard />
              <ReviewDraftsCard />
              <ReviewRequestsCard />
            </div>
          )}
          {view === 'content' && <ContentPlanCard />}
          {view === 'leads' && (
            <div className="flex flex-col gap-4">
              <LeadsTable items={data.items} summary={data.summary} />
              <ExternalSiteCard />
            </div>
          )}
          {view === 'plan' && (
            <div className="flex flex-col gap-4">
              <SeoSubscriptionCard />
              {data.input.loaded && data.input.subscriptionStatus === null && (
                <div className="dv2-card p-5">
                  <p className="font-semibold text-[var(--ink)]">אין כרגע חיוב חודשי לנהל</p>
                  {data.billingEnabled ? (
                    <>
                      <p className="mt-1 text-sm text-[var(--muted)]">אם יופעל מנוי חודשי, הוא יופיע כאן, ואפשר יהיה לבטל אותו בכל רגע.</p>
                      <Link to="/seo-plan" className="dv2-btn mt-3">להצטרפות למנוי החודשי ולתשלום</Link>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--muted)]">המוצר פעיל בחשבון שלכם ואין עליו חיוב כרגע.</p>
                  )}
                </div>
              )}
              {showPageUpsell && (
                <div className="dv2-card p-5 text-center">
                  <p className="text-sm text-[var(--muted)]">מחזיקים רק בקידום בגוגל. רוצים גם דף נחיתה לעסק?</p>
                  <Link to="/create" className="dv2-btn-ghost mt-3">יצירת דף ב-Pagey</Link>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      <FeedbackBox page={view} />
    </div>
  );
}
