import { useMemo, useState } from "react";
import { useClientPagination } from "../../hooks/useClientPagination";
import {
  asignacionDe,
  guardarProfesional,
  normalizarBusqueda,
  type GestionCatalogo,
  type GestionProfesionalConfig,
} from "../../lib/gestionProfesional";
import { IconSearch } from "../Icons";
import { TablePagination } from "../TablePagination";

type Props = {
  config: GestionProfesionalConfig;
  catalogo: GestionCatalogo;
  onChange: (next: GestionProfesionalConfig) => void;
};

type Filtro = "todos" | "visibles";

export function ProfesionalesGestion({ config, catalogo, onChange }: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [verInactivos, setVerInactivos] = useState(false);

  const departamentos = useMemo(
    () => [...config.departamentos].sort((a, b) => a.orden - b.orden),
    [config.departamentos],
  );
  const categorias = useMemo(
    () => [...config.categorias].sort((a, b) => a.orden - b.orden),
    [config.categorias],
  );

  const filas = useMemo(() => {
    const q = normalizarBusqueda(busqueda);
    return catalogo.profesionales.filter((prof) => {
      const asig = asignacionDe(config, prof.doc);
      const usado = asig.visible || Boolean(asig.categoriaId || asig.departamentoId);
      if (!prof.enabled && !verInactivos && !usado) return false;
      if (filtro === "visibles" && !asig.visible) return false;
      if (!q) return true;
      return normalizarBusqueda(`${prof.nombre} ${prof.sede} ${prof.doc}`).includes(q);
    });
  }, [busqueda, catalogo.profesionales, config, filtro, verInactivos]);

  const { page, setPage, pageItems, total, pageSize } = useClientPagination(
    filas,
    `${busqueda}|${filtro}|${verInactivos}`,
  );

  const huerfanos = config.profesionales.filter(
    (p) => !catalogo.profesionales.some((c) => c.doc === p.doc),
  );

  const visibles = config.profesionales.filter((p) => p.visible).length;

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
            placeholder="Buscar profesional…"
            aria-label="Buscar profesional"
          />
        </div>
        <div className="form-group table-toolbar__month">
          <label htmlFor="gp-prof-filtro">Mostrar</label>
          <select
            id="gp-prof-filtro"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
          >
            <option value="todos">Todos</option>
            <option value="visibles">Los que aparecen ({visibles})</option>
          </select>
        </div>
        <label className="gp-checkline">
          <input
            type="checkbox"
            checked={verInactivos}
            onChange={(e) => setVerInactivos(e.target.checked)}
          />
          Ver los apagados en Busca turno
        </label>
      </div>

      {huerfanos.length > 0 ? (
        <p className="gp-note">
          {huerfanos.length === 1
            ? "Hay 1 profesional guardado que ya no está en Busca turno."
            : `Hay ${huerfanos.length} profesionales guardados que ya no están en Busca turno.`}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              onChange({
                ...config,
                profesionales: config.profesionales.filter((p) =>
                  catalogo.profesionales.some((c) => c.doc === p.doc),
                ),
              })
            }
          >
            Quitarlos
          </button>
        </p>
      ) : null}

      <div className="table-wrap">
        {catalogo.profesionales.length === 0 ? (
          <div className="fl-table-empty fl-table-empty--fill">
            <p className="fl-table-empty__title">No hay profesionales en Busca turno</p>
            <p className="fl-table-empty__hint">
              Abrí Busca turno y cargá el catálogo. Acá se usa esa misma lista.
            </p>
          </div>
        ) : filas.length === 0 ? (
          <div className="fl-table-empty fl-table-empty--fill">
            <p className="fl-table-empty__title">Nadie coincide con la búsqueda</p>
          </div>
        ) : (
          <table className="gp-table">
            <thead>
              <tr>
                <th className="gp-col-check">Aparece</th>
                <th>Profesional</th>
                <th>Sede</th>
                <th>Categoría</th>
                <th>Departamento</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((prof) => {
                const asig = asignacionDe(config, prof.doc);
                return (
                  <tr key={prof.doc} className={asig.visible ? "is-selected" : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={asig.visible}
                        aria-label={`${prof.nombre} aparece en el cuadro`}
                        onChange={(e) =>
                          onChange(
                            guardarProfesional(config, { ...asig, visible: e.target.checked }),
                          )
                        }
                      />
                    </td>
                    <td>
                      <span className="gp-nombre">{prof.nombre}</span>
                      {!prof.enabled ? <span className="gp-chip">Apagado en Busca turno</span> : null}
                    </td>
                    <td>{prof.sede || "—"}</td>
                    <td>
                      <select
                        aria-label={`Categoría de ${prof.nombre}`}
                        value={asig.categoriaId}
                        onChange={(e) =>
                          onChange(
                            guardarProfesional(config, { ...asig, categoriaId: e.target.value }),
                          )
                        }
                      >
                        <option value="">Sin categoría</option>
                        {categorias.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        aria-label={`Departamento de ${prof.nombre}`}
                        value={asig.departamentoId}
                        onChange={(e) =>
                          onChange(
                            guardarProfesional(config, {
                              ...asig,
                              departamentoId: e.target.value,
                            }),
                          )
                        }
                      >
                        <option value="">Sin departamento</option>
                        {departamentos.map((dep) => (
                          <option key={dep.id} value={dep.id}>
                            {dep.codigo ? `${dep.codigo} · ${dep.nombre}` : dep.nombre}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
    </section>
  );
}
