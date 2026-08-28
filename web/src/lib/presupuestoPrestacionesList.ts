import { richHtmlToPdfText } from "./richText";
import type { PresupuestoItem } from "../types";

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

function formatPrestacionBlock(
  item: Pick<PresupuestoItem, "titulo" | "descripcion" | "duracionMinutos">,
  boldTitles = false,
): string {
  const lines: string[] = [];
  const titulo = item.titulo.trim();
  if (titulo) lines.push(boldTitles ? `**[[u]]${titulo}[[/u]]**` : titulo);

  const descripcion = stripDuracionFromDescripcion(richHtmlToPdfText(item.descripcion)).trim();
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
