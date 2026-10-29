import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

export type WaCoberturaGrupoEtario = "infanto" | "adulto";

export type WaCobertura = {
  id: string;
  nombre: string;
  gruposEtarios: WaCoberturaGrupoEtario[];
  createdAt: string;
  updatedAt: string;
};

const COBERTURAS_DOC = doc(firestore, "ordenes_config", "whatsapp_coberturas");

/** Debe coincidir con las etiquetas del grupo «Coberturas». */
const DEFAULT_SEED: Array<{
  nombre: string;
  gruposEtarios: WaCoberturaGrupoEtario[];
}> = [
  { nombre: "IOMA", gruposEtarios: ["adulto"] },
  { nombre: "OS no soportada", gruposEtarios: ["adulto", "infanto"] },
  { nombre: "OSPIS", gruposEtarios: ["adulto", "infanto"] },
  { nombre: "Particular", gruposEtarios: ["adulto", "infanto"] },
  { nombre: "Prevención", gruposEtarios: ["adulto", "infanto"] },
  { nombre: "Swiss Medical", gruposEtarios: ["adulto"] },
];

function normalizeGrupos(raw: unknown): WaCoberturaGrupoEtario[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: WaCoberturaGrupoEtario[] = [];
  for (const item of list) {
    const value = String(item ?? "").trim().toLowerCase();
    if (value === "infanto" || value === "adulto") {
      if (!out.includes(value)) out.push(value);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function normalizeItem(raw: unknown): WaCobertura | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const nombre = String(row.nombre ?? row.name ?? "").trim();
  const gruposEtarios = normalizeGrupos(row.gruposEtarios);
  if (!id || !nombre || gruposEtarios.length === 0) return null;
  return {
    id,
    nombre,
    gruposEtarios,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function sortByNombre(items: WaCobertura[]): WaCobertura[] {
  return items.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

async function writeAll(items: WaCobertura[]): Promise<void> {
  await setDoc(
    COBERTURAS_DOC,
    { items, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

async function seedDefaults(): Promise<WaCobertura[]> {
  const now = new Date().toISOString();
  const items = DEFAULT_SEED.map((row) => ({
    id: randomUUID(),
    nombre: row.nombre,
    gruposEtarios: [...row.gruposEtarios].sort((a, b) => a.localeCompare(b)),
    createdAt: now,
    updatedAt: now,
  }));
  await writeAll(items);
  return sortByNombre(items);
}

async function readAll(): Promise<WaCobertura[]> {
  const snap = await getDoc(COBERTURAS_DOC);
  if (!snap.exists()) {
    return seedDefaults();
  }
  const raw = snap.data()?.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    return seedDefaults();
  }
  return sortByNombre(
    raw.map(normalizeItem).filter((item): item is WaCobertura => item !== null),
  );
}

export async function listWhatsappCoberturas(grupoEtario?: string | null): Promise<WaCobertura[]> {
  const items = await readAll();
  const grupo = String(grupoEtario ?? "").trim().toLowerCase();
  if (grupo !== "infanto" && grupo !== "adulto") return items;
  return items.filter((item) => item.gruposEtarios.includes(grupo));
}

function sinTildesCobertura(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Traduce texto libre / alias al nombre canónico de la ficha
 * (alineado con etiquetas del grupo Coberturas).
 */
export async function resolverCoberturaParaFicha(texto: string): Promise<string> {
  const crudo = String(texto ?? "").trim();
  if (!crudo) return "";
  const buscado = sinTildesCobertura(crudo);
  const items = await readAll();
  const pick = (...claves: string[]) =>
    items.find((item) => claves.includes(sinTildesCobertura(item.nombre)))?.nombre || "";

  if (
    /\bparticular\b/.test(buscado) ||
    buscado === "sin cobertura" ||
    buscado === "sin obra social" ||
    buscado === "sin prepaga"
  ) {
    return pick("particular") || "Particular";
  }
  if (
    buscado === "os no soportada" ||
    buscado === "no soportada" ||
    buscado === "sin convenio"
  ) {
    return pick("os no soportada") || "OS no soportada";
  }
  const exacto = items.find((item) => sinTildesCobertura(item.nombre) === buscado);
  if (exacto) return exacto.nombre;
  if (/prevencion/.test(buscado)) {
    return pick("prevencion") || crudo;
  }
  if (/swiss|\bsmg\b/.test(buscado)) {
    return pick("swiss medical", "smg") || crudo;
  }
  const parcial = items
    .filter((item) => {
      const n = sinTildesCobertura(item.nombre);
      return n.length >= 3 && (buscado.includes(n) || n.includes(buscado));
    })
    .sort((a, b) => b.nombre.length - a.nombre.length)[0];
  return parcial?.nombre || crudo;
}

export async function createWhatsappCobertura(input: {
  nombre: string;
  gruposEtarios: unknown;
}): Promise<WaCobertura> {
  const nombre = String(input.nombre ?? "").trim();
  const gruposEtarios = normalizeGrupos(input.gruposEtarios);
  if (!nombre) throw new Error("Ingresá un nombre");
  if (gruposEtarios.length === 0) {
    throw new Error("Elegí al menos un grupo etario (Infanto o Adulto)");
  }
  const items = await readAll();
  if (items.some((item) => item.nombre.toLowerCase() === nombre.toLowerCase())) {
    throw new Error("Ya existe una cobertura con ese nombre");
  }
  const now = new Date().toISOString();
  const created: WaCobertura = {
    id: randomUUID(),
    nombre,
    gruposEtarios,
    createdAt: now,
    updatedAt: now,
  };
  await writeAll([...items, created]);
  return created;
}

export async function updateWhatsappCobertura(
  id: string,
  input: { nombre?: string; gruposEtarios?: unknown },
): Promise<WaCobertura> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Cobertura no encontrada");
  const current = items[index]!;
  const nombre =
    input.nombre !== undefined ? String(input.nombre).trim() : current.nombre;
  const gruposEtarios =
    input.gruposEtarios !== undefined
      ? normalizeGrupos(input.gruposEtarios)
      : current.gruposEtarios;
  if (!nombre) throw new Error("Ingresá un nombre");
  if (gruposEtarios.length === 0) {
    throw new Error("Elegí al menos un grupo etario (Infanto o Adulto)");
  }
  if (
    items.some(
      (item) => item.id !== id && item.nombre.toLowerCase() === nombre.toLowerCase(),
    )
  ) {
    throw new Error("Ya existe una cobertura con ese nombre");
  }
  const next: WaCobertura = {
    ...current,
    nombre,
    gruposEtarios,
    updatedAt: new Date().toISOString(),
  };
  const copy = [...items];
  copy[index] = next;
  await writeAll(copy);
  return next;
}

export async function deleteWhatsappCobertura(id: string): Promise<void> {
  const items = await readAll();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) throw new Error("Cobertura no encontrada");
  await writeAll(next);
}
