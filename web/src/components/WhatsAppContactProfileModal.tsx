import { useEffect, useMemo, useState } from "react";
import { formatFechaHora } from "../lib/fechas";
import { subscribeInicioItemsChanged } from "../lib/inicioEvents";
import { fetchInicioItems } from "../services/dataService";
import type { InicioItem } from "../types";
import type { WaContact } from "../types/whatsappCrm";
import { waContactLabel, waContactThreadHeader } from "../types/whatsappCrm";
import { Modal } from "./Modal";
import type { WaFollowUpKind } from "./WhatsAppContactFollowUpModal";
import { WhatsAppContactDatosForm } from "./WhatsAppContactDatosForm";

export type WaProfileTab = "datos" | "tareas" | "recordatorios" | "notas";

type Props = {
  open: boolean;
  contact: WaContact | null | undefined;
  phoneNumber?: string | null;
  /** Fecha del pedido de turno (menuEstado) si la ficha aún no la tiene. */
  fechaNacimientoPedido?: string | null;
  initialTab?: WaProfileTab;
  onClose: () => void;
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

export function WhatsAppContactProfileModal({
  open,
  contact,
  phoneNumber,
  fechaNacimientoPedido,
  initialTab = "datos",
  onClose,
  onCreate,
  onContactSaved,
}: Props) {
  const [tab, setTab] = useState<WaProfileTab>(initialTab);
  const [items, setItems] = useState<InicioItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [datosSaving, setDatosSaving] = useState(false);
  const [datosCanSubmit, setDatosCanSubmit] = useState(false);

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
    const allowed: WaProfileTab[] = ["datos", "tareas", "recordatorios", "notas"];
    setTab(allowed.includes(initialTab) ? initialTab : "datos");
    void reloadItems();
  }, [open, contactId, initialTab]);

  useEffect(() => {
    if (!open) return;
    return subscribeInicioItemsChanged(() => void reloadItems());
  }, [open, contactId]);

  function requestCreate(kind: WaFollowUpKind) {
    onCreate?.(kind);
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
                fechaNacimientoPedido={fechaNacimientoPedido}
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
