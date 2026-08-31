const MESES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** Ej: "2026-07" → "Julio 2026" (sin "de"). */
export function mesLabelFromKey(mesKey: string): string {
  const [y, m] = mesKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return mesKey;
  return `${MESES_ES[m - 1]} ${y}`;
}
