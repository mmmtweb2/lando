import { type ReactNode, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { AuthProvider, useAuth } from './context/AuthContext';
import { UserProvider, useUser } from './context/UserContext';
import type { UserProfile } from './context/UserContext';

import Wizard          from './components/Wizard';
import LandingViewer   from './pages/LandingViewer';
import AdminDashboard  from './pages/AdminDashboard';
import Login           from './pages/Login';
import ClientPortal    from './pages/ClientPortal';
import Dashboard       from './pages/Dashboard';

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

// ─── Auth bridge ──────────────────────────────────────────────────────────────
// When a user authenticates via Supabase Magic Link, we also call the legacy
// REST API to create/fetch their UserProfile and store it in UserContext.
// This keeps the Wizard, LandingViewer edit mode, and ClientPortal working
// without any changes to those components.

function SyncAuth() {
  const { user: authUser, loading: authLoading } = useAuth();
  const { user: portalUser, setUser, setIsAuthReady } = useUser();

  useEffect(() => {
    if (authLoading) return;

    if (!authUser) {
      if (portalUser) setUser(null);
      setIsAuthReady(true);
      return;
    }

    if (portalUser) {
      setIsAuthReady(true);
      return;
    }

    const fallback: UserProfile = {
      email: authUser.email!,
      affiliate_code: '',
      ai_image_credits: 0,
      earned_coupons: 0,
      signup_discount: false,
      referred_by_code: null,
    };

    fetch('/api/users/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: authUser.email }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((profile: UserProfile | null) => { setUser(profile ?? fallback); })
      .catch(() => { setUser(fallback); })
      .finally(() => setIsAuthReady(true));
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
          <SyncAuth />
          <Routes>
            <Route path="/"          element={<Wizard />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/portal"    element={<ClientPortal />} />
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
