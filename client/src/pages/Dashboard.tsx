import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Plus, ExternalLink, Loader2,
  LayoutDashboard, Settings, Users, LogOut,
  CheckCircle, Check, Clock, Trash2, Menu, X, Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { authFetch } from '../lib/api';
import { LandoMark, LandoBot } from '../components/Lando';
import RefundAck from '../components/RefundAck';
import LeadsTable, { type LeadRow } from '../components/LeadsTable';
import WalletBadge from '../components/WalletBadge';
import ReferralCard from '../components/ReferralCard';
import SetPasswordCard from '../components/SetPasswordCard';
import CouponField, { type CouponQuote } from '../components/CouponField';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageRow {
  id: string;
  slug: string;
  business_name: string;
  created_at: string;
  logo_url: string | null;
  // 'frozen' = published, expired, and past its 7-day grace period. The page is
  // offline to the public but fully intact and restorable for 99₪ — see
  // src/services/renewal.service.ts.
  status: 'draft' | 'published' | 'frozen' | null;
  published_at: string | null;
  expires_at: string | null;
  frozen_at: string | null;
  renewal_count: number | null;
}

/** Annual renewal price. Mirrors RENEWAL_PRICE in src/config/billing.ts. */
const RENEWAL_PRICE = 99;

/** Show the renewal prompt on a live page once it is this close to expiring —
 *  the same T-30 threshold at which the first reminder email goes out, so the
 *  dashboard and the inbox never disagree about whether action is needed. */
const RENEWAL_NOTICE_DAYS = 30;

/** Whole days until `iso`; negative once past. null when there is no date. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86400000);
}

/** A page needs the owner's attention when it is frozen, or expiring soon. */
function needsRenewal(p: PageRow): boolean {
  if (p.status === 'frozen') return true;
  if (p.status !== 'published') return false;
  const d = daysUntil(p.expires_at);
  return d !== null && d <= RENEWAL_NOTICE_DAYS;
}

// Shape of GET /api/users/plan since 2026-09-01: subscriptions are gone,
// replaced by a never-expiring page-publish balance (see src/config/billing.ts).
interface AccountStatus {
  tier: 'free' | 'paid';
  label: string;
  /** Page-publish balance — publishing a page costs exactly 1. Never expires. */
  pageCredits: number;
  /** Lifetime page credits ever bought (drives the monthly creation cap tier). */
  pageCreditsTotal: number;
  activePages: number;
  monthlyCreate: number;
  createdThisPeriod: number;
  whiteLabel: boolean;
}

interface BundleDef {
  key: 'bundle5' | 'bundle10';
  label: string;
  pages: number;
  price: number;
  aiCredits: number;
  whiteLabel: boolean;
}

type ActiveTab = 'pages' | 'leads' | 'settings';

// ─── Design tokens ────────────────────────────────────────────────────────────
//
// One accent (the brand blue) used only on primary actions and live state;
// everything else is neutral slate. Radii top out at 12px (rounded-xl) for
// surfaces and 8px (rounded-lg) for controls. Motion is a single short fade —
// no spring physics, no staggered entrance choreography.

const ACCENT = '#2E63F6';

/** The one entrance animation used across the page. */
const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: 'easeOut' },
} as const;

const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2E63F6] hover:bg-[#1E4FD6] px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50';
const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors disabled:opacity-50';
const surface = 'rounded-xl border border-slate-200 bg-white';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavItem({ icon, label, active = false, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm transition-colors ${
      active
        ? 'bg-slate-100 text-slate-900 font-medium'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
    }`}>
      <span className={active ? 'text-[#2E63F6]' : 'text-slate-400'}>{icon}</span>
      {label}
    </button>
  );
}

/** One figure in the stat strip. Reads as data: quiet label, loud number. */
function StatCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-center gap-1.5 text-slate-500">
        <span className="text-slate-400">{icon}</span>
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const full = total > 0 && used >= total;
  return (
    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: full ? '#DC6803' : ACCENT }}
      />
    </div>
  );
}

function BalanceCard({ plan, onBuyBundle }: { plan: AccountStatus; onBuyBundle: () => void }) {
  const hasBalance = plan.pageCredits > 0;
  return (
    <section className={surface}>
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">יתרת הדפים שלי</h3>
            {plan.whiteLabel && (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                ללא מיתוג Pagey
              </span>
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">{plan.pageCredits}</span>
            <span className="text-sm text-slate-500">דפים זמינים לפרסום</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-500 max-w-xl">
            {hasBalance
              ? 'כל פרסום של דף מנכה דף אחד מהיתרה. היתרה אינה פגה ואינה מתחדשת חודשית — מה שרכשתם נשאר עד שתשתמשו בו.'
              : 'פרסום דף בודד עולה 249 ₪, חד־פעמי. בחבילת דפים המחיר לדף יורד ל־186 ₪ (5 דפים) או 125 ₪ (10 דפים).'}
          </p>
        </div>
        <button onClick={onBuyBundle} className={`${btnSecondary} flex-shrink-0`}>
          {hasBalance ? 'רכישת דפים נוספים' : 'רכישת חבילת דפים'}
        </button>
      </div>

      <div className="grid sm:grid-cols-2 border-t border-slate-100">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <span className="text-sm text-slate-500">דפים באוויר</span>
          <span className="text-sm font-medium text-slate-900 tabular-nums">{plan.activePages}</span>
        </div>
        {plan.monthlyCreate > 0 && (
          <div className="flex flex-col gap-2 px-5 py-3.5 border-t border-slate-100 sm:border-t-0 sm:border-s sm:border-slate-100">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-500">דפים שנוצרו החודש</span>
              <span className="text-sm font-medium text-slate-900 tabular-nums">{plan.createdThisPeriod} / {plan.monthlyCreate}</span>
            </div>
            <UsageBar used={plan.createdThisPeriod} total={plan.monthlyCreate} />
          </div>
        )}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: PageRow['status'] }) {
  if (status === 'frozen') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 flex-shrink-0">
        <Clock size={11} className="text-slate-400" /> לא פעיל
      </span>
    );
  }
  if (status === 'published') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> פורסם
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 flex-shrink-0">
      <Clock size={11} className="text-amber-500" /> טיוטה
    </span>
  );
}

// ─── Tab bar (segmented control) ──────────────────────────────────────────────

interface TabBarProps {
  active: ActiveTab;
  onChange: (tab: ActiveTab) => void;
  pageCount: number;
  leadCount: number;
}

function TabBar({ active, onChange, pageCount, leadCount }: TabBarProps) {
  const tabs: { id: ActiveTab; label: string; count: number }[] = [
    { id: 'pages', label: 'הדפים שלי', count: pageCount },
    { id: 'leads', label: 'לידים', count: leadCount },
  ];
  return (
    <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
            active === tab.id
              ? 'bg-white text-slate-900 font-medium shadow-sm'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          {tab.label}
          <span className={`text-xs tabular-nums ${active === tab.id ? 'text-slate-500' : 'text-slate-400'}`}>
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Page cards ───────────────────────────────────────────────────────────────

/**
 * The renewal call-to-action on a page card. Rendered only when the page is
 * frozen or inside the 30-day warning window, so a healthy page's card is
 * completely unchanged — the prompt is a signal, and a permanent one is noise.
 */
function RenewalNotice({
  page, onRenew, busy,
}: { page: PageRow; onRenew: (id: string) => void; busy: boolean }) {
  const frozen = page.status === 'frozen';
  const days = daysUntil(page.expires_at);

  // Frozen states the consequence and the remedy together — never a bare
  // "expired", which tells the owner their page is gone when in fact everything
  // is intact and one payment away from being live again.
  const text = frozen
    ? 'הדף ירד מהאוויר. התוכן והלידים שמורים — חידוש יחזיר אותו מיד.'
    : days !== null && days <= 0
      ? 'הדף פג תוקף היום. הוא יישאר באוויר עוד שבוע.'
      : `הדף יפוג בעוד ${days} ימים.`;

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${frozen ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}>
      <p className={`text-xs leading-relaxed ${frozen ? 'text-slate-600' : 'text-amber-800'}`}>{text}</p>
      <button
        onClick={() => onRenew(page.id)}
        disabled={busy}
        className={`mt-2.5 w-full rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50 ${frozen ? 'bg-slate-800 hover:bg-slate-900' : 'bg-amber-600 hover:bg-amber-700'}`}
      >
        {busy ? 'רגע…' : `${frozen ? 'החזירו לאוויר' : 'חדשו לשנה נוספת'} — ${RENEWAL_PRICE} ₪`}
      </button>
      {/* Same pre-payment disclosure as the other paid entry points. No
          checkbox here: a renewal re-buys a product this owner already bought
          and is initiated from a card, not a checkout modal — the ack lives in
          the two modals where a NEW product is purchased. */}
      <p className="mt-1.5 text-[10px] leading-snug opacity-70">
        חידוש הוא תשלום חד־פעמי, ללא חיוב אוטומטי. תוכן דיגיטלי המסופק מיידית — לא ניתן לביטול לאחר החידוש.{' '}
        <Link to="/terms" target="_blank" rel="noopener noreferrer" className="underline">תנאי שימוש</Link>
      </p>
    </div>
  );
}

function PageGrid({
  pages, onDelete, onRenew, renewingId,
}: {
  pages: PageRow[];
  onDelete: (id: string, name: string) => void;
  onRenew: (id: string) => void;
  renewingId: string | null;
}) {
  if (pages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 flex flex-col items-center gap-3 text-center">
        <LandoBot mood="default" size={64} />
        <div>
          <p className="text-sm font-semibold text-slate-900">עדיין אין דפים בחשבון</p>
          <p className="mt-1 text-sm text-slate-500">צרו את דף הנחיתה הראשון שלכם — זה לוקח כמה דקות.</p>
        </div>
        <Link to="/create" className={`${btnPrimary} mt-1`}>
          <Plus size={15} /> דף חדש
        </Link>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {pages.map((p) => (
        <div
          key={p.id}
          className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3 transition-colors hover:border-slate-300"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {p.logo_url ? (
                <img
                  src={p.logo_url} alt={p.business_name}
                  className="w-9 h-9 rounded-lg object-contain bg-slate-50 border border-slate-200 flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-sm flex-shrink-0">
                  {p.business_name.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium text-slate-900 text-sm truncate">{p.business_name}</p>
                <p className="text-xs text-slate-400 font-mono truncate" dir="ltr">/p/{p.slug}</p>
              </div>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <p className="text-xs text-slate-400 tabular-nums">{formatDate(p.created_at)}</p>
          {needsRenewal(p) && (
            <RenewalNotice page={p} onRenew={onRenew} busy={renewingId === p.id} />
          )}
          <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
            <Link
              to={`/p/${p.slug}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium text-[#2E63F6] hover:text-[#1E4FD6] transition-colors"
            >
              <ExternalLink size={12} />
              צפייה בדף
            </Link>
            <button
              onClick={() => onDelete(p.id, p.business_name)}
              title="מחק דף"
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 transition-colors"
            >
              <Trash2 size={12} />
              מחק
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Skeleton loader ─────────────────────────────────────────────────────────

function PageGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-3 animate-pulse">
          <div className="w-9 h-9 rounded-lg bg-slate-100" />
          <div className="h-3.5 rounded bg-slate-100 w-3/4" />
          <div className="h-2.5 rounded bg-slate-100 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const { user: portalUser } = useUser();
  const navigate = useNavigate();

  const [pages, setPages]             = useState<PageRow[]>([]);
  const [leads, setLeads]             = useState<LeadRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [activeTab, setActiveTab]     = useState<ActiveTab>('pages');
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [walletKey, setWalletKey] = useState(0);
  const [paymentNotice, setPaymentNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [plan, setPlan] = useState<AccountStatus | null>(null);
  const [bundlesCatalog, setBundlesCatalog] = useState<Record<string, BundleDef>>({});
  const [singlePagePrice, setSinglePagePrice] = useState(249);
  const [showPlans, setShowPlans] = useState(false);

  // Required pre-payment acknowledgment that a digital purchase is not
  // cancellable (חוק הגנת הצרכן s.14ג(ד)(3) — see legal/refundPolicy.ts).
  // One flag per modal, both reset every time their modal opens.
  const [bundleAck, setBundleAck] = useState(false);
  const [creditsAck, setCreditsAck] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  // An applied coupon is only a PREVIEW of the price (see CouponField). What
  // makes it real is passing `code` through to /api/payments/start, which
  // re-validates it server-side and prices the charge itself.
  type AppliedCoupon = { code: string; quotes: Record<string, CouponQuote> };
  const [bundleCoupon, setBundleCoupon] = useState<AppliedCoupon | null>(null);
  const [creditsCoupon, setCreditsCoupon] = useState<AppliedCoupon | null>(null);

  // Handle the return from the SUMIT payment redirect (?payment=success|cancelled|review|error).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('payment');
    if (!status) return;
    const NOTICES: Record<string, { text: string; ok: boolean }> = {
      success:   { text: 'התשלום התקבל! העדכון בוצע.', ok: true },
      cancelled: { text: 'התשלום בוטל. לא בוצע חיוב.', ok: false },
      review:    { text: 'קיבלנו את התשלום ואנחנו מאמתים אותו — נעדכן בקרוב.', ok: false },
      error:     { text: 'משהו השתבש בתהליך התשלום. נסו שוב.', ok: false },
    };
    setPaymentNotice(NOTICES[status] ?? null);
    if (status === 'success') setWalletKey((k) => k + 1);
    // Clean the query param so a refresh doesn't re-show the notice.
    window.history.replaceState({}, '', window.location.pathname);
    const t = setTimeout(() => setPaymentNotice(null), 6000);
    return () => clearTimeout(t);
  }, []);

  // Deep link from the publish/paywall prompt on a landing page — open the
  // bundle picker directly instead of leaving the user to find it themselves.
  // `upgrade=1` is still honoured so old links (and any bookmarked tab) keep
  // working after the rename to `bundles=1`.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('bundles') !== '1' && q.get('upgrade') !== '1') return;
    setBundleAck(false);
    setShowPlans(true);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  // Deep link from a renewal reminder email (?renew=<page id>). Deliberately
  // does NOT open the charge automatically: an email link must never be able to
  // start a payment on its own. It just lands the owner on the pages tab, where
  // the card for that page is already showing its renewal button, and says so.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get('renew')) return;
    setActiveTab('pages');
    setPaymentNotice({ text: 'הדף מסומן לחידוש — לחצו על כפתור החידוש בכרטיס הדף.', ok: true });
    window.history.replaceState({}, '', window.location.pathname);
    const t = setTimeout(() => setPaymentNotice(null), 8000);
    return () => clearTimeout(t);
  }, []);

  async function handleDeletePage(id: string, name: string) {
    if (!window.confirm(`למחוק את הדף "${name}"? פעולה זו אינה הפיכה.`)) return;
    const r = await authFetch(`/api/landing/${id}`, { method: 'DELETE' });
    if (r.ok) setPages((prev) => prev.filter((p) => p.id !== id));
    else window.alert('מחיקת הדף נכשלה. נסו שוב.');
  }

  // Guard: redirect unauthenticated visitors
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login', { replace: true });
    }
  }, [user, authLoading, navigate]);

  // Fetch pages + full lead rows once the user is known
  useEffect(() => {
    if (!user?.email) return;

    let cancelled = false;

    async function fetchData() {
      setDataLoading(true);
      try {
        // Both fetched via the backend (service-role, token-authenticated) so the
        // browser never touches the DB directly and RLS can stay locked to deny-all.
        const pagesRes = await authFetch('/api/landing/my-pages');
        if (!pagesRes.ok) throw new Error('failed to load pages');
        const pagesData = await pagesRes.json();
        const pageRows = (pagesData ?? []) as PageRow[];
        if (!cancelled) setPages(pageRows);

        // Plan + usage (non-blocking for the rest of the dashboard).
        try {
          const planRes = await authFetch('/api/users/plan');
          if (planRes.ok) {
            const pd = await planRes.json() as {
              status: AccountStatus; bundles: Record<string, BundleDef>; singlePagePrice?: number;
            };
            if (!cancelled) {
              setPlan(pd.status);
              setBundlesCatalog(pd.bundles);
              if (pd.singlePagePrice) setSinglePagePrice(pd.singlePagePrice);
            }
          }
        } catch { /* plan card just won't render */ }

        if (pageRows.length > 0) {
          const leadsRes = await authFetch('/api/landing/my-leads');
          if (!leadsRes.ok) throw new Error('failed to load leads');
          const leadsData = await leadsRes.json();
          if (!cancelled) setLeads((leadsData ?? []) as unknown as LeadRow[]);
        }
      } catch (err) {
        console.error('[Dashboard] data fetch failed:', err);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [user]);

  // Auth resolving — full-screen spinner
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={26} className="animate-spin text-slate-300" />
      </div>
    );
  }

  if (!user) return null;

  const publishedPages = pages.filter((p) => p.status === 'published');

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  async function handleBuyBundle(bundleKey: 'bundle5' | 'bundle10' | 'whitelabel_addon') {
    // The cancellation-exclusion acknowledgment gates the charge itself, not
    // just the button: no payment starts without it.
    if (!user?.email || upgrading || !bundleAck) return;
    setUpgrading(true);
    try {
      const r = await authFetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'bundle', reference: bundleKey, couponCode: bundleCoupon?.code }),
      });
      const data = await r.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
      if (!r.ok || !data.redirectUrl) throw new Error(data.error ?? 'פתיחת התשלום נכשלה');
      window.location.href = data.redirectUrl;
    } catch (e) {
      setBuyMsg({ text: e instanceof Error ? e.message : 'פתיחת התשלום נכשלה', ok: false });
      setUpgrading(false);
    }
  }

  /**
   * Start a 99₪ annual renewal for one page.
   *
   * Identical shape to the bundle/credits flows: the server opens the SUMIT
   * charge and the page is only actually renewed on the verified return, so
   * nothing here can grant anything on its own.
   */
  async function handleRenewPage(id: string) {
    if (!user?.email || renewingId) return;
    setRenewingId(id);
    try {
      const r = await authFetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'renew', reference: id }),
      });
      const data = await r.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
      if (!r.ok || !data.redirectUrl) throw new Error(data.error ?? 'פתיחת התשלום נכשלה');
      window.location.href = data.redirectUrl;
    } catch (e) {
      setBuyMsg({ text: e instanceof Error ? e.message : 'פתיחת התשלום נכשלה', ok: false });
      setRenewingId(null);
    }
  }

  async function handleBuyCredits(pack: 'small' | 'large') {
    if (!user?.email || buying || !creditsAck) return;
    setBuying(true);
    try {
      // Start a real SUMIT payment and redirect to the secure page. Credits are
      // granted on the server after payment is verified (on return).
      const r = await authFetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'credits', reference: pack, couponCode: creditsCoupon?.code }),
      });
      const data = await r.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
      if (!r.ok || !data.redirectUrl) throw new Error(data.error ?? 'פתיחת התשלום נכשלה');
      window.location.href = data.redirectUrl;
    } catch (e) {
      setBuyMsg({ text: e instanceof Error ? e.message : 'פתיחת התשלום נכשלה', ok: false });
      setBuying(false);
    }
  }

  // Shared nav item definitions — desktop sidebar and mobile drawer both drive
  // the same `activeTab` state via these, so there is only ever one nav model.
  const navItems: { icon: ReactNode; label: string; tab: ActiveTab }[] = [
    { icon: <LayoutDashboard size={17} />, label: 'סקירה כללית', tab: 'pages' },
    { icon: <Globe size={17} />, label: 'הדפים שלי', tab: 'pages' },
    { icon: <Users size={17} />, label: 'לידים', tab: 'leads' },
    { icon: <Settings size={17} />, label: 'הגדרות', tab: 'settings' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex" dir="rtl">

      {/* Payment return toast */}
      {paymentNotice && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          {paymentNotice.ok && <Check size={15} className="text-emerald-400 flex-shrink-0" />}
          {paymentNotice.text}
        </div>
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-l border-slate-200 sticky top-0 h-screen flex-shrink-0">
        <div className="px-5 h-14 flex items-center border-b border-slate-200">
          <Link to="/" className="flex items-center gap-2">
            <LandoMark size={26} />
            <span className="text-sm font-semibold tracking-tight text-slate-900">Pagey</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          {/* "סקירה כללית" has no separate view of its own — the pages tab already
              doubles as the dashboard's overview (stats + plan + pages grid), so this
              item is just another way in to the same 'pages' tab. */}
          <NavItem icon={<LayoutDashboard size={17} />} label="סקירה כללית" active={activeTab === 'pages'} onClick={() => setActiveTab('pages')} />
          <NavItem icon={<Globe size={17} />} label="הדפים שלי" active={activeTab === 'pages'} onClick={() => setActiveTab('pages')} />
          <NavItem icon={<Users size={17} />} label="לידים" active={activeTab === 'leads'} onClick={() => setActiveTab('leads')} />
          <NavItem icon={<Settings size={17} />} label="הגדרות" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div className="px-3 py-4 border-t border-slate-200">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
          >
            <LogOut size={16} className="text-slate-400" /> יציאה
          </button>
        </div>
      </aside>

      {/* ── Mobile nav drawer ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              key="mobile-nav-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[90] bg-slate-900/40 lg:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              key="mobile-nav-drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="fixed inset-y-0 right-0 z-[95] w-72 max-w-[80vw] bg-white border-l border-slate-200 flex flex-col shadow-xl lg:hidden"
              dir="rtl"
            >
              <div className="px-5 h-14 border-b border-slate-200 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2" onClick={() => setMobileNavOpen(false)}>
                  <LandoMark size={26} />
                  <span className="text-sm font-semibold tracking-tight text-slate-900">Pagey</span>
                </Link>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="סגור תפריט"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
                {navItems.map((item, i) => (
                  <NavItem
                    key={i}
                    icon={item.icon}
                    label={item.label}
                    active={activeTab === item.tab}
                    onClick={() => { setActiveTab(item.tab); setMobileNavOpen(false); }}
                  />
                ))}
              </nav>

              <div className="px-3 py-4 border-t border-slate-200">
                <button
                  onClick={() => { setMobileNavOpen(false); handleLogout(); }}
                  className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  <LogOut size={16} className="text-slate-400" /> יציאה
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 sm:px-6 h-14 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden flex items-center gap-2">
              <LandoMark size={24} />
            </span>
            <h1 className="text-sm font-semibold tracking-tight text-slate-900 truncate">
              {activeTab === 'settings' ? 'הגדרות וחיוב' : 'סקירה כללית'}
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <WalletBadge email={user.email} refreshKey={walletKey} />
            <button
              onClick={() => { setCreditsAck(false); setShowBuyCredits(true); }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium px-2.5 py-1.5 transition-colors">
              <Plus size={13} className="text-slate-400" /> טען קרדיטים
            </button>
            <span className="hidden md:block text-xs text-slate-400 font-mono truncate max-w-48" dir="ltr">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              aria-label="יציאה"
            >
              <LogOut size={15} />
            </button>
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              aria-label="פתח תפריט"
            >
              <Menu size={18} />
            </button>
          </div>
        </header>

        {showBuyCredits && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/50" onClick={() => !buying && setShowBuyCredits(false)}>
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col" dir="rtl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">טעינת קרדיטים</h3>
                {!buying && (
                  <button onClick={() => setShowBuyCredits(false)} aria-label="סגור"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="p-6 flex flex-col gap-4">
                <p className="text-sm text-slate-500">קרדיטים משמשים ליצירת תמונות וכתיבה מחדש ב-AI.</p>
                <div className="grid grid-cols-1 gap-2.5">
                  <button disabled={buying || !creditsAck} onClick={() => handleBuyCredits('small')}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 text-right hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50">
                    <span className="text-sm font-medium text-slate-900">10 קרדיטים</span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {creditsCoupon?.quotes.small ? (
                        <><span className="text-sm text-slate-400 line-through font-normal">₪49</span>{' '}
                          <span className="text-emerald-600">₪{creditsCoupon.quotes.small.finalAmount}</span></>
                      ) : '₪49'}
                    </span>
                  </button>
                  <button disabled={buying || !creditsAck} onClick={() => handleBuyCredits('large')}
                    className="flex items-center justify-between rounded-lg border border-[#2E63F6] bg-[#2E63F6]/[0.04] p-4 text-right hover:bg-[#2E63F6]/[0.08] transition-colors disabled:opacity-50">
                    <span className="text-sm font-medium text-slate-900">
                      100 קרדיטים <span className="mr-1 rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">הכי משתלם</span>
                    </span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {creditsCoupon?.quotes.large ? (
                        <><span className="text-sm text-slate-400 line-through font-normal">₪399</span>{' '}
                          <span className="text-emerald-600">₪{creditsCoupon.quotes.large.finalAmount}</span></>
                      ) : '₪399'}
                    </span>
                  </button>
                </div>
                <RefundAck variant="purchase" checked={creditsAck} onChange={setCreditsAck} compact />
                <CouponField purpose="credits" references={['small', 'large']} onChange={setCreditsCoupon} />
                {buying && <p className="text-sm text-center text-slate-500">מעבד תשלום...</p>}
                {buyMsg && (
                  <p className={`text-sm text-center font-medium rounded-lg px-3 py-2 ${buyMsg.ok ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-red-600 bg-red-50 border border-red-200'}`}>
                    {buyMsg.text}
                  </p>
                )}
                <p className="text-[11px] text-slate-400 text-center">תשלום מדומה לצורכי בדיקה</p>
              </div>
            </div>
          </div>
        )}

        {showPlans && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/50 overflow-y-auto" onClick={() => !upgrading && setShowPlans(false)}>
            <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl flex flex-col my-auto" dir="rtl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">רכישת חבילת דפים</h3>
                {!upgrading && (
                  <button onClick={() => setShowPlans(false)} aria-label="סגור"
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="p-6 flex flex-col gap-4">
                <p className="text-sm text-slate-500 leading-relaxed">
                  דף בודד עולה {singlePagePrice} ₪, חד־פעמי. חבילת דפים היא רכישה חד־פעמית שמוזילה את המחיר לדף —
                  בלי מנוי, בלי חידוש, בלי תאריך תפוגה. היתרה נשארת בחשבון עד שתשתמשו בה.
                </p>
                {plan && plan.pageCredits > 0 && (
                  <p className="text-sm rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2.5 leading-relaxed">
                    יש לך כרגע {plan.pageCredits} דפים זמינים לפרסום. רכישת חבילה נוספת מתווספת ליתרה הקיימת — שום דבר לא הולך לאיבוד.
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  {(['bundle5', 'bundle10'] as const).map((key) => {
                    const b = bundlesCatalog[key];
                    if (!b) return null;
                    const perPage = Math.round(b.price / b.pages);
                    const savePct = Math.round((1 - b.price / (b.pages * singlePagePrice)) * 100);
                    const highlight = key === 'bundle10';
                    return (
                      <div key={key} className={`flex flex-col gap-3 p-5 rounded-xl border ${highlight ? 'border-[#2E63F6] bg-[#2E63F6]/[0.03]' : 'border-slate-200'}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900">{b.label}</span>
                          <span className="text-left tabular-nums">
                            {bundleCoupon?.quotes[key] ? (
                              <>
                                <span className="text-sm text-slate-400 line-through">₪{b.price.toLocaleString()}</span>{' '}
                                <span className="text-xl font-semibold tracking-tight text-emerald-600">₪{bundleCoupon.quotes[key].finalAmount.toLocaleString()}</span>
                              </>
                            ) : (
                              <span className="text-xl font-semibold tracking-tight text-slate-900">₪{b.price.toLocaleString()}</span>
                            )}
                            <span className="text-xs text-slate-400"> חד־פעמי</span>
                          </span>
                        </div>
                        <p className="text-xs font-medium text-emerald-700 tabular-nums">₪{perPage} לדף — חיסכון של {savePct}%</p>
                        <ul className="text-sm text-slate-600 flex flex-col gap-1.5">
                          <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> {b.pages} דפים לפרסום, ללא תאריך תפוגה</li>
                          <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> {b.aiCredits} קרדיטי AI במתנה</li>
                          {b.whiteLabel && <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> בונוס: הסרת מיתוג Pagey מהדפים, לתמיד</li>}
                        </ul>
                        <button
                          disabled={upgrading || !bundleAck}
                          onClick={() => handleBuyBundle(key)}
                          className={`mt-auto rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${highlight ? 'bg-[#2E63F6] hover:bg-[#1E4FD6] text-white' : 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-700'}`}
                        >
                          {upgrading ? 'מעבד…' : 'רכישת החבילה'}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {!plan?.whiteLabel && bundlesCatalog.whitelabel_addon && (
                  <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium text-slate-900">{bundlesCatalog.whitelabel_addon.label}</span>
                      <span className="text-xs text-slate-500 leading-relaxed">תוסף עצמאי, לא תלוי בחבילת דפים — לתמיד, ללא תלות במה שכבר רכשת.</span>
                    </div>
                    <button
                      disabled={upgrading || !bundleAck}
                      onClick={() => handleBuyBundle('whitelabel_addon')}
                      className="flex-shrink-0 rounded-lg py-2 px-4 text-sm font-medium border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors disabled:opacity-50 tabular-nums"
                    >
                      {upgrading
                        ? 'מעבד…'
                        : `רכישה — ₪${(bundleCoupon?.quotes.whitelabel_addon?.finalAmount ?? bundlesCatalog.whitelabel_addon.price).toLocaleString()}`}
                    </button>
                  </div>
                )}
                {/* One coupon box for the whole modal: all three products share the
                    'bundle' purpose, so a coupon either applies to all of them or
                    to none — only the resulting price differs per product. */}
                <RefundAck variant="purchase" checked={bundleAck} onChange={setBundleAck} compact />
                <CouponField
                  purpose="bundle"
                  references={['bundle5', 'bundle10', 'whitelabel_addon']}
                  onChange={setBundleCoupon}
                />

                {buyMsg && !buyMsg.ok && (
                  <p className="text-sm text-center font-medium rounded-lg px-3 py-2 text-red-600 bg-red-50 border border-red-200">{buyMsg.text}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 px-5 sm:px-6 py-8 flex flex-col gap-8 max-w-5xl w-full mx-auto">

          {/* Page title */}
          <motion.div {...fadeIn}>
            <p className="text-xs text-slate-400 font-mono truncate" dir="ltr">{user.email}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              {activeTab === 'settings' ? 'הגדרות וחיוב' : 'סקירה כללית'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {activeTab === 'settings'
                ? 'היתרה, החבילות והקרדיטים שלך — במקום אחד.'
                : 'הדפים, היתרה והלידים שלך — במבט אחד.'}
            </p>
          </motion.div>

          {activeTab === 'settings' ? (
            /* ── Settings (billing/plan/credits) ─────────────────────────── */
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-4"
            >
              {plan ? (
                <BalanceCard plan={plan} onBuyBundle={() => { setBundleAck(false); setShowPlans(true); }} />
              ) : (
                <div className={`${surface} p-5 text-sm text-slate-400`}>
                  טוען נתוני מסלול…
                </div>
              )}

              <div className={`${surface} p-5 flex items-center justify-between gap-4 flex-wrap`}>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-500">יתרת קרדיטים</span>
                  <WalletBadge email={user.email} refreshKey={walletKey} />
                </div>
                <button
                  onClick={() => { setCreditsAck(false); setShowBuyCredits(true); }}
                  className={btnSecondary}>
                  <Plus size={14} className="text-slate-400" /> טען קרדיטים
                </button>
              </div>

              {/* Standalone white-label surfacing (2026-09-06, retention fixes):
                  previously the ₪350 white-label add-on was only reachable from
                  inside the "buy pages" modal, itself only reachable via a
                  "buy pages" button — a customer who already has enough page
                  balance and just wants the badge gone had no reason to ever
                  open that modal and no prompt telling them the option exists,
                  even though the badge shows on every page they publish. This
                  is a second, low-effort entry point into the SAME purchase
                  flow (handleBuyBundle('whitelabel_addon') via the existing
                  bundle modal + RefundAck gating) — not a new purchase path. */}
              {!plan?.whiteLabel && bundlesCatalog.whitelabel_addon && (
                <div className={`${surface} p-5 flex items-center justify-between gap-4 flex-wrap`}>
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="mt-0.5 flex-shrink-0 text-[#2E63F6]"><Sparkles size={16} /></span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-sm font-medium text-slate-900">הסרת מיתוג Pagey מהדפים שלך</span>
                      <span className="text-xs text-slate-500 leading-relaxed">
                        כרגע כל דף שלך מציג "נוצר באמצעות Pagey" בתחתית. תוסף חד־פעמי של ₪{bundlesCatalog.whitelabel_addon.price.toLocaleString()} מסיר את התיוג לצמיתות, מכל הדפים — גם הקיימים וגם העתידיים.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => { setBundleAck(false); setShowPlans(true); }}
                    className={btnSecondary}>
                    הסרת המיתוג
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <>
              {/* Stats */}
              <motion.div
                {...fadeIn}
                className="grid grid-cols-1 sm:grid-cols-3 gap-4"
              >
                <StatCard
                  label="סה״כ דפים"
                  value={dataLoading ? '—' : String(pages.length)}
                  icon={<Globe size={14} />}
                />
                <StatCard
                  label="דפים פעילים"
                  value={dataLoading ? '—' : String(publishedPages.length)}
                  icon={<CheckCircle size={14} />}
                />
                <StatCard
                  label="לידים שהתקבלו"
                  value={dataLoading ? '—' : String(leads.length)}
                  icon={<Users size={14} />}
                />
              </motion.div>

              {/* Plan + usage */}
              {plan && <BalanceCard plan={plan} onBuyBundle={() => { setBundleAck(false); setShowPlans(true); }} />}

              {/* Referral */}
              {portalUser && <ReferralCard user={portalUser} />}

              {/* Set a password (for users who signed up via magic link) */}
              <SetPasswordCard />

              {/* Tab bar + tab content */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <TabBar
                    active={activeTab}
                    onChange={setActiveTab}
                    pageCount={pages.length}
                    leadCount={leads.length}
                  />
                  {activeTab === 'pages' && (
                    <Link to="/create" className={btnPrimary}>
                      <Plus size={15} /> דף חדש
                    </Link>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    {activeTab === 'pages' ? (
                      dataLoading ? <PageGridSkeleton /> : (
                        <PageGrid
                          pages={pages}
                          onDelete={handleDeletePage}
                          onRenew={handleRenewPage}
                          renewingId={renewingId}
                        />
                      )
                    ) : (
                      dataLoading ? (
                        <div className="flex items-center justify-center py-16">
                          <Loader2 size={22} className="animate-spin text-slate-300" />
                        </div>
                      ) : (
                        <LeadsTable leads={leads} />
                      )
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </>
          )}

        </main>

        {/* Persistent legal footer — the dashboard is where purchases happen,
            so the refund/renewal terms have to be reachable from it. */}
        <footer className="border-t border-[#DCE4F7] px-5 py-6">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <Link to="/terms" className="hover:text-[#2E63F6] transition">תנאי שימוש</Link>
            <Link to="/privacy" className="hover:text-[#2E63F6] transition">מדיניות פרטיות</Link>
            <Link to="/accessibility" className="hover:text-[#2E63F6] transition">הצהרת נגישות</Link>
            <span>© {new Date().getFullYear()} Pagey</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
