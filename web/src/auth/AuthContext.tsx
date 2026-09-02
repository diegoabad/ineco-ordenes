import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "../config/api";
import {
  signInWithOAuthProvider,
  signOutFirebase,
  type OAuthProviderId,
} from "../lib/firebaseAuth";

export type AppModuleId =
  | "ordenes"
  | "presupuestos"
  | "pami"
  | "busca-turno"
  | "pedidos-sistema"
  | "usuarios";
export type UserRole = "user" | "admin";
export type UserStatus = "pending" | "approved" | "rejected";

export type AuthUser = {
  id: string;
  email: string;
  nombre: string;
  role: UserRole;
  modules: AppModuleId[];
  status: UserStatus;
  creadoAt: string;
  actualizadoAt: string;
  aprobadoAt?: string | null;
  rechazadoAt?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  loginWithProvider: (provider: OAuthProviderId) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  canAccessModule: (module: AppModuleId) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch<{ ok: boolean; data: { user: AuthUser } }>(
        "/api/auth/me",
      );
      setUser(res.data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ ok: boolean; data: { user: AuthUser } }>(
          "/api/auth/me",
        );
        if (!cancelled) setUser(res.data.user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loginWithProvider = useCallback(async (provider: OAuthProviderId) => {
    const idToken = await signInWithOAuthProvider(provider);
    try {
      const res = await apiFetch<{ ok: boolean; data: { user: AuthUser } }>(
        "/api/auth/oauth",
        {
          method: "POST",
          body: JSON.stringify({ idToken }),
        },
      );
      setUser(res.data.user);
    } catch (err) {
      await signOutFirebase();
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      await signOutFirebase();
      setUser(null);
    }
  }, []);

  const canAccessModule = useCallback(
    (module: AppModuleId) => {
      if (!user) return false;
      if (user.role === "admin") return true;
      return user.modules.includes(module);
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      loginWithProvider,
      logout,
      refresh,
      canAccessModule,
    }),
    [user, loading, loginWithProvider, logout, refresh, canAccessModule],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
