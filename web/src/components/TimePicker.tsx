import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { fechaHoyIso } from "../lib/fechas";
import { IconClock } from "./Icons";
import "./TimePicker.css";

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 260;
const VIEWPORT_PAD = 8;

export type TimePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Fecha YYYY-MM-DD: si es hoy, bloquea horas/minutos ya pasados. */
  fecha?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
};

type PopoverCoords = {
  top: number;
  left: number;
  width: number;
  placement: "below" | "above";
};

type MinTime = { h: number; m: number };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseHora(value: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return { h, m: min };
}

function formatHoraLive(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function minTimeForFecha(fecha: string | undefined, now = new Date()): MinTime | null {
  const ymd = fecha?.trim() || "";
  if (!ymd) return null;
  const hoy = fechaHoyIso();
  if (ymd > hoy) return null;
  if (ymd < hoy) return { h: 24, m: 0 };
  return { h: now.getHours(), m: now.getMinutes() };
}

function isMinutoPasado(h: number, m: number, min: MinTime | null): boolean {
  if (!min) return false;
  if (h < min.h) return true;
  if (h > min.h) return false;
  return m <= min.m;
}

function primeraHoraLibre(min: MinTime | null): { h: number; m: number } | null {
  if (!min) return null;
  let h = min.h;
  let m = min.m + 1;
  if (m > 59) {
    h += 1;
    m = 0;
  }
  if (h > 23) return null;
  return { h, m };
}

function calcularPosicion(trigger: HTMLElement): PopoverCoords {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, Math.max(rect.width, 240));
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
  const spaceAbove = rect.top - VIEWPORT_PAD;
  const placement =
    spaceBelow < POPOVER_HEIGHT && spaceAbove > spaceBelow ? "above" : "below";

  let top = placement === "below" ? rect.bottom + 6 : rect.top - POPOVER_HEIGHT - 6;
  let left = rect.left;
  if (left + width > window.innerWidth - VIEWPORT_PAD) {
    left = window.innerWidth - width - VIEWPORT_PAD;
  }
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  top = Math.max(
    VIEWPORT_PAD,
    Math.min(top, window.innerHeight - POPOVER_HEIGHT - VIEWPORT_PAD),
  );
  return { top, left, width, placement };
}

const HORAS = Array.from({ length: 24 }, (_, i) => i);
const MINUTOS = Array.from({ length: 60 }, (_, i) => i);

export function TimePicker({
  id,
  value,
  onChange,
  fecha,
  disabled = false,
  placeholder = "hh:mm",
  className,
  "aria-label": ariaLabel,
}: TimePickerProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const horasRef = useRef<HTMLDivElement>(null);
  const minutosRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editandoRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const [inputText, setInputText] = useState(value);
  const [inputInvalido, setInputInvalido] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  const parsed = useMemo(() => parseHora(value), [value]);
  const minTime = useMemo(() => minTimeForFecha(fecha, clock), [fecha, clock]);

  useEffect(() => {
    if (!editandoRef.current) {
      setInputText(value);
      setInputInvalido(false);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    setClock(new Date());
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    const p = parseHora(value);
    if (!p || !minTime) return;
    if (!isMinutoPasado(p.h, p.m, minTime)) return;
    const next = primeraHoraLibre(minTime);
    if (!next) return;
    const nextVal = `${pad2(next.h)}:${pad2(next.m)}`;
    if (nextVal === value) return;
    onChange(nextVal);
  }, [fecha, minTime, value, onChange]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    setCoords(calcularPosicion(triggerRef.current));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !parsed) return;
    const scrollSelected = (root: HTMLDivElement | null, index: number) => {
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`[data-index="${index}"]`);
      el?.scrollIntoView({ block: "center" });
    };
    requestAnimationFrame(() => {
      scrollSelected(horasRef.current, parsed.h);
      scrollSelected(minutosRef.current, parsed.m);
    });
  }, [open, parsed]);

  function aplicar(h: number, m: number) {
    let nextH = h;
    let nextM = m;
    if (isMinutoPasado(nextH, nextM, minTime)) {
      const free = primeraHoraLibre(minTime);
      if (!free) return;
      nextH = free.h;
      nextM = free.m;
    }
    const next = `${pad2(nextH)}:${pad2(nextM)}`;
    onChange(next);
    setInputText(next);
    setInputInvalido(false);
    editandoRef.current = false;
  }

  function confirmarTexto(): boolean {
    const raw = inputText.trim();
    if (!raw) {
      setInputText(value);
      setInputInvalido(false);
      return true;
    }
    const p = parseHora(raw.length === 4 && !raw.includes(":") ? formatHoraLive(raw) : raw);
    if (!p) {
      setInputInvalido(true);
      return false;
    }
    if (isMinutoPasado(p.h, p.m, minTime)) {
      setInputInvalido(true);
      return false;
    }
    aplicar(p.h, p.m);
    return true;
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    setInputInvalido(false);
    setInputText(formatHoraLive(e.target.value));
  }

  function onInputFocus(_e: FocusEvent<HTMLInputElement>) {
    editandoRef.current = true;
    setInputInvalido(false);
  }

  function onInputBlur() {
    editandoRef.current = false;
    confirmarTexto();
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (confirmarTexto()) {
        inputRef.current?.blur();
        setOpen(false);
      }
    }
    if (e.key === "Escape") {
      setInputText(value);
      setInputInvalido(false);
      editandoRef.current = false;
      inputRef.current?.blur();
      setOpen(false);
    }
  }

  const horaActiva = parsed?.h ?? 0;

  const popover =
    open && !disabled && coords ? (
      <div
        ref={popoverRef}
        className={[
          "fl-time-picker__popover",
          "fl-time-picker__popover--portal",
          `fl-time-picker__popover--${coords.placement}`,
        ].join(" ")}
        style={{ top: coords.top, left: coords.left, width: coords.width }}
        role="dialog"
        aria-modal="false"
        aria-label={ariaLabel ?? "Selector de hora"}
      >
        {minTime && fecha?.trim() === fechaHoyIso() ? (
          <p className="fl-time-picker__hint">Las horas pasadas de hoy no están disponibles</p>
        ) : null}
        <div className="fl-time-picker__cols">
          <div className="fl-time-picker__col">
            <div className="fl-time-picker__col-label">Hora</div>
            <div className="fl-time-picker__list" ref={horasRef} role="listbox" aria-label="Hora">
              {HORAS.map((h) => {
                const disabledHour =
                  minTime != null &&
                  (h < minTime.h || (h === minTime.h && minTime.m >= 59));
                return (
                  <button
                    key={h}
                    type="button"
                    data-index={h}
                    role="option"
                    aria-selected={parsed?.h === h}
                    aria-disabled={disabledHour}
                    disabled={disabledHour}
                    className={`fl-time-picker__option${parsed?.h === h ? " is-active" : ""}${disabledHour ? " is-disabled" : ""}`}
                    onClick={() => {
                      if (disabledHour) return;
                      const currentM = parsed?.m ?? 0;
                      if (isMinutoPasado(h, currentM, minTime)) {
                        const free = primeraHoraLibre(minTime);
                        if (!free) return;
                        aplicar(free.h, free.m);
                        return;
                      }
                      aplicar(h, currentM);
                    }}
                  >
                    {pad2(h)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="fl-time-picker__col">
            <div className="fl-time-picker__col-label">Min</div>
            <div
              className="fl-time-picker__list"
              ref={minutosRef}
              role="listbox"
              aria-label="Minutos"
            >
              {MINUTOS.map((m) => {
                const disabledMin = isMinutoPasado(horaActiva, m, minTime);
                return (
                  <button
                    key={m}
                    type="button"
                    data-index={m}
                    role="option"
                    aria-selected={parsed?.m === m}
                    aria-disabled={disabledMin}
                    disabled={disabledMin}
                    className={`fl-time-picker__option${parsed?.m === m ? " is-active" : ""}${disabledMin ? " is-disabled" : ""}`}
                    onClick={() => {
                      if (disabledMin) return;
                      aplicar(horaActiva, m);
                    }}
                  >
                    {pad2(m)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="fl-time-picker__footer">
          <button
            type="button"
            className="btn btn-primary fl-time-picker__ok"
            onClick={() => setOpen(false)}
          >
            Listo
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={[
        "fl-time-picker",
        disabled ? "is-disabled" : "",
        inputInvalido ? "is-invalid" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div ref={triggerRef} className="fl-time-picker__trigger">
        <input
          ref={inputRef}
          id={fieldId}
          className="fl-time-picker__field"
          value={inputText}
          onChange={onInputChange}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          aria-label={ariaLabel ?? "Hora"}
          aria-invalid={inputInvalido || undefined}
        />
        <div className="fl-time-picker__actions">
          <button
            type="button"
            className="fl-time-picker__icon-btn"
            disabled={disabled}
            aria-label="Abrir selector de hora"
            aria-expanded={open}
            onClick={() => {
              if (disabled) return;
              setClock(new Date());
              setOpen((v) => !v);
            }}
          >
            <IconClock size={16} />
          </button>
        </div>
      </div>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
