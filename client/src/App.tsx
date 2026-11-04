import { lazy, Suspense, type ReactNode, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import MarketingTags from './components/MarketingTags';
import { UserProvider, useUser } from './context/UserContext';
import type { UserProfile } from './context/UserContext';

import MarketingLanding from './pages/MarketingLanding';
import NotFound        from './pages/NotFound';

// Route-level code splitting: only the home page and the 404 are in the main bundle. Every other
// route loads its own chunk on first visit, so /seo and /audit (the pages visitors land on from
// ads and shared links) no longer download the dashboard, the editor and the admin console.
const Wizard         = lazy(() => import('./components/Wizard'));
const PublicAudit    = lazy(() => import('./pages/PublicAudit'));
const StartJourney   = lazy(() => import('./pages/StartJourney'));
const SeoPlan        = lazy(() => import('./pages/SeoPlan'));
const LandingViewer  = lazy(() => import('./pages/LandingViewer'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const Login          = lazy(() => import('./pages/Login'));
const ResetPassword  = lazy(() => import('./pages/ResetPassword'));
const Dashboard      = lazy(() => import('./pages/Dashboard'));
const Privacy        = lazy(() => import('./pages/legal/Privacy'));
const SeoLanding     = lazy(() => import('./pages/SeoLanding'));
const Terms          = lazy(() => import('./pages/legal/Terms'));
const Accessibility  = lazy(() => import('./pages/legal/Accessibility'));

/** Shown while a route chunk loads. Blank for the first 250ms (a cached or fast chunk never
    flashes a spinner), then a small spinner. */
function RouteFallback() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center bg-white" aria-busy="true">
      {show && <Loader2 size={28} className="animate-spin text-indigo-500" aria-label="טוען" />}
    </div>
  );
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
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/"          element={subSlug ? <LandingViewer slugOverride={subSlug} /> : <MarketingLanding />} />
            <Route path="/create"    element={<Wizard />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/p/:slug"   element={<LandingViewer />} />
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
