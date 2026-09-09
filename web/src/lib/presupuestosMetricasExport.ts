import { jsPDF } from "jspdf";
import * as XLSX from "xlsx-js-style";
import {
  LOGO_INECO_DATA_URL,
  LOGO_INECO_FORMAT,
  LOGO_INECO_HEIGHT,
  LOGO_INECO_WIDTH,
} from "../assets/logoIneco";
import { formatFechaYmd } from "./fechas";

export type MetricasExportData = {
  desde: string;
  hasta: string;
  mesLabel?: string;
  total: number;
  enviados: number;
  pendientesEnvio: number;
  aceptados: number;
  rechazados: number;
  byEstado: { label: string; count: number; pct: number; tone?: "muted" | "ok" | "error" }[];
  byProfesional: { name: string; count: number }[];
  byPrestacion: { name: string; count: number }[];
  byMotivoRechazo: {
    name: string;
    count: number;
    detail?: { name: string; count: number }[];
  }[];
};

const MARGIN = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = PAGE_W - MARGIN;

const TEXT = [17, 24, 39] as const;
const MUTED = [75, 85, 99] as const;
const LINE = [209, 213, 219] as const;
const HEADER_BG = [248, 250, 252] as const;
const ROW_ALT = [250, 251, 252] as const;

type Rgb = readonly [number, number, number];
type KpiColors = { border: Rgb; accent: Rgb; bg: Rgb };

const KPI_TOTAL: KpiColors = {
  border: [209, 213, 219],
  accent: [107, 114, 128],
  bg: [249, 250, 251],
};
const KPI_ENVIADOS: KpiColors = {
  border: [191, 219, 254],
  accent: [37, 99, 235],
  bg: [239, 246, 255],
};
const KPI_WARN: KpiColors = {
  border: [253, 230, 138],
  accent: [217, 119, 6],
  bg: [255, 251, 235],
};
const KPI_OK: KpiColors = {
  border: [187, 247, 208],
  accent: [22, 163, 74],
  bg: [240, 253, 244],
};
const KPI_ERROR: KpiColors = {
  border: [254, 202, 202],
  accent: [220, 38, 38],
  bg: [254, 242, 242],
};

const HEADER_LOGO_W = 96;
const HEADER_LOGO_H = HEADER_LOGO_W * (LOGO_INECO_HEIGHT / LOGO_INECO_WIDTH);
const HEADER_TITLE_SIZE = 20;
const HEADER_DATE_SIZE = 10;
const HEADER_LINE_EXTRA = 12;
const HEADER_LINE_TO_BODY = 22;
const HEADER_TOP = 24;
const BODY_START_Y = HEADER_TOP + HEADER_LOGO_H + HEADER_LINE_EXTRA + HEADER_LINE_TO_BODY;

const FOOTER_LOGO_W = 40;
const FOOTER_LOGO_H = FOOTER_LOGO_W * (LOGO_INECO_HEIGHT / LOGO_INECO_WIDTH);
const FOOTER_BOTTOM_MARGIN = 10;
const FOOTER_LINE_GAP = 6;
const FOOTER_RESERVE = FOOTER_BOTTOM_MARGIN + FOOTER_LOGO_H + FOOTER_LINE_GAP + 10;

type PdfCtx = {
  doc: jsPDF;
  periodo: string;
  y: number;
};

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function periodoLabel(data: MetricasExportData): string {
  const rango = `${formatFechaYmd(data.desde)} – ${formatFechaYmd(data.hasta)}`;
  return data.mesLabel ? `${data.mesLabel} (${rango})` : rango;
}

function baseName(data: MetricasExportData): string {
  if (data.mesLabel) {
    return `metricas-presupuestos-${data.mesLabel.toLowerCase().replace(/\s+/g, "-")}`;
  }
  return `metricas-presupuestos-${data.desde}_${data.hasta}`;
}

function drawHLine(doc: jsPDF, y: number) {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, y, RIGHT, y);
}

function drawLogoIneco(
  doc: jsPDF,
  x: number,
  topY: number,
  width = HEADER_LOGO_W,
  height = HEADER_LOGO_H,
  align: "left" | "center" = "center",
) {
  const drawX = align === "center" ? x - width / 2 : x;
  try {
    doc.addImage(LOGO_INECO_DATA_URL, LOGO_INECO_FORMAT, drawX, topY, width, height);
  } catch {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(width > 80 ? 18 : 10);
    doc.setTextColor(...TEXT);
    const textX = align === "center" ? x : x + width / 2;
    doc.text("INECO", textX, topY + height * 0.72, { align: "center" });
  }
}

function drawHeader(doc: jsPDF, periodo: string): number {
  drawLogoIneco(doc, MARGIN, HEADER_TOP, HEADER_LOGO_W, HEADER_LOGO_H, "left");

  const logoCenterY = HEADER_TOP + HEADER_LOGO_H / 2;
  const titleBaseline = logoCenterY + HEADER_TITLE_SIZE * 0.35;
  const dateBaseline = logoCenterY + HEADER_DATE_SIZE * 0.35;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(HEADER_TITLE_SIZE);
  doc.setTextColor(...TEXT);
  doc.text("Métricas presupuestos", PAGE_W / 2, titleBaseline, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(HEADER_DATE_SIZE);
  doc.setTextColor(...TEXT);
  const rightLabel = periodo.length > 28 ? formatFechaYmd(fileStamp()) : periodo;
  doc.text(rightLabel, RIGHT, dateBaseline, { align: "right" });

  const lineY = HEADER_TOP + HEADER_LOGO_H + HEADER_LINE_EXTRA;
  drawHLine(doc, lineY);
  return BODY_START_Y;
}

function drawFooter(doc: jsPDF, page: number, totalPages: number) {
  const fontSize = 9;
  const logoW = FOOTER_LOGO_W;
  const logoH = FOOTER_LOGO_H;
  const gap = 8;
  const label = "Métricas generadas por";
  const pageLabel = `${page} / ${totalPages}`;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(...MUTED);
  const labelW = doc.getTextWidth(label);
  const totalW = labelW + gap + logoW;
  const startX = (PAGE_W - totalW) / 2;

  const footerBottom = PAGE_H - FOOTER_BOTTOM_MARGIN;
  const rowCenterY = footerBottom - logoH / 2;
  const textBaseline = rowCenterY + fontSize * 0.35;
  const lineY = rowCenterY - logoH / 2 - FOOTER_LINE_GAP;
  drawHLine(doc, lineY);

  doc.text(label, startX, textBaseline);
  drawLogoIneco(doc, startX + labelW + gap + logoW / 2, rowCenterY - logoH / 2, logoW, logoH, "center");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);
  doc.setTextColor(...MUTED);
  doc.text(pageLabel, RIGHT, textBaseline, { align: "right" });
}

function drawFootersOnAllPages(doc: jsPDF) {
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    drawFooter(doc, page, totalPages);
  }
}

function ensureSpace(ctx: PdfCtx, needed: number): void {
  if (ctx.y + needed <= PAGE_H - FOOTER_RESERVE) return;
  ctx.doc.addPage();
  ctx.y = drawHeader(ctx.doc, ctx.periodo);
}

/** Estilos Excel (xlsx-js-style). */
const XL = {
  bordo: "A61948",
  text: "111827",
  muted: "6B7280",
  white: "FFFFFF",
  headerBg: "A61948",
  sectionBg: "FCE7EF",
  titleBg: "FFF5F8",
  rowAlt: "F9FAFB",
  border: "E5E7EB",
  thin: {
    top: { style: "thin", color: { rgb: "E5E7EB" } },
    bottom: { style: "thin", color: { rgb: "E5E7EB" } },
    left: { style: "thin", color: { rgb: "E5E7EB" } },
    right: { style: "thin", color: { rgb: "E5E7EB" } },
  } as XLSX.CellStyle["border"],
};

type XlRowKind = "title" | "meta" | "section" | "header" | "data" | "empty";

type XlBuiltSheet = {
  rows: (string | number)[][];
  kinds: XlRowKind[];
  colWidths: number[];
};

function styleCell(
  cell: XLSX.CellObject,
  kind: XlRowKind,
  col: number,
  altRow = false,
): void {
  const base: XLSX.CellStyle = {
    alignment: {
      vertical: "center",
      wrapText: kind === "title" || kind === "section",
      horizontal: col > 0 && kind === "data" ? "right" : "left",
    },
    border: kind === "header" || kind === "data" ? XL.thin : undefined,
  };

  if (kind === "title") {
    cell.s = {
      ...base,
      font: { bold: true, sz: 18, color: { rgb: XL.bordo } },
      fill: { patternType: "solid", fgColor: { rgb: XL.titleBg } },
      alignment: { vertical: "center", horizontal: "left" },
    };
    return;
  }
  if (kind === "meta") {
    cell.s = {
      ...base,
      font: {
        bold: col === 0,
        sz: 11,
        color: { rgb: col === 0 ? XL.text : XL.muted },
      },
    };
    return;
  }
  if (kind === "section") {
    cell.s = {
      ...base,
      font: { bold: true, sz: 13, color: { rgb: XL.bordo } },
      fill: { patternType: "solid", fgColor: { rgb: XL.sectionBg } },
      alignment: { vertical: "center", horizontal: "left" },
    };
    return;
  }
  if (kind === "header") {
    cell.s = {
      ...base,
      font: { bold: true, sz: 11, color: { rgb: XL.white } },
      fill: { patternType: "solid", fgColor: { rgb: XL.headerBg } },
      alignment: {
        vertical: "center",
        horizontal: col === 0 ? "left" : "center",
      },
    };
    return;
  }
  if (kind === "data") {
    cell.s = {
      ...base,
      font: { sz: 11, color: { rgb: XL.text } },
      fill: altRow
        ? { patternType: "solid", fgColor: { rgb: XL.rowAlt } }
        : { patternType: "solid", fgColor: { rgb: XL.white } },
      alignment: {
        vertical: "center",
        horizontal: col === 0 ? "left" : "right",
      },
    };
    return;
  }
  cell.s = base;
}

function buildSheet(built: XlBuiltSheet): XLSX.WorkSheet {
  const { rows, kinds, colWidths } = built;
  const maxCols = Math.max(1, ...rows.map((r) => r.length), colWidths.length);
  const padded = rows.map((r) => {
    const copy = [...r];
    while (copy.length < maxCols) copy.push("");
    return copy;
  });

  const ws = XLSX.utils.aoa_to_sheet(padded.length ? padded : [[""]]);
  const merges: XLSX.Range[] = [];
  let dataIndex = 0;

  for (let r = 0; r < kinds.length; r++) {
    const kind = kinds[r]!;
    if (kind === "title" || kind === "section") {
      merges.push({ s: { r, c: 0 }, e: { r, c: maxCols - 1 } });
    }
    const altRow = kind === "data" ? dataIndex % 2 === 1 : false;
    if (kind === "data") dataIndex += 1;
    if (kind === "header" || kind === "section") dataIndex = 0;

    for (let c = 0; c < maxCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      let cell = ws[addr] as XLSX.CellObject | undefined;
      if (!cell) {
        cell = { t: "s", v: "" };
        ws[addr] = cell;
      }
      styleCell(cell, kind, c, altRow);
    }
  }

  if (merges.length) ws["!merges"] = merges;
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
  ws["!rows"] = kinds.map((k) => {
    if (k === "title") return { hpt: 28 };
    if (k === "section") return { hpt: 22 };
    if (k === "header") return { hpt: 20 };
    if (k === "empty") return { hpt: 10 };
    return { hpt: 18 };
  });
  return ws;
}

function colWidthsFromRows(
  rows: (string | number)[][],
  mins: number[],
  max = 48,
): number[] {
  const cols = Math.max(mins.length, ...rows.map((r) => r.length), 1);
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) {
    let w = mins[i] ?? 12;
    for (const row of rows) {
      w = Math.max(w, String(row[i] ?? "").length + 2);
    }
    widths.push(Math.min(max, Math.max(mins[i] ?? 10, w)));
  }
  return widths;
}

function sheetTable(
  title: string,
  headers: string[],
  dataRows: (string | number)[][],
  opts?: { subtitle?: [string, string]; extraSection?: { title: string; headers: string[]; rows: (string | number)[][] } },
): XLSX.WorkSheet {
  const rows: (string | number)[][] = [[title]];
  const kinds: XlRowKind[] = ["title"];

  if (opts?.subtitle) {
    rows.push(opts.subtitle);
    kinds.push("meta");
  }
  rows.push([]);
  kinds.push("empty");
  rows.push(headers);
  kinds.push("header");
  for (const r of dataRows) {
    rows.push(r);
    kinds.push("data");
  }

  if (opts?.extraSection) {
    rows.push([]);
    kinds.push("empty");
    rows.push([opts.extraSection.title]);
    kinds.push("section");
    rows.push(opts.extraSection.headers);
    kinds.push("header");
    for (const r of opts.extraSection.rows) {
      rows.push(r);
      kinds.push("data");
    }
  }

  const mins = headers.map((_, i) => (i === 0 ? 28 : 12));
  return buildSheet({
    rows,
    kinds,
    colWidths: colWidthsFromRows(rows, mins),
  });
}

function pctOf(count: number, total: number): number {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function withPctRows(
  rows: { name: string; count: number }[],
): (string | number)[][] {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  if (!rows.length) return [["Sin datos", 0, 0]];
  return rows.map((r) => [r.name, r.count, pctOf(r.count, total)]);
}

function withPctLabelRows(
  rows: { name: string; count: number }[],
): string[][] {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  if (!rows.length) return [["Sin datos", "0", "0%"]];
  return rows.map((r) => [r.name, String(r.count), `${pctOf(r.count, total)}%`]);
}

export function exportMetricasExcel(data: MetricasExportData): void {
  const wb = XLSX.utils.book_new();

  const resumenRows: (string | number)[][] = [
    ["Métricas de presupuestos"],
    ["Periodo", periodoLabel(data)],
    [],
    ["Resumen del periodo"],
    ["Indicador", "Valor", "Nota"],
    ["Total", data.total, "Todos los presupuestos del periodo"],
    ["Enviados", data.enviados, "Incluye pendiente de respuesta, aceptados y rechazados"],
    ["Pendientes de envío", data.pendientesEnvio, "Aún no enviados o con envío fallido"],
    [],
    ["De los enviados"],
    ["Estado", "Cantidad", "% sobre enviados"],
    ...data.byEstado.map((e) => [e.label, e.count, e.pct]),
  ];
  const resumenKinds: XlRowKind[] = [
    "title",
    "meta",
    "empty",
    "section",
    "header",
    "data",
    "data",
    "data",
    "empty",
    "section",
    "header",
    ...data.byEstado.map(() => "data" as const),
  ];
  XLSX.utils.book_append_sheet(
    wb,
    buildSheet({
      rows: resumenRows,
      kinds: resumenKinds,
      colWidths: colWidthsFromRows(resumenRows, [28, 14, 52], 56),
    }),
    "Resumen",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetTable(
      "Por profesional",
      ["Profesional", "Cantidad", "%"],
      withPctRows(data.byProfesional),
      { subtitle: ["Periodo", periodoLabel(data)] },
    ),
    "Por profesional",
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetTable(
      "Por prestación",
      ["Prestación", "Cantidad", "%"],
      withPctRows(data.byPrestacion),
      { subtitle: ["Periodo", periodoLabel(data)] },
    ),
    "Por prestación",
  );

  const otrosDetalle = data.byMotivoRechazo.find((m) => m.name === "Otros")?.detail ?? [];
  XLSX.utils.book_append_sheet(
    wb,
    sheetTable(
      "Motivos de rechazo",
      ["Motivo de rechazo", "Cantidad", "%"],
      withPctRows(data.byMotivoRechazo),
      {
        subtitle: ["Periodo", periodoLabel(data)],
        extraSection: {
          title: "Detalle de Otros",
          headers: ["Texto escrito", "Cantidad", "%"],
          rows:
            otrosDetalle.length > 0
              ? withPctRows(otrosDetalle)
              : [["No hay textos en Otros", "—", "—"]],
        },
      },
    ),
    "Motivos rechazo",
  );

  XLSX.writeFile(wb, `${baseName(data)}.xlsx`);
}

function kpiTone(tone?: "muted" | "ok" | "error"): KpiColors {
  if (tone === "ok") return KPI_OK;
  if (tone === "error") return KPI_ERROR;
  if (tone === "muted") return KPI_ENVIADOS;
  return KPI_TOTAL;
}

function setRgbFill(doc: jsPDF, rgb: Rgb) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function setRgbDraw(doc: jsPDF, rgb: Rgb) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function drawKpiCards(ctx: PdfCtx, data: MetricasExportData) {
  const items = [
    { label: "Total", value: String(data.total), colors: KPI_TOTAL },
    { label: "Enviados", value: String(data.enviados), colors: KPI_ENVIADOS },
    {
      label: "Pend. envío",
      value: String(data.pendientesEnvio),
      colors: KPI_WARN,
    },
  ];
  const gap = 10;
  const cols = 3;
  const cardW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cardH = 52;
  ensureSpace(ctx, cardH + 8);

  items.forEach((item, i) => {
    const x = MARGIN + i * (cardW + gap);
    const top = ctx.y;
    setRgbFill(ctx.doc, item.colors.bg);
    setRgbDraw(ctx.doc, item.colors.border);
    ctx.doc.setLineWidth(1);
    ctx.doc.roundedRect(x, top, cardW, cardH, 5, 5, "FD");
    setRgbFill(ctx.doc, item.colors.accent);
    ctx.doc.rect(x, top, 4, cardH, "F");

    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(8);
    ctx.doc.setTextColor(...MUTED);
    ctx.doc.text(item.label, x + 12, top + 16);

    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(18);
    ctx.doc.setTextColor(...TEXT);
    ctx.doc.text(item.value, x + 12, top + 40);
  });

  ctx.y += cardH + 14;
}

function drawTable(
  ctx: PdfCtx,
  title: string,
  headers: string[],
  rows: string[][],
  toneForRow?: (rowIndex: number) => "muted" | "ok" | "error" | undefined,
) {
  // Espacio extra arriba de cada título de sección
  ctx.y += 10;
  ensureSpace(ctx, 46);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(12);
  ctx.doc.setTextColor(...TEXT);
  ctx.doc.text(title, MARGIN, ctx.y);
  ctx.y += 16;

  const colW = CONTENT_W / headers.length;
  const rowH = 18;
  const padX = 6;

  const drawHeaderRow = () => {
    ensureSpace(ctx, rowH + 4);
    ctx.doc.setFillColor(...HEADER_BG);
    ctx.doc.setDrawColor(...LINE);
    ctx.doc.roundedRect(MARGIN, ctx.y, CONTENT_W, rowH, 3, 3, "FD");
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(8);
    ctx.doc.setTextColor(...MUTED);
    headers.forEach((h, i) => {
      ctx.doc.text(h, MARGIN + i * colW + padX, ctx.y + 12);
    });
    ctx.y += rowH + 2;
  };

  drawHeaderRow();

  if (rows.length === 0) {
    ensureSpace(ctx, 20);
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(9);
    ctx.doc.setTextColor(...MUTED);
    ctx.doc.text("Sin datos en el rango", MARGIN, ctx.y + 10);
    ctx.y += 22;
    return;
  }

  rows.forEach((row, ri) => {
    if (ctx.y + rowH > PAGE_H - FOOTER_RESERVE) {
      ctx.doc.addPage();
      ctx.y = drawHeader(ctx.doc, ctx.periodo);
      drawHeaderRow();
    }

    const tone = toneForRow?.(ri);
    const colors = tone ? kpiTone(tone) : null;
    if (ri % 2 === 1 && !colors) {
      ctx.doc.setFillColor(...ROW_ALT);
      ctx.doc.rect(MARGIN, ctx.y, CONTENT_W, rowH, "F");
    } else if (colors) {
      setRgbFill(ctx.doc, colors.bg);
      ctx.doc.rect(MARGIN, ctx.y, CONTENT_W, rowH, "F");
      setRgbFill(ctx.doc, colors.accent);
      ctx.doc.rect(MARGIN, ctx.y, 3, rowH, "F");
    }

    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(9);
    ctx.doc.setTextColor(...TEXT);
    row.forEach((cell, i) => {
      const text = ctx.doc.splitTextToSize(cell, colW - padX * 2) as string[];
      ctx.doc.text(text[0] ?? "", MARGIN + i * colW + padX, ctx.y + 12);
    });
    ctx.y += rowH;
  });

  ctx.y += 12;
}

export function exportMetricasPdf(data: MetricasExportData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const periodo = periodoLabel(data);
  const ctx: PdfCtx = {
    doc,
    periodo,
    y: drawHeader(doc, periodo),
  };

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`Periodo: ${periodo}`, MARGIN, ctx.y);
  ctx.y += 18;

  drawKpiCards(ctx, data);

  drawTable(
    ctx,
    "De los enviados",
    ["Estado", "Cantidad", "%"],
    data.byEstado.map((e) => [e.label, String(e.count), `${e.pct}%`]),
    (i) => data.byEstado[i]?.tone,
  );
  drawTable(
    ctx,
    "Por profesional",
    ["Profesional", "Cantidad", "%"],
    withPctLabelRows(data.byProfesional),
  );
  drawTable(
    ctx,
    "Por prestación",
    ["Prestación", "Cantidad", "%"],
    withPctLabelRows(data.byPrestacion),
  );
  drawTable(
    ctx,
    "Motivos de rechazo",
    ["Motivo", "Cantidad", "%"],
    withPctLabelRows(data.byMotivoRechazo),
  );

  const otrosDetalle = data.byMotivoRechazo.find((m) => m.name === "Otros")?.detail ?? [];
  drawTable(
    ctx,
    "Detalle de Otros",
    ["Texto escrito", "Cantidad", "%"],
    otrosDetalle.length > 0
      ? withPctLabelRows(otrosDetalle)
      : [["No hay textos en Otros", "—", "—"]],
  );

  drawFootersOnAllPages(doc);
  doc.save(`${baseName(data)}.pdf`);
}
