import { IconX } from "./Icons";

export type EnvioResultadoItem = {
  pacienteNombre: string;
  email: string;
  ok: boolean;
  errorMessage?: string;
};

type Props = {
  open: boolean;
  items: EnvioResultadoItem[];
  omitidosSinEmail?: number;
  onClose: () => void;
  onVerHistorial?: () => void;
};

export function EnvioResultadoModal({
  open,
  items,
  omitidosSinEmail = 0,
  onClose,
  onVerHistorial,
}: Props) {
  if (!open) return null;

  const okItems = items.filter((i) => i.ok);
  const failItems = items.filter((i) => !i.ok);
  const total = items.length;

  const titulo =
    failItems.length === 0
      ? "Envío completado"
      : okItems.length === 0
        ? "Envío fallido"
        : "Envío con resultados mixtos";

  return (
    <div className="fl-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="fl-modal fl-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="envio-resultado-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-modal__header">
          <h2 id="envio-resultado-title">{titulo}</h2>
          <button type="button" className="fl-icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX size={18} />
          </button>
        </div>

        <div className="fl-modal__body">
          <div className="envio-resultado__summary">
            <span className="chip chip--ok">
              Enviados {okItems.length}/{total}
            </span>
            <span className={`chip ${failItems.length ? "chip--error" : "chip--muted"}`}>
              Fallaron {failItems.length}/{total}
            </span>
            {omitidosSinEmail > 0 ? (
              <span className="chip chip--muted">Sin email: {omitidosSinEmail}</span>
            ) : null}
          </div>

          {failItems.length > 0 ? (
            <section className="envio-resultado__section">
              <h3 className="envio-resultado__heading envio-resultado__heading--error">
                No se enviaron
              </h3>
              <ul className="envio-resultado__list">
                {failItems.map((item) => (
                  <li key={`fail-${item.email}-${item.pacienteNombre}`} className="envio-resultado__item envio-resultado__item--error">
                    <div className="envio-resultado__row">
                      <span className="envio-resultado__nombre">{item.pacienteNombre || "—"}</span>
                      <span className="chip chip--error">Falló</span>
                    </div>
                    <span className="envio-resultado__email">{item.email || "—"}</span>
                    {item.errorMessage ? (
                      <span className="envio-resultado__error">{item.errorMessage}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {okItems.length > 0 ? (
            <section className="envio-resultado__section">
              <h3 className="envio-resultado__heading envio-resultado__heading--ok">
                Enviados correctamente
              </h3>
              <ul className="envio-resultado__list">
                {okItems.map((item) => (
                  <li key={`ok-${item.email}-${item.pacienteNombre}`} className="envio-resultado__item envio-resultado__item--ok">
                    <div className="envio-resultado__row">
                      <span className="envio-resultado__nombre">{item.pacienteNombre || "—"}</span>
                      <span className="chip chip--ok">Enviado</span>
                    </div>
                    <span className="envio-resultado__email">{item.email || "—"}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="fl-modal__footer">
          {onVerHistorial ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                onVerHistorial();
                onClose();
              }}
            >
              Ver historial
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
