import { useEffect, useState, type FormEvent } from "react";
import { fechaHoyIso } from "../lib/fechas";
import { DatePicker } from "./DatePicker";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title?: string;
  confirmLabel?: string;
  hint?: string;
  onClose: () => void;
  onConfirm: (fecha: string) => void;
};

export function FechaOrdenModal({
  open,
  title = "Fecha de la orden",
  confirmLabel = "Continuar",
  hint,
  onClose,
  onConfirm,
}: Props) {
  const [fecha, setFecha] = useState(() => fechaHoyIso());

  useEffect(() => {
    if (open) setFecha(fechaHoyIso());
  }, [open]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fecha) return;
    onConfirm(fecha);
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            form="fecha-orden-form"
            className="btn btn-primary"
            disabled={!fecha}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <form id="fecha-orden-form" onSubmit={handleSubmit}>
        {hint ? <p className="modal-hint">{hint}</p> : null}
        <div className="form-group">
          <label htmlFor="fecha-orden-modal">Fecha *</label>
          <DatePicker
            id="fecha-orden-modal"
            value={fecha}
            onChange={setFecha}
            aria-label="Fecha de la orden"
          />
        </div>
      </form>
    </Modal>
  );
}
