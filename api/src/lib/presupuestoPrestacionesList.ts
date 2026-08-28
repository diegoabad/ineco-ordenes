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

function formatPrestacionBlock(
  item: Pick<PresupuestoItem, "titulo" | "descripcion" | "duracionMinutos">,
  boldTitles = false,
): string {
  const lines: string[] = [];
  const titulo = item.titulo.trim();
  if (titulo) lines.push(boldTitles ? `**[[u]]${titulo}[[/u]]**` : titulo);

  const descripcion = stripDuracionFromDescripcion(descripcionToListaText(item.descripcion)).trim();
  if (descripcion) lines.push(descripcion);

  const duracion = formatDuracionPresupuesto(item.duracionMinutos);
  if (duracion) lines.push(`(Duración estimada: ${duracion})`);

  return lines.join("\n\n");
}

export function formatListaPrestaciones(
  items: Pick<PresupuestoItem, "titulo" | "descripcion" | "duracionMinutos">[],
  options?: { boldTitles?: boolean },
): string {
  if (!items.length) return "";
  const boldTitles = options?.boldTitles !== false;
  return items.map((item) => formatPrestacionBlock(item, boldTitles)).filter(Boolean).join("\n\n");
}
