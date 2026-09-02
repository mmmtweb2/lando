import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Plus, ExternalLink, Loader2,
  LayoutDashboard, FileText, Users, LogOut,
  CheckCircle, Clock, Trash2, Menu, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { authFetch } from '../lib/api';
import { LandoMark, LandoBot } from '../components/Lando';
import LeadsTable, { type LeadRow } from '../components/LeadsTable';
import WalletBadge from '../components/WalletBadge';
import ReferralCard from '../components/ReferralCard';
import SetPasswordCard from '../components/SetPasswordCard';

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

// ─── Motion variants ──────────────────────────────────────────────────────────

const cardItem = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };
const cardContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };
const springTap = { type: 'spring', stiffness: 400, damping: 10 } as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavItem({ icon, label, active = false, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2.5 w-full rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors ${
      active
        ? 'bg-[#E4EAFB] text-[#1E4FD6]'
        : 'text-slate-500 hover:bg-[#EEF1FB] hover:text-[#1E4FD6]'
    }`}>
      <span className={active ? 'text-[#2E63F6]' : ''}>{icon}</span>
      {label}
    </button>
  );
}

function StatCard({ label, value, icon, color = 'text-slate-700', bg = 'bg-white' }: {
  label: string; value: string; icon: ReactNode; color?: string; bg?: string;
}) {
  return (
    <motion.div
      variants={cardItem}
      className={`rounded-3xl ${bg} border border-[#DCE4F7] shadow-sm shadow-blue-100 p-5 flex flex-col gap-2`}
    >
      <div className={color}>{icon}</div>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </motion.div>
  );
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const full = total > 0 && used >= total;
  return (
    <div className="h-2 rounded-full bg-[#E4EAFB] overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: full ? '#FF7A6B' : '#2E63F6' }}
      />
    </div>
  );
}

function BalanceCard({ plan, onBuyBundle }: { plan: AccountStatus; onBuyBundle: () => void }) {
  const hasBalance = plan.pageCredits > 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl bg-white border border-[#DCE4F7] shadow-sm shadow-blue-100 p-5 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-slate-800">יתרת הדפים שלי</span>
          {plan.whiteLabel && (
            <span className="text-xs font-bold rounded-full px-2.5 py-0.5 bg-[#E4EAFB] text-[#1E4FD6]">
              ללא מיתוג Pagey
            </span>
          )}
        </div>
        <button
          onClick={onBuyBundle}
          className="inline-flex items-center gap-1 rounded-full bg-[#2E63F6] hover:bg-[#1E4FD6] text-white text-xs font-bold px-3 py-1.5 transition"
        >
          {hasBalance ? 'רכישת דפים נוספים' : 'רכישת חבילת דפים'}
        </button>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-black text-slate-800">{plan.pageCredits}</span>
        <span className="text-sm text-slate-500">דפים זמינים לפרסום</span>
      </div>

      {hasBalance ? (
        <p className="text-sm text-slate-500">
          כל פרסום של דף מנכה דף אחד מהיתרה. היתרה אינה פגה ואינה מתחדשת חודשית — מה שרכשתם נשאר עד שתשתמשו בו.
        </p>
      ) : (
        <p className="text-sm text-slate-500">
          פרסום דף בודד עולה 249 ₪, חד־פעמי. בחבילת דפים המחיר לדף יורד ל־186 ₪ (5 דפים) או 125 ₪ (10 דפים).
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">דפים באוויר</span>
            <span className="font-bold text-slate-700">{plan.activePages}</span>
          </div>
        </div>
        {plan.monthlyCreate > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">דפים שנוצרו החודש</span>
              <span className="font-bold text-slate-700">{plan.createdThisPeriod} / {plan.monthlyCreate}</span>
            </div>
            <UsageBar used={plan.createdThisPeriod} total={plan.monthlyCreate} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: PageRow['status'] }) {
  if (status === 'frozen') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 text-sky-700 text-xs font-bold px-2.5 py-1 flex-shrink-0">
        <Clock size={10} /> לא פעיל
      </span>
    );
  }
  if (status === 'published') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 flex-shrink-0">
        <CheckCircle size={10} /> פורסם
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-600 text-xs font-bold px-2.5 py-1 flex-shrink-0">
      <Clock size={10} /> טיוטה
    </span>
  );
}

// ─── Tab bar (pill toggles) ───────────────────────────────────────────────────

interface TabBarProps {
  active: ActiveTab;
  onChange: (tab: ActiveTab) => void;
  pageCount: number;
  leadCount: number;
}

function TabBar({ active, onChange, pageCount, leadCount }: TabBarProps) {
  const tabs: { id: ActiveTab; label: string; count: number }[] = [
    { id: 'pages', label: '🗂️ הדפים שלי', count: pageCount },
    { id: 'leads', label: '📥 לידים', count: leadCount },
  ];
  return (
    <div className="flex gap-1.5 bg-[#E4EAFB]/60 rounded-full p-1.5">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-full transition-all ${
            active === tab.id
              ? 'bg-white text-[#1E4FD6] shadow-sm shadow-blue-200'
              : 'text-[#8CA0D6] hover:text-[#2E63F6]'
          }`}
        >
          {tab.label}
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-black ${
            active === tab.id
              ? 'bg-[#E4EAFB] text-[#1E4FD6]'
              : 'bg-white/60 text-[#8CA0D6]'
          }`}>
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
    <div className={`rounded-2xl px-3 py-2.5 text-xs ${frozen ? 'bg-sky-50 text-sky-800' : 'bg-amber-50 text-amber-800'}`}>
      <p className="font-semibold leading-relaxed">{text}</p>
      <button
        onClick={() => onRenew(page.id)}
        disabled={busy}
        className={`mt-2 w-full rounded-xl px-3 py-2 text-xs font-bold text-white transition disabled:opacity-60 ${frozen ? 'bg-sky-600 hover:bg-sky-700' : 'bg-amber-500 hover:bg-amber-600'}`}
      >
        {busy ? 'רגע…' : `${frozen ? 'החזירו לאוויר' : 'חדשו לשנה נוספת'} — ${RENEWAL_PRICE} ₪`}
      </button>
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
      <div className="rounded-3xl border-2 border-dashed border-[#C6D2F2] bg-[#EEF1FB]/40 p-12 flex flex-col items-center gap-3 text-center">
        <div className="lando-hover"><LandoBot mood="default" size={96} /></div>
        <p className="text-sm font-bold text-[#1E4FD6]">
          לבנות דף נחיתה? זה משחק ילדים (שמביא כסף אמיתי).
        </p>
        <Link to="/create" className="text-sm font-bold text-[#2E63F6] hover:text-[#0E2148] underline underline-offset-2 transition">
          בוא נתחיל! 🚀
        </Link>
      </div>
    );
  }
  return (
    <motion.div
      variants={cardContainer} initial="hidden" animate="visible"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
    >
      {pages.map((p) => (
        <motion.div
          key={p.id} variants={cardItem}
          whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(168,85,247,0.15)' }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="rounded-3xl bg-white border border-[#DCE4F7] shadow-sm shadow-blue-100 p-5 flex flex-col gap-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {p.logo_url ? (
                <img
                  src={p.logo_url} alt={p.business_name}
                  className="w-10 h-10 rounded-2xl object-contain bg-[#EEF1FB] flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-2xl bg-[#E4EAFB] flex items-center justify-center text-[#2E63F6] font-black text-sm flex-shrink-0">
                  {p.business_name.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-bold text-slate-800 text-sm truncate">{p.business_name}</p>
                <p className="text-xs text-slate-400 font-mono">/p/{p.slug}</p>
              </div>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <p className="text-xs text-slate-400">{formatDate(p.created_at)}</p>
          {needsRenewal(p) && (
            <RenewalNotice page={p} onRenew={onRenew} busy={renewingId === p.id} />
          )}
          <div className="mt-auto pt-2 border-t border-[#E9EEFB] flex items-center justify-between">
            <Link
              to={`/p/${p.slug}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-bold text-[#2E63F6] hover:text-[#0E2148] transition"
            >
              <ExternalLink size={12} />
              צפייה בדף
            </Link>
            <button
              onClick={() => onDelete(p.id, p.business_name)}
              title="מחק דף"
              className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-red-500 transition"
            >
              <Trash2 size={12} />
              מחק
            </button>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ─── Skeleton loader ─────────────────────────────────────────────────────────

function PageGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-3xl bg-white border border-[#DCE4F7] p-5 flex flex-col gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-2xl bg-[#E4EAFB]" />
          <div className="h-3.5 rounded-full bg-[#E4EAFB] w-3/4" />
          <div className="h-2.5 rounded-full bg-[#EEF1FB] w-1/2" />
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
  const [upgrading, setUpgrading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);

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
      <div className="min-h-screen flex items-center justify-center bg-[#EEF1FB]">
        <Loader2 size={32} className="animate-spin text-[#8CA0D6]" />
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
    if (!user?.email || upgrading) return;
    setUpgrading(true);
    try {
      const r = await authFetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'bundle', reference: bundleKey }),
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
    if (!user?.email || buying) return;
    setBuying(true);
    try {
      // Start a real SUMIT payment and redirect to the secure page. Credits are
      // granted on the server after payment is verified (on return).
      const r = await authFetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'credits', reference: pack }),
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
    { icon: <FileText size={17} />, label: 'הגדרות', tab: 'settings' },
  ];

  return (
    <div className="min-h-screen bg-[#EEF1FB] flex" dir="rtl">

      {/* Payment return toast */}
      {paymentNotice && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[70] rounded-xl px-5 py-3 text-sm font-semibold shadow-lg ${paymentNotice.ok ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'}`}>
          {paymentNotice.ok ? '✓ ' : ''}{paymentNotice.text}
        </div>
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-l border-[#DCE4F7] sticky top-0 h-screen flex-shrink-0">
        <div className="px-5 py-5 border-b border-[#DCE4F7]">
          <Link to="/" className="flex items-center gap-2">
            <LandoMark size={30} />
            <span className="text-base font-black" style={{ color: 'var(--navy)' }}>Pagey</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          {/* "סקירה כללית" has no separate view of its own — the pages tab already
              doubles as the dashboard's overview (stats + plan + pages grid), so this
              item is just another way in to the same 'pages' tab. */}
          <NavItem icon={<LayoutDashboard size={17} />} label="סקירה כללית" active={activeTab === 'pages'} onClick={() => setActiveTab('pages')} />
          <NavItem icon={<Globe size={17} />} label="הדפים שלי" active={activeTab === 'pages'} onClick={() => setActiveTab('pages')} />
          <NavItem icon={<Users size={17} />} label="לידים" active={activeTab === 'leads'} onClick={() => setActiveTab('leads')} />
          <NavItem icon={<FileText size={17} />} label="הגדרות" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div className="px-3 py-4 border-t border-[#DCE4F7]">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-[#EEF1FB] hover:text-[#1E4FD6] transition-colors"
          >
            <LogOut size={16} /> יציאה
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
              className="fixed inset-0 z-[90] bg-black/50 lg:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              key="mobile-nav-drawer"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 right-0 z-[95] w-72 max-w-[80vw] bg-white border-l border-[#DCE4F7] flex flex-col shadow-2xl lg:hidden"
              dir="rtl"
            >
              <div className="px-5 py-5 border-b border-[#DCE4F7] flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2" onClick={() => setMobileNavOpen(false)}>
                  <LandoMark size={30} />
                  <span className="text-base font-black" style={{ color: 'var(--navy)' }}>Pagey</span>
                </Link>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="סגור תפריט"
                  className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:bg-[#EEF1FB] hover:text-[#1E4FD6] transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
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

              <div className="px-3 py-4 border-t border-[#DCE4F7]">
                <button
                  onClick={() => { setMobileNavOpen(false); handleLogout(); }}
                  className="flex items-center gap-2 w-full rounded-2xl px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-[#EEF1FB] hover:text-[#1E4FD6] transition-colors"
                >
                  <LogOut size={16} /> יציאה
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-[#DCE4F7]/80 shadow-sm shadow-blue-100/40 px-5 h-14 flex items-center justify-between flex-shrink-0">
          <h1 className="text-sm font-black text-[#1E4FD6]">Pagey ✦</h1>
          <div className="flex items-center gap-3">
            <WalletBadge email={user.email} refreshKey={walletKey} />
            <button
              onClick={() => setShowBuyCredits(true)}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 transition">
              + טען קרדיטים
            </button>
            <span className="hidden sm:block text-xs text-slate-400 font-mono truncate max-w-48">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="lg:hidden flex items-center gap-1.5 text-sm text-slate-400 hover:text-[#2E63F6] transition"
              aria-label="יציאה"
            >
              <LogOut size={15} />
            </button>
            <button
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden flex items-center gap-1.5 text-sm text-slate-400 hover:text-[#2E63F6] transition"
              aria-label="פתח תפריט"
            >
              <Menu size={18} />
            </button>
          </div>
        </header>

        {showBuyCredits && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50" onClick={() => !buying && setShowBuyCredits(false)}>
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 flex flex-col gap-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-slate-900">טעינת קרדיטים</h3>
                {!buying && <button onClick={() => setShowBuyCredits(false)} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-lg leading-none">×</button>}
              </div>
              <p className="text-sm text-slate-500">קרדיטים משמשים ליצירת תמונות וכתיבה מחדש ב-AI.</p>
              <div className="grid grid-cols-1 gap-3">
                <button disabled={buying} onClick={() => handleBuyCredits('small')}
                  className="flex items-center justify-between p-4 rounded-2xl border-2 border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 transition disabled:opacity-50">
                  <span className="font-bold text-slate-800">10 קרדיטים</span>
                  <span className="font-extrabold text-indigo-600">₪49</span>
                </button>
                <button disabled={buying} onClick={() => handleBuyCredits('large')}
                  className="flex items-center justify-between p-4 rounded-2xl border-2 border-indigo-300 bg-indigo-50/50 hover:border-indigo-500 transition disabled:opacity-50">
                  <span className="font-bold text-slate-800">100 קרדיטים <span className="text-xs font-semibold text-emerald-600">(הכי משתלם)</span></span>
                  <span className="font-extrabold text-indigo-600">₪399</span>
                </button>
              </div>
              {buying && <p className="text-sm text-center text-slate-500">מעבד תשלום...</p>}
              {buyMsg && (
                <p className={`text-sm text-center font-semibold rounded-xl px-3 py-2 ${buyMsg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                  {buyMsg.ok ? '✓ ' : ''}{buyMsg.text}
                </p>
              )}
              <p className="text-[11px] text-slate-400 text-center">תשלום מדומה לצורכי בדיקה</p>
            </div>
          </div>
        )}

        {showPlans && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50" onClick={() => !upgrading && setShowPlans(false)}>
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl p-6 flex flex-col gap-4" dir="rtl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-slate-900">רכישת חבילת דפים</h3>
                {!upgrading && <button onClick={() => setShowPlans(false)} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-lg leading-none">×</button>}
              </div>
              <p className="text-sm text-slate-500">
                דף בודד עולה {singlePagePrice} ₪, חד־פעמי. חבילת דפים היא רכישה חד־פעמית שמוזילה את המחיר לדף —
                בלי מנוי, בלי חידוש, בלי תאריך תפוגה. היתרה נשארת בחשבון עד שתשתמשו בה.
              </p>
              {plan && plan.pageCredits > 0 && (
                <p className="text-sm rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2">
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
                    <div key={key} className={`flex flex-col gap-3 p-5 rounded-2xl border-2 ${highlight ? 'border-[#2E63F6] bg-[#EEF1FB]/50' : 'border-slate-200'}`}>
                      <div className="flex items-baseline justify-between">
                        <span className="font-black text-slate-800">{b.label}</span>
                        <span className="text-left"><span className="text-xl font-extrabold text-[#2E63F6]">₪{b.price.toLocaleString()}</span><span className="text-xs text-slate-400"> חד־פעמי</span></span>
                      </div>
                      <p className="text-xs font-bold text-emerald-600">₪{perPage} לדף — חיסכון של {savePct}%</p>
                      <ul className="text-sm text-slate-600 flex flex-col gap-1.5">
                        <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> {b.pages} דפים לפרסום, ללא תאריך תפוגה</li>
                        <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> {b.aiCredits} קרדיטי AI במתנה</li>
                        {b.whiteLabel && <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> בונוס: הסרת מיתוג Pagey מהדפים, לתמיד</li>}
                      </ul>
                      <button
                        disabled={upgrading}
                        onClick={() => handleBuyBundle(key)}
                        className={`mt-auto rounded-xl py-2.5 text-sm font-bold transition disabled:opacity-50 ${highlight ? 'bg-[#2E63F6] hover:bg-[#1E4FD6] text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}
                      >
                        {upgrading ? 'מעבד…' : 'רכישת החבילה'}
                      </button>
                    </div>
                  );
                })}
              </div>
              {!plan?.whiteLabel && bundlesCatalog.whitelabel_addon && (
                <div className="flex items-center justify-between gap-3 p-4 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-slate-800 text-sm">{bundlesCatalog.whitelabel_addon.label}</span>
                    <span className="text-xs text-slate-500">תוסף עצמאי, לא תלוי בחבילת דפים — לתמיד, ללא תלות במה שכבר רכשת.</span>
                  </div>
                  <button
                    disabled={upgrading}
                    onClick={() => handleBuyBundle('whitelabel_addon')}
                    className="flex-shrink-0 rounded-xl py-2 px-4 text-sm font-bold bg-slate-800 hover:bg-slate-900 text-white transition disabled:opacity-50"
                  >
                    {upgrading ? 'מעבד…' : `רכישה — ₪${bundlesCatalog.whitelabel_addon.price}`}
                  </button>
                </div>
              )}
              {buyMsg && !buyMsg.ok && (
                <p className="text-sm text-center font-semibold rounded-xl px-3 py-2 text-red-600 bg-red-50">{buyMsg.text}</p>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 px-5 py-8 flex flex-col gap-8 max-w-5xl w-full mx-auto">

          {/* Welcome */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-2xl font-black text-slate-800">
              שלום 👋{' '}
              <span className="text-[#2E63F6] font-mono text-base">{user.email}</span>
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              שכח מכל מה שידעת על בניית אתרים. בוא נשחק.{' '}
              <span className="select-none">🎮</span>
            </p>
          </motion.div>

          {activeTab === 'settings' ? (
            /* ── Settings (billing/plan/credits) ─────────────────────────── */
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col gap-5"
            >
              <div>
                <h3 className="text-lg font-black text-slate-800">הגדרות חשבון וחיוב</h3>
                <p className="text-sm text-slate-500 mt-1">המסלול והקרדיטים שלך, במקום אחד.</p>
              </div>

              {plan ? (
                <BalanceCard plan={plan} onBuyBundle={() => setShowPlans(true)} />
              ) : (
                <div className="rounded-3xl bg-white border border-[#DCE4F7] shadow-sm shadow-blue-100 p-5 text-sm text-slate-400">
                  טוען נתוני מסלול…
                </div>
              )}

              <div className="rounded-3xl bg-white border border-[#DCE4F7] shadow-sm shadow-blue-100 p-5 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black text-slate-800">יתרת קרדיטים</span>
                  <WalletBadge email={user.email} refreshKey={walletKey} />
                </div>
                <button
                  onClick={() => setShowBuyCredits(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 transition">
                  + טען קרדיטים
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              {/* Stats */}
              <motion.div
                variants={cardContainer} initial="hidden" animate="visible"
                className="grid grid-cols-2 sm:grid-cols-3 gap-4"
              >
                <StatCard
                  label="סה״כ דפים"
                  value={dataLoading ? '—' : String(pages.length)}
                  icon={<Globe size={20} />}
                  color="text-[#2E63F6]"
                  bg="bg-[#EEF1FB]/60"
                />
                <StatCard
                  label="דפים פעילים"
                  value={dataLoading ? '—' : String(publishedPages.length)}
                  icon={<CheckCircle size={20} />}
                  color="text-emerald-600"
                  bg="bg-emerald-50/60"
                />
                <StatCard
                  label="לידים שהתקבלו"
                  value={dataLoading ? '—' : String(leads.length)}
                  icon={<Users size={20} />}
                  color="text-orange-500"
                  bg="bg-orange-50/60"
                />
              </motion.div>

              {/* Plan + usage */}
              {plan && <BalanceCard plan={plan} onBuyBundle={() => setShowPlans(true)} />}

              {/* Referral */}
              {portalUser && <ReferralCard user={portalUser} />}

              {/* Set a password (for users who signed up via magic link) */}
              <SetPasswordCard />

              {/* Tab bar + tab content */}
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <TabBar
                    active={activeTab}
                    onChange={setActiveTab}
                    pageCount={pages.length}
                    leadCount={leads.length}
                  />
                  {activeTab === 'pages' && (
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      transition={springTap}
                      className="flex-shrink-0"
                    >
                      <Link
                        to="/create"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#2E63F6] px-5 py-2.5 text-sm font-black text-white shadow-md hover:bg-[#1E4FD6] transition"
                      >
                        <Plus size={15} /> דף חדש ✨
                      </Link>
                    </motion.div>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
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
                          <Loader2 size={24} className="animate-spin text-[#8CA0D6]" />
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
      </div>
    </div>
  );
}
