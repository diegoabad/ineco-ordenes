import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { normalizeRichHtml } from "../lib/richText";
import type { Prestacion, PrestacionFormData, TipoPrestacion } from "../types";
import { EMPTY_PRESTACION, FRECUENCIAS_TRATAMIENTO, esTipoTratamiento } from "../types";
import { BasicRichTextEditor } from "./BasicRichTextEditor";
import { IconX } from "./Icons";
import { MoneyInput } from "./MoneyInput";
type Props = {
  open: boolean;
  initial?: Prestacion | null;
  tiposPrestacion: TipoPrestacion[];
  /** Tipo que queda elegido al crear, según la pestaña activa. */
  tipoInicial?: string;
  onClose: () => void;
  onSave: (data: PrestacionFormData, id?: string) => void;
};

function toFormData(p: Prestacion): PrestacionFormData {
  return {
    titulo: p.titulo,
    descripcion: p.descripcion,
    tipo: p.tipo,
    duracionMinutos: p.duracionMinutos,
    precioEfectivo: p.precioEfectivo,
    precio3Cuotas: p.precio3Cuotas,
    frecuencia: p.frecuencia ?? null,
    sesiones: p.sesiones ?? null,
  };
}

export function PrestacionFormModal({
  open,
  initial,
  tiposPrestacion,
  tipoInicial,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<PrestacionFormData>(EMPTY_PRESTACION);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm(toFormData(initial));
      return;
    }
    const tipo = tipoInicial || tiposPrestacion[0]?.nombre || EMPTY_PRESTACION.tipo;
    setForm({
      ...EMPTY_PRESTACION,
      tipo,
      sesiones: esTipoTratamiento(tipo) ? 1 : null,
    });
  }, [open, initial, tiposPrestacion, tipoInicial]);

  function set<K extends keyof PrestacionFormData>(key: K, value: PrestacionFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.titulo.trim()) return;
    const tratamiento = esTipoTratamiento(form.tipo);
    const sesiones = Math.max(1, Math.round(form.sesiones || 1));
    if (tratamiento && !form.frecuencia) return;
    onSave(
      {
        ...form,
        descripcion: normalizeRichHtml(form.descripcion),
        precio3Cuotas: tratamiento ? 0 : form.precio3Cuotas,
        frecuencia: tratamiento ? form.frecuencia : null,
        sesiones: tratamiento ? sesiones : null,
      },
      initial?.id,
    );
  }

  const editing = Boolean(initial);
  const tratamiento = esTipoTratamiento(form.tipo);

  return (
    <ModalShell
      open={open}
      title={editing ? "Editar prestación" : "Nueva prestación"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Guardar cambios" : "Agregar"}
    >
      <div className="form-stack">
        <div className="form-group">
          <label htmlFor="prest-titulo">Título *</label>
          <input
            id="prest-titulo"
            value={form.titulo}
            onChange={(e) => set("titulo", e.target.value)}
            required
            autoFocus
          />
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="prest-tipo">Tipo</label>
            <select
              id="prest-tipo"
              value={form.tipo}
              onChange={(e) => set("tipo", e.target.value)}
            >
              {tiposPrestacion.map((t) => (
                <option key={t.nombre} value={t.nombre}>
                  {t.nombre}
                </option>
              ))}
              {form.tipo && !tiposPrestacion.some((t) => t.nombre === form.tipo) ? (
                <option value={form.tipo}>{form.tipo}</option>
              ) : null}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="prest-duracion">Duración (min)</label>
            <input
              id="prest-duracion"
              type="number"
              min={0}
              step={1}
              value={form.duracionMinutos || ""}
              onChange={(e) => set("duracionMinutos", Math.max(0, Math.round(Number(e.target.value) || 0)))}
              placeholder="Ej. 90"
            />
          </div>
        </div>
        <div className="form-group form-group--desc">
          <label htmlFor="prest-desc">Descripción</label>
          <BasicRichTextEditor
            id="prest-desc"
            className="prestacion-desc-editor"
            resetKey={initial?.id ?? "new"}
            value={form.descripcion}
            onChange={(html) => set("descripcion", html)}
            placeholder="Detalle de la prestación. Enter = nueva línea. Pegar solo texto."
          />
        </div>
        <div className={`form-grid${tratamiento ? " form-grid--3" : ""}`}>
          <MoneyInput
            id="prest-efectivo"
            label="Efect/Transf"
            value={form.precioEfectivo}
            onChange={(n) => set("precioEfectivo", n)}
          />
          {tratamiento ? (
            <>
              <div className="form-group">
                <label htmlFor="prest-frecuencia">Frecuencia *</label>
                <select
                  id="prest-frecuencia"
                  value={form.frecuencia ?? ""}
                  required
                  onChange={(e) => set("frecuencia", e.target.value || null)}
                >
                  <option value="">Elegí la frecuencia</option>
                  {FRECUENCIAS_TRATAMIENTO.map((frecuencia) => (
                    <option key={frecuencia} value={frecuencia}>
                      {frecuencia}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="prest-sesiones">Sesiones *</label>
                <input
                  id="prest-sesiones"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={form.sesiones ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw.trim() === "") {
                      set("sesiones", null);
                      return;
                    }
                    const n = Number(raw);
                    if (!Number.isFinite(n)) return;
                    set("sesiones", Math.round(n));
                  }}
                  onBlur={() => {
                    setForm((prev) => ({
                      ...prev,
                      sesiones: !prev.sesiones || prev.sesiones < 1 ? 1 : Math.round(prev.sesiones),
                    }));
                  }}
                />
              </div>
            </>
          ) : (
            <MoneyInput
              id="prest-3cuotas"
              label="3 cuotas"
              value={form.precio3Cuotas}
              onChange={(n) => set("precio3Cuotas", n)}
            />
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  open,
  title,
  onClose,
  onSubmit,
  submitLabel,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fl-modal-backdrop" role="presentation">
      <form
        className="fl-modal fl-modal--wide fl-modal--prestacion"
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
        <div className="fl-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
