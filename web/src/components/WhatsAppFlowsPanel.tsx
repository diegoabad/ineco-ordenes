import {
  FormEvent,
  useEffect,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "react-toastify";
import {
  WA_FLOW_STEP_LABELS,
  WA_FLOW_STEP_TYPES,
  emptyFlowStep,
  formatFlowTriggers,
  parseFlowTriggers,
  type WaFlow,
  type WaFlowStep,
  type WaFlowStepType,
} from "../lib/waFlows";
import type { WaProfileField } from "../lib/waProfileSchema";
import {
  createWaFlow,
  deleteWaFlow,
  fetchWaFlows,
  fetchWaProfileFields,
  fetchWaTagCatalog,
  updateWaFlow,
} from "../services/whatsappCrmService";
import type { WaTag } from "../types/whatsappCrm";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconFile, IconPencil, IconPlus, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

type Draft = {
  id: string | null;
  name: string;
  objective: string;
  description: string;
  triggersText: string;
  requiredFieldKeys: string[];
  childFlowIds: string[];
  steps: WaFlowStep[];
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  objective: "",
  description: "",
  triggersText: "",
  requiredFieldKeys: [],
  childFlowIds: [],
  steps: [emptyFlowStep("say")],
  isActive: true,
});

type Props = {
  createRef?: MutableRefObject<(() => void) | null>;
};

export function WhatsAppFlowsPanel({ createRef }: Props) {
  const [items, setItems] = useState<WaFlow[]>([]);
  const [tags, setTags] = useState<WaTag[]>([]);
  const [profileFields, setProfileFields] = useState<WaProfileField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [flows, catalog, fields] = await Promise.all([
          fetchWaFlows(),
          fetchWaTagCatalog().catch(() => ({ groups: [], items: [] as WaTag[] })),
          fetchWaProfileFields().catch(() => [] as WaProfileField[]),
        ]);
        if (cancelled) return;
        setItems(flows);
        setTags(catalog.items);
        setProfileFields(fields.filter((field) => field.isActive));
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudieron cargar los flujos");
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
  const flowById = new Map(items.map((item) => [item.id, item]));
  const fieldByKey = new Map(profileFields.map((field) => [field.key, field]));
  const childOptions = items.filter((item) => item.id !== draft?.id);

  function openCreate() {
    setDraft(emptyDraft());
  }

  if (createRef) createRef.current = openCreate;

  function openEdit(item: WaFlow) {
    setDraft({
      id: item.id,
      name: item.name,
      objective: item.objective ?? "",
      description: item.description ?? "",
      triggersText: formatFlowTriggers(item.triggers),
      requiredFieldKeys: [...item.requiredFieldKeys],
      childFlowIds: [...item.childFlowIds],
      steps:
        item.steps.length > 0
          ? item.steps.map((step) => ({ ...step }))
          : [emptyFlowStep("say")],
      isActive: item.isActive,
    });
  }

  function updateStep(stepId: string, patch: Partial<WaFlowStep>) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      };
    });
  }

  function addStep(type: WaFlowStepType = "say") {
    setDraft((current) =>
      current ? { ...current, steps: [...current.steps, emptyFlowStep(type)] } : current,
    );
  }

  function removeStep(stepId: string) {
    setDraft((current) => {
      if (!current) return current;
      if (current.steps.length <= 1) {
        toast.error("El flujo necesita al menos un paso");
        return current;
      }
      return { ...current, steps: current.steps.filter((step) => step.id !== stepId) };
    });
  }

  function moveStep(stepId: string, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const index = current.steps.findIndex((step) => step.id === stepId);
      if (index < 0) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.steps.length) return current;
      const steps = [...current.steps];
      const [item] = steps.splice(index, 1);
      steps.splice(nextIndex, 0, item!);
      return { ...current, steps };
    });
  }

  function toggleStepTag(stepId: string, tagId: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        steps: current.steps.map((step) => {
          if (step.id !== stepId) return step;
          const exists = step.tagIds.includes(tagId);
          return {
            ...step,
            tagIds: exists
              ? step.tagIds.filter((id) => id !== tagId)
              : [...step.tagIds, tagId],
          };
        }),
      };
    });
  }

  function toggleRequiredField(key: string) {
    setDraft((current) => {
      if (!current) return current;
      const exists = current.requiredFieldKeys.includes(key);
      return {
        ...current,
        requiredFieldKeys: exists
          ? current.requiredFieldKeys.filter((item) => item !== key)
          : [...current.requiredFieldKeys, key],
      };
    });
  }

  function moveRequiredField(key: string, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const index = current.requiredFieldKeys.indexOf(key);
      if (index < 0) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.requiredFieldKeys.length) return current;
      const keys = [...current.requiredFieldKeys];
      const [item] = keys.splice(index, 1);
      keys.splice(nextIndex, 0, item!);
      return { ...current, requiredFieldKeys: keys };
    });
  }

  function toggleChildFlow(flowId: string) {
    setDraft((current) => {
      if (!current) return current;
      const exists = current.childFlowIds.includes(flowId);
      return {
        ...current,
        childFlowIds: exists
          ? current.childFlowIds.filter((id) => id !== flowId)
          : [...current.childFlowIds, flowId],
      };
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("Ingresá un nombre para el flujo");
      return;
    }
    if (!draft.objective.trim()) {
      toast.error("Contá cuál es el objetivo de este flujo");
      return;
    }
    if (draft.steps.length === 0) {
      toast.error("Agregá al menos un paso");
      return;
    }
    for (const step of draft.steps) {
      if ((step.type === "say" || step.type === "ask") && !step.body?.trim()) {
        toast.error(
          step.type === "say"
            ? "Hay un paso “Decir” sin mensaje"
            : "Hay un paso “Preguntar” sin mensaje",
        );
        return;
      }
      if (step.type === "ask_field" && !step.fieldKey) {
        toast.error("Hay un paso “Pedir campo” sin campo elegido");
        return;
      }
      if (step.type === "run_flow" && !step.flowId) {
        toast.error("Hay un paso “Ir a subflujo” sin flujo elegido");
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name,
        objective: draft.objective.trim(),
        description: draft.description.trim() || null,
        triggers: parseFlowTriggers(draft.triggersText),
        requiredFieldKeys: draft.requiredFieldKeys,
        childFlowIds: draft.childFlowIds,
        steps: draft.steps.map((step) => ({
          ...step,
          body: step.body?.trim() || null,
          tagIds: step.type === "apply_tags" ? step.tagIds : [],
          fieldKey: step.type === "ask_field" ? step.fieldKey : null,
          flowId: step.type === "run_flow" ? step.flowId : null,
        })),
        isActive: draft.isActive,
      };
      if (draft.id) {
        const updated = await updateWaFlow(draft.id, payload);
        setItems((prev) =>
          prev
            .map((item) => (item.id === updated.id ? updated : item))
            .sort((a, b) => a.name.localeCompare(b.name, "es")),
        );
        toast.success("Flujo actualizado");
      } else {
        const created = await createWaFlow(payload);
        setItems((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "es")),
        );
        toast.success("Flujo creado");
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
      await deleteWaFlow(removeId);
      setItems((prev) =>
        prev
          .filter((item) => item.id !== removeId)
          .map((item) => ({
            ...item,
            childFlowIds: item.childFlowIds.filter((id) => id !== removeId),
          })),
      );
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
                <th>Flujo</th>
                <th>Campos</th>
                <th>Subflujos</th>
                <th>Pasos</th>
                <th className="fl-col-actions fl-col-actions--2">Acciones</th>
              </tr>
            </thead>
            {!loading && items.length > 0 ? (
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      {!item.isActive ? <span className="wa-quick-off">Inactivo</span> : null}
                      {item.objective ? (
                        <div className="wa-flow-desc">{item.objective}</div>
                      ) : item.description ? (
                        <div className="wa-flow-desc">{item.description}</div>
                      ) : null}
                    </td>
                    <td>
                      {item.requiredFieldKeys.length > 0 ? (
                        <div className="wa-flow-chips">
                          {item.requiredFieldKeys.map((key) => (
                            <code key={key} className="wa-quick-trigger">
                              {fieldByKey.get(key)?.label ?? key}
                            </code>
                          ))}
                        </div>
                      ) : (
                        <span className="wa-quick-tags-empty">Ninguno</span>
                      )}
                    </td>
                    <td>
                      {item.childFlowIds.length > 0 ? (
                        <div className="wa-flow-chips">
                          {item.childFlowIds.map((id) => (
                            <span key={id} className="wa-flow-chip">
                              {flowById.get(id)?.name ?? id.slice(0, 8)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="wa-quick-tags-empty">Ninguno</span>
                      )}
                    </td>
                    <td>{item.steps.length}</td>
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
              <LoadingBlock label="Cargando flujos…" />
            </div>
          ) : items.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <div className="fl-table-empty__art">
                <IconFile size={32} />
              </div>
              <p className="fl-table-empty__title">Todavía no hay flujos</p>
              <p className="fl-table-empty__hint">
                Definí el objetivo, los campos del perfil que necesita y los subflujos.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={draft !== null}
        wide
        className="fl-modal--wa-flow"
        title={draft?.id ? "Editar flujo" : "Nuevo flujo"}
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
            <button type="submit" form="wa-flow-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : draft?.id ? "Guardar cambios" : "Crear flujo"}
            </button>
          </>
        }
      >
        {draft ? (
          <form id="wa-flow-form" className="wa-flow-form" onSubmit={(event) => void onSave(event)}>
            <div className="wa-flow-form__grid">
              <label className="form-group">
                <span>Nombre</span>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  placeholder="Turno infanto"
                  required
                />
              </label>
              <label className="form-group">
                <span>Disparadores</span>
                <input
                  value={draft.triggersText}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, triggersText: event.target.value } : current,
                    )
                  }
                  placeholder="turno, sacar turno, agendar"
                />
              </label>
              <label className="form-group wa-flow-form__full">
                <span>Objetivo</span>
                <textarea
                  rows={2}
                  value={draft.objective}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, objective: event.target.value } : current,
                    )
                  }
                  placeholder="Qué logra este flujo (ej. reunir datos y ofrecer turno CABA infanto)"
                  required
                />
              </label>
              <label className="form-group wa-flow-form__full">
                <span>Notas / descripción</span>
                <input
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, description: event.target.value } : current,
                    )
                  }
                  placeholder="Opcional"
                />
              </label>
            </div>

            <div className="form-group">
              <label>Campos del perfil que necesita</label>
              <p className="form-hint">
                El orden de esta lista es el orden en que el bot pedirá lo que falte.
              </p>
              {profileFields.length === 0 ? (
                <p className="wa-quick-tags-empty">
                  Todavía no hay campos en Perfil bot.
                </p>
              ) : (
                <div className="wa-quick-tags">
                  {profileFields.map((field) => {
                    const selected = draft.requiredFieldKeys.includes(field.key);
                    return (
                      <button
                        key={field.id}
                        type="button"
                        className={`wa-tag${selected ? " is-selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => toggleRequiredField(field.key)}
                      >
                        {field.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {draft.requiredFieldKeys.length > 0 ? (
                <div className="wa-flow-required-order">
                  {draft.requiredFieldKeys.map((key, index) => (
                    <div key={key} className="wa-flow-required-order__row">
                      <span className="wa-flow-step__index">{index + 1}</span>
                      <code className="wa-quick-trigger">{key}</code>
                      <span>{fieldByKey.get(key)?.label ?? key}</span>
                      <div className="wa-flow-step__actions">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          title="Subir"
                          disabled={index === 0}
                          onClick={() => moveRequiredField(key, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn"
                          title="Bajar"
                          disabled={index === draft.requiredFieldKeys.length - 1}
                          onClick={() => moveRequiredField(key, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="form-group">
              <label>Subflujos</label>
              <p className="form-hint">
                Flujos hijos a los que este puede derivar (también usables en el paso “Ir a
                subflujo”).
              </p>
              {childOptions.length === 0 ? (
                <p className="wa-quick-tags-empty">No hay otros flujos todavía.</p>
              ) : (
                <div className="wa-quick-tags">
                  {childOptions.map((flow) => {
                    const selected = draft.childFlowIds.includes(flow.id);
                    return (
                      <button
                        key={flow.id}
                        type="button"
                        className={`wa-tag${selected ? " is-selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => toggleChildFlow(flow.id)}
                      >
                        {flow.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Pasos</label>
              <div className="wa-flow-steps">
                {draft.steps.map((step, index) => (
                  <div key={step.id} className="wa-flow-step">
                    <div className="wa-flow-step__head">
                      <span className="wa-flow-step__index">{index + 1}</span>
                      <select
                        className="ui-select"
                        value={step.type}
                        onChange={(event) => {
                          const type = event.target.value as WaFlowStepType;
                          updateStep(step.id, {
                            type,
                            body: type === "say" || type === "ask" ? step.body ?? "" : null,
                            tagIds: type === "apply_tags" ? step.tagIds : [],
                            fieldKey: type === "ask_field" ? step.fieldKey : null,
                            flowId: type === "run_flow" ? step.flowId : null,
                          });
                        }}
                      >
                        {WA_FLOW_STEP_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {WA_FLOW_STEP_LABELS[type]}
                          </option>
                        ))}
                      </select>
                      <div className="wa-flow-step__actions">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          title="Subir"
                          disabled={index === 0}
                          onClick={() => moveStep(step.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn"
                          title="Bajar"
                          disabled={index === draft.steps.length - 1}
                          onClick={() => moveStep(step.id, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Quitar paso"
                          onClick={() => removeStep(step.id)}
                        >
                          <IconTrash size={16} />
                        </button>
                      </div>
                    </div>
                    {step.type === "say" || step.type === "ask" ? (
                      <textarea
                        rows={3}
                        value={step.body ?? ""}
                        onChange={(event) => updateStep(step.id, { body: event.target.value })}
                        placeholder={
                          step.type === "say"
                            ? "Mensaje que envía el bot…"
                            : "Pregunta que espera respuesta…"
                        }
                        required
                      />
                    ) : null}
                    {step.type === "ask_field" ? (
                      <select
                        className="ui-select"
                        value={step.fieldKey ?? ""}
                        onChange={(event) =>
                          updateStep(step.id, { fieldKey: event.target.value || null })
                        }
                        required
                      >
                        <option value="">Elegí un campo del perfil…</option>
                        {profileFields.map((field) => (
                          <option key={field.id} value={field.key}>
                            {field.label} ({field.key})
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {step.type === "run_flow" ? (
                      <select
                        className="ui-select"
                        value={step.flowId ?? ""}
                        onChange={(event) =>
                          updateStep(step.id, { flowId: event.target.value || null })
                        }
                        required
                      >
                        <option value="">Elegí un subflujo…</option>
                        {childOptions.map((flow) => (
                          <option key={flow.id} value={flow.id}>
                            {flow.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {step.type === "apply_tags" ? (
                      tags.length > 0 ? (
                        <div className="wa-quick-tags">
                          {tags.map((tag) => {
                            const selected = step.tagIds.includes(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                className={`wa-tag${selected ? " is-selected" : ""}`}
                                aria-pressed={selected}
                                onClick={() => toggleStepTag(step.id, tag.id)}
                              >
                                {tag.name}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="wa-quick-tags-empty">Todavía no hay etiquetas.</p>
                      )
                    ) : null}
                    {step.type === "handoff" ? (
                      <p className="wa-flow-step__hint">Deriva la conversación a una operadora.</p>
                    ) : null}
                    {step.type === "end" ? (
                      <p className="wa-flow-step__hint">Cierra el flujo en este punto.</p>
                    ) : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm wa-flow-add-step"
                onClick={() => addStep("say")}
              >
                <IconPlus size={14} />
                Agregar paso
              </button>
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
              Activo
            </label>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Eliminar flujo"
        message={removing ? `¿Eliminar el flujo "${removing.name}"?` : ""}
        confirmLabel={saving ? "Eliminando…" : "Eliminar"}
        onConfirm={() => void onRemove()}
        onCancel={() => {
          if (!saving) setRemoveId(null);
        }}
      />
    </>
  );
}
