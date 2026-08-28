import type { CSSProperties } from "react";
import type { TipoPrestacion } from "../types";
import { DEFAULT_TIPOS_PRESTACION, TIPO_COLOR_PALETTE } from "../types";

export function tiposPrestacionNombres(tipos: TipoPrestacion[]): string[] {
  return tipos.map((t) => t.nombre);
}

export function colorForTipo(tipos: TipoPrestacion[], nombre: string): string {
  const match = tipos.find((t) => t.nombre === nombre);
  if (match) return match.color;
  const preset = DEFAULT_TIPOS_PRESTACION.find((t) => t.nombre === nombre);
  if (preset) return preset.color;
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) {
    hash = (hash + nombre.charCodeAt(i) * (i + 1)) % TIPO_COLOR_PALETTE.length;
  }
  return TIPO_COLOR_PALETTE[hash] ?? TIPO_COLOR_PALETTE[0]!;
}

export function nextTipoColor(existing: TipoPrestacion[]): string {
  const used = new Set(existing.map((t) => t.color.toLowerCase()));
  const free = TIPO_COLOR_PALETTE.find((c) => !used.has(c.toLowerCase()));
  return free ?? TIPO_COLOR_PALETTE[existing.length % TIPO_COLOR_PALETTE.length]!;
}

/** Agrega Evaluación / Tratamiento si faltan en la config guardada. */
export function mergeMissingDefaultTipos(tipos: TipoPrestacion[]): {
  tipos: TipoPrestacion[];
  changed: boolean;
} {
  const merged = [...tipos];
  let changed = false;
  for (const def of DEFAULT_TIPOS_PRESTACION) {
    if (!merged.some((t) => t.nombre.toLowerCase() === def.nombre.toLowerCase())) {
      merged.push({ ...def });
      changed = true;
    }
  }
  return { tipos: merged, changed };
}

export function chipStyleForColor(color: string): CSSProperties {
  return { "--chip-color": color } as CSSProperties;
}
