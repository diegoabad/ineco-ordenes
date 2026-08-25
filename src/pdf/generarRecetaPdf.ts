import { jsPDF } from "jspdf";
import {
  LOGO_INECO_DATA_URL,
  LOGO_INECO_FORMAT,
  LOGO_INECO_HEIGHT,
  LOGO_INECO_WIDTH,
} from "../assets/logoIneco";
import { parsePrestaciones } from "../lib/prestaciones";
import type { ConfigMedico, Paciente } from "../types";

const MARGIN = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = PAGE_W - MARGIN;

const TEXT = [17, 24, 39] as const;
const MUTED = [75, 85, 99] as const;
const LINE = [209, 213, 219] as const;

/** Logo principal (cabecera). */
const LOGO_W = 118;
const LOGO_H = LOGO_W * (LOGO_INECO_HEIGHT / LOGO_INECO_WIDTH);

/** Logo chico del pie (al lado del texto). */
const FOOTER_LOGO_W = 48;
const FOOTER_LOGO_H = FOOTER_LOGO_W * (LOGO_INECO_HEIGHT / LOGO_INECO_WIDTH);

function formatFecha(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function drawLine(doc: jsPDF, y: number) {
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.7);
  doc.line(MARGIN, y, RIGHT, y);
}

function drawLogoIneco(
  doc: jsPDF,
  centerX: number,
  topY: number,
  width = LOGO_W,
  height = LOGO_H,
) {
  const x = centerX - width / 2;
  try {
    doc.addImage(LOGO_INECO_DATA_URL, LOGO_INECO_FORMAT, x, topY, width, height);
  } catch {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(width > 80 ? 18 : 10);
    doc.setTextColor(...TEXT);
    doc.text("INECO", centerX, topY + height * 0.72, { align: "center" });
  }
}

function dibujarReceta(doc: jsPDF, paciente: Paciente, medico: ConfigMedico, fecha: string) {
  const fechaFmt = formatFecha(fecha);
  let y = 28;

  // —— Header: logo + fecha ——
  drawLogoIneco(doc, PAGE_W / 2, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT);
  doc.text(fechaFmt, RIGHT, y + 20, { align: "right" });
  y += LOGO_H + 32;

  // —— Médico ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...TEXT);
  doc.text(medico.nombre || "—", PAGE_W / 2, y, { align: "center" });
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(medico.especialidad || "—", PAGE_W / 2, y, { align: "center" });
  y += 12;
  doc.setFontSize(8);
  doc.text(`Matrícula Nac.: ${medico.matricula || "—"}`, PAGE_W / 2, y, { align: "center" });
  y += 14;
  drawLine(doc, y);
  y += 18;

  // —— Paciente ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  doc.text("Paciente", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(paciente.paciente || "—", MARGIN + 52, y);
  y += 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  doc.text("Obra social", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(paciente.obraSocial || "—", MARGIN + 58, y);
  y += 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  doc.text("Afiliado", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(paciente.afiliado || "—", MARGIN + 48, y);
  y += 14;
  drawLine(doc, y);
  y += 22;

  // —— Prestación ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...TEXT);
  doc.text("Rp//", MARGIN, y);
  y += 28; // un poco más de aire antes del primer ítem (~medio renglón extra)

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...TEXT);
  const lineH = 15;
  const gapEntreItems = 8; // medio renglón entre prestaciones
  const prestaciones = parsePrestaciones(paciente.prestacion);
  if (prestaciones.length === 0) {
    doc.text("- —", MARGIN + 4, y);
    y += lineH + 8;
  } else {
    prestaciones.forEach((item, index) => {
      const lines = doc.splitTextToSize(`- ${item}`, CONTENT_W - 8);
      doc.text(lines, MARGIN + 4, y);
      y += lines.length * lineH;
      if (index < prestaciones.length - 1) y += gapEntreItems;
    });
    y += 8;
  }

  const diagnostico = paciente.diagnostico?.trim();
  if (diagnostico) {
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...TEXT);
    const dxLines = doc.splitTextToSize(`DX: ${diagnostico}`, CONTENT_W - 8);
    doc.text(dxLines, MARGIN + 4, y);
    y += dxLines.length * lineH;
  }

  // —— Firma (solo imagen + datos del médico) ——
  const firmaTop = Math.max(y + 48, PAGE_H - 230);
  drawFirma(doc, medico, firmaTop);

  drawFooter(doc);
}

function drawFirma(doc: jsPDF, medico: ConfigMedico, y: number) {
  const firmaW = 180;
  const firmaX = RIGHT - firmaW;
  const maxImgW = 170;
  const maxImgH = 85;

  let selloY = y + 36;

  if (medico.firmaDataUrl) {
    try {
      const fmt = medico.firmaDataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
      const props = doc.getImageProperties(medico.firmaDataUrl);
      const naturalW = props.width || 1;
      const naturalH = props.height || 1;
      const scale = Math.min(maxImgW / naturalW, maxImgH / naturalH);
      const drawW = naturalW * scale;
      const drawH = naturalH * scale;
      const imgX = firmaX + (firmaW - drawW) / 2;
      const imgY = y - 4;
      doc.addImage(medico.firmaDataUrl, fmt, imgX, imgY, drawW, drawH);
      selloY = imgY + drawH + 8;
    } catch {
      selloY = y + 36;
    }
  }

  doc.setDrawColor(156, 163, 175);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(firmaX, selloY, firmaX + firmaW, selloY);
  doc.setLineDashPattern([], 0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  doc.text(medico.nombre || "—", firmaX + firmaW / 2, selloY + 14, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const espCorta = (medico.especialidad || "").split("-")[0]?.trim() || "Médico";
  doc.text(espCorta, firmaX + firmaW / 2, selloY + 26, { align: "center" });
  doc.text(`MN ${medico.matricula || "—"}`, firmaX + firmaW / 2, selloY + 38, { align: "center" });
}

function drawFooter(doc: jsPDF) {
  const lineY = PAGE_H - 44;
  drawLine(doc, lineY);

  const logoW = FOOTER_LOGO_W;
  const logoH = FOOTER_LOGO_H;
  const gap = 8;
  const label = "Orden generada por";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const labelW = doc.getTextWidth(label);
  const totalW = labelW + gap + logoW;
  const startX = (PAGE_W - totalW) / 2;
  const rowCenterY = lineY + 8 + logoH / 2;

  doc.text(label, startX, rowCenterY + 3);
  drawLogoIneco(doc, startX + labelW + gap + logoW / 2, rowCenterY - logoH / 2, logoW, logoH);
}

export function generarPdfRecetas(
  items: { paciente: Paciente; medico: ConfigMedico }[],
  fecha: string,
): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  items.forEach((item, index) => {
    if (index > 0) doc.addPage();
    dibujarReceta(doc, item.paciente, item.medico, fecha);
  });
  return doc;
}

export function pdfBlobFromDoc(doc: jsPDF): Blob {
  return doc.output("blob");
}
