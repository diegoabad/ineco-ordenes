import { MAPEO_PRESTACION, type CodigoDebito, type CodigoModulo } from "./types";

export function moduloDesdePrestacion(prestacion: string): CodigoModulo | null {
  const key = prestacion.trim() as CodigoDebito;
  return MAPEO_PRESTACION[key]?.modulo ?? null;
}

export function prestacionDesdeModulo(modulo: string | number): CodigoDebito | null {
  const m = Number(String(modulo).replace(/\D/g, ""));
  for (const [prestacion, info] of Object.entries(MAPEO_PRESTACION)) {
    if (info.modulo === m) return prestacion as CodigoDebito;
  }
  return null;
}
