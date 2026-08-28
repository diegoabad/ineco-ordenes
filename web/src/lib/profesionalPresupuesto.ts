import type { ProfesionalPresupuesto } from "../types";

export const TITULOS_PROFESIONAL_PRESUPUESTO = ["Dr.", "Dra.", "Lic.", "Prof."] as const;

export function formatProfesionalPresupuesto(p: Pick<ProfesionalPresupuesto, "titulo" | "nombreApellido">): string {
  const titulo = p.titulo.trim();
  const nombre = p.nombreApellido.trim();
  if (titulo && nombre) return `${titulo} ${nombre}`;
  return nombre || titulo;
}
