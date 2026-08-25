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
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  celdasMesCalendario,
  compareYmd,
  fechaHoyIso,
  formatFechaInputLive,
  formatFechaYmd,
  parseFechaDdMmAaaa,
  parseYmd,
  rangoAniosCalendario,
} from "../lib/fechas";
import { IconCalendar } from "./Icons";
import "./DatePicker.css";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const MESES_ABREV = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

const DIAS_SEMANA = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"] as const;

const POPOVER_WIDTH = 320;
const POPOVER_COMPACT_MIN_WIDTH = 268;
const POPOVER_ESTIMATED_HEIGHT = 340;
const VIEWPORT_PAD = 8;

export interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  clearable?: boolean;
  compact?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}

interface PopoverCoords {
  top: number;
  left: number;
  width: number;
  placement: "below" | "above";
}

function mesInicial(value: string, min?: string): { year: number; month: number } {
  const parsed = value ? parseYmd(value) : null;
  if (parsed) return { year: parsed.getFullYear(), month: parsed.getMonth() };
  if (min) {
    const m = parseYmd(min);
    if (m) return { year: m.getFullYear(), month: m.getMonth() };
  }
  const hoy = parseYmd(fechaHoyIso())!;
  return { year: hoy.getFullYear(), month: hoy.getMonth() };
}

function calcularPosicionPopover(trigger: HTMLElement, compact = false): PopoverCoords {
  const rect = trigger.getBoundingClientRect();
  const minWidth = compact ? POPOVER_COMPACT_MIN_WIDTH : 280;
  const maxWidth = compact ? POPOVER_COMPACT_MIN_WIDTH : POPOVER_WIDTH;
  const estimatedHeight = compact ? 292 : POPOVER_ESTIMATED_HEIGHT;
  // Mismo ancho que el input (o el mínimo usable del calendario).
  const width = Math.min(maxWidth, Math.max(rect.width, minWidth));
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
  const spaceAbove = rect.top - VIEWPORT_PAD;
  const placement =
    spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? "above" : "below";

  let top = placement === "below" ? rect.bottom + 6 : rect.top - estimatedHeight - 6;
  // Alinear al borde derecho del campo para que no se salga a la derecha.
  let left = rect.right - width;
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  if (left + width > window.innerWidth - VIEWPORT_PAD) {
    left = window.innerWidth - width - VIEWPORT_PAD;
  }

  top = Math.max(
    VIEWPORT_PAD,
    Math.min(top, window.innerHeight - estimatedHeight - VIEWPORT_PAD),
  );

  return { top, left, width, placement };
}

function textoDesdeValor(value: string): string {
  return value ? formatFechaYmd(value) : "";
}

export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  clearable = false,
  compact = false,
  disabled = false,
  placeholder = "dd/mm/aaaa",
  className,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editandoRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const [{ year, month }, setView] = useState(() => mesInicial(value, min));
  const [inputText, setInputText] = useState(() => textoDesdeValor(value));
  const [inputInvalido, setInputInvalido] = useState(false);

  const hoy = fechaHoyIso();

  const { minYear, maxYear } = useMemo(() => rangoAniosCalendario(min, max), [min, max]);

  const opcionesAnio = useMemo(() => {
    const años: number[] = [];
    for (let y = maxYear; y >= minYear; y--) años.push(y);
    return años;
  }, [minYear, maxYear]);

  const celdas = useMemo(() => celdasMesCalendario(year, month), [year, month]);

  useEffect(() => {
    if (!editandoRef.current) {
      setInputText(textoDesdeValor(value));
      setInputInvalido(false);
    }
  }, [value]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    setCoords(calcularPosicionPopover(triggerRef.current, compact));
  }, [compact]);

  useEffect(() => {
    if (!open) return;
    setView(mesInicial(value, min));
  }, [open, value, min]);

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

  function isDisabled(iso: string): boolean {
    if (min && compareYmd(iso, min) < 0) return true;
    if (max && compareYmd(iso, max) > 0) return true;
    return false;
  }

  function seleccionar(iso: string) {
    if (isDisabled(iso)) return;
    onChange(iso);
    setInputText(textoDesdeValor(iso));
    setInputInvalido(false);
    editandoRef.current = false;
    setOpen(false);
  }

  function limpiar(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onChange("");
    setInputText("");
    setInputInvalido(false);
    editandoRef.current = false;
    setOpen(false);
  }

  function confirmarTexto(): boolean {
    const raw = inputText.trim();
    if (!raw) {
      if (clearable) {
        onChange("");
        setInputInvalido(false);
        return true;
      }
      setInputText(textoDesdeValor(value));
      setInputInvalido(false);
      return true;
    }

    const iso = parseFechaDdMmAaaa(raw);
    if (!iso || isDisabled(iso)) {
      setInputInvalido(true);
      return false;
    }

    onChange(iso);
    setInputText(textoDesdeValor(iso));
    setInputInvalido(false);
    const parsed = parseYmd(iso);
    if (parsed) setView({ year: parsed.getFullYear(), month: parsed.getMonth() });
    return true;
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    setInputInvalido(false);
    setInputText(formatFechaInputLive(e.target.value));
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
      if (confirmarTexto()) inputRef.current?.blur();
    }
    if (e.key === "Escape") {
      setInputText(textoDesdeValor(value));
      setInputInvalido(false);
      editandoRef.current = false;
      inputRef.current?.blur();
    }
  }

  function mesAnterior() {
    setView((v) =>
      v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 },
    );
  }

  function mesSiguiente() {
    setView((v) =>
      v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 },
    );
  }

  const puedeLimpiar = clearable && Boolean(value) && !disabled;
  const navMesAnteriorDisabled = year < minYear || (year === minYear && month === 0);
  const navMesSiguienteDisabled = year > maxYear || (year === maxYear && month === 11);

  const popover =
    open && !disabled && coords ? (
      <div
        ref={popoverRef}
        className={[
          "fl-date-picker__popover",
          "fl-date-picker__popover--portal",
          `fl-date-picker__popover--${coords.placement}`,
          compact ? "fl-date-picker__popover--compact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ top: coords.top, left: coords.left, width: coords.width }}
        role="dialog"
        aria-modal="false"
        aria-label={ariaLabel ?? "Calendario"}
      >
        <div className="fl-date-picker__header">
          <button
            type="button"
            className="fl-date-picker__nav"
            aria-label="Mes anterior"
            disabled={navMesAnteriorDisabled}
            onClick={mesAnterior}
          >
            ‹
          </button>
          <div className="fl-date-picker__selects">
            <select
              className="fl-date-picker__select"
              aria-label="Mes"
              value={month}
              onChange={(e) => setView((v) => ({ ...v, month: Number(e.target.value) }))}
            >
              {MESES.map((nombre, i) => (
                <option key={nombre} value={i} title={nombre}>
                  {MESES_ABREV[i]}
                </option>
              ))}
            </select>
            <select
              className="fl-date-picker__select"
              aria-label="Año"
              value={year}
              onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}
            >
              {opcionesAnio.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="fl-date-picker__nav"
            aria-label="Mes siguiente"
            disabled={navMesSiguienteDisabled}
            onClick={mesSiguiente}
          >
            ›
          </button>
        </div>

        <div className="fl-date-picker__weekdays">
          {DIAS_SEMANA.map((d) => (
            <span key={d} className="fl-date-picker__weekday">
              {d}
            </span>
          ))}
        </div>

        <div className="fl-date-picker__grid">
          {celdas.map((celda, i) => {
            if (!celda.iso || celda.day == null) return null;
            const selected = value === celda.iso;
            const today = celda.iso === hoy;
            const fuera = celda.fueraMes;
            const off = isDisabled(celda.iso);
            return (
              <button
                key={`${celda.iso}-${i}`}
                type="button"
                className={[
                  "fl-date-picker__day",
                  fuera ? " is-outside" : "",
                  today ? " is-today" : "",
                  selected ? " is-selected" : "",
                ].join("")}
                disabled={off}
                onClick={() => seleccionar(celda.iso!)}
              >
                {celda.day}
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={[
        "fl-date-picker",
        compact ? "fl-date-picker--compact" : "",
        disabled ? "is-disabled" : "",
        inputInvalido ? "is-invalid" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div ref={triggerRef} className="fl-date-picker__trigger">
        <input
          ref={inputRef}
          type="text"
          id={fieldId}
          className="fl-date-picker__field"
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          aria-invalid={inputInvalido}
          value={inputText}
          onChange={onInputChange}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          onKeyDown={onInputKeyDown}
        />
        <div className="fl-date-picker__actions">
          {puedeLimpiar && (
            <button
              type="button"
              className="fl-date-picker__icon-btn fl-date-picker__clear"
              aria-label="Quitar fecha"
              onClick={limpiar}
            >
              ×
            </button>
          )}
          <button
            type="button"
            className="fl-date-picker__icon-btn"
            aria-label="Abrir calendario"
            disabled={disabled}
            onClick={() => !disabled && setOpen((o) => !o)}
          >
            <IconCalendar size={compact ? 13 : 18} />
          </button>
        </div>
      </div>

      {popover && createPortal(popover, document.body)}
    </div>
  );
}
