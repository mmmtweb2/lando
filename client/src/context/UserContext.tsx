import { createContext, useContext, useState, type ReactNode } from 'react';

export interface UserProfile {
  email: string;
  affiliate_code: string;
  credits: number;
  earned_coupons: number;
  signup_discount: boolean;
  referred_by_code: string | null;
}

interface UserContextType {
  user: UserProfile | null;
  // `persist` (default true): whether to also write the profile to
  // localStorage. Pass false for a transient/fallback value (e.g. a failed
  // profile-sync) so it renders now but is NOT cached — otherwise a failed
  // sync gets treated as "already synced" on every future mount (the guard
  // in App.tsx's SyncAuth trusts anything cached under the user's email),
  // permanently masking the real profile behind a fake zero-credit one.
  setUser: (user: UserProfile | null, persist?: boolean) => void;
  isAuthReady: boolean;
  setIsAuthReady: (ready: boolean) => void;
}

const UserContext = createContext<UserContextType>({
  user: null,
  setUser: () => {},
  isAuthReady: false,
  setIsAuthReady: () => {},
});

const STORAGE_KEY = 'snappage_user';

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserProfile | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as UserProfile) : null;
    } catch {
      return null;
    }
  });
  const [isAuthReady, setIsAuthReady] = useState(false);

  function setUser(profile: UserProfile | null, persist = true) {
    setUserState(profile);
    if (!persist) return;
    if (profile) localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(STORAGE_KEY);
  }

  return (
    <UserContext.Provider value={{ user, setUser, isAuthReady, setIsAuthReady }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
