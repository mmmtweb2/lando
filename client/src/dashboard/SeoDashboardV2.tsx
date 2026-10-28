import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import BusinessAuditCard from '../components/BusinessAuditCard';
import ReviewsCard from '../components/ReviewsCard';
import ContentPlanCard from '../components/ContentPlanCard';
import ExternalSiteCard from '../components/ExternalSiteCard';
import SeoSubscriptionCard from '../components/SeoSubscriptionCard';
import LeadsTable from '../components/LeadsTable';
import Overview, { SetupArchive } from './Overview';
import { useSeoOverview } from './useSeoOverview';
import { VIEW_LABEL, VIEW_ORDER, derivePhase, type View } from './journey';
import './dashboard.css';

/**
 * Dashboard v2 for the Google-promotion product. Replaces the old single stack of cards with
 * separate views and a real overview. The existing cards are reused as they are (no logic changes);
 * only their placement is new. Behind a flag (see flag.ts).
 */
export default function SeoDashboardV2({ showPageUpsell = false }: { showPageUpsell?: boolean }) {
  const [view, setView] = useState<View>('overview');
  const reduce = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);
  const data = useSeoOverview();
  const phase = derivePhase(data.input);
  const navViews: View[] = phase === 'ongoing' ? [...VIEW_ORDER, 'setup'] : VIEW_ORDER;

  const go = useCallback((v: View) => {
    setView(v);
    if (v === 'overview') data.reload();   // numbers may have changed in another view
    top.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [data, reduce]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: { duration: 0.18 } };

  return (
    <div className="dv2 rounded-[18px] border-2 border-[var(--navy)] p-3 sm:p-5" dir="rtl">
      <div ref={top} className="scroll-mt-4" />
      <nav aria-label="תצוגות הקידום" className="dv2-nav -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-2 pr-1">
        {navViews.map((v) => {
          const active = v === view;
          return (
            <button
              key={v} type="button" onClick={() => go(v)} aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] flex-shrink-0 rounded-[10px] border-2 border-[var(--navy)] px-4 text-sm font-extrabold transition-colors motion-reduce:transition-none ${
                active ? 'bg-[var(--navy)] text-white shadow-[3px_3px_0_var(--glow)]' : 'bg-white text-[var(--navy)] hover:bg-[var(--tint)]'
              }`}
            >
              {VIEW_LABEL[v]}
            </button>
          );
        })}
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} {...motionProps}>
          {view === 'overview' && (
            <Overview input={data.input} summary={data.summary} phase={phase} loading={data.loading} failed={data.failed} ticksOnServer={data.ticksOnServer} go={go} setTick={data.setTick} onRetry={data.reload} />
          )}
          {view === 'setup' && <SetupArchive input={data.input} go={go} setTick={data.setTick} ticksOnServer={data.ticksOnServer} />}
          {view === 'profile' && <BusinessAuditCard />}
          {view === 'reviews' && <ReviewsCard />}
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
                  <p className="mt-1 text-sm text-[var(--muted)]">המוצר פעיל בחשבון שלכם. אם יופעל מנוי חודשי, הוא יופיע כאן, ואפשר יהיה לבטל אותו בכל רגע.</p>
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
    </div>
  );
}
