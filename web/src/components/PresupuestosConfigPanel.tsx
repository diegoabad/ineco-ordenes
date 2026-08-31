import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  formatProfesionalPresupuesto,
  TITULOS_PROFESIONAL_PRESUPUESTO,
} from "../lib/profesionalPresupuesto";
import { nextTipoColor, mergeMissingDefaultTipos } from "../lib/tipoPrestacion";
import { fetchPresupuestosConfig, savePresupuestosConfig } from "../services/dataService";
import {
  DEFAULT_MODALIDADES_PRESUPUESTO,
  DEFAULT_TIPOS_PRESTACION,
  type ModalidadPresupuesto,
  type ProfesionalPresupuesto,
  type TipoPrestacion,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconPlus, IconTrash } from "./Icons";
import { TipoPrestacionChip } from "./TipoPrestacionChip";

type Props = {
  onSaved?: () => void;
};

function newId(): string {
  return crypto.randomUUID();
}

type PendingDelete =
  | { kind: "tipo"; index: number; nombre: string }
  | { kind: "profesional"; id: string; label: string }
  | { kind: "modalidad"; id: string; label: string };

export function PresupuestosConfigPanel({ onSaved }: Props) {
  const [tipos, setTipos] = useState<TipoPrestacion[]>(DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t })));
  const [profesionales, setProfesionales] = useState<ProfesionalPresupuesto[]>([]);
  const [modalidades, setModalidades] = useState<ModalidadPresupuesto[]>(
    DEFAULT_MODALIDADES_PRESUPUESTO.map((m) => ({ ...m })),
  );
  const [nuevoTipo, setNuevoTipo] = useState("");
  const [nuevoColor, setNuevoColor] = useState(() => nextTipoColor(DEFAULT_TIPOS_PRESTACION));
  const [nuevoProfTitulo, setNuevoProfTitulo] = useState<string>(TITULOS_PROFESIONAL_PRESUPUESTO[0]!);
  const [nuevoProfNombre, setNuevoProfNombre] = useState("");
  const [nuevaModTitulo, setNuevaModTitulo] = useState("");
  const [nuevaModTexto, setNuevaModTexto] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const config = await fetchPresupuestosConfig();
        const { tipos: tiposMerged, changed } = mergeMissingDefaultTipos(config.tiposPrestacion);
        const modalidadesLoaded =
          config.modalidades?.length > 0
            ? config.modalidades
            : DEFAULT_MODALIDADES_PRESUPUESTO.map((m) => ({ ...m }));
        if (changed || !config.modalidades?.length) {
          const saved = await savePresupuestosConfig({
            tiposPrestacion: tiposMerged,
            profesionales: config.profesionales,
            modalidades: modalidadesLoaded,
          });
          setTipos(saved.tiposPrestacion);
          setProfesionales(saved.profesionales);
          setModalidades(saved.modalidades);
          setNuevoColor(nextTipoColor(saved.tiposPrestacion));
          onSaved?.();
          if (changed) toast.success("Tipos Evaluación y Tratamiento restaurados");
        } else {
          setTipos(config.tiposPrestacion);
          setProfesionales(config.profesionales);
          setModalidades(config.modalidades);
          setNuevoColor(nextTipoColor(config.tiposPrestacion));
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo cargar la configuración");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function persistConfig(
    nextTipos: TipoPrestacion[],
    nextProfesionales: ProfesionalPresupuesto[],
    nextModalidades: ModalidadPresupuesto[],
    okMessage?: string,
  ) {
    setSaving(true);
    try {
      const saved = await savePresupuestosConfig({
        tiposPrestacion: nextTipos,
        profesionales: nextProfesionales,
        modalidades: nextModalidades,
      });
      setTipos(saved.tiposPrestacion);
      setProfesionales(saved.profesionales);
      setModalidades(saved.modalidades);
      setNuevoColor(nextTipoColor(saved.tiposPrestacion));
      onSaved?.();
      if (okMessage) toast.success(okMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
      try {
        const config = await fetchPresupuestosConfig();
        setTipos(config.tiposPrestacion);
        setProfesionales(config.profesionales);
        setModalidades(
          config.modalidades?.length > 0
            ? config.modalidades
            : DEFAULT_MODALIDADES_PRESUPUESTO.map((m) => ({ ...m })),
        );
        setNuevoColor(nextTipoColor(config.tiposPrestacion));
      } catch {
        // El toast ya avisó; la lista queda como estaba en pantalla.
      }
    } finally {
      setSaving(false);
    }
  }

  async function agregarTipo() {
    const nombre = nuevoTipo.trim();
    if (!nombre) return;
    if (tipos.some((x) => x.nombre.toLowerCase() === nombre.toLowerCase())) {
      toast.warning("Ese tipo ya existe");
      return;
    }
    const next = [{ nombre, color: nuevoColor }, ...tipos];
    setNuevoTipo("");
    setNuevoColor(nextTipoColor(next));
    await persistConfig(next, profesionales, modalidades, "Tipo agregado");
  }

  function solicitarQuitarTipo(index: number) {
    if (tipos.length <= 1) {
      toast.warning("Debe quedar al menos un tipo");
      return;
    }
    const nombre = tipos[index]?.nombre;
    if (!nombre) return;
    setPendingDelete({ kind: "tipo", index, nombre });
  }

  async function confirmarQuitarTipo(index: number) {
    const next = tipos.filter((_, i) => i !== index);
    await persistConfig(next, profesionales, modalidades, "Tipo eliminado");
  }

  function solicitarQuitarProfesional(p: ProfesionalPresupuesto) {
    setPendingDelete({
      kind: "profesional",
      id: p.id,
      label: formatProfesionalPresupuesto(p),
    });
  }

  async function confirmarQuitarProfesional(id: string) {
    const next = profesionales.filter((p) => p.id !== id);
    await persistConfig(tipos, next, modalidades, "Profesional eliminado");
  }

  function solicitarQuitarModalidad(m: ModalidadPresupuesto) {
    if (modalidades.length <= 1) {
      toast.warning("Debe quedar al menos una modalidad");
      return;
    }
    setPendingDelete({ kind: "modalidad", id: m.id, label: m.titulo });
  }

  async function confirmarQuitarModalidad(id: string) {
    const next = modalidades.filter((m) => m.id !== id);
    await persistConfig(tipos, profesionales, next, "Modalidad eliminada");
  }

  async function confirmarEliminacion() {
    if (!pendingDelete) return;
    const pending = pendingDelete;
    setPendingDelete(null);
    if (pending.kind === "tipo") {
      await confirmarQuitarTipo(pending.index);
    } else if (pending.kind === "profesional") {
      await confirmarQuitarProfesional(pending.id);
    } else {
      await confirmarQuitarModalidad(pending.id);
    }
  }

  async function cambiarColor(index: number, color: string) {
    const next = tipos.map((t, i) => (i === index ? { ...t, color } : t));
    await persistConfig(next, profesionales, modalidades);
  }

  async function agregarProfesional() {
    const nombreApellido = nuevoProfNombre.trim();
    if (!nombreApellido) {
      toast.warning("Ingresá nombre y apellido");
      return;
    }
    const label = formatProfesionalPresupuesto({ titulo: nuevoProfTitulo, nombreApellido });
    if (
      profesionales.some(
        (p) => formatProfesionalPresupuesto(p).toLowerCase() === label.toLowerCase(),
      )
    ) {
      toast.warning("Ese profesional ya está en la lista");
      return;
    }
    const next = [
      { id: newId(), titulo: nuevoProfTitulo, nombreApellido },
      ...profesionales,
    ];
    setNuevoProfNombre("");
    await persistConfig(tipos, next, modalidades, "Profesional agregado");
  }

  async function actualizarProfesional(
    id: string,
    patch: Partial<Pick<ProfesionalPresupuesto, "titulo" | "nombreApellido">>,
  ) {
    const next = profesionales.map((p) => (p.id === id ? { ...p, ...patch } : p));
    setProfesionales(next);
    await persistConfig(tipos, next, modalidades);
  }

  async function agregarModalidad() {
    const titulo = nuevaModTitulo.trim();
    if (!titulo) {
      toast.warning("Ingresá el título de la modalidad");
      return;
    }
    if (modalidades.some((m) => m.titulo.toLowerCase() === titulo.toLowerCase())) {
      toast.warning("Esa modalidad ya existe");
      return;
    }
    const next = [
      { id: newId(), titulo, textoPdf: nuevaModTexto.trim() },
      ...modalidades,
    ];
    setNuevaModTitulo("");
    setNuevaModTexto("");
    await persistConfig(tipos, profesionales, next, "Modalidad agregada");
  }

  async function actualizarModalidad(
    id: string,
    patch: Partial<Pick<ModalidadPresupuesto, "titulo" | "textoPdf">>,
  ) {
    const next = modalidades.map((m) => (m.id === id ? { ...m, ...patch } : m));
    setModalidades(next);
    await persistConfig(tipos, profesionales, next);
  }

  if (loading) {
    return (
      <div className="fl-table-empty fl-table-empty--inline">
        <p className="fl-table-empty__title">Cargando configuración…</p>
      </div>
    );
  }

  return (
    <section className="presup-config-page">
      <div className="presup-config-page__scroll">
      <details className="presup-config-accordion">
        <summary className="presup-config-accordion__summary">
          <div className="presup-config-accordion__lead">
            <span className="presup-config-accordion__title">Profesionales</span>
            <span className="presup-config-accordion__hint">
              Precargados para elegir al armar presupuestos.
            </span>
          </div>
          <span className="presup-config-accordion__meta">{profesionales.length} profesional(es)</span>
        </summary>
        <div className="presup-config-accordion__body">
          {profesionales.length > 0 ? (
            <ul className="presup-config-list presup-config-list--profesionales">
              {profesionales.map((p) => (
                <li key={p.id} className="presup-config-list__item presup-config-list__item--prof">
                  <div className="presup-config-prof">
                    <div className="form-group presup-config-prof__titulo">
                      <label htmlFor={`prof-titulo-${p.id}`}>Título</label>
                      <select
                        id={`prof-titulo-${p.id}`}
                        value={p.titulo}
                        disabled={saving}
                        onChange={(e) => void actualizarProfesional(p.id, { titulo: e.target.value })}
                      >
                        {TITULOS_PROFESIONAL_PRESUPUESTO.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {(TITULOS_PROFESIONAL_PRESUPUESTO as readonly string[]).includes(p.titulo)
                          ? null
                          : p.titulo ? (
                            <option value={p.titulo}>{p.titulo}</option>
                          ) : null}
                      </select>
                    </div>
                    <div className="form-group presup-config-prof__nombre">
                      <label htmlFor={`prof-nombre-${p.id}`}>Nombre y apellido</label>
                      <input
                        id={`prof-nombre-${p.id}`}
                        type="text"
                        value={p.nombreApellido}
                        disabled={saving}
                        onChange={(e) =>
                          setProfesionales((prev) =>
                            prev.map((item) =>
                              item.id === p.id ? { ...item, nombreApellido: e.target.value } : item,
                            ),
                          )
                        }
                        onBlur={(e) =>
                          void actualizarProfesional(p.id, { nombreApellido: e.target.value.trim() })
                        }
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="fl-icon-btn fl-icon-btn--danger"
                    title="Quitar profesional"
                    disabled={saving}
                    onClick={() => solicitarQuitarProfesional(p)}
                  >
                    <IconTrash size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted presup-config-empty">Todavía no hay profesionales cargados.</p>
          )}
          <div className="presup-config-add presup-config-add--prof">
            <select
              value={nuevoProfTitulo}
              onChange={(e) => setNuevoProfTitulo(e.target.value)}
              aria-label="Título del profesional"
              disabled={saving}
            >
              {TITULOS_PROFESIONAL_PRESUPUESTO.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={nuevoProfNombre}
              onChange={(e) => setNuevoProfNombre(e.target.value)}
              placeholder="Nombre y apellido"
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void agregarProfesional();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void agregarProfesional()}
            >
              <IconPlus size={16} />
              Agregar
            </button>
          </div>
        </div>
      </details>

      <details className="presup-config-accordion">
        <summary className="presup-config-accordion__summary">
          <div className="presup-config-accordion__lead">
            <span className="presup-config-accordion__title">Modalidades</span>
            <span className="presup-config-accordion__hint">
              Título en el formulario y texto que va al PDF (dirección o “virtual”).
            </span>
          </div>
          <span className="presup-config-accordion__meta">{modalidades.length} modalidad(es)</span>
        </summary>
        <div className="presup-config-accordion__body">
          <ul className="presup-config-list presup-config-list--profesionales">
            {modalidades.map((m) => (
              <li key={m.id} className="presup-config-list__item presup-config-list__item--prof">
                <div className="presup-config-prof presup-config-prof--modalidad">
                  <div className="form-group presup-config-prof__titulo">
                    <label htmlFor={`mod-titulo-${m.id}`}>Título</label>
                    <input
                      id={`mod-titulo-${m.id}`}
                      type="text"
                      value={m.titulo}
                      disabled={saving}
                      onChange={(e) =>
                        setModalidades((prev) =>
                          prev.map((item) =>
                            item.id === m.id ? { ...item, titulo: e.target.value } : item,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void actualizarModalidad(m.id, { titulo: e.target.value.trim() })
                      }
                    />
                  </div>
                  <div className="form-group presup-config-prof__nombre">
                    <label htmlFor={`mod-texto-${m.id}`}>Texto en el PDF</label>
                    <input
                      id={`mod-texto-${m.id}`}
                      type="text"
                      value={m.textoPdf}
                      disabled={saving}
                      placeholder="Ej. dirección o modalidad virtual"
                      onChange={(e) =>
                        setModalidades((prev) =>
                          prev.map((item) =>
                            item.id === m.id ? { ...item, textoPdf: e.target.value } : item,
                          ),
                        )
                      }
                      onBlur={(e) =>
                        void actualizarModalidad(m.id, { textoPdf: e.target.value.trim() })
                      }
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="fl-icon-btn fl-icon-btn--danger"
                  title="Quitar modalidad"
                  disabled={modalidades.length <= 1 || saving}
                  onClick={() => solicitarQuitarModalidad(m)}
                >
                  <IconTrash size={15} />
                </button>
              </li>
            ))}
          </ul>
          <div className="presup-config-add presup-config-add--prof presup-config-add--modalidad">
            <input
              type="text"
              value={nuevaModTitulo}
              onChange={(e) => setNuevaModTitulo(e.target.value)}
              placeholder="Título, ej. Híbrida"
              disabled={saving}
              aria-label="Título de la modalidad"
            />
            <input
              type="text"
              value={nuevaModTexto}
              onChange={(e) => setNuevaModTexto(e.target.value)}
              placeholder="Texto para el PDF"
              disabled={saving}
              aria-label="Texto PDF de la modalidad"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void agregarModalidad();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void agregarModalidad()}
            >
              <IconPlus size={16} />
              Agregar
            </button>
          </div>
        </div>
      </details>

      <details className="presup-config-accordion">
        <summary className="presup-config-accordion__summary">
          <div className="presup-config-accordion__lead">
            <span className="presup-config-accordion__title">Tipos de prestación</span>
            <span className="presup-config-accordion__hint">
              Categorías para clasificar prestaciones.
            </span>
          </div>
          <span className="presup-config-accordion__meta">{tipos.length} tipo(s)</span>
        </summary>
        <div className="presup-config-accordion__body">
          <ul className="presup-config-list">
            {tipos.map((tipo, index) => (
              <li key={`${tipo.nombre}-${index}`} className="presup-config-list__item">
                <div className="presup-config-list__main">
                  <label className="presup-config-color" title="Color del tipo">
                    <input
                      type="color"
                      value={tipo.color}
                      disabled={saving}
                      onChange={(e) => void cambiarColor(index, e.target.value)}
                      aria-label={`Color de ${tipo.nombre}`}
                    />
                  </label>
                  <TipoPrestacionChip nombre={tipo.nombre} tipos={[tipo]} />
                </div>
                <button
                  type="button"
                  className="fl-icon-btn fl-icon-btn--danger"
                  title="Quitar tipo"
                  disabled={tipos.length <= 1 || saving}
                  onClick={() => solicitarQuitarTipo(index)}
                >
                  <IconTrash size={15} />
                </button>
              </li>
            ))}
          </ul>
          <div className="presup-config-add">
            <label className="presup-config-color presup-config-color--add" title="Color del nuevo tipo">
              <input
                type="color"
                value={nuevoColor}
                onChange={(e) => setNuevoColor(e.target.value)}
                aria-label="Color del nuevo tipo"
                disabled={saving}
              />
            </label>
            <input
              type="text"
              value={nuevoTipo}
              onChange={(e) => setNuevoTipo(e.target.value)}
              placeholder="Nuevo tipo, ej. Seguimiento"
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void agregarTipo();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => void agregarTipo()}
            >
              <IconPlus size={16} />
              Agregar
            </button>
          </div>
        </div>
      </details>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === "tipo"
            ? "Eliminar tipo de prestación"
            : pendingDelete?.kind === "profesional"
              ? "Eliminar profesional"
              : "Eliminar modalidad"
        }
        message={
          pendingDelete?.kind === "tipo"
            ? `¿Eliminar el tipo "${pendingDelete.nombre}"?`
            : pendingDelete?.kind === "profesional"
              ? `¿Eliminar a ${pendingDelete.label}?`
              : pendingDelete?.kind === "modalidad"
                ? `¿Eliminar la modalidad "${pendingDelete.label}"?`
                : ""
        }
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarEliminacion()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
