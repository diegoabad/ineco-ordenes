import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "react-toastify";
import { copiarLinkFirma } from "../lib/firmaLink";
import { firmaSrc } from "../lib/firma";
import type { Medico, MedicoFormData, MedicoSavePayload } from "../types";
import { EMPTY_MEDICO } from "../types";
import { IconLink, IconUpload, IconX } from "./Icons";

type Props = {
  open: boolean;
  initial?: Medico | null;
  firmaCacheBust?: number;
  saving?: boolean;
  onClose: () => void;
  onSave: (payload: MedicoSavePayload) => void | Promise<void>;
};

function toFormData(m: Medico): MedicoFormData {
  return {
    nombre: m.nombre,
    especialidad: m.especialidad,
    matricula: m.matricula,
    firmaUrl: m.firmaUrl,
  };
}

export function MedicoFormModal({
  open,
  initial,
  firmaCacheBust,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<MedicoFormData>(EMPTY_MEDICO);
  const [firmaFile, setFirmaFile] = useState<File | null>(null);
  const [removeFirma, setRemoveFirma] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const firmaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? toFormData(initial) : EMPTY_MEDICO);
    setFirmaFile(null);
    setRemoveFirma(false);
    setPreviewUrl(null);
  }, [open, initial]);

  useEffect(() => {
    if (!firmaFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(firmaFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firmaFile]);

  function set<K extends keyof MedicoFormData>(key: K, value: MedicoFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleFirmaChange(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.warning("Seleccioná una imagen (PNG o JPG).");
      return;
    }
    setFirmaFile(file);
    setRemoveFirma(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) return;
    void onSave({
      data: form,
      id: initial?.id,
      firmaFile,
      removeFirma,
    });
  }

  const editing = Boolean(initial);
  const firmaVisible =
    previewUrl ?? (removeFirma ? null : firmaSrc(form.firmaUrl, firmaCacheBust));

  async function handleCopiarLinkFirma() {
    if (!initial?.id) return;
    await copiarLinkFirma(initial.id);
  }

  return (
    <ModalShell
      open={open}
      title={editing ? "Editar médico" : "Nuevo médico"}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={editing ? "Guardar cambios" : "Agregar"}
      saving={saving}
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
          <div className="firma-editor">
            <div className="firma-row">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => firmaInputRef.current?.click()}
              >
                <IconUpload size={14} />
                Subir archivo
              </button>
              {initial?.id ? (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => void handleCopiarLinkFirma()}
                >
                  <IconLink size={14} />
                  Copiar link
                </button>
              ) : null}
              <input
                ref={firmaInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => handleFirmaChange(e.target.files?.[0] ?? null)}
              />
              {firmaVisible ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setFirmaFile(null);
                    setRemoveFirma(true);
                  }}
                >
                  Quitar firma
                </button>
              ) : (
                <span className="text-muted">Sin firma cargada</span>
              )}
            </div>
            {firmaVisible ? (
              <div className="firma-preview-wrap">
                <img src={firmaVisible} alt="Firma" className="firma-preview firma-preview--modal" />
              </div>
            ) : null}
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
  saving,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
  saving?: boolean;
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
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Guardando…" : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
