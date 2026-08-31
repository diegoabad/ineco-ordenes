import * as XLSX from "xlsx-js-style";
import { detectarDuplicadosDebitos, withDuplicadosDebitos } from "./cruzar";
import { mesLabelFromKey } from "./mesLabel";
import type { ResultadoPami } from "./types";

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(headers: string[], rows: string[][], fileName: string) {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => r.map((c) => csvEscape(c)).join(",")),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(blob, fileName);
}

type CellKind = "text" | "number" | "pct";

type SheetOpts = {
  /** Por columna: text (default), number o pct (formato 0.0). */
  colKinds?: CellKind[];
  freezeHeader?: boolean;
  autoFilter?: boolean;
  boldHeader?: boolean;
  colWidths?: { min?: number; max?: number; extras?: number[] };
};

const HEADER_STYLE: XLSX.CellStyle = {
  font: { bold: true, sz: 11, color: { rgb: "111827" } },
  fill: { patternType: "solid", fgColor: { rgb: "F3F4F6" } },
  alignment: { vertical: "center", wrapText: true },
};

function cellValue(
  raw: unknown,
  kind: CellKind,
): { v: string | number; t: "s" | "n"; z?: string } {
  if (kind === "pct") {
    const n =
      typeof raw === "number"
        ? raw
        : Number(String(raw ?? "").replace("%", "").replace(",", "."));
    return {
      t: "n",
      v: Number.isFinite(n) ? n : 0,
      z: "0.0",
    };
  }
  if (kind === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
    return {
      t: "n",
      v: Number.isFinite(n) ? n : 0,
      z: "0",
    };
  }
  return { t: "s", v: String(raw ?? ""), z: "@" };
}

function sheetFromAoa(aoa: unknown[][], opts: SheetOpts = {}): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(
    aoa.map((row) => row.map((c) => (c == null ? "" : c))),
  );
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const kinds = opts.colKinds ?? [];

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const isHeader = R === 0;
      const kind: CellKind = isHeader ? "text" : (kinds[C] ?? "text");
      const next = cellValue(cell.v, kind);
      cell.t = next.t;
      cell.v = next.v;
      if (next.z) cell.z = next.z;
      if (isHeader && opts.boldHeader !== false) {
        cell.s = HEADER_STYLE;
      } else if (kind === "pct" || kind === "number") {
        cell.s = {
          alignment: { horizontal: kind === "pct" ? "right" : "right" },
          numFmt: next.z,
        };
      } else {
        cell.s = { alignment: { horizontal: "left" }, numFmt: "@" };
      }
    }
  }

  if (opts.freezeHeader !== false) {
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
    ws["!views"] = [
      {
        state: "frozen",
        ySplit: 1,
        topLeftCell: "A2",
        activePane: "bottomLeft",
      },
    ];
  }

  if (opts.autoFilter !== false && aoa.length > 0) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range(range),
    };
  }

  const min = opts.colWidths?.min ?? 8;
  const max = opts.colWidths?.max ?? 60;
  const extras = opts.colWidths?.extras ?? [];
  const cols = Math.max(0, ...aoa.map((r) => r.length));
  const widths: XLSX.ColInfo[] = [];
  for (let c = 0; c < cols; c++) {
    let w = extras[c] ?? min;
    for (const row of aoa) {
      const len = String(row[c] ?? "").length;
      if (len + 2 > w) w = len + 2;
    }
    widths.push({ wch: Math.min(max, Math.max(min, w)) });
  }
  ws["!cols"] = widths;

  return ws;
}

function formatGeneradoAt(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dupKey(afiliadoKey: string, fecha: string, codigo: number): string {
  return `${afiliadoKey}|${fecha}|${codigo}`;
}

function toCodigoNum(prestacion: string): number {
  const n = Number(String(prestacion).replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function exportCoincidenciasCsv(result: ResultadoPami) {
  const headers = [
    "Afiliado",
    "Nombre",
    "Módulo",
    "N° OP",
    "N° OME",
    "Cant. observadas",
    "Códigos observados",
    "Código distinto al módulo",
  ];
  const rows = result.coincidencias.flatMap((c) =>
    c.presentacion.map((p) => [
      c.afiliadoOriginal,
      c.nombre,
      String(p.modulo),
      p.numeroOp,
      p.numeroOme,
      String(c.cantidadObservadas),
      c.codigosObservados.join("; "),
      c.codigoDistintoAlModulo ? "sí" : "no",
    ]),
  );
  exportCsv(headers, rows, "pami-coincidencias.csv");
}

export function exportConcentracionCsv(result: ResultadoPami) {
  exportCsv(
    ["Afiliado", "Cantidad 125", "% del total", "En presentación"],
    result.concentracion125.map((r) => [
      r.afiliadoOriginal,
      String(r.cantidad),
      r.porcentajeDelTotal.toFixed(1),
      r.estaEnPresentacion ? "sí" : "no",
    ]),
    "pami-concentracion-125.csv",
  );
}

export function exportMotivosCsv(result: ResultadoPami) {
  exportCsv(
    ["Motivo", "Cantidad", "Porcentaje"],
    result.motivos.map((m) => [
      m.motivo,
      String(m.cantidad),
      m.porcentaje.toFixed(1),
    ]),
    "pami-motivos.csv",
  );
}

export function exportDuplicadosCsv(result: ResultadoPami) {
  const full = withDuplicadosDebitos(result);
  const dups = full.duplicadosDebitos;
  exportCsv(
    ["Afiliado", "Fecha", "Código", "Filas", "Motivos"],
    dups.map((d) => [
      d.afiliadoOriginal,
      d.fecha,
      String(d.codigo),
      String(d.cantidadFilas),
      d.motivos.join(" · "),
    ]),
    "pami-duplicados.csv",
  );
}

export type ExportXlsxOpts = {
  mesKey?: string;
  generadoAt?: Date;
};

export function exportTodoXlsx(
  result: ResultadoPami,
  fileName = "pami-analisis.xlsx",
  opts: ExportXlsxOpts = {},
) {
  const full = withDuplicadosDebitos(result);
  // Recalcular siempre desde débitos para que la marca sea auditable
  const dups =
    full.debitos.length > 0
      ? detectarDuplicadosDebitos(full.debitos)
      : full.duplicadosDebitos;
  const dupKeys = new Set(
    dups.map((d) => dupKey(d.afiliadoNormalizado, d.fecha, d.codigo)),
  );
  const filasDup = dups.reduce((s, d) => s + d.cantidadFilas, 0);
  const r = full.resumen;
  const mesKey = opts.mesKey ?? "";
  const mesLabel = mesKey ? mesLabelFromKey(mesKey) : "—";
  const generado = formatGeneradoAt(opts.generadoAt ?? new Date());
  const wb = XLSX.utils.book_new();

  // 1) Origen — procedencia del análisis
  const origen: unknown[][] = [
    ["Campo", "Valor"],
    ["Período", mesLabel],
    ["Período (clave)", mesKey || "—"],
    ["Generado", generado],
    ["Archivo Presentación (INECO)", full.carga.archivoA.nombre],
    ["Filas válidas Presentación", full.carga.archivoA.filasValidas],
    ["Filas descartadas Presentación", full.carga.archivoA.filasDescartadas],
    ["Archivo Débitos (PAMI)", full.carga.archivoB.nombre],
    ["Filas válidas Débitos", full.carga.archivoB.filasValidas],
    ["Filas descartadas Débitos", full.carga.archivoB.filasDescartadas],
  ];
  const wsOrigen = sheetFromAoa(origen, {
    colKinds: ["text", "text"],
    autoFilter: false,
    colWidths: { min: 12, max: 50, extras: [36, 40] },
  });
  // Segunda columna numérica en filas de conteo
  for (const addr of ["B6", "B7", "B9", "B10"]) {
    const cell = wsOrigen[addr] as XLSX.CellObject | undefined;
    if (!cell) continue;
    const n = Number(cell.v);
    if (!Number.isFinite(n)) continue;
    cell.t = "n";
    cell.v = n;
    cell.z = "0";
  }
  XLSX.utils.book_append_sheet(wb, wsOrigen, "Origen");

  // 2) Resumen (con desgloses como en la UI)
  const resumen: unknown[][] = [
    ["Métrica", "Valor"],
    ["Afiliados coincidentes", r.afiliadosCoincidentes],
    ["Solo en presentación", r.soloEnPresentacion],
    ["Solo en débitos", r.soloEnDebitos],
    ["Prestaciones observadas", r.prestacionesObservadas],
    ["  · Código 125", r.prestacionesPorCodigo["125"] ?? 0],
    ["  · Código 140", r.prestacionesPorCodigo["140"] ?? 0],
    ["OPs presentadas", r.opsPresentadas],
    ["  · Módulo 125001", r.opsPorModulo["125001"] ?? 0],
    ["  · Módulo 140010", r.opsPorModulo["140010"] ?? 0],
    ["Afiliados únicos observados", r.afiliadosObservados],
    ["Afiliados únicos presentación", r.afiliadosPresentados],
    ["Grupos con prestaciones duplicadas", dups.length],
    ["Filas involucradas en duplicados", filasDup],
  ];
  const wsResumen = sheetFromAoa(resumen, {
    colKinds: ["text", "number"],
    autoFilter: false,
    colWidths: { min: 12, max: 40, extras: [40, 14] },
  });
  XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

  // 3) Alertas (hallazgos visibles)
  const alertasRows: unknown[][] = [
    ["Tipo", "Mensaje"],
    ...(full.alertas.length > 0
      ? full.alertas.map((a) => [a.tipo, a.mensaje])
      : [["—", "Sin alertas"]]),
  ];
  const wsAlertas = sheetFromAoa(alertasRows, {
    colKinds: ["text", "text"],
    colWidths: { min: 12, max: 90, extras: [28, 80] },
  });
  XLSX.utils.book_append_sheet(wb, wsAlertas, "Alertas");

  // 4) Coincidencias (+ N° OME)
  const coin: unknown[][] = [
    [
      "Afiliado",
      "Nombre",
      "Módulo",
      "N° OP",
      "N° OME",
      "Cant. observadas",
      "Códigos",
      "Código distinto",
    ],
    ...full.coincidencias.flatMap((c) =>
      c.presentacion.map((p) => [
        c.afiliadoOriginal,
        c.nombre,
        p.modulo,
        p.numeroOp,
        p.numeroOme,
        c.cantidadObservadas,
        c.codigosObservados.join("; "),
        c.codigoDistintoAlModulo ? "sí" : "no",
      ]),
    ),
  ];
  const wsCoin = sheetFromAoa(coin, {
    colKinds: ["text", "text", "number", "text", "text", "number", "text", "text"],
    colWidths: {
      min: 10,
      max: 36,
      extras: [22, 28, 10, 14, 16, 16, 12, 14],
    },
  });
  XLSX.utils.book_append_sheet(wb, wsCoin, "Coincidencias");

  // 5) Concentracion 125 — % con un decimal
  const conc: unknown[][] = [
    ["Afiliado", "Cantidad 125", "%", "En presentación"],
    ...full.concentracion125.map((row) => [
      row.afiliadoOriginal,
      row.cantidad,
      row.porcentajeDelTotal,
      row.estaEnPresentacion ? "sí" : "no",
    ]),
  ];
  const wsConc = sheetFromAoa(conc, {
    colKinds: ["text", "number", "pct", "text"],
    colWidths: { min: 10, max: 28, extras: [22, 14, 8, 16] },
  });
  XLSX.utils.book_append_sheet(wb, wsConc, "Concentracion 125");

  // 6) Motivos — % con un decimal
  const mot: unknown[][] = [
    ["Motivo", "Cantidad", "%"],
    ...full.motivos.map((m) => [m.motivo, m.cantidad, m.porcentaje]),
  ];
  const wsMot = sheetFromAoa(mot, {
    colKinds: ["text", "number", "pct"],
    colWidths: { min: 10, max: 70, extras: [55, 10, 10] },
  });
  XLSX.utils.book_append_sheet(wb, wsMot, "Motivos");

  // 7) Detalle débitos — columna Duplicado visible (junto al motivo)
  const det: unknown[][] = [
    ["Afiliado", "Fecha", "Prestación", "Tipo", "Motivo", "Duplicado"],
    ...full.debitos.map((d) => {
      const codigo = toCodigoNum(d.prestacion);
      const isDup = dupKeys.has(dupKey(d.afiliadoKey, d.fecha, codigo));
      return [
        d.afiliadoOriginal,
        d.fecha,
        d.prestacion,
        d.tipo,
        d.orden,
        isDup ? "sí" : "no",
      ];
    }),
  ];
  const wsDet = sheetFromAoa(det, {
    colKinds: ["text", "text", "text", "text", "text", "text"],
    colWidths: {
      min: 10,
      max: 70,
      extras: [22, 12, 12, 40, 55, 12],
    },
  });
  XLSX.utils.book_append_sheet(wb, wsDet, "Detalle debitos");

  // 8) Duplicados (resumen de grupos)
  const dupRows: unknown[][] = [
    ["Afiliado", "Fecha", "Código", "Filas", "Motivos"],
    ...dups.map((d) => [
      d.afiliadoOriginal,
      d.fecha,
      d.codigo,
      d.cantidadFilas,
      d.motivos.join(" · "),
    ]),
  ];
  const wsDup = sheetFromAoa(dupRows, {
    colKinds: ["text", "text", "number", "number", "text"],
    colWidths: { min: 10, max: 70, extras: [22, 12, 10, 8, 55] },
  });
  XLSX.utils.book_append_sheet(wb, wsDup, "Duplicados");

  XLSX.writeFile(wb, fileName);
}
