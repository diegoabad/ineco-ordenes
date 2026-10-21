import { looksLikeRichHtml } from "./richText.js";
import type { PresupuestoItem } from "../types.js";

export function formatDuracionPresupuesto(minutos: number): string | null {
  if (!minutos || minutos <= 0) return null;
  return minutos === 1 ? "1 minuto" : `${minutos} minutos`;
}

/** Conserva saltos y negrita básica de la descripción HTML para la lista. */
function descripcionToListaText(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "";
  if (!looksLikeRichHtml(trimmed)) return trimmed.replace(/\r\n/g, "\n");

  return trimmed
    .replace(/\r\n/g, "\n")
    .replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
    .replace(/<(?:u)\b[^>]*>([\s\S]*?)<\/(?:u)>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Quita menciones de duración del texto libre; la duración sale de `duracionMinutos`. */
function stripDuracionFromDescripcion(text: string): string {
  return text
    .replace(/\(?\s*Duraci[oó]n estimada\s*:\s*[^.)\n]+\)?\.?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fraseSesiones(n: number, periodo: "semanal" | "quincenal" | "mensual"): string {
  const plural =
    periodo === "semanal" ? "semanales" : periodo === "quincenal" ? "quincenales" : "mensuales";
  if (n === 1) return `1 sesión ${periodo}`;
  return `${n} sesiones ${plural}`;
}

function textoFrecuencia(frecuencia: string | null | undefined, sesiones: number | null | undefined): string {
  if (!frecuencia?.trim()) return "";
  const n = sesiones && sesiones >= 1 ? Math.round(sesiones) : 1;
  const f = frecuencia.trim();
  if (f === "Semanal") return `${fraseSesiones(n, "semanal")}, ${fraseSesiones(n * 4, "mensual")}`;
  if (f === "Mensual") {
    const semanales = n / 4;
    if (Number.isInteger(semanales) && semanales >= 1) {
      return `${fraseSesiones(semanales, "semanal")}, ${fraseSesiones(n, "mensual")}`;
    }
    return fraseSesiones(n, "mensual");
  }
  if (f === "Quincenal") {
    return `${fraseSesiones(n, "quincenal")}, ${fraseSesiones(n * 2, "mensual")}`;
  }
  return n === 1 ? "1 sesión" : `${n} sesiones`;
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

  const descripcion = stripDuracionFromDescripcion(descripcionToListaText(item.descripcion)).trim();
  if (descripcion) lines.push(descripcion);

  const frecuencia = textoFrecuencia(item.frecuencia, item.sesiones);
  if (frecuencia) {
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
