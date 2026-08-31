import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { toast } from "react-toastify";
import { blobToBase64 } from "../lib/blob";
import { fechaHoyIso } from "../lib/fechas";
import {
  renderPresupuestoPlantillaBody,
  type PresupuestoPlantillaContext,
} from "../lib/presupuestoPlantilla";
import { canonicalRichHtml, normalizeRichHtml, richHtmlEquivalent } from "../lib/richText";
import {
  refreshTemplateVarDecorations,
  stripTemplateVarDecorations,
  TEMPLATE_VAR_TOKEN_RE,
} from "../lib/templateVars";
import { generarPdfPresupuesto, pdfBlobFromDoc } from "../pdf/generarPresupuestoPdf";
import {
  createPresupuesto,
  fetchPresupuestoPlantillaConfig,
  fetchPrestaciones,
  updatePresupuesto,
} from "../services/dataService";
import type {
  ModalidadPresupuesto,
  Prestacion,
  Presupuesto,
  PresupuestoFormData,
  ProfesionalPresupuesto,
} from "../types";
import type { PresupuestoPlantillaVar } from "../types/presupuestoPlantilla";
import { PRESUPUESTO_PLANTILLA_VAR_LABELS } from "../types/presupuestoPlantilla";
import { BasicRichTextEditor } from "./BasicRichTextEditor";
import { IconGrip, IconSearch, IconX } from "./Icons";
import { PdfViewerModal } from "./PdfViewerModal";
import { ProfesionalPresupuestoField } from "./ProfesionalPresupuestoField";

const PLANTILLA_VAR_GROUPS: { title: string; keys: readonly PresupuestoPlantillaVar[] }[] = [
  { title: "Paciente", keys: ["nombrePaciente", "email"] },
  { title: "Profesional", keys: ["nombreProfesional"] },
  { title: "Modalidad", keys: ["modalidadTitulo", "lugarEvaluacion"] },
  {
    title: "Presupuesto",
    keys: ["fechaPresupuesto", "totalEfectivo", "total3Cuotas"],
  },
  {
    title: "Prestaciones",
    keys: ["cantidadPrestaciones", "listaPrestaciones"],
  },
];

function collectUsedPlantillaVars(body: string): Set<string> {
  const used = new Set<string>();
  const re = new RegExp(TEMPLATE_VAR_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    used.add(match[1]!);
  }
  return used;
}

type Props = {
  open: boolean;
  initial?: Presupuesto | null;
  profesionales?: ProfesionalPresupuesto[];
  onProfesionalesChange?: (profesionales: ProfesionalPresupuesto[]) => void;
  modalidades?: ModalidadPresupuesto[];
  onClose: () => void;
  onSaved: (presupuesto: Presupuesto) => void;
  /** Tras guardar, abre el preview de email para enviar. */
  onRequestEnviar?: (presupuesto: Presupuesto) => void;
};

const EMPTY_FORM: PresupuestoFormData = {
  nombrePaciente: "",
  profesional: "",
  modalidadId: "",
  email: "",
  prestacionIds: [],
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function prestacionTienePrecios(p: Pick<Prestacion, "precioEfectivo" | "precio3Cuotas">): boolean {
  return p.precioEfectivo > 0 || p.precio3Cuotas > 0;
}

function prestacionToItem(p: Prestacion) {
  return {
    prestacionId: p.id,
    titulo: p.titulo,
    descripcion: p.descripcion,
    tipo: p.tipo,
    duracionMinutos: p.duracionMinutos,
    precioEfectivo: p.precioEfectivo,
    precio3Cuotas: p.precio3Cuotas,
  };
}

export function PresupuestoFormModal({
  open,
  initial = null,
  profesionales = [],
  onProfesionalesChange,
  modalidades = [],
  onClose,
  onSaved,
  onRequestEnviar,
}: Props) {
  const isEditing = initial !== null;
  const [form, setForm] = useState<PresupuestoFormData>(EMPTY_FORM);
  const [prestaciones, setPrestaciones] = useState<Prestacion[]>([]);
  const [loadingPrestaciones, setLoadingPrestaciones] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accion, setAccion] = useState<"crear" | "enviar" | null>(null);
  const [busquedaPrest, setBusquedaPrest] = useState("");
  const [plantillaBody, setPlantillaBody] = useState("");
  const [creandoProfesional, setCreandoProfesional] = useState(false);
  const [dragPrestacionId, setDragPrestacionId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{
    blob: Blob;
    pdfBase64: string;
    modo: "crear" | "enviar";
    fecha: string;
    plantillaHtml: string;
    /** Última plantilla aplicada al PDF (para Restaurar). */
    plantillaBaselineHtml: string;
    plantillaCtx: PresupuestoPlantillaContext;
    editorKey: number;
    plantillaDirty: boolean;
    updatingPdf: boolean;
  } | null>(null);
  const plantillaAreaRef = useRef<HTMLDivElement | null>(null);
  const [plantillaVarsOpen, setPlantillaVarsOpen] = useState(false);

  const modalidadDefaultId = modalidades[0]?.id ?? "";

  useEffect(() => {
    if (!open) {
      setCreandoProfesional(false);
      setPdfPreview(null);
      setPlantillaVarsOpen(false);
      setDragPrestacionId(null);
      setDropIndex(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setBusquedaPrest("");
    void fetchPresupuestoPlantillaConfig()
      .then((res) => setPlantillaBody(res.data.body))
      .catch(() => setPlantillaBody(""));
    setForm(
      initial
        ? {
            nombrePaciente: initial.nombrePaciente,
            profesional: initial.profesional,
            modalidadId:
              initial.modalidadId && modalidades.some((m) => m.id === initial.modalidadId)
                ? initial.modalidadId
                : modalidadDefaultId,
            email: initial.email,
            prestacionIds: initial.items.map((i) => i.prestacionId),
          }
        : { ...EMPTY_FORM, modalidadId: modalidadDefaultId },
    );
    void (async () => {
      setLoadingPrestaciones(true);
      try {
        setPrestaciones(await fetchPrestaciones());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudieron cargar las prestaciones");
      } finally {
        setLoadingPrestaciones(false);
      }
    })();
  }, [open, initial, modalidadDefaultId, modalidades]);

  useEffect(() => {
    if (!open || form.modalidadId) return;
    if (!modalidadDefaultId) return;
    setForm((f) => (f.modalidadId ? f : { ...f, modalidadId: modalidadDefaultId }));
  }, [open, form.modalidadId, modalidadDefaultId]);

  const modalidadSeleccionada = useMemo(
    () => modalidades.find((m) => m.id === form.modalidadId) ?? null,
    [modalidades, form.modalidadId],
  );

  const seleccionadas = useMemo(() => {
    const byId = new Map(prestaciones.map((p) => [p.id, p]));
    // Respetar el orden de prestacionIds (es el orden del PDF).
    return form.prestacionIds
      .map((id) => byId.get(id))
      .filter((p): p is Prestacion => p !== undefined);
  }, [prestaciones, form.prestacionIds]);

  const totales = useMemo(() => {
    const totalEfectivo = seleccionadas.reduce((s, p) => s + p.precioEfectivo, 0);
    const total3Cuotas = seleccionadas.reduce((s, p) => s + p.precio3Cuotas, 0);
    return { totalEfectivo, total3Cuotas };
  }, [seleccionadas]);

  const prestacionesFiltradas = useMemo(() => {
    const q = busquedaPrest.trim().toLowerCase();
    const filtradas = q
      ? prestaciones.filter((p) =>
          [p.titulo, p.tipo, p.descripcion].join(" ").toLowerCase().includes(q),
        )
      : prestaciones;

    return [...filtradas].sort((a, b) => {
      const aOk = prestacionTienePrecios(a);
      const bOk = prestacionTienePrecios(b);
      if (aOk === bOk) return 0;
      return aOk ? -1 : 1;
    });
  }, [prestaciones, busquedaPrest]);

  const puedeGuardar = useMemo(() => {
    if (!form.nombrePaciente.trim()) return false;
    if (!form.email.trim()) return false;
    if (!form.profesional.trim()) return false;
    if (!form.modalidadId.trim()) return false;
    if (form.prestacionIds.length === 0) return false;
    return seleccionadas.length > 0 && seleccionadas.every(prestacionTienePrecios);
  }, [form, seleccionadas]);

  function togglePrestacion(id: string) {
    const prestacion = prestaciones.find((p) => p.id === id);
    if (prestacion && !prestacionTienePrecios(prestacion)) return;

    setForm((prev) => {
      const has = prev.prestacionIds.includes(id);
      return {
        ...prev,
        prestacionIds: has
          ? prev.prestacionIds.filter((x) => x !== id)
          : [...prev.prestacionIds, id],
      };
    });
  }

  function reordenarPrestacionPorIndice(fromId: string, insertAt: number) {
    setForm((prev) => {
      const ids = [...prev.prestacionIds];
      const fromIndex = ids.indexOf(fromId);
      if (fromIndex < 0) return prev;

      let target = Math.max(0, Math.min(insertAt, ids.length));
      const [moved] = ids.splice(fromIndex, 1);
      if (target > fromIndex) target -= 1;
      if (target === fromIndex) return prev;
      ids.splice(target, 0, moved!);
      return { ...prev, prestacionIds: ids };
    });
  }

  function handleDragStartPrestacion(id: string) {
    if (disabled) return;
    setDragPrestacionId(id);
    setDropIndex(null);
  }

  function handleDragOverPrestacion(e: DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragPrestacionId) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const nextIndex = e.clientY < midY ? index : index + 1;
    setDropIndex(nextIndex);
  }

  function handleDropPrestacion(e: DragEvent) {
    e.preventDefault();
    if (dragPrestacionId != null && dropIndex != null) {
      reordenarPrestacionPorIndice(dragPrestacionId, dropIndex);
    }
    setDragPrestacionId(null);
    setDropIndex(null);
  }

  function handleDragEndPrestacion() {
    setDragPrestacionId(null);
    setDropIndex(null);
  }

  async function prepararPdfPreview(modo: "crear" | "enviar") {
    if (!form.nombrePaciente.trim()) {
      toast.warning("Ingresá el nombre del paciente");
      return;
    }
    if (!form.email.trim()) {
      toast.warning("Ingresá el email del paciente");
      return;
    }
    if (!form.profesional.trim()) {
      toast.warning("Seleccioná un profesional");
      return;
    }
    if (!form.modalidadId.trim() || !modalidadSeleccionada) {
      toast.warning("Seleccioná una modalidad");
      return;
    }
    if (form.prestacionIds.length === 0) {
      toast.warning("Seleccioná al menos una prestación");
      return;
    }
    if (seleccionadas.some((p) => !prestacionTienePrecios(p))) {
      toast.warning("Hay prestaciones seleccionadas sin precios");
      return;
    }

    setAccion(modo);
    setSaving(true);
    try {
      let templateHtml = plantillaBody;
      try {
        const plantilla = await fetchPresupuestoPlantillaConfig();
        templateHtml = plantilla.data.body;
        setPlantillaBody(templateHtml);
      } catch {
        if (!templateHtml.trim()) {
          throw new Error("No se pudo cargar la plantilla del presupuesto");
        }
      }

      const fecha = isEditing ? initial!.fecha : fechaHoyIso();
      const items = seleccionadas.map(prestacionToItem);
      const plantillaCtx = {
        nombrePaciente: form.nombrePaciente.trim(),
        email: form.email.trim(),
        nombreProfesional: form.profesional.trim(),
        modalidadTitulo: modalidadSeleccionada.titulo,
        lugarEvaluacion: modalidadSeleccionada.textoPdf,
        fecha,
        items,
        totalEfectivo: totales.totalEfectivo,
        total3Cuotas: totales.total3Cuotas,
      };
      const body = renderPresupuestoPlantillaBody(templateHtml, plantillaCtx);
      const blob = pdfBlobFromDoc(generarPdfPresupuesto({ fecha, body }));
      const pdfBase64 = await blobToBase64(blob);
      setPdfPreview({
        blob,
        pdfBase64,
        modo,
        fecha,
        plantillaHtml: templateHtml,
        plantillaBaselineHtml: templateHtml,
        plantillaCtx,
        editorKey: Date.now(),
        plantillaDirty: false,
        updatingPdf: false,
      });
      setPlantillaVarsOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo generar el PDF del presupuesto",
      );
    } finally {
      setSaving(false);
      setAccion(null);
    }
  }

  function applyPlantillaHtml(html: string) {
    const next = canonicalRichHtml(html);
    setPdfPreview((prev) => {
      if (!prev) return prev;
      if (richHtmlEquivalent(next, prev.plantillaHtml)) return prev;
      return {
        ...prev,
        plantillaHtml: next,
        plantillaDirty: !richHtmlEquivalent(next, prev.plantillaBaselineHtml),
      };
    });
  }

  function insertPlantillaVariable(key: string) {
    const token = `{{${key}}}`;
    const el = plantillaAreaRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertText", false, token);
    const html = normalizeRichHtml(stripTemplateVarDecorations(el.innerHTML));
    applyPlantillaHtml(html);
    refreshTemplateVarDecorations(el, html, true);
  }

  function restaurarPlantillaPreview() {
    setPdfPreview((prev) =>
      prev
        ? {
            ...prev,
            plantillaHtml: prev.plantillaBaselineHtml,
            plantillaDirty: false,
            editorKey: Date.now(),
          }
        : prev,
    );
  }

  async function actualizarPdfDesdePlantilla() {
    if (!pdfPreview) return;
    if (!pdfPreview.plantillaHtml.trim()) {
      toast.warning("La plantilla no puede estar vacía");
      return;
    }

    setPdfPreview((prev) => (prev ? { ...prev, updatingPdf: true } : prev));
    try {
      const body = renderPresupuestoPlantillaBody(
        pdfPreview.plantillaHtml,
        pdfPreview.plantillaCtx,
      );
      const blob = pdfBlobFromDoc(
        generarPdfPresupuesto({ fecha: pdfPreview.fecha, body }),
      );
      const pdfBase64 = await blobToBase64(blob);
      setPdfPreview((prev) =>
        prev
          ? {
              ...prev,
              blob,
              pdfBase64,
              plantillaBaselineHtml: prev.plantillaHtml,
              plantillaDirty: false,
              updatingPdf: false,
            }
          : prev,
      );
      toast.success("PDF actualizado");
    } catch (error) {
      setPdfPreview((prev) => (prev ? { ...prev, updatingPdf: false } : prev));
      toast.error(
        error instanceof Error ? error.message : "No se pudo actualizar el PDF",
      );
    }
  }

  async function confirmarPdfPreview() {
    if (!pdfPreview) return;

    const { pdfBase64, modo } = pdfPreview;
    setAccion(modo);
    setSaving(true);
    try {
      const payload = {
        nombrePaciente: form.nombrePaciente.trim(),
        profesional: form.profesional.trim(),
        modalidadId: form.modalidadId,
        email: form.email.trim(),
        prestacionIds: form.prestacionIds,
        pdfBase64,
        enviar: false,
      };

      if (modo === "enviar") {
        const guardado = isEditing
          ? await updatePresupuesto(initial!.id, payload)
          : await createPresupuesto(payload);

        setPdfPreview(null);
        onSaved(guardado);
        onClose();
        toast.success(
          isEditing
            ? "Presupuesto actualizado. Revisá el email antes de enviar."
            : "Presupuesto creado. Revisá el email antes de enviar.",
        );
        onRequestEnviar?.(guardado);
        return;
      }

      const saved = isEditing
        ? await updatePresupuesto(initial!.id, payload)
        : await createPresupuesto(payload);

      setPdfPreview(null);
      onSaved(saved);
      onClose();
      toast.success(isEditing ? "Presupuesto actualizado" : "Presupuesto creado");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : isEditing
            ? "No se pudo actualizar el presupuesto"
            : "No se pudo crear el presupuesto",
      );
    } finally {
      setSaving(false);
      setAccion(null);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void prepararPdfPreview("crear");
  }

  if (!open) return null;

  const disabled = saving || loadingPrestaciones;
  const accionesDeshabilitadas = disabled || !puedeGuardar;
  const tituloModal = isEditing ? "Editar presupuesto" : "Crear presupuesto";
  const labelGuardar = "Revisar PDF y guardar";
  const labelEnviar = "Revisar PDF y email";
  const labelGuardando = "Generando PDF…";
  const labelEnviando = "Generando PDF…";
  const confirmLabel =
    pdfPreview?.modo === "enviar" ? "Confirmar y revisar email" : "Confirmar y guardar";
  const usedPlantillaVars = collectUsedPlantillaVars(pdfPreview?.plantillaHtml ?? "");

  return (
    <>
    <ModalShell
      title={tituloModal}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={disabled}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-outline" disabled={accionesDeshabilitadas}>
            {saving && accion === "crear" ? labelGuardando : labelGuardar}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={accionesDeshabilitadas}
            onClick={() => void prepararPdfPreview("enviar")}
          >
            {saving && accion === "enviar" ? labelEnviando : labelEnviar}
          </button>
        </>
      }
    >
      <div className="form-stack presup-form-shell">
        <div className="presup-form-main">
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="presup-nombre">Paciente *</label>
              <input
                id="presup-nombre"
                value={form.nombrePaciente}
                onChange={(e) => setForm((f) => ({ ...f, nombrePaciente: e.target.value }))}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="presup-email">Email *</label>
              <input
                id="presup-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="form-grid">
            <div className={`form-group${creandoProfesional ? " form-group--full" : ""}`}>
              <label htmlFor="presup-profesional">Profesional *</label>
              <ProfesionalPresupuestoField
                id="presup-profesional"
                value={form.profesional}
                profesionales={profesionales}
                disabled={disabled}
                onChange={(profesional) => setForm((f) => ({ ...f, profesional }))}
                onProfesionalesChange={onProfesionalesChange}
                onCreatingChange={setCreandoProfesional}
              />
            </div>
            {!creandoProfesional ? (
              <div className="form-group">
                <label htmlFor="presup-modalidad">Modalidad *</label>
                <select
                  id="presup-modalidad"
                  value={form.modalidadId}
                  disabled={disabled || modalidades.length === 0}
                  onChange={(e) => setForm((f) => ({ ...f, modalidadId: e.target.value }))}
                  required
                >
                  {modalidades.length === 0 ? (
                    <option value="">Sin modalidades configuradas</option>
                  ) : (
                    modalidades.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.titulo}
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : null}
          </div>

          <div className="form-group form-group--presup-prest">
            <div className="presup-prest-toolbar">
              <label htmlFor="presup-prest-search">Prestaciones *</label>
            </div>
            {loadingPrestaciones ? (
              <p className="text-muted presup-prest-loading">Cargando prestaciones…</p>
            ) : prestaciones.length === 0 ? (
              <p className="text-muted">No hay prestaciones en el catálogo.</p>
            ) : (
              <>
                <div className="presup-prest-search table-search">
                  <span className="table-search__icon" aria-hidden>
                    <IconSearch size={16} />
                  </span>
                  <input
                    id="presup-prest-search"
                    type="search"
                    value={busquedaPrest}
                    onChange={(e) => setBusquedaPrest(e.target.value)}
                    placeholder="Filtrar prestaciones…"
                    aria-label="Filtrar prestaciones"
                  />
                </div>
                <ul className="presup-prest-list">
                  {prestacionesFiltradas.map((p) => {
                    const checked = form.prestacionIds.includes(p.id);
                    const selectable = prestacionTienePrecios(p);
                    return (
                      <li
                        key={p.id}
                        className={`presup-prest-card${checked ? " is-selected" : ""}${!selectable ? " is-disabled" : ""}`}
                      >
                        <label
                          className={`presup-prest-card__label${!selectable ? " presup-prest-card__label--disabled" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="presup-prest-card__check"
                            checked={checked}
                            disabled={!selectable}
                            onChange={() => togglePrestacion(p.id)}
                            aria-disabled={!selectable}
                          />
                          <span className="presup-prest-card__content">
                            <span className="presup-prest-card__title">{p.titulo}</span>
                            <span className="presup-prest-card__precios">
                              <span className="presup-prest-card__precio">
                                <span className="presup-prest-card__precio-label">Efect/Transf</span>
                                <span className="presup-prest-card__precio-val">
                                  {p.precioEfectivo > 0 ? formatMoney(p.precioEfectivo) : "—"}
                                </span>
                              </span>
                              <span className="presup-prest-card__precio">
                                <span className="presup-prest-card__precio-label">3 cuotas</span>
                                <span className="presup-prest-card__precio-val">
                                  {p.precio3Cuotas > 0 ? (
                                    <>
                                      {formatMoney(p.precio3Cuotas)}
                                      <span className="presup-prest-card__cuota">
                                        {" "}
                                        ({formatMoney(p.precio3Cuotas / 3)}/cuota)
                                      </span>
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </span>
                              </span>
                            </span>
                            {!selectable ? (
                              <span className="presup-prest-card__aviso">Sin precios cargados</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {prestacionesFiltradas.length === 0 ? (
                  <p className="text-muted presup-prest-empty">Sin resultados para esa búsqueda.</p>
                ) : null}
              </>
            )}
          </div>
        </div>

        <aside className="presup-seleccionadas" aria-label="Prestaciones seleccionadas">
          <div className="presup-seleccionadas__header">
            <span>Seleccionadas</span>
            <strong>{form.prestacionIds.length}</strong>
          </div>
          <p className="presup-seleccionadas__hint">Arrastrá para ordenar en el PDF</p>

          {seleccionadas.length > 0 ? (
            <ol
              className={`presup-orden-list${dragPrestacionId ? " is-sorting" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={handleDropPrestacion}
            >
              {seleccionadas.map((p, index) => {
                const fromIndex = dragPrestacionId
                  ? seleccionadas.findIndex((item) => item.id === dragPrestacionId)
                  : -1;
                const showDropBefore =
                  dragPrestacionId != null &&
                  dropIndex === index &&
                  dropIndex !== fromIndex &&
                  dropIndex !== fromIndex + 1;

                return (
                  <li
                    key={p.id}
                    className={`presup-orden-item${dragPrestacionId === p.id ? " is-dragging" : ""}${
                      showDropBefore ? " has-drop-before" : ""
                    }`}
                    draggable={!disabled}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", p.id);
                      handleDragStartPrestacion(p.id);
                    }}
                    onDragOver={(e) => handleDragOverPrestacion(e, index)}
                    onDragEnd={handleDragEndPrestacion}
                  >
                    <span className="presup-orden-item__grip" aria-hidden title="Arrastrar">
                      <IconGrip size={14} />
                    </span>
                    <span className="presup-orden-item__num" aria-hidden>
                      {index + 1}
                    </span>
                    <span className="presup-orden-item__title">{p.titulo}</span>
                  </li>
                );
              })}
              {(() => {
                const fromIndex = dragPrestacionId
                  ? seleccionadas.findIndex((item) => item.id === dragPrestacionId)
                  : -1;
                const showEnd =
                  dragPrestacionId != null &&
                  dropIndex === seleccionadas.length &&
                  fromIndex !== seleccionadas.length - 1;
                return showEnd ? <li className="presup-orden-drop-end" aria-hidden /> : null;
              })()}
            </ol>
          ) : (
            <p className="presup-seleccionadas__empty">Marcá prestaciones a la izquierda.</p>
          )}

            <div className="presup-totales__precios">
              <div className="presup-totales__precio">
                <span className="presup-totales__precio-label">Total Efect/Transf</span>
                <strong className="presup-totales__precio-val">
                  {totales.totalEfectivo > 0 ? formatMoney(totales.totalEfectivo) : "—"}
                </strong>
              </div>
              <div className="presup-totales__precio">
                <span className="presup-totales__precio-label">Total 3 cuotas</span>
                <strong className="presup-totales__precio-val">
                  {totales.total3Cuotas > 0 ? (
                    <>
                      {formatMoney(totales.total3Cuotas)}
                      <span className="presup-seleccionadas__cuota">
                        {" "}
                        ({formatMoney(totales.total3Cuotas / 3)}/cuota)
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
            </div>
        </aside>
      </div>
    </ModalShell>

    <PdfViewerModal
      open={pdfPreview !== null}
      blob={pdfPreview?.blob ?? null}
      title={`Presupuesto - ${form.nombrePaciente.trim() || "paciente"}`}
      subtitle=""
      hideFileActions
      onClose={() => {
        if (!saving && !pdfPreview?.updatingPdf) {
          setPlantillaVarsOpen(false);
          setPdfPreview(null);
        }
      }}
      headerActions={
        <>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setPlantillaVarsOpen(false);
              setPdfPreview(null);
            }}
            disabled={saving || Boolean(pdfPreview?.updatingPdf)}
          >
            Volver a editar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void confirmarPdfPreview()}
            disabled={
              saving ||
              !pdfPreview ||
              pdfPreview.updatingPdf ||
              pdfPreview.plantillaDirty
            }
            title={
              pdfPreview?.plantillaDirty
                ? "Actualizá el PDF antes de confirmar"
                : undefined
            }
          >
            {saving ? "Guardando…" : confirmLabel}
          </button>
        </>
      }
      sidePanel={
        pdfPreview ? (
          <div className="presup-pdf-plantilla">
            <div className="presup-pdf-plantilla__toolbar">
              <div>
                <h3>Plantilla del presupuesto</h3>
                <p className="text-muted">
                  {pdfPreview.plantillaDirty
                    ? "Hay cambios sin aplicar al PDF."
                    : "Las variables se reemplazan al actualizar el PDF."}
                </p>
              </div>
              <div className="presup-pdf-plantilla__toolbar-actions">
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm${plantillaVarsOpen ? " is-active" : ""}`}
                  aria-expanded={plantillaVarsOpen}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPlantillaVarsOpen((open) => !open)}
                  disabled={saving || pdfPreview.updatingPdf}
                >
                  Variables
                </button>
                {pdfPreview.plantillaDirty ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={restaurarPlantillaPreview}
                    disabled={saving || pdfPreview.updatingPdf}
                  >
                    Restaurar
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void actualizarPdfDesdePlantilla()}
                  disabled={
                    saving ||
                    pdfPreview.updatingPdf ||
                    !pdfPreview.plantillaDirty ||
                    !pdfPreview.plantillaHtml.trim()
                  }
                >
                  {pdfPreview.updatingPdf ? "Actualizando…" : "Actualizar PDF"}
                </button>
              </div>
            </div>
            <div className="presup-pdf-plantilla__body">
              <BasicRichTextEditor
                id="presup-pdf-plantilla-editor"
                value={pdfPreview.plantillaHtml}
                highlightTemplateVars
                onChange={applyPlantillaHtml}
                resetKey={`presup-pdf-plantilla-${pdfPreview.editorKey}`}
                placeholder="Contenido de la plantilla. Abrí Variables para insertar campos."
                className="presup-pdf-plantilla__editor"
                onAreaMount={(el) => {
                  plantillaAreaRef.current = el;
                }}
              />
            </div>
          </div>
        ) : null
      }
      viewerTopPanel={
        pdfPreview && plantillaVarsOpen ? (
          <div
            className="presup-pdf-vars-dock"
            role="region"
            aria-label="Variables de plantilla"
          >
            <div className="presup-pdf-vars-dock__head">
              <div>
                <h3>Variables</h3>
                <p>Poné el cursor en la plantilla y tocá una variable para insertarla.</p>
              </div>
              <button
                type="button"
                className="fl-icon-btn"
                aria-label="Cerrar variables"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPlantillaVarsOpen(false)}
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="presup-pdf-vars-dock__body">
              <div className="presup-pdf-plantilla__vars-groups">
                {PLANTILLA_VAR_GROUPS.map((group) => (
                  <div key={group.title} className="presup-pdf-plantilla__vars-group">
                    <p className="presup-pdf-plantilla__vars-group-title">{group.title}</p>
                    <div className="presup-pdf-plantilla__vars-list">
                      {group.keys.map((v) => {
                        const enUso = usedPlantillaVars.has(v);
                        return (
                          <button
                            key={v}
                            type="button"
                            className={`config-var${enUso ? " is-used" : " is-unused"}`}
                            title={
                              enUso
                                ? `En uso · Insertar {{${v}}}`
                                : `Sin usar · Insertar {{${v}}}`
                            }
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertPlantillaVariable(v)}
                          >
                            {PRESUPUESTO_PLANTILLA_VAR_LABELS[v]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null
      }
    />
    </>
  );
}

function ModalShell({
  title,
  onClose,
  onSubmit,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fl-modal-backdrop" role="presentation">
      <form
        className="fl-modal fl-modal--wide fl-modal--presupuesto"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
      >
        <div className="fl-modal__header">
          <h2>{title}</h2>
          <button type="button" className="fl-icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX size={18} />
          </button>
        </div>
        <div className="fl-modal__body">{children}</div>
        <div className="fl-modal__footer">{footer}</div>
      </form>
    </div>
  );
}
