import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "react-toastify";
import { apiFetch, onSessionLost } from "../config/api";
import {
  signInWithOAuthProvider,
  signOutFirebase,
  type OAuthProviderId,
} from "../lib/firebaseAuth";
import { subscribeSessionAccess } from "../lib/sessionAccessRealtime";

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

function modulesSignature(user: Pick<AuthUser, "role" | "modules">): string {
  return `${user.role}|${[...user.modules].sort().join(",")}`;
}

function normalizeClientModules(
  role: UserRole,
  modules: AppModuleId[],
): AppModuleId[] {
  if (role === "admin") {
    return [
      "ordenes",
      "presupuestos",
      "pami",
      "busca-turno",
      "pedidos-sistema",
      "usuarios",
    ];
  }
  const selectable = modules.filter(
    (m) =>
      m === "ordenes" ||
      m === "presupuestos" ||
      m === "pami" ||
      m === "busca-turno",
  );
  return [...new Set<AppModuleId>([...selectable, "pedidos-sistema"])];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);
  const syncingRef = useRef(false);
  const clearSessionRef = useRef<(notify: boolean) => Promise<void>>(
    async () => undefined,
  );
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const clearSession = useCallback(async (notify: boolean) => {
    const hadUser = Boolean(userRef.current);
    if (!hadUser) {
      setUser(null);
      return;
    }
    if (notify) {
      toast.warning(
        "Tu acceso fue revocado (usuario, permisos o dominio) o la sesión ya no es válida.",
      );
    }
    userRef.current = null;
    setUser(null);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    try {
      await signOutFirebase();
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const res = await apiFetch<{ ok: boolean; data: { user: AuthUser } }>(
        "/api/auth/me",
      );
      const next = res.data.user;
      const prev = userRef.current;
      if (
        prev &&
        prev.id === next.id &&
        modulesSignature(prev) === modulesSignature(next) &&
        prev.email === next.email &&
        prev.nombre === next.nombre &&
        prev.status === next.status
      ) {
        return;
      }
      if (
        prev &&
        (prev.id !== next.id || modulesSignature(prev) !== modulesSignature(next))
      ) {
        toast.info("Tus permisos se actualizaron.");
      }
      setUser(next);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        await clearSession(Boolean(userRef.current));
      } else if (!userRef.current) {
        setUser(null);
      }
    } finally {
      syncingRef.current = false;
    }
  }, [clearSession]);

  useEffect(() => {
    clearSessionRef.current = clearSession;
    refreshRef.current = refresh;
  }, [clearSession, refresh]);

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

  useEffect(() => {
    return onSessionLost(() => {
      void clearSessionRef.current(true);
    });
  }, []);

  useEffect(() => {
    if (loading || !user) return;

    let unsub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        unsub = await subscribeSessionAccess(user.id, {
          onRevoked: () => {
            if (cancelled) return;
            void clearSessionRef.current(true);
          },
          onUserUpdated: (next) => {
            if (cancelled) return;
            const prev = userRef.current;
            if (!prev || prev.id !== next.id) return;
            const modules = normalizeClientModules(next.role, next.modules);
            const merged: AuthUser = {
              ...prev,
              email: next.email,
              nombre: next.nombre || prev.nombre,
              role: next.role,
              modules,
              status: next.status,
            };
            if (
              modulesSignature(prev) === modulesSignature(merged) &&
              prev.email === merged.email &&
              prev.nombre === merged.nombre
            ) {
              return;
            }
            toast.info("Tus permisos se actualizaron.");
            setUser(merged);
          },
          onDomainsChanged: () => {
            if (cancelled) return;
            void refreshRef.current();
          },
        });
      } catch {
        // la API sigue validando en cada request
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [loading, user?.id]);

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
      if (module === "usuarios") return user.role === "admin";
      if (user.role === "admin") return true;
      if (module === "pedidos-sistema") return true;
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
