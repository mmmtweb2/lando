import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import BusinessAuditCard from '../../components/BusinessAuditCard';
import ReviewsCard from '../../components/ReviewsCard';
import ReviewRequestsCard from '../../components/ReviewRequestsCard';
import ReviewDraftsCard from '../../components/ReviewDraftsCard';
import ContentPlanCard from '../../components/ContentPlanCard';
import ExternalSiteCard from '../../components/ExternalSiteCard';
import SeoSubscriptionCard from '../../components/SeoSubscriptionCard';
import GbpCard from '../../components/GbpCard';
import LeadsTable from '../../components/LeadsTable';
import { useAuth } from '../../context/AuthContext';
import { trackAccount } from '../../lib/journeyClient';
import FeedbackBox from '../FeedbackBox';
import Overview, { SetupArchive } from '../Overview';
import { readSkips, writeSkips } from './skips';
import { useSeoOverview, type SeoOverview } from '../useSeoOverview';
import { useMonthly } from '../useMonthly';
import { GUIDED_COPY, PREMIUM_DETAILS, withSkip, type GuidedId } from '../guided';
import type { MonthlyId } from '../monthly';
import { MORE_VIEWS, NAV_AFTER_SETUP, NAV_LABEL_AFTER_SETUP, VIEW_LABEL, VIEW_ORDER, derivePhase, type View } from '../journey';
import { MoreV3, ProgressV3, ViewFrame } from './Views';
import { HomeSkeleton, MonthScreen, OverviewV3, SetupScreen, WelcomeV3 } from './Screens';
import BusinessCardScreen from './autopilot/BusinessCardScreen';
import AutomationScreen from './autopilot/AutomationScreen';
import { AutoMore, AutoWork, FirstStep, HomeHero, Waiting } from './autopilot/AutoHome';
import { autoAvailable, homeMode } from './autopilot/mode';
import { samplePendingReplies } from './autopilot/sample';
import { AUTOMATION, BACK_MORE, CARD } from './autopilotCopy';
import { useAutopilot } from './autopilot/useAutopilot';
import type { AutoScreen } from './autopilot/types';
import { SETUP_DONE_FLASH, buildMonthTasks, buildSetupTasks, flashText, nextOpenAfter } from './tasks';
import '../dashboard.css';
import './dashboard-v3.css';
import './dashboard-v3-autopilot.css';

/**
 * Dashboard v3 ("סגנון מובלט", spec docs/dashboard-v3-spec.md) for the Google-promotion product.
 * Built next to SeoDashboardV2 and reuses its data and logic as they are: same hooks, same
 * derivations, same cards. Only the layout and the look of the home and task screens are new.
 * Behind ?dash=v3 (see flag.ts).
 */
export default function SeoDashboardV3({ showPageUpsell = false }: { showPageUpsell?: boolean }) {
  const data = useSeoOverview();
  if (!data.input.loaded) return <div className="dv2 dv3" dir="rtl"><HomeSkeleton /></div>;
  return <Loaded data={data} showPageUpsell={showPageUpsell} />;
}

const split = (s: string) => (s ? s.split(',') : []);

function Loaded({ data, showPageUpsell }: { data: SeoOverview; showPageUpsell: boolean }) {
  const { user } = useAuth();
  const email = user?.email ?? 'anonymous';
  const reduce = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => {
    try { return new URLSearchParams(window.location.search).has('gbp') ? 'profile' : 'overview'; } catch { return 'overview'; }
  });
  const [fullMenu, setFullMenu] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).has('gbp'); } catch { return false; }
  });
  const [openTask, setOpenTask] = useState<MonthlyId | null>(null);
  const [skips, setSkips] = useState<GuidedId[]>(() => readSkips(email));
  // Preview only: ?preview=ongoing shows the monthly screens on an account that has not finished the
  // setup. Read once per page load, nothing is saved, no tick is written; it only picks which view shows.
  const [previewOngoing] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).get('preview') === 'ongoing'; } catch { return false; }
  });
  const phase = previewOngoing ? 'ongoing' : derivePhase(data.input);
  // The automatic product (docs/mvp-plan.md, part B). In the preview it runs on sample data and
  // sends nothing. ?screen=card / ?screen=automation open its two screens directly.
  const auto = useAutopilot(previewOngoing);
  const [autoScreen, setAutoScreen] = useState<AutoScreen | null>(() => {
    try { const q = new URLSearchParams(window.location.search).get('screen'); return q === 'card' || q === 'automation' ? q : null; } catch { return null; }
  });
  // The two automatic screens open from the home or from "עוד"; the way back follows.
  const [autoFromMore, setAutoFromMore] = useState(false);
  const monthly = useMonthly(email, data.input, data.requestsSent, data.pendingReplies);
  const setup = buildSetupTasks(data.input, skips);
  const monthTasks = buildMonthTasks(monthly.view);

  /* the cheer: a task that turns "done" while the dashboard is open */
  const [flash, setFlash] = useState<string | null>(null);
  const prevDone = useRef<{ s: string[]; m: string[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setupKey = setup.tasks.filter((t) => t.done).map((t) => t.id).join(',');
  const monthKey = monthTasks.filter((t) => t.done).map((t) => t.id).join(',');
  useEffect(() => {
    const now = { s: split(setupKey), m: split(monthKey) };
    const prev = prevDone.current;
    prevDone.current = now;
    if (!prev) return;
    const freshS = now.s.filter((id) => !prev.s.includes(id));
    const freshM = now.m.filter((id) => !prev.m.includes(id));
    let text: string | null = null;
    let stepId: string | null = null;
    if (freshS.length) {
      const id = freshS[0] as GuidedId;
      stepId = id;
      trackAccount('step_completed', { step_id: id, mode: GUIDED_COPY[id].auto ? 'auto' : 'manual' });
      const title = (data.input.premium && id === 'profile_details' ? PREMIUM_DETAILS : GUIDED_COPY[id]).title;
      text = setup.view.complete ? SETUP_DONE_FLASH : flashText(title, setup.view.current?.title ?? null);
    } else if (freshM.length) {
      const id = freshM[0] as MonthlyId;
      stepId = `month_${id}`;
      trackAccount('step_completed', { step_id: stepId, mode: 'month' });
      const t = monthTasks.find((x) => x.id === id);
      text = flashText(t?.title ?? '', monthly.view.current?.title ?? null);
    }
    if (!text) return;
    setFlash(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setFlash(null); trackAccount('auto_advanced', { step_id: stepId }); }, 4000);
  }, [setupKey, monthKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const simpleNav = phase !== 'setup';
  const navViews: View[] = simpleNav ? NAV_AFTER_SETUP : VIEW_ORDER;
  const inAutoFromMore = simpleNav && autoFromMore && autoScreen !== null && view === 'overview';
  const navActive = (v: View) => {
    if (simpleNav && v === 'more') return view === 'more' || MORE_VIEWS.includes(view) || inAutoFromMore;
    return v === view && !inAutoFromMore;
  };

  const go = useCallback((v: View) => {
    setView(v);
    setOpenTask(null);
    setAutoScreen(null);
    setAutoFromMore(false);
    if (v === 'overview') data.reload();   // numbers may have changed in another view
    top.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [data, reduce]);

  const skipStep = (id: GuidedId) => {
    const next = withSkip(skips, id, true);
    setSkips(next); writeSkips(email, next);
    trackAccount('step_skipped', { step_id: id });
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.18 } };

  const openAuto = (s: AutoScreen | null) => {
    setAutoScreen(s);
    setOpenTask(null);
    if (s === null) setAutoFromMore(false);
    top.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  };
  const openAutoFromMore = (s: AutoScreen) => { setView('overview'); setAutoFromMore(true); openAuto(s); };
  const backFromAuto = () => (autoFromMore ? go('more') : openAuto(null));
  const autoBackLabel = autoFromMore ? BACK_MORE : undefined;
  const moreExtra = autoAvailable(auto) ? [
    { key: 'card', label: CARD.title, hint: CARD.hint, onClick: () => openAutoFromMore('card') },
    { key: 'automation', label: AUTOMATION.link, hint: AUTOMATION.linkHint, onClick: () => openAutoFromMore('automation') },
  ] : [];
  const mode = homeMode(auto);
  const pendingReplies = previewOngoing ? samplePendingReplies() : data.pendingReplies ?? 0;

  if (phase === 'setup' && !fullMenu && !data.failed && !autoScreen) {
    return (
      <div className="dv2 dv3" dir="rtl">
        <SetupScreen
          input={data.input} email={email} ticksOnServer={data.ticksOnServer} tasks={setup.tasks} view={setup.view}
          currentKey={setup.currentKey} flash={flash} setTick={data.setTick} reload={data.reload}
          onSkip={(id) => skipStep(id as GuidedId)} onFullMenu={() => setFullMenu(true)}
        />
        <FeedbackBox page="setup" />
      </div>
    );
  }

  const showAuto = view === 'overview' ? autoScreen : null;
  const monthTask = openTask ? monthTasks.find((t) => t.id === openTask) ?? null : null;

  return (
    <div className="dv2 dv3" dir="rtl">
      <div ref={top} className="scroll-mt-4" />
      <nav aria-label="תצוגות הקידום" className="dv3-nav dv2-nav">
        {navViews.map((v) => {
          const active = navActive(v);
          return (
            <button key={v} type="button" onClick={() => go(v)} aria-current={active ? 'page' : undefined} data-active={active}>
              {simpleNav ? (NAV_LABEL_AFTER_SETUP[v] ?? VIEW_LABEL[v]) : VIEW_LABEL[v]}
            </button>
          );
        })}
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view + (openTask ?? '') + (showAuto ?? '')} {...motionProps}>
          {showAuto === 'card' && <BusinessCardScreen auto={auto} backLabel={autoBackLabel} onBack={backFromAuto} onSettings={() => openAuto('automation')} />}
          {showAuto === 'automation' && <AutomationScreen auto={auto} backLabel={autoBackLabel} onBack={backFromAuto} onCard={() => openAuto('card')} />}
          {!showAuto && view === 'overview' && phase === 'ongoing' && !data.failed && (
            monthTask ? (
              <MonthScreen
                task={monthTask} tasks={monthTasks} mview={monthly.view} requestsSent={data.requestsSent} flash={flash} reload={data.reload}
                onDone={(id) => monthly.done(id as MonthlyId)}
                onLater={(id) => {
                  monthly.skip(id as MonthlyId);
                  trackAccount('step_skipped', { step_id: `month_${id}` });
                  const next = nextOpenAfter(monthTasks, `m:${id}`);
                  setOpenTask((next?.id as MonthlyId | undefined) ?? null);
                }}
                onBack={() => { setOpenTask(null); data.reload(); }}
              />
            ) : (
              <OverviewV3
                tasks={monthTasks} summary={data.summary} input={data.input} email={email} flash={flash}
                pastDue={data.input.subscriptionStatus === 'past_due'} goPlan={() => go('plan')}
                onOpen={(id) => { setOpenTask(id as MonthlyId); top.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }); }}
                onRetry={() => { data.reload(); auto.reload(); }}
                mode={mode}
                top={mode === 'approved' ? (
                  <>
                    <HomeHero auto={auto} />
                    <Waiting auto={auto} pendingReplies={pendingReplies} onReviews={() => go('reviews')} onProfile={() => go('profile')} />
                  </>
                ) : <FirstStep auto={auto} onOpen={openAuto} />}
                work={<AutoWork auto={auto} />}
                more={<AutoMore auto={auto} onOpen={openAuto} />}
              />
            )
          )}
          {!showAuto && view === 'overview' && phase === 'welcome' && !data.failed && <WelcomeV3 setTick={data.setTick} />}
          {!showAuto && view === 'overview' && (phase === 'setup' || data.failed) && (
            <Overview input={data.input} summary={data.summary} phase={phase} loading={data.loading} failed={data.failed} ticksOnServer={data.ticksOnServer} gbpEnabled={data.gbpEnabled} go={go} setTick={data.setTick} onRetry={data.reload} monthly={monthly} requestsSent={data.requestsSent} email={email} />
          )}
          {view === 'progress' && <ProgressV3 summary={data.summary} monthly={monthly} go={go} />}
          {view === 'more' && <MoreV3 go={go} extra={moreExtra} />}
          {view === 'setup' && (
            <ViewFrame view="setup" fromMore={simpleNav} go={go}><SetupArchive input={data.input} go={go} setTick={data.setTick} ticksOnServer={data.ticksOnServer} /></ViewFrame>
          )}
          {view === 'profile' && (
            <ViewFrame view="profile" fromMore={simpleNav} go={go}>
              <GbpCard />
              <BusinessAuditCard />
            </ViewFrame>
          )}
          {view === 'reviews' && (
            <ViewFrame view="reviews" fromMore={simpleNav} go={go}>
              <ReviewsCard />
              <ReviewDraftsCard />
              <ReviewRequestsCard />
            </ViewFrame>
          )}
          {view === 'content' && <ViewFrame view="content" fromMore={simpleNav} go={go}><ContentPlanCard /></ViewFrame>}
          {view === 'leads' && (
            <ViewFrame view="leads" fromMore={simpleNav} go={go}>
              <LeadsTable items={data.items} summary={data.summary} />
              <ExternalSiteCard />
            </ViewFrame>
          )}
          {view === 'plan' && (
            <ViewFrame view="plan" fromMore={simpleNav} go={go}>
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
            </ViewFrame>
          )}
        </motion.div>
      </AnimatePresence>
      <FeedbackBox page={view} />
    </div>
  );
}
