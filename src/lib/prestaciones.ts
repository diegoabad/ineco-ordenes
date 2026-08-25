/** Cada línea no vacía del textarea es una prestación. */
export function parsePrestaciones(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function resumenPrestaciones(raw: string | null | undefined): string {
  const items = parsePrestaciones(raw);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items[0]} (+${items.length - 1})`;
}
