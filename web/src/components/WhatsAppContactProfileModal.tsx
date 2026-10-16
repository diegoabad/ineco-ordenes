import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatFechaHora } from "../lib/fechas";
import { subscribeInicioItemsChanged } from "../lib/inicioEvents";
import { fetchInicioItems } from "../services/dataService";
import type { InicioItem } from "../types";
import type { WaContact, WaTag, WaTagGroup } from "../types/whatsappCrm";
import { waContactLabel, waContactThreadHeader } from "../types/whatsappCrm";
import { Modal } from "./Modal";
import type { WaFollowUpKind } from "./WhatsAppContactFollowUpModal";
import { WhatsAppContactDatosForm } from "./WhatsAppContactDatosForm";

export type WaProfileTab =
  | "datos"
  | "tareas"
  | "recordatorios"
  | "notas"
  | "etiquetas";

type Props = {
  open: boolean;
  contact: WaContact | null | undefined;
  phoneNumber?: string | null;
  tagIds: string[];
  tags: WaTag[];
  tagGroups: WaTagGroup[];
  initialTab?: WaProfileTab;
  onClose: () => void;
  onToggleTag?: (tagId: string) => void;
  onCreate?: (kind: WaFollowUpKind) => void;
  onContactSaved?: (contact: WaContact) => void;
};

function isAgendado(contact?: WaContact | null): boolean {
  return Boolean(
    contact?.displayName?.trim() ||
      contact?.firstName?.trim() ||
      contact?.lastName?.trim(),
  );
}

function tagColor(tag: WaTag, groups: WaTagGroup[]): string {
  return groups.find((g) => g.id === tag.groupId)?.color || "#64748b";
}

function tagGroupName(tag: WaTag, groups: WaTagGroup[]): string {
  return groups.find((g) => g.id === tag.groupId)?.name || "Sin grupo";
}

export function WhatsAppContactProfileModal({
  open,
  contact,
  phoneNumber,
  tagIds,
  tags,
  tagGroups,
  initialTab = "datos",
  onClose,
  onToggleTag,
  onCreate,
  onContactSaved,
}: Props) {
  const [tab, setTab] = useState<WaProfileTab>(initialTab);
  const [items, setItems] = useState<InicioItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [tagSuggestOpen, setTagSuggestOpen] = useState(false);
  const [datosSaving, setDatosSaving] = useState(false);
  const [datosCanSubmit, setDatosCanSubmit] = useState(false);
  const tagSearchWrapRef = useRef<HTMLDivElement | null>(null);

  const contactId = contact?.id?.trim() || "";
  const header = waContactThreadHeader(contact);
  const phone = header.phone || String(phoneNumber ?? "").trim();
  const label = contact ? waContactLabel(contact) : "Contacto";
  const agendado = isAgendado(contact);

  const tareas = useMemo(
    () => items.filter((it) => it.tipo === "tarea").sort((a, b) => Number(a.hecha) - Number(b.hecha)),
    [items],
  );
  const recordatorios = useMemo(
    () =>
      items
        .filter((it) => it.tipo === "recordatorio")
        .sort((a, b) => String(a.fechaHora ?? "").localeCompare(String(b.fechaHora ?? ""))),
    [items],
  );
  const notas = useMemo(
    () =>
      items
        .filter((it) => it.tipo === "nota")
        .sort((a, b) =>
          String(b.actualizadoAt ?? b.creadoAt).localeCompare(String(a.actualizadoAt ?? a.creadoAt)),
        ),
    [items],
  );

  const currentTags = useMemo(
    () => tags.filter((tag) => tagIds.includes(tag.id)),
    [tags, tagIds],
  );
  const availableTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    return tags
      .filter((tag) => !tagIds.includes(tag.id))
      .filter((tag) => {
        if (!q) return true;
        const group = tagGroupName(tag, tagGroups).toLowerCase();
        return tag.name.toLowerCase().includes(q) || group.includes(q);
      });
  }, [tags, tagIds, tagQuery, tagGroups]);

  async function reloadItems() {
    if (!contactId) {
      setItems([]);
      return;
    }
    setLoadingItems(true);
    try {
      const data = await fetchInicioItems(undefined, { whatsappContactId: contactId });
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const allowed: WaProfileTab[] = [
      "datos",
      "tareas",
      "recordatorios",
      "notas",
      "etiquetas",
    ];
    setTab(allowed.includes(initialTab) ? initialTab : "datos");
    setTagQuery("");
    setTagSuggestOpen(false);
    void reloadItems();
  }, [open, contactId, initialTab]);

  useEffect(() => {
    if (!open) return;
    return subscribeInicioItemsChanged(() => void reloadItems());
  }, [open, contactId]);

  useEffect(() => {
    if (!tagSuggestOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!tagSearchWrapRef.current?.contains(e.target as Node)) {
        setTagSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [tagSuggestOpen]);

  function requestCreate(kind: WaFollowUpKind) {
    onCreate?.(kind);
  }

  function addTag(tagId: string) {
    onToggleTag?.(tagId);
    setTagQuery("");
    setTagSuggestOpen(true);
  }

  return (
    <Modal
      open={open}
      wide
      className="fl-modal--wa-profile"
      title={agendado ? header.title : phone || label}
      headerAside={
        agendado && header.subtitle ? (
          <span className="wa-profile__header-rel">{header.subtitle}</span>
        ) : agendado && phone ? (
          <span className="wa-profile__header-phone">{phone}</span>
        ) : !agendado ? (
          <span className="wa-profile__header-badge">Sin agendar</span>
        ) : null
      }
      onClose={onClose}
      footer={
        tab === "datos" ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={datosSaving}
            >
              Cerrar
            </button>
            <button
              type="submit"
              form="wa-profile-datos"
              className="btn btn-primary"
              disabled={!datosCanSubmit}
            >
              {datosSaving ? "Guardando…" : "Guardar"}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        )
      }
    >
      {!contactId ? (
        <p className="wa-profile__empty">No hay contacto asociado a esta conversación.</p>
      ) : (
        <div className="wa-profile">
          <div className="app-tabs wa-profile__tabs" role="tablist" aria-label="Secciones del contacto">
            {(
              [
                ["datos", "Datos personales"],
                ["tareas", `Tareas${tareas.length ? ` (${tareas.length})` : ""}`],
                ["recordatorios", `Recordatorios${recordatorios.length ? ` (${recordatorios.length})` : ""}`],
                ["notas", `Notas${notas.length ? ` (${notas.length})` : ""}`],
                ["etiquetas", `Etiquetas${currentTags.length ? ` (${currentTags.length})` : ""}`],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`app-tabs__btn${tab === id ? " is-active" : ""}`}
                onClick={() => setTab(id)}
              >
                {text}
              </button>
            ))}
          </div>

          <div className="wa-profile__panel" role="tabpanel">
            {tab === "datos" ? (
              <WhatsAppContactDatosForm
                formId="wa-profile-datos"
                contact={contact}
                phoneNumber={phoneNumber ?? phone}
                active={open && tab === "datos"}
                onSaved={(updated) => {
                  onContactSaved?.(updated);
                }}
                onSavingChange={setDatosSaving}
                onCanSubmitChange={setDatosCanSubmit}
              />
            ) : null}

            {tab === "tareas" ? (
              <ProfileItemsSection
                loading={loadingItems}
                empty="No hay tareas vinculadas a este contacto."
                actionLabel="Nueva tarea"
                onAction={() => requestCreate("tarea")}
                items={tareas}
                renderMeta={(item) => (item.hecha ? "Hecha" : "Pendiente")}
              />
            ) : null}

            {tab === "recordatorios" ? (
              <ProfileItemsSection
                loading={loadingItems}
                empty="No hay recordatorios vinculados a este contacto."
                actionLabel="Nuevo recordatorio"
                onAction={() => requestCreate("recordatorio")}
                items={recordatorios}
                renderMeta={(item) =>
                  item.fechaHora ? formatFechaHora(item.fechaHora) : "Sin fecha"
                }
              />
            ) : null}

            {tab === "notas" ? (
              <ProfileItemsSection
                loading={loadingItems}
                empty="No hay notas vinculadas a este contacto."
                actionLabel="Nueva nota"
                onAction={() => requestCreate("nota")}
                items={notas}
                renderMeta={(item) =>
                  formatFechaHora(item.actualizadoAt || item.creadoAt || "")
                }
              />
            ) : null}

            {tab === "etiquetas" ? (
              <div className="wa-profile__tags">
                <section className="wa-profile__tags-block">
                  <header className="wa-profile__tags-head">
                    <h3>Agregar etiquetas</h3>
                  </header>
                  <div className="wa-profile__tag-search-wrap" ref={tagSearchWrapRef}>
                    <input
                      type="search"
                      className="wa-profile__tag-search"
                      value={tagQuery}
                      onChange={(e) => {
                        setTagQuery(e.target.value);
                        setTagSuggestOpen(true);
                      }}
                      onFocus={() => setTagSuggestOpen(true)}
                      placeholder="Buscar etiqueta…"
                      aria-label="Buscar etiqueta"
                      aria-expanded={tagSuggestOpen}
                    />
                    {tagSuggestOpen ? (
                      <div className="wa-profile__tag-suggest" role="listbox" aria-label="Etiquetas sugeridas">
                        {tags.length === 0 ? (
                          <p className="wa-profile__tag-suggest-empty">
                            No hay etiquetas creadas en el sistema.
                          </p>
                        ) : availableTags.length === 0 ? (
                          <p className="wa-profile__tag-suggest-empty">
                            {tagQuery.trim()
                              ? "Ninguna coincide con la búsqueda."
                              : "Ya tiene todas las etiquetas disponibles."}
                          </p>
                        ) : (
                          availableTags.map((tag) => (
                            <button
                              key={tag.id}
                              type="button"
                              className="wa-profile__tag-suggest-item"
                              role="option"
                              onClick={() => addTag(tag.id)}
                            >
                              <span
                                className="wa-profile__tag-dot"
                                style={{ background: tagColor(tag, tagGroups) }}
                                aria-hidden
                              />
                              <span className="wa-profile__tag-suggest-main">
                                <span className="wa-profile__tag-suggest-name">{tag.name}</span>
                                <span className="wa-profile__tag-suggest-group">
                                  {tagGroupName(tag, tagGroups)}
                                </span>
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="wa-profile__tags-block">
                  <header className="wa-profile__tags-head">
                    <h3>Etiquetas actuales</h3>
                    <span className="wa-profile__tags-count">{currentTags.length}</span>
                  </header>
                  <div className="wa-profile__selected">
                    {currentTags.length === 0 ? null : (
                      <div className="wa-profile__tag-chips">
                        {currentTags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            className="wa-profile__tag is-active"
                            style={{ "--tag-color": tagColor(tag, tagGroups) } as CSSProperties}
                            title="Quitar etiqueta"
                            onClick={() => onToggleTag?.(tag.id)}
                          >
                            <span className="wa-profile__tag-dot" aria-hidden />
                            <span>{tag.name}</span>
                            <span aria-hidden>×</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ProfileItemsSection({
  loading,
  empty,
  actionLabel,
  onAction,
  items,
  renderMeta,
}: {
  loading: boolean;
  empty: string;
  actionLabel: string;
  onAction: () => void;
  items: InicioItem[];
  renderMeta: (item: InicioItem) => string;
}) {
  return (
    <div className="wa-profile__items">
      <div className="wa-profile__items-toolbar">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
      {loading ? (
        <p className="wa-profile__empty-inline">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="wa-profile__empty-inline">{empty}</p>
      ) : (
        <ul className="wa-profile__item-list">
          {items.map((item) => (
            <li
              key={item.id}
              className={`wa-profile__item${item.hecha ? " is-done" : ""}`}
            >
              <div className="wa-profile__item-main">
                <strong>{item.titulo?.trim() || "Sin título"}</strong>
                {item.detalle?.trim() ? <p>{item.detalle.trim()}</p> : null}
              </div>
              <span className="wa-profile__item-meta">{renderMeta(item)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
