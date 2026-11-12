import JourneyBanner from '../components/JourneyBanner';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Globe, Plus, ExternalLink, Loader2, Users,
  CheckCircle, Check, Clock, Trash2, X, Sparkles, Share2,
  Mail, MessageCircle, QrCode,
} from 'lucide-react';
import QrModal from '../components/QrModal';
import { PRICING, perPage, renewalPriceFor } from '../config/pricing';
import GoogleDraftCard from '../components/GoogleDraftCard';
import { shareUrl, publicPageLabel } from '../lib/pageUrl';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { authFetch } from '../lib/api';
import { LandoBot } from '../components/Lando';
import RefundAck from '../components/RefundAck';
import LeadsTable, { type LeadFeedItem, type LeadsSummary } from '../components/LeadsTable';
import WalletBadge from '../components/WalletBadge';
import ReferralCard from '../components/ReferralCard';
import SetPasswordCard from '../components/SetPasswordCard';
import SeoProductPanel from '../components/SeoProductPanel';
import SeoSubscriptionCard from '../components/SeoSubscriptionCard';
import SeoReturnBanner from '../components/SeoReturnBanner';
import SeoDashboardV2 from '../dashboard/v3/SeoDashboardEntry';   // v2, or v3 with ?dash=v3
import { dashV2Enabled } from '../dashboard/flag';
import { dashV3Enabled } from '../dashboard/v3/flag';
import DashboardShell from '../dashboard/shell/DashboardShell';
import { AREA_LABEL, PAGES_LABEL, PROMO_LABEL, accountKind, isPromoArea, navFor, navParent, resolveArea, type PromoMode } from '../dashboard/shell/areas';
import { dropQuery, useArea } from '../dashboard/shell/useArea';
import type { IncludedPage, PromoBridge } from '../dashboard/shell/bridge';
import CouponField, { type CouponQuote } from '../components/CouponField';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageRow {
  id: string;
  slug: string;
  subdomain?: string | null;
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
  // Minimal v1 page analytics (migrations/019_page_analytics.sql) — plain
  // counters, no dashboard/charts yet, just "does this page get traffic".
  view_count: number | null;
  cta_click_count: number | null;
}

// Display prices come from config/pricing.ts (the server charges from src/config/billing.ts).

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
  /** Lifetime page credits ever bought (drives the creation-allowance tier). */
  pageCreditsTotal: number;
  activePages: number;
  monthlyCreate: number;
  createdThisPeriod: number;
  whiteLabel: boolean;
  /** Which products the account holds (migration 027). pagey_pages is always true. */
  entitlements?: { pagey_pages: boolean; seo_autopilot: boolean };
}

interface BundleDef {
  key: 'bundle5' | 'bundle10';
  label: string;
  pages: number;
  price: number;
  aiCredits: number;
  whiteLabel: boolean;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
//
// One accent (the brand blue) used only on primary actions and live state;
// everything else is neutral slate. Radii top out at 12px (rounded-xl) for
// surfaces and 8px (rounded-lg) for controls. Motion is a single short fade —
// no spring physics, no staggered entrance choreography.

const ACCENT = '#2E63F6';

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

/** One figure in the stat strip. Reads as data: quiet label, loud number. */
function StatCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:px-5 sm:py-4 min-w-0">
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
              : `פרסום דף בודד עולה ₪${PRICING.singlePage.price}, חד־פעמי. בחבילת דפים המחיר לדף יורד ל־₪${perPage('bundle5')} (${PRICING.bundle5.pages} דפים) או ₪${perPage('bundle10')} (${PRICING.bundle10.pages} דפים).`}
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
              {/* Free tier: a monthly-resetting quota (unchanged). Paid tier
                  (2026-09-14): a LIFETIME creation allowance included in what
                  was purchased (2x the pages bought) — framed as "included in
                  the package", never "this month", since it doesn't reset. */}
              <span className="text-sm text-slate-500">
                {plan.tier === 'paid' ? 'יצירות כלולות בחבילה' : 'דפים שנוצרו החודש'}
              </span>
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

// ─── Page cards ───────────────────────────────────────────────────────────────

/**
 * The renewal call-to-action on a page card. Rendered only when the page is
 * frozen or inside the 30-day warning window, so a healthy page's card is
 * completely unchanged — the prompt is a signal, and a permanent one is noise.
 */
function RenewalNotice({
  page, onRenew, busy, renewalPrice,
}: { page: PageRow; onRenew: (id: string) => void; busy: boolean; renewalPrice: number }) {
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
        {busy ? 'רגע…' : `${frozen ? 'החזירו לאוויר' : 'חדשו לשנה נוספת'} — ₪${renewalPrice}`}
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

// Web Share API when available (opens the native share sheet — WhatsApp,
// Messages, etc. — on mobile and on desktop browsers that support it),
// falling back to clipboard copy everywhere else. `onCopied` lets the caller
// show its own brief "copied" feedback for the fallback path.
async function sharePage(url: string, businessName: string, onCopied: () => void) {
  if (navigator.share) {
    try {
      await navigator.share({ title: businessName, url });
      return;
    } catch {
      // User cancelled the share sheet, or it failed — fall through to copy
      // rather than leaving the click with no effect at all.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    onCopied();
  } catch { /* clipboard unavailable — nothing more we can do here */ }
}

function PageGrid({
  pages, onDelete, onRenew, renewingId, renewalPrice, includedId = null,
}: {
  pages: PageRow[];
  /** the page that comes with the promotion subscription (shown with a tag) */
  includedId?: string | null;
  onDelete: (id: string, name: string) => void;
  onRenew: (id: string) => void;
  renewingId: string | null;
  renewalPrice: number;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrPage, setQrPage] = useState<{ url: string; name: string } | null>(null);
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
                <p className="text-xs text-slate-400 font-mono truncate" dir="ltr">{publicPageLabel(p.slug, p.subdomain)}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <StatusBadge status={p.status} />
              {includedId === p.id && <span className="rounded-md bg-[#E9EEFB] px-2 py-0.5 text-[11px] font-medium text-[#0E2148]">כלול במנוי הקידום</span>}
            </div>
          </div>
          <p className="text-xs text-slate-400 tabular-nums">{formatDate(p.created_at)}</p>
          {p.status === 'published' && (
            <p className="text-xs text-slate-400 tabular-nums">
              {(p.view_count ?? 0).toLocaleString('he-IL')} צפיות · {(p.cta_click_count ?? 0).toLocaleString('he-IL')} קליקים
            </p>
          )}
          {needsRenewal(p) && (
            <RenewalNotice page={p} onRenew={onRenew} busy={renewingId === p.id} renewalPrice={renewalPrice} />
          )}
          <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                to={`/p/${p.slug}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-[#2E63F6] hover:text-[#1E4FD6] transition-colors flex-shrink-0"
              >
                <ExternalLink size={12} />
                צפייה בדף
              </Link>
              {p.status === 'published' && (
                <button
                  onClick={() => sharePage(shareUrl(p.slug, p.subdomain), p.business_name, () => {
                    setCopiedId(p.id);
                    setTimeout(() => setCopiedId((cur) => (cur === p.id ? null : cur)), 2000);
                  })}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#2E63F6] transition-colors flex-shrink-0"
                >
                  <Share2 size={12} />
                  {copiedId === p.id ? 'הקישור הועתק! ✓' : 'שיתוף'}
                </button>
              )}
              {p.status === 'published' && (
                <button
                  onClick={() => setQrPage({ url: shareUrl(p.slug, p.subdomain), name: p.business_name })}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#2E63F6] transition-colors flex-shrink-0"
                >
                  <QrCode size={12} />
                  QR
                </button>
              )}
            </div>
            <button
              onClick={() => onDelete(p.id, p.business_name)}
              title="מחק דף"
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 transition-colors flex-shrink-0"
            >
              <Trash2 size={12} />
              מחק
            </button>
          </div>
        </div>
      ))}
      {qrPage && (
        <QrModal
          url={qrPage.url}
          title={qrPage.name}
          onClose={() => setQrPage(null)}
        />
      )}
    </div>
  );
}

// ─── Skeleton loader ─────────────────────────────────────────────────────────

// ─── Main component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, loading: authLoading, logout } = useAuth();
  const { user: portalUser } = useUser();
  const navigate = useNavigate();

  const [pages, setPages]             = useState<PageRow[]>([]);
  const [leads, setLeads]             = useState<LeadFeedItem[]>([]);
  const [leadsSummary, setLeadsSummary] = useState<LeadsSummary>({ month_total: 0, month_whatsapp: 0, month_call: 0, month_form: 0, month_email: 0, month_link: 0 });
  const [dataLoading, setDataLoading] = useState(true);
  // 2026-09-14: distinguishes "genuinely no pages yet" from "the fetch
  // failed" — without this, a network blip/expired-token/500 rendered the
  // exact same empty state as a brand-new account, silently telling a
  // paying customer their pages are gone. retryTick just forces the fetch
  // effect below to re-run when the user clicks "try again".
  const [dataError, setDataError]     = useState(false);
  const [retryTick, setRetryTick]     = useState(0);
  const { requested, go } = useArea();
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [walletKey, setWalletKey] = useState(0);
  const [paymentNotice, setPaymentNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [plan, setPlan] = useState<AccountStatus | null>(null);
  const [isAdminAccount, setIsAdminAccount] = useState(false); // only decides whether dashboard v2 is on by default
  // The promotion product: which page its subscription includes, whether a subscription exists,
  // and what its screens look like in this account (reported by the screens themselves).
  const [seoSub, setSeoSub] = useState<{ enabled: boolean; has: boolean; pageId: string | null } | null>(null);
  const [promoMode, setPromoMode] = useState<PromoMode>('unknown');
  const [bundlesCatalog, setBundlesCatalog] = useState<Record<string, BundleDef>>({});
  const [singlePagePrice, setSinglePagePrice] = useState<number>(PRICING.singlePage.price);
  const [showPlans, setShowPlans] = useState(false);

  // Required pre-payment acknowledgment that a digital purchase is not
  // cancellable (חוק הגנת הצרכן s.14ג(ד)(3) — see legal/refundPolicy.ts).
  // One flag per modal, both reset every time their modal opens.
  const [bundleAck, setBundleAck] = useState(false);
  const [creditsAck, setCreditsAck] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  // An applied coupon is only a PREVIEW of the price (see CouponField). What
  // makes it real is passing `code` through to /api/payments/start, which
  // re-validates it server-side and prices the charge itself.
  type AppliedCoupon = { code: string; quotes: Record<string, CouponQuote> };
  const [bundleCoupon, setBundleCoupon] = useState<AppliedCoupon | null>(null);
  const [creditsCoupon, setCreditsCoupon] = useState<AppliedCoupon | null>(null);

  // Account deletion (settings, 2026-09-14) — a typed-confirmation modal, same
  // "type the exact thing to unlock the button" discipline the admin panel's
  // own confirm-delete dialogs use for irreversible actions.
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

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
    dropQuery('payment');
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
    dropQuery('bundles', 'upgrade');
  }, []);

  // Deep link from a renewal reminder email (?renew=<page id>). Deliberately
  // does NOT open the charge automatically: an email link must never be able to
  // start a payment on its own. It just lands the owner on the pages tab, where
  // the card for that page is already showing its renewal button, and says so.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (!q.get('renew')) return;
    // the pages area is opened by the URL itself (shell/areas.ts: ?renew= means "pages")
    setPaymentNotice({ text: 'הדף מסומן לחידוש — לחצו על כפתור החידוש בכרטיס הדף.', ok: true });
    dropQuery('renew');
    const t = setTimeout(() => setPaymentNotice(null), 8000);
    return () => clearTimeout(t);
  }, []);

  // ?leads=1 (the publish-success modal's "see your leads" nudge) opens the leads area: shell/areas.ts.

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
      setDataError(false);
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
              status: AccountStatus; bundles: Record<string, BundleDef>; singlePagePrice?: number; isAdmin?: boolean;
            };
            if (!cancelled) {
              setPlan(pd.status);
              setIsAdminAccount(pd.isAdmin === true);
              setBundlesCatalog(pd.bundles);
              if (pd.singlePagePrice) setSinglePagePrice(pd.singlePagePrice);
            }
            // Which page comes with the promotion subscription (read only; the card in settings manages it).
            if (pd.status?.entitlements?.seo_autopilot === true) {
              try {
                const subRes = await authFetch('/api/seo/subscription');
                const sb = subRes.ok ? await subRes.json() as { enabled?: boolean; subscription?: { page?: { pageId?: string | null } | null } | null } : null;
                if (!cancelled) setSeoSub({ enabled: sb?.enabled === true, has: !!sb?.subscription, pageId: sb?.subscription?.page?.pageId ?? null });
              } catch { /* the included page falls back to the newest one */ }
            }
          }
        } catch { /* plan card just won't render */ }

        if (pageRows.length > 0) {
          const leadsRes = await authFetch('/api/landing/my-leads');
          if (!leadsRes.ok) throw new Error('failed to load leads');
          const leadsData = await leadsRes.json();
          if (!cancelled && leadsData) {
            setLeads((leadsData.items ?? []) as LeadFeedItem[]);
            if (leadsData.summary) setLeadsSummary(leadsData.summary as LeadsSummary);
          }
        }
      } catch (err) {
        console.error('[Dashboard] data fetch failed:', err);
        if (!cancelled) setDataError(true);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [user, retryTick]);

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

  async function handleDeleteAccount() {
    if (!user?.email || deleteConfirmText.trim().toLowerCase() !== user.email.toLowerCase()) return;
    setDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      const r = await authFetch('/api/users/me', { method: 'DELETE' });
      if (!r.ok) {
        const body = await r.json().catch(() => null) as { error?: string } | null;
        setDeleteAccountError(body?.error ?? 'מחיקת החשבון נכשלה. נסו שוב.');
        setDeletingAccount(false);
        return;
      }
      // Everything server-side is already gone at this point — sign out
      // locally and leave. No point staying "logged in" to a deleted account.
      await logout();
      navigate('/', { replace: true });
    } catch {
      setDeleteAccountError('מחיקת החשבון נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.');
      setDeletingAccount(false);
    }
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
        body: JSON.stringify({ purpose: 'bundle', reference: bundleKey, couponCode: bundleCoupon?.code, refundAck: bundleAck }),
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
        body: JSON.stringify({ purpose: 'credits', reference: pack, couponCode: creditsCoupon?.code, refundAck: creditsAck }),
      });
      const data = await r.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
      if (!r.ok || !data.redirectUrl) throw new Error(data.error ?? 'פתיחת התשלום נכשלה');
      window.location.href = data.redirectUrl;
    } catch (e) {
      setBuyMsg({ text: e instanceof Error ? e.message : 'פתיחת התשלום נכשלה', ok: false });
      setBuying(false);
    }
  }


  // ── One navigation model (docs/dashboard-v4-spec.md) ──────────────────────────────
  // Two products, one sidebar grouped by product. Which groups an account sees follows what it
  // holds: promotion only, pages only, or both. Until the plan has loaded nothing is decided, so a
  // promotion customer never sees a flash of the pages screens.
  const hasSeo = plan?.entitlements?.seo_autopilot === true;
  const kind = dataLoading
    ? null
    : accountKind({ hasSeo, pageCount: pages.length, pageCredits: plan?.pageCredits ?? 0, pageCreditsTotal: plan?.pageCreditsTotal ?? 0 });
  const area = resolveArea(kind ?? 'pages', requested);
  const dashV2 = dashV2Enabled(isAdminAccount);
  // ?dash=v1 / ?dash=v2: the older promotion dashboards, which bring their own inner navigation.
  const mode: PromoMode = !dashV2 || !dashV3Enabled() ? 'classic' : promoMode;
  const nav = kind ? navFor(kind, mode) : null;
  const inPromo = kind !== null && isPromoArea(area);

  // The landing page that comes with the promotion subscription: the one the subscription names,
  // else the newest page (the same page the server builds the search-phrase pages under).
  const includedRow = hasSeo ? (pages.find((p) => p.id === seoSub?.pageId) ?? pages[0] ?? null) : null;
  const includedPage: IncludedPage | null = includedRow
    ? { id: includedRow.id, slug: includedRow.slug, status: includedRow.status ?? 'draft', url: shareUrl(includedRow.slug, includedRow.subdomain) }
    : null;
  const bridge: PromoBridge = {
    area: isPromoArea(area) ? area : 'home', go, onMode: setPromoMode,
    page: dataError ? null : includedPage, morePagesLink: kind === 'promo',
  };

  const openCredits = () => { setCreditsAck(false); setShowBuyCredits(true); };
  const openBundles = () => { setBundleAck(false); setShowPlans(true); };

  const HEAD: Record<string, { title: string; sub: string }> = {
    pages: { title: AREA_LABEL.pages, sub: 'כל דפי הנחיתה שבניתם, במקום אחד.' },
    leads: { title: AREA_LABEL.leads, sub: 'פניות שהגיעו דרך הדפים שלכם.' },
    credits: { title: AREA_LABEL.credits, sub: 'יתרת הדפים לפרסום, וקרדיטים ליצירה ולעריכה.' },
    settings: { title: AREA_LABEL.settings, sub: hasSeo ? 'המנוי, הסיסמה והחשבון.' : 'הסיסמה, התמיכה והחשבון.' },
  };
  const head = !kind || inPromo ? null : HEAD[area];
  // Credits belong to the pages product: they show inside its area only, never for promotion only.
  const tools: ReactNode = kind && kind !== 'promo' && (area === 'pages' || area === 'leads' || area === 'credits') ? (
    <>
      <WalletBadge email={user.email} refreshKey={walletKey} />
      <button onClick={openCredits} className={`${btnSecondary} min-h-[44px]`}>
        <Plus size={14} className="text-slate-400" /> טען קרדיטים
      </button>
    </>
  ) : null;

  const errorBox = (
    <div className="rounded-xl border border-dashed border-red-200 bg-red-50/50 p-12 flex flex-col items-center gap-3 text-center">
      <p className="text-sm font-semibold text-red-700">משהו השתבש בטעינת הנתונים</p>
      <p className="text-sm text-red-500/80">זה לא בהכרח אומר שאין לכם דפים — כנראה תקלת רשת זמנית.</p>
      <button onClick={() => setRetryTick((t) => t + 1)} className={`${btnSecondary} mt-1`}>
        נסו שוב
      </button>
    </div>
  );

  const legalFooter = (
    <footer className="border-t border-[#DCE4F7] px-5 py-6">
      {/* Persistent legal footer — the dashboard is where purchases happen,
          so the refund/renewal terms have to be reachable from it. */}
      <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500">
        <Link to="/terms" className="inline-flex min-h-[44px] items-center hover:text-[#2E63F6] transition">תנאי שימוש</Link>
        <Link to="/privacy" className="inline-flex min-h-[44px] items-center hover:text-[#2E63F6] transition">מדיניות פרטיות</Link>
        <Link to="/accessibility" className="inline-flex min-h-[44px] items-center hover:text-[#2E63F6] transition">הצהרת נגישות</Link>
        <span>© {new Date().getFullYear()} Pagey</span>
      </div>
    </footer>
  );

  return (
    <DashboardShell
      nav={nav} active={navParent(area, mode)} onGo={go} email={user.email ?? ''} onLogout={handleLogout}
      title={head?.title} sub={head?.sub} tools={tools} footer={legalFooter}
      srTitle={inPromo ? `${PROMO_LABEL}: ${AREA_LABEL[area]}` : kind ? `${PAGES_LABEL}: ${AREA_LABEL[area]}` : 'הדשבורד שלכם'}
    >

      {/* Payment return toast */}
      {paymentNotice && (
        <div role="status" className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          {paymentNotice.ok && <Check size={15} className="text-emerald-400 flex-shrink-0" />}
          {paymentNotice.text}
        </div>
      )}
        {showDeleteAccount && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/50" onClick={() => !deletingAccount && setShowDeleteAccount(false)}>
            <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl flex flex-col" dir="rtl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <h3 className="text-base font-semibold tracking-tight text-red-700">מחיקת חשבון לצמיתות</h3>
                {!deletingAccount && (
                  <button onClick={() => setShowDeleteAccount(false)} aria-label="סגור"
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700 leading-relaxed">
                  פעולה זו תמחק לצמיתות את כל הדפים שלכם ({pages.length}), את כל הלידים שהתקבלו דרכם, ואת כל היתרה הבלתי מנוצלת (קרדיטים ודפים לתשלום). <span className="font-semibold">לא ניתן לבטל או לשחזר.</span> תשלומים וחשבוניות עבר נשארים ברשומות שלנו לצורכי הנהלת חשבונות בלבד.
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm text-slate-600">
                    להמשך, הקלידו את כתובת המייל שלכם: <span className="font-mono font-semibold text-slate-900" dir="ltr">{user.email}</span>
                  </span>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    dir="ltr"
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 transition"
                    placeholder={user.email}
                  />
                </label>
                {deleteAccountError && (
                  <p className="text-sm text-center font-medium rounded-lg px-3 py-2 text-red-600 bg-red-50 border border-red-200">
                    {deleteAccountError}
                  </p>
                )}
                <button
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount || deleteConfirmText.trim().toLowerCase() !== (user.email ?? '').toLowerCase()}
                  className="w-full py-3 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deletingAccount ? 'מוחק חשבון...' : 'מחיקת החשבון שלי לצמיתות'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showBuyCredits && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/50" onClick={() => !buying && setShowBuyCredits(false)}>
            <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl flex flex-col" dir="rtl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">טעינת קרדיטים</h3>
                {!buying && (
                  <button onClick={() => setShowBuyCredits(false)} aria-label="סגור"
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="p-6 flex flex-col gap-4">
                <p className="text-sm text-slate-500">קרדיטים משמשים ליצירת תמונות וכתיבה מחדש ב-AI.</p>
                <div className="grid grid-cols-1 gap-2.5">
                  <button disabled={buying || !creditsAck} onClick={() => handleBuyCredits('small')}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 text-right hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-50">
                    <span className="text-sm font-medium text-slate-900">{PRICING.creditPacks.small.credits} קרדיטים</span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {creditsCoupon?.quotes.small ? (
                        <><span className="text-sm text-slate-400 line-through font-normal">₪{PRICING.creditPacks.small.price}</span>{' '}
                          <span className="text-emerald-600">₪{creditsCoupon.quotes.small.finalAmount}</span></>
                      ) : `₪${PRICING.creditPacks.small.price}`}
                    </span>
                  </button>
                  <button disabled={buying || !creditsAck} onClick={() => handleBuyCredits('large')}
                    className="flex items-center justify-between rounded-lg border border-[#2E63F6] bg-[#2E63F6]/[0.04] p-4 text-right hover:bg-[#2E63F6]/[0.08] transition-colors disabled:opacity-50">
                    <span className="text-sm font-medium text-slate-900">
                      {PRICING.creditPacks.large.credits} קרדיטים <span className="mr-1 rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">הכי משתלם</span>
                    </span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                      {creditsCoupon?.quotes.large ? (
                        <><span className="text-sm text-slate-400 line-through font-normal">₪{PRICING.creditPacks.large.price}</span>{' '}
                          <span className="text-emerald-600">₪{creditsCoupon.quotes.large.finalAmount}</span></>
                      ) : `₪${PRICING.creditPacks.large.price}`}
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
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors">
                    <X size={18} />
                  </button>
                )}
              </div>
              <div className="p-6 flex flex-col gap-4">
                <p className="text-sm text-slate-500 leading-relaxed">
                  דף בודד עולה ₪{singlePagePrice}, חד־פעמי. חבילת דפים היא רכישה חד־פעמית שמוזילה את המחיר לדף —
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

          <SeoReturnBanner />

          <JourneyBanner />

          {kind === null ? (
            <div className="dsh-load" aria-busy="true" aria-label="טוען"><span /><span /><span /></div>
          ) : area === 'settings' ? (
            /* ── Settings and billing: the subscription, the password, support, the account ── */
            <div className="flex flex-col gap-4">
              {hasSeo && (
                <section className="dsh-section" aria-label="המנוי לקידום בגוגל">
                  <SeoSubscriptionCard />
                  {seoSub && !seoSub.has && (
                    <div className={`${surface} p-5`}>
                      <p className="text-sm font-medium text-slate-900">אין כרגע חיוב חודשי לנהל</p>
                      {seoSub.enabled ? (
                        <>
                          <p className="mt-1 text-sm text-slate-500">אם יופעל מנוי חודשי, הוא יופיע כאן, ואפשר יהיה לבטל אותו בכל רגע.</p>
                          <Link to="/seo-plan" className={`${btnSecondary} mt-3 min-h-[44px]`}>להצטרפות למנוי החודשי ולתשלום</Link>
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-slate-500">קידום בגוגל פעיל בחשבון שלכם ואין עליו חיוב כרגע.</p>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* Set a password (for users who signed up via magic link) */}
              <SetPasswordCard />
              {/* Contact/support card (2026-09-14) — visible in a spot every user
                  passes through, encouraging reach-out for any issue rather
                  than silent churn. Deliberately placed before the danger
                  zone, not after, so it doesn't read as an afterthought next
                  to account deletion. */}
              <div className={`${surface} p-5 flex items-center justify-between gap-4 flex-wrap`}>
                <div className="flex items-start gap-3 min-w-0">
                  <span className="mt-0.5 flex-shrink-0 text-[#2E63F6]"><Mail size={16} /></span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium text-slate-900">נתקלתם בבעיה? יש שאלה?</span>
                    <span className="text-xs text-slate-500 leading-relaxed">
                      אנחנו כאן בשבילכם — אל תהססו לפנות בכל נושא, קטן כגדול.
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a
                    href="mailto:tirnoer.digital@gmail.com"
                    className={btnSecondary}
                  >
                    <Mail size={14} className="text-slate-400" /> אימייל
                  </a>
                  <a
                    href="https://wa.me/16465358055"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={btnSecondary}
                  >
                    <MessageCircle size={14} className="text-slate-400" /> WhatsApp
                  </a>
                </div>
              </div>

              {/* Danger zone — account deletion (2026-09-14) */}
              <div className="rounded-2xl border border-red-100 bg-red-50/50 p-5 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-red-700">מחיקת חשבון</span>
                  <span className="text-xs text-red-500/80 leading-relaxed max-w-md">
                    מוחק לצמיתות את כל הדפים, הלידים והיתרה שלכם (קרדיטים ודפים לא מנוצלים). לא ניתן לשחזר. חשבוניות ותשלומי עבר נשמרים לצורכי הנהלת חשבונות.
                  </span>
                </div>
                <button
                  onClick={() => { setDeleteConfirmText(''); setDeleteAccountError(null); setShowDeleteAccount(true); }}
                  className="flex-shrink-0 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
                >
                  מחיקת החשבון שלי
                </button>
              </div>
            </div>
          ) : inPromo ? (
            /* ── קידום בגוגל: its own screens; the sidebar chooses which one ── */
            dashV2 ? <SeoDashboardV2 showPageUpsell={kind === 'promo'} bridge={bridge} /> : <SeoProductPanel showPageUpsell={kind === 'promo'} />
          ) : dataError ? errorBox : area === 'credits' ? (
            /* ── דפי נחיתה: page balance, AI credits, the white-label add-on, referrals ── */
            <div className="flex flex-col gap-4">
              {plan ? (
                <BalanceCard plan={plan} onBuyBundle={openBundles} />
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
                  onClick={openCredits}
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
                    onClick={openBundles}
                    className={btnSecondary}>
                    הסרת המיתוג
                  </button>
                </div>
              )}
              {/* Referral */}
              {portalUser && <ReferralCard user={portalUser} />}
            </div>
          ) : area === 'leads' ? (
            <LeadsTable items={leads} summary={leadsSummary} />
          ) : (
            /* ── דפי נחיתה: the pages ── */
            <>
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                <StatCard label="סה״כ דפים" value={String(pages.length)} icon={<Globe size={14} />} />
                <StatCard label="דפים פעילים" value={String(publishedPages.length)} icon={<CheckCircle size={14} />} />
                <StatCard label="לידים החודש" value={String(leadsSummary.month_total)} icon={<Users size={14} />} />
              </div>

              <GoogleDraftCard />

              <section className="dsh-section" aria-label="הדפים שלי">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <p className="text-sm text-slate-500">
                    {plan && plan.pageCredits > 0 ? `נשארו ${plan.pageCredits} דפים לפרסום ביתרה.` : 'פרסום דף נוסף נעשה מהדף עצמו.'}
                    {' '}
                    <button type="button" onClick={() => go('credits')} className="inline-flex min-h-[44px] items-center font-medium text-[#1E4FD6] underline underline-offset-4">ליתרה ולקרדיטים</button>
                  </p>
                  <Link to="/create" className={`${btnPrimary} min-h-[44px]`}>
                    <Plus size={15} /> דף חדש
                  </Link>
                </div>
                <PageGrid
                  pages={pages}
                  onDelete={handleDeletePage}
                  onRenew={handleRenewPage}
                  renewingId={renewingId}
                  renewalPrice={plan ? renewalPriceFor(plan.pageCreditsTotal) : PRICING.renewal.base}
                  includedId={kind === 'both' ? includedPage?.id ?? null : null}
                />
              </section>
            </>
          )}

    </DashboardShell>
  );
}
