import { Fragment, useMemo, useState } from "react";
import {
  asignacionDe,
  formatPrecio,
  normalizarBusqueda,
  type GestionCatalogo,
  type GestionProfesionalConfig,
} from "../../lib/gestionProfesional";
import { IconSearch } from "../Icons";

type Props = {
  config: GestionProfesionalConfig;
  catalogo: GestionCatalogo;
  onEditar: (codigo: string) => void;
};

export function CuadroPrecios({ config, catalogo, onEditar }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [profesionalDoc, setProfesionalDoc] = useState("");

  const categorias = useMemo(
    () => [...config.categorias].sort((a, b) => a.orden - b.orden),
    [config.categorias],
  );
  const departamentos = useMemo(
    () => [...config.departamentos].sort((a, b) => a.orden - b.orden),
    [config.departamentos],
  );

  const nombres = useMemo(() => {
    const map = new Map(catalogo.tratamientos.map((t) => [t.codigo, t.nombre]));
    return (codigo: string) => map.get(codigo) || codigo;
  }, [catalogo.tratamientos]);

  const profesionalesVisibles = useMemo(() => {
    return catalogo.profesionales
      .map((prof) => ({ prof, asig: asignacionDe(config, prof.doc) }))
      .filter((row) => row.asig.visible);
  }, [catalogo.profesionales, config]);

  const profesional = profesionalesVisibles.find((row) => row.prof.doc === profesionalDoc) ?? null;
  const categoriaActiva = profesional?.asig.categoriaId ?? "";

  const gruposVisibles = useMemo(() => {
    const q = normalizarBusqueda(busqueda);
    return departamentos
      .filter((dep) => !departamentoId || dep.id === departamentoId)
      .map((dep) => ({
        dep,
        profesionales: profesionalesVisibles.filter((row) => row.asig.departamentoId === dep.id),
        filas: config.tratamientos
          .filter((t) => t.departamentoId === dep.id)
          .filter((t) => !q || normalizarBusqueda(`${t.codigo} ${nombres(t.codigo)}`).includes(q))
          .sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true })),
      }))
      .filter((grupo) => grupo.filas.length > 0);
  }, [busqueda, config.tratamientos, departamentoId, departamentos, nombres, profesionalesVisibles]);

  const columnas = 4 + categorias.length * 2;

  return (
    <section className="fl-table-card">
      <div className="table-toolbar table-toolbar--filters">
        <div className="table-search">
          <span className="table-search__icon" aria-hidden>
            <IconSearch size={16} />
          </span>
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar tratamiento…"
            aria-label="Buscar en el cuadro"
          />
        </div>
        <div className="form-group table-toolbar__month">
          <label htmlFor="gp-cuadro-dep">Departamento</label>
          <select
            id="gp-cuadro-dep"
            value={departamentoId}
            onChange={(e) => setDepartamentoId(e.target.value)}
          >
            <option value="">Todos</option>
            {departamentos.map((dep) => (
              <option key={dep.id} value={dep.id}>
                {dep.codigo ? `${dep.codigo} · ${dep.nombre}` : dep.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group table-toolbar__month">
          <label htmlFor="gp-cuadro-prof">Profesional</label>
          <select
            id="gp-cuadro-prof"
            value={profesionalDoc}
            onChange={(e) => {
              const doc = e.target.value;
              setProfesionalDoc(doc);
              const row = profesionalesVisibles.find((item) => item.prof.doc === doc);
              if (row?.asig.departamentoId) setDepartamentoId(row.asig.departamentoId);
            }}
          >
            <option value="">Todos</option>
            {profesionalesVisibles.map((row) => (
              <option key={row.prof.doc} value={row.prof.doc}>
                {row.prof.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="gp-leyenda-bar" aria-hidden>
          <span className="gp-leyenda gp-leyenda--1">1 cuota</span>
          <span className="gp-leyenda gp-leyenda--3">3 cuotas</span>
        </div>
      </div>

      <div className="table-wrap">
        {categorias.length === 0 || departamentos.length === 0 ? (
          <div className="fl-table-empty fl-table-empty--fill">
            <p className="fl-table-empty__title">El cuadro todavía no tiene columnas</p>
            <p className="fl-table-empty__hint">
              Creá al menos un departamento y una categoría. Después asigná los tratamientos.
            </p>
          </div>
        ) : gruposVisibles.length === 0 ? (
          <div className="fl-table-empty fl-table-empty--fill">
            <p className="fl-table-empty__title">No hay tratamientos en el cuadro</p>
            <p className="fl-table-empty__hint">
              En Tratamientos, elegí a qué departamento pertenece cada prestación de Busca turno.
            </p>
          </div>
        ) : (
          <table className="gp-table gp-cuadro">
            <thead>
              <tr>
                <th className="gp-sticky-cod" rowSpan={2}>
                  Código
                </th>
                <th className="gp-sticky-nom" rowSpan={2}>
                  Tratamiento
                </th>
                {categorias.map((cat) => (
                  <th
                    key={cat.id}
                    colSpan={2}
                    className={cat.id === categoriaActiva ? "is-hot" : undefined}
                  >
                    {cat.nombre}
                  </th>
                ))}
                <th rowSpan={2}>Valor de venta</th>
                <th rowSpan={2}>Precio de lista</th>
              </tr>
              <tr>
                {categorias.map((cat) => (
                  <Fragment key={cat.id}>
                    <th
                      className={`gp-subhead gp-subhead--1${cat.id === categoriaActiva ? " is-hot" : ""}`}
                    >
                      1 cuota
                    </th>
                    <th
                      className={`gp-subhead gp-subhead--3${cat.id === categoriaActiva ? " is-hot" : ""}`}
                    >
                      3 cuotas
                    </th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {gruposVisibles.map((grupo) => (
                <Fragment key={grupo.dep.id}>
                  <tr className="gp-area">
                    <td colSpan={columnas}>
                      <div className="gp-area__title">
                        {grupo.dep.codigo ? `${grupo.dep.codigo} · ${grupo.dep.nombre}` : grupo.dep.nombre}
                      </div>
                      {grupo.profesionales.length > 0 ? (
                        <div className="gp-area__pros">
                          {grupo.profesionales.map((row) => {
                            const cat = categorias.find((c) => c.id === row.asig.categoriaId);
                            return (
                              <span key={row.prof.doc}>
                                {row.prof.nombre}
                                {cat ? ` · ${cat.nombre}` : ""}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                  {grupo.filas.map((fila) => (
                    <tr
                      key={fila.codigo}
                      className="gp-fila"
                      onClick={() => onEditar(fila.codigo)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onEditar(fila.codigo);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Editar ${nombres(fila.codigo)}`}
                    >
                      <td className="gp-sticky-cod">
                        <strong>{fila.codigo}</strong>
                      </td>
                      <td className="gp-sticky-nom gp-wrap">{nombres(fila.codigo)}</td>
                      {categorias.map((cat) => {
                        const celda = fila.precios[cat.id];
                        const hot = cat.id === categoriaActiva ? " is-hot" : "";
                        return (
                          <Fragment key={cat.id}>
                            <td className={`gp-num gp-cell--1${celda?.una ? " has-value" : ""}${hot}`}>
                              {formatPrecio(celda?.una)}
                            </td>
                            <td className={`gp-num gp-cell--3${celda?.tres ? " has-value" : ""}${hot}`}>
                              {formatPrecio(celda?.tres)}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="gp-num">{formatPrecio(fila.valorVenta)}</td>
                      <td className="gp-num">{formatPrecio(fila.precioLista)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
