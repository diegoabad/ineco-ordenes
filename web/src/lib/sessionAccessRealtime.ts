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

/** Solo lo que afecta acceso (ignora timestamps / ruido de snapshot). */
function accessSignature(user: AuthUser): string {
  return [
    user.status,
    user.role,
    user.email,
    [...user.modules].sort().join(","),
  ].join("|");
}

function domainsSignature(raw: Record<string, unknown> | undefined): string {
  const list = Array.isArray(raw?.allowedDomains)
    ? raw.allowedDomains.map((d) => String(d).trim().toLowerCase()).sort()
    : [];
  return list.join(",");
}

export type SessionAccessHandlers = {
  /** Usuario eliminado, rechazado, pendiente o sin email válido. */
  onRevoked: () => void;
  /** Cambió role/modules/email/status estando aprobado. */
  onUserUpdated: (user: AuthUser) => void;
  /** Cambió la lista de dominios → revalidar vía /me. */
  onDomainsChanged: () => void;
};

/**
 * Escucha el doc del usuario logueado + config de dominios.
 * Solo notifica cuando cambia algo relevante (evita “recargas” por snapshots repetidos).
 */
export async function subscribeSessionAccess(
  userId: string,
  handlers: SessionAccessHandlers,
): Promise<() => void> {
  const { firestore } = await ensureFirebase();
  const unsubs: Unsubscribe[] = [];

  let lastUserSig: string | null = null;
  let lastDomainsSig: string | null = null;
  let revoked = false;

  unsubs.push(
    onSnapshot(
      doc(firestore, USUARIOS, userId),
      (snap) => {
        if (!snap.exists()) {
          if (!revoked) {
            revoked = true;
            handlers.onRevoked();
          }
          return;
        }
        const mapped = mapUserDoc(snap.id, snap.data() as Record<string, unknown>);
        if (!mapped || mapped.status !== "approved" || !mapped.email.includes("@")) {
          if (!revoked) {
            revoked = true;
            handlers.onRevoked();
          }
          return;
        }
        revoked = false;
        const sig = accessSignature(mapped);
        if (sig === lastUserSig) return;
        const isFirst = lastUserSig === null;
        lastUserSig = sig;
        if (isFirst) return;
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
      (snap) => {
        const sig = domainsSignature(
          snap.exists() ? (snap.data() as Record<string, unknown>) : undefined,
        );
        if (sig === lastDomainsSig) return;
        const isFirst = lastDomainsSig === null;
        lastDomainsSig = sig;
        if (isFirst) return;
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
