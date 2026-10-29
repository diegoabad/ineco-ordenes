import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import { syncProfesionalTags } from "./tags.js";

export type WaDerivacionRegla = {
  id: string;
  /** Texto visible (ej. FERNANDEZ BOCCAZZI JULIAN). */
  profesionalNombre: string;
  /** Token de match (apellido sin tildes), ej. boccazzi. */
  profesionalClave: string;
  recepcionistaNombre: string;
};

export type WaDerivacionConfig = {
  defaultRecepcionista: string;
  reglas: WaDerivacionRegla[];
  updatedAt: string;
};

const DOC = doc(firestore, "ordenes_config", "whatsapp_derivacion_turno");

export const DERIVACION_DEFAULT_RECEPCIONISTA = "Florencia Sosa";

const SEED_REGLAS: Array<{
  profesionalNombre: string;
  profesionalClave: string;
  recepcionistaNombre: string;
}> = [
  // Rodrigo Olmos
  { profesionalNombre: "DORMAN GUIDO SANTIAGO", profesionalClave: "dorman", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "FERNANDEZ BOCCAZZI JULIAN", profesionalClave: "boccazzi", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "CHOCOBAR NICOLÁS ESTEBAN", profesionalClave: "chocobar", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "ESCOBAR JOSEFINA GISELE", profesionalClave: "escobar", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "YEZZI JOSE SEBASTIAN", profesionalClave: "yezzi", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "CHADE ANABEL", profesionalClave: "chade", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "COUTO BLAS", profesionalClave: "couto", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "POSE MARIANGELES", profesionalClave: "pose", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "PATRONE LEANDRO RUBÉN", profesionalClave: "patrone", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "WOLFSDORF BAIGORRIA MARIA INES", profesionalClave: "wolfsdorf", recepcionistaNombre: "Rodrigo Olmos" },
  { profesionalNombre: "THOMSON ALEJANDRO", profesionalClave: "thomson", recepcionistaNombre: "Rodrigo Olmos" },
  // Yanet Cardoso
  { profesionalNombre: "SALMERON DELFINA", profesionalClave: "salmeron", recepcionistaNombre: "Yanet Cardoso" },
  { profesionalNombre: "GARRIDO MARIANO LUIS", profesionalClave: "garrido", recepcionistaNombre: "Yanet Cardoso" },
  { profesionalNombre: "BAMONDEZ PALOMA", profesionalClave: "bamondez", recepcionistaNombre: "Yanet Cardoso" },
  { profesionalNombre: "COZZARIN LINDA GISELE", profesionalClave: "cozzarin", recepcionistaNombre: "Yanet Cardoso" },
  { profesionalNombre: "BEA GONZALO NICOLAS", profesionalClave: "bea", recepcionistaNombre: "Yanet Cardoso" },
  { profesionalNombre: "CETKOVICH MARCELO GUSTAVO", profesionalClave: "cetkovich", recepcionistaNombre: "Yanet Cardoso" },
  { profesionalNombre: "KES MARIANA", profesionalClave: "kes", recepcionistaNombre: "Yanet Cardoso" },
  // Mauro Caltagirone
  { profesionalNombre: "NIEVA JULIANA", profesionalClave: "nieva", recepcionistaNombre: "Mauro Caltagirone" },
  { profesionalNombre: "GAYUBO MARIA FLORENCIA", profesionalClave: "gayubo", recepcionistaNombre: "Mauro Caltagirone" },
  { profesionalNombre: "ABDALA JULIETA", profesionalClave: "abdala", recepcionistaNombre: "Mauro Caltagirone" },
  { profesionalNombre: "MAENZA LUCAS", profesionalClave: "maenza", recepcionistaNombre: "Mauro Caltagirone" },
];

function sinTildes(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

function escapeRe(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeClave(raw: string): string {
  return sinTildes(raw)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)[0] || "";
}

/** Misma persona (nombre completo o apellido, incluido bocazzi/boccazzi) cuenta una sola vez. */
function dedupeReglas(reglas: WaDerivacionRegla[]): WaDerivacionRegla[] {
  const out: WaDerivacionRegla[] = [];
  const nombres = new Set<string>();
  const claves = new Set<string>();
  for (const regla of reglas) {
    const nombre = sinTildes(regla.profesionalNombre).replace(/\s+/g, " ").trim();
    const eqs = clavesEquivalentes(regla.profesionalClave);
    if (!nombre || nombres.has(nombre) || eqs.some((clave) => claves.has(clave))) continue;
    nombres.add(nombre);
    for (const clave of eqs) claves.add(clave);
    out.push(regla);
  }
  return out;
}

async function syncTagsDeReglas(reglas: WaDerivacionRegla[]): Promise<void> {
  try {
    await syncProfesionalTags(
      reglas.map((regla) => ({
        nombre: regla.profesionalNombre,
        claves: clavesEquivalentes(regla.profesionalClave),
      })),
    );
  } catch (error) {
    console.warn(
      "[derivacion] etiquetas de profesionales",
      error instanceof Error ? error.message : error,
    );
  }
}

function normalizeRegla(raw: unknown): WaDerivacionRegla | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim() || randomUUID();
  const profesionalNombre = String(row.profesionalNombre ?? "").trim();
  let profesionalClave = normalizeClave(String(row.profesionalClave ?? ""));
  if (!profesionalClave && profesionalNombre) {
    const parts = sinTildes(profesionalNombre).split(/\s+/).filter((p) => p.length >= 3);
    profesionalClave = parts[0] || "";
  }
  const recepcionistaNombre = String(row.recepcionistaNombre ?? "").trim();
  if (!profesionalNombre || !profesionalClave || !recepcionistaNombre) return null;
  return { id, profesionalNombre, profesionalClave, recepcionistaNombre };
}

function seedConfig(): WaDerivacionConfig {
  const now = new Date().toISOString();
  return {
    defaultRecepcionista: DERIVACION_DEFAULT_RECEPCIONISTA,
    reglas: SEED_REGLAS.map((row) => ({
      id: randomUUID(),
      ...row,
      profesionalClave: normalizeClave(row.profesionalClave),
    })),
    updatedAt: now,
  };
}

function normalizeConfig(raw: unknown): WaDerivacionConfig {
  if (!raw || typeof raw !== "object") return seedConfig();
  const row = raw as Record<string, unknown>;
  const defaultRecepcionista =
    String(row.defaultRecepcionista ?? "").trim() || DERIVACION_DEFAULT_RECEPCIONISTA;
  const reglas = dedupeReglas(
    Array.isArray(row.reglas)
      ? row.reglas.map(normalizeRegla).filter((item): item is WaDerivacionRegla => item !== null)
      : [],
  );
  return {
    defaultRecepcionista,
    reglas,
    updatedAt: String(row.updatedAt ?? "") || new Date().toISOString(),
  };
}

async function writeConfig(config: WaDerivacionConfig): Promise<void> {
  await setDoc(DOC, config, { merge: false });
}

export async function getDerivacionTurnoConfig(): Promise<WaDerivacionConfig> {
  const snap = await getDoc(DOC);
  if (!snap.exists()) {
    const seeded = seedConfig();
    await writeConfig(seeded);
    await syncTagsDeReglas(seeded.reglas);
    return seeded;
  }
  const data = snap.data();
  const crudas = Array.isArray(data?.reglas) ? data.reglas.length : 0;
  const normalized = normalizeConfig(data);
  // Si el doc existe vacío (sin reglas), sembrar una vez.
  if (normalized.reglas.length === 0) {
    const seeded = seedConfig();
    await writeConfig(seeded);
    await syncTagsDeReglas(seeded.reglas);
    return seeded;
  }
  if (crudas !== normalized.reglas.length) {
    const limpio = { ...normalized, updatedAt: new Date().toISOString() };
    await writeConfig(limpio);
    await syncTagsDeReglas(limpio.reglas);
    return limpio;
  }
  await syncTagsDeReglas(normalized.reglas);
  return normalized;
}

export async function saveDerivacionTurnoConfig(input: {
  defaultRecepcionista?: string;
  reglas?: unknown[];
}): Promise<WaDerivacionConfig> {
  const defaultRecepcionista =
    String(input.defaultRecepcionista ?? "").trim() || DERIVACION_DEFAULT_RECEPCIONISTA;
  const reglas = dedupeReglas(
    Array.isArray(input.reglas)
      ? input.reglas.map(normalizeRegla).filter((item): item is WaDerivacionRegla => item !== null)
      : [],
  );
  const config: WaDerivacionConfig = {
    defaultRecepcionista,
    reglas,
    updatedAt: new Date().toISOString(),
  };
  await writeConfig(config);
  await syncTagsDeReglas(reglas);
  return config;
}

/** Alias de clave (bocazzi ↔ boccazzi). */
function clavesEquivalentes(clave: string): string[] {
  const c = normalizeClave(clave);
  if (c === "boccazzi" || c === "boccazi") return ["boccazzi", "boccazi"];
  return c ? [c] : [];
}

/** Nombre de etiqueta del profesional de la lista, o vacío si no está. */
export function profesionalNombreParaTexto(
  config: WaDerivacionConfig,
  profesionalTexto: string,
): string {
  const texto = sinTildes(profesionalTexto);
  if (!texto.trim()) return "";
  for (const regla of config.reglas) {
    const claves = clavesEquivalentes(regla.profesionalClave);
    if (claves.some((clave) => new RegExp(`\\b${escapeRe(clave)}\\b`).test(texto))) {
      return regla.profesionalNombre.trim();
    }
  }
  return "";
}

/**
 * Recepcionista para un pedido según profesional dicho/catálogo.
 * Si no hay match → default (Florencia Sosa).
 */
export function recepcionistaParaProfesional(
  config: WaDerivacionConfig,
  profesionalTexto: string,
): string {
  const texto = sinTildes(profesionalTexto);
  if (!texto.trim()) return config.defaultRecepcionista || DERIVACION_DEFAULT_RECEPCIONISTA;
  for (const regla of config.reglas) {
    const claves = clavesEquivalentes(regla.profesionalClave);
    if (claves.some((clave) => new RegExp(`\\b${escapeRe(clave)}\\b`).test(texto))) {
      return regla.recepcionistaNombre.trim() || config.defaultRecepcionista;
    }
  }
  return config.defaultRecepcionista || DERIVACION_DEFAULT_RECEPCIONISTA;
}
