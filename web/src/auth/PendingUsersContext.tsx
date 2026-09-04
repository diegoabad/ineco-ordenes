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
import { useAuth, type AuthUser } from "./AuthContext";
import { apiFetch } from "../config/api";
import { subscribePendingUsersCount } from "../lib/pendingUsersRealtime";

type PendingUsersContextValue = {
  pendingUsersCount: number;
  refreshPendingUsersCount: () => Promise<void>;
};

const PendingUsersContext = createContext<PendingUsersContextValue | null>(null);

/**
 * Contador de pendientes aislado: actualiza badge/lista sin re-renderizar
 * toda la app ni recargar el módulo donde está el usuario.
 */
export function PendingUsersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pendingUsersCount, setPendingUsersCount] = useState(0);
  const prevPendingRef = useRef<number | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

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
      const count = res.data.length;
      if (prevPendingRef.current === count) return;
      prevPendingRef.current = count;
      setPendingUsersCount(count);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== "admin") {
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
            const prev = prevPendingRef.current;
            if (prev === count) return;
            if (prev !== null && count > prev) {
              const delta = count - prev;
              toast.info(
                delta === 1
                  ? "Hay una nueva solicitud de acceso pendiente"
                  : `Hay ${delta} solicitudes de acceso nuevas`,
              );
            }
            prevPendingRef.current = count;
            setPendingUsersCount(count);
          },
          () => {
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
  }, [user?.id, user?.role, refreshPendingUsersCount]);

  const value = useMemo(
    () => ({ pendingUsersCount, refreshPendingUsersCount }),
    [pendingUsersCount, refreshPendingUsersCount],
  );

  return (
    <PendingUsersContext.Provider value={value}>
      {children}
    </PendingUsersContext.Provider>
  );
}

export function usePendingUsers(): PendingUsersContextValue {
  const ctx = useContext(PendingUsersContext);
  if (!ctx) {
    return { pendingUsersCount: 0, refreshPendingUsersCount: async () => undefined };
  }
  return ctx;
}
