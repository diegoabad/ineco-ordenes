/** Muestra un número en formato es-AR (sin símbolo de moneda). */
export function formatMoneyInputDisplay(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";

  const hasDecimals = Math.round(value * 100) % 100 !== 0;
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(value);
}

/** Formatea el texto mientras el usuario escribe (separador de miles en vivo). */
export function formatMoneyInputWhileTyping(input: string): string {
  const cleaned = input.replace(/[^\d,]/g, "");
  const commaIndex = cleaned.indexOf(",");

  let intPart: string;
  let decPart: string | undefined;
  let hasComma = false;

  if (commaIndex >= 0) {
    hasComma = true;
    intPart = cleaned.slice(0, commaIndex).replace(/\D/g, "");
    decPart = cleaned.slice(commaIndex + 1).replace(/\D/g, "").slice(0, 2);
  } else {
    intPart = cleaned.replace(/\D/g, "");
  }

  if (!intPart && !hasComma) return "";

  intPart = intPart.replace(/^0+(?=\d)/, "");
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  if (hasComma) {
    return decPart !== undefined ? `${formattedInt || "0"},${decPart}` : `${formattedInt || "0"},`;
  }

  return formattedInt;
}

export function parseMoneyInput(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const normalized = trimmed.replace(/\./g, "").replace(/,$/, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
