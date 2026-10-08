import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { isEmailAddress, joinEmails, parseEmailList } from "../lib/emails";
import { buildOrdenEmailVars, renderOrdenEmailPreview } from "../lib/ordenEmail";
import { enviarOrdenEmail, fetchEmailConfig } from "../services/dataService";
import type { Paciente } from "../types";
import { BasicRichTextEditor } from "./BasicRichTextEditor";
import { EmailChipsInput } from "./EmailChipsInput";
import { Modal } from "./Modal";

export type OrdenEmailDraft = {
  paciente: Paciente;
  medicoNombre: string;
  especialidad: string;
  matricula: string;
  fecha: string;
  pdfBase64: string;
  filename: string;
};

type Props = {
  open: boolean;
  draft: OrdenEmailDraft | null;
  /** Ej. "2 de 5" en envíos múltiples. */
  queueLabel?: string | null;
  onClose: () => void;
  onSent: (result: { to: string; envioId: string }) => void;
  onFailed?: (errorMessage: string) => void;
};

export function OrdenEmailPreviewModal({
  open,
  draft,
  queueLabel = null,
  onClose,
  onSent,
  onFailed,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmails, setToEmails] = useState("");
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!open || !draft) return;

    let cancelled = false;
    const current = draft;
    setLoading(true);
    setLoadError("");
    setSubject("");
    setBody("");
    setToEmails(current.paciente.email ?? "");

    void (async () => {
      try {
        const { data: config } = await fetchEmailConfig();
        if (cancelled) return;
        const vars = buildOrdenEmailVars({
          paciente: current.paciente,
          medicoNombre: current.medicoNombre,
          especialidad: current.especialidad,
          matricula: current.matricula,
          fecha: current.fecha,
        });
        const rendered = renderOrdenEmailPreview(config, vars);
        setSubject(rendered.subject);
        setBody(rendered.body);
        setEditorKey((k) => k + 1);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : "No se pudo cargar la plantilla de email",
        );
        toast.error(
          error instanceof Error ? error.message : "No se pudo cargar la plantilla de email",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft?.paciente.id, draft?.fecha, draft?.filename]);

  async function handleEnviar() {
    if (!draft) return;
    if (!subject.trim()) {
      toast.warning("El asunto del email no puede estar vacío");
      return;
    }
    if (!body.trim()) {
      toast.warning("El cuerpo del email no puede estar vacío");
      return;
    }
    const email = joinEmails(parseEmailList(toEmails).filter(isEmailAddress));
    if (!email) {
      toast.warning("Ingresá al menos un email válido");
      return;
    }

    setSending(true);
    try {
      const result = await enviarOrdenEmail({
        pacienteId: draft.paciente.id,
        pdfBase64: draft.pdfBase64,
        filename: draft.filename,
        fecha: draft.fecha,
        medicoNombre: draft.medicoNombre,
        email,
        subject: subject.trim(),
        body,
      });
      onSent(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo enviar el mail";
      onFailed?.(message);
    } finally {
      setSending(false);
    }
  }

  if (!open || !draft) return null;

  const disabled = loading || sending || Boolean(loadError);
  const emailListo = parseEmailList(toEmails).some(isEmailAddress);
  const title = queueLabel
    ? `Revisar email de la orden (${queueLabel})`
    : "Revisar email de la orden";

  return (
    <Modal
      open={open}
      title={title}
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
            disabled={disabled || !subject.trim() || !body.trim() || !emailListo}
          >
            {sending ? "Enviando…" : queueLabel ? "Enviar y continuar" : "Enviar orden"}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="text-muted">Cargando plantilla…</p>
      ) : loadError ? (
        <p className="text-muted" role="alert">
          {loadError}. Comprobá que la API esté en marcha e intentá de nuevo.
        </p>
      ) : (
        <div className="form-stack">
          <div className="form-group">
            <label htmlFor="orden-email-preview-to">Para</label>
            <EmailChipsInput
              id="orden-email-preview-to"
              value={toEmails}
              disabled={disabled}
              onChange={setToEmails}
            />
          </div>

          <div className="form-group">
            <label htmlFor="orden-email-preview-subject">Asunto *</label>
            <input
              id="orden-email-preview-subject"
              type="text"
              value={subject}
              disabled={disabled}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="form-group">
            <BasicRichTextEditor
              id="orden-email-preview-body"
              value={body}
              onChange={setBody}
              resetKey={`orden-email-preview-${draft.paciente.id}-${draft.fecha}-${editorKey}`}
              placeholder="Cuerpo del email…"
              className="presup-email-preview__editor"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
