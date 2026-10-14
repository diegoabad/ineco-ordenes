import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

export type WaIntencion = {
  id: string;
  nombre: string;
  clave: string;
  descripcion: string;
  /** Si true, es la intención de riesgo/protocolo especial. */
  esRiesgo: boolean;
  /** Mensaje a usar cuando se activa el protocolo de riesgo. */
  mensajeRiesgo: string;
  createdAt: string;
  updatedAt: string;
};

const DOC = doc(firestore, "ordenes_config", "whatsapp_intenciones");

/** Clave estable en MAYUSCULAS_CON_GUION_BAJO. */
export function normalizeClave(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function normalizeItem(raw: unknown): WaIntencion | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const nombre = String(row.nombre ?? row.name ?? "").trim();
  const claveRaw = String(row.clave ?? row.key ?? row.slug ?? "").trim();
  const clave = normalizeClave(claveRaw || nombre);
  if (!id || !nombre || !clave) return null;
  const prioridad = String(row.prioridad ?? "").trim().toUpperCase();
  const esRiesgo =
    row.esRiesgo === true || prioridad === "CRITICA" || prioridad === "RIESGO";
  return {
    id,
    nombre,
    clave,
    descripcion: String(row.descripcion ?? row.description ?? "").trim(),
    esRiesgo,
    mensajeRiesgo: String(row.mensajeRiesgo ?? "").trim(),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

async function readAll(): Promise<WaIntencion[]> {
  const snap = await getDoc(DOC);
  const raw = snap.exists() ? snap.data()?.items : [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeItem)
    .filter((item): item is WaIntencion => item !== null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

async function writeAll(items: WaIntencion[]): Promise<void> {
  await setDoc(DOC, { items, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function listIntenciones(): Promise<WaIntencion[]> {
  return readAll();
}

export async function createIntencion(input: {
  nombre: string;
  clave?: string;
  descripcion?: string;
  esRiesgo?: boolean;
  mensajeRiesgo?: string;
}): Promise<WaIntencion> {
  const nombre = String(input.nombre ?? "").trim();
  const clave = normalizeClave(String(input.clave ?? nombre));
  const descripcion = String(input.descripcion ?? "").trim();
  const esRiesgo = input.esRiesgo === true;
  const mensajeRiesgo = String(input.mensajeRiesgo ?? "").trim();
  if (!nombre) throw new Error("Ingresá un nombre para la intención");
  if (!clave) throw new Error("Ingresá una clave para la intención");
  if (esRiesgo && !mensajeRiesgo) {
    throw new Error("Ingresá el mensaje de riesgo");
  }
  let items = await readAll();
  if (items.some((item) => item.clave === clave)) {
    throw new Error("Ya existe una intención con esa clave");
  }
  if (esRiesgo) {
    items = items.map((item) => ({ ...item, esRiesgo: false }));
  }
  const now = new Date().toISOString();
  const created: WaIntencion = {
    id: randomUUID(),
    nombre,
    clave,
    descripcion,
    esRiesgo,
    mensajeRiesgo: esRiesgo ? mensajeRiesgo : "",
    createdAt: now,
    updatedAt: now,
  };
  await writeAll([...items, created]);
  return created;
}

export async function updateIntencion(
  id: string,
  input: {
    nombre?: string;
    clave?: string;
    descripcion?: string;
    esRiesgo?: boolean;
    mensajeRiesgo?: string;
  },
): Promise<WaIntencion> {
  let items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Intención no encontrada");
  const current = items[index]!;
  const nombre =
    input.nombre !== undefined ? String(input.nombre).trim() : current.nombre;
  const clave =
    input.clave !== undefined ? normalizeClave(String(input.clave)) : current.clave;
  const esRiesgo =
    input.esRiesgo !== undefined ? input.esRiesgo === true : current.esRiesgo;
  const mensajeRiesgo =
    input.mensajeRiesgo !== undefined
      ? String(input.mensajeRiesgo).trim()
      : current.mensajeRiesgo;
  if (!nombre) throw new Error("Ingresá un nombre para la intención");
  if (!clave) throw new Error("Ingresá una clave para la intención");
  if (esRiesgo && !mensajeRiesgo) {
    throw new Error("Ingresá el mensaje de riesgo");
  }
  if (items.some((item) => item.id !== id && item.clave === clave)) {
    throw new Error("Ya existe una intención con esa clave");
  }
  if (esRiesgo) {
    items = items.map((item) =>
      item.id === id ? item : { ...item, esRiesgo: false },
    );
  }
  const updated: WaIntencion = {
    ...current,
    nombre,
    clave,
    descripcion:
      input.descripcion !== undefined
        ? String(input.descripcion).trim()
        : current.descripcion,
    esRiesgo,
    mensajeRiesgo: esRiesgo ? mensajeRiesgo : "",
    updatedAt: new Date().toISOString(),
  };
  const next = [...items];
  const idx = next.findIndex((item) => item.id === id);
  next[idx] = updated;
  await writeAll(next);
  return updated;
}

export async function deleteIntencion(id: string): Promise<void> {
  const items = await readAll();
  if (!items.some((item) => item.id === id)) {
    throw new Error("Intención no encontrada");
  }
  await writeAll(items.filter((item) => item.id !== id));
}
