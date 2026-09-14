import { DatePicker } from "./DatePicker";
import { TimePicker } from "./TimePicker";
import "./DateTimePicker.css";

export type DateTimePickerProps = {
  id?: string;
  fecha: string;
  hora: string;
  onFechaChange: (fecha: string) => void;
  onHoraChange: (hora: string) => void;
  minFecha?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

/** Fecha + hora en un solo control (mismos pickers internos). */
export function DateTimePicker({
  id,
  fecha,
  hora,
  onFechaChange,
  onHoraChange,
  minFecha,
  disabled,
  "aria-label": ariaLabel = "Fecha y hora",
}: DateTimePickerProps) {
  const fechaId = id ? `${id}-fecha` : undefined;
  const horaId = id ? `${id}-hora` : undefined;

  return (
    <div
      className={`fl-datetime-picker${disabled ? " is-disabled" : ""}`}
      aria-label={ariaLabel}
    >
      <div className="fl-datetime-picker__parts">
        <DatePicker
          id={fechaId}
          value={fecha}
          onChange={onFechaChange}
          min={minFecha}
          disabled={disabled}
          placeholder="dd/mm/aaaa"
          className="fl-datetime-picker__date"
          aria-label="Fecha"
        />
        <span className="fl-datetime-picker__sep" aria-hidden="true" />
        <TimePicker
          id={horaId}
          value={hora}
          onChange={onHoraChange}
          fecha={fecha}
          disabled={disabled}
          placeholder="hh:mm"
          className="fl-datetime-picker__time"
          aria-label="Hora"
        />
      </div>
    </div>
  );
}
