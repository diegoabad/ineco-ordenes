import {
  doc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { AuthUser, AppModuleId, UserRole, UserStatus } from "../auth/AuthContext";
import { ensureFirebase } from "./firebaseAuth";

const USUARIOS = "ordenes_usuarios";
const CONFIG = "ordenes_config";
const AUTH_CONFIG_DOC = "auth";

function isModuleId(value: unknown): value is AppModuleId {
  return (
    value === "ordenes" ||
    value === "presupuestos" ||
    value === "pami" ||
    value === "busca-turno" ||
    value === "pedidos-sistema" ||
    value === "usuarios"
  );
}

function mapUserDoc(id: string, raw: Record<string, unknown>): AuthUser | null {
  const status = raw.status;
  if (status !== "approved" && status !== "pending" && status !== "rejected") {
    return null;
  }
  const role: UserRole = raw.role === "admin" ? "admin" : "user";
  const modules = Array.isArray(raw.modules)
    ? raw.modules.filter(isModuleId)
    : [];
  return {
    id,
    email: String(raw.email ?? "").trim().toLowerCase(),
    nombre: String(raw.nombre ?? "").trim(),
    role,
    modules,
    status: status as UserStatus,
    creadoAt: String(raw.creadoAt ?? ""),
    actualizadoAt: String(raw.actualizadoAt ?? ""),
    aprobadoAt: raw.aprobadoAt ? String(raw.aprobadoAt) : null,
    rechazadoAt: raw.rechazadoAt ? String(raw.rechazadoAt) : null,
  };
}

export type SessionAccessHandlers = {
  /** Usuario eliminado, rechazado, pendiente o sin email válido. */
  onRevoked: () => void;
  /** Cambió role/modules/email/nombre estando aprobado. */
  onUserUpdated: (user: AuthUser) => void;
  /** Cambió la lista de dominios → revalidar vía /me. */
  onDomainsChanged: () => void;
};

/**
 * Escucha el doc del usuario logueado + config de dominios.
 * Así un corte urgente (borrar, rechazar, quitar dominio/permisos) impacta al toque.
 */
export async function subscribeSessionAccess(
  userId: string,
  handlers: SessionAccessHandlers,
): Promise<() => void> {
  const { firestore } = await ensureFirebase();
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      doc(firestore, USUARIOS, userId),
      (snap) => {
        if (!snap.exists()) {
          handlers.onRevoked();
          return;
        }
        const mapped = mapUserDoc(snap.id, snap.data() as Record<string, unknown>);
        if (!mapped || mapped.status !== "approved" || !mapped.email.includes("@")) {
          handlers.onRevoked();
          return;
        }
        handlers.onUserUpdated(mapped);
      },
      () => {
        // Si falla el listener, el poll de /me sigue como respaldo
      },
    ),
  );

  unsubs.push(
    onSnapshot(
      doc(firestore, CONFIG, AUTH_CONFIG_DOC),
      () => {
        handlers.onDomainsChanged();
      },
      () => {
        // ignore
      },
    ),
  );

  return () => {
    for (const u of unsubs) u();
  };
}
