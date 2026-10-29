import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { toast } from "react-toastify";
import { compareYmd, fechaHoyIso } from "../lib/fechas";
import { fetchWaMetricas, fetchWaOperators, fetchWaTagCatalog, type WaMetricas } from "../services/whatsappCrmService";
import type { WaOperator, WaTag, WaTagGroup } from "../types/whatsappCrm";
import { DatePicker } from "./DatePicker";
import { LoadingBlock } from "./InecoMark";
import { WhatsAppMetricasPersonalPanel } from "./WhatsAppMetricasPersonalPanel";

function inicioDeMes(hoy: string): string {
  const [anio, mes] = hoy.split("-");
  return anio && mes ? `${anio}-${mes}-01` : hoy;
}

export function WhatsAppMetricasPanel() {
  const hoy = fechaHoyIso();
  const [desde, setDesde] = useState(inicioDeMes(hoy));
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<WaMetricas | null>(null);
  const [loading, setLoading] = useState(true);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [grupoId, setGrupoId] = useState("");
  const [vista, setVista] = useState<"general" | "personalizada">("general");
  const [catalogoOperadores, setCatalogoOperadores] = useState<WaOperator[]>([]);
  const [catalogoEtiquetas, setCatalogoEtiquetas] = useState<WaTag[]>([]);
  const [catalogoGrupos, setCatalogoGrupos] = useState<WaTagGroup[]>([]);

  useEffect(() => {
    if (!desde || !hasta || desde > hasta) return;
    let cancelled = false;
    setLoading(true);
    void fetchWaMetricas(desde, hasta)
      .then((data) => {
        if (!cancelled) setDatos(data);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudieron cargar las métricas");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desde, hasta]);

  useEffect(() => {
    let cancelled = false;
    void fetchWaOperators()
      .then((ops) => {
        if (!cancelled) setCatalogoOperadores(ops);
      })
      .catch(() => {
        if (!cancelled) setCatalogoOperadores([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchWaTagCatalog()
      .then((catalogo) => {
        if (cancelled) return;
        setCatalogoEtiquetas(catalogo.items);
        setCatalogoGrupos(catalogo.groups);
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogoEtiquetas([]);
          setCatalogoGrupos([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const periodoListo = Boolean(desde && hasta && compareYmd(desde, hasta) <= 0);
  const filas = periodoListo ? (datos?.filas ?? []) : [];
  const etiquetas = catalogoEtiquetas.length ? catalogoEtiquetas : (datos?.etiquetas ?? []);
  const grupos = catalogoGrupos.length ? catalogoGrupos : (datos?.grupos ?? []);
  const total = filas.length;
  const bot = filas.filter((fila) => fila.assigneeKind === "bot").length;
  const porOperadores = filas.filter((fila) => fila.assigneeKind === "user").length;
  const sinAsignar = filas.filter((fila) => fila.assigneeKind === "none").length;

  const resoluciones = useMemo(
    () => filas.flatMap((fila) => fila.resolucionesEnPeriodo ?? []),
    [filas],
  );
  const episodiosResueltos = resoluciones.length;
  const resueltasBot = resoluciones.filter((item) => item.byKind === "bot").length;
  const resueltasHumano = resoluciones.filter((item) => item.byKind === "human").length;

  const operadores = useMemo(() => {
    const cuentas = new Map<string, number>();
    const nombres = new Map<string, string>();
    for (const fila of filas) {
      if (fila.assigneeKind !== "user") continue;
      const clave = fila.assigneeUserId || fila.assigneeName || "operador";
      cuentas.set(clave, (cuentas.get(clave) ?? 0) + 1);
      if (!nombres.has(clave)) nombres.set(clave, fila.assigneeName?.trim() || "Operador");
    }
    const vistos = new Set<string>();
    const lista: { clave: string; nombre: string; cantidad: number }[] = [];
    for (const op of catalogoOperadores) {
      vistos.add(op.id);
      lista.push({
        clave: op.id,
        nombre: op.nombre?.trim() || "Operador",
        cantidad: cuentas.get(op.id) ?? 0,
      });
    }
    for (const [clave, cantidad] of cuentas) {
      if (vistos.has(clave)) continue;
      lista.push({ clave, nombre: nombres.get(clave) || "Operador", cantidad });
    }
    lista.sort(
      (a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es"),
    );
    return lista;
  }, [catalogoOperadores, filas]);

  const resolucionesPorOperador = useMemo(() => {
    const cuentas = new Map<string, number>();
    const nombres = new Map<string, string>();
    for (const item of resoluciones) {
      if (item.byKind !== "human") continue;
      const clave = item.byUserId || item.byName || "operador";
      cuentas.set(clave, (cuentas.get(clave) ?? 0) + 1);
      if (!nombres.has(clave)) nombres.set(clave, item.byName?.trim() || "Operador");
    }
    const vistos = new Set<string>();
    const lista: { clave: string; nombre: string; cantidad: number }[] = [];
    for (const op of catalogoOperadores) {
      vistos.add(op.id);
      lista.push({
        clave: op.id,
        nombre: op.nombre?.trim() || "Operador",
        cantidad: cuentas.get(op.id) ?? 0,
      });
    }
    for (const [clave, cantidad] of cuentas) {
      if (vistos.has(clave)) continue;
      lista.push({ clave, nombre: nombres.get(clave) || "Operador", cantidad });
    }
    lista.sort(
      (a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es"),
    );
    return lista;
  }, [catalogoOperadores, resoluciones]);

  const conteoEtiqueta = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const fila of filas) {
      for (const id of fila.tagIds) mapa.set(id, (mapa.get(id) ?? 0) + 1);
    }
    return mapa;
  }, [filas]);

  const combinadas = useMemo(() => {
    if (!elegidas.length) return null;
    return filas.filter((fila) => elegidas.every((id) => fila.tagIds.includes(id))).length;
  }, [elegidas, filas]);

  const etiquetaDe = (id: string) => etiquetas.find((tag) => tag.id === id);
  const colorDe = (groupId: string) => grupos.find((group) => group.id === groupId)?.color ?? "#64748b";
  const grupoDe = (groupId: string) => grupos.find((group) => group.id === groupId)?.name ?? "Sin grupo";

  const gruposOrdenados = useMemo(
    () => [...grupos].sort((a, b) => a.name.localeCompare(b.name, "es")),
    [grupos],
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const items = etiquetas.filter((tag) => {
      if (grupoId && tag.groupId !== grupoId) return false;
      return !q || tag.name.toLowerCase().includes(q);
    });
    items.sort((a, b) => {
      const diferencia = (conteoEtiqueta.get(b.id) ?? 0) - (conteoEtiqueta.get(a.id) ?? 0);
      return diferencia || a.name.localeCompare(b.name, "es");
    });
    return items;
  }, [busqueda, conteoEtiqueta, etiquetas, grupoId]);

  function toggle(id: string) {
    setElegidas((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  function onDesdeChange(next: string) {
    if (!next) {
      setDesde("");
      return;
    }
    let valor = next;
    if (compareYmd(valor, hoy) > 0) valor = hoy;
    if (hasta && compareYmd(valor, hasta) > 0) valor = hasta;
    setDesde(valor);
  }

  function onHastaChange(next: string) {
    if (!next) {
      setHasta("");
      return;
    }
    let valor = next;
    if (compareYmd(valor, hoy) > 0) valor = hoy;
    if (desde && compareYmd(valor, desde) < 0) valor = desde;
    setHasta(valor);
  }

  const maxDesde = hasta && compareYmd(hasta, hoy) < 0 ? hasta : hoy;

  return (
    <div className="wa-metricas">
      <section className="fl-table-card wa-metricas__fechas">
        <div className="form-group">
          <label htmlFor="wa-metricas-desde">Desde</label>
          <DatePicker
            id="wa-metricas-desde"
            value={desde}
            onChange={onDesdeChange}
            max={maxDesde}
            formatHint={false}
            tooltips={false}
            clearable
          />
        </div>
        <div className="form-group">
          <label htmlFor="wa-metricas-hasta">Hasta</label>
          <DatePicker
            id="wa-metricas-hasta"
            value={hasta}
            onChange={onHastaChange}
            min={desde || undefined}
            max={hoy}
            formatHint={false}
            tooltips={false}
            clearable
          />
        </div>
      </section>

      {periodoListo ? null : (
        <p className="wa-metricas__aviso">Hacen falta las dos fechas para ver los números.</p>
      )}

      {periodoListo && loading && !datos ? (
        <LoadingBlock label="Cargando métricas…" />
      ) : (
        <>
          <section className="wa-metricas__cards" aria-label="Resoluciones del período">
            <article className="is-total">
              <span>Episodios resueltos</span>
              <strong>{periodoListo ? episodiosResueltos : "—"}</strong>
            </article>
            <article className="is-bot">
              <span>Resueltas por bot</span>
              <strong>{periodoListo ? resueltasBot : "—"}</strong>
            </article>
            <article className="is-operadores">
              <span>Resueltas por humano</span>
              <strong>{periodoListo ? resueltasHumano : "—"}</strong>
            </article>
          </section>

          <section className="wa-metricas__cards" aria-label="Asignación actual">
            <article className="is-total">
              <span>Conversaciones (actividad)</span>
              <strong>{periodoListo ? total : "—"}</strong>
            </article>
            <article className="is-bot">
              <span>Asignación: bot</span>
              <strong>{periodoListo ? bot : "—"}</strong>
            </article>
            <article className="is-operadores">
              <span>Asignación: operadores</span>
              <strong>{periodoListo ? porOperadores : "—"}</strong>
            </article>
            <article className="is-libre">
              <span>Sin asignar</span>
              <strong>{periodoListo ? sinAsignar : "—"}</strong>
            </article>
          </section>

          <div className="app-tabs app-tabs--full wa-metricas__tabs" role="tablist" aria-label="Vista de métricas">
            <button
              type="button"
              role="tab"
              aria-selected={vista === "general"}
              className={`app-tabs__btn${vista === "general" ? " is-active" : ""}`}
              onClick={() => setVista("general")}
            >
              General
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={vista === "personalizada"}
              className={`app-tabs__btn${vista === "personalizada" ? " is-active" : ""}`}
              onClick={() => setVista("personalizada")}
            >
              Personalizada
            </button>
          </div>

          {vista === "general" ? (
          <div className="wa-metricas__columnas">
          <section className="fl-table-card">
            <h2>Resoluciones por operadora</h2>
            {resolucionesPorOperador.length ? (
              <ul className="wa-metricas__lista">
                {resolucionesPorOperador.map((op) => (
                      <li key={`res-${op.clave}`}>
                        <span>{op.nombre}</span>
                        <strong className={periodoListo && op.cantidad > 0 ? "is-valor" : undefined}>
                          {periodoListo ? op.cantidad : "—"}
                        </strong>
                      </li>
                ))}
              </ul>
            ) : (
              <p className="wa-metricas__vacio">No hay operadores cargados.</p>
            )}
          </section>

          <section className="fl-table-card">
            <h2>Asignación actual</h2>
            {operadores.length ? (
              <ul className="wa-metricas__lista">
                {operadores.map((op) => (
                      <li key={op.clave}>
                        <span>{op.nombre}</span>
                        <strong className={periodoListo && op.cantidad > 0 ? "is-valor" : undefined}>
                          {periodoListo ? op.cantidad : "—"}
                        </strong>
                      </li>
                ))}
              </ul>
            ) : (
              <p className="wa-metricas__vacio">No hay operadores cargados.</p>
            )}
          </section>

          <section className="fl-table-card">
            <h2>Etiquetas</h2>
            <div className="wa-metricas__resumen">
              <div className="wa-metricas__elegidas">
                <span>Seleccionadas</span>
                {elegidas.length ? (
                  <div className="wa-metricas__chips">
                    {elegidas.map((id) => {
                      const tag = etiquetaDe(id);
                      return (
                        <button key={id} type="button" className="wa-tag" style={{ "--tag": colorDe(tag?.groupId ?? "") } as CSSProperties} onClick={() => toggle(id)}>
                          {tag?.name ?? "Etiqueta"}
                          <span aria-hidden>×</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="wa-metricas__vacio">Todavía no elegiste ninguna.</p>
                )}
              </div>
              <div className="wa-metricas__cumplen">
                <span>Conversaciones</span>
                <strong className={periodoListo && combinadas != null && combinadas > 0 ? "is-valor" : undefined}>
                  {periodoListo ? (combinadas ?? "—") : "—"}
                </strong>
              </div>
            </div>
            <div className="wa-metricas__filtros">
              <input
                type="search"
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar etiqueta…"
                aria-label="Buscar etiqueta"
              />
              <select
                value={grupoId}
                onChange={(event) => setGrupoId(event.target.value)}
                aria-label="Grupo de etiquetas"
              >
                <option value="">Todos los grupos</option>
                {gruposOrdenados.map((grupo) => (
                  <option key={grupo.id} value={grupo.id}>
                    {grupo.name}
                  </option>
                ))}
              </select>
            </div>
            <ul className="wa-metricas__etiquetas">
              {visibles.map((tag) => {
                const activa = elegidas.includes(tag.id);
                return (
                  <li key={tag.id}>
                    <button type="button" className={activa ? "is-on" : ""} onClick={() => toggle(tag.id)}>
                      <span className="wa-tag" style={{ "--tag": colorDe(tag.groupId) } as CSSProperties}>
                        {tag.name}
                      </span>
                      <small>{grupoDe(tag.groupId)}</small>
                      <strong className={periodoListo && (conteoEtiqueta.get(tag.id) ?? 0) > 0 ? "is-valor" : undefined}>
                        {periodoListo ? (conteoEtiqueta.get(tag.id) ?? 0) : "—"}
                      </strong>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          </div>
          ) : (
            <WhatsAppMetricasPersonalPanel
              periodoListo={periodoListo}
              filas={filas}
              etiquetas={etiquetas}
              grupos={grupos}
            />
          )}
        </>
      )}
    </div>
  );
}
