import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import BusinessAuditCard from '../../components/BusinessAuditCard';
import ReviewsCard from '../../components/ReviewsCard';
import ReviewRequestsCard from '../../components/ReviewRequestsCard';
import ReviewDraftsCard from '../../components/ReviewDraftsCard';
import ContentPlanCard from '../../components/ContentPlanCard';
import ExternalSiteCard from '../../components/ExternalSiteCard';
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
import { derivePhase, type View } from '../journey';
import { MoreV3, ProgressV3, ViewFrame, ViewShell } from './Views';
import { ExtrasScreen, HomeSkeleton, MonthScreen, OverviewV3, SetupScreen, WelcomeV3 } from './Screens';
import BusinessCardScreen from './autopilot/BusinessCardScreen';
import AutomationScreen from './autopilot/AutomationScreen';
import SiteScreen from './autopilot/SiteScreen';
import ActivityFeed from './autopilot/ActivityFeed';
import { PostHistory } from './autopilot/NextPostCard';
import { AutoHome, FirstStep } from './autopilot/AutoHome';
import { SampleBanner } from './autopilot/bits';
import { homeMode, setupStep } from './autopilot/mode';
import { sampleFlag, sampleItems, samplePendingReplies, sampleSummary } from './autopilot/sample';
import ShortSetup from './autopilot/ShortSetup';
import ReviewKit from './autopilot/ReviewKit';
import { ACTIVITY_SCREEN, BACK_HOME, EXTRAS } from './autopilotCopy';
import { useAutopilot } from './autopilot/useAutopilot';
import type { AreaId, PromoArea, PromoMode } from '../shell/areas';
import type { PromoBridge } from '../shell/bridge';
import { SETUP_DONE_FLASH, buildMonthTasks, buildSetupTasks, flashText, nextOpenAfter } from './tasks';
import '../dashboard.css';
import './dashboard-v3.css';
import './dashboard-v3-autopilot.css';
import './dashboard-v4.css';

/**
 * The Google-promotion product's screens ("סגנון מובלט", docs/dashboard-v3-spec.md), inside the
 * dashboard's one navigation (docs/dashboard-v4-spec.md): the sidebar chooses the screen through
 * `bridge.area`, and this component reports back what the product looks like in this account
 * (automatic / not open yet / still in setup), so the sidebar lists the right entries.
 * The data and the logic are the ones SeoDashboardV2 uses: same hooks, same derivations, same cards.
 */
export default function SeoDashboardV3({ showPageUpsell = false, bridge }: { showPageUpsell?: boolean; bridge?: PromoBridge }) {
  const data = useSeoOverview();
  // Used without the frame (nothing does today): the screen keeps its own area.
  const [own, setOwn] = useState<PromoArea>('home');
  const fallback: PromoBridge = {
    area: own, onMode: () => undefined, page: null, morePagesLink: showPageUpsell,
    go: (a) => setOwn(a === 'settings' || a === 'pages' || a === 'leads' || a === 'credits' ? 'home' : a),
  };
  if (!data.input.loaded) return <div className="dv2 dv3 dv4" dir="rtl"><HomeSkeleton /></div>;
  return <Loaded data={data} bridge={bridge ?? fallback} />;
}

const split = (s: string) => (s ? s.split(',') : []);

/** The older views by the area that shows them. */
const AREA_VIEW: Partial<Record<PromoArea, View>> = {
  home: 'overview', reviews: 'reviews', progress: 'progress', more: 'more', profile: 'profile', content: 'content', inquiries: 'leads', setup: 'setup',
};
const VIEW_AREA: Record<View, AreaId> = {
  overview: 'home', reviews: 'reviews', progress: 'progress', more: 'more', profile: 'profile', content: 'content', leads: 'inquiries', setup: 'setup', plan: 'settings',
};
/** The screens that exist only in the automatic product. */
const AUTO_ONLY: PromoArea[] = ['site', 'business', 'automation', 'activity', 'extras'];
const EXTRA_VIEWS: View[] = ['content', 'leads', 'progress', 'profile', 'setup'];

function Loaded({ data, bridge }: { data: SeoOverview; bridge: PromoBridge }) {
  const { user } = useAuth();
  const email = user?.email ?? 'anonymous';
  const reduce = useReducedMotion();
  const [fullMenu, setFullMenu] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).has('gbp'); } catch { return false; }
  });
  const asked = bridge.area;
  // The open task belongs to the area it was opened in: moving to another area closes it.
  const [task, setTask] = useState<{ id: MonthlyId; area: PromoArea } | null>(null);
  const openTask = task && task.area === asked ? task.id : null;
  const setOpenTask = (id: MonthlyId | null) => setTask(id ? { id, area: asked } : null);
  const [skips, setSkips] = useState<GuidedId[]>(() => readSkips(email));
  // Preview only: ?preview=ongoing shows the monthly screens on an account that has not finished the
  // setup. Read once per page load, nothing is saved, no tick is written; it only picks which view shows.
  const [previewOngoing] = useState<boolean>(() => {
    try { return new URLSearchParams(window.location.search).get('preview') === 'ongoing'; } catch { return false; }
  });
  const phase = previewOngoing ? 'ongoing' : derivePhase(data.input);
  // The automatic product (docs/mvp-plan.md, part B). In the preview it runs on sample data and sends nothing.
  const auto = useAutopilot(previewOngoing);
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

  const hmode = homeMode(auto);
  const isAuto = hmode === 'pending' || hmode === 'approved';
  // The automatic product has its own short setup (three steps: connect, approve, "from here we work").
  // It runs until the details are approved, and its last screen shows once, right after the approval.
  // (`&sample=approved&setup=3` opens that last screen in the preview.)
  const [finishing, setFinishing] = useState<boolean>(() => previewOngoing && sampleFlag('setup') === '3');
  const [seenMode, setSeenMode] = useState(hmode);
  if (isAuto && hmode !== seenMode) {
    setSeenMode(hmode);
    if (seenMode === 'pending' && hmode === 'approved') setFinishing(true);
  }
  const shortSetup = (hmode === 'pending' || (hmode === 'approved' && finishing)) && asked !== 'automation';
  // The older focused setup (five manual tasks): only where the automatic product is not open.
  // While we do not know yet which of the two this account gets, neither is shown.
  const inSetup = hmode === 'legacy' && phase === 'setup' && !fullMenu && !data.failed;
  const mode: PromoMode = inSetup || shortSetup || (hmode === 'pending' && asked === 'automation') ? 'setup' : hmode === 'loading' ? 'unknown' : isAuto ? 'auto' : 'legacy';
  const { onMode, go: goArea } = bridge;
  useEffect(() => { onMode(mode); }, [mode, onMode]);

  // An area this account does not have falls back to the nearest one it does.
  const area: PromoArea = isAuto
    ? (asked === 'more' ? 'extras' : asked)
    : AUTO_ONLY.includes(asked) ? (asked === 'business' && mode === 'legacy' ? 'profile' : 'home') : asked;
  const view: View | null = AREA_VIEW[area] ?? null;

  const { reload } = data;
  const go = useCallback((a: AreaId) => {
    setTask(null);
    if (a === 'home') reload();   // numbers may have changed in another view
    goArea(a);
  }, [reload, goArea]);
  const goView = useCallback((v: View) => go(VIEW_AREA[v]), [go]);

  const skipStep = (id: GuidedId) => {
    const next = withSkip(skips, id, true);
    setSkips(next); writeSkips(email, next);
    trackAccount('step_skipped', { step_id: id });
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } };

  const pendingReplies = previewOngoing ? samplePendingReplies() : data.pendingReplies ?? 0;
  const summary = previewOngoing ? sampleSummary() : data.summary;
  const items = previewOngoing ? sampleItems() : data.items;
  const pastDue = data.input.subscriptionStatus === 'past_due';

  if (inSetup) {
    return (
      <div className="dv2 dv3 dv4" dir="rtl">
        <SetupScreen
          input={data.input} email={email} ticksOnServer={data.ticksOnServer} tasks={setup.tasks} view={setup.view}
          currentKey={setup.currentKey} flash={flash} setTick={data.setTick} reload={data.reload}
          onSkip={(id) => skipStep(id as GuidedId)} onFullMenu={() => setFullMenu(true)}
        />
        <FeedbackBox page="setup" />
      </div>
    );
  }

  if (hmode === 'loading' && phase === 'setup') return <div className="dv2 dv3 dv4" dir="rtl"><HomeSkeleton /></div>;

  if (shortSetup) {
    return (
      <div className="dv2 dv3 dv4" dir="rtl">
        <ShortSetup
          auto={auto} step={setupStep(auto, hmode === 'approved')} page={bridge.page}
          onHome={() => { setFinishing(false); go('home'); }}
          onSettings={() => go('automation')} onBusiness={() => go('business')} onPlan={() => go('settings')}
        />
        <FeedbackBox page="setup" />
      </div>
    );
  }

  const monthTask = openTask ? monthTasks.find((t) => t.id === openTask) ?? null : null;
  const fromMore = isAuto || phase !== 'setup';
  const backLabel = isAuto ? EXTRAS.back : undefined;
  const taskScreen = monthTask && (
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
      backLabel={backLabel}
    />
  );

  return (
    <div className="dv2 dv3 dv4" dir="rtl">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={area + (openTask ?? '')} {...motionProps}>
          {area === 'business' && <BusinessCardScreen auto={auto} onSettings={() => go('automation')} onProfile={() => go('profile')} />}
          {area === 'automation' && <AutomationScreen auto={auto} onCard={() => go('business')} />}
          {area === 'site' && <SiteScreen auto={auto} page={bridge.page} onBusiness={() => go('business')} onPlan={() => go('settings')} morePagesLink={bridge.morePagesLink} />}
          {area === 'activity' && (
            <ViewShell title={ACTIVITY_SCREEN.title} hint={ACTIVITY_SCREEN.hint} back={{ label: BACK_HOME, onClick: () => go('home') }}>
              {auto.preview && <SampleBanner />}
              <ActivityFeed activity={auto.activity} onRetry={auto.reload} />
              <PostHistory auto={auto} />
            </ViewShell>
          )}
          {area === 'extras' && (taskScreen || (
            <ExtrasScreen
              tasks={monthTasks} email={email} views={EXTRA_VIEWS}
              onOpen={(id) => setOpenTask(id as MonthlyId)} onView={goView} onBack={() => go('home')}
            />
          ))}
          {area === 'home' && (phase === 'ongoing' || isAuto) && !data.failed && (
            taskScreen || (
              <OverviewV3
                tasks={monthTasks} summary={data.summary} input={data.input} email={email} flash={flash}
                pastDue={pastDue} goPlan={() => go('settings')}
                onOpen={(id) => setOpenTask(id as MonthlyId)}
                onRetry={() => { data.reload(); auto.reload(); }}
                mode={hmode}
                home={hmode === 'approved' ? (
                  <>
                    {auto.preview && <SampleBanner />}
                    <AutoHome
                      auto={auto} summary={summary} items={items} pendingReplies={pendingReplies}
                      onReviews={() => go('reviews')} onProfile={() => go('profile')} onActivity={() => go('activity')} onExtras={() => go('extras')}
                      onRefresh={() => { data.reload(); auto.reload(); }}
                    />
                  </>
                ) : (
                  <>
                    {auto.preview && <SampleBanner />}
                    <FirstStep auto={auto} onOpen={() => go('business')} />
                  </>
                )}
              />
            )
          )}
          {area === 'home' && phase === 'welcome' && !isAuto && !data.failed && <WelcomeV3 setTick={data.setTick} />}
          {area === 'home' && ((phase === 'setup' && !isAuto) || data.failed) && (
            <Overview input={data.input} summary={data.summary} phase={phase} loading={data.loading} failed={data.failed} ticksOnServer={data.ticksOnServer} gbpEnabled={data.gbpEnabled} go={goView} setTick={data.setTick} onRetry={data.reload} monthly={monthly} requestsSent={data.requestsSent} email={email} />
          )}
          {view === 'progress' && <ProgressV3 summary={data.summary} monthly={monthly} go={goView} />}
          {view === 'more' && <MoreV3 go={goView} />}
          {view === 'setup' && (
            <ViewFrame view="setup" fromMore={fromMore} go={goView} backLabel={backLabel}><SetupArchive input={data.input} go={goView} setTick={data.setTick} ticksOnServer={data.ticksOnServer} /></ViewFrame>
          )}
          {view === 'profile' && (
            <ViewFrame view="profile" fromMore={fromMore} go={goView} backLabel={backLabel}>
              <GbpCard />
              <BusinessAuditCard />
            </ViewFrame>
          )}
          {view === 'reviews' && (
            <ViewFrame view="reviews" fromMore={fromMore} go={goView}>
              {isAuto && <ReviewKit auto={auto} onBusiness={() => go('business')} />}
              {!isAuto && <ReviewsCard />}
              <ReviewDraftsCard />
              <ReviewRequestsCard />
              {isAuto && <ReviewsCard />}
            </ViewFrame>
          )}
          {view === 'content' && <ViewFrame view="content" fromMore={fromMore} go={goView} backLabel={backLabel}><ContentPlanCard /></ViewFrame>}
          {view === 'leads' && (
            <ViewFrame view="leads" fromMore={fromMore} go={goView} backLabel={backLabel}>
              <LeadsTable items={data.items} summary={data.summary} />
              <ExternalSiteCard />
            </ViewFrame>
          )}
        </motion.div>
      </AnimatePresence>
      <FeedbackBox page={view ?? area} />
    </div>
  );
}
