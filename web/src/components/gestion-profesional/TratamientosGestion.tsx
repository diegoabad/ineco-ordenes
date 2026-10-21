import { useEffect, useMemo, useRef, useState } from "react";
import { useClientPagination } from "../../hooks/useClientPagination";
import {
  formatMoneyInputDisplay,
  formatMoneyInputWhileTyping,
  parseMoneyInput,
} from "../../lib/moneyInput";
import {
  guardarTratamiento,
  normalizarBusqueda,
  preciosCargados,
  tratamientoDe,
  type GestionCatalogo,
  type GestionPrecioCategoria,
  type GestionProfesionalConfig,
  type GestionTratamiento,
} from "../../lib/gestionProfesional";
import { IconPencil, IconSearch } from "../Icons";
import { Modal } from "../Modal";
import { TablePagination } from "../TablePagination";

type Props = {
  config: GestionProfesionalConfig;
  catalogo: GestionCatalogo;
  onChange: (next: GestionProfesionalConfig) => void;
  edicion: { codigo: string; nonce: number } | null;
};

type Filtro = "todos" | "asignados" | "sin";

function CampoPrecio({
  value,
  tone,
  label,
  onChange,
}: {
  value: number | null;
  tone: "una" | "tres" | "plain";
  label: string;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(() => formatMoneyInputDisplay(value ?? 0));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatMoneyInputDisplay(value ?? 0));
  }, [value, focused]);

  return (
    <input
      className={`gp-precio-input gp-precio-input--${tone}`}
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      placeholder="0"
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = parseMoneyInput(text);
        onChange(parsed > 0 ? parsed : null);
        setText(formatMoneyInputDisplay(parsed));
      }}
      onChange={(e) => {
        const next = formatMoneyInputWhileTyping(e.target.value);
        setText(next);
        const parsed = parseMoneyInput(next);
        onChange(parsed > 0 ? parsed : null);
      }}
    />
  );
}

function conPrecio(
  tratamiento: GestionTratamiento,
  categoriaId: string,
  campo: keyof GestionPrecioCategoria,
  valor: number | null,
): GestionTratamiento {
  const actual = tratamiento.precios[categoriaId] ?? { una: null, tres: null };
  const celda = { ...actual, [campo]: valor };
  const precios = { ...tratamiento.precios };
  if (celda.una == null && celda.tres == null) delete precios[categoriaId];
  else precios[categoriaId] = celda;
  return { ...tratamiento, precios };
}

export function TratamientosGestion({
  config,
  catalogo,
  onChange,
  edicion,
}: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [departamentoId, setDepartamentoId] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [editando, setEditando] = useState<GestionTratamiento | null>(null);
  const edicionVista = useRef(0);

  const departamentos = useMemo(
    () => [...config.departamentos].sort((a, b) => a.orden - b.orden),
    [config.departamentos],
  );
  const categorias = useMemo(
    () => [...config.categorias].sort((a, b) => a.orden - b.orden),
    [config.categorias],
  );

  const nombreDe = useMemo(() => {
    const map = new Map(catalogo.tratamientos.map((t) => [t.codigo, t.nombre]));
    return (codigo: string) => map.get(codigo) || codigo;
  }, [catalogo.tratamientos]);

  useEffect(() => {
    if (!edicion || edicion.nonce === edicionVista.current) return;
    edicionVista.current = edicion.nonce;
    setEditando(tratamientoDe(config, edicion.codigo));
  }, [config, edicion]);

  const filas = useMemo(() => {
    const q = normalizarBusqueda(busqueda);
    const delCatalogo = catalogo.tratamientos.filter((trat) => {
      const guardado = tratamientoDe(config, trat.codigo);
      const asignado = Boolean(guardado.departamentoId);
      if (departamentoId && guardado.departamentoId !== departamentoId) return false;
      if (filtro === "asignados" && !asignado) return false;
      if (filtro === "sin" && asignado) return false;
      if (!trat.enabled && !verInactivos && !asignado && filtro !== "asignados") return false;
      if (!q) return true;
      return normalizarBusqueda(`${trat.codigo} ${trat.nombre}`).includes(q);
    });
    return delCatalogo;
  }, [busqueda, catalogo.tratamientos, config, departamentoId, filtro, verInactivos]);

  const { page, setPage, pageItems, total, pageSize } = useClientPagination(
    filas,
    `${busqueda}|${filtro}|${departamentoId}|${verInactivos}`,
  );

  function aplicarEdicion() {
    if (!editando) return;
    onChange(guardarTratamiento(config, editando));
    setEditando(null);
  }

  return (
    <>
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
              placeholder="Buscar por código o nombre…"
              aria-label="Buscar tratamiento"
            />
          </div>
          <div className="form-group table-toolbar__month">
            <label htmlFor="gp-trat-filtro">Estado</label>
            <select
              id="gp-trat-filtro"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value as Filtro)}
            >
              <option value="todos">Todos</option>
              <option value="asignados">Con departamento</option>
              <option value="sin">Sin departamento</option>
            </select>
          </div>
          <div className="form-group table-toolbar__month">
            <label htmlFor="gp-trat-dep">Departamento</label>
            <select
              id="gp-trat-dep"
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
          <label className="gp-checkline">
            <input
              type="checkbox"
              checked={verInactivos}
              onChange={(e) => setVerInactivos(e.target.checked)}
            />
            Ver los apagados en Busca turno
          </label>
        </div>

        <div className="table-wrap">
          {catalogo.tratamientos.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">No hay tratamientos en Busca turno</p>
              <p className="fl-table-empty__hint">
                Las prestaciones salen del catálogo de Busca turno. Cargalo ahí y volvé a esta pantalla.
              </p>
            </div>
          ) : filas.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">Nada coincide con el filtro</p>
            </div>
          ) : (
            <table className="gp-table">
              <thead>
                <tr>
                  <th className="gp-col-cod">Código</th>
                  <th>Tratamiento</th>
                  <th>Departamento</th>
                  <th>Precios</th>
                  <th className="fl-col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((trat) => {
                  const guardado = tratamientoDe(config, trat.codigo);
                  const dep = departamentos.find((d) => d.id === guardado.departamentoId);
                  const cargados = preciosCargados(guardado);
                  return (
                    <tr key={trat.codigo}>
                      <td>
                        <strong>{trat.codigo}</strong>
                      </td>
                      <td>
                        <span className="gp-nombre">{trat.nombre}</span>
                        {!trat.enabled ? (
                          <span className="gp-chip">Apagado en Busca turno</span>
                        ) : null}
                      </td>
                      <td>
                        <select
                          aria-label={`Departamento de ${trat.nombre}`}
                          value={guardado.departamentoId}
                          onChange={(e) =>
                            onChange(
                              guardarTratamiento(config, {
                                ...guardado,
                                departamentoId: e.target.value,
                              }),
                            )
                          }
                        >
                          <option value="">Sin departamento</option>
                          {departamentos.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.codigo ? `${item.codigo} · ${item.nombre}` : item.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{dep ? (cargados > 0 ? `${cargados} categorías` : "Sin precios") : "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--edit"
                          aria-label={`Editar precios de ${trat.nombre}`}
                          onClick={() => setEditando(guardado)}
                        >
                          <IconPencil size={16} />
                        </button>
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

      <Modal
        open={editando != null}
        title={editando ? nombreDe(editando.codigo) : "Precios"}
        wide
        className="gp-precios-modal"
        onClose={() => setEditando(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setEditando(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={aplicarEdicion}>
              Aplicar
            </button>
          </>
        }
      >
        {editando ? (
          <div className="gp-precios">
            <p className="gp-precios__codigo">Código {editando.codigo}</p>
            <div className="form-group">
              <label htmlFor="gp-edit-dep">Departamento</label>
              <select
                id="gp-edit-dep"
                value={editando.departamentoId}
                onChange={(e) =>
                  setEditando({ ...editando, departamentoId: e.target.value })
                }
              >
                <option value="">Sin departamento</option>
                {departamentos.map((dep) => (
                  <option key={dep.id} value={dep.id}>
                    {dep.codigo ? `${dep.codigo} · ${dep.nombre}` : dep.nombre}
                  </option>
                ))}
              </select>
            </div>

            {categorias.length === 0 ? (
              <p className="gp-precios__vacio">
                Primero creá categorías. Cada una es una columna del cuadro.
              </p>
            ) : (
              <table className="gp-precio-grid">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th className="gp-leyenda gp-leyenda--1">1 cuota</th>
                    <th className="gp-leyenda gp-leyenda--3">3 cuotas</th>
                  </tr>
                </thead>
                <tbody>
                  {categorias.map((cat) => {
                    const celda = editando.precios[cat.id] ?? { una: null, tres: null };
                    return (
                      <tr key={cat.id}>
                        <td>{cat.nombre}</td>
                        <td>
                          <CampoPrecio
                            tone="una"
                            label={`${cat.nombre}, 1 cuota`}
                            value={celda.una}
                            onChange={(valor) =>
                              setEditando(conPrecio(editando, cat.id, "una", valor))
                            }
                          />
                        </td>
                        <td>
                          <CampoPrecio
                            tone="tres"
                            label={`${cat.nombre}, 3 cuotas`}
                            value={celda.tres}
                            onChange={(valor) =>
                              setEditando(conPrecio(editando, cat.id, "tres", valor))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <div className="gp-precios__extras">
              <div className="form-group">
                <label>Valor de venta</label>
                <CampoPrecio
                  tone="plain"
                  label="Valor de venta"
                  value={editando.valorVenta}
                  onChange={(valor) => setEditando({ ...editando, valorVenta: valor })}
                />
              </div>
              <div className="form-group">
                <label>Precio de lista</label>
                <CampoPrecio
                  tone="plain"
                  label="Precio de lista"
                  value={editando.precioLista}
                  onChange={(valor) => setEditando({ ...editando, precioLista: valor })}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
