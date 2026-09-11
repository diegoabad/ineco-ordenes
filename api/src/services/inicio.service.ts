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
import type {
  InicioItem,
  InicioItemCreateInput,
  InicioItemTipo,
  InicioItemUpdateInput,
  InicioNotaColor,
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
  // Compat con documentos viejos (aviso: app|email).
  if (raw.aviso === "email") return { avisoApp: false, avisoEmail: true };
  if (raw.aviso === "app") return { avisoApp: true, avisoEmail: false };
  return { avisoApp: true, avisoEmail: false };
}

function normalizeInicioItem(id: string, raw: Record<string, unknown>): InicioItem {
  const creadoAt = String(raw.creadoAt ?? "").trim() || nowIso();
  const avisos = readAvisos(raw);
  return {
    id,
    tipo: isTipo(raw.tipo) ? raw.tipo : "nota",
    titulo: String(raw.titulo ?? "").trim(),
    detalle: String(raw.detalle ?? "").trim(),
    fechaHora: String(raw.fechaHora ?? "").trim() || null,
    hecha: Boolean(raw.hecha),
    orden: readOrden(raw, creadoAt),
    color: isNotaColor(raw.color) ? raw.color : "gris",
    avisoApp: avisos.avisoApp,
    avisoEmail: avisos.avisoEmail,
    emailEnviadoAt: String(raw.emailEnviadoAt ?? "").trim() || null,
    pinned: Boolean(raw.pinned),
    origenTareaId: String(raw.origenTareaId ?? "").trim() || null,
    userId: String(raw.userId ?? "").trim(),
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
  if (items.length === 0) return 0;
  if (tipo === "nota") {
    return Math.min(...items.map((it) => it.orden)) - 1;
  }
  return Math.max(...items.map((it) => it.orden)) + 1;
}

export async function listInicioItems(
  userId: string,
  tipo?: InicioItemTipo,
): Promise<InicioItem[]> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");

  const snap = await getDocs(
    query(collection(firestore, INICIO_ITEMS), where("userId", "==", uid)),
  );
  let items = snap.docs.map((d) =>
    normalizeInicioItem(d.id, d.data() as Record<string, unknown>),
  );
  if (tipo) items = items.filter((item) => item.tipo === tipo);
  return sortItems(items);
}

export async function createInicioItem(
  userId: string,
  input: InicioItemCreateInput,
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
    pinned: input.tipo === "nota" ? Boolean(input.pinned) : false,
    origenTareaId,
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
  if (current.userId !== uid) throw new Error("No tenés permiso para editar este ítem");

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
  if (input.pinned !== undefined) {
    next.pinned = current.tipo === "nota" ? Boolean(input.pinned) : false;
  }

  await setDoc(ref, { ...next });
  return next;
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
  if (current.length !== uniqueIds.length) {
    throw new Error("La lista de orden no coincide con tus ítems");
  }
  const byId = new Map(current.map((it) => [it.id, it]));
  for (const id of uniqueIds) {
    const item = byId.get(id);
    if (!item || item.tipo !== tipo) throw new Error("Ítem inválido en el orden");
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
  return updated;
}

export async function deleteInicioItem(userId: string, id: string): Promise<void> {
  const uid = userId.trim();
  if (!uid) throw new Error("Usuario inválido");

  const ref = doc(firestore, INICIO_ITEMS, id);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error("Ítem no encontrado");

  const current = normalizeInicioItem(id, existing.data() as Record<string, unknown>);
  if (current.userId !== uid) throw new Error("No tenés permiso para eliminar este ítem");

  await deleteDoc(ref);
}
