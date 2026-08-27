import type { ReactNode } from "react";
import { IconX } from "./Icons";

export type DetailField = {
  label: string;
  value?: ReactNode;
};

type Props = {
  open: boolean;
  title: string;
  fields: DetailField[];
  onClose: () => void;
};

function display(value: ReactNode): ReactNode {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  if (typeof value === "string" && !value.trim()) {
    return <span className="text-muted">—</span>;
  }
  return value;
}

export function ViewDetailModal({ open, title, fields, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fl-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="fl-modal fl-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-modal__header">
          <h2>{title}</h2>
          <button type="button" className="fl-icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX size={18} />
          </button>
        </div>
        <div className="fl-modal__body">
          <dl className="detail-list">
            {fields.map((field) => (
              <div key={field.label} className="detail-list__row">
                <dt>{field.label}</dt>
                <dd>{display(field.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="fl-modal__footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
