import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { trackAccount } from '../lib/journeyClient';
import ReviewRequestsCard from '../components/ReviewRequestsCard';
import ReviewDraftsCard from '../components/ReviewDraftsCard';
import ContentPlanCard from '../components/ContentPlanCard';
import ExternalSiteCard from '../components/ExternalSiteCard';
import { Segments } from './ui';
import { Facts, Success } from './GuidedSetup';
import { SUCCESS_MS } from './guided';
import { REQUESTS_GOAL, monthlySuccess, remainingText, type MonthlyId } from './monthly';
import type { Monthly } from './useMonthly';

// "משימת החודש": one task at a time, in the same structure as the setup steps. A task finishes
// when we see it in the data (or the customer confirms), then a short success screen shows and the
// next task opens. "אעשה אחר כך" postpones without blocking.

interface Props {
  monthly: Monthly;
  requestsSent: number;
  reload: () => void;
}

function Body({ id, requestsSent, reload }: { id: MonthlyId; requestsSent: number; reload: () => void }) {
  switch (id) {
    case 'review_requests':
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-[var(--ink)]">החודש נשלחו {Math.min(requestsSent, REQUESTS_GOAL)} מתוך {REQUESTS_GOAL}.</p>
          <ReviewRequestsCard onSent={reload} />
        </div>
      );
    case 'review_replies':
      return <ReviewDraftsCard onChange={reload} />;
    case 'search_phrases':
      return <ContentPlanCard />;
    case 'tracking':
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--muted)]">אם הפניות כבר מגיעות, המשימה נסגרת לבד. אם לא, מטמיעים את הקישור או שורת הקוד באתר, ואז לוחצים ״סיימתי״.</p>
          <ExternalSiteCard />
        </div>
      );
  }
}

// One view event per task per page load, however often the home screen is opened.
const viewedThisLoad = new Set<string>();

export default function MonthlyTask({ monthly, requestsSent, reload }: Props) {
  const { view } = monthly;
  const [confirmFor, setConfirmFor] = useState<MonthlyId | null>(null);
  const [flash, setFlash] = useState<ReturnType<typeof monthlySuccess> | null>(null);
  const prevDone = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cur = view.current;

  const doneKey = view.tasks.filter((t) => t.done).map((t) => t.id).join(',');
  useEffect(() => {
    const now = new Set(doneKey ? doneKey.split(',') : []);
    const before = prevDone.current === null ? null : new Set(prevDone.current ? prevDone.current.split(',') : []);
    prevDone.current = doneKey;
    if (!before) return;
    const fresh = [...now].filter((id) => !before.has(id));
    if (fresh.length === 0) return;
    const id = fresh[0] as MonthlyId;
    trackAccount('step_completed', { step_id: `month_${id}`, mode: 'month' });
    setConfirmFor(null);
    setFlash(monthlySuccess(id));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setFlash(null); trackAccount('auto_advanced', { step_id: `month_${id}` }); }, SUCCESS_MS);
  }, [doneKey]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const curId = cur?.id ?? null;
  useEffect(() => {
    if (curId && !flash && !viewedThisLoad.has(curId)) { viewedThisLoad.add(curId); trackAccount('step_viewed', { step_id: `month_${curId}` }); }
  }, [curId, flash]);

  if (flash) return <Success line={flash} onNext={() => { if (timer.current) clearTimeout(timer.current); setFlash(null); }} />;

  if (!cur) {
    return (
      <section className="dv2-card flex flex-col gap-1 p-4 sm:p-5" aria-labelledby="mt-title">
        <h2 id="mt-title" className="text-lg font-bold text-[var(--ink)]">משימת החודש</h2>
        <p className="text-[15px] font-semibold text-[var(--ok-ink)]">{remainingText(view)}</p>
        <p className="text-sm text-[var(--muted)]">בחודש הבא תופיע משימה חדשה. בינתיים אפשר לראות את ההתקדמות ואת שאר הכלים תחת ״עוד״.</p>
      </section>
    );
  }
  const confirming = confirmFor === cur.id;
  return (
    <section className="dv2-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="mt-title">
      <div>
        <p className="text-sm font-bold text-[var(--accent-strong)]">משימת החודש · {remainingText(view)}</p>
        <div className="mt-2"><Segments done={view.doneCount} total={view.total} label={`${view.doneCount} מתוך ${view.total} משימות החודש הושלמו`} /></div>
        <h2 id="mt-title" className="mt-3 text-xl font-bold text-[var(--ink)]">{cur.title}</h2>
        {view.revisiting && <p className="mt-1 text-sm text-[var(--muted)]">דילגת על המשימה הזאת קודם. אפשר לעשות אותה עכשיו.</p>}
      </div>
      <Facts s={cur} now />
      <hr className="border-[var(--line)]" />
      <Body id={cur.id} requestsSent={requestsSent} reload={reload} />
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--tint)] p-3" role="group" aria-label="אישור">
          <p className="text-[15px] font-bold text-[var(--ink)]">הכול מוכן? אחרי האישור עוברים למשימה הבאה.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="dv2-btn" onClick={() => monthly.done(cur.id)}>כן, סיימתי</button>
            <button type="button" className="dv2-btn-ghost" onClick={() => setConfirmFor(null)}>עוד לא</button>
          </div>
        </div>
      ) : (
        <button type="button" className="dv2-btn self-start" onClick={() => setConfirmFor(cur.id)}>{cur.cta} <ArrowLeft size={16} aria-hidden /></button>
      )}
      {!view.onlyThisLeft && (
        <button type="button" className="min-h-[44px] self-start px-1 text-sm font-semibold text-[var(--muted)] underline underline-offset-4"
          onClick={() => { monthly.skip(cur.id); trackAccount('step_skipped', { step_id: `month_${cur.id}` }); }}>
          אעשה אחר כך
        </button>
      )}
    </section>
  );
}

