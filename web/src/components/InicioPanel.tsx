import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { useAuth } from "../auth/AuthContext";
import { fechaHoyIso, parseYmd, toYmd } from "../lib/fechas";
import {
  createInicioItem,
  deleteInicioItem,
  fetchInicioItems,
  reorderInicioItems,
  updateInicioItem,
} from "../services/dataService";
import { notifyInicioItemsChanged, subscribeInicioItemsChanged } from "../lib/inicioEvents";
import { requestOpenWaContact } from "../lib/whatsappNav";
import type { AppNavTarget } from "../lib/appNav";
import type { InicioItem, InicioNotaColor, InicioRecurrencia, InicioUserRef, UserDirectoryEntry } from "../types";
import {
  INICIO_NOTA_COLOR_LABEL,
  INICIO_NOTA_COLORES,
  INICIO_RECURRENCIA_LABEL,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePicker } from "./DatePicker";
import { DateTimePicker } from "./DateTimePicker";
import {
  IconCalendar,
  IconCheck,
  IconCheckSquare,
  IconClock,
  IconGrip,
  IconMoreVertical,
  IconPencil,
  IconPin,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUsers,
  IconWhatsapp,
  IconX,
} from "./Icons";
import {
  InicioSharePicker,
  loadUserDirectoryCached,
  peekUserDirectoryCache,
  UserAssigneeField,
  UserAvatar,
  UserAvatarStack,
} from "./InicioSharePicker";
import { Modal } from "./Modal";
import { TimePicker } from "./TimePicker";

const weekdayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric" });
const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "short" });
const horaFmt = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DEFAULT_REC_AHEAD_MS = 10 * 60 * 1000;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** IDs para el campo Asignar a: dueño + compartidos (sin vacíos). */
function assigneeIdsFromItem(item: InicioItem, fallbackUserId = ""): string[] {
  const ids = [
    item.userId,
    ...(item.sharedWith ?? []).map((u) => u.id),
  ]
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  if (unique.length > 0) return unique;
  return fallbackUserId ? [fallbackUserId] : [];
}

/** En las cards solo se muestran asignados que no son el dueño. */
function assigneesForDisplay(item: {
  userId: string;
  sharedWith?: InicioItem["sharedWith"];
}): InicioUserRef[] {
  const ownerId = String(item.userId ?? "").trim();
  return (item.sharedWith ?? []).filter((u) => u.id && u.id !== ownerId);
}

/** En el detalle: todos los asociados (dueño + compartidos). */
function assigneesForDetail(item: InicioItem): InicioUserRef[] {
  const byId = new Map<string, InicioUserRef>();
  for (const u of item.sharedWith ?? []) {
    if (u?.id) byId.set(u.id, u);
  }
  const ownerId = String(item.userId ?? "").trim();
  if (ownerId && !byId.has(ownerId)) {
    byId.set(ownerId, {
      id: ownerId,
      nombre: String(item.ownerNombre ?? "").trim() || "Dueño",
      email: "",
    });
  }
  return [...byId.values()];
}

function assigneesNames(users: InicioUserRef[]): string {
  const names = users
    .map((u) => u.nombre.trim() || u.email.trim())
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : "Sin asignar";
}

function AssigneesRow({ users }: { users: InicioUserRef[] }) {
  return (
    <div className="inicio-rec-alert__assignees-row">
      <span className="inicio-rec-alert__assignees-label">Asignado a</span>
      {users.length === 0 ? (
        <span className="inicio-rec-alert__assignees-empty">Sin asignar</span>
      ) : (
        <div className="inicio-rec-alert__assignees" aria-label={assigneesNames(users)}>
          {users.map((user) => (
            <UserAvatar key={user.id} user={user} size={26} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Quita líneas de contexto WhatsApp del detalle (para preview en cards). */
function detalleSinContextoWa(detalle: string): string {
  return detalle
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^WhatsApp:\s*/i.test(line))
    .join("\n")
    .trim();
}

function waBadgeTooltip(item: {
  whatsappContactLabel?: string | null;
}): string {
  return String(item.whatsappContactLabel ?? "").trim() || "WhatsApp";
}

/** Nombre visible sin teléfono (el número va en tooltip). */
function waDisplayName(label: string | null | undefined): string {
  const raw = String(label ?? "").trim();
  if (!raw) return "WhatsApp";
  const parts = raw.split(/\s·\s/);
  if (parts.length >= 2) {
    const name = parts.slice(0, -1).join(" · ").trim();
    const phone = parts[parts.length - 1]?.trim() ?? "";
    if (!name || name === phone || looksLikePhone(name)) return "WhatsApp";
    return name;
  }
  if (looksLikePhone(raw)) return "WhatsApp";
  return raw;
}

function looksLikePhone(value: string): boolean {
  const compact = value.replace(/[\s()-]/g, "");
  return /^\+?\d{6,}$/.test(compact);
}

function cleanMonth(s: string): string {
  return capitalize(s.replace(/\.$/, ""));
}

function formatItemFecha(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const date = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return `${date} ${time}`;
}

function formatItemFechaAlert(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${yy}`;
}

function formatItemSoloHora(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isFromWhatsApp(item: {
  whatsappContactId?: string | null;
  whatsappContactLabel?: string | null;
}): boolean {
  return Boolean(
    String(item.whatsappContactId ?? "").trim() ||
      String(item.whatsappContactLabel ?? "").trim(),
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultRecSchedule(): { fecha: string; hora: string } {
  const d = new Date(Date.now() + DEFAULT_REC_AHEAD_MS);
  d.setSeconds(0, 0);
  return {
    fecha: toYmd(d.getFullYear(), d.getMonth(), d.getDate()),
    hora: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

function scheduleFromIso(iso: string | null): { fecha: string; hora: string } {
  if (!iso) return defaultRecSchedule();
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return defaultRecSchedule();
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

function formatRecurrenciaLabel(item: InicioItem): string | null {
  if (item.tipo !== "recordatorio") return null;
  const recurrencia = item.recurrencia || "none";
  if (recurrencia === "none") return null;
  if (recurrencia === "cada_n_dias") {
    const n = item.intervaloDias ?? 1;
    return n === 1 ? "Cada día" : `Cada ${n} días`;
  }
  return INICIO_RECURRENCIA_LABEL[recurrencia];
}

function isRecordatorioDue(item: InicioItem, nowMs = Date.now()): boolean {
  if (item.tipo !== "recordatorio" || !item.fechaHora) return false;
  const t = Date.parse(item.fechaHora);
  return Number.isFinite(t) && t <= nowMs;
}

type DropEdge = "before" | "after";
type DropHint = { id: string; edge: DropEdge };

function NotaColorPicker({
  value,
  disabled,
  onChange,
}: {
  value: InicioNotaColor;
  disabled?: boolean;
  onChange: (color: InicioNotaColor) => void;
}) {
  return (
    <div className="inicio-paper__colors" role="group" aria-label="Color de la nota">
      {INICIO_NOTA_COLORES.map((color) => (
        <button
          key={color}
          type="button"
          className={`inicio-paper__swatch inicio-paper__swatch--${color}${value === color ? " is-active" : ""}`}
          disabled={disabled}
          aria-label={INICIO_NOTA_COLOR_LABEL[color]}
          data-tooltip={INICIO_NOTA_COLOR_LABEL[color]}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (disabled || value === color) return;
            onChange(color);
          }}
        />
      ))}
    </div>
  );
}

type Props = {
  userName?: string;
  onNavigate?: (target: AppNavTarget) => void;
};

/** Pantalla de entrada: tareas, recordatorios y notas personales. */
export function InicioPanel({ userName, onNavigate }: Props) {
  const { user } = useAuth();
  const myUserId = user?.id ?? "";
  const [now, setNow] = useState(() => new Date());
  const [items, setItems] = useState<InicioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tareaModalOpen, setTareaModalOpen] = useState(false);
  const [editingTareaId, setEditingTareaId] = useState<string | null>(null);
  const [tareaTitulo, setTareaTitulo] = useState("");
  const [tareaDetalle, setTareaDetalle] = useState("");
  const [tareaAssigneeIds, setTareaAssigneeIds] = useState<string[]>([]);
  const [viewTarea, setViewTarea] = useState<InicioItem | null>(null);
  const [viewRec, setViewRec] = useState<InicioItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewNota, setViewNota] = useState<InicioItem | null>(null);
  const [editTitulo, setEditTitulo] = useState("");
  const [editDetalle, setEditDetalle] = useState("");
  const [editColor, setEditColor] = useState<InicioNotaColor>("gris");
  const colorReqRef = useRef(0);
  const [recordatorioOpen, setRecordatorioOpen] = useState(false);
  const [editingRecId, setEditingRecId] = useState<string | null>(null);
  const [convertFromTareaId, setConvertFromTareaId] = useState<string | null>(null);
  const [recTitulo, setRecTitulo] = useState("");
  const [recDetalle, setRecDetalle] = useState("");
  const [recFecha, setRecFecha] = useState(() => defaultRecSchedule().fecha);
  const [recHora, setRecHora] = useState(() => defaultRecSchedule().hora);
  const [recAvisoApp, setRecAvisoApp] = useState(true);
  const [recAvisoEmail, setRecAvisoEmail] = useState(true);
  const [recRecurrencia, setRecRecurrencia] = useState<InicioRecurrencia>("none");
  const [recIntervaloDias, setRecIntervaloDias] = useState("7");
  const [recAssigneeIds, setRecAssigneeIds] = useState<string[]>([]);
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>(() =>
    peekUserDirectoryCache(),
  );
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [shareTarget, setShareTarget] = useState<InicioItem | null>(null);
  const [actionsMenuId, setActionsMenuId] = useState<string | null>(null);
  const [actionsMenuPos, setActionsMenuPos] = useState<{
    bottom: number;
    right: number;
  } | null>(null);

  function closeActionsMenu() {
    setActionsMenuId(null);
    setActionsMenuPos(null);
  }

  function toggleActionsMenu(id: string, anchor: HTMLElement) {
    if (actionsMenuId === id) {
      closeActionsMenu();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setActionsMenuPos({
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
      right: Math.max(8, window.innerWidth - rect.right),
    });
    setActionsMenuId(id);
  }
  const pendingCreatesRef = useRef(new Map<string, Promise<InicioItem>>());
  const savingRecRef = useRef(false);
  const addingTareaRef = useRef(false);

  function isLocalInicioId(id: string): boolean {
    return id.startsWith("local-");
  }

  async function resolveNotaId(id: string): Promise<string | null> {
    if (!isLocalInicioId(id)) return id;
    const pending = pendingCreatesRef.current.get(id);
    if (!pending) return null;
    try {
      const real = await pending;
      return real.id;
    } catch {
      return null;
    }
  }
  const [dragNotaId, setDragNotaId] = useState<string | null>(null);
  const [dragTareaId, setDragTareaId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [reordering, setReordering] = useState(false);
  const dragTareaAllowedRef = useRef(false);

  useEffect(() => {
    if (!actionsMenuId) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(`[data-inicio-actions="${actionsMenuId}"]`)) return;
      if (t?.closest?.("[data-inicio-actions-menu]")) return;
      closeActionsMenu();
    }
    function onDismiss() {
      closeActionsMenu();
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [actionsMenuId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    function load(showSpinner: boolean) {
      if (showSpinner) setLoading(true);
      void fetchInicioItems()
        .then((data) => {
          if (!cancelled) setItems(data);
        })
        .catch((error) => {
          if (!cancelled && showSpinner) {
            toast.error(error instanceof Error ? error.message : "No se pudieron cargar los ítems");
          }
        })
        .finally(() => {
          if (!cancelled && showSpinner) setLoading(false);
        });
    }
    load(true);
    const unsubscribe = subscribeInicioItemsChanged(() => load(false));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!tareaModalOpen && !recordatorioOpen) return;
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
  }, [tareaModalOpen, recordatorioOpen]);

  const firstName = userName?.trim().split(/\s+/)[0];
  const saludo = firstName ? `Hola, ${firstName}` : "Hola";
  const weekday = capitalize(weekdayFmt.format(now).replace(/\.$/, ""));
  const day = dayFmt.format(now);
  const month = cleanMonth(monthFmt.format(now));
  const hora = horaFmt.format(now);
  const tareas = items
    .filter((it) => it.tipo === "tarea")
    .slice()
    .sort((a, b) => {
      if (a.orden !== b.orden) return a.orden - b.orden;
      return Date.parse(b.creadoAt) - Date.parse(a.creadoAt);
    });
  const tareasConRecordatorio = new Set(
    items
      .filter((it) => it.tipo === "recordatorio" && it.origenTareaId)
      .map((it) => it.origenTareaId as string),
  );

  const recordatorios = items
    .filter((it) => it.tipo === "recordatorio")
    .slice()
    .sort((a, b) => {
      const aMs = a.fechaHora ? Date.parse(a.fechaHora) : Number.POSITIVE_INFINITY;
      const bMs = b.fechaHora ? Date.parse(b.fechaHora) : Number.POSITIVE_INFINITY;
      if (aMs !== bMs) return aMs - bMs;
      return Date.parse(b.creadoAt) - Date.parse(a.creadoAt);
    });
  const notas = items
    .filter((it) => it.tipo === "nota")
    .slice()
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.orden !== b.orden) return a.orden - b.orden;
      return Date.parse(b.creadoAt) - Date.parse(a.creadoAt);
    });

  async function persistNotasOrder(nextNotas: InicioItem[]) {
    const owned = nextNotas.filter((it) => it.userId === myUserId);
    if (owned.length === 0) return;
    setReordering(true);
    const previous = items;
    setItems((prev) => {
      const others = prev.filter((it) => it.tipo !== "nota");
      const ownedIds = new Set(owned.map((it) => it.id));
      const shared = nextNotas.filter((it) => !ownedIds.has(it.id));
      const orderedOwned = owned.map((it, index) => ({ ...it, orden: index }));
      return [...others, ...sortNotasLocal([...orderedOwned, ...shared])];
    });
    try {
      const updated = await reorderInicioItems({
        tipo: "nota",
        ids: owned.map((it) => it.id),
      });
      setItems((prev) => {
        const byId = new Map(updated.map((it) => [it.id, it]));
        return prev.map((it) => byId.get(it.id) ?? it);
      });
    } catch (error) {
      setItems(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo reordenar");
    } finally {
      setReordering(false);
    }
  }

  function sortNotasLocal(list: InicioItem[]): InicioItem[] {
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.orden !== b.orden) return a.orden - b.orden;
      return Date.parse(b.creadoAt) - Date.parse(a.creadoAt);
    });
  }

  function moveNota(fromId: string, toId: string, edge: DropEdge) {
    if (reordering) return;
    const from = notas.find((it) => it.id === fromId);
    const to = notas.find((it) => it.id === toId);
    if (!from || !to) return;
    if (from.userId !== myUserId || to.userId !== myUserId) {
      toast.info("Solo podés reordenar tus propias notas");
      return;
    }
    const owned = notas.filter((it) => it.userId === myUserId);
    const fromIndex = owned.findIndex((it) => it.id === fromId);
    const toIndex = owned.findIndex((it) => it.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;

    let insertIndex = edge === "after" ? toIndex + 1 : toIndex;
    if (fromIndex === insertIndex || fromIndex + 1 === insertIndex) return;

    const nextOwned = [...owned];
    const [moved] = nextOwned.splice(fromIndex, 1);
    if (!moved) return;
    if (fromIndex < insertIndex) insertIndex -= 1;
    nextOwned.splice(insertIndex, 0, moved);
    const shared = notas.filter((it) => it.userId !== myUserId);
    void persistNotasOrder([...nextOwned, ...shared]);
  }

  async function persistTareasOrder(nextTareas: InicioItem[]) {
    const owned = nextTareas.filter((it) => it.userId === myUserId);
    if (owned.length === 0) return;
    setReordering(true);
    const previous = items;
    setItems((prev) => {
      const others = prev.filter((it) => it.tipo !== "tarea");
      const ownedIds = new Set(owned.map((it) => it.id));
      const shared = nextTareas.filter((it) => !ownedIds.has(it.id));
      const orderedOwned = owned.map((it, index) => ({ ...it, orden: index }));
      return [...others, ...orderedOwned, ...shared];
    });
    try {
      const updated = await reorderInicioItems({
        tipo: "tarea",
        ids: owned.map((it) => it.id),
      });
      setItems((prev) => {
        const byId = new Map(updated.map((it) => [it.id, it]));
        return prev.map((it) => byId.get(it.id) ?? it);
      });
    } catch (error) {
      setItems(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo reordenar");
    } finally {
      setReordering(false);
    }
  }

  function moveTarea(fromId: string, toId: string, edge: DropEdge) {
    if (reordering) return;
    const from = tareas.find((it) => it.id === fromId);
    const to = tareas.find((it) => it.id === toId);
    if (!from || !to) return;
    if (from.userId !== myUserId || to.userId !== myUserId) {
      toast.info("Solo podés reordenar tus propias tareas");
      return;
    }
    const owned = tareas.filter((it) => it.userId === myUserId);
    const fromIndex = owned.findIndex((it) => it.id === fromId);
    const toIndex = owned.findIndex((it) => it.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;

    let insertIndex = edge === "after" ? toIndex + 1 : toIndex;
    if (fromIndex === insertIndex || fromIndex + 1 === insertIndex) return;

    const nextOwned = [...owned];
    const [moved] = nextOwned.splice(fromIndex, 1);
    if (!moved) return;
    if (fromIndex < insertIndex) insertIndex -= 1;
    nextOwned.splice(insertIndex, 0, moved);
    const shared = tareas.filter((it) => it.userId !== myUserId);
    void persistTareasOrder([...nextOwned, ...shared]);
  }

  function openTareaModal(item?: InicioItem) {
    setViewTarea(null);
    if (item?.tipo === "tarea") {
      setEditingTareaId(item.id);
      setTareaTitulo(item.titulo);
      setTareaDetalle(item.detalle ?? "");
      setTareaAssigneeIds(assigneeIdsFromItem(item, myUserId));
    } else {
      setEditingTareaId(null);
      setTareaTitulo("");
      setTareaDetalle("");
      setTareaAssigneeIds(myUserId ? [myUserId] : []);
    }
    setTareaModalOpen(true);
  }

  function openTareaView(item: InicioItem) {
    setViewTarea(item);
  }

  function openRecordatorioView(item: InicioItem) {
    setViewRec(item);
  }

  function closeTareaModal() {
    if (addingTareaRef.current) return;
    setTareaModalOpen(false);
    setEditingTareaId(null);
    setTareaTitulo("");
    setTareaDetalle("");
    setTareaAssigneeIds([]);
  }

  async function guardarTarea(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const titulo = tareaTitulo.trim();
    if (!titulo || addingTareaRef.current) return;
    if (tareaAssigneeIds.length === 0) {
      toast.error("Asigná la tarea a alguien");
      return;
    }
    const detalle = tareaDetalle.trim();
    const editingId = editingTareaId;
    const sharedWithIds = [...tareaAssigneeIds];

    addingTareaRef.current = true;
    setTareaModalOpen(false);
    setEditingTareaId(null);
    setTareaTitulo("");
    setTareaDetalle("");
    setTareaAssigneeIds([]);

    if (editingId) {
      const previous = items.find((it) => it.id === editingId);
      setItems((prev) =>
        prev.map((it) =>
          it.id === editingId
            ? { ...it, titulo, detalle, actualizadoAt: new Date().toISOString() }
            : it,
        ),
      );
      try {
        const next = await updateInicioItem(editingId, {
          titulo,
          detalle,
          sharedWithIds,
        });
        setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
      } catch (error) {
        if (previous) {
          setItems((prev) =>
            prev.map((it) => (it.id === previous.id ? previous : it)),
          );
        }
        toast.error(error instanceof Error ? error.message : "No se pudo guardar la tarea");
      } finally {
        addingTareaRef.current = false;
      }
      return;
    }

    const tempId = `local-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const minOrden = tareas.reduce(
      (min, it) => Math.min(min, it.orden),
      Number.POSITIVE_INFINITY,
    );
    const optimistic: InicioItem = {
      id: tempId,
      tipo: "tarea",
      titulo,
      detalle,
      fechaHora: null,
      hecha: false,
      orden: Number.isFinite(minOrden) ? minOrden - 1 : 0,
      color: "gris",
      avisoApp: false,
      avisoEmail: false,
      emailEnviadoAt: null,
      recurrencia: "none",
      intervaloDias: null,
      pinned: false,
      origenTareaId: null,
      participantIds: myUserId ? [myUserId] : [],
      sharedWith: [],
      mostrarEnInicio: true,
      whatsappContactId: null,
      whatsappContactLabel: null,
      ownerNombre: user?.nombre ?? userName ?? "",
      userId: myUserId,
      creadoAt: nowIso,
      actualizadoAt: nowIso,
    };
    setItems((prev) => [optimistic, ...prev]);

    try {
      const item = await createInicioItem({
        tipo: "tarea",
        titulo,
        detalle,
        fechaHora: null,
        sharedWithIds,
      });
      setItems((prev) => prev.map((it) => (it.id === tempId ? item : it)));
    } catch (error) {
      setItems((prev) => prev.filter((it) => it.id !== tempId));
      toast.error(error instanceof Error ? error.message : "No se pudo agregar");
    } finally {
      addingTareaRef.current = false;
    }
  }

  function openRecordatorioModal(item?: InicioItem) {
    setViewRec(null);
    if (item?.tipo === "recordatorio") {
      const schedule = scheduleFromIso(item.fechaHora);
      setEditingRecId(item.id);
      setConvertFromTareaId(null);
      setRecTitulo(item.titulo);
      setRecDetalle(item.detalle);
      setRecFecha(schedule.fecha);
      setRecHora(schedule.hora);
      setRecAvisoApp(item.avisoApp);
      setRecAvisoEmail(item.avisoEmail);
      setRecRecurrencia(item.recurrencia || "none");
      setRecIntervaloDias(String(item.intervaloDias && item.intervaloDias > 0 ? item.intervaloDias : 7));
      setRecAssigneeIds(assigneeIdsFromItem(item, myUserId));
    } else if (item?.tipo === "tarea") {
      const schedule = defaultRecSchedule();
      setEditingRecId(null);
      setConvertFromTareaId(item.id);
      setRecTitulo(item.titulo);
      setRecDetalle(item.detalle);
      setRecFecha(schedule.fecha);
      setRecHora(schedule.hora);
      setRecAvisoApp(true);
      setRecAvisoEmail(true);
      setRecRecurrencia("none");
      setRecIntervaloDias("7");
      setRecAssigneeIds(assigneeIdsFromItem(item, myUserId));
    } else {
      const schedule = defaultRecSchedule();
      setEditingRecId(null);
      setConvertFromTareaId(null);
      setRecTitulo("");
      setRecDetalle("");
      setRecFecha(schedule.fecha);
      setRecHora(schedule.hora);
      setRecAvisoApp(true);
      setRecAvisoEmail(true);
      setRecRecurrencia("none");
      setRecIntervaloDias("7");
      setRecAssigneeIds(myUserId ? [myUserId] : []);
    }
    setRecordatorioOpen(true);
  }

  function closeRecordatorioModal() {
    if (savingRecRef.current) return;
    setRecordatorioOpen(false);
    setEditingRecId(null);
    setConvertFromTareaId(null);
    setRecAssigneeIds([]);
  }

  const tituloRecBloqueado =
    Boolean(convertFromTareaId) ||
    Boolean(
      editingRecId &&
        items.find((it) => it.id === editingRecId)?.origenTareaId,
    );

  async function guardarRecordatorio(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const titulo = recTitulo.trim();
    if (!titulo || savingRecRef.current) return;
    if (recAssigneeIds.length === 0) {
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
      const n = Number.parseInt(recIntervaloDias.trim(), 10);
      if (!Number.isFinite(n) || n < 1) {
        toast.error("Indicá cada cuántos días (mínimo 1)");
        return;
      }
      intervaloDias = n;
    }

    savingRecRef.current = true;
    const detalle = recDetalle.trim();
    const avisoApp = recAvisoApp;
    const avisoEmail = recAvisoEmail;
    const recurrencia = recRecurrencia;
    const sharedWithIds = [...recAssigneeIds];
    const fechaHora = when.toISOString();
    const editingId = editingRecId;
    const fromTareaId = convertFromTareaId;
    const tituloLocked = tituloRecBloqueado;

    setRecordatorioOpen(false);
    setEditingRecId(null);
    setConvertFromTareaId(null);
    setRecAssigneeIds([]);

    if (editingId) {
      const previous = items.find((it) => it.id === editingId);
      setItems((prev) =>
        prev.map((it) =>
          it.id === editingId
            ? {
                ...it,
                ...(tituloLocked ? {} : { titulo }),
                detalle,
                fechaHora,
                avisoApp,
                avisoEmail,
                recurrencia,
                intervaloDias,
                actualizadoAt: new Date().toISOString(),
              }
            : it,
        ),
      );
      try {
        const item = await updateInicioItem(editingId, {
          ...(tituloLocked ? {} : { titulo }),
          detalle,
          fechaHora,
          avisoApp,
          avisoEmail,
          recurrencia,
          intervaloDias,
          sharedWithIds,
        });
        setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
        notifyInicioItemsChanged();
      } catch (error) {
        if (previous) {
          setItems((prev) => prev.map((it) => (it.id === previous.id ? previous : it)));
        }
        toast.error(error instanceof Error ? error.message : "No se pudo guardar el recordatorio");
      } finally {
        savingRecRef.current = false;
      }
      return;
    }

    const tempId = `local-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const optimistic: InicioItem = {
      id: tempId,
      tipo: "recordatorio",
      titulo,
      detalle,
      fechaHora,
      hecha: false,
      orden: 0,
      color: "gris",
      avisoApp,
      avisoEmail,
      emailEnviadoAt: null,
      recurrencia,
      intervaloDias,
      pinned: false,
      origenTareaId: fromTareaId,
      participantIds: myUserId ? [myUserId] : [],
      sharedWith: [],
      mostrarEnInicio: true,
      whatsappContactId: null,
      whatsappContactLabel: null,
      ownerNombre: user?.nombre ?? userName ?? "",
      userId: myUserId,
      creadoAt: nowIso,
      actualizadoAt: nowIso,
    };
    setItems((prev) => [optimistic, ...prev]);

    try {
      const item = await createInicioItem({
        tipo: "recordatorio",
        titulo,
        detalle,
        fechaHora,
        avisoApp,
        avisoEmail,
        recurrencia,
        intervaloDias,
        sharedWithIds,
        ...(fromTareaId ? { origenTareaId: fromTareaId } : {}),
      });
      setItems((prev) => {
        if (prev.some((it) => it.id === item.id)) {
          return prev.filter((it) => it.id !== tempId);
        }
        return prev.map((it) => (it.id === tempId ? item : it));
      });
    notifyInicioItemsChanged();
    } catch (error) {
      setItems((prev) => prev.filter((it) => it.id !== tempId));
      toast.error(error instanceof Error ? error.message : "No se pudo crear el recordatorio");
    } finally {
      savingRecRef.current = false;
    }
  }

  function crearNotaVacia() {
    const tempId = `local-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const draft: InicioItem = {
      id: tempId,
      tipo: "nota",
      titulo: "",
      detalle: "",
      fechaHora: null,
      hecha: false,
      orden: 0,
      color: "gris",
      avisoApp: false,
      avisoEmail: false,
      emailEnviadoAt: null,
      recurrencia: "none",
      intervaloDias: null,
      pinned: false,
      origenTareaId: null,
      participantIds: myUserId ? [myUserId] : [],
      sharedWith: [],
      mostrarEnInicio: true,
      whatsappContactId: null,
      whatsappContactLabel: null,
      ownerNombre: user?.nombre ?? userName ?? "",
      userId: myUserId,
      creadoAt: nowIso,
      actualizadoAt: nowIso,
    };
    setEditTitulo("");
    setEditDetalle("");
    setEditColor("gris");
    setViewNota(draft);
  }

  function openNota(item: InicioItem) {
    setEditTitulo(item.titulo);
    setEditDetalle(item.detalle);
    setEditColor(item.color || "gris");
    setViewNota(item);
  }

  async function closeNotaModal(opts?: { commit?: boolean }) {
    if (!viewNota) return;
    const draft = viewNota;
    const titulo = editTitulo.trim();
    const detalle = editDetalle.trim();
    const color = editColor;
    const closingId = draft.id;
    const isDraft = isLocalInicioId(closingId);
    const hadContent =
      draft.titulo.trim().length > 0 || draft.detalle.trim().length > 0;
    const hasContent = titulo.length > 0 || detalle.length > 0;
    const commit = opts?.commit === true;

    // Borrador nuevo: solo se persiste con el botón Crear.
    if (isDraft && !commit) {
      setViewNota(null);
      pendingCreatesRef.current.delete(closingId);
      return;
    }

    setViewNota(null);

    if (!hasContent) {
      if (isDraft) {
        pendingCreatesRef.current.delete(closingId);
        return;
      }
      if (!hadContent) return;
      setItems((prev) => prev.filter((it) => it.id !== closingId));
      try {
        await deleteInicioItem(closingId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo eliminar la nota vacía");
        void fetchInicioItems()
          .then(setItems)
          .catch(() => undefined);
      }
      return;
    }

    if (isDraft) {
      const minOrden = notas.reduce(
        (min, it) => Math.min(min, it.orden),
        Number.POSITIVE_INFINITY,
      );
      const optimistic: InicioItem = {
        ...draft,
        titulo,
        detalle,
        color,
        orden: Number.isFinite(minOrden) ? minOrden - 1 : 0,
        actualizadoAt: new Date().toISOString(),
      };
      setItems((prev) => {
        const rest = prev.filter((it) => it.tipo !== "nota");
        const notasPrev = prev.filter((it) => it.tipo === "nota");
        return [...rest, optimistic, ...notasPrev];
      });
      try {
        const item = await createInicioItem({
          tipo: "nota",
          titulo,
          detalle,
          fechaHora: null,
          color,
          sharedWithIds: myUserId ? [myUserId] : [],
        });
        setItems((prev) =>
          prev.map((it) =>
            it.id === closingId ? { ...item, color: it.color, pinned: it.pinned } : it,
          ),
        );
      } catch (error) {
        setItems((prev) => prev.filter((it) => it.id !== closingId));
        toast.error(error instanceof Error ? error.message : "No se pudo crear la nota");
      }
      return;
    }

    const dirty =
      titulo !== draft.titulo.trim() ||
      detalle !== draft.detalle.trim() ||
      color !== (draft.color || "gris");
    if (!dirty) return;

    setBusyId(closingId);
    try {
      const next = await updateInicioItem(closingId, { titulo, detalle, color });
      setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la nota");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleHecha(item: InicioItem) {
    const nextHecha = !item.hecha;
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, hecha: nextHecha } : it)),
    );
    try {
      const next = await updateInicioItem(item.id, { hecha: nextHecha });
      setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
    } catch (error) {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, hecha: item.hecha } : it)),
      );
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar");
    }
  }

  function changeNotaColor(itemId: string, color: InicioNotaColor) {
    const previousColor = editColor;
    setEditColor(color);
    setViewNota((prev) => (prev?.id === itemId ? { ...prev, color } : prev));

    if (isLocalInicioId(itemId)) {
      return;
    }

    const req = ++colorReqRef.current;
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, color } : it)),
    );

    void (async () => {
      try {
        const next = await updateInicioItem(itemId, { color });
        if (colorReqRef.current !== req) return;
        setItems((prev) =>
          prev.map((it) =>
            it.id === next.id || it.id === itemId ? { ...it, ...next, color } : it,
          ),
        );
        setViewNota((prev) =>
          prev && (prev.id === next.id || prev.id === itemId)
            ? { ...prev, ...next, color }
            : prev,
        );
      } catch (error) {
        if (colorReqRef.current !== req) return;
        setEditColor(previousColor);
        setItems((prev) =>
          prev.map((it) => (it.id === itemId ? { ...it, color: previousColor } : it)),
        );
        setViewNota((prev) =>
          prev?.id === itemId ? { ...prev, color: previousColor } : prev,
        );
        toast.error(error instanceof Error ? error.message : "No se pudo cambiar el color");
      }
    })();
  }

  async function saveShare(ids: string[]) {
    if (!shareTarget) return;
    const id = shareTarget.id;
    if (isLocalInicioId(id)) {
      throw new Error("Esperá a que se guarde antes de asignar o compartir");
    }
    const previous = shareTarget;
    const item = await updateInicioItem(id, { sharedWithIds: ids });
    setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
    setViewNota((prev) => (prev?.id === item.id ? { ...prev, ...item } : prev));
    setShareTarget(null);
    toast.success(
      previous.tipo === "tarea"
        ? ids.length
          ? "Tarea asignada"
          : "Asignación actualizada"
        : previous.tipo === "recordatorio"
          ? ids.length
            ? "Recordatorio asignado"
            : "Asignación actualizada"
          : ids.length
            ? "Nota compartida"
            : "Compartido actualizado",
    );
  }

  async function toggleNotaPinned(item: InicioItem) {
    if (isLocalInicioId(item.id)) {
      toast.info("Escribí algo en la nota para poder fijarla");
      return;
    }
    const previousPinned = item.pinned;
    const nextPinned = !item.pinned;
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, pinned: nextPinned } : it)),
    );
    setViewNota((prev) =>
      prev?.id === item.id ? { ...prev, pinned: nextPinned } : prev,
    );
    try {
      const realId = await resolveNotaId(item.id);
      if (!realId) throw new Error("No se pudo fijar la nota");
      const next = await updateInicioItem(realId, { pinned: nextPinned });
      setItems((prev) =>
        prev.map((it) =>
          it.id === next.id || it.id === item.id
            ? { ...it, ...next, color: it.color, pinned: next.pinned }
            : it,
        ),
      );
      setViewNota((prev) =>
        prev && (prev.id === next.id || prev.id === item.id)
          ? { ...prev, ...next, color: prev.color, pinned: next.pinned }
          : prev,
      );
    } catch (error) {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, pinned: previousPinned } : it)),
      );
      setViewNota((prev) =>
        prev?.id === item.id ? { ...prev, pinned: previousPinned } : prev,
      );
      toast.error(error instanceof Error ? error.message : "No se pudo fijar la nota");
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    const id = deleteId;
    const previous = items.find((it) => it.id === id) ?? null;
    setDeleteId(null);
    setItems((prev) => prev.filter((it) => it.id !== id));
    setViewNota((prev) => (prev?.id === id ? null : prev));
    setViewTarea((prev) => (prev?.id === id ? null : prev));
    setViewRec((prev) => (prev?.id === id ? null : prev));

    setEditingTareaId((prev) => {
      if (prev === id) {
        setTareaModalOpen(false);
        setTareaTitulo("");
        setTareaDetalle("");
        return null;
      }
      return prev;
    });

    toast.success("Eliminado");

    if (isLocalInicioId(id)) {
      pendingCreatesRef.current.delete(id);
      return;
    }

    try {
      await deleteInicioItem(id);
      if (previous?.tipo === "recordatorio") notifyInicioItemsChanged();
    } catch (error) {
      if (previous) {
        setItems((prev) => (prev.some((it) => it.id === previous.id) ? prev : [previous, ...prev]));
      }
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    }
  }

  return (
    <div className="app-shell inicio-panel">
      <header className="inicio-hero" aria-label="Bienvenida">
        <div className="inicio-hero__content">
          <div className="inicio-hero__row">
            <h1 className="inicio-hero__saludo">{saludo}</h1>

            <div className="inicio-hero__meta" aria-label="Fecha y hora actuales">
              <time className="inicio-hero__chip" dateTime={now.toISOString()}>
                <IconCalendar size={16} className="inicio-hero__chip-icon" />
                <span className="inicio-hero__chip-text">
                  <span className="inicio-hero__chip-main">
                    {weekday} {day}
                  </span>
                  <span className="inicio-hero__chip-sub">{month}</span>
                </span>
              </time>

              <time className="inicio-hero__chip inicio-hero__chip--time" dateTime={now.toISOString()}>
                <IconClock size={16} className="inicio-hero__chip-icon" />
                <span className="inicio-hero__chip-text">
                  <span className="inicio-hero__chip-main">{hora}</span>
                  <span className="inicio-hero__chip-sub">hs</span>
                </span>
              </time>
            </div>
          </div>
        </div>
      </header>

      <div className="inicio-grid">
        <section className="inicio-card inicio-card--tareas">
          <div className="inicio-card__head">
            <h2 className="inicio-card__title">Tareas</h2>
            <button
              type="button"
              className="btn btn-primary inicio-composer__btn"
              onClick={() => openTareaModal()}
              aria-label="Nueva tarea"
              data-tooltip="Nueva tarea"
            >
              <IconPlus size={16} />
            </button>
          </div>

          <div className="inicio-card__body">
            {loading ? (
              <p className="inicio-card__empty">Cargando…</p>
            ) : tareas.length === 0 ? (
              <p className="inicio-card__empty">No hay tareas todavía.</p>
            ) : (
              <ul className="inicio-list">
                {tareas.map((item) => {
                  const yaConvertida = tareasConRecordatorio.has(item.id);
                  const isDragging = dragTareaId === item.id;
                  const isOwner = item.userId === myUserId;
                  const dropEdge =
                    dropHint?.id === item.id && dragTareaId && dragTareaId !== item.id
                      ? dropHint.edge
                      : null;
                  const shared = item.sharedWith ?? [];
                  const detallePreview = detalleSinContextoWa(item.detalle);
                  return (
                  <li
                    key={item.id}
                    className={`inicio-list__item inicio-list__item--tarea${item.hecha ? " is-done" : ""}${isDragging ? " is-dragging" : ""}${dropEdge === "before" ? " is-drop-before" : ""}${dropEdge === "after" ? " is-drop-after" : ""}${!isOwner ? " is-shared" : ""}${actionsMenuId === item.id ? " is-actions-open" : ""}${item.whatsappContactId || item.whatsappContactLabel ? " is-wa" : ""}`}
                    draggable={!reordering && isOwner}
                    onDragStart={(e) => {
                      if (!dragTareaAllowedRef.current || !isOwner) {
                        e.preventDefault();
                        return;
                      }
                      setDragTareaId(item.id);
                      setDropHint(null);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", item.id);
                    }}
                    onDragEnd={() => {
                      dragTareaAllowedRef.current = false;
                      setDragTareaId(null);
                      setDropHint(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragTareaId || !isOwner) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragTareaId === item.id) {
                        setDropHint(null);
                        return;
                      }
                      const rect = e.currentTarget.getBoundingClientRect();
                      const edge: DropEdge =
                        e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                      if (dropHint?.id !== item.id || dropHint.edge !== edge) {
                        setDropHint({ id: item.id, edge });
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDropHint((prev) => (prev?.id === item.id ? null : prev));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromId = e.dataTransfer.getData("text/plain") || dragTareaId;
                      const edge = dropHint?.id === item.id ? dropHint.edge : "before";
                      setDropHint(null);
                      setDragTareaId(null);
                      dragTareaAllowedRef.current = false;
                      if (fromId) moveTarea(fromId, item.id, edge);
                    }}
                  >
                    <span
                      className="inicio-list__grip"
                      data-tooltip={isOwner ? "Arrastrar" : "Solo el dueño puede reordenar"}
                      aria-hidden="true"
                      onPointerDown={() => {
                        if (!reordering && isOwner) {
                          dragTareaAllowedRef.current = true;
                        }
                      }}
                    >
                      <IconGrip size={14} />
                    </span>
                    <input
                      type="checkbox"
                      className="inicio-list__checkbox"
                      checked={item.hecha}
                      disabled={busyId === item.id || reordering}
                      onChange={() => void toggleHecha(item)}
                      aria-label={item.hecha ? "Marcar como pendiente" : "Marcar como hecha"}
                    />
                    <button
                      type="button"
                      className="inicio-list__title-btn"
                      onClick={() => openTareaView(item)}
                    >
                      <span className="inicio-list__main">
                        <span className="inicio-list__title inicio-list__title--ellipsis">
                          {item.titulo}
                        </span>
                        {detallePreview ? (
                          <span className="inicio-list__detalle inicio-list__title--ellipsis">
                            {detallePreview}
                          </span>
                        ) : (
                          <span className="inicio-list__detalle inicio-list__detalle--empty">
                            Sin detalle
                          </span>
                        )}
                      </span>
                      {item.whatsappContactId || item.whatsappContactLabel ? (
                        <span
                          className="inicio-list__wa"
                          data-tooltip={waBadgeTooltip(item)}
                          title={waBadgeTooltip(item)}
                        >
                          WA
                        </span>
                      ) : null}
                      {!isOwner && item.ownerNombre ? (
                        <span className="inicio-list__owner">De {item.ownerNombre}</span>
                      ) : null}
                    </button>
                    <UserAvatarStack
                      users={assigneesForDisplay(item)}
                      emptyLabel={isOwner ? "Asignar" : "Asignados"}
                      disabled={busyId === item.id || reordering || !isOwner}
                      onClick={() => {
                        if (!isOwner) {
                          toast.info("Solo el dueño puede cambiar la asignación");
                          return;
                        }
                        setShareTarget(item);
                      }}
                    />
                    <div
                      className="inicio-list__actions"
                      data-inicio-actions={item.id}
                    >
                      {isOwner ? (
                        <div className="inicio-list__more">
                          <button
                            type="button"
                            className="fl-icon-btn"
                            aria-label="Más acciones"
                            aria-expanded={actionsMenuId === item.id}
                            disabled={busyId === item.id || reordering}
                            onClick={(e) => toggleActionsMenu(item.id, e.currentTarget)}
                          >
                            <IconMoreVertical size={15} />
                          </button>
                          {actionsMenuId === item.id && actionsMenuPos
                            ? createPortal(
                                <div
                                  className="inicio-list__more-menu"
                                  role="menu"
                                  data-inicio-actions-menu=""
                                  style={{
                                    bottom: actionsMenuPos.bottom,
                                    right: actionsMenuPos.right,
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="fl-icon-btn fl-icon-btn--edit"
                                    role="menuitem"
                                    aria-label="Editar"
                                    title="Editar"
                                    disabled={busyId === item.id || reordering}
                                    onClick={() => {
                                      closeActionsMenu();
                                      openTareaModal(item);
                                    }}
                                  >
                                    <IconPencil size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className={`fl-icon-btn${
                                      yaConvertida
                                        ? " fl-icon-btn--muted"
                                        : " fl-icon-btn--success"
                                    }`}
                                    role="menuitem"
                                    aria-label={
                                      yaConvertida
                                        ? "Ya tiene recordatorio (crear otro)"
                                        : "Convertir a recordatorio"
                                    }
                                    title={
                                      yaConvertida
                                        ? "Ya tiene recordatorio"
                                        : "Convertir a recordatorio"
                                    }
                                    disabled={busyId === item.id || reordering}
                                    onClick={() => {
                                      closeActionsMenu();
                                      openRecordatorioModal(item);
                                    }}
                                  >
                                    <IconClock size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="fl-icon-btn fl-icon-btn--danger"
                                    role="menuitem"
                                    aria-label="Eliminar"
                                    title="Eliminar"
                                    disabled={busyId === item.id || reordering}
                                    onClick={() => {
                                      closeActionsMenu();
                                      setDeleteId(item.id);
                                    }}
                                  >
                                    <IconTrash size={15} />
                                  </button>
                                </div>,
                                document.body,
                              )
                            : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="inicio-card inicio-card--recordatorios">
          <div className="inicio-card__head">
            <h2 className="inicio-card__title">Recordatorios</h2>
            <button
              type="button"
              className="btn btn-primary inicio-composer__btn"
              onClick={() => openRecordatorioModal()}
              aria-label="Nuevo recordatorio"
              data-tooltip="Nuevo recordatorio"
            >
              <IconPlus size={16} />
            </button>
          </div>

          <div className="inicio-card__body">
            {loading ? (
              <p className="inicio-card__empty">Cargando…</p>
            ) : recordatorios.length === 0 ? (
              <p className="inicio-card__empty">No hay recordatorios todavía.</p>
            ) : (
              <ul className="inicio-list">
                {recordatorios.map((item) => {
                  const fechaLabel = formatItemFecha(item.fechaHora);
                  const recLabel = formatRecurrenciaLabel(item);
                  const due = isRecordatorioDue(item, now.getTime());
                  const detallePreview = detalleSinContextoWa(item.detalle);
                  const isOwner = item.userId === myUserId;
                  return (
                    <li
                      key={item.id}
                      className={`inicio-list__item inicio-list__item--rec${due ? " is-due" : ""}${actionsMenuId === item.id ? " is-actions-open" : ""}${item.whatsappContactId || item.whatsappContactLabel ? " is-wa" : ""}`}
                    >
                      {fechaLabel ? (
                        <span className="inicio-list__meta inicio-list__meta--inline">
                          {fechaLabel}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="inicio-list__title-btn"
                        onClick={() => openRecordatorioView(item)}
                      >
                        <span className="inicio-list__main">
                          <span className="inicio-list__title inicio-list__title--ellipsis">
                            {item.titulo}
                          </span>
                          {detallePreview ? (
                            <span className="inicio-list__detalle inicio-list__title--ellipsis">
                              {detallePreview}
                            </span>
                          ) : (
                            <span className="inicio-list__detalle inicio-list__detalle--empty">
                              Sin detalle
                            </span>
                          )}
                        </span>
                        {item.whatsappContactId || item.whatsappContactLabel ? (
                          <span
                            className="inicio-list__wa"
                            data-tooltip={waBadgeTooltip(item)}
                            title={waBadgeTooltip(item)}
                          >
                            WA
                          </span>
                        ) : null}
                        {recLabel ? (
                          <span className="inicio-list__recurrencia" data-tooltip={recLabel}>
                            {recLabel}
                          </span>
                        ) : null}
                      </button>
                      <UserAvatarStack
                        users={assigneesForDisplay(item)}
                        emptyLabel={isOwner ? "Asignar" : "Asignados"}
                        disabled={busyId === item.id || !isOwner}
                        onClick={() => {
                          if (!isOwner) {
                            toast.info("Solo el dueño puede cambiar la asignación");
                            return;
                          }
                          setShareTarget(item);
                        }}
                      />
                      <div
                        className="inicio-list__actions"
                        data-inicio-actions={item.id}
                      >
                        {isOwner ? (
                          <div className="inicio-list__more">
                            <button
                              type="button"
                              className="fl-icon-btn"
                              aria-label="Más acciones"
                              aria-expanded={actionsMenuId === item.id}
                              disabled={busyId === item.id}
                              onClick={(e) => toggleActionsMenu(item.id, e.currentTarget)}
                            >
                              <IconMoreVertical size={15} />
                            </button>
                            {actionsMenuId === item.id && actionsMenuPos
                              ? createPortal(
                                  <div
                                    className="inicio-list__more-menu"
                                    role="menu"
                                    data-inicio-actions-menu=""
                                    style={{
                                      bottom: actionsMenuPos.bottom,
                                      right: actionsMenuPos.right,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="fl-icon-btn fl-icon-btn--edit"
                                      role="menuitem"
                                      aria-label="Editar"
                                      title="Editar"
                                      disabled={busyId === item.id}
                                      onClick={() => {
                                        closeActionsMenu();
                                        openRecordatorioModal(item);
                                      }}
                                    >
                                      <IconPencil size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      className="fl-icon-btn fl-icon-btn--danger"
                                      role="menuitem"
                                      aria-label="Eliminar"
                                      title="Eliminar"
                                      disabled={busyId === item.id}
                                      onClick={() => {
                                        closeActionsMenu();
                                        setDeleteId(item.id);
                                      }}
                                    >
                                      <IconTrash size={15} />
                                    </button>
                                  </div>,
                                  document.body,
                                )
                              : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="inicio-card inicio-card--notas">
          <div className="inicio-card__head">
            <h2 className="inicio-card__title">Notas</h2>
            <button
              type="button"
              className="btn btn-primary inicio-composer__btn"
              onClick={crearNotaVacia}
              aria-label="Nueva nota"
              data-tooltip="Nueva nota"
            >
              <IconPlus size={16} />
            </button>
          </div>

          <div className="inicio-card__body">
            {loading ? (
              <p className="inicio-card__empty">Cargando…</p>
            ) : notas.length === 0 ? (
              <p className="inicio-card__empty">No hay notas todavía.</p>
            ) : (
              <div className="inicio-papers">
                {notas.map((item) => {
                  const tituloVisible = item.titulo.trim() || "Sin título";
                  const isDragging = dragNotaId === item.id;
                  const isOwner = item.userId === myUserId;
                  const shared = item.sharedWith ?? [];
                  const dropEdge =
                    dropHint?.id === item.id && dragNotaId !== item.id ? dropHint.edge : null;
                  const color = item.color || "gris";
                  return (
                    <article
                      key={item.id}
                      className={`inicio-paper inicio-paper--saved inicio-paper--${color}${item.pinned ? " is-pinned" : ""}${isDragging ? " is-dragging" : ""}${dropEdge === "before" ? " is-drop-before" : ""}${dropEdge === "after" ? " is-drop-after" : ""}${!isOwner ? " is-shared" : ""}`}
                      draggable={!reordering && isOwner}
                      onDragStart={(e) => {
                        if (!isOwner) {
                          e.preventDefault();
                          return;
                        }
                        setDragNotaId(item.id);
                        setDropHint(null);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", item.id);
                      }}
                      onDragEnd={() => {
                        setDragNotaId(null);
                        setDropHint(null);
                      }}
                      onDragOver={(e) => {
                        if (!isOwner) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dragNotaId === item.id) {
                          setDropHint(null);
                          return;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        const dx = (e.clientX - rect.left) / Math.max(rect.width, 1);
                        const dy = (e.clientY - rect.top) / Math.max(rect.height, 1);
                        const edge: DropEdge =
                          Math.abs(dx - 0.5) >= Math.abs(dy - 0.5)
                            ? dx < 0.5
                              ? "before"
                              : "after"
                            : dy < 0.5
                              ? "before"
                              : "after";
                        if (dropHint?.id !== item.id || dropHint.edge !== edge) {
                          setDropHint({ id: item.id, edge });
                        }
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          setDropHint((prev) => (prev?.id === item.id ? null : prev));
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromId = e.dataTransfer.getData("text/plain") || dragNotaId;
                        const edge = dropHint?.id === item.id ? dropHint.edge : "before";
                        setDropHint(null);
                        setDragNotaId(null);
                        if (fromId) moveNota(fromId, item.id, edge);
                      }}
                    >
                      {isOwner ? (
                        <span className="inicio-paper__grip" aria-hidden="true" data-tooltip="Arrastrar">
                          <IconGrip size={14} />
                        </span>
                      ) : null}
                      <div className="inicio-paper__actions">
                        {(assigneesForDisplay(item).length > 0 || isOwner) && (
                          <span
                            className="inicio-paper__share"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <UserAvatarStack
                              users={assigneesForDisplay(item)}
                              size={20}
                              emptyLabel="Compartir"
                              disabled={reordering || !isOwner}
                              onClick={() => {
                                if (!isOwner) {
                                  toast.info("Solo el dueño puede cambiar quién tiene acceso");
                                  return;
                                }
                                setShareTarget(item);
                              }}
                            />
                          </span>
                        )}
                        <button
                          type="button"
                          className={`fl-icon-btn inicio-paper__pin-btn${item.pinned ? " is-active" : ""}`}
                          aria-label={item.pinned ? "Quitar pin" : "Fijar nota"}
                          data-tooltip={item.pinned ? "Quitar pin" : "Fijar al frente"}
                          disabled={reordering}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleNotaPinned(item);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <IconPin size={15} filled={item.pinned} />
                        </button>
                        {isOwner ? (
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--danger inicio-paper__delete"
                            aria-label="Eliminar nota"
                            data-tooltip="Eliminar nota"
                            disabled={busyId === item.id || reordering}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteId(item.id);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <IconTrash size={15} />
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="inicio-paper__open"
                        onClick={() => openNota(item)}
                        aria-label={`Abrir nota ${tituloVisible}`}
                      >
                        <h3
                          className={`inicio-paper__title${item.titulo.trim() ? "" : " inicio-paper__title--muted"}`}
                        >
                          {tituloVisible}
                        </h3>
                        {!isOwner && item.ownerNombre ? (
                          <p className="inicio-paper__owner">De {item.ownerNombre}</p>
                        ) : null}
                        {item.detalle.trim() ? (
                          <p className="inicio-paper__preview">{item.detalle}</p>
                        ) : (
                          <p className="inicio-paper__preview inicio-paper__preview--muted">Sin texto</p>
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {viewNota ? (
        <div
          className="inicio-nota-backdrop"
          role="presentation"
          onClick={() => void closeNotaModal()}
        >
          <div
            className={`inicio-nota-editor inicio-paper--${editColor}`}
            role="dialog"
            aria-modal="true"
            aria-label="Editar nota"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="inicio-nota-editor__top">
              <input
                className="inicio-nota-editor__title"
                value={editTitulo}
                onChange={(e) => setEditTitulo(e.target.value)}
                placeholder="Título"
                aria-label="Título de la nota"
              />
              <div className="inicio-nota-editor__top-actions">
                {viewNota.userId === myUserId && !isLocalInicioId(viewNota.id) ? (
                  <button
                    type="button"
                    className="inicio-nota-editor__icon-btn"
                    aria-label="Compartir nota"
                    data-tooltip="Compartir"
                    onClick={() => setShareTarget(viewNota)}
                  >
                    <IconUsers size={18} />
                  </button>
                ) : null}
                {!isLocalInicioId(viewNota.id) &&
                (assigneesForDisplay(viewNota).length > 0 || viewNota.userId === myUserId) ? (
                  <UserAvatarStack
                    users={assigneesForDisplay(viewNota)}
                    size={24}
                    emptyLabel="Compartir"
                    disabled={viewNota.userId !== myUserId}
                    onClick={() => {
                      if (viewNota.userId !== myUserId) return;
                      setShareTarget(viewNota);
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  className={`inicio-nota-editor__icon-btn${viewNota.pinned ? " is-active" : ""}`}
                  aria-label={viewNota.pinned ? "Quitar pin" : "Fijar nota"}
                  data-tooltip={viewNota.pinned ? "Quitar pin" : "Fijar al frente"}
                  onClick={() => void toggleNotaPinned(viewNota)}
                >
                  <IconPin size={20} filled={viewNota.pinned} />
                </button>
                <button
                  type="button"
                  className="inicio-nota-editor__icon-btn"
                  aria-label="Cerrar"
                  data-tooltip="Cerrar"
                  onClick={() => void closeNotaModal()}
                >
                  <IconX size={18} />
                </button>
              </div>
            </div>

            <textarea
              className="inicio-nota-editor__body"
              value={editDetalle}
              onChange={(e) => setEditDetalle(e.target.value)}
              placeholder="Escribí la nota…"
              aria-label="Texto de la nota"
            />

            <div className="inicio-nota-editor__toolbar">
              <NotaColorPicker
                value={editColor}
                onChange={(color) => changeNotaColor(viewNota.id, color)}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm inicio-nota-editor__save"
                disabled={
                  !(editTitulo.trim() || editDetalle.trim()) || busyId === viewNota.id
                }
                onClick={() => void closeNotaModal({ commit: true })}
              >
                {isLocalInicioId(viewNota.id) ? "Crear" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        open={viewTarea != null}
        title="Tarea"
        alert
        onClose={() => setViewTarea(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setViewTarea(null)}>
              Cerrar
            </button>
            {viewTarea && viewTarea.userId === myUserId ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const item = viewTarea;
                  setViewTarea(null);
                  openTareaModal(item);
                }}
              >
                Editar
              </button>
            ) : null}
          </>
        }
      >
        {viewTarea ? (
          (() => {
            const detalle = detalleSinContextoWa(viewTarea.detalle);
            const recAsociado = items.find(
              (it) => it.tipo === "recordatorio" && it.origenTareaId === viewTarea.id,
            );
            const asignados = assigneesForDetail(viewTarea);
            return (
              <div className="inicio-rec-alert inicio-rec-alert--view">
                <div className="inicio-rec-alert__meta">
                  <div className="inicio-rec-alert__meta-item">
                    <span
                      className={`inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--estado${
                        viewTarea.hecha ? " is-done" : ""
                      }`}
                      aria-hidden="true"
                    >
                      <IconCheck size={15} />
                    </span>
                    <span className="inicio-rec-alert__meta-copy">
                      <span className="inicio-rec-alert__meta-label">Estado</span>
                      <span className="inicio-rec-alert__meta-value">
                        {viewTarea.hecha ? "Hecha" : "Pendiente"}
                      </span>
                    </span>
                  </div>
                  {recAsociado ? (
                    <button
                      type="button"
                      className="inicio-rec-alert__meta-item inicio-rec-alert__meta-item--action"
                      onClick={() => {
                        setViewTarea(null);
                        openRecordatorioView(recAsociado);
                      }}
                    >
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--rec"
                        aria-hidden="true"
                      >
                        <IconClock size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">Recordatorio</span>
                        <span className="inicio-rec-alert__meta-value">
                          {formatItemFecha(recAsociado.fechaHora) ?? "Asociado"}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="inicio-rec-alert__meta-item">
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--rec"
                        aria-hidden="true"
                      >
                        <IconClock size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">Recordatorio</span>
                        <span className="inicio-rec-alert__meta-value">Sin asociar</span>
                      </span>
                    </div>
                  )}
                  {isFromWhatsApp(viewTarea) ? (
                    <button
                      type="button"
                      className="inicio-rec-alert__meta-item inicio-rec-alert__meta-item--full inicio-rec-alert__meta-item--wa inicio-rec-alert__meta-item--action"
                      title={waBadgeTooltip(viewTarea)}
                      data-tooltip={waBadgeTooltip(viewTarea)}
                      disabled={!String(viewTarea.whatsappContactId ?? "").trim()}
                      onClick={() => {
                        const contactId = String(viewTarea.whatsappContactId ?? "").trim();
                        if (!contactId) {
                          toast.info("No hay conversación vinculada");
                          return;
                        }
                        setViewTarea(null);
                        requestOpenWaContact(contactId);
                        onNavigate?.({ module: "whatsapp", section: "conversaciones" });
                      }}
                    >
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--wa"
                        aria-hidden="true"
                      >
                        <IconWhatsapp size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">WhatsApp</span>
                        <span className="inicio-rec-alert__meta-value">
                          {waDisplayName(viewTarea.whatsappContactLabel)}
                        </span>
                      </span>
                    </button>
                  ) : null}
                </div>
                <div className="inicio-rec-alert__body">
                  <p className="inicio-rec-alert__title">{viewTarea.titulo}</p>
                  {detalle ? (
                    <p className="inicio-rec-alert__detalle">{detalle}</p>
                  ) : (
                    <p className="inicio-rec-alert__detalle inicio-rec-alert__detalle--empty">
                      Sin detalle
                    </p>
                  )}
                  <AssigneesRow users={asignados} />
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>

      <Modal
        open={viewRec != null}
        title="Recordatorio"
        alert
        onClose={() => setViewRec(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setViewRec(null)}>
              Cerrar
            </button>
            {viewRec && viewRec.userId === myUserId ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const item = viewRec;
                  setViewRec(null);
                  openRecordatorioModal(item);
                }}
              >
                Editar
              </button>
            ) : null}
          </>
        }
      >
        {viewRec ? (
          (() => {
            const origenTarea = viewRec.origenTareaId
              ? items.find((it) => it.id === viewRec.origenTareaId) ?? null
              : null;
            const waSource =
              isFromWhatsApp(viewRec)
                ? viewRec
                : origenTarea && isFromWhatsApp(origenTarea)
                  ? origenTarea
                  : null;
            const detalle = detalleSinContextoWa(viewRec.detalle);
            const asignados = assigneesForDetail(viewRec);
            return (
              <div className="inicio-rec-alert inicio-rec-alert--view">
                <div className="inicio-rec-alert__meta">
                  {formatItemFechaAlert(viewRec.fechaHora) ? (
                    <div className="inicio-rec-alert__meta-item">
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--fecha"
                        aria-hidden="true"
                      >
                        <IconCalendar size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">Fecha</span>
                        <span className="inicio-rec-alert__meta-value">
                          {formatItemFechaAlert(viewRec.fechaHora)}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {formatItemSoloHora(viewRec.fechaHora) ? (
                    <div className="inicio-rec-alert__meta-item">
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--hora"
                        aria-hidden="true"
                      >
                        <IconClock size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">Hora</span>
                        <span className="inicio-rec-alert__meta-value">
                          {formatItemSoloHora(viewRec.fechaHora)} hs
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {formatRecurrenciaLabel(viewRec) ? (
                    <div className="inicio-rec-alert__meta-item inicio-rec-alert__meta-item--full">
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--repite"
                        aria-hidden="true"
                      >
                        <IconRefresh size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">Repite</span>
                        <span className="inicio-rec-alert__meta-value">
                          {formatRecurrenciaLabel(viewRec)}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {origenTarea ? (
                    <button
                      type="button"
                      className={`inicio-rec-alert__meta-item inicio-rec-alert__meta-item--action${
                        waSource ? "" : " inicio-rec-alert__meta-item--full"
                      }`}
                      onClick={() => {
                        setViewRec(null);
                        openTareaView(origenTarea);
                      }}
                    >
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--tarea"
                        aria-hidden="true"
                      >
                        <IconCheckSquare size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">Desde tarea</span>
                        <span className="inicio-rec-alert__meta-value inicio-rec-alert__meta-value--with-status">
                          <span className="inicio-rec-alert__meta-value-text">
                            {origenTarea.titulo}
                          </span>
                          <span
                            className={`inicio-rec-alert__status${
                              origenTarea.hecha ? " is-done" : " is-pending"
                            }`}
                          >
                            {origenTarea.hecha ? "Hecha" : "Pendiente"}
                          </span>
                        </span>
                      </span>
                    </button>
                  ) : viewRec.origenTareaId ? (
                    <div
                      className={`inicio-rec-alert__meta-item${
                        waSource ? "" : " inicio-rec-alert__meta-item--full"
                      }`}
                    >
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--tarea"
                        aria-hidden="true"
                      >
                        <IconCheckSquare size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">Desde tarea</span>
                        <span className="inicio-rec-alert__meta-value">
                          La tarea ya no está disponible
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {waSource ? (
                    <button
                      type="button"
                      className={`inicio-rec-alert__meta-item inicio-rec-alert__meta-item--wa inicio-rec-alert__meta-item--action${
                        origenTarea || viewRec.origenTareaId
                          ? ""
                          : " inicio-rec-alert__meta-item--full"
                      }`}
                      title={waBadgeTooltip(waSource)}
                      data-tooltip={waBadgeTooltip(waSource)}
                      disabled={!String(waSource.whatsappContactId ?? "").trim()}
                      onClick={() => {
                        const contactId = String(waSource.whatsappContactId ?? "").trim();
                        if (!contactId) {
                          toast.info("No hay conversación vinculada");
                          return;
                        }
                        setViewRec(null);
                        requestOpenWaContact(contactId);
                        onNavigate?.({ module: "whatsapp", section: "conversaciones" });
                      }}
                    >
                      <span
                        className="inicio-rec-alert__meta-icon inicio-rec-alert__meta-icon--wa"
                        aria-hidden="true"
                      >
                        <IconWhatsapp size={15} />
                      </span>
                      <span className="inicio-rec-alert__meta-copy">
                        <span className="inicio-rec-alert__meta-label">WhatsApp</span>
                        <span className="inicio-rec-alert__meta-value">
                          {waDisplayName(waSource.whatsappContactLabel)}
                        </span>
                      </span>
                    </button>
                  ) : null}
                </div>
                <div className="inicio-rec-alert__body">
                  <p className="inicio-rec-alert__title">{viewRec.titulo}</p>
                  {detalle ? (
                    <p className="inicio-rec-alert__detalle">{detalle}</p>
                  ) : (
                    <p className="inicio-rec-alert__detalle inicio-rec-alert__detalle--empty">
                      Sin detalle
                    </p>
                  )}
                  <AssigneesRow users={asignados} />
                </div>
              </div>
            );
          })()
        ) : null}
      </Modal>

      <Modal
        open={tareaModalOpen}
        wide
        title={editingTareaId ? "Editar tarea" : "Nueva tarea"}
        onClose={closeTareaModal}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={closeTareaModal}>
              Cancelar
            </button>
            <button
              type="submit"
              form="inicio-tarea-form"
              className="btn btn-primary"
              disabled={!tareaTitulo.trim() || tareaAssigneeIds.length === 0}
            >
              {editingTareaId ? "Guardar" : "Crear"}
            </button>
          </>
        }
      >
        <form
          id="inicio-tarea-form"
          className="form-grid"
          onSubmit={(e) => void guardarTarea(e)}
        >
          <div className="form-group form-group--full">
            <label htmlFor="tarea-titulo">Título</label>
            <input
              id="tarea-titulo"
              value={tareaTitulo}
              onChange={(e) => setTareaTitulo(e.target.value)}
              placeholder="Texto de la tarea"
              autoFocus
              required
            />
          </div>
          <div className="form-group form-group--full">
            <label htmlFor="tarea-detalle">Detalle</label>
            <textarea
              id="tarea-detalle"
              value={tareaDetalle}
              onChange={(e) => setTareaDetalle(e.target.value)}
              placeholder="Opcional"
              rows={4}
            />
          </div>
          <UserAssigneeField
            label="Asignar a"
            loading={directoryLoading}
            options={directory}
            selectedIds={tareaAssigneeIds}
            onChange={setTareaAssigneeIds}
            currentUserId={myUserId || undefined}
            currentUser={
              user
                ? { id: user.id, nombre: user.nombre, email: user.email }
                : null
            }
          />
        </form>
      </Modal>

      <Modal
        open={recordatorioOpen}
        wide
        title={
          editingRecId
            ? "Editar recordatorio"
            : convertFromTareaId
              ? "Convertir a recordatorio"
              : "Nuevo recordatorio"
        }
        onClose={closeRecordatorioModal}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeRecordatorioModal}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="inicio-recordatorio-form"
              className="btn btn-primary"
              disabled={
                !recTitulo.trim() ||
                (!recAvisoApp && !recAvisoEmail) ||
                recAssigneeIds.length === 0
              }
            >
              {editingRecId
                ? "Guardar"
                : convertFromTareaId
                  ? "Convertir"
                  : "Crear"}
            </button>
          </>
        }
      >
        <form
          id="inicio-recordatorio-form"
          className="form-grid inicio-rec-form"
          onSubmit={(e) => void guardarRecordatorio(e)}
        >
          <div className="form-group form-group--full">
            <label htmlFor="rec-titulo">Recordatorio</label>
            <input
              id="rec-titulo"
              value={recTitulo}
              onChange={(e) => {
                if (tituloRecBloqueado) return;
                setRecTitulo(e.target.value);
              }}
              placeholder="Qué recordar"
              autoFocus={!tituloRecBloqueado}
              required
              readOnly={tituloRecBloqueado}
              className={tituloRecBloqueado ? "is-readonly" : undefined}
              data-tooltip={
                tituloRecBloqueado
                  ? "El título viene de la tarea y no se puede cambiar"
                  : undefined
              }
            />
          </div>
          {!convertFromTareaId ? (
            <div className="form-group form-group--full">
              <label htmlFor="rec-detalle">Detalle</label>
              <textarea
                id="rec-detalle"
                value={recDetalle}
                onChange={(e) => setRecDetalle(e.target.value)}
                placeholder="Opcional"
                rows={3}
                autoFocus={tituloRecBloqueado}
              />
            </div>
          ) : null}
          <div className="form-group">
            <label htmlFor="rec-cuando-fecha">Fecha y hora</label>
            <DateTimePicker
              id="rec-cuando"
              fecha={recFecha}
              hora={recHora}
              onFechaChange={setRecFecha}
              onHoraChange={setRecHora}
              minFecha={fechaHoyIso()}
              aria-label="Fecha y hora del recordatorio"
            />
          </div>
          <div className="form-group">
            <label htmlFor="rec-recurrencia">Repetir</label>
            <select
              id="rec-recurrencia"
              value={recRecurrencia}
              onChange={(e) => setRecRecurrencia(e.target.value as InicioRecurrencia)}
            >
              <option value="none">{INICIO_RECURRENCIA_LABEL.none}</option>
              <option value="semanal">{INICIO_RECURRENCIA_LABEL.semanal}</option>
              <option value="mensual">{INICIO_RECURRENCIA_LABEL.mensual}</option>
              <option value="cada_n_dias">{INICIO_RECURRENCIA_LABEL.cada_n_dias}</option>
            </select>
          </div>
          {recRecurrencia === "cada_n_dias" ? (
            <div className="form-group form-group--full">
              <label htmlFor="rec-intervalo">Cada cuántos días</label>
              <input
                id="rec-intervalo"
                type="number"
                min={1}
                step={1}
                value={recIntervaloDias}
                onChange={(e) => setRecIntervaloDias(e.target.value)}
                placeholder="Ej. 3"
              />
            </div>
          ) : null}
          <div className="form-group form-group--full">
            <label>Avisar</label>
            <div className="inicio-aviso-options inicio-aviso-options--row" role="group" aria-label="Tipo de aviso">
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
            selectedIds={recAssigneeIds}
            onChange={setRecAssigneeIds}
            currentUserId={myUserId || undefined}
            currentUser={
              user
                ? { id: user.id, nombre: user.nombre, email: user.email }
                : null
            }
          />
        </form>
      </Modal>


      <InicioSharePicker
        open={shareTarget != null}
        title={
          shareTarget?.tipo === "tarea"
            ? "Asignar tarea"
            : shareTarget?.tipo === "recordatorio"
              ? "Asignar recordatorio"
              : "Compartir nota"
        }
        selectedIds={
          shareTarget ? assigneeIdsFromItem(shareTarget, myUserId) : []
        }
        excludeUserId={shareTarget?.tipo === "nota" ? myUserId : undefined}
        onClose={() => setShareTarget(null)}
        onSave={saveShare}
      />

      <ConfirmDialog
        open={deleteId != null}
        title="Eliminar"
        message="¿Seguro que querés eliminar este ítem?"
        confirmLabel="Eliminar"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
