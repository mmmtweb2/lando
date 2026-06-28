import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Plus, ExternalLink, Loader2,
  LayoutDashboard, FileText, Users, LogOut,
  CheckCircle, Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { supabase } from '../lib/supabase';
import LeadsTable, { type LeadRow } from '../components/LeadsTable';
import WalletBadge from '../components/WalletBadge';
import ReferralCard from '../components/ReferralCard';

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

type ActiveTab = 'pages' | 'leads';

// ─── Motion variants ──────────────────────────────────────────────────────────

const cardItem = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };
const cardContainer = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavItem({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <button className={`flex items-center gap-2.5 w-full rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
    }`}>
      <span className={active ? 'text-indigo-500' : ''}>{icon}</span>
      {label}
    </button>
  );
}

function StatCard({ label, value, icon, color = 'text-slate-700' }: {
  label: string; value: string; icon: ReactNode; color?: string;
}) {
  return (
    <motion.div variants={cardItem} className="rounded-2xl bg-white border border-slate-100 shadow-sm p-5 flex flex-col gap-2">
      <div className={color}>{icon}</div>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: PageRow['status'] }) {
  if (status === 'published') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-2.5 py-1 flex-shrink-0">
        <CheckCircle size={10} />פורסם
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 flex-shrink-0">
      <Clock size={10} />טיוטה
    </span>
  );
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

interface TabBarProps {
  active: ActiveTab;
  onChange: (tab: ActiveTab) => void;
  pageCount: number;
  leadCount: number;
}

function TabBar({ active, onChange, pageCount, leadCount }: TabBarProps) {
  const tabs: { id: ActiveTab; label: string; count: number }[] = [
    { id: 'pages', label: 'הדפים שלי', count: pageCount },
    { id: 'leads', label: 'תיבת לידים', count: leadCount },
  ];
  return (
    <div className="flex gap-0 border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === tab.id
              ? 'border-indigo-500 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          {tab.label}
          <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            active === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Page cards ───────────────────────────────────────────────────────────────

function PageGrid({ pages }: { pages: PageRow[] }) {
  if (pages.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 flex flex-col items-center gap-3 text-center">
        <Globe size={28} className="text-slate-300" />
        <p className="text-sm text-slate-500">עדיין לא יצרת דפי נחיתה</p>
        <Link to="/" className="text-sm font-medium text-indigo-600 hover:underline">
          צור את הדף הראשון שלך ✦
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
          className="rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition p-5 flex flex-col gap-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {p.logo_url ? (
                <img
                  src={p.logo_url} alt={p.business_name}
                  className="w-10 h-10 rounded-xl object-contain bg-slate-50 flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">
                  {p.business_name.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 text-sm truncate">{p.business_name}</p>
                <p className="text-xs text-slate-400 font-mono">/p/{p.slug}</p>
              </div>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <p className="text-xs text-slate-400">{formatDate(p.created_at)}</p>
          <div className="mt-auto pt-1 border-t border-slate-50">
            <Link
              to={`/p/${p.slug}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition"
            >
              <ExternalLink size={12} />
              צפייה בדף
            </Link>
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
        <div key={i} className="rounded-2xl bg-white border border-slate-100 p-5 flex flex-col gap-3 animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-slate-100" />
          <div className="h-3.5 rounded-full bg-slate-100 w-3/4" />
          <div className="h-2.5 rounded-full bg-slate-100 w-1/2" />
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

  const [pages, setPages]         = useState<PageRow[]>([]);
  const [leads, setLeads]         = useState<LeadRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('pages');

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
        // 1 — Fetch landing pages owned by this user
        const { data: pagesData, error: pagesErr } = await supabase
          .from('landing_pages')
          .select('id, slug, business_name, created_at, logo_url, status, published_at, expires_at')
          .eq('owner_email', user!.email)
          .order('created_at', { ascending: false });

        if (pagesErr) throw pagesErr;
        const pageRows = (pagesData ?? []) as PageRow[];
        if (!cancelled) setPages(pageRows);

        // 2 — Fetch full lead rows for those pages (with page name via FK join)
        if (pageRows.length > 0) {
          const pageIds = pageRows.map((p) => p.id);
          const { data: leadsData, error: leadsErr } = await supabase
            .from('leads')
            .select('id, name, phone, email, message, created_at, page_id, landing_pages(business_name, slug)')
            .in('page_id', pageIds)
            .order('created_at', { ascending: false });

          if (leadsErr) throw leadsErr;
          if (!cancelled) setLeads((leadsData ?? []) as LeadRow[]);
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
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user) return null;

  const publishedPages = pages.filter((p) => p.status === 'published');

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex" dir="rtl">

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-l border-slate-200 sticky top-0 h-screen flex-shrink-0">
        <div className="px-5 py-5 border-b border-slate-100">
          <Link to="/" className="text-base font-bold text-slate-800 hover:text-indigo-600 transition">
            Tirnoer Digital ✦
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          <NavItem icon={<LayoutDashboard size={17} />} label="סקירה כללית" active />
          <NavItem icon={<Globe size={17} />} label="הדפים שלי" />
          <NavItem icon={<Users size={17} />} label="לידים" />
          <NavItem icon={<FileText size={17} />} label="הגדרות" />
        </nav>

        <div className="px-3 py-4 border-t border-slate-100">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition"
          >
            <LogOut size={16} />יציאה
          </button>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200/60 shadow-sm px-5 h-14 flex items-center justify-between flex-shrink-0">
          <h1 className="text-sm font-semibold text-slate-700">דשבורד</h1>
          <div className="flex items-center gap-3">
            <WalletBadge email={user.email} />
            <span className="hidden sm:block text-xs text-slate-400 font-mono truncate max-w-48">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="lg:hidden flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition"
              aria-label="יציאה"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-5 py-8 flex flex-col gap-8 max-w-5xl w-full mx-auto">

          {/* Welcome */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-xl font-bold text-slate-800">
              שלום 👋{' '}
              <span className="text-indigo-600 font-mono text-base">{user.email}</span>
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">ברוך הבא לדשבורד שלך</p>
          </motion.div>

          {/* Stats */}
          <motion.div
            variants={cardContainer} initial="hidden" animate="visible"
            className="grid grid-cols-2 sm:grid-cols-3 gap-4"
          >
            <StatCard
              label="סה״כ דפים"
              value={dataLoading ? '—' : String(pages.length)}
              icon={<Globe size={20} />}
            />
            <StatCard
              label="דפים פעילים"
              value={dataLoading ? '—' : String(publishedPages.length)}
              icon={<CheckCircle size={20} />}
              color="text-emerald-600"
            />
            <StatCard
              label="לידים שהתקבלו"
              value={dataLoading ? '—' : String(leads.length)}
              icon={<Users size={20} />}
              color="text-indigo-600"
            />
          </motion.div>

          {/* Referral */}
          {portalUser && <ReferralCard user={portalUser} />}

          {/* Tab bar + tab content */}
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <TabBar
                active={activeTab}
                onChange={setActiveTab}
                pageCount={pages.length}
                leadCount={leads.length}
              />
              {activeTab === 'pages' && (
                <Link
                  to="/"
                  className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 transition shadow-sm"
                >
                  <Plus size={15} />דף חדש
                </Link>
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
                  dataLoading ? <PageGridSkeleton /> : <PageGrid pages={pages} />
                ) : (
                  dataLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 size={24} className="animate-spin text-indigo-400" />
                    </div>
                  ) : (
                    <LeadsTable leads={leads} />
                  )
                )}
              </motion.div>
            </AnimatePresence>
          </div>

        </main>
      </div>
    </div>
  );
}
