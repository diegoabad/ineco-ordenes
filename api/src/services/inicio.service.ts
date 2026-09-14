import { randomUUID } from "node:crypto";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import { sendRecordatorioEmail } from "./inicio-email.service.js";
import { getUserById, resolveApprovedUserRefs } from "./users.service.js";
import type {
  InicioItem,
  InicioItemCreateInput,
  InicioItemTipo,
  InicioItemUpdateInput,
  InicioNotaColor,
  InicioRecurrencia,
  InicioUserRef,
} from "../types.js";

const INICIO_ITEMS = "ordenes_inicio_items";
const PAST_SKEW_MS = 5_000;

const NOTA_COLORES: InicioNotaColor[] = [
  "gris",
  "amarillo",
  "verde",
  "azul",
  "rosa",
  "naranja",
];

function nowIso(): string {
  return new Date().toISOString();
}

function isTipo(value: unknown): value is InicioItemTipo {
  return value === "tarea" || value === "nota" || value === "recordatorio";
}

function isNotaColor(value: unknown): value is InicioNotaColor {
  return NOTA_COLORES.includes(value as InicioNotaColor);
}

function isRecurrencia(value: unknown): value is InicioRecurrencia {
  return (
    value === "none" ||
    value === "semanal" ||
    value === "mensual" ||
    value === "cada_n_dias"
  );
}

function parseFechaHora(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error("Fecha/hora inválida");
  return new Date(t).toISOString();
}

function assertFechaHoraFutura(fechaHora: string, label = "La fecha y hora"): void {
  const t = Date.parse(fechaHora);
  if (!Number.isFinite(t)) throw new Error("Fecha/hora inválida");
  if (t < Date.now() - PAST_SKEW_MS) {
    throw new Error(`${label} no pueden estar en el pasado`);
  }
}

function normalizeRecurrencia(
  tipo: InicioItemTipo,
  recurrenciaRaw: unknown,
  intervaloRaw: unknown,
): { recurrencia: InicioRecurrencia; intervaloDias: number | null } {
  if (tipo !== "recordatorio") {
    return { recurrencia: "none", intervaloDias: null };
  }
  const recurrencia = isRecurrencia(recurrenciaRaw) ? recurrenciaRaw : "none";
  if (recurrencia !== "cada_n_dias") {
    return { recurrencia, intervaloDias: null };
  }
  const n = Number(intervaloRaw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error("Indicá cada cuántos días (mínimo 1)");
  }
  return { recurrencia, intervaloDias: n };
}

function parseSharedWithRaw(raw: unknown): InicioUserRef[] {
  if (!Array.isArray(raw)) return [];
  const out: InicioUserRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      nombre: String(row.nombre ?? "").trim() || id,
      email: String(row.email ?? "").trim(),
    });
  }
  return out;
}

function buildParticipantIds(ownerId: string, sharedWith: InicioUserRef[]): string[] {
  const ids = [ownerId, ...sharedWith.map((u) => u.id)];
  return [...new Set(ids.filter(Boolean))];
}

async function resolveSharedWith(
  ownerId: string,
  sharedWithIds: string[] | undefined,
  tipo: InicioItemTipo,
): Promise<InicioUserRef[]> {
  if (tipo === "recordatorio") return [];
  if (!sharedWithIds || sharedWithIds.length === 0) return [];
  const wanted = [
    ...new Set(
      sharedWithIds
        .map((id) => id.trim())
        .filter(Boolean)
        .filter((id) => id !== ownerId),
    ),
  ];
  const refs = await resolveApprovedUserRefs(wanted);
  if (refs.length !== wanted.length) {
    throw new Error("Hay usuarios inválidos o no aprobados en la lista");
  }
  return refs;
}

/** Avanza una ocurrencia; si quedó en el pasado, sigue hasta una futura. */
export function nextRecordatorioFechaHora(
  iso: string,
  recurrencia: InicioRecurrencia,
  intervaloDias: number | null,
): string {
  if (recurrencia === "none") {
    throw new Error("El recordatorio no es recurrente");
  }
  const base = new Date(iso);
  if (!Number.isFinite(base.getTime())) throw new Error("Fecha/hora inválida");

  const advanceOnce = (from: Date): Date => {
    const next = new Date(from.getTime());
    if (recurrencia === "semanal") {
      next.setDate(next.getDate() + 7);
      return next;
    }
    if (recurrencia === "mensual") {
      const day = next.getDate();
      next.setMonth(next.getMonth() + 1);
      if (next.getDate() !== day) {
        next.setDate(0);
      }
      return next;
    }
    const n = Math.max(1, Math.floor(intervaloDias ?? 1));
    next.setDate(next.getDate() + n);
    return next;
  };

  let next = advanceOnce(base);
  const minMs = Date.now() - PAST_SKEW_MS;
  let guard = 0;
  while (next.getTime() < minMs && guard < 500) {
    next = advanceOnce(next);
    guard += 1;
  }
  return next.toISOString();
}

function readOrden(raw: Record<string, unknown>, creadoAt: string): number {
  const n = Number(raw.orden);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(creadoAt);
  return Number.isFinite(t) ? t : 0;
}

function readAvisos(raw: Record<string, unknown>): { avisoApp: boolean; avisoEmail: boolean } {
  if (raw.avisoApp !== undefined || raw.avisoEmail !== undefined) {
    return {
      avisoApp: Boolean(raw.avisoApp),
      avisoEmail: Boolean(raw.avisoEmail),
    };
  }
  if (raw.aviso === "email") return { avisoApp: false, avisoEmail: true };
  if (raw.aviso === "app") return { avisoApp: true, avisoEmail: false };
  return { avisoApp: true, avisoEmail: false };
}

function canAccessItem(item: InicioItem, uid: string): boolean {
  if (item.userId === uid) return true;
  return item.participantIds.includes(uid);
}

function normalizeInicioItem(id: string, raw: Record<string, unknown>): InicioItem {
  const creadoAt = String(raw.creadoAt ?? "").trim() || nowIso();
  const avisos = readAvisos(raw);
  const tipo = isTipo(raw.tipo) ? raw.tipo : "nota";
  const userId = String(raw.userId ?? "").trim();
  let recurrencia: InicioRecurrencia = "none";
  let intervaloDias: number | null = null;
  try {
    const parsed = normalizeRecurrencia(tipo, raw.recurrencia, raw.intervaloDias);
    recurrencia = parsed.recurrencia;
    intervaloDias = parsed.intervaloDias;
  } catch {
    recurrencia = "none";
    intervaloDias = null;
  }

  const sharedWith =
    tipo === "recordatorio" ? [] : parseSharedWithRaw(raw.sharedWith).filter((u) => u.id !== userId);
  const participantIdsRaw = Array.isArray(raw.participantIds)
    ? raw.participantIds.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const participantIds =
    participantIdsRaw.length > 0
      ? [...new Set([userId, ...participantIdsRaw].filter(Boolean))]
      : buildParticipantIds(userId, sharedWith);

  return {
    id,
    tipo,
    titulo: String(raw.titulo ?? "").trim(),
    detalle: String(raw.detalle ?? "").trim(),
    fechaHora: String(raw.fechaHora ?? "").trim() || null,
    hecha: Boolean(raw.hecha),
    orden: readOrden(raw, creadoAt),
    color: isNotaColor(raw.color) ? raw.color : "gris",
    avisoApp: avisos.avisoApp,
    avisoEmail: avisos.avisoEmail,
    emailEnviadoAt: String(raw.emailEnviadoAt ?? "").trim() || null,
    recurrencia,
    intervaloDias,
    pinned: Boolean(raw.pinned),
    origenTareaId: String(raw.origenTareaId ?? "").trim() || null,
    participantIds,
    sharedWith,
    ownerNombre: String(raw.ownerNombre ?? "").trim(),
    userId,
    creadoAt,
    actualizadoAt: String(raw.actualizadoAt ?? "").trim() || creadoAt,
  };
}

function sortItems(items: InicioItem[]): InicioItem[] {
  return [...items].sort((a, b) => {
    if (a.tipo === "nota" && b.tipo === "nota") {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.orden !== b.orden) return a.orden - b.orden;
      return Date.parse(b.creadoAt) - Date.parse(a.creadoAt);
    }
    if (a.tipo === "recordatorio" && b.tipo === "recordatorio") {
      const aMs = a.fechaHora ? Date.parse(a.fechaHora) : Number.POSITIVE_INFINITY;
      const bMs = b.fechaHora ? Date.parse(b.fechaHora) : Number.POSITIVE_INFINITY;
      if (aMs !== bMs) return aMs - bMs;
      return Date.parse(b.creadoAt) - Date.parse(a.creadoAt);
    }
    if (a.hecha !== b.hecha) return a.hecha ? 1 : -1;
    if (a.orden !== b.orden) return a.orden - b.orden;
    return Date.parse(b.creadoAt) - Date.parse(a.creadoAt);
  });
}

async function nextOrden(userId: string, tipo: InicioItemTipo): Promise<number> {
  const items = await listInicioItems(userId, tipo);
  const owned = items.filter((it) => it.userId === userId);
  if (owned.length === 0) return 0;
  if (tipo === "nota") {
    return Math.min(...owned.map((it) => it.orden)) - 1;
  }
  return Math.max(...owned.map((it) => it.orden)) + 1;
}

export async function listInicioItems(
  userId: string,
  tipo?: InicioItemTipo,
): Promise<InicioItem[]> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");

  const [ownedSnap, sharedSnap] = await Promise.all([
    getDocs(query(collection(firestore, INICIO_ITEMS), where("userId", "==", uid))),
    getDocs(
      query(collection(firestore, INICIO_ITEMS), where("participantIds", "array-contains", uid)),
    ),
  ]);

  const byId = new Map<string, InicioItem>();
  for (const d of ownedSnap.docs) {
    byId.set(d.id, normalizeInicioItem(d.id, d.data() as Record<string, unknown>));
  }
  for (const d of sharedSnap.docs) {
    if (!byId.has(d.id)) {
      byId.set(d.id, normalizeInicioItem(d.id, d.data() as Record<string, unknown>));
    }
  }

  let items = [...byId.values()].filter((item) => canAccessItem(item, uid));
  if (tipo) items = items.filter((item) => item.tipo === tipo);
  return sortItems(items);
}

export async function createInicioItem(
  userId: string,
  input: InicioItemCreateInput,
  ownerNombre?: string,
): Promise<InicioItem> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");
  if (!isTipo(input.tipo)) throw new Error("Tipo inválido");

  const titulo = String(input.titulo ?? "").trim();
  const detalle = String(input.detalle ?? "").trim();
  if (input.tipo !== "nota" && !titulo) {
    throw new Error("El título es obligatorio");
  }

  let fechaHora: string | null = null;
  try {
    fechaHora = parseFechaHora(input.fechaHora);
  } catch {
    throw new Error("Fecha/hora inválida");
  }

  if (input.tipo === "recordatorio") {
    if (!fechaHora) throw new Error("La fecha y hora son obligatorias en un recordatorio");
    assertFechaHoraFutura(fechaHora);
  }

  const avisoApp = input.tipo === "recordatorio" ? Boolean(input.avisoApp) : false;
  const avisoEmail = input.tipo === "recordatorio" ? Boolean(input.avisoEmail) : false;
  if (input.tipo === "recordatorio" && !avisoApp && !avisoEmail) {
    throw new Error("Elegí al menos un aviso: aplicación o mail");
  }

  const { recurrencia, intervaloDias } = normalizeRecurrencia(
    input.tipo,
    input.recurrencia ?? "none",
    input.intervaloDias,
  );

  const sharedWith = await resolveSharedWith(uid, input.sharedWithIds, input.tipo);
  const participantIds = buildParticipantIds(uid, sharedWith);

  let resolvedOwnerNombre = String(ownerNombre ?? "").trim();
  if (!resolvedOwnerNombre) {
    const owner = await getUserById(uid);
    resolvedOwnerNombre = owner?.nombre?.trim() || owner?.email || "";
  }

  const now = nowIso();
  const orden = await nextOrden(uid, input.tipo);
  const color =
    input.tipo === "nota"
      ? isNotaColor(input.color)
        ? input.color
        : "gris"
      : "gris";

  const origenTareaId =
    input.tipo === "recordatorio"
      ? String(input.origenTareaId ?? "").trim() || null
      : null;

  const item: InicioItem = {
    id: randomUUID(),
    tipo: input.tipo,
    titulo,
    detalle,
    fechaHora,
    hecha: false,
    orden,
    color,
    avisoApp,
    avisoEmail,
    emailEnviadoAt: null,
    recurrencia,
    intervaloDias,
    pinned: input.tipo === "nota" ? Boolean(input.pinned) : false,
    origenTareaId,
    participantIds,
    sharedWith,
    ownerNombre: resolvedOwnerNombre,
    userId: uid,
    creadoAt: now,
    actualizadoAt: now,
  };

  await setDoc(doc(firestore, INICIO_ITEMS, item.id), { ...item });
  return item;
}

export async function updateInicioItem(
  userId: string,
  id: string,
  input: InicioItemUpdateInput,
): Promise<InicioItem> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");

  const ref = doc(firestore, INICIO_ITEMS, id);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error("Ítem no encontrado");

  const current = normalizeInicioItem(id, existing.data() as Record<string, unknown>);
  if (!canAccessItem(current, uid)) {
    throw new Error("No tenés permiso para editar este ítem");
  }
  const isOwner = current.userId === uid;

  const next: InicioItem = { ...current, actualizadoAt: nowIso() };
  const fechaChanged = input.fechaHora !== undefined;

  if (input.titulo !== undefined) {
    if (current.tipo === "recordatorio" && current.origenTareaId) {
      // Título fijado a la tarea de origen.
    } else {
      next.titulo = String(input.titulo ?? "").trim();
    }
  }
  if (input.detalle !== undefined) {
    next.detalle = String(input.detalle ?? "").trim();
  }
  if (current.tipo !== "nota" && input.titulo !== undefined && !next.titulo) {
    throw new Error("El título es obligatorio");
  }
  if (input.fechaHora !== undefined) {
    try {
      next.fechaHora = parseFechaHora(input.fechaHora);
    } catch {
      throw new Error("Fecha/hora inválida");
    }
    if (current.tipo === "recordatorio" && !next.fechaHora) {
      throw new Error("La fecha y hora son obligatorias en un recordatorio");
    }
    if (current.tipo === "recordatorio" && next.fechaHora) {
      assertFechaHoraFutura(next.fechaHora);
      next.emailEnviadoAt = null;
    }
  }
  if (input.hecha !== undefined) {
    next.hecha = Boolean(input.hecha);
  }
  if (input.color !== undefined) {
    if (!isNotaColor(input.color)) throw new Error("Color inválido");
    next.color = input.color;
  }
  if (input.avisoApp !== undefined) next.avisoApp = Boolean(input.avisoApp);
  if (input.avisoEmail !== undefined) next.avisoEmail = Boolean(input.avisoEmail);
  if (current.tipo === "recordatorio" && !next.avisoApp && !next.avisoEmail) {
    throw new Error("Elegí al menos un aviso: aplicación o mail");
  }
  if (input.emailEnviadoAt !== undefined && !fechaChanged) {
    next.emailEnviadoAt =
      input.emailEnviadoAt == null ? null : String(input.emailEnviadoAt).trim() || null;
  }
  if (input.recurrencia !== undefined || input.intervaloDias !== undefined) {
    const parsed = normalizeRecurrencia(
      current.tipo,
      input.recurrencia ?? next.recurrencia,
      input.intervaloDias !== undefined ? input.intervaloDias : next.intervaloDias,
    );
    next.recurrencia = parsed.recurrencia;
    next.intervaloDias = parsed.intervaloDias;
  }
  if (input.pinned !== undefined) {
    next.pinned = current.tipo === "nota" ? Boolean(input.pinned) : false;
  }
  if (input.sharedWithIds !== undefined) {
    if (!isOwner) {
      throw new Error("Solo el dueño puede asignar o compartir");
    }
    if (current.tipo === "recordatorio") {
      throw new Error("Los recordatorios no se pueden compartir");
    }
    next.sharedWith = await resolveSharedWith(current.userId, input.sharedWithIds, current.tipo);
    next.participantIds = buildParticipantIds(current.userId, next.sharedWith);
  }

  await setDoc(ref, { ...next });
  return next;
}

/**
 * Acepta un recordatorio vencido.
 * - Una vez: lo elimina.
 * - Recurrente: reprograma la próxima fecha y limpia el flag de mail.
 */
export async function aceptarInicioRecordatorio(
  userId: string,
  id: string,
): Promise<{ deleted: boolean; item: InicioItem | null }> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");

  const ref = doc(firestore, INICIO_ITEMS, id);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error("Ítem no encontrado");

  const current = normalizeInicioItem(id, existing.data() as Record<string, unknown>);
  if (current.userId !== uid) throw new Error("No tenés permiso para este ítem");
  if (current.tipo !== "recordatorio") throw new Error("No es un recordatorio");

  if (current.recurrencia === "none") {
    await deleteDoc(ref);
    return { deleted: true, item: null };
  }

  if (!current.fechaHora) throw new Error("El recordatorio no tiene fecha");
  const nextFecha = nextRecordatorioFechaHora(
    current.fechaHora,
    current.recurrencia,
    current.intervaloDias,
  );
  const next: InicioItem = {
    ...current,
    fechaHora: nextFecha,
    emailEnviadoAt: null,
    actualizadoAt: nowIso(),
  };
  await setDoc(ref, { ...next });
  return { deleted: false, item: next };
}

export async function notifyInicioRecordatorioEmail(
  userId: string,
  id: string,
  userEmail: string,
  userNombre?: string,
): Promise<InicioItem> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");

  const ref = doc(firestore, INICIO_ITEMS, id);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error("Ítem no encontrado");

  const current = normalizeInicioItem(id, existing.data() as Record<string, unknown>);
  if (current.userId !== uid) throw new Error("No tenés permiso para este ítem");
  if (current.tipo !== "recordatorio") throw new Error("No es un recordatorio");
  if (!current.avisoEmail) throw new Error("Este recordatorio no avisa por mail");
  if (!current.fechaHora) throw new Error("El recordatorio no tiene fecha");
  if (current.emailEnviadoAt) return current;

  const dueMs = Date.parse(current.fechaHora);
  if (!Number.isFinite(dueMs) || dueMs > Date.now() + 15_000) {
    throw new Error("El recordatorio todavía no venció");
  }

  await sendRecordatorioEmail({
    to: userEmail,
    nombre: userNombre,
    titulo: current.titulo,
    detalle: current.detalle,
    fechaHora: current.fechaHora,
  });

  const next: InicioItem = {
    ...current,
    emailEnviadoAt: nowIso(),
    actualizadoAt: nowIso(),
  };
  await setDoc(ref, { ...next });
  return next;
}

export async function reorderInicioItems(
  userId: string,
  tipo: InicioItemTipo,
  ids: string[],
): Promise<InicioItem[]> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");
  if (!isTipo(tipo)) throw new Error("Tipo inválido");
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("Lista de orden inválida");

  const uniqueIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (uniqueIds.length !== ids.length) throw new Error("Hay ids duplicados o vacíos");

  const current = await listInicioItems(uid, tipo);
  const owned = current.filter((it) => it.userId === uid);
  if (owned.length !== uniqueIds.length) {
    throw new Error("La lista de orden no coincide con tus ítems");
  }
  const byId = new Map(owned.map((it) => [it.id, it]));
  for (const id of uniqueIds) {
    const item = byId.get(id);
    if (!item || item.tipo !== tipo || item.userId !== uid) {
      throw new Error("Ítem inválido en el orden");
    }
  }

  const now = nowIso();
  const batch = writeBatch(firestore);
  const updated: InicioItem[] = [];
  uniqueIds.forEach((id, index) => {
    const item = byId.get(id)!;
    const next: InicioItem = { ...item, orden: index, actualizadoAt: now };
    batch.set(doc(firestore, INICIO_ITEMS, id), { ...next });
    updated.push(next);
  });
  await batch.commit();

  const others = current.filter((it) => it.userId !== uid);
  return sortItems([...updated, ...others]);
}

export async function deleteInicioItem(userId: string, id: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");

  const ref = doc(firestore, INICIO_ITEMS, id);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error("Ítem no encontrado");

  const current = normalizeInicioItem(id, existing.data() as Record<string, unknown>);
  if (current.userId !== uid) {
    throw new Error("Solo el dueño puede eliminar este ítem");
  }

  await deleteDoc(ref);
}
