import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { AuthAccount, LoginResponse } from "@/types";
import { api, setSession, clearSession, getSessionToken, getSessionAccount } from "@/api";

type AuthState = {
  account: AuthAccount | null;
  loading: boolean;
  login: (name: string, number: string, password: string) => Promise<LoginResponse>;
  systemInit: (name: string, number: string, password: string) => Promise<LoginResponse & { ok: boolean }>;
  verify2fa: (tempToken: string, code: string) => Promise<LoginResponse>;
  setup2faVerify: (tempToken: string, code: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshAccount: () => Promise<AuthAccount | null>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AuthAccount | null>(getSessionAccount());
  const [loading] = useState(false);

  const systemInit = useCallback(async (name: string, number: string, password: string) => {
    const res = await api.systemInit(name, number, password);
    return res;
  }, []);

  const login = useCallback(async (name: string, number: string, password: string) => {
    const res = await api.login(name, number, password);
    if (res.requires_2fa) {
      return res;
    }
    setSession(res.token, res.account);
    setAccount(res.account);
    return res;
  }, []);

  const verify2fa = useCallback(async (tempToken: string, code: string) => {
    const res = await api.verify2fa(tempToken, code);
    if (!res.requires_2fa) {
      setSession(res.token, res.account);
      setAccount(res.account);
    }
    return res;
  }, []);

  const setup2faVerify = useCallback(async (tempToken: string, code: string) => {
    const res = await api.setup2faVerify(tempToken, code);
    if (!res.requires_2fa) {
      setSession(res.token, res.account);
      setAccount(res.account);
    }
    return res;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // ignore network errors on logout
    }
    clearSession();
    setAccount(null);
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!getSessionToken()) return null;
    try {
      const me = await api.me();
      setSession(getSessionToken()!, me);
      setAccount(me);
      return me;
    } catch {
      clearSession();
      setAccount(null);
      return null;
    }
  }, []);

  // Periodically verify the session is still valid (every 5 minutes).
  // If the session expired due to inactivity, this logs the user out
  // and redirects them back to the login screen.
  useEffect(() => {
    if (!account) return;
    const interval = setInterval(() => {
      refreshAccount();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [account, refreshAccount]);

  return (
    <AuthContext.Provider value={{ account, loading, login, systemInit, verify2fa, setup2faVerify, logout, refreshAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
