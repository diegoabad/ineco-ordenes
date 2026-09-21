import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import { fechaHoyIso, parseYmd, toYmd } from "../lib/fechas";
import { notifyInicioItemsChanged, subscribeInicioItemsChanged } from "../lib/inicioEvents";
import {
  aceptarInicioRecordatorio,
  fetchInicioItems,
  notifyInicioRecordatorioEmail,
  updateInicioItem,
} from "../services/dataService";
import type { InicioItem } from "../types";
import { INICIO_RECURRENCIA_LABEL } from "../types";
import { DatePicker } from "./DatePicker";
import { IconCalendar, IconClock } from "./Icons";
import { Modal } from "./Modal";
import { TimePicker } from "./TimePicker";

const DEFAULT_REC_AHEAD_MS = 10 * 60 * 1000;
const POLL_MS = 15_000;

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
    /* Autoplay bloqueado o AudioContext no disponible. */
  }
}

/**
 * Vigila recordatorios con aviso en app en cualquier módulo (no solo Inicio).
 */
export function InicioRecordatorioWatcher() {
  const [now, setNow] = useState(() => new Date());
  const [recordatorios, setRecordatorios] = useState<InicioItem[]>([]);
  const [alertRec, setAlertRec] = useState<InicioItem | null>(null);
  const [posponerOpen, setPosponerOpen] = useState(false);
  const [posFecha, setPosFecha] = useState(() => defaultRecSchedule().fecha);
  const [posHora, setPosHora] = useState(() => defaultRecSchedule().hora);
  const [busy, setBusy] = useState(false);
  const emailNotifyRef = useRef<Set<string>>(new Set());
  const alertSoundPlayedRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const pendingReloadRef = useRef(false);

  async function reloadRecordatorios() {
    if (loadingRef.current) {
      pendingReloadRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      const data = await fetchInicioItems();
      setRecordatorios(data.filter((it) => it.tipo === "recordatorio"));
    } catch {
      /* silencioso: no molestar fuera de Inicio */
    } finally {
      loadingRef.current = false;
      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        void reloadRecordatorios();
      }
    }
  }

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), POLL_MS);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    void reloadRecordatorios();
    const poll = window.setInterval(() => void reloadRecordatorios(), POLL_MS);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => subscribeInicioItemsChanged(() => void reloadRecordatorios()), []);

  useEffect(() => {
    const due = recordatorios.filter((it) => isRecordatorioDue(it, now.getTime()));
    for (const item of due) {
      if (!item.avisoEmail || item.emailEnviadoAt) continue;
      if (emailNotifyRef.current.has(item.id)) continue;
      emailNotifyRef.current.add(item.id);
      void notifyInicioRecordatorioEmail(item.id)
        .then((next) => {
          setRecordatorios((prev) => prev.map((it) => (it.id === next.id ? next : it)));
          notifyInicioItemsChanged();
        })
        .catch(() => {
          emailNotifyRef.current.delete(item.id);
        });
    }

    if (alertRec) {
      const still = recordatorios.find((it) => it.id === alertRec.id);
      if (!still || still.tipo !== "recordatorio") {
        setAlertRec(null);
        setPosponerOpen(false);
      }
      return;
    }

    const nextAlert = due.find((it) => it.avisoApp);
    if (nextAlert) setAlertRec(nextAlert);
  }, [now, recordatorios, alertRec]);

  useEffect(() => {
    if (!alertRec) {
      alertSoundPlayedRef.current = null;
      return;
    }
    if (alertSoundPlayedRef.current === alertRec.id) return;
    alertSoundPlayedRef.current = alertRec.id;
    playRecordatorioChime();
  }, [alertRec?.id]);

  async function aceptarRecordatorioAlert() {
    if (!alertRec || busy) return;
    const id = alertRec.id;
    const previous = alertRec;
    const isRecurrente = (previous.recurrencia || "none") !== "none";
    setBusy(true);
    setAlertRec(null);
    setPosponerOpen(false);
    emailNotifyRef.current.delete(id);
    alertSoundPlayedRef.current = null;

    try {
      const result = await aceptarInicioRecordatorio(id);
      if (result.deleted || !result.item) {
        setRecordatorios((prev) => prev.filter((it) => it.id !== id));
      } else {
        setRecordatorios((prev) => prev.map((it) => (it.id === result.item!.id ? result.item! : it)));
      }
      notifyInicioItemsChanged();
    } catch (error) {
      if (!isRecurrente) {
        setRecordatorios((prev) =>
          prev.some((it) => it.id === previous.id) ? prev : [previous, ...prev],
        );
      }
      setAlertRec(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo aceptar el recordatorio");
    } finally {
      setBusy(false);
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
    if (!alertRec || busy) return;
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
    setBusy(true);
    setRecordatorios((prev) => prev.map((it) => (it.id === id ? optimistic : it)));
    emailNotifyRef.current.delete(id);
    setAlertRec(null);
    setPosponerOpen(false);
    try {
      const next = await updateInicioItem(id, { fechaHora });
      setRecordatorios((prev) => prev.map((it) => (it.id === next.id ? next : it)));
      notifyInicioItemsChanged();
    } catch (error) {
      setRecordatorios((prev) => prev.map((it) => (it.id === previous.id ? previous : it)));
      setAlertRec(previous);
      toast.error(error instanceof Error ? error.message : "No se pudo posponer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={alertRec != null && !posponerOpen}
        title="Recordatorio"
        onClose={() => undefined}
        hideClose
        alert
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={openPosponer}>
              Posponer
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void aceptarRecordatorioAlert()}
            >
              {busy
                ? "…"
                : alertRec?.recurrencia && alertRec.recurrencia !== "none"
                  ? "Listo"
                  : "Aceptar"}
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
                    <IconCalendar size={15} />
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
                    <IconClock size={15} />
                  </span>
                  <span className="inicio-rec-alert__meta-copy">
                    <span className="inicio-rec-alert__meta-label">Hora</span>
                    <span className="inicio-rec-alert__meta-value">
                      {formatItemSoloHora(alertRec.fechaHora)} hs
                    </span>
                  </span>
                </div>
              ) : null}
              {formatRecurrenciaLabel(alertRec) ? (
                <div className="inicio-rec-alert__meta-item inicio-rec-alert__meta-item--full">
                  <span className="inicio-rec-alert__meta-copy">
                    <span className="inicio-rec-alert__meta-label">Repite</span>
                    <span className="inicio-rec-alert__meta-value">
                      {formatRecurrenciaLabel(alertRec)}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
            <div className="inicio-rec-alert__body">
              <p className="inicio-rec-alert__title">{alertRec.titulo}</p>
              {alertRec.detalle.trim() ? (
                <p className="inicio-rec-alert__detalle">{alertRec.detalle.trim()}</p>
              ) : null}
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
              disabled={busy}
              onClick={() => setPosponerOpen(false)}
            >
              Volver
            </button>
            <button
              type="submit"
              form="inicio-posponer-form"
              className="btn btn-primary"
              disabled={busy}
            >
              {busy ? "Guardando…" : "Guardar"}
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
    </>
  );
}
