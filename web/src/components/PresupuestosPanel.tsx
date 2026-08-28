import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { resolveAssetUrl } from "../config/api";
import { formatFechaHora, formatFechaYmd } from "../lib/fechas";
import { deletePresupuesto, enviarPresupuesto, fetchPresupuestos, updatePresupuestoEstado } from "../services/dataService";
import type { ModalidadPresupuesto, Presupuesto, PresupuestoEstado, ProfesionalPresupuesto } from "../types";
import { PRESUPUESTO_ESTADO_LABEL } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconAlert, IconCheck, IconMail, IconPdf, IconPencil, IconRefresh, IconSearch, IconTrash, IconX } from "./Icons";
import { PresupuestoFormModal } from "./PresupuestoFormModal";

function presupuestoEsEditable(estado: PresupuestoEstado): boolean {
  return estado === "pendiente" || estado === "fallido";
}

function presupuestoPermiteEnvio(estado: PresupuestoEstado): boolean {
  return estado === "pendiente" || estado === "fallido" || estado === "enviado";
}

const ESTADOS_MANUALES: PresupuestoEstado[] = ["aceptado", "rechazado"];

type AccionesCount = 3 | 4 | 5;

function contarAccionesPresupuesto(p: Presupuesto): AccionesCount {
  let count = 3;
  if (presupuestoPermiteEnvio(p.estado)) count++;
  if (presupuestoEsEditable(p.estado)) count++;
  return count as AccionesCount;
}

function accionesClass(count: AccionesCount): string {
  return `fl-col-actions--${count}`;
}

function estadoAccionConfig(estado: PresupuestoEstado): {
  className: string;
  title: string;
  icon: "check" | "x" | "alert";
} {
  switch (estado) {
    case "aceptado":
      return {
        className: "fl-icon-btn--success",
        title: "Aceptado — cambiar estado",
        icon: "check",
      };
    case "rechazado":
      return {
        className: "fl-icon-btn--danger",
        title: "Rechazado — cambiar estado",
        icon: "x",
      };
    case "fallido":
      return {
        className: "fl-icon-btn--warning",
        title: "Envío fallido — marcar aceptado o rechazado",
        icon: "alert",
      };
    default:
      return {
        className: "fl-icon-btn--accent",
        title: "Marcar aceptado o rechazado",
        icon: "check",
      };
  }
}

function EstadoAccionIcon({ kind }: { kind: "check" | "x" | "alert" }) {
  if (kind === "x") return <IconX size={16} />;
  if (kind === "alert") return <IconAlert size={16} />;
  return <IconCheck size={16} />;
}

type FiltroPresupuestoEstado = "todos" | PresupuestoEstado;

const ESTADOS_FILTRO: { value: FiltroPresupuestoEstado; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "pendiente", label: PRESUPUESTO_ESTADO_LABEL.pendiente },
  { value: "enviado", label: PRESUPUESTO_ESTADO_LABEL.enviado },
  { value: "aceptado", label: PRESUPUESTO_ESTADO_LABEL.aceptado },
  { value: "rechazado", label: PRESUPUESTO_ESTADO_LABEL.rechazado },
  { value: "fallido", label: PRESUPUESTO_ESTADO_LABEL.fallido },
];

type Props = {
  addRequestKey?: number;
  profesionales?: ProfesionalPresupuesto[];
  onProfesionalesChange?: (profesionales: ProfesionalPresupuesto[]) => void;
  modalidades?: ModalidadPresupuesto[];
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTotal(value: number): string {
  if (!value || value <= 0) return "—";
  return formatMoney(value);
}

function estadoChipClass(estado: PresupuestoEstado): string {
  switch (estado) {
    case "pendiente":
      return "chip chip--warning";
    case "aceptado":
      return "chip chip--ok";
    case "enviado":
      return "chip chip--default";
    case "rechazado":
      return "chip chip--error";
    case "fallido":
      return "chip chip--error";
    default:
      return "chip chip--muted";
  }
}

export function PresupuestosPanel({
  addRequestKey = 0,
  profesionales = [],
  onProfesionalesChange,
  modalidades = [],
}: Props) {
  const [items, setItems] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroPresupuestoEstado>("todos");
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<Presupuesto | null>(null);
  const [aBorrar, setABorrar] = useState<Presupuesto | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState<Presupuesto | null>(null);
  const [nuevoEstado, setNuevoEstado] = useState<PresupuestoEstado>("pendiente");
  const [guardandoEstado, setGuardandoEstado] = useState(false);
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  const lastAddRequestKey = useRef(0);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchPresupuestos());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar los presupuestos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (addRequestKey > lastAddRequestKey.current) {
      lastAddRequestKey.current = addRequestKey;
      setEditando(null);
      setFormOpen(true);
    }
  }, [addRequestKey]);

  function cerrarModal() {
    setFormOpen(false);
    setEditando(null);
  }

  const filtrados = useMemo(() => {
    let list = items;

    if (filtroEstado !== "todos") {
      list = list.filter((p) => p.estado === filtroEstado);
    }

    const q = busqueda.trim().toLowerCase();
    if (!q) return list;

    return list.filter((p) =>
      [p.nombrePaciente, p.profesional].join(" ").toLowerCase().includes(q),
    );
  }, [items, busqueda, filtroEstado]);

  const maxAcciones = useMemo((): AccionesCount => {
    if (filtrados.length === 0) return 5;
    return Math.max(3, ...filtrados.map(contarAccionesPresupuesto)) as AccionesCount;
  }, [filtrados]);

  function abrirCambioEstado(p: Presupuesto) {
    setCambiandoEstado(p);
    const inicial =
      p.estado === "aceptado" || p.estado === "rechazado" ? p.estado : "aceptado";
    setNuevoEstado(inicial);
  }

  function cerrarCambioEstado() {
    if (guardandoEstado) return;
    setCambiandoEstado(null);
  }

  async function guardarCambioEstado() {
    if (!cambiandoEstado) return;
    if (nuevoEstado === cambiandoEstado.estado) {
      cerrarCambioEstado();
      return;
    }

    setGuardandoEstado(true);
    try {
      const updated = await updatePresupuestoEstado(cambiandoEstado.id, nuevoEstado);
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Estado actualizado");
      setCambiandoEstado(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el estado");
    } finally {
      setGuardandoEstado(false);
    }
  }

  function handleVerPdf(p: Presupuesto) {
    const url = resolveAssetUrl(p.pdfUrl);
    if (!url) {
      toast.warning("Este presupuesto no tiene PDF guardado");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleEnviar(p: Presupuesto) {
    if (!p.email.trim()) {
      toast.warning("El presupuesto no tiene email cargado");
      return;
    }
    if (!p.pdfUrl) {
      toast.warning("Este presupuesto no tiene PDF guardado");
      return;
    }

    setEnviandoId(p.id);
    try {
      const updated = await enviarPresupuesto(p.id);
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(
        p.estado === "fallido" || p.estado === "enviado"
          ? "Presupuesto reenviado"
          : "Presupuesto enviado",
      );
    } catch (error) {
      toast.error("No se pudo enviar el presupuesto");
      const err = error as Error & { data?: unknown };
      if (err.data && typeof err.data === "object" && err.data !== null && "id" in err.data) {
        const fallido = err.data as Presupuesto;
        setItems((prev) => prev.map((item) => (item.id === fallido.id ? fallido : item)));
      } else {
        try {
          setItems(await fetchPresupuestos());
        } catch {
          // La lista quedará como estaba; el toast ya avisó del fallo.
        }
      }
    } finally {
      setEnviandoId(null);
    }
  }

  async function confirmarBorrar() {
    if (!aBorrar) return;
    const id = aBorrar.id;
    setABorrar(null);
    try {
      await deletePresupuesto(id);
      setItems((prev) => prev.filter((p) => p.id !== id));
      toast.success("Presupuesto eliminado");
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
              placeholder="Buscar por nombre o profesional…"
              aria-label="Buscar presupuestos por nombre o profesional"
            />
          </div>
          <div className="table-toolbar__month form-group">
            <label htmlFor="filtro-presup-estado">Estado</label>
            <select
              id="filtro-presup-estado"
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value as FiltroPresupuestoEstado)}
              aria-label="Filtrar presupuestos por estado"
            >
              {ESTADOS_FILTRO.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <colgroup>
              <col className="col-presup-fecha" />
              <col className="col-presup-paciente" />
              <col className="col-presup-profesional" />
              <col className="col-presup-total" />
              <col className="col-presup-estado" />
              <col className={`col-actions col-actions--${maxAcciones}`} />
            </colgroup>
            <thead>
              <tr>
                <th className="fl-col-presup-fecha">Fecha</th>
                <th>Paciente</th>
                <th>Profesional</th>
                <th className="fl-col-presup-total">Total</th>
                <th className="fl-col-presup-estado">Estado</th>
                <th className={`fl-col-actions ${accionesClass(maxAcciones)}`}>Acciones</th>
              </tr>
            </thead>
            {!loading && filtrados.length > 0 ? (
              <tbody>
                {filtrados.map((p) => {
                  const accionesCount = contarAccionesPresupuesto(p);
                  const estadoAccion = estadoAccionConfig(p.estado);
                  return (
                  <tr key={p.id}>
                    <td className="fl-col-presup-fecha">{formatFechaYmd(p.fecha)}</td>
                    <td>
                      <span className="fl-texto-truncado" title={p.nombrePaciente}>
                        {p.nombrePaciente || "—"}
                      </span>
                    </td>
                    <td>
                      <span className="fl-texto-truncado" title={p.profesional}>
                        {p.profesional || "—"}
                      </span>
                    </td>
                    <td className="fl-col-presup-total">{formatTotal(p.totalEfectivo)}</td>
                    <td className="fl-col-presup-estado">
                      <span
                        className={estadoChipClass(p.estado)}
                        title={
                          (p.estado === "enviado" || p.estado === "fallido") && p.ultimoEnvioAt
                            ? `Último intento: ${formatFechaHora(p.ultimoEnvioAt)}`
                            : undefined
                        }
                      >
                        {PRESUPUESTO_ESTADO_LABEL[p.estado]}
                      </span>
                    </td>
                    <td className={`fl-col-actions ${accionesClass(maxAcciones)}`}>
                      <div className={`fl-table-actions fl-table-actions--${accionesCount}`}>
                        <button
                          type="button"
                          className={`fl-icon-btn ${estadoAccion.className}`}
                          title={estadoAccion.title}
                          aria-label={estadoAccion.title}
                          disabled={enviandoId === p.id || guardandoEstado}
                          onClick={() => abrirCambioEstado(p)}
                        >
                          <EstadoAccionIcon kind={estadoAccion.icon} />
                        </button>
                        {presupuestoPermiteEnvio(p.estado) ? (
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--mail"
                            title={
                              !p.email.trim()
                                ? "Sin email"
                                : !p.pdfUrl
                                  ? "Sin PDF"
                                  : p.estado === "pendiente"
                                    ? "Enviar presupuesto"
                                    : "Reenviar presupuesto"
                            }
                            aria-label={
                              p.estado === "pendiente" ? "Enviar presupuesto" : "Reenviar presupuesto"
                            }
                            disabled={!p.email.trim() || !p.pdfUrl || enviandoId === p.id}
                            onClick={() => void handleEnviar(p)}
                          >
                            {p.estado === "pendiente" ? (
                              <IconMail size={16} />
                            ) : (
                              <IconRefresh size={16} />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--print"
                          title={p.pdfUrl ? "Ver PDF" : "Sin PDF"}
                          aria-label="Ver PDF"
                          disabled={!p.pdfUrl || enviandoId === p.id}
                          onClick={() => handleVerPdf(p)}
                        >
                          <IconPdf size={16} />
                        </button>
                        {presupuestoEsEditable(p.estado) ? (
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--edit"
                            title="Editar"
                            aria-label="Editar"
                            disabled={enviandoId === p.id}
                            onClick={() => {
                              setEditando(p);
                              setFormOpen(true);
                            }}
                          >
                            <IconPencil size={16} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Eliminar"
                          aria-label="Eliminar"
                          disabled={enviandoId === p.id}
                          onClick={() => setABorrar(p)}
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
              <p className="fl-table-empty__title">Cargando presupuestos…</p>
            </div>
          ) : filtrados.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">
                {items.length === 0 ? "Todavía no hay presupuestos" : "Sin resultados"}
              </p>
              <p className="fl-table-empty__hint">
                {items.length === 0
                  ? "Usá Crear presupuesto para armar el primero."
                  : "Probá con otro nombre, profesional o cambiá el filtro de estado."}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <PresupuestoFormModal
        open={formOpen}
        initial={editando}
        profesionales={profesionales}
        onProfesionalesChange={onProfesionalesChange}
        modalidades={modalidades}
        onClose={cerrarModal}
        onSaved={(saved) => {
          setItems((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = saved;
              return next;
            }
            return [saved, ...prev];
          });
        }}
        onEnvioFallido={() => void cargar()}
      />

      <ConfirmDialog
        open={aBorrar !== null}
        title="Eliminar presupuesto"
        message={
          aBorrar
            ? `¿Eliminar el presupuesto de ${aBorrar.nombrePaciente}?`
            : ""
        }
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarBorrar()}
        onCancel={() => setABorrar(null)}
      />

      {cambiandoEstado ? (
        <div className="fl-modal-backdrop" role="presentation">
          <div
            className="fl-modal fl-modal--confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="presup-estado-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fl-modal__header">
              <h2 id="presup-estado-title">Cambiar estado</h2>
              <button
                type="button"
                className="fl-icon-btn"
                onClick={cerrarCambioEstado}
                aria-label="Cerrar"
                disabled={guardandoEstado}
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="fl-modal__body">
              <p className="confirm-dialog__message">
                Presupuesto de <strong>{cambiandoEstado.nombrePaciente}</strong>
              </p>
              <div className="form-group">
                <label htmlFor="presup-estado-select">Marcar como</label>
                <select
                  id="presup-estado-select"
                  value={nuevoEstado}
                  onChange={(e) => setNuevoEstado(e.target.value as PresupuestoEstado)}
                  disabled={guardandoEstado}
                >
                  {ESTADOS_MANUALES.map((estado) => (
                    <option key={estado} value={estado}>
                      {PRESUPUESTO_ESTADO_LABEL[estado]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="fl-modal__footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cerrarCambioEstado}
                disabled={guardandoEstado}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void guardarCambioEstado()}
                disabled={guardandoEstado || nuevoEstado === cambiandoEstado.estado}
              >
                {guardandoEstado ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
