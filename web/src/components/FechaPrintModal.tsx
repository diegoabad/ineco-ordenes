import { useEffect, useState, type FormEvent } from "react";
import { fechaHoyIso } from "../lib/fechas";
import { DatePicker } from "./DatePicker";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title?: string;
  onClose: () => void;
  onConfirm: (fecha: string) => void;
};

export function FechaPrintModal({ open, title = "Fecha de la orden", onClose, onConfirm }: Props) {
  const [fecha, setFecha] = useState(fechaHoyIso);

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
            form="fecha-print-form"
            className="btn btn-primary"
            disabled={!fecha}
          >
            Continuar e imprimir
          </button>
        </>
      }
    >
      <form id="fecha-print-form" onSubmit={handleSubmit}>
        <p className="modal-hint">
          Indicá la fecha que figurará en la orden (Creada). Se pide siempre antes de imprimir.
        </p>
        <div className="form-group">
          <label htmlFor="fecha-print">Fecha *</label>
          <DatePicker
            id="fecha-print"
            value={fecha}
            onChange={setFecha}
            aria-label="Fecha de la orden"
          />
        </div>
      </form>
    </Modal>
  );
}
