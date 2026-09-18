import { FormEvent, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import {
  QUICK_REPLY_VARIABLES,
  formatTrigger,
  normalizeTrigger,
  type QuickReply,
} from "../lib/quickReplies";
import {
  createQuickReply,
  deleteQuickReply,
  fetchQuickReplies,
  updateQuickReply,
} from "../services/whatsappCrmService";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconFile, IconPencil, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

type Draft = {
  id: string | null;
  trigger: string;
  body: string;
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  trigger: "",
  body: "",
  isActive: true,
});

type Props = {
  createRef?: MutableRefObject<(() => void) | null>;
};

export function WhatsAppQuickRepliesPanel({ createRef }: Props) {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  function resizeBody(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchQuickReplies();
        if (!cancelled) setItems(data);
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "No se pudieron cargar las respuestas",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    resizeBody(bodyRef.current);
  }, [draft?.body, draft]);

  const removing = items.find((item) => item.id === removeId) ?? null;

  function openCreate() {
    setDraft(emptyDraft());
  }

  if (createRef) createRef.current = openCreate;

  function openEdit(item: QuickReply) {
    setDraft({
      id: item.id,
      trigger: formatTrigger(item.trigger),
      body: item.body,
      isActive: item.isActive,
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const trigger = normalizeTrigger(draft.trigger);
    const body = draft.body.trim();
    if (!trigger) {
      toast.error("Ingresá un disparador, por ejemplo /saludo");
      return;
    }
    if (!body) {
      toast.error("El mensaje no puede estar vacío");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        trigger,
        body,
        isActive: draft.isActive,
      };
      if (draft.id) {
        const updated = await updateQuickReply(draft.id, payload);
        setItems((prev) =>
          prev
            .map((item) => (item.id === updated.id ? updated : item))
            .sort((a, b) => a.trigger.localeCompare(b.trigger, "es")),
        );
        toast.success("Respuesta actualizada");
      } else {
        const created = await createQuickReply(payload);
        setItems((prev) =>
          [...prev, created].sort((a, b) => a.trigger.localeCompare(b.trigger, "es")),
        );
        toast.success("Respuesta creada");
      }
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!removeId || saving) return;
    setSaving(true);
    try {
      await deleteQuickReply(removeId);
      setItems((prev) => prev.filter((item) => item.id !== removeId));
      setRemoveId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="fl-table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Disparador</th>
                <th>Mensaje</th>
                <th className="fl-col-actions fl-col-actions--2">Acciones</th>
              </tr>
            </thead>
            {!loading && items.length > 0 ? (
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <code className="wa-quick-trigger">{formatTrigger(item.trigger)}</code>
                      {!item.isActive ? <span className="wa-quick-off">Inactiva</span> : null}
                    </td>
                    <td className="wa-quick-body">{item.body}</td>
                    <td className="fl-col-actions fl-col-actions--2">
                      <div className="fl-table-actions fl-table-actions--2">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          title="Editar"
                          onClick={() => openEdit(item)}
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Eliminar"
                          onClick={() => setRemoveId(item.id)}
                        >
                          <IconTrash size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
          {loading ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <LoadingBlock label="Cargando respuestas…" />
            </div>
          ) : items.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <div className="fl-table-empty__art">
                <IconFile size={32} />
              </div>
              <p className="fl-table-empty__title">Todavía no hay respuestas rápidas</p>
              <p className="fl-table-empty__hint">
                Creá una con un disparador como /saludo para usarla en el chat.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={draft !== null}
        wide
        title={draft?.id ? "Editar respuesta rápida" : "Nueva respuesta rápida"}
        onClose={() => {
          if (!saving) setDraft(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Cancelar
            </button>
            <button type="submit" form="wa-quick-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : draft?.id ? "Guardar cambios" : "Crear respuesta"}
            </button>
          </>
        }
      >
        {draft ? (
          <form id="wa-quick-form" className="wa-quick-form" onSubmit={(event) => void onSave(event)}>
            <label className="form-group">
                <span>Disparador</span>
                <input
                  value={draft.trigger}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, trigger: event.target.value } : current,
                    )
                  }
                  placeholder="/saludo"
                  required
                />
              </label>
            <label className="form-group">
              <span>Mensaje</span>
              <textarea
                ref={bodyRef}
                rows={8}
                value={draft.body}
                onChange={(event) => {
                  resizeBody(event.currentTarget);
                  setDraft((current) =>
                    current ? { ...current, body: event.target.value } : current,
                  );
                }}
                placeholder="Hola {{nombre}}, gracias por escribir a INECO."
                required
              />
            </label>
            <div className="wa-quick-vars">
              {QUICK_REPLY_VARIABLES.map((variable) => (
                <button
                  key={variable.key}
                  type="button"
                  title={variable.label}
                  onClick={() =>
                    setDraft((current) =>
                      current ? { ...current, body: `${current.body}{{${variable.key}}}` } : current,
                    )
                  }
                >
                  {`{{${variable.key}}}`}
                </button>
              ))}
            </div>
            <label className="usuarios-modules-check">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, isActive: event.target.checked } : current,
                  )
                }
              />
              Activa en conversaciones
            </label>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Eliminar respuesta"
        message={
          removing
            ? `¿Eliminar la respuesta ${formatTrigger(removing.trigger)}?`
            : ""
        }
        confirmLabel={saving ? "Eliminando…" : "Eliminar"}
        onConfirm={() => void onRemove()}
        onCancel={() => {
          if (!saving) setRemoveId(null);
        }}
      />
    </>
  );
}
