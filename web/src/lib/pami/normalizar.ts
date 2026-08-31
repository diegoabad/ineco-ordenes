/**
 * Unifica el n° de afiliado entre Presentación (espacio normal) y Débitos (NBSP),
 * y filtra filas sin afiliado válido (totales del Excel INECO).
 */
export function normalizarAfiliado(v: unknown): string | null {
  const soloDigitos = String(v ?? "").replace(/\D/g, "");
  return soloDigitos.length >= 10 ? soloDigitos : null;
}

/** Texto de celda normalizado para detectar encabezados. */
export function normalizarTextoCelda(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[°ºª]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** True si la celda representa la columna de afiliado (Afiliado / N° de Afiliado). */
export function celdaEsAfiliadoHeader(v: unknown): boolean {
  const t = normalizarTextoCelda(v);
  if (!t) return false;
  // "afiliado", "n de afiliado", "n° de afiliado", "nro de afiliado", etc.
  return (
    t === "afiliado" ||
    t.includes("afiliado")
  );
}
