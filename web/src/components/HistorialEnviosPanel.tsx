import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { resolveAssetUrl } from "../config/api";
import { formatFechaYmd } from "../lib/fechas";
import { deleteEmailEnvio, fetchEmailEnvios } from "../services/dataService";
import type { EmailEnvio, Paciente } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ViewDetailModal } from "./ViewDetailModal";
import { IconAlert, IconFile, IconPdf, IconRefresh, IconSearch, IconTrash } from "./Icons";

type Props = {
  pacientes: Paciente[];
  refreshKey: number;
  onRetry: (paciente: Paciente) => void;
};

const PAGE_SIZE = 20;
const MES_INICIO_Y = 2026;
const MES_INICIO_M = 8;

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

function mesActualYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildMesOptions(): { value: string; label: string }[] {
  const now = new Date();
  const endY = now.getFullYear();
  const endM = now.getMonth() + 1;
  const months: { value: string; label: string }[] = [];

  let y = MES_INICIO_Y;
  let m = MES_INICIO_M;
  while (y < endY || (y === endY && m <= endM)) {
    const value = `${y}-${String(m).padStart(2, "0")}`;
    months.push({ value, label: `${NOMBRES_MES[m - 1]} ${y}` });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  months.reverse();
  return [{ value: "", label: "Todos" }, ...months];
}

function formatFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatFechaOrden(ymd: string): string {
  const t = ymd.trim();
  if (!t) return "—";
  return formatFechaYmd(t);
}

export function HistorialEnviosPanel({ pacientes, refreshKey, onRetry }: Props) {
  const mesOptions = useMemo(() => buildMesOptions(), []);
  const defaultMes = useMemo(() => {
    const actual = mesActualYm();
    return mesOptions.some((o) => o.value === actual) ? actual : "";
  }, [mesOptions]);

  const [items, setItems] = useState<EmailEnvio[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  const [mes, setMes] = useState(defaultMes);
  const [errorDetalle, setErrorDetalle] = useState<EmailEnvio | null>(null);
  const [envioABorrar, setEnvioABorrar] = useState<EmailEnvio | null>(null);
  const primeraCarga = useRef(true);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setBusquedaDebounced(busqueda);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [busqueda]);

  const cargar = useCallback(async () => {
    // Solo pantalla "Cargando…" en la primera visita; luego se actualiza sin vaciar la tabla
    if (primeraCarga.current) setLoading(true);
    try {
      const result = await fetchEmailEnvios({
        page,
        pageSize: PAGE_SIZE,
        mes: mes || undefined,
        q: busquedaDebounced || undefined,
      });
      setItems(result.data);
      setTotal(result.total);
      if (result.page !== page) setPage(result.page);
      primeraCarga.current = false;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el historial");
    } finally {
      setLoading(false);
    }
  }, [page, mes, busquedaDebounced]);

  useEffect(() => {
    void cargar();
  }, [cargar, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  function handleRetry(envio: EmailEnvio) {
    const paciente = pacientes.find((p) => p.id === envio.pacienteId);
    if (!paciente) {
      toast.warning("Ese paciente ya no existe. No se puede reintentar.");
      return;
    }
    if (!paciente.email?.trim()) {
      toast.warning("El paciente no tiene email cargado.");
      return;
    }
    onRetry(paciente);
  }

  function handleVerPdf(envio: EmailEnvio) {
    const url = resolveAssetUrl(envio.pdfUrl);
    if (!url) {
      toast.warning("Este envío no tiene PDF guardado");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function confirmarBorrar() {
    if (!envioABorrar) return;
    const id = envioABorrar.id;
    const eraUltimoDePagina = items.length <= 1;
    setEnvioABorrar(null);
    try {
      await deleteEmailEnvio(id);
      toast.success("Registro eliminado del historial");
      if (eraUltimoDePagina && page > 1) {
        setPage((p) => p - 1);
      } else {
        setItems((prev) => prev.filter((e) => e.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    }
  }

  return (
    <>
      <section className="fl-table-card">
        <div className="table-toolbar table-toolbar--filters">
          <div className="table-search">
            <span className="table-search__icon" aria-hidden>
              <IconSearch size={16} />
            </span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar paciente, email, estado…"
              aria-label="Buscar en historial"
            />
          </div>
          <div className="table-toolbar__month form-group">
            <label htmlFor="hist-mes">Mes</label>
            <select
              id="hist-mes"
              value={mes}
              onChange={(e) => {
                setMes(e.target.value);
                setPage(1);
              }}
              aria-label="Filtrar por mes de envío"
            >
              {mesOptions.map((o) => (
                <option key={o.value || "todos"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <colgroup>
              <col className="col-hist-fechahora" />
              <col className="col-hist-paciente" />
              <col className="col-hist-mail" />
              <col className="col-hist-estado" />
              <col className="col-actions col-actions--4" />
            </colgroup>
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Paciente</th>
                <th>Mail</th>
                <th>Estado</th>
                <th className="fl-col-actions fl-col-actions--4">Acciones</th>
              </tr>
            </thead>
            {!loading && items.length > 0 ? (
              <tbody>
                {items.map((envio) => {
                  const fechaHora = formatFechaHora(envio.enviadoAt);
                  const ok = envio.status === "ok";
                  const tienePdf = Boolean(envio.pdfUrl);
                  return (
                    <tr key={envio.id}>
                      <td>
                        <span
                          className="fl-texto-principal"
                          title={`Orden: ${formatFechaOrden(envio.fechaOrden)}`}
                        >
                          {fechaHora}
                        </span>
                      </td>
                      <td>
                        <span className="fl-texto-truncado" title={envio.pacienteNombre}>
                          {envio.pacienteNombre || "—"}
                        </span>
                      </td>
                      <td className="fl-col-email">
                        <span className="fl-texto-truncado" title={envio.toEmail}>
                          {envio.toEmail || "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`chip ${ok ? "chip--ok" : "chip--error"}`}>
                          {ok ? "Enviado" : "Falló"}
                        </span>
                      </td>
                      <td className="fl-col-actions fl-col-actions--4">
                        <div className="fl-table-actions">
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--mail"
                            title="Reintentar envío"
                            aria-label="Reintentar envío"
                            onClick={() => handleRetry(envio)}
                          >
                            <IconRefresh size={16} />
                          </button>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--print"
                            title={tienePdf ? "Ver PDF adjunto" : "Sin PDF guardado"}
                            aria-label="Ver PDF adjunto"
                            disabled={!tienePdf}
                            onClick={() => handleVerPdf(envio)}
                          >
                            <IconPdf size={16} />
                          </button>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--view"
                            title={ok ? "Sin error" : "Ver detalle del error"}
                            aria-label="Ver detalle del error"
                            disabled={ok || !envio.errorMessage}
                            onClick={() => setErrorDetalle(envio)}
                          >
                            <IconAlert size={16} />
                          </button>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--danger"
                            title="Eliminar del historial"
                            aria-label="Eliminar del historial"
                            onClick={() => setEnvioABorrar(envio)}
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ) : null}
          </table>
          {loading ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">Cargando historial…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              {total === 0 && !busquedaDebounced && !mes ? (
                <>
                  <div className="fl-table-empty__art">
                    <IconFile size={32} />
                  </div>
                  <p className="fl-table-empty__title">Todavía no hay envíos</p>
                  <p className="fl-table-empty__hint">
                    Cuando mandes órdenes por mail, van a aparecer acá.
                  </p>
                </>
              ) : (
                <>
                  <p className="fl-table-empty__title">Sin resultados</p>
                  <p className="fl-table-empty__hint">
                    Proba con otra búsqueda o elegí otro mes.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>

        {!loading && total > 0 ? (
          <div className="table-pagination">
            <span className="table-pagination__info">
              {from}–{to} de {total}
            </span>
            <div className="table-pagination__nav">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </button>
              <span className="table-pagination__page">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={envioABorrar !== null}
        title="Eliminar del historial"
        message={
          envioABorrar
            ? `¿Eliminar el envío de ${envioABorrar.pacienteNombre || "este paciente"} (${envioABorrar.toEmail || "sin email"})?`
            : ""
        }
        confirmLabel="Eliminar"
        onCancel={() => setEnvioABorrar(null)}
        onConfirm={() => void confirmarBorrar()}
      />

      <ViewDetailModal
        open={errorDetalle !== null}
        title="Detalle del error"
        onClose={() => setErrorDetalle(null)}
        fields={
          errorDetalle
            ? [
                {
                  label: "Fecha envío",
                  value: formatFechaHora(errorDetalle.enviadoAt),
                },
                { label: "Paciente", value: errorDetalle.pacienteNombre },
                { label: "Mail", value: errorDetalle.toEmail },
                {
                  label: "Error",
                  value: (
                    <span className="detail-list__multiline">
                      {errorDetalle.errorMessage || "Sin detalle"}
                    </span>
                  ),
                },
              ]
            : []
        }
      />
    </>
  );
}
