import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
});

/**
 * Supabase hands out a NEW `session.user` object on every auth event (INITIAL_SESSION, SIGNED_IN on
 * tab focus, TOKEN_REFRESHED, ...). Many pages list `user` in their effect deps, so every event used
 * to re-run their data fetches (the dashboard fired my-pages / plan / my-leads up to 7 times on first
 * load). Keep the SAME object while it is still the same user at the same revision.
 */
function sameUser(a: User | null, b: User | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.email === b.email && a.updated_at === b.updated_at;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const setUser = (next: User | null) => setUserState((prev) => (sameUser(prev, next) ? prev : next));

  useEffect(() => {
    // Hydrate from any existing session on first mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      // Profile rows are created server-side (via /api/users/auth and the
      // self-healing ensureUserProfile). The browser can't insert into
      // user_profiles under RLS, so we don't attempt it here.
    });

    return () => subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
