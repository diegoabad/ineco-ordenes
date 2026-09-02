import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { resolveAssetUrl } from "../config/api";
import { formatFechaHora, formatFechaYmd } from "../lib/fechas";
import { formatNombrePersona } from "../lib/nombrePersona";
import { deletePresupuesto, fetchPresupuestos, updatePresupuestoEstado } from "../services/dataService";
import type { ModalidadPresupuesto, Presupuesto, PresupuestoEstado, ProfesionalPresupuesto } from "../types";
import { PRESUPUESTO_ESTADO_LABEL } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconCheck, IconMail, IconPdf, IconPencil, IconRefresh, IconSearch, IconTrash, IconX } from "./Icons";
import { PresupuestoEmailPreviewModal } from "./PresupuestoEmailPreviewModal";
import { PresupuestoFormModal } from "./PresupuestoFormModal";

function presupuestoEsEditable(estado: PresupuestoEstado): boolean {
  return estado === "pendiente" || estado === "fallido";
}

function presupuestoPermiteEnvio(estado: PresupuestoEstado): boolean {
  return estado === "pendiente" || estado === "enviado" || estado === "fallido";
}

function presupuestoEditTooltip(estado: PresupuestoEstado): string {
  if (presupuestoEsEditable(estado)) return "Editar";
  if (estado === "enviado") return "No se puede editar presupuestos enviados";
  if (estado === "aceptado") return "No se puede editar presupuestos aceptados";
  if (estado === "rechazado") return "No se puede editar presupuestos rechazados";
  return "No se puede editar en este estado";
}

const ACCIONES_PRESUPUESTO = 6;

function accionesClass(): string {
  return `fl-col-actions--${ACCIONES_PRESUPUESTO}`;
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
  const [guardandoEstadoId, setGuardandoEstadoId] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState<Presupuesto | null>(null);
  const lastAddRequestKey = useRef(0);

  function upsertPresupuesto(saved: Presupuesto) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  }

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

  const maxAcciones = ACCIONES_PRESUPUESTO;

  async function marcarEstado(p: Presupuesto, estado: "aceptado" | "rechazado") {
    if (p.estado === estado || guardandoEstadoId) return;
    setGuardandoEstadoId(p.id);
    try {
      const updated = await updatePresupuestoEstado(p.id, estado);
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(
        estado === "aceptado" ? "Presupuesto marcado como aceptado" : "Presupuesto marcado como rechazado",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el estado");
    } finally {
      setGuardandoEstadoId(null);
    }
  }

  function handleVerPdf(p: Presupuesto) {
    const url = resolveAssetUrl(p.pdfUrl);
    if (!url) {
      toast.warning("Este presupuesto no tiene PDF guardado");
      return;
    }
    // Bustear caché: al editar se sobrescribe el mismo archivo en disco.
    const sep = url.includes("?") ? "&" : "?";
    window.open(`${url}${sep}t=${Date.now()}`, "_blank", "noopener,noreferrer");
  }

  function handleEnviar(p: Presupuesto) {
    if (!p.email.trim()) {
      toast.warning("El presupuesto no tiene email cargado");
      return;
    }
    if (!p.pdfUrl) {
      toast.warning("Este presupuesto no tiene PDF guardado");
      return;
    }
    setEmailPreview(p);
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
                <th className={`fl-col-actions ${accionesClass()}`}>Acciones</th>
              </tr>
            </thead>
            {!loading && filtrados.length > 0 ? (
              <tbody>
                {filtrados.map((p) => {
                  const puedeEnviar = presupuestoPermiteEnvio(p.estado);
                  const puedeEditar = presupuestoEsEditable(p.estado);
                  const guardandoEstaFila = guardandoEstadoId === p.id;
                  return (
                  <tr key={p.id}>
                    <td className="fl-col-presup-fecha">{formatFechaYmd(p.fecha)}</td>
                    <td>
                      <span className="fl-texto-truncado" title={formatNombrePersona(p.nombrePaciente)}>
                        {formatNombrePersona(p.nombrePaciente) || "—"}
                      </span>
                    </td>
                    <td>
                      <span className="fl-texto-truncado" title={formatNombrePersona(p.profesional)}>
                        {formatNombrePersona(p.profesional) || "—"}
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
                    <td className={`fl-col-actions ${accionesClass()}`}>
                      <div className={`fl-table-actions fl-table-actions--${maxAcciones}`}>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--success"
                          title={
                            p.estado === "aceptado"
                              ? "Ya está aceptado"
                              : "Marcar como aceptado"
                          }
                          aria-label="Marcar como aceptado"
                          disabled={
                            emailPreview?.id === p.id ||
                            guardandoEstaFila ||
                            Boolean(guardandoEstadoId) ||
                            p.estado === "aceptado"
                          }
                          onClick={() => void marcarEstado(p, "aceptado")}
                        >
                          <IconCheck size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title={
                            p.estado === "rechazado"
                              ? "Ya está rechazado"
                              : "Marcar como rechazado"
                          }
                          aria-label="Marcar como rechazado"
                          disabled={
                            emailPreview?.id === p.id ||
                            guardandoEstaFila ||
                            Boolean(guardandoEstadoId) ||
                            p.estado === "rechazado"
                          }
                          onClick={() => void marcarEstado(p, "rechazado")}
                        >
                          <IconX size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--mail"
                          title={
                            !puedeEnviar
                              ? "No se puede enviar en este estado"
                              : !p.email.trim()
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
                          disabled={
                            !puedeEnviar ||
                            !p.email.trim() ||
                            !p.pdfUrl ||
                            emailPreview?.id === p.id
                          }
                          onClick={() => void handleEnviar(p)}
                        >
                          {p.estado === "pendiente" || !puedeEnviar ? (
                            <IconMail size={16} />
                          ) : (
                            <IconRefresh size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--print"
                          title={p.pdfUrl ? "Ver PDF" : "Sin PDF"}
                          aria-label="Ver PDF"
                          disabled={!p.pdfUrl || emailPreview?.id === p.id}
                          onClick={() => handleVerPdf(p)}
                        >
                          <IconPdf size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--edit"
                          title={presupuestoEditTooltip(p.estado)}
                          aria-label={presupuestoEditTooltip(p.estado)}
                          disabled={!puedeEditar || emailPreview?.id === p.id}
                          onClick={() => {
                            setEditando(p);
                            setFormOpen(true);
                          }}
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Eliminar"
                          aria-label="Eliminar"
                          disabled={emailPreview?.id === p.id}
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
        onSaved={upsertPresupuesto}
        onRequestEnviar={(presupuesto) => setEmailPreview(presupuesto)}
      />

      <PresupuestoEmailPreviewModal
        open={emailPreview !== null}
        presupuesto={emailPreview}
        onClose={() => setEmailPreview(null)}
        onSent={upsertPresupuesto}
        onFailed={(fallido) => {
          upsertPresupuesto(fallido);
          void cargar();
        }}
      />

      <ConfirmDialog
        open={aBorrar !== null}
        title="Eliminar presupuesto"
        message={
          aBorrar
            ? `¿Eliminar el presupuesto de ${formatNombrePersona(aBorrar.nombrePaciente)}?`
            : ""
        }
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarBorrar()}
        onCancel={() => setABorrar(null)}
      />
    </>
  );
}
