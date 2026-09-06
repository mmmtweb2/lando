import { type ReactNode, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserProvider, useUser } from './context/UserContext';
import type { UserProfile } from './context/UserContext';

import Wizard          from './components/Wizard';
import MarketingLanding from './pages/MarketingLanding';
import LandingViewer   from './pages/LandingViewer';
import AdminDashboard  from './pages/AdminDashboard';
import Login           from './pages/Login';
import ResetPassword   from './pages/ResetPassword';
import Dashboard       from './pages/Dashboard';
import { authFetch } from './lib/api';

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
      .then((profile: UserProfile | null) => { setUser(profile ?? fallback); })
      .catch(() => { setUser(fallback); })
      .finally(() => { setIsAuthReady(true); localStorage.removeItem('pending_ref'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.email, authLoading]);

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
          <Routes>
            <Route path="/"          element={<MarketingLanding />} />
            <Route path="/create"    element={<Wizard />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/p/:slug"   element={<LandingViewer />} />
            <Route path="/admin"     element={<AdminDashboard />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </UserProvider>
    </AuthProvider>
  );
}
