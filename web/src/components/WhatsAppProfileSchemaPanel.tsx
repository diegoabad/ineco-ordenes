import { FormEvent, useEffect, useState, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import {
  WA_PROFILE_FIELD_SCOPES,
  WA_PROFILE_FIELD_SCOPE_LABELS,
  WA_PROFILE_FIELD_TYPES,
  WA_PROFILE_FIELD_TYPE_LABELS,
  WA_PROFILE_GROUPS,
  type WaProfileField,
  type WaProfileFieldScope,
  type WaProfileFieldType,
} from "../lib/waProfileSchema";
import {
  createWaProfileField,
  deleteWaProfileField,
  fetchWaProfileFields,
  updateWaProfileField,
} from "../services/whatsappCrmService";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconPencil, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

type Draft = {
  id: string | null;
  key: string;
  label: string;
  description: string;
  type: WaProfileFieldType;
  scope: WaProfileFieldScope;
  optionsText: string;
  group: string;
  askPrompt: string;
  confirmPrompt: string;
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  key: "",
  label: "",
  description: "",
  type: "text",
  scope: "case",
  optionsText: "",
  group: "General",
  askPrompt: "",
  confirmPrompt: "",
  isActive: true,
});

type Props = {
  createRef?: MutableRefObject<(() => void) | null>;
};

function parseOptions(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function WhatsAppProfileSchemaPanel({ createRef }: Props) {
  const [items, setItems] = useState<WaProfileField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fields = await fetchWaProfileFields();
        if (!cancelled) setItems(fields);
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "No se pudieron cargar los campos",
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

  const removing = items.find((item) => item.id === removeId) ?? null;

  function openCreate() {
    setDraft(emptyDraft());
  }

  if (createRef) createRef.current = openCreate;

  function openEdit(item: WaProfileField) {
    setDraft({
      id: item.id,
      key: item.key,
      label: item.label,
      description: item.description ?? "",
      type: item.type,
      scope: item.scope,
      optionsText: item.options.join(", "),
      group: item.group,
      askPrompt: item.askPrompt ?? "",
      confirmPrompt: item.confirmPrompt ?? "",
      isActive: item.isActive,
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const key = draft.key.trim();
    const label = draft.label.trim();
    if (!key) {
      toast.error("Ingresá una clave (ej. nombre_contacto)");
      return;
    }
    if (!label) {
      toast.error("Ingresá una etiqueta visible");
      return;
    }
    const options = draft.type === "enum" ? parseOptions(draft.optionsText) : [];
    if (draft.type === "enum" && options.length === 0) {
      toast.error("Agregá al menos una opción para el enum");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        key,
        label,
        description: draft.description.trim() || null,
        type: draft.type,
        scope: draft.scope,
        options,
        group: draft.group.trim() || "General",
        askPrompt: draft.askPrompt.trim() || null,
        confirmPrompt: draft.confirmPrompt.trim() || null,
        isActive: draft.isActive,
      };
      if (draft.id) {
        const updated = await updateWaProfileField(draft.id, payload);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await createWaProfileField(payload);
        setItems((prev) => [...prev, created]);
      }
      const refreshed = await fetchWaProfileFields();
      setItems(refreshed);
      setDraft(null);
      toast.success("Campo guardado");
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
      await deleteWaProfileField(removeId);
      setItems((prev) => prev.filter((item) => item.id !== removeId));
      setRemoveId(null);
      toast.success("Campo eliminado");
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
                <th>Clave</th>
                <th>Etiqueta</th>
                <th>Alcance</th>
                <th>Tipo</th>
                <th>Grupo</th>
                <th className="fl-col-actions fl-col-actions--2">Acciones</th>
              </tr>
            </thead>
            {!loading && items.length > 0 ? (
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <code className="wa-quick-trigger">{item.key}</code>
                      {!item.isActive ? <span className="wa-quick-off">Inactivo</span> : null}
                    </td>
                    <td>
                      <strong>{item.label}</strong>
                      {item.description ? (
                        <div className="wa-flow-desc">{item.description}</div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`wa-profile-scope wa-profile-scope--${item.scope}`}
                      >
                        {WA_PROFILE_FIELD_SCOPE_LABELS[item.scope]}
                      </span>
                    </td>
                    <td>{WA_PROFILE_FIELD_TYPE_LABELS[item.type]}</td>
                    <td>{item.group}</td>
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
            <div className="fl-table-empty">
              <LoadingBlock label="Cargando campos…" />
            </div>
          ) : items.length === 0 ? (
            <div className="fl-table-empty">
              <p className="fl-table-empty__title">Todavía no hay campos de perfil</p>
              <p className="fl-table-empty__hint">
                Definí acá el objeto que el bot va llenando. El orden de preguntas lo
                marcan los flujos.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={Boolean(draft)}
        wide
        className="fl-modal--wa-profile"
        title={draft?.id ? "Editar campo" : "Nuevo campo"}
        onClose={() => {
          if (!saving) setDraft(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                if (!saving) setDraft(null);
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="wa-profile-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Guardando…" : draft?.id ? "Guardar cambios" : "Crear campo"}
            </button>
          </>
        }
      >
        {draft ? (
          <form
            id="wa-profile-form"
            className="wa-profile-form"
            onSubmit={(event) => void onSave(event)}
          >
            <div className="wa-profile-form__grid">
              <label className="form-group">
                <span>Clave</span>
                <input
                  value={draft.key}
                  onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                  placeholder="nombre_contacto"
                  disabled={Boolean(draft.id)}
                  required
                />
              </label>
              <label className="form-group">
                <span>Etiqueta</span>
                <input
                  value={draft.label}
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                  placeholder="Nombre de quien contacta"
                  required
                />
              </label>
              <label className="form-group wa-profile-form__full">
                <span>Descripción</span>
                <input
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Opcional"
                />
              </label>
              <label className="form-group">
                <span>Alcance</span>
                <select
                  value={draft.scope}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      scope: event.target.value as WaProfileFieldScope,
                    })
                  }
                >
                  {WA_PROFILE_FIELD_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {WA_PROFILE_FIELD_SCOPE_LABELS[scope]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-group">
                <span>Tipo</span>
                <select
                  value={draft.type}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      type: event.target.value as WaProfileFieldType,
                    })
                  }
                >
                  {WA_PROFILE_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {WA_PROFILE_FIELD_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-group">
                <span>Grupo</span>
                <input
                  list="wa-profile-groups"
                  value={draft.group}
                  onChange={(event) => setDraft({ ...draft, group: event.target.value })}
                />
                <datalist id="wa-profile-groups">
                  {WA_PROFILE_GROUPS.map((group) => (
                    <option key={group} value={group} />
                  ))}
                </datalist>
              </label>
              <div className="form-group wa-profile-form__check-wrap">
                <span className="wa-profile-form__check-label">Estado</span>
                <label className="usuarios-modules-check">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(event) =>
                      setDraft({ ...draft, isActive: event.target.checked })
                    }
                  />
                  Campo activo
                </label>
              </div>
              {draft.type === "enum" ? (
                <label className="form-group wa-profile-form__full">
                  <span>Opciones (separadas por coma)</span>
                  <textarea
                    value={draft.optionsText}
                    onChange={(event) =>
                      setDraft({ ...draft, optionsText: event.target.value })
                    }
                    rows={3}
                    placeholder="yo, tercero"
                  />
                </label>
              ) : null}
              <label className="form-group wa-profile-form__full">
                <span>Pregunta si falta</span>
                <textarea
                  value={draft.askPrompt}
                  onChange={(event) => setDraft({ ...draft, askPrompt: event.target.value })}
                  rows={2}
                  placeholder="¿Me decís tu nombre?"
                />
              </label>
              <label className="form-group wa-profile-form__full">
                <span>Pregunta para confirmar</span>
                <textarea
                  value={draft.confirmPrompt}
                  onChange={(event) =>
                    setDraft({ ...draft, confirmPrompt: event.target.value })
                  }
                  rows={2}
                  placeholder="¿Tu nombre es {{valor}}?"
                />
              </label>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(removeId)}
        title="Eliminar campo"
        message={
          removing
            ? `¿Eliminar el campo ${removing.key}? Las conversaciones que ya lo tengan seguirán con el valor guardado.`
            : "¿Eliminar este campo?"
        }
        confirmLabel={saving ? "Eliminando…" : "Eliminar"}
        onCancel={() => {
          if (!saving) setRemoveId(null);
        }}
        onConfirm={() => void onRemove()}
      />
    </>
  );
}
