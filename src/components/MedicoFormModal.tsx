import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Medico, MedicoFormData } from "../types";
import { EMPTY_MEDICO } from "../types";
import { IconUpload, IconX } from "./Icons";

type Props = {
  open: boolean;
  initial?: Medico | null;
  onClose: () => void;
  onSave: (data: MedicoFormData, id?: string) => void;
};

function toFormData(m: Medico): MedicoFormData {
  return {
    nombre: m.nombre,
    especialidad: m.especialidad,
    matricula: m.matricula,
    firmaDataUrl: m.firmaDataUrl,
  };
}

export function MedicoFormModal({ open, initial, onClose, onSave }: Props) {
  const [form, setForm] = useState<MedicoFormData>(EMPTY_MEDICO);
  const firmaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? toFormData(initial) : EMPTY_MEDICO);
  }, [open, initial]);

  function set<K extends keyof MedicoFormData>(key: K, value: MedicoFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleFirmaChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Seleccioná una imagen (PNG o JPG).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("firmaDataUrl", String(reader.result));
    reader.readAsDataURL(file);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    onSave(form, initial?.id);
  }

  const editing = Boolean(initial);

  return (
    <ModalShell
      open={open}
      title={editing ? "Editar médico" : "Nuevo médico"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Guardar cambios" : "Agregar"}
    >
      <div className="form-stack">
        <div className="form-group">
          <label htmlFor="medico-nombre">Nombre *</label>
          <input
            id="medico-nombre"
            value={form.nombre}
            onChange={(e) => set("nombre", e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="medico-esp">Especialidad</label>
          <input
            id="medico-esp"
            value={form.especialidad}
            onChange={(e) => set("especialidad", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="medico-mat">Matrícula</label>
          <input
            id="medico-mat"
            value={form.matricula}
            onChange={(e) => set("matricula", e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Firma (imagen)</label>
          <div className="firma-row">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => firmaInputRef.current?.click()}
            >
              <IconUpload size={14} />
              {form.firmaDataUrl ? "Cambiar firma" : "Cargar firma"}
            </button>
            <input
              ref={firmaInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => handleFirmaChange(e.target.files?.[0] ?? null)}
            />
            {form.firmaDataUrl ? (
              <>
                <img src={form.firmaDataUrl} alt="Firma" className="firma-preview" />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => set("firmaDataUrl", null)}
                >
                  Quitar
                </button>
              </>
            ) : (
              <span className="text-muted">Sin firma cargada</span>
            )}
          </div>
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
    <div className="fl-modal-backdrop" role="presentation" onClick={onClose}>
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
