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
import { useAuth } from "./AuthContext";
import { apiFetch } from "../config/api";
import { subscribePedidosPendientesCount } from "../lib/pedidosPendientesRealtime";

type PedidosPendientesValue = {
  pedidosPendientesCount: number;
};

const PedidosPendientesContext = createContext<PedidosPendientesValue | null>(null);

export function PedidosPendientesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pedidosPendientesCount, setPedidosPendientesCount] = useState(0);
  const prevRef = useRef<number | null>(null);
  const dueno = user?.sistemas === true;

  const refresh = useCallback(async () => {
    if (!dueno) {
      prevRef.current = 0;
      setPedidosPendientesCount(0);
      return;
    }
    try {
      const res = await apiFetch<{ ok: boolean; data: { count: number } }>(
        "/api/pedidos-sistema/pendientes-count",
      );
      const count = res.data.count;
      if (prevRef.current === count) return;
      prevRef.current = count;
      setPedidosPendientesCount(count);
    } catch {
      // ignore
    }
  }, [dueno]);

  useEffect(() => {
    if (!dueno) {
      prevRef.current = 0;
      setPedidosPendientesCount(0);
      return;
    }

    let unsub: (() => void) | undefined;
    let cancelled = false;
    void refresh();

    void (async () => {
      try {
        unsub = await subscribePedidosPendientesCount(
          (count) => {
            if (cancelled || prevRef.current === count) return;
            prevRef.current = count;
            setPedidosPendientesCount(count);
          },
          () => {
            if (!cancelled) void refresh();
          },
        );
      } catch {
        if (!cancelled) void refresh();
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [dueno, user?.id, refresh]);

  const value = useMemo(
    () => ({ pedidosPendientesCount }),
    [pedidosPendientesCount],
  );

  return (
    <PedidosPendientesContext.Provider value={value}>
      {children}
    </PedidosPendientesContext.Provider>
  );
}

export function usePedidosPendientes(): PedidosPendientesValue {
  const ctx = useContext(PedidosPendientesContext);
  if (!ctx) return { pedidosPendientesCount: 0 };
  return ctx;
}
