/** Calcula totales de un presupuesto (con recargo si es paciente externo). */
export function calcPresupuestoTotales(
  items: Array<{ precioEfectivo: number; precio3Cuotas: number }>,
  opts: { pacienteExterno: boolean; recargoExternoPorcentaje: number },
): { totalEfectivo: number; total3Cuotas: number; baseEfectivo: number } {
  const baseEfectivo = items.reduce((s, i) => s + (Number(i.precioEfectivo) || 0), 0);
  const base3 = items.reduce((s, i) => s + (Number(i.precio3Cuotas) || 0), 0);
  if (!opts.pacienteExterno) {
    return { totalEfectivo: baseEfectivo, total3Cuotas: base3, baseEfectivo };
  }
  const pct = Math.max(0, Number(opts.recargoExternoPorcentaje) || 0);
  const totalEfectivo = Math.round(baseEfectivo * (1 + pct / 100));
  return { totalEfectivo, total3Cuotas: 0, baseEfectivo };
}

export function normalizeRecargoExternoPorcentaje(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1000, Math.round(n * 100) / 100);
}
