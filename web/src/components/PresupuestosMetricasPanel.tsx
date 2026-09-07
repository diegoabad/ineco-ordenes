import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { compareYmd, fechaHoyIso, formatFechaYmd, toYmd } from "../lib/fechas";
import { formatNombrePersona } from "../lib/nombrePersona";
import { fetchPresupuestos } from "../services/dataService";
import {
  PRESUPUESTO_ESTADO_LABEL,
  type Presupuesto,
  type PresupuestoEstado,
} from "../types";
import { DatePicker } from "./DatePicker";
import { IconDownload, IconPdf } from "./Icons";
import {
  exportMetricasExcel,
  exportMetricasPdf,
  type MetricasExportData,
} from "../lib/presupuestosMetricasExport";

type PeriodStats = {
  total: number;
  byEstado: Record<PresupuestoEstado, number>;
  byProfesional: { name: string; count: number }[];
  byPrestacion: { name: string; count: number }[];
};

const MES_INICIO_METRICAS = "2026-08";

const NOMBRES_MES = [
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

function currentMesKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function mesLabelFromKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return `${NOMBRES_MES[m - 1]} ${y}`;
}

/** Meses desde Agosto 2026 hasta el mes actual (más recientes primero). */
function buildMesOptions(): Array<{ value: string; label: string }> {
  const end = currentMesKey();
  const [endY, endM] = end.split("-").map(Number);
  const [startY, startM] = MES_INICIO_METRICAS.split("-").map(Number);
  const opts: Array<{ value: string; label: string }> = [];
  let y = startY!;
  let m = startM!;
  const lastY = endY! < startY! || (endY === startY && endM! < startM!) ? startY! : endY!;
  const lastM = endY! < startY! || (endY === startY && endM! < startM!) ? startM! : endM!;
  while (y < lastY || (y === lastY && m <= lastM)) {
    const value = `${y}-${String(m).padStart(2, "0")}`;
    opts.push({ value, label: mesLabelFromKey(value) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return opts.reverse();
}

function rangeForMesKey(key: string, hoy: string): { desde: string; hasta: string } {
  const [y, m] = key.split("-").map(Number);
  const year = y!;
  const monthIndex = (m ?? 1) - 1;
  const desde = toYmd(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  let hasta = toYmd(year, monthIndex, lastDay);
  if (compareYmd(hasta, hoy) > 0) hasta = hoy;
  if (compareYmd(desde, hoy) > 0) {
    return { desde: hoy, hasta: hoy };
  }
  return { desde, hasta };
}

/** Si desde/hasta cubren exactamente un mes del select, lo devolvemos. */
function mesKeyFromRange(desde: string, hasta: string, hoy: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return "";
  const key = desde.slice(0, 7);
  const expected = rangeForMesKey(key, hoy);
  if (desde === expected.desde && hasta === expected.hasta) return key;
  return "";
}

function presupuestoDateKey(p: Presupuesto): string {
  if (p.fecha && /^\d{4}-\d{2}-\d{2}/.test(p.fecha)) return p.fecha.slice(0, 10);
  if (p.creadoAt) {
    const d = new Date(p.creadoAt);
    if (!Number.isNaN(d.getTime())) {
      return toYmd(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }
  if (p.ultimoEnvioAt) {
    const d = new Date(p.ultimoEnvioAt);
    if (!Number.isNaN(d.getTime())) {
      return toYmd(d.getFullYear(), d.getMonth(), d.getDate());
    }
  }
  return "";
}

function inRange(ymd: string, desde: string, hasta: string): boolean {
  if (!ymd) return false;
  return ymd >= desde && ymd <= hasta;
}

function emptyByEstado(): Record<PresupuestoEstado, number> {
  return { pendiente: 0, enviado: 0, aceptado: 0, rechazado: 0, fallido: 0 };
}

function computeStats(items: Presupuesto[], desde: string, hasta: string): PeriodStats {
  const filtered = items.filter((p) => inRange(presupuestoDateKey(p), desde, hasta));
  const byEstado = emptyByEstado();
  const profMap = new Map<string, number>();
  const prestMap = new Map<string, number>();

  for (const p of filtered) {
    byEstado[p.estado] += 1;
    const prof = formatNombrePersona(p.profesional) || "Sin profesional";
    profMap.set(prof, (profMap.get(prof) ?? 0) + 1);
    for (const item of p.items ?? []) {
      const name = item.titulo?.trim() || "Sin título";
      prestMap.set(name, (prestMap.get(name) ?? 0) + 1);
    }
  }

  const sortDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;

  return {
    total: filtered.length,
    byEstado,
    byProfesional: [...profMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(sortDesc)
      .slice(0, 12),
    byPrestacion: [...prestMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(sortDesc)
      .slice(0, 12),
  };
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "error" | "muted";
}) {
  return (
    <div className={`metrics-kpi${tone ? ` metrics-kpi--${tone}` : ""}`}>
      <p className="metrics-kpi__label">{label}</p>
      <p className="metrics-kpi__value">{value}</p>
    </div>
  );
}

function BarList({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; count: number }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <section className="metrics-card">
      <h3 className="metrics-card__title">{title}</h3>
      {rows.length === 0 ? (
        <p className="metrics-card__empty">Sin datos en el rango</p>
      ) : (
        <ul className="metrics-bars">
          {rows.map((row) => {
            const width = `${Math.round((row.count / max) * 100)}%`;
            return (
              <li key={row.name} className="metrics-bars__row">
                <div className="metrics-bars__meta">
                  <span className="metrics-bars__name" title={row.name}>
                    {row.name}
                  </span>
                  <span className="metrics-bars__count">{row.count}</span>
                </div>
                <div className="metrics-bars__track" aria-hidden>
                  <div className="metrics-bars__fill" style={{ width }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PresupuestosMetricasPanel() {
  const hoy = fechaHoyIso();
  const mesOptions = useMemo(() => buildMesOptions(), []);
  const mesInicial = useMemo(() => {
    const actual = currentMesKey();
    return actual < MES_INICIO_METRICAS ? MES_INICIO_METRICAS : actual;
  }, []);

  const initialRange = useMemo(() => rangeForMesKey(mesInicial, hoy), [mesInicial, hoy]);

  const [items, setItems] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState(initialRange.desde);
  const [hasta, setHasta] = useState(initialRange.hasta);
  const [mesKey, setMesKey] = useState(mesInicial);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchPresupuestos());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar métricas");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const stats = useMemo(() => computeStats(items, desde, hasta), [items, desde, hasta]);

  const enviados =
    stats.byEstado.enviado + stats.byEstado.aceptado + stats.byEstado.rechazado;

  const exportData = useMemo((): MetricasExportData => {
    const estadosVisibles = [
      { estado: "enviado" as const, tone: "muted" as const },
      { estado: "aceptado" as const, tone: "ok" as const },
      { estado: "rechazado" as const, tone: "error" as const },
    ];
    return {
      desde,
      hasta,
      mesLabel: mesKey ? mesLabelFromKey(mesKey) : undefined,
      total: stats.total,
      enviados,
      aceptados: stats.byEstado.aceptado,
      rechazados: stats.byEstado.rechazado,
      byEstado: estadosVisibles.map(({ estado, tone }) => ({
        label: PRESUPUESTO_ESTADO_LABEL[estado],
        count: stats.byEstado[estado],
        pct: enviados ? Math.round((stats.byEstado[estado] / enviados) * 100) : 0,
        tone,
      })),
      byProfesional: stats.byProfesional,
      byPrestacion: stats.byPrestacion,
    };
  }, [desde, hasta, mesKey, stats, enviados]);

  function applyMes(key: string) {
    const range = rangeForMesKey(key, hoy);
    setMesKey(key);
    setDesde(range.desde);
    setHasta(range.hasta);
  }

  function onDesdeChange(next: string) {
    let v = next;
    if (v && compareYmd(v, hoy) > 0) v = hoy;
    if (v && hasta && compareYmd(v, hasta) > 0) v = hasta;
    setDesde(v);
    setMesKey(mesKeyFromRange(v, hasta, hoy));
  }

  function onHastaChange(next: string) {
    let v = next;
    if (v && compareYmd(v, hoy) > 0) v = hoy;
    if (v && desde && compareYmd(v, desde) < 0) v = desde;
    setHasta(v);
    setMesKey(mesKeyFromRange(desde, v, hoy));
  }

  return (
    <div className="metrics-panel">
      <section className="fl-table-card metrics-filters-card">
        <div className="table-toolbar table-toolbar--filters metrics-filters">
          <div className="form-group metrics-filters__month">
            <label htmlFor="metricas-mes">Mes</label>
            <select
              id="metricas-mes"
              value={mesKey}
              onChange={(e) => {
                const key = e.target.value;
                if (!key) return;
                applyMes(key);
              }}
              aria-label="Mes a consultar"
            >
              {mesKey === "" ? <option value="">Personalizado</option> : null}
              {mesOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group metrics-filters__date">
            <label htmlFor="metricas-desde">Desde</label>
            <DatePicker
              id="metricas-desde"
              value={desde}
              onChange={onDesdeChange}
              max={hasta && compareYmd(hasta, hoy) < 0 ? hasta : hoy}
              aria-label="Fecha desde"
              compact
            />
          </div>
          <div className="form-group metrics-filters__date">
            <label htmlFor="metricas-hasta">Hasta</label>
            <DatePicker
              id="metricas-hasta"
              value={hasta}
              onChange={onHastaChange}
              min={desde || undefined}
              max={hoy}
              aria-label="Fecha hasta"
              compact
            />
          </div>
          <div className="form-group metrics-filters__export">
            <span className="metrics-filters__export-label" aria-hidden>
              &nbsp;
            </span>
            <div className="metrics-filters__export-btns">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={loading}
                onClick={() => {
                  try {
                    exportMetricasExcel(exportData);
                    toast.success("Excel descargado");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "No se pudo exportar Excel");
                  }
                }}
              >
                <IconDownload size={14} />
                Excel
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={loading}
                onClick={() => {
                  try {
                    exportMetricasPdf(exportData);
                    toast.success("PDF descargado");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "No se pudo exportar PDF");
                  }
                }}
              >
                <IconPdf size={14} />
                PDF
              </button>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="fl-table-empty">
          <p className="fl-table-empty__title">Cargando métricas…</p>
        </div>
      ) : (
        <>
          <p className="metrics-range-hint">
            Periodo: <strong>{formatFechaYmd(desde)}</strong> –{" "}
            <strong>{formatFechaYmd(hasta)}</strong>
            {mesKey ? (
              <>
                {" "}
                · <strong>{mesLabelFromKey(mesKey)}</strong>
              </>
            ) : null}
          </p>

          <div className="metrics-kpi-grid">
            <KpiCard label="Total" value={stats.total} />
            <KpiCard label="Enviados" value={enviados} tone="muted" />
            <KpiCard
              label={PRESUPUESTO_ESTADO_LABEL.aceptado}
              value={stats.byEstado.aceptado}
              tone="ok"
            />
            <KpiCard
              label={PRESUPUESTO_ESTADO_LABEL.rechazado}
              value={stats.byEstado.rechazado}
              tone="error"
            />
          </div>

          <div className="metrics-estado-row">
            {(["enviado", "aceptado", "rechazado"] as const).map((estado) => {
              const count = stats.byEstado[estado];
              const pct = enviados ? Math.round((count / enviados) * 100) : 0;
              return (
                <div key={estado} className={`metrics-estado-chip metrics-estado-chip--${estado}`}>
                  <span className="metrics-estado-chip__label">{PRESUPUESTO_ESTADO_LABEL[estado]}</span>
                  <span className="metrics-estado-chip__value">
                    {count} <span className="text-muted">({pct}%)</span>
                  </span>
                  <div className="metrics-bars__track" aria-hidden>
                    <div className="metrics-bars__fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="metrics-pct-hint">Porcentajes sobre enviados (sin pendientes ni fallidos)</p>

          <div className="metrics-grid-2">
            <BarList title="Por profesional" rows={stats.byProfesional} />
            <BarList title="Por prestación" rows={stats.byPrestacion} />
          </div>
        </>
      )}
    </div>
  );
}
