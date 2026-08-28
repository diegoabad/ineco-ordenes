import { jsPDF } from "jspdf";
import { PDF_ALIGN_MARKER_RE, PDF_SIZE_MARKER_RE, RICH_SIZE_PDF_PT, type RichTextSize } from "../lib/richText";
import {
  LOGO_INECO_DATA_URL,
  LOGO_INECO_FORMAT,
  LOGO_INECO_HEIGHT,
  LOGO_INECO_WIDTH,
} from "../assets/logoIneco";

const MARGIN = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = PAGE_W - MARGIN;

const TEXT = [17, 24, 39] as const;
const MUTED = [75, 85, 99] as const;
const LINE = [209, 213, 219] as const;

const HEADER_LOGO_W = 96;
const HEADER_LOGO_H = HEADER_LOGO_W * (LOGO_INECO_HEIGHT / LOGO_INECO_WIDTH);
const HEADER_TITLE_SIZE = 22;
const HEADER_DATE_SIZE = 10;
/** Aire extra debajo del logo antes de la línea separadora. */
const HEADER_LINE_EXTRA = 12;
/** Separación entre la línea y el inicio del cuerpo (“Estimado…”). */
const HEADER_LINE_TO_BODY = 26;
const HEADER_TOP = 24;
/** Y de inicio del cuerpo, alineado con el retorno de `drawHeader`. */
const BODY_START_Y = HEADER_TOP + HEADER_LOGO_H + HEADER_LINE_EXTRA + HEADER_LINE_TO_BODY;

const FOOTER_LOGO_W = 40;
const FOOTER_LOGO_H = FOOTER_LOGO_W * (LOGO_INECO_HEIGHT / LOGO_INECO_WIDTH);
const FOOTER_BOTTOM_MARGIN = 10;
const FOOTER_LINE_GAP = 6;
const FOOTER_RESERVE = FOOTER_BOTTOM_MARGIN + FOOTER_LOGO_H + FOOTER_LINE_GAP + 10;

export type PresupuestoPdfInput = {
  fecha: string;
  body: string;
};

function formatFecha(ymd: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function drawLine(doc: jsPDF, y: number) {
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

function drawHeader(doc: jsPDF, fecha: string): number {
  drawLogoIneco(doc, MARGIN, HEADER_TOP, HEADER_LOGO_W, HEADER_LOGO_H, "left");

  // Título y fecha centrados verticalmente con el logo (no con la banda hasta la línea).
  const logoCenterY = HEADER_TOP + HEADER_LOGO_H / 2;
  const titleBaseline = logoCenterY + HEADER_TITLE_SIZE * 0.35;
  const dateBaseline = logoCenterY + HEADER_DATE_SIZE * 0.35;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(HEADER_TITLE_SIZE);
  doc.setTextColor(...TEXT);
  doc.text("Presupuesto", PAGE_W / 2, titleBaseline, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(HEADER_DATE_SIZE);
  doc.setTextColor(...TEXT);
  doc.text(formatFecha(fecha), RIGHT, dateBaseline, { align: "right" });

  const lineY = HEADER_TOP + HEADER_LOGO_H + HEADER_LINE_EXTRA;
  drawLine(doc, lineY);
  return BODY_START_Y;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, fecha: string): number {
  if (y + needed <= PAGE_H - FOOTER_RESERVE) return y;
  doc.addPage();
  return drawHeader(doc, fecha);
}

const BLANK_LINE_HEIGHT = 8;
const LINE_HEIGHT_BY_SIZE: Record<RichTextSize, number> = {
  sm: 11,
  md: 13,
  lg: 17,
};
const LINE_GAP_AFTER = 2;

type TextSegment = { text: string; bold: boolean; underline: boolean; size: RichTextSize };
type PdfAlign = "left" | "center" | "right";

function parseLineMeta(line: string): { align: PdfAlign; size: RichTextSize; text: string } {
  let align: PdfAlign = "left";
  let size: RichTextSize = "md";
  let text = line;

  while (true) {
    const alignMatch = PDF_ALIGN_MARKER_RE.exec(text);
    if (alignMatch) {
      align = alignMatch[1] as PdfAlign;
      text = text.slice(alignMatch[0].length);
      continue;
    }
    const sizeMatch = PDF_SIZE_MARKER_RE.exec(text);
    if (sizeMatch) {
      size = sizeMatch[1] as RichTextSize;
      text = text.slice(sizeMatch[0].length);
      continue;
    }
    break;
  }

  // Por si quedó algún marcador suelto en el medio
  text = text
    .replace(/\[\[align:(?:left|center|right)\]\]/g, "")
    .replace(/\[\[\/size\]\]/g, "");

  return { align, size, text };
}

function parseUnderlineSegments(
  text: string,
  bold: boolean,
  size: RichTextSize,
): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = /\[\[u\]\]([\s\S]*?)\[\[\/u\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        bold,
        underline: false,
        size,
      });
    }
    segments.push({ text: match[1]!, bold, underline: true, size });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold, underline: false, size });
  }

  if (segments.length === 0) {
    segments.push({ text, bold, underline: false, size });
  }

  return segments;
}

function parseBoldSegments(text: string, size: RichTextSize): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(...parseUnderlineSegments(text.slice(lastIndex, match.index), false, size));
    }
    segments.push(...parseUnderlineSegments(match[1]!, true, size));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push(...parseUnderlineSegments(text.slice(lastIndex), false, size));
  }

  if (segments.length === 0) {
    segments.push({ text, bold: false, underline: false, size });
  }

  return segments;
}

/** Segmentos con negrita, subrayado y tamaño inline `[[size:x]]...[[/size]]`. */
function parseStyledSegments(line: string, defaultSize: RichTextSize): TextSegment[] {
  const segments: TextSegment[] = [];
  const re = /\[\[size:(sm|md|lg)\]\]([\s\S]*?)\[\[\/size\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(line)) !== null) {
    if (match.index > lastIndex) {
      segments.push(...parseBoldSegments(line.slice(lastIndex, match.index), defaultSize));
    }
    segments.push(...parseBoldSegments(match[2]!, match[1] as RichTextSize));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    segments.push(...parseBoldSegments(line.slice(lastIndex), defaultSize));
  }

  if (segments.length === 0) {
    segments.push({ text: line, bold: false, underline: false, size: defaultSize });
  }

  return segments
    .map((s) => ({
      ...s,
      text: s.text
        .replace(/\[\[align:(?:left|center|right)\]\]/g, "")
        .replace(/\[\[size:(?:sm|md|lg)\]\]/g, "")
        .replace(/\[\[\/size\]\]/g, "")
        .replace(/\[\[\/?u\]\]/g, ""),
    }))
    .filter((s) => s.text.length > 0);
}

function applySegmentFont(doc: jsPDF, segment: Pick<TextSegment, "bold" | "size">) {
  doc.setFont("helvetica", segment.bold ? "bold" : "normal");
  doc.setFontSize(RICH_SIZE_PDF_PT[segment.size]);
}

function segmentWidth(doc: jsPDF, segment: TextSegment): number {
  applySegmentFont(doc, segment);
  return doc.getTextWidth(segment.text);
}

/** Parte el texto en filas que caben en `maxWidth`, respetando negrita/tamaño. */
function wrapSegmentsToRows(doc: jsPDF, segments: TextSegment[], maxWidth: number): TextSegment[][] {
  const rows: TextSegment[][] = [[]];
  let rowWidth = 0;

  function pushRow() {
    rows.push([]);
    rowWidth = 0;
  }

  function addPiece(piece: TextSegment) {
    const w = segmentWidth(doc, piece);
    rows[rows.length - 1]!.push(piece);
    rowWidth += w;
  }

  for (const segment of segments) {
    const tokens = segment.text.split(/(\s+)/).filter((t) => t.length > 0);

    for (const token of tokens) {
      const isSpace = /^\s+$/.test(token);
      const piece: TextSegment = {
        text: token,
        bold: segment.bold,
        underline: segment.underline,
        size: segment.size,
      };
      applySegmentFont(doc, piece);
      const w = doc.getTextWidth(token);

      if (isSpace) {
        if (rowWidth === 0) continue;
        if (rowWidth + w > maxWidth) {
          pushRow();
          continue;
        }
        addPiece(piece);
        continue;
      }

      if (rowWidth > 0 && rowWidth + w > maxWidth) {
        pushRow();
      }

      if (w > maxWidth) {
        const chunks = doc.splitTextToSize(token, maxWidth) as string[];
        for (let i = 0; i < chunks.length; i += 1) {
          if (i > 0 || rowWidth > 0) {
            if (rowWidth > 0) pushRow();
          }
          addPiece({
            text: chunks[i]!,
            bold: segment.bold,
            underline: segment.underline,
            size: segment.size,
          });
        }
        continue;
      }

      addPiece(piece);
    }
  }

  return rows.filter((row) => row.some((s) => s.text.trim().length > 0));
}

function rowWidth(doc: jsPDF, row: TextSegment[]): number {
  return row.reduce((sum, segment) => sum + segmentWidth(doc, segment), 0);
}

function drawUnderline(doc: jsPDF, x: number, y: number, width: number) {
  if (width <= 0) return;
  doc.setDrawColor(...TEXT);
  doc.setLineWidth(0.7);
  doc.line(x, y + 1.4, x + width, y + 1.4);
}

function drawPdfLine(doc: jsPDF, line: string, y: number, fecha: string): number {
  const { align, size: lineSize, text } = parseLineMeta(line);
  const segments = parseStyledSegments(text, lineSize);
  if (segments.length === 0) return y;

  const rows = wrapSegmentsToRows(doc, segments, CONTENT_W);
  if (rows.length === 0) return y;

  const lineHeight = Math.max(...segments.map((s) => LINE_HEIGHT_BY_SIZE[s.size]));

  y = ensureSpace(doc, y, rows.length * lineHeight + 6, fecha);
  doc.setTextColor(...TEXT);

  for (const row of rows) {
    const width = rowWidth(doc, row);
    let x = MARGIN;
    if (align === "center") x = (PAGE_W - width) / 2;
    else if (align === "right") x = RIGHT - width;

    for (const segment of row) {
      applySegmentFont(doc, segment);
      doc.text(segment.text, x, y);
      const w = doc.getTextWidth(segment.text);
      if (segment.underline) drawUnderline(doc, x, y, w);
      x += w;
    }
    y += lineHeight;
  }

  return y + LINE_GAP_AFTER;
}

function drawBodyText(doc: jsPDF, text: string, startY: number, fecha: string): number {
  let y = startY;
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    if (!rawLine.trim()) {
      y = ensureSpace(doc, y, BLANK_LINE_HEIGHT, fecha);
      y += BLANK_LINE_HEIGHT;
      continue;
    }
    y = drawPdfLine(doc, rawLine, y, fecha);
  }

  return y;
}

function drawFooter(doc: jsPDF, page: number, totalPages: number) {
  const fontSize = 9;
  const logoW = FOOTER_LOGO_W;
  const logoH = FOOTER_LOGO_H;
  const gap = 8;
  const label = "Presupuesto generado por";
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
  drawLine(doc, lineY);

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

export function generarPdfPresupuesto(input: PresupuestoPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const y = drawHeader(doc, input.fecha);
  drawBodyText(doc, input.body.trim() || "—", y, input.fecha);
  drawFootersOnAllPages(doc);
  return doc;
}

export function pdfBlobFromDoc(doc: jsPDF): Blob {
  return doc.output("blob");
}
