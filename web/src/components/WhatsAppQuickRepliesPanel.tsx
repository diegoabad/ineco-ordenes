import {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
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
  fetchWaTagCatalog,
  updateQuickReply,
} from "../services/whatsappCrmService";
import type { WaTag, WaTagGroup } from "../types/whatsappCrm";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconFile, IconPencil, IconSearch, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

type Draft = {
  id: string | null;
  trigger: string;
  body: string;
  tagIds: string[];
  isActive: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  trigger: "",
  body: "",
  tagIds: [],
  isActive: true,
});

type Props = {
  createRef?: MutableRefObject<(() => void) | null>;
};

export function WhatsAppQuickRepliesPanel({ createRef }: Props) {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [tagGroups, setTagGroups] = useState<WaTagGroup[]>([]);
  const [tags, setTags] = useState<WaTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [tagQuery, setTagQuery] = useState("");
  const [tagListOpen, setTagListOpen] = useState(false);
  const [tagHighlight, setTagHighlight] = useState(0);
  const [tagMenuPos, setTagMenuPos] = useState<{
    left: number;
    width: number;
    bottom: number;
  } | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const tagComboRef = useRef<HTMLDivElement | null>(null);
  const tagMenuRef = useRef<HTMLUListElement | null>(null);

  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const groupsById = useMemo(
    () => new Map(tagGroups.map((group) => [group.id, group])),
    [tagGroups],
  );
  const sortedGroups = useMemo(
    () => [...tagGroups].sort((a, b) => a.name.localeCompare(b.name, "es")),
    [tagGroups],
  );
  const availableTags = useMemo(() => {
    if (!draft) return [];
    const selected = new Set(draft.tagIds);
    const query = tagQuery.trim().toLowerCase();
    return tags
      .filter((tag) => {
        if (selected.has(tag.id)) return false;
        if (!query) return true;
        const groupName = groupsById.get(tag.groupId)?.name ?? "";
        return (
          tag.name.toLowerCase().includes(query) || groupName.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [draft, tags, tagQuery, groupsById]);

  function resizeBody(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function groupColor(groupId: string): string {
    return groupsById.get(groupId)?.color || "#a61948";
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [replies, catalog] = await Promise.all([
          fetchQuickReplies(),
          fetchWaTagCatalog().catch(() => ({ groups: [] as WaTagGroup[], items: [] as WaTag[] })),
        ]);
        if (cancelled) return;
        setItems(replies);
        setTagGroups(catalog.groups);
        setTags(catalog.items);
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

  useEffect(() => {
    if (!tagListOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (tagComboRef.current?.contains(target) || tagMenuRef.current?.contains(target)) {
        return;
      }
      setTagListOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [tagListOpen]);

  useLayoutEffect(() => {
    if (!tagListOpen) {
      setTagMenuPos(null);
      return;
    }
    function placeMenu() {
      const anchor = tagComboRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setTagMenuPos({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + 4,
      });
    }
    placeMenu();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [tagListOpen, tagQuery, availableTags.length]);

  useEffect(() => {
    setTagHighlight(0);
  }, [tagQuery, draft?.tagIds]);

  const removing = items.find((item) => item.id === removeId) ?? null;

  function resetTagPicker() {
    setTagQuery("");
    setTagListOpen(false);
    setTagHighlight(0);
    setTagMenuPos(null);
  }

  function openCreate() {
    resetTagPicker();
    setDraft(emptyDraft());
  }

  if (createRef) createRef.current = openCreate;

  function openEdit(item: QuickReply) {
    resetTagPicker();
    setDraft({
      id: item.id,
      trigger: formatTrigger(item.trigger),
      body: item.body,
      tagIds: Array.isArray(item.tagIds) ? item.tagIds.filter((id) => tagsById.has(id)) : [],
      isActive: item.isActive,
    });
  }

  function addDraftTag(tagId: string) {
    setDraft((current) => {
      if (!current || current.tagIds.includes(tagId)) return current;
      return { ...current, tagIds: [...current.tagIds, tagId] };
    });
    setTagQuery("");
    setTagHighlight(0);
  }

  function removeDraftTag(tagId: string) {
    setDraft((current) =>
      current ? { ...current, tagIds: current.tagIds.filter((id) => id !== tagId) } : current,
    );
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
        tagIds: draft.tagIds,
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
      resetTagPicker();
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
      <section className="fl-table-card wa-quick-table">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Disparador</th>
                <th>Mensaje</th>
                <th>Etiquetas</th>
                <th className="fl-col-actions fl-col-actions--2">Acciones</th>
              </tr>
            </thead>
            {!loading && items.length > 0 ? (
              <tbody>
                {items.map((item) => {
                  const linked = (item.tagIds ?? []).filter((id) => tagsById.has(id));
                  return (
                    <tr key={item.id}>
                      <td className="wa-quick-trigger-cell">
                        <code
                          className="wa-quick-trigger"
                          data-tooltip={formatTrigger(item.trigger)}
                        >
                          {formatTrigger(item.trigger)}
                        </code>
                        {!item.isActive ? <span className="wa-quick-off">Inactiva</span> : null}
                      </td>
                      <td className="wa-quick-body">
                        <div
                          className="wa-quick-body__text"
                          data-tooltip={item.body}
                        >
                          {item.body.replace(/\s+/g, " ").trim()}
                        </div>
                      </td>
                      <td>
                        {linked.length > 0 ? (
                          <div className="wa-quick-tags">
                            {linked.map((tagId) => {
                              const tag = tagsById.get(tagId);
                              if (!tag) return null;
                              return (
                                <span
                                  key={tagId}
                                  className="wa-tag wa-tag--mini"
                                  style={{ "--tag": groupColor(tag.groupId) } as CSSProperties}
                                  data-tooltip={tag.name}
                                >
                                  {tag.name}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="wa-quick-tags-empty">Sin etiquetas</span>
                        )}
                      </td>
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
                  );
                })}
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
        className="fl-modal--wa-quick"
        title={draft?.id ? "Editar respuesta rápida" : "Nueva respuesta rápida"}
        onClose={() => {
          if (!saving) {
            resetTagPicker();
            setDraft(null);
          }
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                if (!saving) {
                  resetTagPicker();
                  setDraft(null);
                }
              }}
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
            <div className="form-group">
              <label>Etiquetas al usar</label>
              {sortedGroups.length === 0 ? (
                <p className="wa-quick-tags-empty">Todavía no hay etiquetas creadas.</p>
              ) : (
                <div className="wa-quick-tag-field">
                  <div
                    className={`prof-combobox wa-quick-combo${tagListOpen ? " is-open" : ""}`}
                    ref={tagComboRef}
                  >
                    <div className="table-search">
                      <span className="table-search__icon" aria-hidden>
                        <IconSearch size={16} />
                      </span>
                      <input
                        type="search"
                        value={tagQuery}
                        placeholder={
                          availableTags.length === 0 && !tagQuery
                            ? "No quedan etiquetas"
                            : "Buscar y agregar etiqueta…"
                        }
                        disabled={availableTags.length === 0 && !tagQuery}
                        autoComplete="off"
                        onFocus={() => setTagListOpen(true)}
                        onChange={(event) => {
                          setTagQuery(event.target.value);
                          setTagListOpen(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setTagListOpen(false);
                            return;
                          }
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setTagListOpen(true);
                            setTagHighlight((current) =>
                              availableTags.length === 0
                                ? 0
                                : (current + 1) % availableTags.length,
                            );
                            return;
                          }
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setTagListOpen(true);
                            setTagHighlight((current) =>
                              availableTags.length === 0
                                ? 0
                                : (current - 1 + availableTags.length) % availableTags.length,
                            );
                            return;
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            const picked = availableTags[tagHighlight] ?? availableTags[0];
                            if (picked) addDraftTag(picked.id);
                          }
                        }}
                      />
                    </div>
                  </div>
                  {tagListOpen && tagMenuPos && (availableTags.length > 0 || tagQuery.trim())
                    ? createPortal(
                        <ul
                          ref={tagMenuRef}
                          className="prof-combobox__list wa-quick-combo__list"
                          role="listbox"
                          style={{
                            left: tagMenuPos.left,
                            width: tagMenuPos.width,
                            bottom: tagMenuPos.bottom,
                          }}
                        >
                          {availableTags.length === 0 ? (
                            <li className="prof-combobox__empty">Sin coincidencias</li>
                          ) : (
                            sortedGroups.map((group) => {
                              const groupTags = availableTags.filter(
                                (tag) => tag.groupId === group.id,
                              );
                              if (groupTags.length === 0) return null;
                              return (
                                <li key={group.id} className="wa-quick-combo__group">
                                  <p className="wa-tag-picker__group">{group.name}</p>
                                  {groupTags.map((tag) => {
                                    const index = availableTags.findIndex(
                                      (item) => item.id === tag.id,
                                    );
                                    return (
                                      <button
                                        key={tag.id}
                                        type="button"
                                        role="option"
                                        aria-selected={index === tagHighlight}
                                        className={`prof-combobox__option${index === tagHighlight ? " is-selected" : ""}`}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onMouseEnter={() => setTagHighlight(index)}
                                        onClick={() => addDraftTag(tag.id)}
                                      >
                                        <span
                                          className="wa-tag wa-tag--mini"
                                          style={{ "--tag": group.color } as CSSProperties}
                                        >
                                          {tag.name}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </li>
                              );
                            })
                          )}
                        </ul>,
                        document.body,
                      )
                    : null}
                  <div className="wa-quick-tags wa-quick-tags--chips">
                    {draft.tagIds.length > 0
                      ? draft.tagIds.map((tagId) => {
                          const tag = tagsById.get(tagId);
                          if (!tag) return null;
                          return (
                            <button
                              key={tagId}
                              type="button"
                              className="wa-tag"
                              style={{ "--tag": groupColor(tag.groupId) } as CSSProperties}
                              title="Quitar etiqueta"
                              onClick={() => removeDraftTag(tagId)}
                            >
                              {tag.name}
                              <span aria-hidden>×</span>
                            </button>
                          );
                        })
                      : null}
                  </div>
                </div>
              )}
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
