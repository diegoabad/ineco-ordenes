import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  buildPresupuestoEmailVarsFromPresupuesto,
  renderLinkPagoEmailPreview,
} from "../lib/presupuestoEmail";
import {
  aceptarPresupuesto,
  fetchPresupuestoEmailConfig,
  prepararPresupuestoLinkPago,
} from "../services/dataService";
import type { Presupuesto } from "../types";
import { BasicRichTextEditor } from "./BasicRichTextEditor";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  presupuesto: Presupuesto | null;
  onClose: () => void;
  onDone: (presupuesto: Presupuesto) => void;
};

export function PresupuestoLinkPagoEmailModal({
  open,
  presupuesto,
  onClose,
  onDone,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [prepared, setPrepared] = useState<Presupuesto | null>(null);

  useEffect(() => {
    if (!open || !presupuesto) return;

    let cancelled = false;
    const current = presupuesto;
    setLoading(true);
    setSubject("");
    setBody("");
    setPrepared(null);

    void (async () => {
      try {
        const withLink = await prepararPresupuestoLinkPago(current.id);
        if (cancelled) return;
        setPrepared(withLink);

        const { data: config } = await fetchPresupuestoEmailConfig();
        if (cancelled) return;

        const vars = buildPresupuestoEmailVarsFromPresupuesto(
          withLink,
          withLink.mpInitPoint ?? "",
        );
        const rendered = renderLinkPagoEmailPreview(config, vars);
        setSubject(rendered.subject);
        setBody(rendered.body);
        setEditorKey((k) => k + 1);
      } catch (error) {
        if (cancelled) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo preparar el mail de link de pago",
        );
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presupuesto?.id]);

  async function handleAceptar(enviarEmail: boolean) {
    if (!presupuesto) return;

    if (enviarEmail) {
      if (!subject.trim()) {
        toast.warning("El asunto del email no puede estar vacío");
        return;
      }
      if (!body.trim()) {
        toast.warning("El cuerpo del email no puede estar vacío");
        return;
      }
      if (!(prepared?.email || presupuesto.email).trim()) {
        toast.warning("El presupuesto no tiene email cargado");
        return;
      }
    }

    setSaving(true);
    try {
      const updated = await aceptarPresupuesto(presupuesto.id, {
        enviarEmail,
        ...(enviarEmail
          ? {
              subject: subject.trim(),
              body,
            }
          : {}),
      });
      onDone(updated);
      onClose();
      toast.success(
        enviarEmail
          ? "Presupuesto aceptado y mail de pago enviado"
          : "Presupuesto marcado como aceptado",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo aceptar el presupuesto",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open || !presupuesto) return null;

  const disabled = loading || saving;
  const email = prepared?.email || presupuesto.email;

  return (
    <Modal
      open={open}
      title="¿Enviar mail con link de pago?"
      wide
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleAceptar(false)}
            disabled={disabled}
          >
            {saving ? "Guardando…" : "No enviar"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleAceptar(true)}
            disabled={disabled || !subject.trim() || !body.trim() || !email.trim()}
          >
            {saving ? "Enviando…" : "Enviar mail"}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="text-muted">Preparando link de pago y plantilla…</p>
      ) : (
        <div className="form-stack">
          <p className="text-muted" style={{ marginTop: 0 }}>
            El presupuesto se marcará como aceptado. Podés editar el mail antes de
            enviarlo, o aceptar sin mandarlo.
          </p>

          <div className="form-group">
            <label htmlFor="presup-link-pago-to">Para</label>
            <input
              id="presup-link-pago-to"
              type="email"
              value={email}
              readOnly
              disabled
            />
          </div>

          <div className="form-group">
            <label htmlFor="presup-link-pago-subject">Asunto *</label>
            <input
              id="presup-link-pago-subject"
              type="text"
              value={subject}
              disabled={disabled}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="presup-link-pago-body">Cuerpo *</label>
            <BasicRichTextEditor
              id="presup-link-pago-body"
              value={body}
              onChange={setBody}
              resetKey={`presup-link-pago-${presupuesto.id}-${editorKey}`}
              placeholder="Cuerpo del email…"
              className="presup-email-preview__editor"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
