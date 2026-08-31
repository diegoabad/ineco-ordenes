import * as XLSX from "xlsx";
import { celdaEsAfiliadoHeader, normalizarTextoCelda } from "./normalizar";

export type SheetMatrix = unknown[][];

export function workbookToFirstSheetMatrix(
  data: ArrayBuffer,
  opts?: { cellDates?: boolean },
): { sheetName: string; rows: SheetMatrix } {
  const wb = XLSX.read(data, {
    type: "array",
    cellDates: opts?.cellDates ?? true,
  });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("El Excel no tiene hojas");
  }
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`No se pudo leer la hoja "${sheetName}"`);
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as SheetMatrix;
  return { sheetName, rows };
}

export function filaTieneAfiliadoHeader(row: unknown[]): boolean {
  return row.some((cell) => celdaEsAfiliadoHeader(cell));
}

export function encontrarFilaEncabezados(rows: SheetMatrix): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (filaTieneAfiliadoHeader(row)) return i;
  }
  throw new Error(
    'No se encontró la fila de encabezados (se busca una celda con "Afiliado" / "N° de Afiliado")',
  );
}

/** Índices de columnas no totalmente vacías a partir de headerRow inclusive. */
export function columnasNoVacias(rows: SheetMatrix, headerRow: number): number[] {
  const header = rows[headerRow] ?? [];
  const width = Math.max(header.length, ...rows.slice(headerRow).map((r) => r.length));
  const used: number[] = [];
  for (let c = 0; c < width; c++) {
    let has = false;
    for (let r = headerRow; r < rows.length; r++) {
      const v = rows[r]?.[c];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        has = true;
        break;
      }
    }
    if (has) used.push(c);
  }
  return used;
}

export function mapearHeaders(
  headerRow: unknown[],
  colIndices: number[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of colIndices) {
    const key = normalizarTextoCelda(headerRow[c]);
    if (!key) continue;
    if (!map.has(key)) map.set(key, c);
  }
  return map;
}

export function buscarColumna(
  headers: Map<string, number>,
  candidatos: string[],
): number | null {
  for (const raw of candidatos) {
    const key = normalizarTextoCelda(raw);
    const idx = headers.get(key);
    if (idx !== undefined) return idx;
  }
  // match parcial (ej. "n de afiliado" contiene afiliado)
  for (const [h, idx] of headers) {
    for (const raw of candidatos) {
      const key = normalizarTextoCelda(raw);
      if (h === key || h.includes(key) || key.includes(h)) return idx;
    }
  }
  return null;
}

export function celdaATexto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return dateToIsoLocal(v);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v > 20000 && v < 80000) {
      const epoch = Date.UTC(1899, 11, 30);
      const ms = epoch + Math.round(v) * 86400000;
      const dt = new Date(ms);
      if (!Number.isNaN(dt.getTime())) {
        return dateToIsoUtc(dt);
      }
    }
    return String(v);
  }
  return String(v).replace(/\u00a0/g, " ").trim();
}

/** Fecha en ISO `YYYY-MM-DD` cuando se puede parsear; si no, texto original. */
export function celdaAFechaIso(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return dateToIsoLocal(v);
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(v) * 86400000;
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dateToIsoUtc(dt);
  }
  const raw = String(v).replace(/\u00a0/g, " ").trim();
  const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(raw);
  if (m) {
    const d = m[1]!.padStart(2, "0");
    const mo = m[2]!.padStart(2, "0");
    const y = m[3]!;
    return `${y}-${mo}-${d}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return raw;
}

function dateToIsoLocal(v: Date): string {
  const y = v.getFullYear();
  const m = String(v.getMonth() + 1).padStart(2, "0");
  const d = String(v.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateToIsoUtc(v: Date): string {
  const y = v.getUTCFullYear();
  const m = String(v.getUTCMonth() + 1).padStart(2, "0");
  const d = String(v.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function requireCol(
  headers: Map<string, number>,
  label: string,
  candidatos: string[],
): number {
  const idx = buscarColumna(headers, candidatos);
  if (idx === null) {
    throw new Error(`Falta la columna "${label}" (buscada como: ${candidatos.join(", ")})`);
  }
  return idx;
}
