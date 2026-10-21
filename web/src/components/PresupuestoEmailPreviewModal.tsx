import { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  buildPresupuestoEmailVarsFromPresupuesto,
  plantillaSugeridaPresupuesto,
  renderPresupuestoEmailByKind,
} from "../lib/presupuestoEmail";
import { isEmailAddress, joinEmails, parseEmailList } from "../lib/emails";
import { enviarPresupuesto, fetchPresupuestoEmailConfig } from "../services/dataService";
import { EmailChipsInput } from "./EmailChipsInput";
import type { Presupuesto } from "../types";
import type { PresupuestoEmailConfig, PresupuestoEmailTemplateKind } from "../types/presupuestoEmail";
import {
  PRESUPUESTO_EMAIL_KIND_LABEL,
  PRESUPUESTO_EMAIL_KINDS,
} from "../types/presupuestoEmail";
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
  const [toEmails, setToEmails] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [kind, setKind] = useState<PresupuestoEmailTemplateKind>("presupuesto");
  const [suggestedKind, setSuggestedKind] = useState<PresupuestoEmailTemplateKind>("presupuesto");
  const configRef = useRef<PresupuestoEmailConfig | null>(null);
  const varsRef = useRef<ReturnType<typeof buildPresupuestoEmailVarsFromPresupuesto> | null>(null);

  function applyKind(next: PresupuestoEmailTemplateKind) {
    const config = configRef.current;
    const vars = varsRef.current;
    if (!config || !vars) return;
    const rendered = renderPresupuestoEmailByKind(config, next, vars);
    setKind(next);
    setSubject(rendered.subject);
    setBody(rendered.body);
    setEditorKey((k) => k + 1);
  }

  useEffect(() => {
    if (!open || !presupuesto) return;

    let cancelled = false;
    const current = presupuesto;
    setLoading(true);
    setSubject("");
    setBody("");
    setToEmails(current.email);

    void (async () => {
      try {
        const { data: config } = await fetchPresupuestoEmailConfig();
        if (cancelled) return;
        const suggested = plantillaSugeridaPresupuesto(current);
        const vars = buildPresupuestoEmailVarsFromPresupuesto(
          current,
          current.mpInitPoint ?? "",
        );
        configRef.current = config;
        varsRef.current = vars;
        const rendered = renderPresupuestoEmailByKind(config, suggested, vars);
        setSuggestedKind(suggested);
        setKind(suggested);
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
    const email = joinEmails(parseEmailList(toEmails).filter(isEmailAddress));
    if (!email) {
      toast.warning("Ingresá al menos un email válido");
      return;
    }

    setSending(true);
    try {
      const enviado = await enviarPresupuesto(presupuesto.id, {
        subject: subject.trim(),
        body,
        email,
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
  const emailListo = parseEmailList(toEmails).some(isEmailAddress);

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
            disabled={disabled || !subject.trim() || !body.trim() || !emailListo}
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
            <label htmlFor="presup-email-preview-kind">Plantilla</label>
            <select
              id="presup-email-preview-kind"
              value={kind}
              disabled={disabled}
              onChange={(e) => applyKind(e.target.value as PresupuestoEmailTemplateKind)}
            >
              {PRESUPUESTO_EMAIL_KINDS.map((option) => (
                <option key={option} value={option}>
                  {PRESUPUESTO_EMAIL_KIND_LABEL[option]}
                  {option === suggestedKind ? " (sugerida)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="presup-email-preview-to">Para</label>
            <EmailChipsInput
              id="presup-email-preview-to"
              value={toEmails}
              disabled={disabled}
              onChange={setToEmails}
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
