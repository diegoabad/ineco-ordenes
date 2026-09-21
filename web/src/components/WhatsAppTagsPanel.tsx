import {
  FormEvent,
  useEffect,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { toast } from "react-toastify";
import {
  createWaTag,
  createWaTagGroup,
  deleteWaTag,
  deleteWaTagGroup,
  fetchWaTagCatalog,
  updateWaTag,
  updateWaTagGroup,
} from "../services/whatsappCrmService";
import type { WaTag, WaTagGroup } from "../types/whatsappCrm";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconFile, IconPencil, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

const TAG_COLORS = [
  "#a61948",
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

type TagDraft = {
  id: string | null;
  name: string;
  groupId: string;
};

type GroupDraft = {
  id: string | null;
  name: string;
  color: string;
};

export type TagsPanelTab = "etiquetas" | "grupos";

type Props = {
  createRef?: MutableRefObject<(() => void) | null>;
  createGroupRef?: MutableRefObject<(() => void) | null>;
  onTabChange?: (tab: TagsPanelTab) => void;
};

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "es");
}

export function WhatsAppTagsPanel({ createRef, createGroupRef, onTabChange }: Props) {
  const [tab, setTab] = useState<TagsPanelTab>("etiquetas");
  const [groups, setGroups] = useState<WaTagGroup[]>([]);
  const [items, setItems] = useState<WaTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<TagDraft | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeGroupId, setRemoveGroupId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchWaTagCatalog();
        if (cancelled) return;
        setGroups(data.groups);
        setItems(data.items);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudieron cargar las etiquetas");
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
    onTabChange?.(tab);
  }, [onTabChange, tab]);

  const removing = items.find((item) => item.id === removeId) ?? null;
  const removingGroup = groups.find((group) => group.id === removeGroupId) ?? null;
  const sortedGroups = [...groups].sort(byName);

  function groupOf(groupId: string): WaTagGroup | undefined {
    return groups.find((group) => group.id === groupId);
  }

  function groupName(groupId: string): string {
    return groupOf(groupId)?.name ?? "Sin grupo";
  }

  function groupColor(groupId: string): string {
    return groupOf(groupId)?.color ?? TAG_COLORS[0]!;
  }

  function tagsInGroup(groupId: string): number {
    return items.filter((item) => item.groupId === groupId).length;
  }

  const sortedItems = [...items].sort((a, b) => {
    const byGroup = groupName(a.groupId).localeCompare(groupName(b.groupId), "es");
    return byGroup || byName(a, b);
  });

  function openCreate() {
    if (groups.length === 0) {
      toast.error("Primero creá un grupo");
      setTab("grupos");
      setGroupDraft({ id: null, name: "", color: TAG_COLORS[0]! });
      return;
    }
    setTab("etiquetas");
    setDraft({
      id: null,
      name: "",
      groupId: groups[0]!.id,
    });
  }

  function openCreateGroup() {
    setTab("grupos");
    setGroupDraft({ id: null, name: "", color: TAG_COLORS[0]! });
  }

  if (createRef) createRef.current = openCreate;
  if (createGroupRef) createGroupRef.current = openCreateGroup;

  function openEdit(tag: WaTag) {
    setDraft({
      id: tag.id,
      name: tag.name,
      groupId: tag.groupId || groups[0]?.id || "",
    });
  }

  function openEditGroup(group: WaTagGroup) {
    setGroupDraft({ id: group.id, name: group.name, color: group.color });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("Ingresá un nombre");
      return;
    }
    if (!draft.groupId) {
      toast.error("Elegí un grupo");
      return;
    }
    setSaving(true);
    try {
      const payload = { name, groupId: draft.groupId };
      if (draft.id) {
        const updated = await updateWaTag(draft.id, payload);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        toast.success("Etiqueta actualizada");
      } else {
        const created = await createWaTag(payload);
        setItems((prev) => [...prev, created]);
        toast.success("Etiqueta creada");
      }
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function onSaveGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupDraft || saving) return;
    const name = groupDraft.name.trim();
    if (!name) {
      toast.error("Ingresá un nombre");
      return;
    }
    setSaving(true);
    try {
      const payload = { name, color: groupDraft.color };
      if (groupDraft.id) {
        const updated = await updateWaTagGroup(groupDraft.id, payload);
        setGroups((prev) => prev.map((group) => (group.id === updated.id ? updated : group)).sort(byName));
        toast.success("Grupo actualizado");
      } else {
        const created = await createWaTagGroup(payload);
        setGroups((prev) => [...prev, created].sort(byName));
        toast.success("Grupo creado");
      }
      setGroupDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el grupo");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!removeId || saving) return;
    setSaving(true);
    try {
      await deleteWaTag(removeId);
      setItems((prev) => prev.filter((item) => item.id !== removeId));
      setRemoveId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  }

  async function onRemoveGroup() {
    if (!removeGroupId || saving) return;
    setSaving(true);
    try {
      await deleteWaTagGroup(removeGroupId);
      setGroups((prev) => prev.filter((group) => group.id !== removeGroupId));
      setGroupDraft((current) => (current?.id === removeGroupId ? null : current));
      setRemoveGroupId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el grupo");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="app-tabs app-tabs--full wa-tags-panel__tabs" role="tablist" aria-label="Etiquetas y grupos">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "etiquetas"}
          className={`app-tabs__btn${tab === "etiquetas" ? " is-active" : ""}`}
          onClick={() => setTab("etiquetas")}
        >
          Etiquetas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "grupos"}
          className={`app-tabs__btn${tab === "grupos" ? " is-active" : ""}`}
          onClick={() => setTab("grupos")}
        >
          Grupos
        </button>
      </div>

      {tab === "etiquetas" ? (
        <section className="fl-table-card" role="tabpanel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Etiqueta</th>
                  <th>Grupo</th>
                  <th className="fl-col-actions fl-col-actions--2">Acciones</th>
                </tr>
              </thead>
              {!loading && sortedItems.length > 0 ? (
                <tbody>
                  {sortedItems.map((tag) => (
                    <tr key={tag.id}>
                      <td>
                        <span
                          className="wa-tag"
                          style={{ "--tag": groupColor(tag.groupId) } as CSSProperties}
                        >
                          {tag.name}
                        </span>
                      </td>
                      <td>{groupName(tag.groupId)}</td>
                      <td className="fl-col-actions fl-col-actions--2">
                        <div className="fl-table-actions fl-table-actions--2">
                          <button
                            type="button"
                            className="fl-icon-btn"
                            title="Editar"
                            onClick={() => openEdit(tag)}
                          >
                            <IconPencil size={16} />
                          </button>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--danger"
                            title="Eliminar"
                            onClick={() => setRemoveId(tag.id)}
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
                <LoadingBlock label="Cargando etiquetas…" />
              </div>
            ) : sortedItems.length === 0 ? (
              <div className="fl-table-empty fl-table-empty--fill">
                <div className="fl-table-empty__art">
                  <IconFile size={32} />
                </div>
                <p className="fl-table-empty__title">Todavía no hay etiquetas</p>
                <p className="fl-table-empty__hint">
                  {groups.length === 0
                    ? "Primero creá un grupo y después las etiquetas."
                    : "Creá la primera etiqueta para clasificar las conversaciones."}
                </p>
                {groups.length === 0 ? (
                  <button type="button" className="btn btn-primary" onClick={openCreateGroup}>
                    Crear grupo
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={openCreate}>
                    Nueva etiqueta
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="fl-table-card" role="tabpanel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Color</th>
                  <th>Etiquetas</th>
                  <th className="fl-col-actions fl-col-actions--2">Acciones</th>
                </tr>
              </thead>
              {!loading && sortedGroups.length > 0 ? (
                <tbody>
                  {sortedGroups.map((group) => (
                    <tr key={group.id}>
                      <td>
                        <span className="wa-tag" style={{ "--tag": group.color } as CSSProperties}>
                          {group.name}
                        </span>
                      </td>
                      <td>
                        <span
                          className="wa-tag-swatch wa-tag-swatch--static"
                          style={{ background: group.color }}
                          title={group.color}
                        />
                      </td>
                      <td>{tagsInGroup(group.id)}</td>
                      <td className="fl-col-actions fl-col-actions--2">
                        <div className="fl-table-actions fl-table-actions--2">
                          <button
                            type="button"
                            className="fl-icon-btn"
                            title="Editar"
                            onClick={() => openEditGroup(group)}
                          >
                            <IconPencil size={16} />
                          </button>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--danger"
                            title="Eliminar"
                            onClick={() => {
                              if (tagsInGroup(group.id) > 0) {
                                toast.error("Hay etiquetas en ese grupo");
                                return;
                              }
                              setRemoveGroupId(group.id);
                            }}
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
                <LoadingBlock label="Cargando grupos…" />
              </div>
            ) : sortedGroups.length === 0 ? (
              <div className="fl-table-empty fl-table-empty--fill">
                <div className="fl-table-empty__art">
                  <IconFile size={32} />
                </div>
                <p className="fl-table-empty__title">Todavía no hay grupos</p>
                <p className="fl-table-empty__hint">
                  Creá grupos como Sedes, Profesional o Tratamiento para organizar las etiquetas.
                </p>
                <button type="button" className="btn btn-primary" onClick={openCreateGroup}>
                  Crear grupo
                </button>
              </div>
            ) : null}
          </div>
        </section>
      )}

      <Modal
        open={groupDraft !== null}
        title={groupDraft?.id ? "Editar grupo" : "Nuevo grupo"}
        onClose={() => {
          if (!saving) setGroupDraft(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setGroupDraft(null)}
            >
              Cancelar
            </button>
            <button type="submit" form="wa-tag-group-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : groupDraft?.id ? "Guardar cambios" : "Crear grupo"}
            </button>
          </>
        }
      >
        {groupDraft ? (
          <form id="wa-tag-group-form" onSubmit={(event) => void onSaveGroup(event)}>
            <label className="form-group">
              <span>Nombre</span>
              <input
                value={groupDraft.name}
                onChange={(event) =>
                  setGroupDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
                placeholder="Sedes"
                required
                autoFocus
              />
            </label>
            <div className="form-group">
              <label>Color</label>
              <div className="wa-tag-colors">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`wa-tag-swatch${groupDraft.color === color ? " is-active" : ""}`}
                    style={{ background: color }}
                    aria-label={color}
                    onClick={() =>
                      setGroupDraft((current) => (current ? { ...current, color } : current))
                    }
                  />
                ))}
                <label
                  className={`wa-tag-swatch wa-tag-swatch--custom${
                    !TAG_COLORS.includes(groupDraft.color.toLowerCase()) ? " is-active" : ""
                  }`}
                  title="Elegir color"
                >
                  <input
                    type="color"
                    value={groupDraft.color}
                    onChange={(event) =>
                      setGroupDraft((current) =>
                        current ? { ...current, color: event.target.value } : current,
                      )
                    }
                    aria-label="Elegir color personalizado"
                  />
                </label>
              </div>
            </div>
            <span className="wa-tag" style={{ "--tag": groupDraft.color } as CSSProperties}>
              {groupDraft.name.trim() || "Grupo"}
            </span>
            <p className="form-hint">
              Todas las etiquetas de este grupo van a usar este color.
            </p>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={draft !== null}
        title={draft?.id ? "Editar etiqueta" : "Nueva etiqueta"}
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
            <button type="submit" form="wa-tag-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : draft?.id ? "Guardar cambios" : "Crear etiqueta"}
            </button>
          </>
        }
      >
        {draft ? (
          <form id="wa-tag-form" onSubmit={(event) => void onSave(event)}>
            <label className="form-group">
              <span>Nombre</span>
              <input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                }
                placeholder="Caballito"
                required
                autoFocus
              />
            </label>
            <label className="form-group">
              <span>Grupo</span>
              <select
                className="ui-select"
                value={draft.groupId}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, groupId: event.target.value } : current,
                  )
                }
                required
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="wa-tag" style={{ "--tag": groupColor(draft.groupId) } as CSSProperties}>
              {draft.name.trim() || "Etiqueta"}
            </span>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Eliminar etiqueta"
        message={removing ? `¿Eliminar la etiqueta "${removing.name}"?` : ""}
        confirmLabel={saving ? "Eliminando…" : "Eliminar"}
        onConfirm={() => void onRemove()}
        onCancel={() => {
          if (!saving) setRemoveId(null);
        }}
      />

      <ConfirmDialog
        open={removingGroup !== null}
        title="Eliminar grupo"
        message={removingGroup ? `¿Eliminar el grupo "${removingGroup.name}"?` : ""}
        confirmLabel={saving ? "Eliminando…" : "Eliminar"}
        onConfirm={() => void onRemoveGroup()}
        onCancel={() => {
          if (!saving) setRemoveGroupId(null);
        }}
      />
    </>
  );
}
