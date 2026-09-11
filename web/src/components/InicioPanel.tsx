import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import { fechaHoyIso, parseYmd, toYmd } from "../lib/fechas";
import {
  createInicioItem,
  deleteInicioItem,
  fetchInicioItems,
  notifyInicioRecordatorioEmail,
  reorderInicioItems,
  updateInicioItem,
} from "../services/dataService";
import type { InicioItem, InicioNotaColor } from "../types";
import { INICIO_NOTA_COLOR_LABEL, INICIO_NOTA_COLORES } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePicker } from "./DatePicker";
import {
  IconCalendar,
  IconCheck,
  IconClock,
  IconGrip,
  IconPencil,
  IconPin,
  IconPlus,
  IconTrash,
  IconX,
} from "./Icons";
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

/** Fecha corta dd/mm/aa para el modal de aviso. */
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

function isRecordatorioDue(item: InicioItem, nowMs = Date.now()): boolean {
  if (item.tipo !== "recordatorio" || !item.fechaHora) return false;
  const t = Date.parse(item.fechaHora);
  return Number.isFinite(t) && t <= nowMs;
}

/** Timbre tipo campana al abrir el aviso de recordatorio (Web Audio, sin archivo). */
function playRecordatorioChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    // Dos golpes de campana (fundamentales + armónicos).
    const strikes = [
      { at: 0, freqs: [523.25, 784.0, 1046.5], peak: 0.55 },
      { at: 0.42, freqs: [659.25, 987.75, 1318.5], peak: 0.48 },
    ];

    for (const strike of strikes) {
      strike.freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i === 0 ? "triangle" : "sine";
        osc.frequency.value = freq;
        const start = ctx.currentTime + strike.at;
        const peak = strike.peak * (i === 0 ? 1 : i === 1 ? 0.55 : 0.28);
        const dur = 1.05 - i * 0.12;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.05);
      });
    }

    void ctx.resume().finally(() => {
      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
      }, 1800);
    });
  } catch {
    // Autoplay bloqueado o AudioContext no disponible.
  }
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
};

/** Pantalla de entrada: tareas, recordatorios y notas personales. */
export function InicioPanel({ userName }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [items, setItems] = useState<InicioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tareaDraft, setTareaDraft] = useState("");
  const [editingTareaId, setEditingTareaId] = useState<string | null>(null);
  const [editTareaTitulo, setEditTareaTitulo] = useState("");
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
  const [alertRec, setAlertRec] = useState<InicioItem | null>(null);
  const [posponerOpen, setPosponerOpen] = useState(false);
  const [posFecha, setPosFecha] = useState(() => defaultRecSchedule().fecha);
  const [posHora, setPosHora] = useState(() => defaultRecSchedule().hora);
  const emailNotifyRef = useRef<Set<string>>(new Set());
  const alertSoundPlayedRef = useRef<string | null>(null);
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
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchInicioItems()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudieron cargar los ítems");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    const due = recordatorios.filter((it) => isRecordatorioDue(it, now.getTime()));
    for (const item of due) {
      if (!item.avisoEmail || item.emailEnviadoAt) continue;
      if (emailNotifyRef.current.has(item.id)) continue;
      emailNotifyRef.current.add(item.id);
      void notifyInicioRecordatorioEmail(item.id)
        .then((next) => {
          setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
        })
        .catch(() => {
          emailNotifyRef.current.delete(item.id);
        });
    }

    if (alertRec) {
      const still = items.find((it) => it.id === alertRec.id);
      if (!still || still.tipo !== "recordatorio") {
        setAlertRec(null);
        setPosponerOpen(false);
      }
      return;
    }

    const nextAlert = due.find((it) => it.avisoApp);
    if (nextAlert) setAlertRec(nextAlert);
  }, [now, recordatorios, alertRec, items]);

  useEffect(() => {
    if (!alertRec) {
      alertSoundPlayedRef.current = null;
      return;
    }
    if (alertSoundPlayedRef.current === alertRec.id) return;
    alertSoundPlayedRef.current = alertRec.id;
    playRecordatorioChime();
  }, [alertRec?.id]);

  async function persistNotasOrder(nextNotas: InicioItem[]) {
    setReordering(true);
    const previous = items;
    setItems((prev) => {
      const others = prev.filter((it) => it.tipo !== "nota");
      return [...others, ...nextNotas.map((it, index) => ({ ...it, orden: index }))];
    });
    try {
      const updated = await reorderInicioItems({
        tipo: "nota",
        ids: nextNotas.map((it) => it.id),
      });
      setItems((prev) => {
        const others = prev.filter((it) => it.tipo !== "nota");
        return [...others, ...updated];
      });
    } catch (error) {
      setItems(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo reordenar");
    } finally {
      setReordering(false);
    }
  }

  function moveNota(fromId: string, toId: string, edge: DropEdge) {
    if (reordering) return;
    const fromIndex = notas.findIndex((it) => it.id === fromId);
    const toIndex = notas.findIndex((it) => it.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;

    let insertIndex = edge === "after" ? toIndex + 1 : toIndex;
    if (fromIndex === insertIndex || fromIndex + 1 === insertIndex) return;

    const next = [...notas];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    if (fromIndex < insertIndex) insertIndex -= 1;
    next.splice(insertIndex, 0, moved);
    void persistNotasOrder(next);
  }

  async function persistTareasOrder(nextTareas: InicioItem[]) {
    setReordering(true);
    const previous = items;
    setItems((prev) => {
      const others = prev.filter((it) => it.tipo !== "tarea");
      return [...others, ...nextTareas.map((it, index) => ({ ...it, orden: index }))];
    });
    try {
      const updated = await reorderInicioItems({
        tipo: "tarea",
        ids: nextTareas.map((it) => it.id),
      });
      setItems((prev) => {
        const others = prev.filter((it) => it.tipo !== "tarea");
        return [...others, ...updated];
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
    const fromIndex = tareas.findIndex((it) => it.id === fromId);
    const toIndex = tareas.findIndex((it) => it.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;

    let insertIndex = edge === "after" ? toIndex + 1 : toIndex;
    if (fromIndex === insertIndex || fromIndex + 1 === insertIndex) return;

    const next = [...tareas];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    if (fromIndex < insertIndex) insertIndex -= 1;
    next.splice(insertIndex, 0, moved);
    void persistTareasOrder(next);
  }

  async function addTarea() {
    const texto = tareaDraft.trim();
    if (!texto || addingTareaRef.current) return;
    addingTareaRef.current = true;
    const tempId = `local-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const minOrden = tareas.reduce(
      (min, it) => Math.min(min, it.orden),
      Number.POSITIVE_INFINITY,
    );
    const optimistic: InicioItem = {
      id: tempId,
      tipo: "tarea",
      titulo: texto,
      detalle: "",
      fechaHora: null,
      hecha: false,
      orden: Number.isFinite(minOrden) ? minOrden - 1 : 0,
      color: "gris",
      avisoApp: false,
      avisoEmail: false,
      emailEnviadoAt: null,
      pinned: false,
      origenTareaId: null,
      userId: "",
      creadoAt: nowIso,
      actualizadoAt: nowIso,
    };
    setTareaDraft("");
    setItems((prev) => [optimistic, ...prev]);

    try {
      const item = await createInicioItem({
        tipo: "tarea",
        titulo: texto,
        detalle: "",
        fechaHora: null,
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
    }
    setRecordatorioOpen(true);
  }

  function closeRecordatorioModal() {
    if (savingRecRef.current) return;
    setRecordatorioOpen(false);
    setEditingRecId(null);
    setConvertFromTareaId(null);
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

    savingRecRef.current = true;
    const detalle = recDetalle.trim();
    const avisoApp = recAvisoApp;
    const avisoEmail = recAvisoEmail;
    const fromTareaId = convertFromTareaId;
    const editingId = editingRecId;
    const tituloLocked = tituloRecBloqueado;
    const fechaHora = when.toISOString();

    setRecordatorioOpen(false);
    setEditingRecId(null);
    setConvertFromTareaId(null);

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
                actualizadoAt: new Date().toISOString(),
              }
            : it,
        ),
      );
      if (alertRec?.id === editingId) {
        setAlertRec((prev) =>
          prev
            ? {
                ...prev,
                ...(tituloLocked ? {} : { titulo }),
                detalle,
                fechaHora,
                avisoApp,
                avisoEmail,
              }
            : prev,
        );
      }
      try {
        const item = await updateInicioItem(editingId, {
          ...(tituloLocked ? {} : { titulo }),
          detalle,
          fechaHora,
          avisoApp,
          avisoEmail,
        });
        setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
        if (alertRec?.id === item.id) setAlertRec(item);
      } catch (error) {
        if (previous) {
          setItems((prev) => prev.map((it) => (it.id === previous.id ? previous : it)));
          if (alertRec?.id === previous.id) setAlertRec(previous);
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
      pinned: false,
      origenTareaId: fromTareaId,
      userId: "",
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
        ...(fromTareaId ? { origenTareaId: fromTareaId } : {}),
      });
      setItems((prev) => {
        if (prev.some((it) => it.id === item.id)) {
          return prev.filter((it) => it.id !== tempId);
        }
        return prev.map((it) => (it.id === tempId ? item : it));
      });
    } catch (error) {
      setItems((prev) => prev.filter((it) => it.id !== tempId));
      toast.error(error instanceof Error ? error.message : "No se pudo crear el recordatorio");
    } finally {
      savingRecRef.current = false;
    }
  }

  async function aceptarRecordatorioAlert() {
    if (!alertRec) return;
    const id = alertRec.id;
    const previous = alertRec;
    setAlertRec(null);
    setPosponerOpen(false);
    setItems((prev) => prev.filter((it) => it.id !== id));
    emailNotifyRef.current.delete(id);
    if (isLocalInicioId(id)) {
      pendingCreatesRef.current.delete(id);
      return;
    }
    try {
      await deleteInicioItem(id);
    } catch (error) {
      setItems((prev) => (prev.some((it) => it.id === previous.id) ? prev : [previous, ...prev]));
      setAlertRec(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo aceptar el recordatorio");
    }
  }

  function openPosponer() {
    const schedule = defaultRecSchedule();
    setPosFecha(schedule.fecha);
    setPosHora(schedule.hora);
    setPosponerOpen(true);
  }

  async function confirmarPosponer(e: FormEvent) {
    e.preventDefault();
    if (!alertRec) return;
    const scheduleError = validateRecSchedule(posFecha, posHora);
    if (scheduleError) {
      toast.error(scheduleError);
      return;
    }
    const when = combineRecSchedule(posFecha, posHora);
    if (!when) {
      toast.error("Fecha u hora inválida");
      return;
    }
    const id = alertRec.id;
    const previous = alertRec;
    const fechaHora = when.toISOString();
    const optimistic = { ...alertRec, fechaHora, actualizadoAt: new Date().toISOString() };
    setItems((prev) => prev.map((it) => (it.id === id ? optimistic : it)));
    emailNotifyRef.current.delete(id);
    setAlertRec(null);
    setPosponerOpen(false);
    try {
      const next = await updateInicioItem(id, { fechaHora });
      setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
    } catch (error) {
      setItems((prev) => prev.map((it) => (it.id === previous.id ? previous : it)));
      setAlertRec(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo posponer");
    }
  }

  function crearNotaVacia() {
    const tempId = `local-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    const minOrden = notas.reduce(
      (min, it) => Math.min(min, it.orden),
      Number.POSITIVE_INFINITY,
    );
    const optimistic: InicioItem = {
      id: tempId,
      tipo: "nota",
      titulo: "",
      detalle: "",
      fechaHora: null,
      hecha: false,
      orden: Number.isFinite(minOrden) ? minOrden - 1 : 0,
      color: "gris",
      avisoApp: false,
      avisoEmail: false,
      emailEnviadoAt: null,
      pinned: false,
      origenTareaId: null,
      userId: "",
      creadoAt: nowIso,
      actualizadoAt: nowIso,
    };

    setItems((prev) => {
      const rest = prev.filter((it) => it.tipo !== "nota");
      const notasPrev = prev.filter((it) => it.tipo === "nota");
      return [...rest, optimistic, ...notasPrev];
    });
    setEditTitulo("");
    setEditDetalle("");
    setEditColor("gris");
    setViewNota(optimistic);

    const createPromise = createInicioItem({
      tipo: "nota",
      titulo: "",
      detalle: "",
      fechaHora: null,
      color: "gris",
    })
      .then((item) => {
        setItems((prev) => prev.map((it) => (it.id === tempId ? { ...item, color: it.color, pinned: it.pinned, titulo: it.titulo, detalle: it.detalle } : it)));
        setViewNota((prev) =>
          prev?.id === tempId
            ? {
                ...item,
                titulo: prev.titulo,
                detalle: prev.detalle,
                color: prev.color || item.color,
                pinned: prev.pinned,
              }
            : prev,
        );
        pendingCreatesRef.current.delete(tempId);
        return item;
      })
      .catch((error) => {
        pendingCreatesRef.current.delete(tempId);
        setItems((prev) => prev.filter((it) => it.id !== tempId));
        setViewNota((prev) => (prev?.id === tempId ? null : prev));
        toast.error(error instanceof Error ? error.message : "No se pudo crear la nota");
        throw error;
      });

    pendingCreatesRef.current.set(tempId, createPromise);
  }

  function openNota(item: InicioItem) {
    setEditTitulo(item.titulo);
    setEditDetalle(item.detalle);
    setEditColor(item.color || "gris");
    setViewNota(item);
  }

  async function closeNotaModal() {
    if (!viewNota) return;
    const titulo = editTitulo.trim();
    const detalle = editDetalle.trim();
    const dirty = titulo !== viewNota.titulo.trim() || detalle !== viewNota.detalle.trim();
    const closingId = viewNota.id;
    setViewNota(null);
    if (!dirty) return;

    setBusyId(closingId);
    try {
      const realId = await resolveNotaId(closingId);
      if (!realId) return;
      const next = await updateInicioItem(realId, { titulo, detalle });
      setItems((prev) =>
        prev.map((it) => (it.id === next.id || it.id === closingId ? next : it)),
      );
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

  function startEditTarea(item: InicioItem) {
    setEditingTareaId(item.id);
    setEditTareaTitulo(item.titulo);
  }

  function cancelEditTarea() {
    setEditingTareaId(null);
    setEditTareaTitulo("");
  }

  async function saveEditTarea(item: InicioItem) {
    const titulo = editTareaTitulo.trim();
    if (!titulo) {
      toast.error("El título es obligatorio");
      return;
    }
    if (titulo === item.titulo.trim()) {
      cancelEditTarea();
      return;
    }
    const previous = item.titulo;
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, titulo } : it)),
    );
    setEditingTareaId(null);
    setEditTareaTitulo("");
    try {
      const next = await updateInicioItem(item.id, { titulo });
      setItems((prev) => prev.map((it) => (it.id === next.id ? next : it)));
    } catch (error) {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, titulo: previous } : it)),
      );
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la tarea");
    }
  }

  function changeNotaColor(itemId: string, color: InicioNotaColor) {
    const req = ++colorReqRef.current;
    const previousColor = editColor;
    setEditColor(color);
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, color } : it)),
    );
    setViewNota((prev) => (prev?.id === itemId ? { ...prev, color } : prev));

    void (async () => {
      try {
        const realId = await resolveNotaId(itemId);
        if (!realId) throw new Error("No se pudo guardar el color");
        const next = await updateInicioItem(realId, { color });
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

  async function toggleNotaPinned(item: InicioItem) {
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
    setAlertRec((prev) => (prev?.id === id ? null : prev));
    setEditingTareaId((prev) => (prev === id ? null : prev));
    emailNotifyRef.current.delete(id);
    toast.success("Eliminado");

    if (isLocalInicioId(id)) {
      pendingCreatesRef.current.delete(id);
      return;
    }

    try {
      await deleteInicioItem(id);
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
                  const dropEdge =
                    dropHint?.id === item.id && dragTareaId && dragTareaId !== item.id
                      ? dropHint.edge
                      : null;
                  const editing = editingTareaId === item.id;
                  return (
                  <li
                    key={item.id}
                    className={`inicio-list__item inicio-list__item--tarea${item.hecha ? " is-done" : ""}${isDragging ? " is-dragging" : ""}${dropEdge === "before" ? " is-drop-before" : ""}${dropEdge === "after" ? " is-drop-after" : ""}`}
                    draggable={!reordering && !editing}
                    onDragStart={(e) => {
                      if (!dragTareaAllowedRef.current || editing) {
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
                      if (!dragTareaId) return;
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
                      data-tooltip="Arrastrar"
                      aria-hidden="true"
                      onPointerDown={() => {
                        if (!reordering && !editing) dragTareaAllowedRef.current = true;
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
                    {editing ? (
                      <input
                        className="inicio-list__edit"
                        value={editTareaTitulo}
                        onChange={(e) => setEditTareaTitulo(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveEditTarea(item);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEditTarea();
                          }
                        }}
                        autoFocus
                        aria-label="Editar tarea"
                      />
                    ) : (
                      <button
                        type="button"
                        className="inicio-list__title-btn"
                        onClick={() => startEditTarea(item)}
                      >
                        <span className="inicio-list__title inicio-list__title--ellipsis">
                          {item.titulo}
                        </span>
                      </button>
                    )}
                    <div className="inicio-list__actions">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--success"
                            aria-label="Guardar"
                            data-tooltip="Guardar"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void saveEditTarea(item)}
                          >
                            <IconCheck size={15} />
                          </button>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--danger"
                            aria-label="Cancelar"
                            data-tooltip="Cancelar"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => cancelEditTarea()}
                          >
                            <IconX size={15} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`fl-icon-btn${
                              yaConvertida ? " fl-icon-btn--muted" : " fl-icon-btn--success"
                            }`}
                            aria-label={
                              yaConvertida
                                ? "Ya tiene recordatorio (crear otro)"
                                : "Convertir a recordatorio"
                            }
                            data-tooltip={
                              yaConvertida
                                ? "Ya tiene recordatorio"
                                : "Convertir a recordatorio"
                            }
                              disabled={
                              busyId === item.id ||
                              reordering
                            }
                            onClick={() => openRecordatorioModal(item)}
                          >
                            <IconClock size={15} />
                          </button>
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--danger"
                            aria-label="Eliminar"
                            data-tooltip="Eliminar"
                            disabled={busyId === item.id || reordering}
                            onClick={() => setDeleteId(item.id)}
                          >
                            <IconTrash size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>

          <form
            className="inicio-composer"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void addTarea();
            }}
          >
            <input
              className="inicio-composer__input"
              value={tareaDraft}
              onChange={(e) => setTareaDraft(e.target.value)}
              placeholder="Agregar una tarea"
              aria-label="Agregar una tarea"
            />
            <button
              type="submit"
              className="btn btn-primary inicio-composer__btn"
              disabled={!tareaDraft.trim()}
              aria-label="Agregar"
            >
              <IconPlus size={16} />
            </button>
          </form>
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
                  const due = isRecordatorioDue(item, now.getTime());
                  return (
                    <li
                      key={item.id}
                      className={`inicio-list__item inicio-list__item--rec${due ? " is-due" : ""}`}
                    >
                      {fechaLabel ? (
                        <span className="inicio-list__meta inicio-list__meta--inline" data-tooltip={fechaLabel}>
                          {fechaLabel}
                        </span>
                      ) : null}
                      <span className="inicio-list__title inicio-list__title--ellipsis" data-tooltip={item.titulo}>
                        {item.titulo}
                      </span>
                      <div className="inicio-list__actions">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          aria-label="Editar"
                          data-tooltip="Editar"
                          disabled={busyId === item.id}
                          onClick={() => openRecordatorioModal(item)}
                        >
                          <IconPencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          aria-label="Eliminar"
                          data-tooltip="Eliminar"
                          disabled={busyId === item.id}
                          onClick={() => setDeleteId(item.id)}
                        >
                          <IconTrash size={15} />
                        </button>
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
                  const dropEdge =
                    dropHint?.id === item.id && dragNotaId !== item.id ? dropHint.edge : null;
                  const color = item.color || "gris";
                  return (
                    <article
                      key={item.id}
                      className={`inicio-paper inicio-paper--saved inicio-paper--${color}${item.pinned ? " is-pinned" : ""}${isDragging ? " is-dragging" : ""}${dropEdge === "before" ? " is-drop-before" : ""}${dropEdge === "after" ? " is-drop-after" : ""}`}
                      draggable={!reordering}
                      onDragStart={(e) => {
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
                      <span className="inicio-paper__grip" aria-hidden="true" data-tooltip="Arrastrar">
                        <IconGrip size={14} />
                      </span>
                      <div className="inicio-paper__actions">
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
            </div>
          </div>
        </div>
      ) : null}

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
              disabled={!recTitulo.trim() || (!recAvisoApp && !recAvisoEmail)}
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
          <div className="form-group">
            <label htmlFor="rec-fecha">Fecha</label>
            <DatePicker
              id="rec-fecha"
              value={recFecha}
              onChange={setRecFecha}
              min={fechaHoyIso()}
              placeholder="dd/mm/aaaa"
              aria-label="Fecha del recordatorio"
            />
          </div>
          <div className="form-group">
            <label htmlFor="rec-hora">Hora</label>
            <TimePicker
              id="rec-hora"
              value={recHora}
              onChange={setRecHora}
              fecha={recFecha}
              placeholder="hh:mm"
              aria-label="Hora del recordatorio"
            />
          </div>
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
        </form>
      </Modal>

      <Modal
        open={alertRec != null && !posponerOpen}
        title="Recordatorio"
        onClose={() => undefined}
        hideClose
        alert
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busyId === alertRec?.id}
              onClick={openPosponer}
            >
              Posponer
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busyId === alertRec?.id}
              onClick={() => void aceptarRecordatorioAlert()}
            >
              {busyId === alertRec?.id ? "…" : "Aceptar"}
            </button>
          </>
        }
      >
        {alertRec ? (
          <div className="inicio-rec-alert">
            <div className="inicio-rec-alert__meta">
              {formatItemFechaAlert(alertRec.fechaHora) ? (
                <div className="inicio-rec-alert__meta-item">
                  <span className="inicio-rec-alert__meta-icon" aria-hidden="true">
                    <IconCalendar size={18} />
                  </span>
                  <span className="inicio-rec-alert__meta-copy">
                    <span className="inicio-rec-alert__meta-label">Fecha</span>
                    <span className="inicio-rec-alert__meta-value">
                      {formatItemFechaAlert(alertRec.fechaHora)}
                    </span>
                  </span>
                </div>
              ) : null}
              {formatItemSoloHora(alertRec.fechaHora) ? (
                <div className="inicio-rec-alert__meta-item">
                  <span className="inicio-rec-alert__meta-icon" aria-hidden="true">
                    <IconClock size={18} />
                  </span>
                  <span className="inicio-rec-alert__meta-copy">
                    <span className="inicio-rec-alert__meta-label">Hora</span>
                    <span className="inicio-rec-alert__meta-value">
                      {formatItemSoloHora(alertRec.fechaHora)} hs
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
            <div className="inicio-rec-alert__body">
              <p className="inicio-rec-alert__title">{alertRec.titulo}</p>
              <p
                className={`inicio-rec-alert__detalle${
                  alertRec.detalle.trim() ? "" : " inicio-rec-alert__detalle--empty"
                }`}
              >
                {alertRec.detalle.trim() || "Sin detalle"}
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={alertRec != null && posponerOpen}
        wide
        title="Posponer recordatorio"
        onClose={() => undefined}
        hideClose
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busyId === alertRec?.id}
              onClick={() => setPosponerOpen(false)}
            >
              Volver
            </button>
            <button
              type="submit"
              form="inicio-posponer-form"
              className="btn btn-primary"
              disabled={busyId === alertRec?.id}
            >
              {busyId === alertRec?.id ? "Guardando…" : "Guardar"}
            </button>
          </>
        }
      >
        <form
          id="inicio-posponer-form"
          className="form-grid inicio-rec-form"
          onSubmit={(e) => void confirmarPosponer(e)}
        >
          <div className="form-group">
            <label htmlFor="pos-fecha">Nueva fecha</label>
            <DatePicker
              id="pos-fecha"
              value={posFecha}
              onChange={setPosFecha}
              min={fechaHoyIso()}
              placeholder="dd/mm/aaaa"
              aria-label="Nueva fecha"
            />
          </div>
          <div className="form-group">
            <label htmlFor="pos-hora">Nueva hora</label>
            <TimePicker
              id="pos-hora"
              value={posHora}
              onChange={setPosHora}
              fecha={posFecha}
              placeholder="hh:mm"
              aria-label="Nueva hora"
            />
          </div>
        </form>
      </Modal>

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
