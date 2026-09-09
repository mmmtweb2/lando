import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageRow {
  id: string;
  slug: string;
  business_name: string;
  created_at: string;
  image_source: string;
  logo_url: string | null;
  enable_form: boolean;
}

interface PaymentRow {
  id: string;
  created_at: string;
  user_email: string;
  purpose: string;
  reference: string | null;
  amount: number;
  status: string;
  sumit_payment_id: string | null;
  paid_at: string | null;
}

interface CouponRow {
  id: string;
  created_at: string;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  applicable_purposes: string[] | null;
  max_redemptions: number | null;
  redemptions_count: number;
  max_per_user: number | null;
  active: boolean;
  expires_at: string | null;
  created_by: string | null;
  notes: string | null;
}

interface UserRow {
  email: string;
  created_at: string;
  plan: string;
  plan_expires_at: string | null;
  credits: number;
  page_credits: number;
  page_credits_total: number;
  white_label: boolean;
  is_admin: boolean | null;
  pages_total: number;
  pages_published: number;
}

interface RevenueStats {
  totalRevenue: number;
  thisMonthRevenue: number;
  last30DaysRevenue: number;
  paidPaymentsCount: number;
  monthlyBreakdown: { month: string; revenue: number; count: number }[];
  byPurpose: { purpose: string; revenue: number; count: number }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Where the admin-panel password lives for the lifetime of this TAB. Session
 *  storage, not localStorage: closing the tab must forget it. */
const ADMIN_PW_KEY = 'pagey_admin_panel_pw';

const PURPOSE_LABELS: Record<string, string> = {
  publish: 'פרסום דף',
  renew:   'חידוש שנתי',
  credits: 'קרדיטים',
  bundle:  'חבילות',
};

const IMAGE_SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  upload:  { label: 'העלאה',  color: '#2E63F6' },
  stock:   { label: 'סטוק',   color: '#22B8D6' },
  ai:      { label: 'AI',     color: '#1E4FD6' },
  none:    { label: 'אין',    color: '#94a3b8' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCurrency(amount: number): string {
  return `₪${amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`;
}

const PLAN_LABELS: Record<string, string> = {
  free:       'חינמי',
  freelancer: 'פרילנסר',
  agency:     'סוכנות',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-1">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const meta = IMAGE_SOURCE_LABELS[source] ?? IMAGE_SOURCE_LABELS.none;
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
      style={{ backgroundColor: meta.color }}>
      {meta.label}
    </span>
  );
}

// ─── Access gate ──────────────────────────────────────────────────────────────
// Access is enforced server-side (requireAuth + requireAdmin on /api/admin/*).
// This shell just renders the appropriate message: needs login, or not an admin.

function GateShell({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-slate-100 p-8 flex flex-col gap-6 text-center">
        <div className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center"
          style={{ background: '#2E63F6' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">{title}</h1>
          <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
        </div>
        {children}
        <Link to="/" className="text-xs text-slate-400 hover:text-[#2E63F6] transition">← חזרה לאפליקציה</Link>
      </div>
    </div>
  );
}

// ─── Delete confirmation modal ────────────────────────────────────────────────

function DeleteModal({ name, onConfirm, onCancel, busy }: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-slate-800">למחוק את הדף?</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              "<span className="font-medium text-slate-700">{name}</span>" תוסר לצמיתות. לא ניתן לבטל פעולה זו.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50">
            ביטול
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-60 flex items-center gap-2">
            {busy && (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            )}
            מחיקה
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<PageRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ── Admin-panel password ──────────────────────────────────────────────────
  // A second, deliberately crude layer on top of the real login: the server
  // requires a matching `x-admin-password` header on every /api/admin/* call
  // (requireAdminPanelPassword), in addition to the Supabase session and the
  // is_admin flag it already enforced. Kept in sessionStorage so it dies with
  // the tab and never touches disk.
  const [adminPw, setAdminPw] = useState<string | null>(() => {
    try { return sessionStorage.getItem(ADMIN_PW_KEY); } catch { return null; }
  });
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  /**
   * authFetch + the admin-panel password header. Every /api/admin/* call on
   * this page goes through it.
   *
   * A rejection that carries `adminPassword: true` is specifically the password
   * gate (not the pre-existing is_admin denial, which has no such flag), so we
   * can drop the stored value and re-prompt with "wrong password" instead of
   * showing the generic access-denied screen for what is a typo.
   */
  const adminFetch = useCallback(async (input: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (adminPw) headers.set('x-admin-password', adminPw);
    const res = await authFetch(input, { ...init, headers });
    if (res.status === 401 || res.status === 503) {
      const body = await res.clone().json().catch(() => ({})) as { adminPassword?: boolean; error?: string };
      if (body.adminPassword) {
        try { sessionStorage.removeItem(ADMIN_PW_KEY); } catch { /* private mode — nothing to clear */ }
        setAdminPw(null);
        setPwError(body.error ?? 'סיסמה שגויה.');
      }
    }
    return res;
  }, [adminPw]);

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    const value = pwInput.trim();
    if (!value) return;
    try { sessionStorage.setItem(ADMIN_PW_KEY, value); } catch { /* private mode — kept in memory only */ }
    setPwError(null);
    setPwInput('');
    setAdminPw(value);
  }

  useEffect(() => {
    if (!user || !adminPw) return;
    setLoading(true);
    adminFetch('/api/admin/pages')
      .then((r) => {
        // A password rejection has already been handled by adminFetch (it
        // cleared the stored password and re-prompts), so only treat this as a
        // real is_admin denial when it is not the password gate talking.
        if (r.status === 401 || r.status === 403) {
          if (r.status === 403) setDenied(true);
          throw new Error('denied');
        }
        if (!r.ok) throw new Error('טעינת הדפים נכשלה');
        return r.json() as Promise<PageRow[]>;
      })
      .then(setPages)
      .catch((e: Error) => { if (e.message !== 'denied') setFetchError(e.message); })
      .finally(() => setLoading(false));
  }, [user, adminPw, adminFetch]);

  const [reviewPayments, setReviewPayments] = useState<PaymentRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null);
  const [paymentActionMsg, setPaymentActionMsg] = useState<Record<string, string>>({});

  function loadReviewPayments() {
    setPaymentsLoading(true);
    adminFetch('/api/admin/payments?status=needs_review')
      .then((r) => {
        if (!r.ok) throw new Error('טעינת התשלומים נכשלה');
        return r.json() as Promise<PaymentRow[]>;
      })
      .then(setReviewPayments)
      .catch((e: Error) => setPaymentsError(e.message))
      .finally(() => setPaymentsLoading(false));
  }

  useEffect(() => {
    if (!user || denied || !adminPw) return;
    loadReviewPayments();
    loadCoupons();
    loadUsers();
    loadRevenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, denied, adminPw]);

  // ── Customers (registered users) ─────────────────────────────────────────
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');

  function loadUsers() {
    setUsersLoading(true);
    adminFetch('/api/admin/users')
      .then((r) => {
        if (!r.ok) throw new Error('טעינת הלקוחות נכשלה');
        return r.json() as Promise<UserRow[]>;
      })
      .then(setUsers)
      .catch((e: Error) => setUsersError(e.message))
      .finally(() => setUsersLoading(false));
  }

  const filteredUsers = users.filter((u) =>
    u.email.toLowerCase().includes(userSearch.trim().toLowerCase()),
  );

  // ── Revenue overview ──────────────────────────────────────────────────────
  const [revenue, setRevenue] = useState<RevenueStats | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  function loadRevenue() {
    setRevenueLoading(true);
    adminFetch('/api/admin/revenue')
      .then((r) => {
        if (!r.ok) throw new Error('טעינת נתוני ההכנסות נכשלה');
        return r.json() as Promise<RevenueStats>;
      })
      .then(setRevenue)
      .catch((e: Error) => setRevenueError(e.message))
      .finally(() => setRevenueLoading(false));
  }

  async function handlePaymentAction(id: string, action: 'reverify' | 'force-activate') {
    setPaymentBusyId(id);
    setPaymentActionMsg((m) => ({ ...m, [id]: '' }));
    try {
      const r = await adminFetch(`/api/admin/payments/${id}/${action}`, { method: 'POST' });
      const data = await r.json().catch(() => ({})) as { status?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? 'הפעולה נכשלה');
      setPaymentActionMsg((m) => ({ ...m, [id]: data.status === 'paid' ? '✓ אושר' : `עדיין: ${data.status}` }));
      if (data.status === 'paid') {
        setReviewPayments((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (e) {
      setPaymentActionMsg((m) => ({ ...m, [id]: e instanceof Error ? e.message : 'הפעולה נכשלה' }));
    } finally {
      setPaymentBusyId(null);
    }
  }

  // ── Coupons ───────────────────────────────────────────────────────────────
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(true);
  const [couponsError, setCouponsError] = useState<string | null>(null);
  const [couponBusyId, setCouponBusyId] = useState<string | null>(null);
  const [couponCreateBusy, setCouponCreateBusy] = useState(false);
  const [couponMsg, setCouponMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({
    code: '',
    discountType: 'percent' as 'percent' | 'fixed',
    discountValue: '',
    expiresAt: '',
    maxRedemptions: '',
    maxPerUser: '1',
    purposes: [] as string[],
    notes: '',
  });

  function loadCoupons() {
    setCouponsLoading(true);
    setCouponsError(null);
    adminFetch('/api/admin/coupons')
      .then((r) => {
        if (!r.ok) throw new Error('טעינת הקופונים נכשלה');
        return r.json() as Promise<CouponRow[]>;
      })
      .then(setCoupons)
      .catch((e: Error) => setCouponsError(e.message))
      .finally(() => setCouponsLoading(false));
  }

  async function handleCreateCoupon(e: React.FormEvent) {
    e.preventDefault();
    if (couponCreateBusy) return;
    setCouponCreateBusy(true);
    setCouponMsg(null);
    try {
      const r = await adminFetch('/api/admin/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code,
          discount_type: form.discountType,
          discount_value: Number(form.discountValue),
          // An empty list means "any purpose" — the server normalizes [] to null.
          applicable_purposes: form.purposes,
          // Empty string = no limit. The server reads null/'' as unlimited and
          // only defaults max_per_user to 1 when the key is absent entirely,
          // so both fields are always sent explicitly from here.
          max_redemptions: form.maxRedemptions === '' ? null : Number(form.maxRedemptions),
          max_per_user: form.maxPerUser === '' ? null : Number(form.maxPerUser),
          expires_at: form.expiresAt || null,
          notes: form.notes || null,
        }),
      });
      const data = await r.json().catch(() => ({})) as CouponRow & { error?: string };
      if (!r.ok) throw new Error(data.error ?? 'יצירת הקופון נכשלה');
      setCoupons((prev) => [data, ...prev]);
      setCouponMsg({ text: `הקופון ${data.code} נוצר.`, ok: true });
      setForm({ code: '', discountType: 'percent', discountValue: '', expiresAt: '', maxRedemptions: '', maxPerUser: '1', purposes: [], notes: '' });
    } catch (err) {
      setCouponMsg({ text: err instanceof Error ? err.message : 'יצירת הקופון נכשלה', ok: false });
    } finally {
      setCouponCreateBusy(false);
    }
  }

  /** The admin-facing "delete": a coupon that has priced real payments is never
   *  removed, it is switched off. Same call re-enables it. */
  async function toggleCouponActive(c: CouponRow) {
    setCouponBusyId(c.id);
    try {
      const r = await adminFetch(`/api/admin/coupons/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !c.active }),
      });
      const data = await r.json().catch(() => ({})) as CouponRow & { error?: string };
      if (!r.ok) throw new Error(data.error ?? 'העדכון נכשל');
      setCoupons((prev) => prev.map((x) => (x.id === c.id ? data : x)));
    } catch (err) {
      setCouponMsg({ text: err instanceof Error ? err.message : 'העדכון נכשל', ok: false });
    } finally {
      setCouponBusyId(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    try {
      const res = await authFetch(`/api/landing/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setPages((prev) => prev.filter((p) => p.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      alert('מחיקת הדף נכשלה. נסו שוב.');
    } finally {
      setDeleteBusy(false);
    }
  }

  if (authLoading) {
    return <GateShell title="טוען..." subtitle="בודק הרשאות" />;
  }
  if (!user) {
    return (
      <GateShell title="נדרשת התחברות" subtitle="התחברו כדי לגשת לפאנל הניהול">
        <Link to="/login"
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: '#2E63F6' }}>
          התחברות
        </Link>
      </GateShell>
    );
  }
  // Password gate — an ADDITIONAL layer, not a replacement: the server still
  // requires a real admin session on every call behind it. Rendered before the
  // dashboard so no admin data is even requested without a password.
  if (!adminPw) {
    return (
      <GateShell title="פאנל ניהול" subtitle="הזינו את סיסמת פאנל הניהול כדי להמשיך">
        <form onSubmit={submitPassword} className="flex flex-col gap-3">
          <input
            type="password"
            autoFocus
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            placeholder="סיסמת פאנל הניהול"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition text-center"
          />
          {pwError && <p className="text-xs text-red-500 font-medium">{pwError}</p>}
          <button
            type="submit"
            disabled={!pwInput.trim()}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            style={{ background: '#2E63F6' }}>
            כניסה
          </button>
        </form>
      </GateShell>
    );
  }
  if (denied) {
    return <GateShell title="אין הרשאת גישה" subtitle="החשבון שלך אינו מוגדר כמנהל מערכת" />;
  }

  const filtered = pages.filter((p) =>
    p.business_name.toLowerCase().includes(search.toLowerCase()),
  );

  const sourceCount = pages.reduce<Record<string, number>>((acc, p) => {
    acc[p.image_source] = (acc[p.image_source] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      {confirmDelete && (
        <DeleteModal
          name={confirmDelete.business_name}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          busy={deleteBusy}
        />
      )}

      <div className="min-h-screen bg-slate-50 font-sans" dir="rtl">

        {/* ── Top nav ──────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: '#2E63F6' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
              </div>
              <span className="font-bold text-slate-800 text-sm">ניהול Pagey</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/" className="text-xs text-slate-500 hover:text-[#2E63F6] transition">
                ← חזרה לאפליקציה
              </Link>
              <button
                onClick={() => logout()}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 transition">
                התנתקות
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-8">

          {/* ── Page title ─────────────────────────────────────────────────── */}
          <div>
            <h1 className="text-2xl font-bold text-slate-800">דפי נחיתה</h1>
            <p className="text-sm text-slate-400 mt-1">ניהול כל הדפים שנוצרו</p>
          </div>

          {/* ── Revenue overview ──────────────────────────────────────────── */}
          <div>
            <h2 className="font-semibold text-slate-700 text-sm mb-3">הכנסות</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard
                label="סה״כ הכנסות"
                value={revenueLoading ? '—' : formatCurrency(revenue?.totalRevenue ?? 0)}
                sub={revenue ? `${revenue.paidPaymentsCount} תשלומים` : undefined}
              />
              <StatCard label="החודש" value={revenueLoading ? '—' : formatCurrency(revenue?.thisMonthRevenue ?? 0)} />
              <StatCard label="30 יום אחרונים" value={revenueLoading ? '—' : formatCurrency(revenue?.last30DaysRevenue ?? 0)} />
              <StatCard
                label="הכי נמכר"
                value={revenueLoading || !revenue?.byPurpose[0] ? '—' : (PURPOSE_LABELS[revenue.byPurpose[0].purpose] ?? revenue.byPurpose[0].purpose)}
                sub={revenue?.byPurpose[0] ? formatCurrency(revenue.byPurpose[0].revenue) : undefined}
              />
            </div>
            {revenueError && <p className="text-xs text-red-500 mt-2">{revenueError}</p>}

            {!revenueLoading && revenue && revenue.monthlyBreakdown.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden mt-4">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-700 text-sm">הכנסות לפי חודש</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-right text-xs text-slate-400 border-b border-slate-100">
                        <th className="px-4 py-2.5 font-medium">חודש</th>
                        <th className="px-4 py-2.5 font-medium">הכנסות</th>
                        <th className="px-4 py-2.5 font-medium">מס&apos; תשלומים</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revenue.monthlyBreakdown.map((m) => (
                        <tr key={m.month} className="border-b border-slate-50 last:border-0">
                          <td className="px-4 py-3 text-slate-700" dir="ltr">{m.month}</td>
                          <td className="px-4 py-3 text-slate-700 font-semibold">{formatCurrency(m.revenue)}</td>
                          <td className="px-4 py-3 text-slate-500">{m.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Customers (registered users) ─────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-slate-700 text-sm">לקוחות</h2>
                <p className="text-xs text-slate-400 mt-0.5">{usersLoading ? '—' : `${users.length} משתמשים רשומים`}</p>
              </div>
              <div className="relative max-w-xs w-full">
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="חיפוש לפי אימייל..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pr-9 pl-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition"
                />
              </div>
            </div>

            {usersLoading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                טוען לקוחות...
              </div>
            ) : usersError ? (
              <p className="text-sm text-red-500 px-5 py-8 text-center">{usersError}</p>
            ) : filteredUsers.length === 0 ? (
              <p className="text-sm text-slate-400 px-5 py-8 text-center">אין לקוחות תואמים.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-xs text-slate-400 border-b border-slate-100">
                      <th className="px-4 py-2.5 font-medium">אימייל</th>
                      <th className="px-4 py-2.5 font-medium">נרשם</th>
                      <th className="px-4 py-2.5 font-medium">תוכנית</th>
                      <th className="px-4 py-2.5 font-medium">קרדיטים</th>
                      <th className="px-4 py-2.5 font-medium">קרדיטי דפים</th>
                      <th className="px-4 py-2.5 font-medium">דפים (פורסמו/סה״כ)</th>
                      <th className="px-4 py-2.5 font-medium">מיתוג אישי</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.email} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition">
                        <td className="px-4 py-3 text-slate-700" dir="ltr">
                          {u.email}
                          {u.is_admin && <span className="mr-2 text-[10px] font-bold text-[#2E63F6] bg-[#E4EAFB] rounded-full px-2 py-0.5">מנהל</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(u.created_at)}</td>
                        <td className="px-4 py-3 text-slate-700">{PLAN_LABELS[u.plan] ?? u.plan}</td>
                        <td className="px-4 py-3 text-slate-700">{u.credits}</td>
                        <td className="px-4 py-3 text-slate-700">{u.page_credits}</td>
                        <td className="px-4 py-3 text-slate-700">{u.pages_published} / {u.pages_total}</td>
                        <td className="px-4 py-3">
                          {u.white_label
                            ? <span className="text-[11px] font-semibold text-emerald-600">✓ פעיל</span>
                            : <span className="text-[11px] text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Stat cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="סה״כ דפים" value={loading ? '—' : pages.length} />
            <StatCard label="תמונות סטוק" value={loading ? '—' : (sourceCount.stock ?? 0)} />
            <StatCard label="תמונות שהועלו" value={loading ? '—' : (sourceCount.upload ?? 0)} />
            <StatCard label="עם טופס לידים" value={loading ? '—' : pages.filter(p => p.enable_form).length} />
          </div>

          {/* ── Payments needing review ────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-700 text-sm">תשלומים הדורשים בדיקה</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    האימות מול SUMIT לא אישר את התשלומים האלה — בדקו את התשלום בפאנל SUMIT קודם,
                    ואז לחצו על אימות מחדש (אם מדובר בתקלה זמנית) או הפעלה כפויה (לאחר שוידאתם
                    את החיוב ידנית).
                  </p>
                </div>
                <button onClick={loadReviewPayments}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-[#2E63F6] hover:border-[#9DB0E8] transition flex-shrink-0">
                  רענון
                </button>
              </div>

              {paymentsLoading ? (
                <div className="py-10 text-center text-sm text-slate-400">טוען…</div>
              ) : paymentsError ? (
                <div className="py-10 text-center text-sm text-red-400">{paymentsError}</div>
              ) : reviewPayments.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">אין תשלומים תקועים — הכול תקין.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right" dir="rtl">
                    <thead>
                      <tr className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/60">
                        <th className="px-4 py-3">תאריך</th>
                        <th className="px-4 py-3">משתמש</th>
                        <th className="px-4 py-3">מטרה</th>
                        <th className="px-4 py-3">סכום</th>
                        <th className="px-4 py-3 hidden md:table-cell">מזהה SUMIT</th>
                        <th className="px-4 py-3 text-left">פעולות</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {reviewPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3.5 text-slate-500 text-xs">{formatDate(p.created_at)} {formatTime(p.created_at)}</td>
                          <td className="px-4 py-3.5 font-mono text-xs text-slate-700" dir="ltr">{p.user_email}</td>
                          <td className="px-4 py-3.5 text-slate-600">{p.purpose}{p.reference ? ` (${p.reference})` : ''}</td>
                          <td className="px-4 py-3.5 text-slate-700 font-semibold">₪{p.amount}</td>
                          <td className="px-4 py-3.5 hidden md:table-cell text-slate-400 text-xs font-mono" dir="ltr">{p.sumit_payment_id ?? '—'}</td>
                          <td className="px-4 py-3.5 text-left">
                            <div className="flex items-center justify-start gap-2">
                              {paymentActionMsg[p.id] && (
                                <span className="text-xs text-slate-500">{paymentActionMsg[p.id]}</span>
                              )}
                              <button
                                disabled={paymentBusyId === p.id || !p.sumit_payment_id}
                                onClick={() => handlePaymentAction(p.id, 'reverify')}
                                title={!p.sumit_payment_id ? 'אין מזהה תשלום SUMIT רשום — אין מול מה לאמת מחדש' : undefined}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#2E63F6] border border-[#9DB0E8] bg-[#EEF1FB] hover:bg-[#E4EAFB] transition disabled:opacity-40">
                                אימות מחדש
                              </button>
                              <button
                                disabled={paymentBusyId === p.id}
                                onClick={() => {
                                  if (window.confirm(`להעניק ל${p.user_email} את "${p.purpose}" באופן כפוי בלי אימות מול SUMIT? יש לעשות זאת רק לאחר שווידאתם את החיוב בעצמכם.`)) {
                                    void handlePaymentAction(p.id, 'force-activate');
                                  }
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-40">
                                הפעלה כפויה
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          {/* ── Coupons ────────────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-semibold text-slate-700 text-sm">קופונים</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  קוד הנחה מוריד את המחיר של תשלום אחד. השימוש נספר ברגע שנפתח דף התשלום —
                  כך שגם אם הלקוח לא סיים לשלם, השימוש נוצל. כיבוי קופון ("פעיל") הוא המחיקה —
                  קופון שכבר שימש בתשלום אמיתי לא נמחק לעולם.
                </p>
              </div>
              <button onClick={loadCoupons}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-[#2E63F6] hover:border-[#9DB0E8] transition flex-shrink-0">
                רענון
              </button>
            </div>

            {/* Create form */}
            <form onSubmit={handleCreateCoupon} className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500">קוד</span>
                  <input required value={form.code} dir="ltr"
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="LAUNCH10"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500">סוג הנחה</span>
                  <select value={form.discountType}
                    onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as 'percent' | 'fixed' }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition">
                    <option value="percent">אחוזים (%)</option>
                    <option value="fixed">סכום קבוע (₪)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500">{form.discountType === 'percent' ? 'אחוז הנחה (1–100)' : 'הנחה בשקלים'}</span>
                  <input required type="number" min="1" step="1" value={form.discountValue}
                    onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500">תוקף עד (אופציונלי)</span>
                  <input type="date" value={form.expiresAt}
                    onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500">מקס׳ שימושים (ריק = ללא הגבלה)</span>
                  <input type="number" min="1" step="1" value={form.maxRedemptions}
                    onChange={(e) => setForm((f) => ({ ...f, maxRedemptions: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500">מקס׳ ללקוח (ריק = ללא הגבלה)</span>
                  <input type="number" min="1" step="1" value={form.maxPerUser}
                    onChange={(e) => setForm((f) => ({ ...f, maxPerUser: e.target.value }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition" />
                </label>
                <label className="flex flex-col gap-1 col-span-2">
                  <span className="text-xs font-medium text-slate-500">הערה פנימית (לא מוצגת ללקוח)</span>
                  <input value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="קמפיין אינסטגרם"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition" />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-medium text-slate-500">תקף עבור (לא נבחר = הכול):</span>
                {Object.entries(PURPOSE_LABELS).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={form.purposes.includes(key)}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        purposes: e.target.checked ? [...f.purposes, key] : f.purposes.filter((x) => x !== key),
                      }))} />
                    {label}
                  </label>
                ))}
                <button type="submit" disabled={couponCreateBusy}
                  className="mr-auto px-4 py-2 rounded-xl text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#2E63F6' }}>
                  {couponCreateBusy ? 'יוצר…' : 'יצירת קופון'}
                </button>
              </div>

              {couponMsg && (
                <p className={`text-xs font-semibold rounded-lg px-3 py-2 ${couponMsg.ok ? 'text-emerald-700 bg-emerald-50' : 'text-red-600 bg-red-50'}`}>
                  {couponMsg.text}
                </p>
              )}
            </form>

            {/* List */}
            {couponsLoading ? (
              <div className="py-10 text-center text-sm text-slate-400">טוען…</div>
            ) : couponsError ? (
              <div className="py-10 text-center text-sm text-red-400">{couponsError}</div>
            ) : coupons.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">אין קופונים עדיין.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right" dir="rtl">
                  <thead>
                    <tr className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/60">
                      <th className="px-4 py-3">קוד</th>
                      <th className="px-4 py-3">הנחה</th>
                      <th className="px-4 py-3">שימושים</th>
                      <th className="px-4 py-3 hidden md:table-cell">לכל לקוח</th>
                      <th className="px-4 py-3 hidden lg:table-cell">תקף עבור</th>
                      <th className="px-4 py-3 hidden sm:table-cell">תוקף</th>
                      <th className="px-4 py-3 hidden lg:table-cell">הערה</th>
                      <th className="px-4 py-3 text-left">סטטוס</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {coupons.map((c) => {
                      const exhausted = c.max_redemptions !== null && c.redemptions_count >= c.max_redemptions;
                      const expired = !!c.expires_at && new Date(c.expires_at).getTime() <= Date.now();
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3.5 font-mono font-semibold text-slate-700" dir="ltr">{c.code}</td>
                          <td className="px-4 py-3.5 text-slate-700 font-semibold">
                            {c.discount_type === 'percent' ? `${c.discount_value}%` : `₪${c.discount_value}`}
                          </td>
                          <td className="px-4 py-3.5 text-slate-600">
                            {c.redemptions_count} / {c.max_redemptions ?? '∞'}
                            {exhausted && <span className="text-xs text-amber-600 font-semibold mr-1.5">מוצה</span>}
                          </td>
                          <td className="px-4 py-3.5 hidden md:table-cell text-slate-500">{c.max_per_user ?? '∞'}</td>
                          <td className="px-4 py-3.5 hidden lg:table-cell text-slate-500 text-xs">
                            {c.applicable_purposes && c.applicable_purposes.length > 0
                              ? c.applicable_purposes.map((x) => PURPOSE_LABELS[x] ?? x).join(', ')
                              : 'הכול'}
                          </td>
                          <td className="px-4 py-3.5 hidden sm:table-cell text-slate-500 text-xs">
                            {c.expires_at ? formatDate(c.expires_at) : '—'}
                            {expired && <span className="text-xs text-amber-600 font-semibold mr-1.5">פג</span>}
                          </td>
                          <td className="px-4 py-3.5 hidden lg:table-cell text-slate-400 text-xs">{c.notes ?? '—'}</td>
                          <td className="px-4 py-3.5 text-left">
                            <button
                              disabled={couponBusyId === c.id}
                              onClick={() => toggleCouponActive(c)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition disabled:opacity-40 ${
                                c.active
                                  ? 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                                  : 'text-slate-500 border-slate-200 bg-slate-50 hover:bg-slate-100'
                              }`}>
                              {c.active ? 'פעיל — כיבוי' : 'כבוי — הפעלה'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Search + table ──────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

            {/* Table header / search bar */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <h2 className="font-semibold text-slate-700 text-sm">כל הדפים</h2>
              <div className="relative max-w-xs w-full">
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="חיפוש לפי שם עסק..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 pr-9 pl-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-[#E4EAFB] focus:border-[#9DB0E8] transition"
                />
              </div>
            </div>

            {/* Table body */}
            {loading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <span className="text-sm">טוען דפים...</span>
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-red-400">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-sm font-medium">{fetchError}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-slate-400">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
                </svg>
                <p className="text-sm">{search ? 'לא נמצאו תוצאות' : 'אין דפים עדיין'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right" dir="rtl">
                  <thead>
                    <tr className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/60">
                      <th className="px-5 py-3 w-12" />
                      <th className="px-4 py-3">שם העסק</th>
                      <th className="px-4 py-3 hidden sm:table-cell">תאריך יצירה</th>
                      <th className="px-4 py-3 hidden md:table-cell">מקור תמונה</th>
                      <th className="px-4 py-3 hidden lg:table-cell">טופס לידים</th>
                      <th className="px-4 py-3 text-left">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/70 transition-colors group">
                        {/* Logo */}
                        <td className="px-5 py-3.5">
                          {p.logo_url ? (
                            <img src={p.logo_url} alt=""
                              className="w-8 h-8 rounded-lg object-contain border border-slate-100 bg-white" />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#E4EAFB] to-[#E4EAFB] flex items-center justify-center text-xs font-bold text-[#8CA0D6]">
                              {p.business_name.charAt(0)}
                            </div>
                          )}
                        </td>

                        {/* Business name */}
                        <td className="px-4 py-3.5">
                          <span className="font-semibold text-slate-700">{p.business_name}</span>
                          <p className="text-xs text-slate-400 mt-0.5 font-mono" dir="ltr">{p.slug}</p>
                        </td>

                        {/* Date */}
                        <td className="px-4 py-3.5 hidden sm:table-cell text-slate-500">
                          <span className="block">{formatDate(p.created_at)}</span>
                          <span className="text-xs text-slate-400">{formatTime(p.created_at)}</span>
                        </td>

                        {/* Image source */}
                        <td className="px-4 py-3.5 hidden md:table-cell">
                          <SourceBadge source={p.image_source} />
                        </td>

                        {/* Lead form */}
                        <td className="px-4 py-3.5 hidden lg:table-cell">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${p.enable_form ? 'text-emerald-600' : 'text-slate-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${p.enable_form ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            {p.enable_form ? 'פעיל' : 'כבוי'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-left">
                          <div className="flex items-center justify-start gap-2">
                            <a
                              href={`/p/${p.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition hover:opacity-90 active:scale-95"
                              style={{ background: '#2E63F6' }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                              צפייה
                            </a>
                            <button
                              onClick={() => setConfirmDelete(p)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 border border-red-100 bg-red-50 hover:bg-red-100 transition active:scale-95"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                              </svg>
                              מחיקה
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer row */}
            {!loading && !fetchError && filtered.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
                מציג {filtered.length} מתוך {pages.length} דפים
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
