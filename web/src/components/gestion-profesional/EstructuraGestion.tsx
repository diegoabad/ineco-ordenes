import { useMemo, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import {
  AREAS_EJEMPLO,
  CATEGORIAS_EJEMPLO,
  normalizarBusqueda,
  nuevoId,
  type GestionCategoria,
  type GestionDepartamento,
  type GestionProfesionalConfig,
} from "../../lib/gestionProfesional";
import { ConfirmDialog } from "../ConfirmDialog";
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "../Icons";

type Props = {
  config: GestionProfesionalConfig;
  onChange: (next: GestionProfesionalConfig) => void;
};

function ordenar<T extends { orden: number; nombre: string }>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"))
    .map((item, index) => ({ ...item, orden: index }));
}

function mover<T extends { id: string; orden: number; nombre: string }>(
  items: T[],
  id: string,
  direccion: -1 | 1,
): T[] {
  const lista = ordenar(items);
  const index = lista.findIndex((item) => item.id === id);
  const destino = index + direccion;
  if (index < 0 || destino < 0 || destino >= lista.length) return lista;
  const copia = [...lista];
  const actual = copia[index]!;
  copia[index] = copia[destino]!;
  copia[destino] = actual;
  return copia.map((item, i) => ({ ...item, orden: i }));
}

export function DepartamentosGestion({ config, onChange }: Props) {
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [borrar, setBorrar] = useState<GestionDepartamento | null>(null);
  const departamentos = useMemo(
    () => ordenar(config.departamentos),
    [config.departamentos],
  );

  function agregar(event: FormEvent) {
    event.preventDefault();
    const limpio = nombre.trim().replace(/\s+/g, " ");
    if (!limpio) {
      toast.error("Escribí el nombre del departamento");
      return;
    }
    const ya = departamentos.some(
      (d) => normalizarBusqueda(d.nombre) === normalizarBusqueda(limpio),
    );
    if (ya) {
      toast.error("Ya hay un departamento con ese nombre");
      return;
    }
    const codigoLimpio = codigo.trim().toUpperCase().replace(/\s+/g, "");
    onChange({
      ...config,
      departamentos: [
        ...departamentos,
        {
          id: nuevoId(),
          nombre: limpio,
          codigo: codigoLimpio,
          orden: departamentos.length,
        },
      ],
    });
    setNombre("");
    setCodigo("");
  }

  function cargarEjemplo() {
    const existentes = new Set(departamentos.map((d) => normalizarBusqueda(d.codigo)));
    const nuevos = AREAS_EJEMPLO.filter((a) => !existentes.has(normalizarBusqueda(a.codigo)));
    if (nuevos.length === 0) {
      toast.info("Esas áreas ya están cargadas");
      return;
    }
    onChange({
      ...config,
      departamentos: [
        ...departamentos,
        ...nuevos.map((area, index) => ({
          id: nuevoId(),
          nombre: area.nombre,
          codigo: area.codigo,
          orden: departamentos.length + index,
        })),
      ],
    });
  }

  function confirmarBorrado() {
    if (!borrar) return;
    const id = borrar.id;
    onChange({
      ...config,
      departamentos: ordenar(departamentos.filter((d) => d.id !== id)),
      profesionales: config.profesionales
        .map((p) => (p.departamentoId === id ? { ...p, departamentoId: "" } : p))
        .filter((p) => p.visible || p.categoriaId || p.departamentoId),
      tratamientos: config.tratamientos.map((t) =>
        t.departamentoId === id ? { ...t, departamentoId: "" } : t,
      ),
    });
    setBorrar(null);
  }

  return (
    <>
      <section className="fl-table-card">
        <form className="table-toolbar gp-inline-form" onSubmit={agregar}>
          <div className="form-group">
            <label htmlFor="gp-dep-nombre">Departamento</label>
            <input
              id="gp-dep-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Fonoaudiología, Infanto…"
              maxLength={80}
            />
          </div>
          <div className="form-group gp-inline-form__corto">
            <label htmlFor="gp-dep-codigo">Código</label>
            <input
              id="gp-dep-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="FONO"
              maxLength={12}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            <IconPlus size={16} />
            Agregar
          </button>
          <button type="button" className="btn btn-secondary" onClick={cargarEjemplo}>
            Cargar áreas de la planilla
          </button>
        </form>

        <div className="table-wrap">
          {departamentos.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">Todavía no hay departamentos</p>
              <p className="fl-table-empty__hint">
                Creá áreas como Fonoaudiología o Infanto. El código es el que se ve en el cuadro,
                por ejemplo FONO.
              </p>
            </div>
          ) : (
            <table className="gp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Departamento</th>
                  <th className="gp-col-orden">Orden</th>
                  <th className="fl-col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {departamentos.map((dep, index) => (
                  <tr key={dep.id}>
                    <td>
                      <strong>{dep.codigo || "—"}</strong>
                    </td>
                    <td>{dep.nombre}</td>
                    <td>
                      <div className="gp-orden">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          aria-label={`Subir ${dep.nombre}`}
                          disabled={index === 0}
                          onClick={() =>
                            onChange({
                              ...config,
                              departamentos: mover(departamentos, dep.id, -1),
                            })
                          }
                        >
                          <IconChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn"
                          aria-label={`Bajar ${dep.nombre}`}
                          disabled={index === departamentos.length - 1}
                          onClick={() =>
                            onChange({
                              ...config,
                              departamentos: mover(departamentos, dep.id, 1),
                            })
                          }
                        >
                          <IconChevronDown size={16} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="fl-icon-btn fl-icon-btn--danger"
                        aria-label={`Eliminar ${dep.nombre}`}
                        onClick={() => setBorrar(dep)}
                      >
                        <IconTrash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={borrar != null}
        title="Eliminar departamento"
        message={
          borrar
            ? `Se va a quitar «${borrar.nombre}». Los profesionales y tratamientos que lo usen quedan sin área. Los precios se conservan.`
            : ""
        }
        confirmLabel="Eliminar"
        onConfirm={confirmarBorrado}
        onCancel={() => setBorrar(null)}
      />
    </>
  );
}

export function CategoriasGestion({ config, onChange }: Props) {
  const [nombre, setNombre] = useState("");
  const [borrar, setBorrar] = useState<GestionCategoria | null>(null);
  const categorias = useMemo(() => ordenar(config.categorias), [config.categorias]);

  function agregar(event: FormEvent) {
    event.preventDefault();
    const limpio = nombre.trim().replace(/\s+/g, " ");
    if (!limpio) {
      toast.error("Escribí el nombre de la categoría");
      return;
    }
    const ya = categorias.some(
      (c) => normalizarBusqueda(c.nombre) === normalizarBusqueda(limpio),
    );
    if (ya) {
      toast.error("Ya hay una categoría con ese nombre");
      return;
    }
    onChange({
      ...config,
      categorias: [...categorias, { id: nuevoId(), nombre: limpio, orden: categorias.length }],
    });
    setNombre("");
  }

  function cargarEjemplo() {
    const existentes = new Set(categorias.map((c) => normalizarBusqueda(c.nombre)));
    const nuevos = CATEGORIAS_EJEMPLO.filter((nombreCat) => !existentes.has(normalizarBusqueda(nombreCat)));
    if (nuevos.length === 0) {
      toast.info("Esas categorías ya están cargadas");
      return;
    }
    onChange({
      ...config,
      categorias: [
        ...categorias,
        ...nuevos.map((nombreCat, index) => ({
          id: nuevoId(),
          nombre: nombreCat,
          orden: categorias.length + index,
        })),
      ],
    });
  }

  function confirmarBorrado() {
    if (!borrar) return;
    const id = borrar.id;
    onChange({
      ...config,
      categorias: ordenar(categorias.filter((c) => c.id !== id)),
      profesionales: config.profesionales
        .map((p) => (p.categoriaId === id ? { ...p, categoriaId: "" } : p))
        .filter((p) => p.visible || p.categoriaId || p.departamentoId),
      tratamientos: config.tratamientos.map((t) => {
        if (!t.precios[id]) return t;
        const precios = { ...t.precios };
        delete precios[id];
        return { ...t, precios };
      }),
    });
    setBorrar(null);
  }

  return (
    <>
      <section className="fl-table-card">
        <form className="table-toolbar gp-inline-form" onSubmit={agregar}>
          <div className="form-group">
            <label htmlFor="gp-cat-nombre">Categoría</label>
            <input
              id="gp-cat-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Jefe, S. Senior, Senior, Staff…"
              maxLength={80}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            <IconPlus size={16} />
            Agregar
          </button>
          <button type="button" className="btn btn-secondary" onClick={cargarEjemplo}>
            Cargar Jefe, S. Senior, Senior y Staff
          </button>
        </form>

        <div className="table-wrap">
          {categorias.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">Todavía no hay categorías</p>
              <p className="fl-table-empty__hint">
                Cada categoría es una columna del cuadro. El verde es el precio en 1 cuota y el
                azul, en 3 cuotas.
              </p>
            </div>
          ) : (
            <table className="gp-table">
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th className="gp-col-orden">Orden</th>
                  <th className="fl-col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((cat, index) => (
                  <tr key={cat.id}>
                    <td>{cat.nombre}</td>
                    <td>
                      <div className="gp-orden">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          aria-label={`Subir ${cat.nombre}`}
                          disabled={index === 0}
                          onClick={() =>
                            onChange({ ...config, categorias: mover(categorias, cat.id, -1) })
                          }
                        >
                          <IconChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn"
                          aria-label={`Bajar ${cat.nombre}`}
                          disabled={index === categorias.length - 1}
                          onClick={() =>
                            onChange({ ...config, categorias: mover(categorias, cat.id, 1) })
                          }
                        >
                          <IconChevronDown size={16} />
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="fl-icon-btn fl-icon-btn--danger"
                        aria-label={`Eliminar ${cat.nombre}`}
                        onClick={() => setBorrar(cat)}
                      >
                        <IconTrash size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={borrar != null}
        title="Eliminar categoría"
        message={
          borrar
            ? `Se va a quitar «${borrar.nombre}» de los profesionales y del cuadro de precios.`
            : ""
        }
        confirmLabel="Eliminar"
        onConfirm={confirmarBorrado}
        onCancel={() => setBorrar(null)}
      />
    </>
  );
}
