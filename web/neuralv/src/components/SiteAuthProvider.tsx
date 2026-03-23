import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearStoredSiteSession,
  fetchCurrentSiteUser,
  logoutSiteSession,
  readStoredSiteSession,
  SiteAuthSession,
  SiteAuthUser,
  storeSiteSession,
  subscribeToSiteAuthSession
} from '../lib/siteAuth';

type SiteAuthContextValue = {
  ready: boolean;
  session: SiteAuthSession | null;
  user: SiteAuthUser | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setSession: (session: SiteAuthSession | null) => void;
};

const SiteAuthContext = createContext<SiteAuthContextValue | null>(null);

export function SiteAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<SiteAuthSession | null>(() => readStoredSiteSession());

  const setSession = useCallback((next: SiteAuthSession | null) => {
    setSessionState(next);
    if (next) {
      storeSiteSession(next);
    } else {
      clearStoredSiteSession();
    }
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetchCurrentSiteUser();
    if (result.ok && result.data) {
      setSession(result.data);
      return;
    }
    setSession(null);
  }, [setSession]);

  const logout = useCallback(async () => {
    await logoutSiteSession();
    setSession(null);
  }, [setSession]);

  useEffect(() => {
    const current = readStoredSiteSession();
    if (!current) {
      setReady(true);
      return;
    }

    fetchCurrentSiteUser()
      .then((result) => {
        if (result.ok && result.data) {
          setSession(result.data);
        } else {
          setSession(null);
        }
      })
      .finally(() => setReady(true));
  }, [setSession]);

  useEffect(() => subscribeToSiteAuthSession(setSession), [setSession]);

  const value = useMemo<SiteAuthContextValue>(() => ({
    ready,
    session,
    user: session?.user ?? null,
    logout,
    refresh,
    setSession
  }), [logout, ready, refresh, session, setSession]);

  return <SiteAuthContext.Provider value={value}>{children}</SiteAuthContext.Provider>;
}

export function useSiteAuth() {
  const context = useContext(SiteAuthContext);
  if (!context) {
    throw new Error('useSiteAuth must be used inside SiteAuthProvider');
  }
  return context;
}
