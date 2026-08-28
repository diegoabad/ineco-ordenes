import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  formatProfesionalPresupuesto,
  TITULOS_PROFESIONAL_PRESUPUESTO,
} from "../lib/profesionalPresupuesto";
import { fetchPresupuestosConfig, savePresupuestosConfig } from "../services/dataService";
import type { ProfesionalPresupuesto } from "../types";
import { IconCheck, IconSearch, IconX } from "./Icons";

type Props = {
  id?: string;
  value: string;
  profesionales: ProfesionalPresupuesto[];
  disabled?: boolean;
  onChange: (value: string) => void;
  onProfesionalesChange?: (profesionales: ProfesionalPresupuesto[]) => void;
  onCreatingChange?: (creating: boolean) => void;
};

function newProfesionalId(): string {
  return crypto.randomUUID();
}

export function ProfesionalPresupuestoField({
  id: idProp,
  value,
  profesionales,
  disabled = false,
  onChange,
  onProfesionalesChange,
  onCreatingChange,
}: Props) {
  const reactId = useId();
  const inputId = idProp ?? `presup-prof-${reactId}`;
  const listId = `${inputId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState(value);
  const [creating, setCreating] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState<string>(TITULOS_PROFESIONAL_PRESUPUESTO[0]!);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [savingProf, setSavingProf] = useState(false);

  useEffect(() => {
    onCreatingChange?.(creating);
  }, [creating, onCreatingChange]);

  useEffect(() => {
    if (!focused && !creating) {
      setQuery(value);
    }
  }, [value, focused, creating]);

  useEffect(() => {
    if (!focused) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        inputRef.current?.blur();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [focused]);

  const opciones = useMemo(() => {
    const items = profesionales.map((p) => ({
      id: p.id,
      label: formatProfesionalPresupuesto(p),
    }));
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [profesionales, query]);

  function seleccionar(label: string) {
    onChange(label);
    setQuery(label);
    setCreating(false);
    setFocused(false);
  }

  function iniciarCreacion(prefill = "") {
    setCreating(true);
    setFocused(false);
    setNuevoTitulo(TITULOS_PROFESIONAL_PRESUPUESTO[0]!);
    setNuevoNombre(prefill.trim());
  }

  function cancelarCreacion() {
    setCreating(false);
    setNuevoNombre("");
    setQuery(value);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function agregarProfesional() {
    const nombreApellido = nuevoNombre.trim();
    if (!nombreApellido) {
      toast.warning("Ingresá nombre y apellido");
      return;
    }
    const label = formatProfesionalPresupuesto({ titulo: nuevoTitulo, nombreApellido });
    if (
      profesionales.some(
        (p) => formatProfesionalPresupuesto(p).toLowerCase() === label.toLowerCase(),
      )
    ) {
      toast.warning("Ese profesional ya existe");
      seleccionar(label);
      return;
    }

    setSavingProf(true);
    try {
      const config = await fetchPresupuestosConfig();
      const nextProfesionales: ProfesionalPresupuesto[] = [
        { id: newProfesionalId(), titulo: nuevoTitulo, nombreApellido },
        ...config.profesionales,
      ];
      const saved = await savePresupuestosConfig({
        tiposPrestacion: config.tiposPrestacion,
        profesionales: nextProfesionales,
        modalidades: config.modalidades,
      });
      onProfesionalesChange?.(saved.profesionales);
      seleccionar(label);
      setNuevoNombre("");
      toast.success("Profesional agregado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo agregar el profesional");
    } finally {
      setSavingProf(false);
    }
  }

  function limpiarSeleccion() {
    onChange("");
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const listOpen = focused && !disabled;

  if (creating) {
    return (
      <div className="prof-combobox prof-combobox--create" ref={rootRef}>
        <div className="prof-combobox-create">
          <select
            id={`${inputId}-titulo`}
            value={nuevoTitulo}
            disabled={disabled || savingProf}
            aria-label="Título del profesional"
            onChange={(e) => setNuevoTitulo(e.target.value)}
          >
            {TITULOS_PROFESIONAL_PRESUPUESTO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            id={`${inputId}-nuevo-nombre`}
            type="text"
            value={nuevoNombre}
            disabled={disabled || savingProf}
            placeholder="Nombre y apellido"
            aria-label="Nombre y apellido"
            autoFocus
            onChange={(e) => setNuevoNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void agregarProfesional();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelarCreacion();
              }
            }}
          />
          <button
            type="button"
            className="fl-icon-btn fl-icon-btn--success"
            disabled={disabled || savingProf}
            aria-label="Agregar profesional"
            title="Agregar"
            onClick={() => void agregarProfesional()}
          >
            <IconCheck size={16} />
          </button>
          <button
            type="button"
            className="fl-icon-btn fl-icon-btn--danger"
            disabled={disabled || savingProf}
            aria-label="Cancelar"
            title="Cancelar"
            onClick={cancelarCreacion}
          >
            <IconX size={16} />
          </button>
        </div>
      </div>
    );
  }

  const tieneSeleccion = value.trim().length > 0;

  return (
    <div className={`prof-combobox${listOpen ? " is-open" : ""}`} ref={rootRef}>
      <div
        className={`prof-combobox__input-wrap table-search${tieneSeleccion ? " has-value" : ""}`}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".table-search__icon")) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <span className="table-search__icon" aria-hidden>
          <IconSearch size={16} />
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={query}
          placeholder="Buscar o elegir profesional…"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) onChange("");
          }}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (rootRef.current?.contains(e.relatedTarget as Node)) return;
            setFocused(false);
            setQuery(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(value);
            }
          }}
        />
        {tieneSeleccion && !disabled ? (
          <button
            type="button"
            className="prof-combobox__clear fl-icon-btn"
            aria-label="Quitar profesional"
            title="Quitar"
            onMouseDown={(e) => e.preventDefault()}
            onClick={limpiarSeleccion}
          >
            <IconX size={14} />
          </button>
        ) : null}
      </div>
      {listOpen ? (
        <ul id={listId} className="prof-combobox__list" role="listbox">
          <li className="prof-combobox__sticky">
            <button
              type="button"
              className="prof-combobox__option prof-combobox__option--create"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => iniciarCreacion(query)}
            >
              Crear profesional…
            </button>
          </li>
          {opciones.length > 0 ? <li className="prof-combobox__divider" aria-hidden /> : null}
          {opciones.length === 0 ? (
            query.trim() ? (
              <li className="prof-combobox__empty">Sin coincidencias</li>
            ) : null
          ) : (
            opciones.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.label === value}
                  className={`prof-combobox__option${item.label === value ? " is-selected" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => seleccionar(item.label)}
                >
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {value &&
      !profesionales.some((p) => formatProfesionalPresupuesto(p) === value) ? (
        <p className="text-muted prof-combobox__legacy">Profesional guardado: {value}</p>
      ) : null}
    </div>
  );
}
