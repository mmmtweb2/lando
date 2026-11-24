import { lazy, Suspense, type ReactNode, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import MarketingTags from './components/MarketingTags';
import { UserProvider, useUser } from './context/UserContext';
import type { UserProfile } from './context/UserContext';

import MarketingLanding from './pages/MarketingLanding';
import NotFound        from './pages/NotFound';
import { TRANSLATION_LANGS } from './i18n/landingLanguages';
// QA 24.11: /terms, /privacy and /accessibility stayed blank for seconds. They are static text that
// needs no sign-in, so they are in the main bundle and paint as soon as the app starts (about 18 kB
// gzipped), instead of waiting for the main bundle AND then a second round trip for their chunk.
import Privacy       from './pages/legal/Privacy';
import Terms         from './pages/legal/Terms';
import Accessibility from './pages/legal/Accessibility';
import { isLoginLink, loadLogin, preloadLogin, whenIdle } from './lib/preload';

// Route-level code splitting: the home page, the legal pages and the 404 are in the main bundle.
// Every other route loads its own chunk on first visit, so /seo and /audit (the pages visitors land
// on from ads and shared links) do not download the dashboard, the editor and the admin console.
const Wizard         = lazy(() => import('./components/Wizard'));
const PublicAudit    = lazy(() => import('./pages/PublicAudit'));
const StartJourney   = lazy(() => import('./pages/StartJourney'));
const SeoPlan        = lazy(() => import('./pages/SeoPlan'));
const LandingViewer  = lazy(() => import('./pages/LandingViewer'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const Login          = lazy(loadLogin);
const ResetPassword  = lazy(() => import('./pages/ResetPassword'));
const Dashboard      = lazy(() => import('./pages/Dashboard'));
const SeoLanding     = lazy(() => import('./pages/SeoLanding'));

/** Shown while a route chunk loads: a light branded screen (QA 24.11: a blank white page read as
    broken). It fades in after 150ms, so a cached chunk never flashes it, and says what is happening. */
export function RouteFallback() {
  return (
    <div className="pagey-route-fallback min-h-screen flex flex-col items-center justify-center gap-4 bg-[#EEF1FB]" role="status" aria-live="polite" aria-busy="true" dir="rtl">
      <span className="text-2xl font-extrabold tracking-tight text-[#2E63F6]">Pagey</span>
      <span className="pagey-route-bar" aria-hidden="true"><span /></span>
      <span className="text-sm text-slate-500">טוענים את העמוד…</span>
    </div>
  );
}

/** Login chunk: fetched when the browser is idle on a public page, and at once when the pointer or
    focus reaches any link to /login (the homepage CTAs and header links), before the click. */
function PreloadLogin() {
  const { user } = useAuth();
  useEffect(() => {
    if (user) return;
    const onIntent = (e: Event) => { if (isLoginLink(e.target)) preloadLogin(); };
    document.addEventListener('pointerover', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent);
    document.addEventListener('touchstart', onIntent, { passive: true });
    const cancel = whenIdle(preloadLogin);
    return () => {
      cancel();
      document.removeEventListener('pointerover', onIntent);
      document.removeEventListener('focusin', onIntent);
      document.removeEventListener('touchstart', onIntent);
    };
  }, [user]);
  return null;
}

/** For a signed-in user the two heaviest app screens are fetched in the background once the
    browser is idle, so opening the dashboard or the wizard does not wait on the network. */
function PrefetchAppScreens() {
  const { user } = useUser();
  useEffect(() => {
    if (!user) return;
    const run = () => { void import('./pages/Dashboard'); void import('./components/Wizard'); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run); else setTimeout(run, 2000);
  }, [user]);
  return null;
}

import { authFetch } from './lib/api';
import { getOrCreateVisitorId } from './lib/analytics';
import { subdomainPageSlug } from './lib/pageUrl';

// ─── Protected route (Supabase auth) ─────────────────────────────────────────

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 size={32} className="animate-spin text-indigo-500" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ─── Failed magic-link / OTP callback ────────────────────────────────────────
// A Supabase auth email (magic link, invite, password reset) that has expired
// or was already used redirects back here with the FAILURE encoded in the URL
// hash instead of a session — e.g.
//   https://pagey.co.il/#error=access_denied&error_code=otp_expired&...
// `detectSessionInUrl` (lib/supabase.ts) only knows how to consume a SUCCESSFUL
// callback; on an error hash it silently does nothing, and since the path here
// is almost always just "/", the app was rendering the marketing homepage with
// no indication anything went wrong (bug report, 2026-09-06 — a real admin
// login link expired and looked like a dead end, not an error). This runs once
// on load, and if the hash carries an auth error, replaces the URL with
// /login and a readable Hebrew message instead of leaving the failure silent.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  otp_expired: 'קישור ההתחברות פג תוקף או שכבר נעשה בו שימוש. יש לבקש קישור חדש.',
  access_denied: 'הקישור אינו תקף. יש לבקש קישור התחברות חדש.',
};

function AuthErrorRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes('error=')) return;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const errorCode = params.get('error_code') ?? params.get('error') ?? '';
    if (!errorCode) return;
    const message = AUTH_ERROR_MESSAGES[errorCode] ?? 'ההתחברות נכשלה. יש לבקש קישור התחברות חדש.';
    navigate('/login', { replace: true, state: { authError: message } });
  }, [navigate]);
  return null;
}

// ─── Auth bridge ──────────────────────────────────────────────────────────────────
// When a user authenticates via Supabase Magic Link, we also call the legacy
// REST API to create/fetch their UserProfile and store it in UserContext.
// This keeps the Wizard and LandingViewer edit mode working
// without any changes to those components.

function SyncAuth() {
  const { user: authUser, loading: authLoading } = useAuth();
  const { user: portalUser, setUser, setIsAuthReady } = useUser();

  useEffect(() => {
    // Capture the referral code from the URL early — it survives the magic-link redirect.
    const urlRef = new URLSearchParams(window.location.search).get('ref');
    if (urlRef) localStorage.setItem('pending_ref', urlRef);
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!authUser) {
      if (portalUser) setUser(null);
      setIsAuthReady(true);
      return;
    }

    // A cached profile only counts if it actually belongs to the currently
    // authenticated Supabase user. Without this check, a stale profile left
    // in localStorage from a PREVIOUS account on a shared/kiosk browser would
    // be reused as-is for a newly logged-in different account (wrong
    // affiliate_code/credits shown, wrong referral code shared) — the cache
    // is per-browser, not per-account, so it must be re-validated on every
    // auth change rather than trusted just because *something* is cached.
    if (portalUser && portalUser.email === authUser.email) {
      setIsAuthReady(true);
      return;
    }

    const fallback: UserProfile = {
      email: authUser.email!,
      affiliate_code: '',
      credits: 0,
      earned_coupons: 0,
      signup_discount: false,
      referred_by_code: null,
    };

    const pendingRef = localStorage.getItem('pending_ref') ?? undefined;
    authFetch('/api/users/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: pendingRef }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((profile: UserProfile | null) => {
        if (profile) {
          setUser(profile);
          localStorage.removeItem('pending_ref');
        } else {
          // Sync failed (non-OK response) — render the fallback now, but
          // don't persist it: persisting would make the next mount trust
          // this fake zero-credit profile as "already synced" forever (see
          // the guard above). Keep pending_ref too, so a transient failure
          // doesn't permanently drop the referral attribution.
          setUser(fallback, false);
        }
      })
      .catch(() => { setUser(fallback, false); })
      .finally(() => { setIsAuthReady(true); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.email, authLoading]);

  return null;
}

// ─── Site traffic tracker ─────────────────────────────────────────────────────
// Lightweight page-view logger for the MARKETING site (see
// migrations/021_site_visits.sql + admin dashboard's "תעבורה" section).
// Fires once per route change, fire-and-forget, never blocks rendering.
// visitor_id is a random id persisted in localStorage so the admin dashboard
// can approximate unique visitors — not a real identity, just a per-browser
// counting key with no PII.
// Set when the server routed a page subdomain (cafe-dani.pagey.co.il) to this app.
const subSlug = subdomainPageSlug();

function SiteTracker() {
  const location = useLocation();

  useEffect(() => {
    // A customer's own page on its subdomain is not a marketing-site visit.
    if (subdomainPageSlug()) return;
    const params = new URLSearchParams(location.search);
    const body = {
      path: location.pathname,
      visitorId: getOrCreateVisitorId(),
      referrer: document.referrer || null,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
    };
    fetch('/api/site/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <UserProvider>
        <BrowserRouter>
          <AuthErrorRedirect />
          <SyncAuth />
          <SiteTracker />
          <MarketingTags />
          <PrefetchAppScreens />
          <PreloadLogin />
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/"          element={subSlug ? <LandingViewer slugOverride={subSlug} /> : <MarketingLanding />} />
            <Route path="/create"    element={<Wizard />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/p/:slug"   element={<LandingViewer />} />
            {/* Page languages (README part 142): /p/<slug>/fr, and /fr on the page's own subdomain.
                /b/<sub>/fr is matched by the /b/:subdomain/:subSlug route below (the server resolves it). */}
            <Route path="/p/:slug/:lang" element={<LandingViewer />} />
            {TRANSLATION_LANGS.map((l) => (
              <Route key={l} path={`/${l}`} element={subSlug ? <LandingViewer slugOverride={subSlug} /> : <NotFound />} />
            ))}
            {/* Canonical, indexed URLs. The server resolves the page (a child via its
                parent subdomain + sub_slug) and injects its slug; no slug = unknown path. */}
            <Route path="/b/:subdomain"          element={subSlug ? <LandingViewer slugOverride={subSlug} /> : <Navigate to="/" replace />} />
            <Route path="/b/:subdomain/:subSlug" element={subSlug ? <LandingViewer slugOverride={subSlug} /> : <Navigate to="/" replace />} />

            {/* Public legal pages — linked from every footer, and referenced
                from the checkout disclosures. Deliberately unauthenticated. */}
            <Route path="/audit"         element={<PublicAudit />} />
            <Route path="/seo"           element={<SeoLanding />} />
            <Route path="/start"         element={<StartJourney />} />
            <Route path="/seo-plan"      element={<SeoPlan />} />
            <Route path="/privacy"       element={<Privacy />} />
            <Route path="/terms"         element={<Terms />} />
            <Route path="/accessibility" element={<Accessibility />} />

            <Route path="/admin"     element={<AdminDashboard />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </UserProvider>
    </AuthProvider>
  );
}
