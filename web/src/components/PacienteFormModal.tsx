import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Medico, Paciente, PacienteFormData } from "../types";
import { EMPTY_PACIENTE } from "../types";
import { IconX } from "./Icons";

type Props = {
  open: boolean;
  initial?: Paciente | null;
  medicos: Medico[];
  medicoPorDefectoId: string | null;
  onClose: () => void;
  onSave: (data: PacienteFormData, id?: string) => void;
};

function toFormData(p: Paciente): PacienteFormData {
  return {
    paciente: p.paciente,
    email: p.email ?? "",
    obraSocial: p.obraSocial,
    afiliado: p.afiliado,
    prestacion: p.prestacion,
    diagnostico: p.diagnostico,
    medicoId: p.medicoId,
  };
}

export function PacienteFormModal({
  open,
  initial,
  medicos,
  medicoPorDefectoId,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<PacienteFormData>(EMPTY_PACIENTE);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm(toFormData(initial));
      return;
    }
    setForm({
      ...EMPTY_PACIENTE,
      medicoId: medicoPorDefectoId,
    });
  }, [open, initial, medicoPorDefectoId]);

  function set<K extends keyof PacienteFormData>(key: K, value: PacienteFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.paciente.trim()) return;
    onSave(form, initial?.id);
  }

  const editing = Boolean(initial);

  return (
    <ModalShell
      open={open}
      title={editing ? "Editar paciente" : "Nuevo paciente"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Guardar cambios" : "Agregar"}
    >
      <div className="form-stack">
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="paciente">Nombre *</label>
            <input
              id="paciente"
              value={form.paciente}
              onChange={(e) => set("paciente", e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="opcional"
            />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="obraSocial">Obra Social</label>
            <input
              id="obraSocial"
              value={form.obraSocial}
              onChange={(e) => set("obraSocial", e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="afiliado">Afiliado</label>
            <input
              id="afiliado"
              value={form.afiliado}
              onChange={(e) => set("afiliado", e.target.value)}
            />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="medicoId">Profesional</label>
            <select
              id="medicoId"
              value={form.medicoId ?? ""}
              onChange={(e) => set("medicoId", e.target.value || null)}
            >
              <option value="">Sin profesional (usar por defecto al generar PDF)</option>
              {medicos
                .filter((m) => m.activo || m.id === form.medicoId)
                .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                  {m.especialidad ? ` · ${m.especialidad}` : ""}
                  {!m.activo ? " (inactivo)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="diagnostico">Diagnóstico</label>
            <input
              id="diagnostico"
              value={form.diagnostico}
              onChange={(e) => set("diagnostico", e.target.value)}
              placeholder="Ej.: TDAH"
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="prestacion">Prestaciones</label>
          <textarea
            id="prestacion"
            rows={5}
            value={form.prestacion}
            onChange={(e) => set("prestacion", e.target.value)}
            placeholder={
              "Una prestación por línea (Enter = nueva).\nEj.: Solicito Programa de Rehabilitación Integral (leve)…"
            }
          />
          <p className="form-hint">Enter agrega otra prestación. Las líneas vacías no se imprimen.</p>
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
        className="fl-modal fl-modal--wide"
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
