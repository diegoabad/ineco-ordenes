import { richHtmlToPdfText } from "./richText";
import type { PresupuestoItem } from "../types";
import { etiquetaFrecuencia } from "../types";

export function formatDuracionPresupuesto(minutos: number): string | null {
  if (!minutos || minutos <= 0) return null;
  return minutos === 1 ? "1 minuto" : `${minutos} minutos`;
}

/** Quita menciones de duración del texto libre; la duración sale de `duracionMinutos`. */
function stripDuracionFromDescripcion(text: string): string {
  return text
    .replace(/\(?\s*Duraci[oó]n estimada\s*:\s*[^.)\n]+\)?\.?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatHonorariosSesion(value: number): string | null {
  if (!value || value <= 0) return null;
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
  return `$${formatted}.-`;
}

function formatPrestacionBlock(
  item: Pick<
    PresupuestoItem,
    "titulo" | "descripcion" | "duracionMinutos" | "frecuencia" | "sesiones" | "precioEfectivo"
  >,
  boldTitles = false,
): string {
  const lines: string[] = [];
  const titulo = item.titulo.trim();
  if (titulo) lines.push(boldTitles ? `**[[u]]${titulo}[[/u]]**` : titulo);

  const descripcion = stripDuracionFromDescripcion(richHtmlToPdfText(item.descripcion)).trim();
  if (descripcion) lines.push(descripcion);

  const frecuencia = etiquetaFrecuencia(item.frecuencia, item.sesiones);
  if (item.frecuencia?.trim() && frecuencia !== "—") {
    lines.push(`Frecuencia: ${frecuencia}`);
    const honorarios = formatHonorariosSesion(item.precioEfectivo);
    if (honorarios) lines.push(`Honorarios por sesión: ${honorarios}`);
  } else {
    const duracion = formatDuracionPresupuesto(item.duracionMinutos);
    if (duracion) lines.push(`(Duración estimada: ${duracion})`);
  }

  return lines.join("\n\n");
}

export function formatListaPrestaciones(
  items: Pick<
    PresupuestoItem,
    "titulo" | "descripcion" | "duracionMinutos" | "frecuencia" | "sesiones" | "precioEfectivo"
  >[],
  options?: { boldTitles?: boolean },
): string {
  if (!items.length) return "";
  const boldTitles = options?.boldTitles !== false;
  return items.map((item) => formatPrestacionBlock(item, boldTitles)).filter(Boolean).join("\n\n");
}
