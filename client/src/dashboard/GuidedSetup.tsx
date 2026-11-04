import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, Check as CheckIcon, Copy, ExternalLink, Loader2, Search } from 'lucide-react';
import { authFetch } from '../lib/api';
import { takePlace, trackAccount } from '../lib/journeyClient';
import ReviewRequestsCard from '../components/ReviewRequestsCard';
import NoProfileGuide from '../components/NoProfileGuide';
import { Segments, Who } from './ui';
import type { OverviewInput } from './journey';
import {
  GOOGLE_BUSINESS_URL, GUIDED_COPY, GUIDED_TOTAL, SUCCESS_MS, cardTexts, deriveGuided, minutesText, parseSkips, successLine, withSkip,
  type GuidedId, type StepCopy, type SuccessLine,
} from './guided';

// The guided setup (spec v4): one step per screen, no tabs, one main button. When a step finishes
// (we detect it, or the customer says "סיימתי") a short success screen shows and then the next step
// opens by itself. "אעשה אחר כך" postpones a step without blocking; it comes back at the end.
// Progress is saved by the existing setup ticks, so closing the tab and coming back lands on the
// same step.

interface Props {
  input: OverviewInput;
  email: string;
  ticksOnServer: boolean;
  setTick: (key: string, done: boolean) => Promise<void>;
  reload: () => void;
  onFullMenu: () => void;
}

const SKIP_KEY = 'pagey_setup_skips:';
function readSkips(email: string): GuidedId[] {
  try { return parseSkips(window.localStorage.getItem(SKIP_KEY + email)); } catch { return []; }
}
function writeSkips(email: string, v: GuidedId[]) {
  try { window.localStorage.setItem(SKIP_KEY + email, JSON.stringify(v)); } catch { /* not remembered */ }
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/* ---------- step bodies ---------- */

interface Suggestion { placeId: string; name: string; details: string }

function ConnectBody({ onSaved }: { onSaved: () => void }) {
  const inputId = useId();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const seq = useRef(0);
  const [token] = useState<string>(() => { try { return crypto.randomUUID(); } catch { return 'session-token'; } });

  const save = useCallback(async (placeId: string) => {
    setSaving(true); setErr(null);
    try {
      const r = await authFetch('/api/seo/businesses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ placeId }),
      });
      const body = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) { setErr(body.error ?? 'השמירה נכשלה. נסו שוב.'); return; }
      window.dispatchEvent(new Event('seo-businesses-changed'));
      onSaved();
    } catch { setErr('השמירה נכשלה. בדקו את החיבור ונסו שוב.'); } finally { setSaving(false); }
  }, [onSaved]);

  // The business picked on the free check is filled in without asking again.
  useEffect(() => { const p = takePlace(); if (p) void Promise.resolve().then(() => save(p)); }, [save]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        const r = await authFetch('/api/seo/places/autocomplete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, sessionToken: token }),
        });
        const body = await r.json().catch(() => ({})) as { suggestions?: Suggestion[]; error?: string; code?: string };
        if (mine !== seq.current) return;
        if (!r.ok) { setList([]); setErr(body.code === 'places_not_configured' ? 'חיפוש העסקים יופעל בקרוב.' : (body.error ?? 'החיפוש נכשל. נסו שוב.')); return; }
        setList(body.suggestions ?? []);
      } catch { if (mine === seq.current) setErr('החיפוש נכשל. בדקו את החיבור ונסו שוב.'); } finally { if (mine === seq.current) setBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, token]);

  const shown = q.trim().length >= 2 ? list : [];
  if (noProfile) return <NoProfileGuide onBack={() => setNoProfile(false)} />;

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-semibold text-[var(--ink)]">שם העסק</label>
      <div className="relative">
        <Search size={18} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
        <input
          id={inputId} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="לדוגמה: שרברב דני, חיפה"
          className="min-h-[48px] w-full rounded-[10px] border border-[var(--line)] bg-white pr-10 pl-3 text-[16px] text-[var(--ink)]"
        />
      </div>
      <p className="sr-only" role="status" aria-live="polite">{saving ? 'שומרים את העסק' : busy ? 'מחפשים' : shown.length ? `נמצאו ${shown.length} עסקים` : ''}</p>
      {busy && <p className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 size={16} className="animate-spin" aria-hidden /> מחפשים…</p>}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shown.map((s) => (
            <li key={s.placeId}>
              <button
                type="button" disabled={saving} onClick={() => void save(s.placeId)}
                className="dv2-card-flat flex min-h-[56px] w-full flex-col items-start justify-center px-4 py-2 text-right hover:bg-[var(--tint)] disabled:opacity-60"
              >
                <span className="text-[15px] font-bold text-[var(--ink)]">{s.name}</span>
                <span className="text-sm text-[var(--muted)]">{s.details}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="text-sm font-semibold text-[var(--warn-ink)]">{err}</p>}
      <button type="button" onClick={() => setNoProfile(true)} className="min-h-[44px] self-start px-1 text-sm font-semibold text-[var(--accent-strong)] underline underline-offset-4">
        אין לעסק כרטיס בגוגל עדיין?
      </button>
    </div>
  );
}

/**
 * One request per business while the page is open: the check costs a Google Places call, and the
 * step can be mounted twice (the success screen swaps it out, dev double-render). A failure is
 * forgotten so "try again" really tries again.
 */
interface AuditReply { ok: boolean; body: { audit?: { score?: number }; error?: string } }
const auditRuns = new Map<string, Promise<AuditReply>>();
function runAudit(placeId: string): Promise<AuditReply> {
  const hit = auditRuns.get(placeId);
  if (hit) return hit;
  const p = (async (): Promise<AuditReply> => {
    const r = await authFetch(`/api/seo/places/${encodeURIComponent(placeId)}/audit`);
    const body = await r.json().catch(() => ({})) as AuditReply['body'];
    return { ok: r.ok, body };
  })();
  auditRuns.set(placeId, p);
  void p.then((v) => { if (!v.ok) auditRuns.delete(placeId); }, () => { auditRuns.delete(placeId); });
  return p;
}

/** Runs the first check by itself as soon as the step opens. The score is shown, never stored. */
function CheckBody({ placeId, onScore, onDone }: { placeId: string | null | undefined; onScore: (n: number) => void; onDone: () => Promise<void> }) {
  const [state, setState] = useState<'running' | 'failed'>('running');
  const [msg, setMsg] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!placeId) return;
    let cancelled = false;
    (async () => {
      try {
        const { ok, body } = await runAudit(placeId);
        if (cancelled) return;
        if (!ok) { setMsg(body.error ?? 'הבדיקה לא הצליחה. אפשר לנסות שוב.'); setState('failed'); return; }
        if (typeof body.audit?.score === 'number') onScore(body.audit.score);
        await onDone();
      } catch { if (!cancelled) { setMsg('הבדיקה לא הצליחה. בדקו את החיבור ונסו שוב.'); setState('failed'); } }
    })();
    return () => { cancelled = true; };
  }, [placeId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!placeId) return <p className="text-sm text-[var(--muted)]">קודם מחברים עסק, ואז הבדיקה רצה לבד.</p>;
  if (state === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm font-semibold text-[var(--warn-ink)]">{msg}</p>
        <button type="button" className="dv2-btn" onClick={() => { setState('running'); setAttempt((n) => n + 1); }}>נסו שוב</button>
      </div>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
      <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> בודקים את הכרטיס שלך מול המתחרים. זה לוקח כחצי דקה.
    </p>
  );
}

function CopyRow({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <div className="dv2-card-flat p-3">
      <p className="text-sm font-bold text-[var(--ink)]">{label}</p>
      <pre className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--ink)]" style={{ fontFamily: 'inherit' }}>{text}</pre>
      <button
        type="button" className="dv2-btn-ghost mt-2"
        onClick={async () => { setState((await copyText(text)) ? 'ok' : 'fail'); setTimeout(() => setState('idle'), 2500); }}
      >
        <Copy size={16} aria-hidden /> {state === 'ok' ? 'הועתק' : 'העתקה'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{state === 'ok' ? 'הטקסט הועתק' : state === 'fail' ? 'ההעתקה נכשלה' : ''}</span>
      {state === 'fail' && <span className="mr-2 text-sm text-[var(--warn-ink)]">לא הצלחנו להעתיק. אפשר לסמן ולהעתיק ידנית.</span>}
    </div>
  );
}

function GoogleLink({ children }: { children: string }) {
  return (
    <a href={GOOGLE_BUSINESS_URL} target="_blank" rel="noopener noreferrer" className="dv2-btn-ghost self-start">
      {children} <ExternalLink size={16} aria-hidden /> <span className="sr-only">(נפתח בלשונית חדשה)</span>
    </a>
  );
}

function StepBody({ id, input, onSaved, onScore, onAutoDone, onSent }: {
  id: GuidedId; input: OverviewInput; onSaved: () => void; onScore: (n: number) => void; onAutoDone: () => Promise<void>; onSent: () => void;
}) {
  switch (id) {
    case 'connect': return <ConnectBody onSaved={onSaved} />;
    case 'first_check': return <CheckBody placeId={input.placeId} onScore={onScore} onDone={onAutoDone} />;
    case 'profile_details':
      return (
        <div className="flex flex-col gap-3">
          <GoogleLink>פתיחת הכרטיס שלך בגוגל</GoogleLink>
          <p className="text-sm text-[var(--muted)]">נכנסים עם חשבון הגוגל שמנהל את העסק. הטקסטים כאן מוכנים להעתקה.</p>
          {cardTexts(input.businessName).map((t) => <CopyRow key={t.id} label={t.label} text={t.text} />)}
        </div>
      );
    case 'profile_verified':
      return (
        <div className="flex flex-col gap-3">
          <GoogleLink>פתיחת האימות בגוגל</GoogleLink>
          <p className="text-sm text-[var(--muted)]">גוגל תציע שיטה אחת או יותר: שיחה, הודעה או גלויה. אם נבחרה גלויה, היא מגיעה אחרי כמה ימים. אפשר לסמן ״סיימתי״ אחרי שהאימות הושלם.</p>
        </div>
      );
    case 'review_link_shared':
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--muted)]">מוסיפים לקוח מרוצה ולוחצים ״שליחה בוואטסאפ״. ההודעה יוצאת מהוואטסאפ שלך. שלחו רק ללקוחות שהיו אצלך בפועל.</p>
          <ReviewRequestsCard onSent={onSent} />
        </div>
      );
  }
}

/* ---------- screens ---------- */

function Facts({ s, now }: { s: StepCopy; now: boolean }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
      <dt className="font-bold text-[var(--ink)]">מה עושים</dt><dd className="text-[var(--ink)]">{s.what}</dd>
      <dt className="font-bold text-[var(--ink)]">למה</dt><dd className="text-[var(--muted)]">{s.why}</dd>
      <dt className="font-bold text-[var(--ink)]">כמה זמן</dt><dd className="text-[var(--muted)]">{minutesText(s.minutes)}</dd>
      <dt className="font-bold text-[var(--ink)]">מי עושה</dt><dd><Who who={s.who} /></dd>
      <dt className="font-bold text-[var(--ink)]">מתי</dt><dd className="text-[var(--muted)]">{now ? 'עכשיו' : 'אחר כך'}</dd>
    </dl>
  );
}

function Success({ line, onNext }: { line: SuccessLine; onNext: () => void }) {
  return (
    <section className="dv2-card flex flex-col items-center gap-3 p-6 text-center" role="status" aria-live="polite">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#D8F6E9] text-[var(--ok-ink)]"><CheckIcon size={30} strokeWidth={3} aria-hidden /></span>
      <h2 className="text-xl font-bold text-[var(--ink)]">{line.title}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-right text-[15px]">
        <dt className="font-bold text-[var(--muted)]">לפני</dt><dd className="text-[var(--ink)]">{line.before}</dd>
        <dt className="font-bold text-[var(--muted)]">אחרי</dt><dd className="font-semibold text-[var(--ok-ink)]">{line.after}</dd>
      </dl>
      <p className="text-sm text-[var(--muted)]">עוברים לצעד הבא…</p>
      <button type="button" className="dv2-btn-ghost" onClick={onNext}>המשך עכשיו</button>
    </section>
  );
}

export default function GuidedSetup({ input, email, ticksOnServer, setTick, reload, onFullMenu }: Props) {
  const [skips, setSkips] = useState<GuidedId[]>(() => readSkips(email));
  const [confirmFor, setConfirmFor] = useState<GuidedId | null>(null);
  const [flash, setFlash] = useState<SuccessLine | null>(null);
  const view = deriveGuided(input, skips);
  const headRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<Set<GuidedId> | null>(null);
  const scoreRef = useRef<number | null>(null);
  const viewed = useRef<Set<string>>(new Set());
  const focusedFor = useRef<GuidedId | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentId = view.current?.id ?? null;

  // A step that turns "done" while this screen is open: success screen, then the next step.
  const doneKey = view.steps.filter((s) => s.done).map((s) => s.id).join(',');
  useEffect(() => {
    const now = new Set(doneKey ? (doneKey.split(',') as GuidedId[]) : []);
    const prev = doneRef.current;
    doneRef.current = now;
    if (!prev) return;
    const fresh = [...now].filter((id) => !prev.has(id));
    if (fresh.length === 0) return;
    const id = fresh[0];
    trackAccount('step_completed', { step_id: id, mode: GUIDED_COPY[id].auto ? 'auto' : 'manual' });
    setConfirmFor(null);
    setFlash(successLine(id, { name: input.businessName, score: id === 'first_check' ? scoreRef.current : null }));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlash(null);
      trackAccount('auto_advanced', { step_id: id });
    }, SUCCESS_MS);
  }, [doneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Each step is reported as viewed once per visit; focus moves to its heading for screen readers.
  useEffect(() => {
    if (!currentId || flash) return;
    if (focusedFor.current !== null && focusedFor.current !== currentId) headRef.current?.focus({ preventScroll: true });
    focusedFor.current = currentId;
    if (!viewed.current.has(currentId)) { viewed.current.add(currentId); trackAccount('step_viewed', { step_id: currentId }); }
  }, [currentId, flash]);

  const skip = (id: GuidedId) => {
    const next = withSkip(skips, id, true);
    setSkips(next); writeSkips(email, next);
    trackAccount('step_skipped', { step_id: id });
  };
  const finishNow = () => { if (flashTimer.current) clearTimeout(flashTimer.current); setFlash(null); };

  if (flash) return <Success line={flash} onNext={finishNow} />;
  const cur = view.current;
  if (!cur) return null;   // everything is done: the dashboard shows the welcome screen

  const confirming = confirmFor === cur.id;
  const label = `צעד ${view.position} מתוך ${GUIDED_TOTAL}`;
  return (
    <div className="flex flex-col gap-4">
      <section className="dv2-hero p-4 sm:p-5" aria-labelledby="gs-title">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-[var(--accent-strong)]">{label}</p>
          <p className="text-xs text-[var(--muted)]">{view.doneCount} מתוך {GUIDED_TOTAL} הושלמו</p>
        </div>
        <div className="mt-2"><Segments done={view.doneCount} total={GUIDED_TOTAL} label={`${view.doneCount} מתוך ${GUIDED_TOTAL} צעדי הקמה הושלמו`} /></div>
        <h2 id="gs-title" ref={headRef} tabIndex={-1} className="mt-3 text-xl font-bold text-[var(--ink)] outline-none">{cur.title}</h2>
        {view.revisiting && <p className="mt-1 text-sm text-[var(--muted)]">דילגת על הצעד הזה קודם. אפשר לעשות אותו עכשיו.</p>}
        <span className="sr-only" role="status" aria-live="polite">{`${label}: ${cur.title}`}</span>
      </section>

      <section className="dv2-card flex flex-col gap-4 p-4 sm:p-5">
        <Facts s={cur} now />
        <hr className="border-[var(--line)]" />
        <StepBody
          id={cur.id} input={input}
          onSaved={reload}
          onScore={(n) => { scoreRef.current = n; }}
          onAutoDone={() => setTick('first_check', true)}
          onSent={() => void setTick('review_link_shared', true)}
        />

        {!cur.auto && (
          confirming ? (
            <div className="flex flex-col gap-2 rounded-[10px] bg-[var(--tint)] p-3" role="group" aria-label="אישור">
              <p className="text-[15px] font-bold text-[var(--ink)]">הכול מוכן? אחרי האישור עוברים לצעד הבא.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="dv2-btn" onClick={() => void setTick(cur.id, true)}>כן, סיימתי</button>
                <button type="button" className="dv2-btn-ghost" onClick={() => setConfirmFor(null)}>עוד לא</button>
              </div>
            </div>
          ) : (
            <button type="button" className="dv2-btn self-start" onClick={() => setConfirmFor(cur.id)}>
              {cur.cta} <ArrowLeft size={16} aria-hidden />
            </button>
          )
        )}

        {cur.skippable && !view.onlyThisLeft && (
          <button type="button" className="min-h-[44px] self-start px-1 text-sm font-semibold text-[var(--muted)] underline underline-offset-4" onClick={() => skip(cur.id)}>
            אעשה אחר כך
          </button>
        )}
      </section>

      {view.upcoming.length > 0 && (
        <section aria-labelledby="gs-next" className="dv2-card-flat p-4">
          <h3 id="gs-next" className="text-[15px] font-bold text-[var(--ink)]">מה בהמשך</h3>
          <ol className="mt-2 flex flex-col gap-1.5 text-sm text-[var(--muted)]">
            {view.upcoming.map((s) => <li key={s.id}>{s.title} · אחר כך</li>)}
          </ol>
        </section>
      )}

      <p className="text-xs text-[var(--muted)]">
        ההתקדמות נשמרת אוטומטית, ואפשר לחזור בכל רגע לאותו מקום.
        {!ticksOnServer && ' כרגע היא נשמרת בדפדפן הזה בלבד.'}
      </p>
      <button type="button" onClick={onFullMenu} className="min-h-[44px] self-start px-1 text-xs font-semibold text-[var(--muted)] underline underline-offset-4">
        מעבר לתפריט המלא
      </button>
    </div>
  );
}
