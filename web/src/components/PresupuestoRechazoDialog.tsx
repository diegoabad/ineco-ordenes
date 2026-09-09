import { useEffect, useState, type FormEvent } from "react";
import { formatNombrePersona } from "../lib/nombrePersona";
import type { MotivoRechazoPresupuesto, Presupuesto } from "../types";
import { IconX } from "./Icons";

const SIN_MOTIVO_VALUE = "__sin_motivo__";
const OTRO_VALUE = "__otro__";

type Props = {
  open: boolean;
  presupuesto: Presupuesto | null;
  motivos: MotivoRechazoPresupuesto[];
  saving?: boolean;
  onClose: () => void;
  onConfirm: (motivo: string) => void | Promise<void>;
};

export function PresupuestoRechazoDialog({
  open,
  presupuesto,
  motivos,
  saving = false,
  onClose,
  onConfirm,
}: Props) {
  const [motivoId, setMotivoId] = useState(SIN_MOTIVO_VALUE);
  const [motivoLibre, setMotivoLibre] = useState("");
  const editandoMotivo = Boolean(presupuesto?.estado === "rechazado");

  useEffect(() => {
    if (!open || !presupuesto) return;
    const actual = presupuesto.motivoRechazo?.trim() ?? "";
    if (!actual) {
      setMotivoId(SIN_MOTIVO_VALUE);
      setMotivoLibre("");
      return;
    }
    const match = motivos.find(
      (m) => m.label.trim().toLowerCase() === actual.toLowerCase(),
    );
    if (match) {
      setMotivoId(match.id);
      setMotivoLibre("");
      return;
    }
    setMotivoId(OTRO_VALUE);
    setMotivoLibre(actual);
  }, [open, presupuesto?.id, presupuesto?.motivoRechazo, motivos]);

  if (!open || !presupuesto) return null;

  const usandoOtro = motivoId === OTRO_VALUE;
  const usandoSinMotivo = motivoId === SIN_MOTIVO_VALUE;
  const motivoFinal = usandoSinMotivo
    ? ""
    : usandoOtro
      ? motivoLibre.trim()
      : motivos.find((m) => m.id === motivoId)?.label.trim() || "";

  const puedeConfirmar = usandoSinMotivo || Boolean(motivoFinal);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!puedeConfirmar || saving) return;
    await onConfirm(motivoFinal);
  }

  return (
    <div className="fl-modal-backdrop" role="presentation" onClick={onClose}>
      <form
        className="fl-modal"
        role="dialog"
        aria-modal="true"
        aria-label={editandoMotivo ? "Motivo de rechazo" : "Rechazar presupuesto"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void onSubmit(e)}
      >
        <div className="fl-modal__header">
          <h2>{editandoMotivo ? "Motivo de rechazo" : "Rechazar presupuesto"}</h2>
          <button
            type="button"
            className="fl-icon-btn"
            onClick={onClose}
            aria-label="Cerrar"
            disabled={saving}
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="fl-modal__body">
          <p className="text-muted" style={{ marginTop: 0 }}>
            Paciente: <strong>{formatNombrePersona(presupuesto.nombrePaciente)}</strong>
          </p>
          <label className="form-group">
            <span>Motivo</span>
            <select
              value={motivoId}
              disabled={saving}
              onChange={(e) => setMotivoId(e.target.value)}
            >
              <option value={SIN_MOTIVO_VALUE}>Sin motivo</option>
              {motivos
                .filter((m) => m.label.trim())
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label.trim()}
                  </option>
                ))}
              <option value={OTRO_VALUE}>Otro</option>
            </select>
          </label>
          {usandoOtro ? (
            <label className="form-group">
              <span>Detalle del motivo</span>
              <textarea
                value={motivoLibre}
                onChange={(e) => setMotivoLibre(e.target.value)}
                rows={3}
                placeholder="Escribí el motivo"
                disabled={saving}
                required
                autoFocus
              />
            </label>
          ) : null}
        </div>
        <div className="fl-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || !puedeConfirmar}
          >
            {saving
              ? "Guardando…"
              : editandoMotivo
                ? "Guardar motivo"
                : "Confirmar rechazo"}
          </button>
        </div>
      </form>
    </div>
  );
}
