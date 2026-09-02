/** Guarda nombres en minúsculas; muestra Title Case. */

export function normalizeNombrePersona(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-AR");
}

/** Primera letra de cada palabra en mayúscula (para PDF / email). */
export function formatNombrePersona(value: string): string {
  const n = normalizeNombrePersona(value);
  if (!n) return "";
  return n
    .split(" ")
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase("es-AR") + w.slice(1) : w))
    .join(" ");
}
