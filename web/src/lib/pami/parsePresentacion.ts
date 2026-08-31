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
  COLUMNAS_PRESENTACION_INECO,
  ExcelFormatoError,
  validarYResolverColumnas,
} from "./schema";
import type { FileParseMeta, PresentacionRow } from "./types";

export type ParsePresentacionResult = {
  meta: FileParseMeta;
  rows: PresentacionRow[];
};

export function parsePresentacionFromMatrix(
  rows: SheetMatrix,
  fileName: string,
): ParsePresentacionResult {
  if (!rows.length) {
    throw new ExcelFormatoError({
      archivo: "INECO",
      faltantes: COLUMNAS_PRESENTACION_INECO.map((c) => c.label),
      encontradas: [],
      detalle: "El archivo está vacío.",
    });
  }

  let headerRowIdx: number;
  try {
    headerRowIdx = encontrarFilaEncabezados(rows);
  } catch {
    throw new ExcelFormatoError({
      archivo: "INECO",
      faltantes: ["N° de Afiliado"],
      encontradas: [],
      detalle:
        'No se encontró la fila de encabezados (se busca una celda con «N° de Afiliado»). Revisá que sea el Excel de Presentación INECO.',
    });
  }

  const colIndices = columnasNoVacias(rows, headerRowIdx);
  const headerRow = rows[headerRowIdx] ?? [];
  const headers = mapearHeaders(headerRow, colIndices);
  const cols = validarYResolverColumnas(headers, COLUMNAS_PRESENTACION_INECO, "INECO");

  const colNombre = cols.get("Nombre y apellido")!;
  const colModulo = cols.get("Modulo")!;
  const colAfiliado = cols.get("N° de Afiliado")!;
  const colOme = cols.get("N° OME")!;
  const colOp = cols.get("Número de OP")!;
  const colFecha = cols.get("Fecha")!;
  const colActivada = cols.get("Activada")!;

  const out: PresentacionRow[] = [];
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
      nombreApellido: celdaATexto(row[colNombre]),
      modulo: celdaATexto(row[colModulo]),
      afiliadoOriginal: afiliadoOriginal || String(row[colAfiliado] ?? "").trim(),
      afiliadoKey: key,
      nroOme: celdaATexto(row[colOme]),
      nroOp: celdaATexto(row[colOp]),
      fecha: celdaAFechaIso(row[colFecha]),
      activada: celdaAFechaIso(row[colActivada]) || celdaATexto(row[colActivada]),
    });
  }

  if (out.length === 0) {
    throw new ExcelFormatoError({
      archivo: "INECO",
      faltantes: [],
      encontradas: [...headers.keys()],
      detalle:
        "Las columnas son correctas, pero no hay filas con afiliado válido. ¿Será el archivo equivocado o solo tiene el bloque de totales?",
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

export function parsePresentacionFromArrayBuffer(
  data: ArrayBuffer,
  fileName: string,
): ParsePresentacionResult {
  const { rows } = workbookToFirstSheetMatrix(data);
  return parsePresentacionFromMatrix(rows, fileName);
}
