import { jsPDF } from "jspdf";
import {
  LOGO_INECO_DATA_URL,
  LOGO_INECO_FORMAT,
  LOGO_INECO_HEIGHT,
  LOGO_INECO_WIDTH,
} from "../../assets/logoIneco";
import { withDuplicadosDebitos } from "./cruzar";
import { mesLabelFromKey } from "./mesLabel";
import type { ResultadoPami } from "./types";

export { mesLabelFromKey } from "./mesLabel";

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
const WARN_BG = [255, 251, 235] as const;
/** Bordó INECO (#a61948) */
const BORDO = [166, 25, 72] as const;
const BORDO_SOFT = [252, 242, 246] as const;

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
  mesLabel: string;
  y: number;
};

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

function drawHeader(doc: jsPDF, mesLabel: string): number {
  drawLogoIneco(doc, MARGIN, HEADER_TOP, HEADER_LOGO_W, HEADER_LOGO_H, "left");

  const logoCenterY = HEADER_TOP + HEADER_LOGO_H / 2;
  const titleBaseline = logoCenterY + HEADER_TITLE_SIZE * 0.35;
  const dateBaseline = logoCenterY + HEADER_DATE_SIZE * 0.35;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(HEADER_TITLE_SIZE);
  doc.setTextColor(...TEXT);
  doc.text("Análisis PAMI", PAGE_W / 2, titleBaseline, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(HEADER_DATE_SIZE);
  doc.setTextColor(...TEXT);
  doc.text(mesLabel, RIGHT, dateBaseline, { align: "right" });

  const lineY = HEADER_TOP + HEADER_LOGO_H + HEADER_LINE_EXTRA;
  drawHLine(doc, lineY);
  return BODY_START_Y;
}

function drawFooter(doc: jsPDF, page: number, totalPages: number) {
  const fontSize = 9;
  const logoW = FOOTER_LOGO_W;
  const logoH = FOOTER_LOGO_H;
  const gap = 8;
  const label = "Análisis PAMI generado por";
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
  drawLogoIneco(
    doc,
    startX + labelW + gap + logoW / 2,
    rowCenterY - logoH / 2,
    logoW,
    logoH,
    "center",
  );
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
  ctx.y = drawHeader(ctx.doc, ctx.mesLabel);
}

function sectionTitle(ctx: PdfCtx, title: string) {
  ensureSpace(ctx, 28);
  ctx.y += 8;
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(12);
  ctx.doc.setTextColor(...BORDO);
  ctx.doc.text(title, MARGIN, ctx.y);
  ctx.y += 6;
  ctx.doc.setDrawColor(...BORDO);
  ctx.doc.setLineWidth(1.2);
  ctx.doc.line(MARGIN, ctx.y, MARGIN + 48, ctx.y);
  ctx.y += 12;
}

function mutedText(ctx: PdfCtx, text: string, size = 9) {
  const lines = ctx.doc.splitTextToSize(text, CONTENT_W) as string[];
  for (const l of lines) {
    ensureSpace(ctx, size + 4);
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(size);
    ctx.doc.setTextColor(...MUTED);
    ctx.doc.text(l, MARGIN, ctx.y);
    ctx.y += size + 3;
  }
}

type Col = { w: number; align?: "left" | "right" | "center" };

function drawTableTitleBand(ctx: PdfCtx, title: string) {
  const titleH = 22;
  ensureSpace(ctx, titleH + 20);
  const top = ctx.y;
  ctx.doc.setFillColor(...BORDO);
  ctx.doc.setDrawColor(...BORDO);
  ctx.doc.rect(MARGIN, top, CONTENT_W, titleH, "FD");
  ctx.doc.setFont("helvetica", "bold");
  ctx.doc.setFontSize(9.5);
  ctx.doc.setTextColor(255, 255, 255);
  ctx.doc.text(title, MARGIN + 8, top + 14.5);
  ctx.y = top + titleH;
}

function drawTable(
  ctx: PdfCtx,
  headers: string[],
  rows: string[][],
  cols: Col[],
  opts?: {
    title?: string;
    rowBg?: (rowIdx: number, cells: string[]) => readonly [number, number, number] | null;
    /** Color de texto por celda (fila de datos, índice de columna). */
    cellColor?: (
      rowIdx: number,
      colIdx: number,
      value: string,
    ) => readonly [number, number, number] | null;
  },
) {
  const padX = 5;
  const padY = 5;
  const fontSize = 8;
  const headerSize = 8;
  const lineH = fontSize + 2;

  if (opts?.title) {
    ctx.y += 6;
    drawTableTitleBand(ctx, opts.title);
  }

  const measureRowHeight = (cells: string[], isHeader: boolean) => {
    let maxLines = 1;
    cells.forEach((cell, i) => {
      const colW = cols[i]!.w - padX * 2;
      const lines = ctx.doc.splitTextToSize(String(cell ?? ""), Math.max(8, colW)) as string[];
      maxLines = Math.max(maxLines, lines.length);
    });
    const size = isHeader ? headerSize : fontSize;
    return padY * 2 + maxLines * (size + 2);
  };

  const drawRow = (
    cells: string[],
    isHeader: boolean,
    bg: readonly [number, number, number] | null,
    rowIdx: number,
  ) => {
    const rowH = measureRowHeight(cells, isHeader);
    ensureSpace(ctx, rowH + 2);

    const top = ctx.y;
    if (bg) {
      ctx.doc.setFillColor(...bg);
      ctx.doc.rect(MARGIN, top, CONTENT_W, rowH, "F");
    }

    ctx.doc.setDrawColor(...LINE);
    ctx.doc.setLineWidth(0.5);
    ctx.doc.rect(MARGIN, top, CONTENT_W, rowH, "S");

    let x = MARGIN;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]!;
      if (i > 0) {
        ctx.doc.line(x, top, x, top + rowH);
      }
      const value = String(cells[i] ?? "");
      const colW = col.w - padX * 2;
      const lines = ctx.doc.splitTextToSize(value, Math.max(8, colW)) as string[];
      const customColor =
        !isHeader && opts?.cellColor ? opts.cellColor(rowIdx, i, value) : null;
      ctx.doc.setFont("helvetica", isHeader || customColor ? "bold" : "normal");
      ctx.doc.setFontSize(isHeader ? headerSize : fontSize);
      if (customColor) {
        ctx.doc.setTextColor(...customColor);
      } else {
        ctx.doc.setTextColor(...TEXT);
      }

      let ty = top + padY + (isHeader ? headerSize : fontSize);
      for (const l of lines) {
        const align = col.align ?? "left";
        if (align === "right") {
          ctx.doc.text(l, x + col.w - padX, ty, { align: "right" });
        } else if (align === "center") {
          ctx.doc.text(l, x + col.w / 2, ty, { align: "center" });
        } else {
          ctx.doc.text(l, x + padX, ty);
        }
        ty += lineH;
      }
      x += col.w;
    }

    ctx.y = top + rowH;
  };

  drawRow(headers, true, HEADER_BG, -1);
  rows.forEach((row, idx) => {
    const custom = opts?.rowBg?.(idx, row) ?? null;
    const bg = custom ?? (idx % 2 === 1 ? ROW_ALT : null);
    drawRow(row, false, bg, idx);
  });
}

function metricCards(ctx: PdfCtx, items: { label: string; value: string; hint?: string }[]) {
  const gap = 8;
  const cols = 2;
  const cardW = (CONTENT_W - gap) / cols;
  const cardH = 48;
  const accentW = 3.5;

  for (let i = 0; i < items.length; i += cols) {
    ensureSpace(ctx, cardH + 8);
    const rowItems = items.slice(i, i + cols);
    const top = ctx.y;
    rowItems.forEach((item, j) => {
      const x = MARGIN + j * (cardW + gap);
      ctx.doc.setDrawColor(...LINE);
      ctx.doc.setFillColor(255, 255, 255);
      ctx.doc.setLineWidth(0.7);
      ctx.doc.roundedRect(x, top, cardW, cardH, 4, 4, "FD");

      // Detalle bordó a la izquierda
      ctx.doc.setFillColor(...BORDO);
      ctx.doc.rect(x, top, accentW, cardH, "F");

      ctx.doc.setFont("helvetica", "bold");
      ctx.doc.setFontSize(15);
      ctx.doc.setTextColor(...BORDO);
      ctx.doc.text(item.value, x + 12, top + 20);

      ctx.doc.setFont("helvetica", "normal");
      ctx.doc.setFontSize(8);
      ctx.doc.setTextColor(...TEXT);
      ctx.doc.text(item.label, x + 12, top + 33);
      if (item.hint) {
        const hintLines = ctx.doc.splitTextToSize(item.hint, cardW - 22) as string[];
        ctx.doc.setTextColor(...MUTED);
        ctx.doc.text(hintLines[0] ?? "", x + 12, top + 43);
      }
    });
    ctx.y = top + cardH + 8;
  }
}

export function generarPdfPami(result: ResultadoPami, mesKey: string): jsPDF {
  const full = withDuplicadosDebitos(result);
  const mesLabel = mesLabelFromKey(mesKey);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const ctx: PdfCtx = { doc, mesLabel, y: drawHeader(doc, mesLabel) };

  const { resumen } = full;
  const dups = full.duplicadosDebitos;
  const filasDup = dups.reduce((s, d) => s + d.cantidadFilas, 0);

  sectionTitle(ctx, "Resumen");
  metricCards(ctx, [
    {
      label: "Afiliados coincidentes",
      value: String(resumen.afiliadosCoincidentes),
      hint: `Solo pres. ${resumen.soloEnPresentacion} · Solo débitos ${resumen.soloEnDebitos}`,
    },
    {
      label: "Prestaciones observadas",
      value: String(resumen.prestacionesObservadas),
      hint: `125: ${resumen.prestacionesPorCodigo["125"] ?? 0} · 140: ${resumen.prestacionesPorCodigo["140"] ?? 0}`,
    },
    {
      label: "OPs presentadas",
      value: String(resumen.opsPresentadas),
      hint: `125001: ${resumen.opsPorModulo["125001"] ?? 0} · 140010: ${resumen.opsPorModulo["140010"] ?? 0}`,
    },
    {
      label: "Afiliados únicos observados",
      value: String(resumen.afiliadosObservados),
      hint: `Duplicados: ${dups.length} grupos · ${filasDup} filas`,
    },
  ]);

  if (full.alertas.length > 0) {
    sectionTitle(ctx, "Alertas");
    for (const a of full.alertas) {
      const titulo = a.titulo ?? "Alerta";
      const meta = a.meta ?? "";
      const items = a.items ?? [];
      const badge = a.badge ? `  ·  ${a.badge}` : "";

      const titleLines = doc.splitTextToSize(`${titulo}${badge}`, CONTENT_W - 20) as string[];
      const metaLines = meta
        ? (doc.splitTextToSize(meta, CONTENT_W - 20) as string[])
        : [];
      const itemLines = items.flatMap((it) =>
        doc.splitTextToSize(`• ${it}`, CONTENT_W - 28) as string[],
      );
      const fallbackLines =
        !a.titulo && !a.meta
          ? (doc.splitTextToSize(a.mensaje, CONTENT_W - 20) as string[])
          : [];

      const boxH =
        14 +
        titleLines.length * 12 +
        metaLines.length * 10 +
        itemLines.length * 10 +
        fallbackLines.length * 10 +
        (items.length > 0 ? 6 : 0);
      ensureSpace(ctx, boxH + 6);
      const top = ctx.y;

      doc.setFillColor(...BORDO_SOFT);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.6);
      doc.roundedRect(MARGIN, top, CONTENT_W, boxH, 3, 3, "FD");
      doc.setFillColor(...BORDO);
      doc.rect(MARGIN, top, 3.5, boxH, "F");

      let ty = top + 13;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...BORDO);
      for (const l of titleLines) {
        doc.text(l, MARGIN + 12, ty);
        ty += 12;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...TEXT);
      for (const l of metaLines) {
        doc.text(l, MARGIN + 12, ty);
        ty += 10;
      }
      for (const l of fallbackLines) {
        doc.text(l, MARGIN + 12, ty);
        ty += 10;
      }
      if (itemLines.length > 0) ty += 2;
      doc.setTextColor(...MUTED);
      for (const l of itemLines) {
        doc.text(l, MARGIN + 14, ty);
        ty += 10;
      }
      ctx.y = top + boxH + 6;
    }
  }

  if (dups.length === 0) {
    sectionTitle(ctx, "Prestaciones duplicadas en Débitos");
    mutedText(ctx, "Ninguna (mismo afiliado + fecha + código en más de una fila).");
  } else {
    drawTable(
      ctx,
      ["Afiliado", "Fecha", "Código", "Filas", "Motivos"],
      dups.map((d) => [
        d.afiliadoOriginal,
        d.fecha,
        String(d.codigo),
        String(d.cantidadFilas),
        d.motivos.join(" · "),
      ]),
      [
        { w: CONTENT_W * 0.22 },
        { w: CONTENT_W * 0.12, align: "center" },
        { w: CONTENT_W * 0.1, align: "center" },
        { w: CONTENT_W * 0.08, align: "center" },
        { w: CONTENT_W * 0.48 },
      ],
      { title: "Prestaciones duplicadas en Débitos" },
    );
  }

  if (full.coincidencias.length === 0) {
    sectionTitle(ctx, "Coincidencias");
    mutedText(ctx, "0 afiliados en común entre los dos archivos.");
  } else {
    ctx.y += 6;
    drawTableTitleBand(ctx, "Coincidencias");
    for (const c of full.coincidencias) {
      const mods = c.presentacion
        .map((p) => `${p.modulo} / OP ${p.numeroOp}${p.numeroOme ? ` / OME ${p.numeroOme}` : ""}`)
        .join(" · ");
      const flag = c.codigoDistintoAlModulo ? "  ·  código ≠ módulo" : "";

      ensureSpace(ctx, 36);
      const headTop = ctx.y;
      const headLines = doc.splitTextToSize(
        `${c.afiliadoOriginal}  —  ${c.nombre}${flag}`,
        CONTENT_W - 16,
      ) as string[];
      const sub = `Presentación: ${mods || "—"}  ·  ${c.cantidadObservadas} observada(s)  ·  códigos ${c.codigosObservados.join(", ") || "—"}`;
      const subLines = doc.splitTextToSize(sub, CONTENT_W - 16) as string[];
      const headH = 14 + headLines.length * 11 + subLines.length * 10;
      ensureSpace(ctx, headH + 4);

      if (c.codigoDistintoAlModulo) {
        doc.setFillColor(...WARN_BG);
      } else {
        doc.setFillColor(...BORDO_SOFT);
      }
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.7);
      doc.rect(MARGIN, headTop, CONTENT_W, headH, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...TEXT);
      let ty = headTop + 12;
      for (const l of headLines) {
        doc.text(l, MARGIN + 8, ty);
        ty += 11;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      for (const l of subLines) {
        doc.text(l, MARGIN + 8, ty);
        ty += 10;
      }
      ctx.y = headTop + headH;

      if (c.detalle.length > 0) {
        drawTable(
          ctx,
          ["Fecha", "Código", "Tipo", "Motivo de rechazo"],
          c.detalle.map((d) => [
            d.fecha,
            String(d.codigo),
            d.tipo,
            d.esDuplicado ? `${d.motivo} (duplicado)` : d.motivo,
          ]),
          [
            { w: CONTENT_W * 0.14, align: "center" },
            { w: CONTENT_W * 0.1, align: "center" },
            { w: CONTENT_W * 0.28 },
            { w: CONTENT_W * 0.48 },
          ],
          {
            rowBg: (idx, cells) =>
              String(cells[3] ?? "").includes("(duplicado)") ? WARN_BG : idx % 2 === 1 ? ROW_ALT : null,
          },
        );
      }
      ctx.y += 8;
    }
  }

  const r125 = resumen.concentracion125;
  if (full.concentracion125.length > 0) {
    drawTable(
      ctx,
      ["Afiliado", "Cant.", "%", "En presentación"],
      full.concentracion125.map((row) => [
        row.afiliadoOriginal,
        String(row.cantidad),
        row.porcentajeDelTotal.toFixed(1),
        row.estaEnPresentacion ? "Sí" : "No",
      ]),
      [
        { w: CONTENT_W * 0.46 },
        { w: CONTENT_W * 0.14, align: "center" },
        { w: CONTENT_W * 0.14, align: "center" },
        { w: CONTENT_W * 0.26, align: "center" },
      ],
      {
        title: "Concentración de prestación 125",
        rowBg: (_idx, cells) => (cells[3] === "Sí" ? BORDO_SOFT : null),
        cellColor: (_rowIdx, colIdx, value) =>
          colIdx === 3 && value === "Sí" ? BORDO : null,
      },
    );
    ctx.y += 2;
    mutedText(
      ctx,
      `${r125.afiliadosUnicos} afiliados concentran ${r125.totalPrestaciones} prestaciones observadas; ${r125.conMasDeUna} con más de una · ${r125.conUnaSola} con una sola.`,
    );
  } else {
    sectionTitle(ctx, "Concentración de prestación 125");
    mutedText(ctx, "Sin datos de concentración 125.");
  }

  if (full.motivos.length === 0) {
    sectionTitle(ctx, "Motivos de rechazo");
    mutedText(ctx, "Sin motivos.");
  } else {
    drawTable(
      ctx,
      ["Motivo", "Cantidad", "%"],
      full.motivos.map((m) => [m.motivo, String(m.cantidad), m.porcentaje.toFixed(1)]),
      [
        { w: CONTENT_W * 0.72 },
        { w: CONTENT_W * 0.14, align: "center" },
        { w: CONTENT_W * 0.14, align: "center" },
      ],
      { title: "Motivos de rechazo" },
    );
  }

  drawFootersOnAllPages(doc);
  return doc;
}

export function buildPamiPdfBase64(result: ResultadoPami, mesKey: string): string {
  const doc = generarPdfPami(result, mesKey);
  const dataUri = doc.output("datauristring");
  return dataUri.split(",")[1] ?? "";
}

export function downloadPamiPdf(result: ResultadoPami, mesKey: string) {
  const doc = generarPdfPami(result, mesKey);
  doc.save(`pami-${mesKey}.pdf`);
}
