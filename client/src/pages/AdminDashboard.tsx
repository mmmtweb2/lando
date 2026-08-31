import { useEffect, useState } from 'react';
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

// ─── Constants ────────────────────────────────────────────────────────────────

const IMAGE_SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  upload:  { label: 'Upload',  color: '#2E63F6' },
  stock:   { label: 'Stock',   color: '#22B8D6' },
  ai:      { label: 'AI',      color: '#1E4FD6' },
  none:    { label: 'None',    color: '#94a3b8' },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Delete page?</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              "<span className="font-medium text-slate-700">{name}</span>" will be permanently removed. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-60 flex items-center gap-2">
            {busy && (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            )}
            Delete
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

  useEffect(() => {
    if (!user) return;
    authFetch('/api/admin/pages')
      .then((r) => {
        if (r.status === 401 || r.status === 403) { setDenied(true); throw new Error('denied'); }
        if (!r.ok) throw new Error('Failed to load pages');
        return r.json() as Promise<PageRow[]>;
      })
      .then(setPages)
      .catch((e: Error) => { if (e.message !== 'denied') setFetchError(e.message); })
      .finally(() => setLoading(false));
  }, [user]);

  const [reviewPayments, setReviewPayments] = useState<PaymentRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [paymentBusyId, setPaymentBusyId] = useState<string | null>(null);
  const [paymentActionMsg, setPaymentActionMsg] = useState<Record<string, string>>({});

  function loadReviewPayments() {
    setPaymentsLoading(true);
    authFetch('/api/admin/payments?status=needs_review')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load payments');
        return r.json() as Promise<PaymentRow[]>;
      })
      .then(setReviewPayments)
      .catch((e: Error) => setPaymentsError(e.message))
      .finally(() => setPaymentsLoading(false));
  }

  useEffect(() => {
    if (!user || denied) return;
    loadReviewPayments();
  }, [user, denied]);

  async function handlePaymentAction(id: string, action: 'reverify' | 'force-activate') {
    setPaymentBusyId(id);
    setPaymentActionMsg((m) => ({ ...m, [id]: '' }));
    try {
      const r = await authFetch(`/api/admin/payments/${id}/${action}`, { method: 'POST' });
      const data = await r.json().catch(() => ({})) as { status?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? 'Action failed');
      setPaymentActionMsg((m) => ({ ...m, [id]: data.status === 'paid' ? '✓ Granted' : `Still: ${data.status}` }));
      if (data.status === 'paid') {
        setReviewPayments((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (e) {
      setPaymentActionMsg((m) => ({ ...m, [id]: e instanceof Error ? e.message : 'Action failed' }));
    } finally {
      setPaymentBusyId(null);
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
      alert('Failed to delete page. Please try again.');
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

      <div className="min-h-screen bg-slate-50 font-sans">

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
              <span className="font-bold text-slate-800 text-sm">Pagey Admin</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/" className="text-xs text-slate-500 hover:text-[#2E63F6] transition">
                ← Back to app
              </Link>
              <button
                onClick={() => logout()}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 transition">
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-8">

          {/* ── Page title ─────────────────────────────────────────────────── */}
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Landing Pages</h1>
            <p className="text-sm text-slate-400 mt-1">Manage all generated pages</p>
          </div>

          {/* ── Stat cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Pages" value={loading ? '—' : pages.length} />
            <StatCard label="Stock Images" value={loading ? '—' : (sourceCount.stock ?? 0)} />
            <StatCard label="Uploaded Images" value={loading ? '—' : (sourceCount.upload ?? 0)} />
            <StatCard label="With Lead Form" value={loading ? '—' : pages.filter(p => p.enable_form).length} />
          </div>

          {/* ── Payments needing review ────────────────────────────────────── */}
          {(paymentsLoading || paymentsError || reviewPayments.length > 0) && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-700 text-sm">Payments Needing Review</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    SUMIT verification didn't confirm these — check the payment in your SUMIT dashboard first,
                    then Re-verify (if it was a transient issue) or Force-activate (once you've confirmed the
                    charge manually).
                  </p>
                </div>
                <button onClick={loadReviewPayments}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-[#2E63F6] hover:border-[#9DB0E8] transition flex-shrink-0">
                  Refresh
                </button>
              </div>

              {paymentsLoading ? (
                <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
              ) : paymentsError ? (
                <div className="py-10 text-center text-sm text-red-400">{paymentsError}</div>
              ) : reviewPayments.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">Nothing stuck — all clear.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/60">
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">Purpose</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3 hidden md:table-cell">SUMIT ID</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {reviewPayments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3.5 text-slate-500 text-xs">{formatDate(p.created_at)} {formatTime(p.created_at)}</td>
                          <td className="px-4 py-3.5 font-mono text-xs text-slate-700">{p.user_email}</td>
                          <td className="px-4 py-3.5 text-slate-600">{p.purpose}{p.reference ? ` (${p.reference})` : ''}</td>
                          <td className="px-4 py-3.5 text-slate-700 font-semibold">₪{p.amount}</td>
                          <td className="px-4 py-3.5 hidden md:table-cell text-slate-400 text-xs font-mono">{p.sumit_payment_id ?? '—'}</td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {paymentActionMsg[p.id] && (
                                <span className="text-xs text-slate-500">{paymentActionMsg[p.id]}</span>
                              )}
                              <button
                                disabled={paymentBusyId === p.id || !p.sumit_payment_id}
                                onClick={() => handlePaymentAction(p.id, 'reverify')}
                                title={!p.sumit_payment_id ? 'No SUMIT payment ID on record — nothing to re-verify against' : undefined}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#2E63F6] border border-[#9DB0E8] bg-[#EEF1FB] hover:bg-[#E4EAFB] transition disabled:opacity-40">
                                Re-verify
                              </button>
                              <button
                                disabled={paymentBusyId === p.id}
                                onClick={() => {
                                  if (window.confirm(`Force-grant ${p.purpose} to ${p.user_email} WITHOUT re-verifying with SUMIT? Only do this after confirming the charge yourself.`)) {
                                    void handlePaymentAction(p.id, 'force-activate');
                                  }
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-40">
                                Force-activate
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
          )}

          {/* ── Search + table ──────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

            {/* Table header / search bar */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <h2 className="font-semibold text-slate-700 text-sm">All Pages</h2>
              <div className="relative max-w-xs w-full">
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search by business name..."
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
                <span className="text-sm">Loading pages...</span>
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
                <p className="text-sm">{search ? 'No results found' : 'No pages yet'}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/60">
                      <th className="px-5 py-3 w-12" />
                      <th className="px-4 py-3">Business Name</th>
                      <th className="px-4 py-3 hidden sm:table-cell">Date Created</th>
                      <th className="px-4 py-3 hidden md:table-cell">Image Source</th>
                      <th className="px-4 py-3 hidden lg:table-cell">Lead Form</th>
                      <th className="px-4 py-3 text-right">Actions</th>
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
                          <p className="text-xs text-slate-400 mt-0.5 font-mono">{p.slug}</p>
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
                            {p.enable_form ? 'Enabled' : 'Off'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
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
                              View
                            </a>
                            <button
                              onClick={() => setConfirmDelete(p)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-500 border border-red-100 bg-red-50 hover:bg-red-100 transition active:scale-95"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                              </svg>
                              Delete
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
                Showing {filtered.length} of {pages.length} pages
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
