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
  status: 'draft' | 'published' | null;
  published_at: string | null;
  expires_at: string | null;
}

interface PlanStatus {
  plan: 'free' | 'freelancer' | 'agency';
  label: string;
  active: boolean;
  expiresAt: string | null;
  maxActivePages: number;
  activePages: number;
  monthlyCreate: number;
  createdThisPeriod: number;
  whiteLabel: boolean;
}

interface PlanDef {
  key: 'free' | 'freelancer' | 'agency';
  label: string;
  maxActivePages: number;
  monthlyCreate: number;
  monthlyCredits: number;
  priceYear: number;
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

function PlanCard({ plan, onUpgrade }: { plan: PlanStatus; onUpgrade: () => void }) {
  const isPaid = plan.plan !== 'free' && plan.active;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl bg-white border border-[#DCE4F7] shadow-sm shadow-blue-100 p-5 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-slate-800">המסלול שלי</span>
          <span className={`text-xs font-bold rounded-full px-2.5 py-0.5 ${isPaid ? 'bg-[#E4EAFB] text-[#1E4FD6]' : 'bg-slate-100 text-slate-500'}`}>
            {plan.label}
          </span>
        </div>
        <button
          onClick={onUpgrade}
          className="inline-flex items-center gap-1 rounded-full bg-[#2E63F6] hover:bg-[#1E4FD6] text-white text-xs font-bold px-3 py-1.5 transition"
        >
          {isPaid ? 'שינוי מסלול' : 'שדרוג למסלול'}
        </button>
      </div>

      {isPaid ? (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">דפים פעילים</span>
              <span className="font-bold text-slate-700">{plan.activePages} / {plan.maxActivePages}</span>
            </div>
            <UsageBar used={plan.activePages} total={plan.maxActivePages} />
          </div>
          {plan.monthlyCreate > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">נוצרו החודש</span>
                <span className="font-bold text-slate-700">{plan.createdThisPeriod} / {plan.monthlyCreate}</span>
              </div>
              <UsageBar used={plan.createdThisPeriod} total={plan.monthlyCreate} />
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          במסלול החינמי משלמים 249 ₪ לכל דף שמפרסמים. מנוי שנתי מאפשר להחזיק כמה דפים פעילים במחיר משתלם בהרבה לדף.
        </p>
      )}

      {isPaid && plan.expiresAt && (
        <p className="text-[11px] text-slate-400">המנוי בתוקף עד {formatDate(plan.expiresAt)}</p>
      )}
    </motion.div>
  );
}

function StatusBadge({ status }: { status: PageRow['status'] }) {
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

function PageGrid({ pages, onDelete }: { pages: PageRow[]; onDelete: (id: string, name: string) => void }) {
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
  const [plan, setPlan] = useState<PlanStatus | null>(null);
  const [plansCatalog, setPlansCatalog] = useState<Record<string, PlanDef>>({});
  const [showPlans, setShowPlans] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
            const pd = await planRes.json() as { status: PlanStatus; plans: Record<string, PlanDef> };
            if (!cancelled) { setPlan(pd.status); setPlansCatalog(pd.plans); }
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

  async function handleUpgrade(planKey: 'freelancer' | 'agency') {
    if (!user?.email || upgrading) return;
    setUpgrading(true);
    try {
      const r = await authFetch('/api/payments/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'plan', reference: planKey }),
      });
      const data = await r.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
      if (!r.ok || !data.redirectUrl) throw new Error(data.error ?? 'פתיחת התשלום נכשלה');
      window.location.href = data.redirectUrl;
    } catch (e) {
      setBuyMsg({ text: e instanceof Error ? e.message : 'פתיחת התשלום נכשלה', ok: false });
      setUpgrading(false);
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
                <h3 className="text-lg font-extrabold text-slate-900">בחירת מסלול</h3>
                {!upgrading && <button onClick={() => setShowPlans(false)} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-lg leading-none">×</button>}
              </div>
              <p className="text-sm text-slate-500">מנוי שנתי למי שבונה הרבה דפים — פרסום דפים ללא תשלום נפרד לכל דף, עד למכסת הדפים הפעילים של המסלול.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {(['freelancer', 'agency'] as const).map((key) => {
                  const p = plansCatalog[key];
                  if (!p) return null;
                  const current = plan?.plan === key && plan.active;
                  const highlight = key === 'agency';
                  return (
                    <div key={key} className={`flex flex-col gap-3 p-5 rounded-2xl border-2 ${highlight ? 'border-[#2E63F6] bg-[#EEF1FB]/50' : 'border-slate-200'}`}>
                      <div className="flex items-baseline justify-between">
                        <span className="font-black text-slate-800">{p.label}</span>
                        <span className="text-left"><span className="text-xl font-extrabold text-[#2E63F6]">₪{p.priceYear.toLocaleString()}</span><span className="text-xs text-slate-400"> / שנה</span></span>
                      </div>
                      <ul className="text-sm text-slate-600 flex flex-col gap-1.5">
                        <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> עד {p.maxActivePages} דפים פעילים</li>
                        <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> {p.monthlyCreate} דפים חדשים בחודש</li>
                        <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> {p.monthlyCredits} קרדיטי AI בכל חידוש</li>
                        {p.whiteLabel && <li className="flex items-center gap-2"><CheckCircle size={14} className="text-emerald-500 flex-shrink-0" /> הסרת מיתוג Pagey</li>}
                      </ul>
                      <button
                        disabled={upgrading || current}
                        onClick={() => handleUpgrade(key)}
                        className={`mt-auto rounded-xl py-2.5 text-sm font-bold transition disabled:opacity-50 ${highlight ? 'bg-[#2E63F6] hover:bg-[#1E4FD6] text-white' : 'bg-slate-800 hover:bg-slate-900 text-white'}`}
                      >
                        {current ? 'המסלול הנוכחי שלך' : upgrading ? 'מעבד…' : 'בחירת מסלול'}
                      </button>
                    </div>
                  );
                })}
              </div>
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
                <PlanCard plan={plan} onUpgrade={() => setShowPlans(true)} />
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
              {plan && <PlanCard plan={plan} onUpgrade={() => setShowPlans(true)} />}

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
                      dataLoading ? <PageGridSkeleton /> : <PageGrid pages={pages} onDelete={handleDeletePage} />
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
