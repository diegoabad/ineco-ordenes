import { useEffect, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import { useAuth } from "../auth/AuthContext";
import { fechaHoyIso, parseYmd, toYmd } from "../lib/fechas";
import {
  createInicioItem,
} from "../services/dataService";
import { updateWaContact } from "../services/whatsappCrmService";
import { notifyInicioItemsChanged } from "../lib/inicioEvents";
import type { InicioRecurrencia, UserDirectoryEntry } from "../types";
import type { WaContact } from "../types/whatsappCrm";
import { waContactLabel } from "../types/whatsappCrm";
import { DateTimePicker } from "./DateTimePicker";
import {
  loadUserDirectoryCached,
  peekUserDirectoryCache,
  UserAssigneeField,
} from "./InicioSharePicker";
import { Modal } from "./Modal";

export type WaFollowUpKind = "tarea" | "recordatorio" | "nota" | "agendar";

type Props = {
  open: boolean;
  contact: WaContact | null | undefined;
  kind: WaFollowUpKind;
  onClose: () => void;
  onContactSaved?: (contact: WaContact) => void;
};

const KIND_TITLE: Record<WaFollowUpKind, string> = {
  tarea: "Tarea",
  recordatorio: "Recordatorio",
  nota: "Notas",
  agendar: "Agendar contacto",
};

function editableContactName(contact: WaContact | null | undefined): string {
  if (!contact) return "";
  if (contact.displayName?.trim()) return contact.displayName.trim();
  const full = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (contact.whatsappName?.trim()) return contact.whatsappName.trim();
  return "";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultRecSchedule(): { fecha: string; hora: string } {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30, 0, 0);
  return {
    fecha: toYmd(d.getFullYear(), d.getMonth(), d.getDate()),
    hora: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

function combineRecSchedule(fecha: string, hora: string): Date | null {
  if (!fecha.trim() || !/^\d{2}:\d{2}$/.test(hora.trim())) return null;
  const base = parseYmd(fecha.trim());
  if (!base) return null;
  const [hh, mm] = hora.trim().split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  base.setHours(hh, mm, 0, 0);
  return base;
}

function validateRecSchedule(fecha: string, hora: string): string | null {
  const d = combineRecSchedule(fecha, hora);
  if (!d) return "Fecha u hora inválida";
  const hoy = fechaHoyIso();
  if (fecha.trim() < hoy) return "No podés elegir un día anterior";
  if (d.getTime() < Date.now() - 1000) {
    return "La hora ya pasó; elegí una hora futura";
  }
  return null;
}

export function WhatsAppContactFollowUpModal({
  open,
  contact,
  kind,
  onClose,
  onContactSaved,
}: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const [titulo, setTitulo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>(() =>
    peekUserDirectoryCache(),
  );
  const [directoryLoading, setDirectoryLoading] = useState(false);

  const scheduleDefault = defaultRecSchedule();
  const [recFecha, setRecFecha] = useState(scheduleDefault.fecha);
  const [recHora, setRecHora] = useState(scheduleDefault.hora);
  const [recAvisoApp, setRecAvisoApp] = useState(true);
  const [recAvisoEmail, setRecAvisoEmail] = useState(false);
  const [recRecurrencia, setRecRecurrencia] = useState<InicioRecurrencia>("none");
  const [recIntervalo, setRecIntervalo] = useState("1");

  const [notaTitulo, setNotaTitulo] = useState("");
  const [notaDetalle, setNotaDetalle] = useState("");
  const [agendaNombre, setAgendaNombre] = useState("");

  const contactId = contact?.id?.trim() || "";
  const contactLabel = contact ? waContactLabel(contact) : "";
  const needsAssignees = kind === "tarea" || kind === "recordatorio";
  const modalTitle =
    kind === "agendar"
      ? KIND_TITLE.agendar
      : contactLabel
        ? `${KIND_TITLE[kind]} · ${contactLabel}`
        : KIND_TITLE[kind];

  useEffect(() => {
    if (!open) return;
    setTitulo("");
    setDetalle("");
    setAssigneeIds(
      (kind === "recordatorio" || kind === "tarea") && user?.id ? [user.id] : [],
    );
    setNotaTitulo("");
    setNotaDetalle("");
    setAgendaNombre(editableContactName(contact));
    const next = defaultRecSchedule();
    setRecFecha(next.fecha);
    setRecHora(next.hora);
    setRecAvisoApp(true);
    setRecAvisoEmail(false);
    setRecRecurrencia("none");
    setRecIntervalo("1");
  }, [open, contactId, kind, user?.id]);

  useEffect(() => {
    if (!open || !needsAssignees) return;
    let cancelled = false;
    const cached = peekUserDirectoryCache();
    if (cached.length > 0) {
      setDirectory(cached);
      setDirectoryLoading(false);
    } else {
      setDirectoryLoading(true);
    }
    void loadUserDirectoryCached()
      .then((data) => {
        if (!cancelled) setDirectory(data);
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudo cargar el directorio de usuarios");
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, needsAssignees]);

  async function submitTarea(e: FormEvent) {
    e.preventDefault();
    const text = titulo.trim();
    if (!text || !contactId || saving) return;
    if (assigneeIds.length === 0) {
      toast.error("Asigná la tarea a alguien");
      return;
    }
    setSaving(true);
    try {
      await createInicioItem({
        tipo: "tarea",
        titulo: text,
        detalle: detalle.trim(),
        sharedWithIds: assigneeIds,
        mostrarEnInicio: true,
        whatsappContactId: contactId,
        whatsappContactLabel: contactLabel || null,
      });
      toast.success("Tarea creada en Inicio");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la tarea");
    } finally {
      setSaving(false);
    }
  }

  async function submitRecordatorio(e: FormEvent) {
    e.preventDefault();
    const text = titulo.trim();
    if (!text || !contactId || saving) return;
    if (assigneeIds.length === 0) {
      toast.error("Asigná el recordatorio a alguien");
      return;
    }
    if (!recAvisoApp && !recAvisoEmail) {
      toast.error("Elegí al menos un aviso: aplicación o mail");
      return;
    }
    const scheduleError = validateRecSchedule(recFecha, recHora);
    if (scheduleError) {
      toast.error(scheduleError);
      return;
    }
    const when = combineRecSchedule(recFecha, recHora);
    if (!when) {
      toast.error("Fecha u hora inválida");
      return;
    }
    let intervaloDias: number | null = null;
    if (recRecurrencia === "cada_n_dias") {
      const n = Number.parseInt(recIntervalo.trim(), 10);
      if (!Number.isFinite(n) || n < 1) {
        toast.error("Indicá cada cuántos días (mínimo 1)");
        return;
      }
      intervaloDias = n;
    }
    setSaving(true);
    try {
      await createInicioItem({
        tipo: "recordatorio",
        titulo: text,
        detalle: detalle.trim(),
        fechaHora: when.toISOString(),
        avisoApp: recAvisoApp,
        avisoEmail: recAvisoEmail,
        recurrencia: recRecurrencia,
        intervaloDias,
        sharedWithIds: assigneeIds,
        mostrarEnInicio: true,
        whatsappContactId: contactId,
        whatsappContactLabel: contactLabel || null,
      });
      toast.success("Recordatorio creado en Inicio");
      notifyInicioItemsChanged();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el recordatorio");
    } finally {
      setSaving(false);
    }
  }

  async function submitNota(e: FormEvent) {
    e.preventDefault();
    if (!contactId || saving) return;
    const t = notaTitulo.trim();
    const d = notaDetalle.trim();
    if (!t && !d) {
      toast.error("Escribí un título o el contenido de la nota");
      return;
    }
    setSaving(true);
    try {
      await createInicioItem({
        tipo: "nota",
        titulo: t || "Nota",
        detalle: d,
        mostrarEnInicio: false,
        whatsappContactId: contactId,
        whatsappContactLabel: contactLabel || null,
      });
      toast.success("Nota guardada en el contacto");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la nota");
    } finally {
      setSaving(false);
    }
  }

  async function submitAgendar(e: FormEvent) {
    e.preventDefault();
    if (!contactId || saving) return;
    const name = agendaNombre.trim();
    if (!name) {
      toast.error("Escribí un nombre para el contacto");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateWaContact(contactId, { displayName: name });
      toast.success("Contacto guardado");
      onContactSaved?.(updated);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el contacto");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const formId =
    kind === "tarea"
      ? "wa-followup-tarea"
      : kind === "recordatorio"
        ? "wa-followup-rec"
        : kind === "nota"
          ? "wa-followup-nota"
          : kind === "agendar"
            ? "wa-followup-agendar"
            : undefined;

  const canSubmit = (() => {
    if (!contactId || saving) return false;
    if (kind === "tarea") return Boolean(titulo.trim()) && assigneeIds.length > 0;
    if (kind === "recordatorio") {
      if (!titulo.trim()) return false;
      if (assigneeIds.length === 0) return false;
      if (!recAvisoApp && !recAvisoEmail) return false;
      if (validateRecSchedule(recFecha, recHora)) return false;
      if (recRecurrencia === "cada_n_dias") {
        const n = Number.parseInt(recIntervalo.trim(), 10);
        if (!Number.isFinite(n) || n < 1) return false;
      }
      return true;
    }
    if (kind === "nota") return Boolean(notaTitulo.trim() || notaDetalle.trim());
    if (kind === "agendar") return Boolean(agendaNombre.trim());
    return false;
  })();

  return (
    <Modal
      open={open}
      wide={kind !== "agendar"}
      className="wa-followup-modal"
      title={modalTitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cerrar
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            {saving
              ? "Guardando…"
              : kind === "tarea"
                ? "Crear tarea"
                : kind === "recordatorio"
                  ? "Crear recordatorio"
                  : kind === "nota"
                    ? "Guardar nota"
                    : "Guardar contacto"}
          </button>
        </>
      }
    >
      {!contactId ? (
        <p className="wa-followup__hint">Seleccioná un chat con contacto para continuar.</p>
      ) : kind === "tarea" ? (
        <form id="wa-followup-tarea" className="form-grid" onSubmit={(e) => void submitTarea(e)}>
            <div className="form-group form-group--full">
              <label htmlFor="wa-fu-tarea-titulo">Título</label>
              <input
                id="wa-fu-tarea-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ej. Llamar para confirmar turno"
                required
                autoFocus
              />
            </div>
            <div className="form-group form-group--full">
              <label htmlFor="wa-fu-tarea-detalle">Detalle</label>
              <textarea
                id="wa-fu-tarea-detalle"
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                rows={3}
                placeholder="Opcional"
              />
            </div>
            <UserAssigneeField
              label="Asignar a"
              loading={directoryLoading}
              options={directory}
              selectedIds={assigneeIds}
              onChange={setAssigneeIds}
              currentUserId={user?.id}
              currentUser={
                user
                  ? { id: user.id, nombre: user.nombre, email: user.email }
                  : null
              }
            />
          </form>
      ) : kind === "recordatorio" ? (
        <form
            id="wa-followup-rec"
            className="form-grid"
            onSubmit={(e) => void submitRecordatorio(e)}
          >
            <div className="form-group form-group--full">
              <label htmlFor="wa-fu-rec-titulo">Recordatorio</label>
              <input
                id="wa-fu-rec-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Qué recordar"
                required
                autoFocus
              />
            </div>
            <div className="form-group form-group--full">
              <label htmlFor="wa-fu-rec-detalle">Detalle</label>
              <textarea
                id="wa-fu-rec-detalle"
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                rows={2}
                placeholder="Opcional"
              />
            </div>
            <div className="form-group">
              <label htmlFor="wa-fu-rec-cuando-fecha">Fecha y hora</label>
              <DateTimePicker
                id="wa-fu-rec-cuando"
                fecha={recFecha}
                hora={recHora}
                onFechaChange={setRecFecha}
                onHoraChange={setRecHora}
                minFecha={fechaHoyIso()}
                aria-label="Fecha y hora del recordatorio"
              />
            </div>
            <div className="form-group">
              <label htmlFor="wa-fu-rec-rep">Repetir</label>
              <select
                id="wa-fu-rec-rep"
                value={recRecurrencia}
                onChange={(e) => setRecRecurrencia(e.target.value as InicioRecurrencia)}
              >
                <option value="none">No se repite</option>
                <option value="semanal">Cada semana</option>
                <option value="mensual">Cada mes</option>
                <option value="cada_n_dias">Cada N días</option>
              </select>
            </div>
            {recRecurrencia === "cada_n_dias" ? (
              <div className="form-group">
                <label htmlFor="wa-fu-rec-n">Cada cuántos días</label>
                <input
                  id="wa-fu-rec-n"
                  type="number"
                  min={1}
                  value={recIntervalo}
                  onChange={(e) => setRecIntervalo(e.target.value)}
                />
              </div>
            ) : null}
            <div className="form-group form-group--full">
              <label>Avisar</label>
              <div
                className="inicio-aviso-options inicio-aviso-options--row"
                role="group"
                aria-label="Tipo de aviso"
              >
                <label className={`inicio-aviso-card${recAvisoApp ? " is-checked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={recAvisoApp}
                    onChange={(e) => setRecAvisoApp(e.target.checked)}
                  />
                  <span className="inicio-aviso-card__check" aria-hidden="true" />
                  <span className="inicio-aviso-card__title">En la aplicación</span>
                </label>
                <label className={`inicio-aviso-card${recAvisoEmail ? " is-checked" : ""}`}>
                  <input
                    type="checkbox"
                    checked={recAvisoEmail}
                    onChange={(e) => setRecAvisoEmail(e.target.checked)}
                  />
                  <span className="inicio-aviso-card__check" aria-hidden="true" />
                  <span className="inicio-aviso-card__title">Por mail</span>
                </label>
              </div>
            </div>
            <UserAssigneeField
              label="Asignar a"
              loading={directoryLoading}
              options={directory}
              selectedIds={assigneeIds}
              onChange={setAssigneeIds}
              currentUserId={user?.id}
              currentUser={
                user
                  ? { id: user.id, nombre: user.nombre, email: user.email }
                  : null
              }
            />
          </form>
      ) : kind === "nota" ? (
        <form id="wa-followup-nota" className="form-grid" onSubmit={(e) => void submitNota(e)}>
          <div className="form-group form-group--full">
            <label htmlFor="wa-fu-nota-titulo">Título</label>
            <input
              id="wa-fu-nota-titulo"
              value={notaTitulo}
              onChange={(e) => setNotaTitulo(e.target.value)}
              placeholder="Opcional"
              autoFocus
            />
          </div>
          <div className="form-group form-group--full">
            <label htmlFor="wa-fu-nota-detalle">Nota</label>
            <textarea
              id="wa-fu-nota-detalle"
              value={notaDetalle}
              onChange={(e) => setNotaDetalle(e.target.value)}
              rows={4}
              placeholder="Solo visible en este contacto"
            />
          </div>
        </form>
      ) : (
        <form
            id="wa-followup-agendar"
            className="form-grid"
            onSubmit={(e) => void submitAgendar(e)}
          >
            <div className="form-group form-group--full">
              <label htmlFor="wa-fu-agenda-nombre">Nombre</label>
              <input
                id="wa-fu-agenda-nombre"
                value={agendaNombre}
                onChange={(e) => setAgendaNombre(e.target.value)}
                placeholder="Nombre del contacto"
                required
                autoFocus
              />
            </div>
          </form>
      )}
    </Modal>
  );
}
