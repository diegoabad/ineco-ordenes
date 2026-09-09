import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { blobToBase64 } from "../lib/blob";
import { formatFechaHora, formatFechaYmd } from "../lib/fechas";
import { formatNombrePersona } from "../lib/nombrePersona";
import { renderPresupuestoPlantillaBody } from "../lib/presupuestoPlantilla";
import { generarPdfPresupuesto, pdfBlobFromDoc } from "../pdf/generarPresupuestoPdf";
import {
  deletePresupuesto,
  fetchPresupuestoPdfBlob,
  fetchPresupuestoPlantillaConfig,
  fetchPresupuestos,
  fetchPresupuestosConfig,
  restorePresupuestoPdf,
  updatePresupuestoEstado,
} from "../services/dataService";
import type {
  ModalidadPresupuesto,
  MotivoRechazoPresupuesto,
  Presupuesto,
  PresupuestoEstado,
  ProfesionalPresupuesto,
} from "../types";
import { PRESUPUESTO_ESTADO_LABEL } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconCheck, IconMail, IconPdf, IconPencil, IconRefresh, IconSearch, IconTrash, IconX } from "./Icons";
import { PresupuestoEmailPreviewModal } from "./PresupuestoEmailPreviewModal";
import { PresupuestoFormModal } from "./PresupuestoFormModal";
import { PresupuestoRechazoDialog } from "./PresupuestoRechazoDialog";
import { TablePagination } from "./TablePagination";
import { useClientPagination } from "../hooks/useClientPagination";

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
  const [aRechazar, setARechazar] = useState<Presupuesto | null>(null);
  const [motivosRechazo, setMotivosRechazo] = useState<MotivoRechazoPresupuesto[]>([]);
  const [guardandoEstadoId, setGuardandoEstadoId] = useState<string | null>(null);
  const [emailPreview, setEmailPreview] = useState<Presupuesto | null>(null);
  const [viendoPdfId, setViendoPdfId] = useState<string | null>(null);
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

  const cargarMotivos = useCallback(async () => {
    try {
      const config = await fetchPresupuestosConfig();
      setMotivosRechazo(config.motivosRechazo ?? []);
    } catch {
      setMotivosRechazo([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
    void cargarMotivos();
  }, [cargar, cargarMotivos]);

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

  const { page, setPage, pageItems, total, pageSize } = useClientPagination(
    filtrados,
    `${filtroEstado}|${busqueda.trim().toLowerCase()}`,
  );

  const maxAcciones = ACCIONES_PRESUPUESTO;

  async function marcarEstado(
    p: Presupuesto,
    estado: "aceptado" | "rechazado",
    motivoRechazo?: string,
  ) {
    if (guardandoEstadoId) return;
    if (estado === "aceptado" && p.estado === "aceptado") return;
    if (
      estado === "rechazado" &&
      p.estado === "rechazado" &&
      (p.motivoRechazo ?? "") === (motivoRechazo ?? "").trim()
    ) {
      return;
    }
    setGuardandoEstadoId(p.id);
    try {
      const updated = await updatePresupuestoEstado(p.id, estado, motivoRechazo);
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(
        estado === "aceptado"
          ? "Presupuesto marcado como aceptado"
          : p.estado === "rechazado"
            ? "Motivo de rechazo actualizado"
            : "Presupuesto marcado como rechazado",
      );
      if (estado === "rechazado") setARechazar(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cambiar el estado");
    } finally {
      setGuardandoEstadoId(null);
    }
  }

  async function abrirRechazo(p: Presupuesto) {
    if (guardandoEstadoId) return;
    await cargarMotivos();
    setARechazar(p);
  }

  function estadoChipTitle(p: Presupuesto): string | undefined {
    if (p.estado === "rechazado") {
      return p.motivoRechazo?.trim()
        ? `Motivo: ${p.motivoRechazo}`
        : "Sin motivo — clic para cargar";
    }
    if (p.ultimoEnvioAt && p.estado === "enviado") {
      return `Enviado: ${formatFechaHora(p.ultimoEnvioAt)}`;
    }
    if (p.ultimoEnvioAt && p.estado === "fallido") {
      return `Último intento: ${formatFechaHora(p.ultimoEnvioAt)}`;
    }
    return undefined;
  }

  function openPdfBlob(blob: Blob) {
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function regenerarYRestaurarPdf(p: Presupuesto): Promise<Blob> {
    const plantilla = await fetchPresupuestoPlantillaConfig();
    const body = renderPresupuestoPlantillaBody(plantilla.data.body, {
      nombrePaciente: p.nombrePaciente,
      email: p.email,
      nombreProfesional: p.profesional,
      modalidadTitulo: p.modalidadTitulo,
      lugarEvaluacion: p.modalidadTextoPdf,
      fecha: p.fecha,
      items: p.items,
      totalEfectivo: p.totalEfectivo,
      total3Cuotas: p.total3Cuotas,
    });
    const blob = pdfBlobFromDoc(generarPdfPresupuesto({ fecha: p.fecha, body }));
    const pdfBase64 = await blobToBase64(blob);
    const updated = await restorePresupuestoPdf(p.id, pdfBase64);
    upsertPresupuesto(updated);
    return blob;
  }

  async function handleVerPdf(p: Presupuesto) {
    if (viendoPdfId) return;
    setViendoPdfId(p.id);
    try {
      try {
        openPdfBlob(await fetchPresupuestoPdfBlob(p.id));
        return;
      } catch (error) {
        const status = (error as Error & { status?: number; code?: string }).status;
        const code = (error as Error & { code?: string }).code;
        if (status !== 404 && code !== "PDF_MISSING") throw error;
      }

      toast.info("El PDF no estaba en el servidor; regenerándolo…");
      openPdfBlob(await regenerarYRestaurarPdf(p));
      toast.success("PDF restaurado en el servidor");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir el PDF");
    } finally {
      setViendoPdfId(null);
    }
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
    if (viendoPdfId) return;
    setViendoPdfId(p.id);
    try {
      try {
        await fetchPresupuestoPdfBlob(p.id);
        setEmailPreview(p);
        return;
      } catch (error) {
        const status = (error as Error & { status?: number; code?: string }).status;
        const code = (error as Error & { code?: string }).code;
        if (status !== 404 && code !== "PDF_MISSING") throw error;
      }
      toast.info("El PDF no estaba en el servidor; regenerándolo antes de enviar…");
      await regenerarYRestaurarPdf(p);
      setEmailPreview(p);
      toast.success("PDF restaurado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo preparar el envío");
    } finally {
      setViendoPdfId(null);
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
                <th className={`fl-col-actions ${accionesClass()}`}>Acciones</th>
              </tr>
            </thead>
            {!loading && filtrados.length > 0 ? (
              <tbody>
                {pageItems.map((p) => {
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
                      {p.estado === "rechazado" ? (
                        <button
                          type="button"
                          className={`${estadoChipClass(p.estado)} chip--button`}
                          title={estadoChipTitle(p)}
                          aria-label={
                            p.motivoRechazo?.trim()
                              ? `Rechazado. Motivo: ${p.motivoRechazo}. Clic para editar`
                              : "Rechazado sin motivo. Clic para cargar motivo"
                          }
                          disabled={Boolean(guardandoEstadoId)}
                          onClick={() => void abrirRechazo(p)}
                        >
                          {PRESUPUESTO_ESTADO_LABEL[p.estado]}
                        </button>
                      ) : (
                        <span
                          className={estadoChipClass(p.estado)}
                          title={estadoChipTitle(p)}
                        >
                          {PRESUPUESTO_ESTADO_LABEL[p.estado]}
                        </span>
                      )}
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
                          onClick={() => void abrirRechazo(p)}
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
                            emailPreview?.id === p.id ||
                            viendoPdfId === p.id
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
                          title={
                            viendoPdfId === p.id
                              ? "Abriendo PDF…"
                              : p.pdfUrl
                                ? "Ver PDF"
                                : "Sin PDF"
                          }
                          aria-label="Ver PDF"
                          disabled={!p.pdfUrl || emailPreview?.id === p.id || viendoPdfId === p.id}
                          onClick={() => void handleVerPdf(p)}
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

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={loading ? 0 : total}
          onPageChange={setPage}
          disabled={loading}
        />
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

      <PresupuestoRechazoDialog
        open={aRechazar !== null}
        presupuesto={aRechazar}
        motivos={motivosRechazo}
        saving={Boolean(aRechazar && guardandoEstadoId === aRechazar.id)}
        onClose={() => setARechazar(null)}
        onConfirm={(motivo) => {
          if (!aRechazar) return;
          return marcarEstado(aRechazar, "rechazado", motivo);
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
