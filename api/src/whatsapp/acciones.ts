import { getBuscaTurnoConfig } from "../services/db.service.js";
import type { BuscaTurnoConfig } from "../types.js";

export type AccionClave = "profesionales.listarTratamientos" | "prestaciones.listarProfesionales";

export type AccionDef = {
  clave: AccionClave;
  nombre: string;
  intenciones: string[];
};

export const ACCIONES: AccionDef[] = [
  {
    clave: "profesionales.listarTratamientos",
    nombre: "Qué prestaciones hace un profesional",
    intenciones: ["INFO_PROFESIONALES", "INFO_TRATAMIENTOS", "TURNOS"],
  },
  {
    clave: "prestaciones.listarProfesionales",
    nombre: "Qué profesionales hacen una prestación",
    intenciones: ["INFO_PROFESIONALES", "INFO_TRATAMIENTOS", "TURNOS"],
  },
];

const STOP = new Set(["dr", "dra", "doctor", "doctora", "el", "la", "los", "las", "de", "del"]);

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return norm(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP.has(token));
}

function matches(haystack: string, queryTokens: string[]): boolean {
  if (!queryTokens.length) return false;
  const text = norm(haystack);
  return queryTokens.every((token) => text.includes(token));
}

export function accionPermitida(clave: string, intencion: string): AccionDef | null {
  const found = ACCIONES.find((item) => item.clave === clave);
  if (!found || !found.intenciones.includes(intencion)) return null;
  return found;
}

export function textoAcciones(): string {
  return ACCIONES.map(
    (item) => `- ${item.clave}: ${item.nombre}. Intenciones: ${item.intenciones.join(", ")}.`,
  ).join("\n");
}

export async function ejecutarAccion(clave: AccionClave, consulta: string): Promise<string> {
  const config = await getBuscaTurnoConfig();
  if (!config) return "No hay listas de profesionales ni prestaciones cargadas.";
  const query = tokens(consulta);
  if (!query.length) return "Falta el nombre para buscar en las listas.";
  if (clave === "profesionales.listarTratamientos") return tratamientosDeProfesional(config, query);
  return profesionalesDePrestacion(config, query);
}

function tratamientosDeProfesional(config: BuscaTurnoConfig, query: string[]): string {
  const profesionales = config.profesionales.filter(
    (item) => item.enabled !== false && matches(`${item.nombre} ${item.doc}`, query),
  );
  if (!profesionales.length) {
    return `No hay un profesional habilitado que coincida con «${query.join(" ")}».`;
  }
  const lines = profesionales.slice(0, 8).map((profesional) => {
    const prestaciones = Object.entries(config.prestaciones)
      .filter(([, prestacion]) => prestacion.enabled !== false)
      .filter(([, prestacion]) =>
        (prestacion.profesionales ?? []).some((item) => String(item.doc) === String(profesional.doc)),
      )
      .map(([codigo, prestacion]) => `${prestacion.nombre || codigo} (${codigo})`);
    const lista = prestaciones.length ? prestaciones.join("; ") : "ninguna prestación habilitada";
    return `${profesional.nombre} (${profesional.doc}, sede ${profesional.sede || "sin sede"}): ${lista}`;
  });
  const extra =
    profesionales.length > 8 ? `\nHay ${profesionales.length - 8} coincidencias más. No elijas una sola.` : "";
  return lines.join("\n") + extra;
}

function profesionalesDePrestacion(config: BuscaTurnoConfig, query: string[]): string {
  const prestaciones = Object.entries(config.prestaciones).filter(
    ([codigo, prestacion]) =>
      prestacion.enabled !== false && matches(`${prestacion.nombre} ${codigo}`, query),
  );
  if (!prestaciones.length) {
    return `No hay una prestación habilitada que coincida con «${query.join(" ")}».`;
  }
  const habilitados = new Set(
    config.profesionales.filter((item) => item.enabled !== false).map((item) => String(item.doc)),
  );
  const lines = prestaciones.slice(0, 8).map(([codigo, prestacion]) => {
    const nombres = (prestacion.profesionales ?? [])
      .filter((item) => habilitados.has(String(item.doc)))
      .map((item) => `${item.nombre || item.doc} (${item.doc})`);
    const lista = nombres.length ? nombres.join("; ") : "ningún profesional habilitado";
    return `${prestacion.nombre || codigo} (${codigo}): ${lista}`;
  });
  const extra =
    prestaciones.length > 8 ? `\nHay ${prestaciones.length - 8} coincidencias más. No elijas una sola.` : "";
  return lines.join("\n") + extra;
}
