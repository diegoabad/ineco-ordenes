import type { ReactNode } from "react";
import { IconX } from "./Icons";

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Modal de aviso grande (recordatorio de app). */
  alert?: boolean;
  /** Si false, oculta el botón X (útil para avisos bloqueantes). */
  hideClose?: boolean;
};

export function Modal({ open, title, onClose, children, footer, wide, alert, hideClose }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fl-modal-backdrop" role="presentation">
      <div
        className={`fl-modal${wide ? " fl-modal--wide" : ""}${alert ? " fl-modal--alert" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-modal__header">
          <h2 id="modal-title">{title}</h2>
          {hideClose ? null : (
            <button type="button" className="fl-icon-btn" onClick={onClose} aria-label="Cerrar">
              <IconX size={18} />
            </button>
          )}
        </div>
        <div className="fl-modal__body">{children}</div>
        {footer ? <div className="fl-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
