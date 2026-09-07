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
  aceptados: number;
  rechazados: number;
  byEstado: { label: string; count: number; pct: number; tone?: "muted" | "ok" | "error" }[];
  byProfesional: { name: string; count: number }[];
  byPrestacion: { name: string; count: number }[];
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

const HEADER_STYLE: XLSX.CellStyle = {
  font: { bold: true, sz: 11, color: { rgb: "111827" } },
  fill: { patternType: "solid", fgColor: { rgb: "F3F4F6" } },
};

function sheetFromAoA(rows: (string | number)[][], boldFirst = true): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (boldFirst && rows.length > 0) {
    const cols = rows[0]!.length;
    for (let c = 0; c < cols; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = HEADER_STYLE;
    }
  }
  const widths = rows[0]!.map((_, i) => {
    let max = 10;
    for (const row of rows) {
      const v = row[i];
      max = Math.max(max, String(v ?? "").length + 2);
    }
    return { wch: Math.min(40, max) };
  });
  ws["!cols"] = widths;
  return ws;
}

export function exportMetricasExcel(data: MetricasExportData): void {
  const wb = XLSX.utils.book_new();

  const resumen: (string | number)[][] = [
    ["Métricas de presupuestos"],
    ["Periodo", periodoLabel(data)],
    ["Exportado", formatFechaYmd(fileStamp())],
    [],
    ["Indicador", "Valor"],
    ["Total", data.total],
    ["Enviados", data.enviados],
    ["Aceptados", data.aceptados],
    ["Rechazados", data.rechazados],
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromAoA(resumen, false), "Resumen");

  const estados: (string | number)[][] = [
    ["Estado", "Cantidad", "% sobre enviados"],
    ...data.byEstado.map((e) => [e.label, e.count, e.pct]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromAoA(estados), "Por estado");

  const profs: (string | number)[][] = [
    ["Profesional", "Cantidad"],
    ...data.byProfesional.map((p) => [p.name, p.count]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromAoA(profs), "Por profesional");

  const prests: (string | number)[][] = [
    ["Prestación", "Cantidad"],
    ...data.byPrestacion.map((p) => [p.name, p.count]),
  ];
  XLSX.utils.book_append_sheet(wb, sheetFromAoA(prests), "Por prestación");

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
    { label: "Aceptados", value: String(data.aceptados), colors: KPI_OK },
    { label: "Rechazados", value: String(data.rechazados), colors: KPI_ERROR },
  ];
  const gap = 10;
  const cols = 4;
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
  ensureSpace(ctx, 36);
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(12);
  ctx.doc.setTextColor(...TEXT);
  ctx.doc.text(title, MARGIN, ctx.y);
  ctx.y += 14;

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
  ctx.y += 14;
  doc.setFontSize(8);
  doc.text(`Exportado: ${formatFechaYmd(fileStamp())}`, MARGIN, ctx.y);
  ctx.y += 18;

  drawKpiCards(ctx, data);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  ensureSpace(ctx, 12);
  doc.text("% sobre enviados (sin pendientes ni fallidos)", MARGIN, ctx.y);
  ctx.y += 12;

  drawTable(
    ctx,
    "Por estado",
    ["Estado", "Cantidad", "%"],
    data.byEstado.map((e) => [e.label, String(e.count), `${e.pct}%`]),
    (i) => data.byEstado[i]?.tone,
  );
  drawTable(
    ctx,
    "Por profesional",
    ["Profesional", "Cantidad"],
    data.byProfesional.map((p) => [p.name, String(p.count)]),
  );
  drawTable(
    ctx,
    "Por prestación",
    ["Prestación", "Cantidad"],
    data.byPrestacion.map((p) => [p.name, String(p.count)]),
  );

  drawFootersOnAllPages(doc);
  doc.save(`${baseName(data)}.pdf`);
}
