import { useEffect, useState, type FormEvent, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import {
  createIntencion,
  deleteIntencion,
  fetchIntenciones,
  updateIntencion,
} from "../services/whatsappCrmService";
import type { WaIntencion } from "../types/whatsappCrm";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconFile, IconPencil, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

type Draft = {
  id: string | null;
  nombre: string;
  clave: string;
  descripcion: string;
  esRiesgo: boolean;
  mensajeRiesgo: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  nombre: "",
  clave: "",
  descripcion: "",
  esRiesgo: false,
  mensajeRiesgo: "",
});

function suggestClave(nombre: string): string {
  return nombre
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

type Props = {
  createRef?: MutableRefObject<(() => void) | null>;
};

export function WhatsAppIntencionesPanel({ createRef }: Props) {
  const [items, setItems] = useState<WaIntencion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [claveTouched, setClaveTouched] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchIntenciones();
        if (!cancelled) setItems(data);
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "No se pudieron cargar las intenciones",
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
    if (!createRef) return;
    createRef.current = () => {
      setClaveTouched(false);
      setDraft(emptyDraft());
    };
    return () => {
      createRef.current = null;
    };
  }, [createRef]);

  const removing = items.find((item) => item.id === removeId) ?? null;

  function openEdit(item: WaIntencion) {
    setClaveTouched(true);
    setDraft({
      id: item.id,
      nombre: item.nombre,
      clave: item.clave ?? "",
      descripcion: item.descripcion ?? "",
      esRiesgo: item.esRiesgo === true,
      mensajeRiesgo: item.mensajeRiesgo ?? "",
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const nombre = draft.nombre.trim();
    const clave = suggestClave(draft.clave || nombre);
    const mensajeRiesgo = draft.mensajeRiesgo.trim();
    if (!nombre) {
      toast.error("Ingresá un nombre");
      return;
    }
    if (!clave) {
      toast.error("Ingresá una clave");
      return;
    }
    if (draft.esRiesgo && !mensajeRiesgo) {
      toast.error("Ingresá el mensaje de riesgo");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nombre,
        clave,
        descripcion: draft.descripcion.trim(),
        esRiesgo: draft.esRiesgo,
        mensajeRiesgo: draft.esRiesgo ? mensajeRiesgo : "",
      };
      if (draft.id) {
        const updated = await updateIntencion(draft.id, payload);
        setItems((prev) =>
          prev
            .map((item) => {
              if (item.id === updated.id) return updated;
              if (updated.esRiesgo) return { ...item, esRiesgo: false };
              return item;
            })
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
        );
        toast.success("Intención actualizada");
      } else {
        const created = await createIntencion(payload);
        setItems((prev) =>
          [...(created.esRiesgo ? prev.map((item) => ({ ...item, esRiesgo: false })) : prev), created].sort(
            (a, b) => a.nombre.localeCompare(b.nombre, "es"),
          ),
        );
        toast.success("Intención creada");
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
      await deleteIntencion(removeId);
      setItems((prev) => prev.filter((item) => item.id !== removeId));
      setRemoveId(null);
      toast.success("Intención eliminada");
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
                <th>Nombre</th>
                <th>Clave</th>
                <th>Descripción</th>
                <th className="fl-col-actions fl-col-actions--2" aria-label="Acciones" />
              </tr>
            </thead>
            {!loading && items.length > 0 ? (
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="wa-intencion-name">
                        <strong>{item.nombre}</strong>
                        {item.esRiesgo ? (
                          <span className="wa-intencion-riesgo-badge">Riesgo</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <code className="wa-intencion-clave">{item.clave}</code>
                    </td>
                    <td>
                      {item.descripcion?.trim() ? (
                        <span className="wa-intencion-desc">{item.descripcion}</span>
                      ) : (
                        <span className="wa-quick-tags-empty">Sin descripción</span>
                      )}
                    </td>
                    <td className="fl-col-actions fl-col-actions--2">
                      <div className="fl-table-actions fl-table-actions--2">
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--edit"
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
              <LoadingBlock label="Cargando intenciones…" />
            </div>
          ) : items.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <div className="fl-table-empty__art">
                <IconFile size={32} />
              </div>
              <p className="fl-table-empty__title">Todavía no hay intenciones</p>
              <p className="fl-table-empty__hint">
                Creá la primera con nombre, clave y descripción.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={draft !== null}
        wide
        className="fl-modal--wa-intencion"
        title={draft?.id ? "Editar intención" : "Nueva intención"}
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
            <button
              type="submit"
              form="wa-intencion-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </>
        }
      >
        {draft ? (
          <form id="wa-intencion-form" className="fl-form" onSubmit={(e) => void onSave(e)}>
            <div className="form-group">
              <label htmlFor="wa-intencion-nombre">Nombre</label>
              <input
                id="wa-intencion-nombre"
                type="text"
                value={draft.nombre}
                onChange={(e) => {
                  const nombre = e.target.value;
                  setDraft((current) => {
                    if (!current) return current;
                    const next = { ...current, nombre };
                    if (!claveTouched && !current.id) {
                      next.clave = suggestClave(nombre);
                    }
                    return next;
                  });
                }}
                placeholder="Ej. Pedir turno"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="wa-intencion-clave">Clave</label>
              <input
                id="wa-intencion-clave"
                type="text"
                value={draft.clave}
                onChange={(e) => {
                  setClaveTouched(true);
                  setDraft({ ...draft, clave: e.target.value });
                }}
                onBlur={() =>
                  setDraft((current) =>
                    current ? { ...current, clave: suggestClave(current.clave) } : current,
                  )
                }
                placeholder="Ej. pedir_turno"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="wa-intencion-desc">Descripción</label>
              <textarea
                id="wa-intencion-desc"
                rows={4}
                value={draft.descripcion}
                onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })}
                placeholder="Qué busca resolver esta intención"
              />
            </div>
            <label className={`wa-intencion-riesgo-toggle${draft.esRiesgo ? " is-on" : ""}`}>
              <span>
                <span className="wa-intencion-riesgo-toggle__title">Intención de riesgo</span>
                <span className="wa-intencion-riesgo-toggle__hint">
                  Solo puede haber una. Activa el protocolo especial.
                </span>
              </span>
              <span className="wa-intencion-riesgo-toggle__control">
                <input
                  type="checkbox"
                  checked={draft.esRiesgo}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      esRiesgo: e.target.checked,
                      mensajeRiesgo: e.target.checked ? draft.mensajeRiesgo : "",
                    })
                  }
                />
                <span className="wa-intencion-riesgo-toggle__track" aria-hidden>
                  <span className="wa-intencion-riesgo-toggle__thumb" />
                </span>
              </span>
            </label>
            {draft.esRiesgo ? (
              <div className="form-group">
                <label htmlFor="wa-intencion-msg-riesgo">Mensaje de riesgo</label>
                <textarea
                  id="wa-intencion-msg-riesgo"
                  rows={4}
                  value={draft.mensajeRiesgo}
                  onChange={(e) => setDraft({ ...draft, mensajeRiesgo: e.target.value })}
                  placeholder="Mensaje que se envía al detectar esta situación"
                  required
                />
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={removeId !== null}
        title="Eliminar intención"
        message={
          removing
            ? `¿Eliminar la intención “${removing.nombre}”?`
            : "¿Eliminar esta intención?"
        }
        confirmLabel="Eliminar"
        onCancel={() => {
          if (!saving) setRemoveId(null);
        }}
        onConfirm={() => void onRemove()}
      />
    </>
  );
}
