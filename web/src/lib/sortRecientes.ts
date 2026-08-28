type ConCreadoAt = { creadoAt?: string };

export function creadoAtMs(value?: string): number {
  if (!value?.trim()) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/** Más recientes primero; desempate opcional (p. ej. nombre). */
export function sortRecientes<T extends ConCreadoAt>(
  items: T[],
  tieBreak?: (a: T, b: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const diff = creadoAtMs(b.creadoAt) - creadoAtMs(a.creadoAt);
    if (diff !== 0) return diff;
    return tieBreak?.(a, b) ?? 0;
  });
}
