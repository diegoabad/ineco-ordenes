import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "react-toastify";
import { blobToBase64 } from "../lib/blob";
import { fechaHoyIso } from "../lib/fechas";
import { renderPresupuestoPlantillaBody } from "../lib/presupuestoPlantilla";
import { generarPdfPresupuesto, pdfBlobFromDoc } from "../pdf/generarPresupuestoPdf";
import {
  createPresupuesto,
  enviarPresupuesto,
  fetchPresupuestoPlantillaConfig,
  fetchPrestaciones,
  updatePresupuesto,
} from "../services/dataService";
import type { Prestacion, Presupuesto, PresupuestoFormData, ProfesionalPresupuesto } from "../types";
import { IconSearch, IconX } from "./Icons";
import { ProfesionalPresupuestoField } from "./ProfesionalPresupuestoField";

type Props = {
  open: boolean;
  initial?: Presupuesto | null;
  profesionales?: ProfesionalPresupuesto[];
  onProfesionalesChange?: (profesionales: ProfesionalPresupuesto[]) => void;
  onClose: () => void;
  onSaved: (presupuesto: Presupuesto) => void;
  onEnvioFallido?: () => void;
};

const EMPTY_FORM: PresupuestoFormData = {
  nombrePaciente: "",
  profesional: "",
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
  onClose,
  onSaved,
  onEnvioFallido,
}: Props) {
  const isEditing = initial !== null;
  const [form, setForm] = useState<PresupuestoFormData>(EMPTY_FORM);
  const [prestaciones, setPrestaciones] = useState<Prestacion[]>([]);
  const [loadingPrestaciones, setLoadingPrestaciones] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accion, setAccion] = useState<"crear" | "enviar" | null>(null);
  const [busquedaPrest, setBusquedaPrest] = useState("");
  const [plantillaBody, setPlantillaBody] = useState("");

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
            email: initial.email,
            prestacionIds: initial.items.map((i) => i.prestacionId),
          }
        : EMPTY_FORM,
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
  }, [open, initial]);

  const seleccionadas = useMemo(
    () => prestaciones.filter((p) => form.prestacionIds.includes(p.id)),
    [prestaciones, form.prestacionIds],
  );

  const totales = useMemo(() => {
    const totalEfectivo = seleccionadas.reduce((s, p) => s + p.precioEfectivo, 0);
    const total3Cuotas = seleccionadas.reduce((s, p) => s + p.precio3Cuotas, 0);
    return {
      totalEfectivo,
      total3Cuotas,
      cuotaMensual: total3Cuotas > 0 ? total3Cuotas / 3 : 0,
    };
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

  async function guardarPresupuesto(modo: "crear" | "enviar") {
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
      const fecha = isEditing ? initial!.fecha : fechaHoyIso();
      const items = seleccionadas.map(prestacionToItem);
      const body = renderPresupuestoPlantillaBody(plantillaBody, {
        nombrePaciente: form.nombrePaciente.trim(),
        email: form.email.trim(),
        nombreProfesional: form.profesional.trim(),
        fecha,
        items,
        totalEfectivo: totales.totalEfectivo,
        total3Cuotas: totales.total3Cuotas,
      });
      const doc = generarPdfPresupuesto({ fecha, body });
      const pdfBase64 = await blobToBase64(pdfBlobFromDoc(doc));

      const payload = {
        nombrePaciente: form.nombrePaciente.trim(),
        profesional: form.profesional.trim(),
        email: form.email.trim(),
        prestacionIds: form.prestacionIds,
        pdfBase64,
        enviar: false,
      };

      if (modo === "enviar") {
        const guardado = isEditing
          ? await updatePresupuesto(initial!.id, payload)
          : await createPresupuesto(payload);

        try {
          const enviado = await enviarPresupuesto(guardado.id);
          onSaved(enviado);
          onClose();
          toast.success(
            isEditing ? "Presupuesto actualizado y enviado" : "Presupuesto creado y enviado",
          );
          return;
        } catch (error) {
          const err = error as Error & { data?: unknown };
          const fallido =
            err.data && typeof err.data === "object" && err.data !== null && "id" in err.data
              ? (err.data as Presupuesto)
              : { ...guardado, estado: "fallido" as const };
          onSaved(fallido);
          onClose();
          toast.error("No se pudo enviar el presupuesto");
          onEnvioFallido?.();
          return;
        }
      }

      const saved = isEditing
        ? await updatePresupuesto(initial!.id, payload)
        : await createPresupuesto(payload);

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
    void guardarPresupuesto("crear");
  }

  if (!open) return null;

  const disabled = saving || loadingPrestaciones;
  const accionesDeshabilitadas = disabled || !puedeGuardar;
  const tituloModal = isEditing ? "Editar presupuesto" : "Crear presupuesto";
  const labelGuardar = isEditing ? "Guardar presupuesto" : "Crear presupuesto";
  const labelEnviar = isEditing
    ? "Guardar y enviar presupuesto"
    : "Crear y enviar presupuesto";
  const labelGuardando = isEditing ? "Guardando…" : "Creando…";
  const labelEnviando = isEditing ? "Enviando…" : "Enviando…";

  return (
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
            onClick={() => void guardarPresupuesto("enviar")}
          >
            {saving && accion === "enviar" ? labelEnviando : labelEnviar}
          </button>
        </>
      }
    >
      <div className="form-stack">
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

        <div className="form-group">
          <label htmlFor="presup-profesional">Profesional *</label>
          <ProfesionalPresupuestoField
            id="presup-profesional"
            value={form.profesional}
            profesionales={profesionales}
            disabled={disabled}
            onChange={(profesional) => setForm((f) => ({ ...f, profesional }))}
            onProfesionalesChange={onProfesionalesChange}
          />
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

        <div className="presup-totales">
          <div className="presup-totales__row presup-totales__row--items">
            <span>Prestaciones seleccionadas</span>
            <strong>{form.prestacionIds.length}</strong>
          </div>
          <div className="presup-totales__precios">
            <div className="presup-totales__precio">
              <span className="presup-totales__precio-label">Total Efect/Transf</span>
              <strong className="presup-totales__precio-val">
                {totales.totalEfectivo > 0 ? formatMoney(totales.totalEfectivo) : "—"}
              </strong>
            </div>
            <div className="presup-totales__precio">
              <span className="presup-totales__precio-label">Total 3 cuotas</span>
              <strong className="presup-totales__precio-val presup-totales__precio-val--cuotas">
                {totales.total3Cuotas > 0 ? (
                  <>
                    <span>{formatMoney(totales.total3Cuotas)}</span>
                    <span className="presup-totales__cuota">
                      ({formatMoney(totales.cuotaMensual)}/cuota)
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
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
