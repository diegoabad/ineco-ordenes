import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  buildPresupuestoEmailVarsFromPresupuesto,
  renderPresupuestoEmailPreview,
} from "../lib/presupuestoEmail";
import { enviarPresupuesto, fetchPresupuestoEmailConfig } from "../services/dataService";
import type { Presupuesto } from "../types";
import { BasicRichTextEditor } from "./BasicRichTextEditor";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  presupuesto: Presupuesto | null;
  onClose: () => void;
  onSent: (presupuesto: Presupuesto) => void;
  onFailed?: (presupuesto: Presupuesto) => void;
};

export function PresupuestoEmailPreviewModal({
  open,
  presupuesto,
  onClose,
  onSent,
  onFailed,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!open || !presupuesto) return;

    let cancelled = false;
    const current = presupuesto;
    setLoading(true);
    setSubject("");
    setBody("");

    void (async () => {
      try {
        const { data: config } = await fetchPresupuestoEmailConfig();
        if (cancelled) return;
        const vars = buildPresupuestoEmailVarsFromPresupuesto(current);
        const rendered = renderPresupuestoEmailPreview(config, vars);
        setSubject(rendered.subject);
        setBody(rendered.body);
        setEditorKey((k) => k + 1);
      } catch (error) {
        if (cancelled) return;
        toast.error(
          error instanceof Error ? error.message : "No se pudo cargar la plantilla de email",
        );
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Solo al abrir / cambiar presupuesto; onClose del padre suele ser inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presupuesto?.id]);

  async function handleEnviar() {
    if (!presupuesto) return;
    if (!subject.trim()) {
      toast.warning("El asunto del email no puede estar vacío");
      return;
    }
    if (!body.trim()) {
      toast.warning("El cuerpo del email no puede estar vacío");
      return;
    }

    setSending(true);
    try {
      const enviado = await enviarPresupuesto(presupuesto.id, {
        subject: subject.trim(),
        body,
      });
      onSent(enviado);
      onClose();
      toast.success(
        presupuesto.estado === "fallido" ? "Presupuesto reenviado" : "Presupuesto enviado",
      );
    } catch (error) {
      toast.error("No se pudo enviar el presupuesto");
      const err = error as Error & { data?: unknown };
      if (err.data && typeof err.data === "object" && err.data !== null && "id" in err.data) {
        onFailed?.(err.data as Presupuesto);
      }
      onClose();
    } finally {
      setSending(false);
    }
  }

  if (!open || !presupuesto) return null;

  const disabled = loading || sending;

  return (
    <Modal
      open={open}
      title="Revisar email del presupuesto"
      wide
      onClose={() => {
        if (!sending) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={sending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleEnviar()}
            disabled={disabled || !subject.trim() || !body.trim()}
          >
            {sending ? "Enviando…" : "Enviar presupuesto"}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="text-muted">Cargando plantilla…</p>
      ) : (
        <div className="form-stack">
          <div className="form-group">
            <label htmlFor="presup-email-preview-to">Para</label>
            <input
              id="presup-email-preview-to"
              type="email"
              value={presupuesto.email}
              readOnly
              disabled
            />
          </div>

          <div className="form-group">
            <label htmlFor="presup-email-preview-subject">Asunto *</label>
            <input
              id="presup-email-preview-subject"
              type="text"
              value={subject}
              disabled={disabled}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="presup-email-preview-body">Cuerpo *</label>
            <BasicRichTextEditor
              id="presup-email-preview-body"
              value={body}
              onChange={setBody}
              resetKey={`presup-email-preview-${presupuesto.id}-${editorKey}`}
              placeholder="Cuerpo del email…"
              className="presup-email-preview__editor"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
