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
import { apiFetch, onSessionLost, onSessionRefreshNeeded } from "../config/api";
import {
  signInWithOAuthProvider,
  signOutFirebase,
  type OAuthProviderId,
} from "../lib/firebaseAuth";
import { subscribePendingUsersCount } from "../lib/pendingUsersRealtime";
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
  /** Solicitudes pendientes (solo admin; se actualiza en vivo). */
  pendingUsersCount: number;
  refreshPendingUsersCount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function modulesSignature(user: AuthUser): string {
  return `${user.role}|${[...user.modules].sort().join(",")}`;
}

function applyPendingCount(
  count: number,
  prevRef: { current: number | null },
  setCount: (n: number) => void,
  notifyIncrease: boolean,
): void {
  const prev = prevRef.current;
  if (prev === count) return;
  if (notifyIncrease && prev !== null && count > prev) {
    const delta = count - prev;
    toast.info(
      delta === 1
        ? "Hay una nueva solicitud de acceso pendiente"
        : `Hay ${delta} solicitudes de acceso nuevas`,
    );
  }
  prevRef.current = count;
  setCount(count);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingUsersCount, setPendingUsersCount] = useState(0);
  const userRef = useRef<AuthUser | null>(null);
  const syncingRef = useRef(false);
  const prevPendingRef = useRef<number | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const clearSession = useCallback(async (notify: boolean) => {
    const hadUser = Boolean(userRef.current);
    if (!hadUser) {
      setUser(null);
      setPendingUsersCount(0);
      return;
    }
    if (notify) {
      toast.warning(
        "Tu acceso fue revocado (usuario, permisos o dominio) o la sesión ya no es válida.",
      );
    }
    userRef.current = null;
    setUser(null);
    setPendingUsersCount(0);
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

  const refreshPendingUsersCount = useCallback(async () => {
    const current = userRef.current;
    if (!current || current.role !== "admin") {
      setPendingUsersCount(0);
      prevPendingRef.current = 0;
      return;
    }
    try {
      const res = await apiFetch<{ ok: boolean; data: AuthUser[] }>(
        "/api/usuarios?status=pending",
      );
      applyPendingCount(
        res.data.length,
        prevPendingRef,
        setPendingUsersCount,
        false,
      );
    } catch {
      // ignore
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

  // Si cualquier request autenticado responde 401 → cerrar sesión en UI
  useEffect(() => {
    return onSessionLost(() => {
      void clearSession(true);
    });
  }, [clearSession]);

  // 403 → revalidar permisos/dominio al toque
  useEffect(() => {
    return onSessionRefreshNeeded(() => {
      void refresh();
    });
  }, [refresh]);

  // Acceso en tiempo real: borrado, rechazo, cambio de permisos o dominios
  useEffect(() => {
    if (loading || !user) return;

    let unsub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        unsub = await subscribeSessionAccess(user.id, {
          onRevoked: () => {
            if (cancelled) return;
            void clearSession(true);
          },
          onUserUpdated: () => {
            if (cancelled) return;
            void refresh();
          },
          onDomainsChanged: () => {
            if (cancelled) return;
            void refresh();
          },
        });
      } catch {
        // El poll de /me sigue como respaldo
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
    // Solo re-suscribir si cambia el usuario logueado (no en cada refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh/clearSession estables en la práctica; evitar churn
  }, [loading, user?.id]);

  // Pendientes en tiempo real (Firestore) para admins
  useEffect(() => {
    if (loading || !user || user.role !== "admin") {
      setPendingUsersCount(0);
      prevPendingRef.current = 0;
      return;
    }

    let unsub: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        unsub = await subscribePendingUsersCount(
          (count) => {
            if (cancelled) return;
            applyPendingCount(
              count,
              prevPendingRef,
              setPendingUsersCount,
              true,
            );
          },
          () => {
            // Fallback si el listener falla
            if (!cancelled) void refreshPendingUsersCount();
          },
        );
      } catch {
        if (!cancelled) void refreshPendingUsersCount();
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [loading, user?.id, user?.role, refreshPendingUsersCount]);

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
      setPendingUsersCount(0);
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
      pendingUsersCount,
      refreshPendingUsersCount,
    }),
    [
      user,
      loading,
      loginWithProvider,
      logout,
      refresh,
      canAccessModule,
      pendingUsersCount,
      refreshPendingUsersCount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
