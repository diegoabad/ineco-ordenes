import type { ProfesionalPresupuesto } from "../types";
import { formatNombrePersona, normalizeNombrePersona } from "./nombrePersona";

export const TITULOS_PROFESIONAL_PRESUPUESTO = ["Dr.", "Dra.", "Lic.", "Prof."] as const;

export function formatProfesionalPresupuesto(p: Pick<ProfesionalPresupuesto, "titulo" | "nombreApellido">): string {
  const titulo = p.titulo.trim();
  const nombre = formatNombrePersona(p.nombreApellido);
  if (titulo && nombre) return `${titulo} ${nombre}`;
  return nombre || titulo;
}

export function normalizeProfesionalPresupuestoNombre(nombreApellido: string): string {
  return normalizeNombrePersona(nombreApellido);
}
