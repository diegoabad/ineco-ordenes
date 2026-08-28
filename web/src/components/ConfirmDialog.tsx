import { IconX } from "./Icons";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fl-modal-backdrop" role="presentation">
      <div
        className="fl-modal fl-modal--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-modal__header">
          <h2 id="confirm-title">{title}</h2>
          <button type="button" className="fl-icon-btn" onClick={onCancel} aria-label="Cerrar">
            <IconX size={18} />
          </button>
        </div>
        <div className="fl-modal__body">
          <p className="confirm-dialog__message">{message}</p>
        </div>
        <div className="fl-modal__footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
