import {
  columnasNoVacias,
  celdaATexto,
  celdaAFechaIso,
  encontrarFilaEncabezados,
  mapearHeaders,
  workbookToFirstSheetMatrix,
  type SheetMatrix,
} from "./excel";
import { normalizarAfiliado } from "./normalizar";
import {
  COLUMNAS_DEBITOS_PAMI,
  ExcelFormatoError,
  validarYResolverColumnas,
} from "./schema";
import type { DebitoRow, FileParseMeta } from "./types";

export type ParseDebitosResult = {
  meta: FileParseMeta;
  rows: DebitoRow[];
};

export function parseDebitosFromMatrix(
  rows: SheetMatrix,
  fileName: string,
): ParseDebitosResult {
  if (!rows.length) {
    throw new ExcelFormatoError({
      archivo: "PAMI",
      faltantes: COLUMNAS_DEBITOS_PAMI.map((c) => c.label),
      encontradas: [],
      detalle: "El archivo está vacío.",
    });
  }

  let headerRowIdx: number;
  try {
    headerRowIdx = encontrarFilaEncabezados(rows);
  } catch {
    throw new ExcelFormatoError({
      archivo: "PAMI",
      faltantes: ["Afiliado"],
      encontradas: [],
      detalle:
        'No se encontró la fila de encabezados (se busca una celda con «Afiliado»). Revisá que sea el Excel de Débitos PAMI.',
    });
  }

  const colIndices = columnasNoVacias(rows, headerRowIdx);
  const headerRow = rows[headerRowIdx] ?? [];
  const headers = mapearHeaders(headerRow, colIndices);
  const cols = validarYResolverColumnas(headers, COLUMNAS_DEBITOS_PAMI, "PAMI");

  const colOrden = cols.get("ORDEn")!;
  const colFecha = cols.get("Fecha")!;
  const colAfiliado = cols.get("Afiliado")!;
  const colPrestacion = cols.get("Prestacion")!;
  const colTipo = cols.get("TIPO")!;

  const out: DebitoRow[] = [];
  let descartadas = 0;

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const afiliadoOriginal = celdaATexto(row[colAfiliado]);
    const key = normalizarAfiliado(afiliadoOriginal || row[colAfiliado]);
    if (!key) {
      const anyContent = row.some((c) => String(c ?? "").trim() !== "");
      if (anyContent) descartadas += 1;
      continue;
    }

    out.push({
      orden: celdaATexto(row[colOrden]),
      fecha: celdaAFechaIso(row[colFecha]),
      afiliadoOriginal: afiliadoOriginal || String(row[colAfiliado] ?? "").trim(),
      afiliadoKey: key,
      prestacion: celdaATexto(row[colPrestacion]),
      tipo: celdaATexto(row[colTipo]),
    });
  }

  if (out.length === 0) {
    throw new ExcelFormatoError({
      archivo: "PAMI",
      faltantes: [],
      encontradas: [...headers.keys()],
      detalle:
        "Las columnas son correctas, pero no hay filas con afiliado válido. ¿Será el archivo equivocado?",
    });
  }

  return {
    meta: {
      fileName,
      filasDatos: out.length,
      filasDescartadas: descartadas,
    },
    rows: out,
  };
}

export function parseDebitosFromArrayBuffer(
  data: ArrayBuffer,
  fileName: string,
): ParseDebitosResult {
  const { rows } = workbookToFirstSheetMatrix(data);
  return parseDebitosFromMatrix(rows, fileName);
}
