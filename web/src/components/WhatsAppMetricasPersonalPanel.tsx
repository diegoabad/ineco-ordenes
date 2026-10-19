import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import {
  fetchWaMetricaTablero,
  saveWaMetricaTablero,
  type WaMetricaAgrupacion,
  type WaMetricaContador,
  type WaMetricaFila,
} from "../services/whatsappCrmService";
import type { WaTag, WaTagGroup } from "../types/whatsappCrm";
import { Modal } from "./Modal";

const COLORES = [
  "#a61948",
  "#334155",
  "#ef4444",
  "#f97316",
  "#b45309",
  "#059669",
  "#0284c7",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

type ContadorDraft = {
  agrupacionId: string;
  id: string | null;
  nombre: string;
  color: string;
  modo: "etiquetas" | "grupo";
  tagIds: string[];
  groupId: string;
};

function contar(
  contador: WaMetricaContador,
  filas: WaMetricaFila[],
  etiquetas: WaTag[],
): number {
  if (contador.modo === "grupo") {
    const delGrupo = new Set(
      etiquetas.filter((tag) => tag.groupId === contador.groupId).map((tag) => tag.id),
    );
    return filas.filter((fila) => fila.tagIds.some((id) => delGrupo.has(id))).length;
  }
  return filas.filter((fila) => contador.tagIds.every((id) => fila.tagIds.includes(id))).length;
}

export function WhatsAppMetricasPersonalPanel({
  periodoListo,
  filas,
  etiquetas,
  grupos,
}: {
  periodoListo: boolean;
  filas: WaMetricaFila[];
  etiquetas: WaTag[];
  grupos: WaTagGroup[];
}) {
  const [agrupaciones, setAgrupaciones] = useState<WaMetricaAgrupacion[]>([]);
  const [lista, setLista] = useState(true);
  const [agrupacionDraft, setAgrupacionDraft] = useState<{ id: string | null; nombre: string } | null>(null);
  const [contadorDraft, setContadorDraft] = useState<ContadorDraft | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchWaMetricaTablero()
      .then((data) => {
        if (!cancelled) setAgrupaciones(data.agrupaciones);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudo leer el tablero");
        }
      })
      .finally(() => {
        if (!cancelled) setLista(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function guardar(next: WaMetricaAgrupacion[]) {
    const previo = agrupaciones;
    setAgrupaciones(next);
    try {
      const saved = await saveWaMetricaTablero(next);
      setAgrupaciones(saved.agrupaciones);
    } catch (error) {
      setAgrupaciones(previo);
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el tablero");
    }
  }

  function detalle(contador: WaMetricaContador): string {
    if (contador.modo === "grupo") {
      return grupos.find((group) => group.id === contador.groupId)?.name ?? "Grupo";
    }
    const nombres = contador.tagIds
      .map((id) => etiquetas.find((tag) => tag.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    return nombres.join(" · ");
  }

  const etiquetasVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return [...etiquetas]
      .filter((tag) => !q || tag.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [busqueda, etiquetas]);

  function guardarAgrupacion(event: FormEvent) {
    event.preventDefault();
    if (!agrupacionDraft) return;
    const nombre = agrupacionDraft.nombre.trim();
    if (!nombre) return;
    const next = agrupacionDraft.id
      ? agrupaciones.map((grupo) => (grupo.id === agrupacionDraft.id ? { ...grupo, nombre } : grupo))
      : [...agrupaciones, { id: crypto.randomUUID(), nombre, contadores: [] }];
    setAgrupacionDraft(null);
    void guardar(next);
  }

  function guardarContador(event: FormEvent) {
    event.preventDefault();
    if (!contadorDraft) return;
    const nombre = contadorDraft.nombre.trim();
    if (!nombre) return;
    if (contadorDraft.modo === "etiquetas" && !contadorDraft.tagIds.length) {
      toast.error("Elegí al menos una etiqueta");
      return;
    }
    if (contadorDraft.modo === "grupo" && !contadorDraft.groupId) return;
    const contador: WaMetricaContador = {
      id: contadorDraft.id ?? crypto.randomUUID(),
      nombre,
      color: contadorDraft.color,
      modo: contadorDraft.modo,
      tagIds: contadorDraft.modo === "etiquetas" ? contadorDraft.tagIds : [],
      groupId: contadorDraft.modo === "grupo" ? contadorDraft.groupId : null,
    };
    const next = agrupaciones.map((grupo) => {
      if (grupo.id !== contadorDraft.agrupacionId) return grupo;
      const existe = grupo.contadores.some((item) => item.id === contador.id);
      return {
        ...grupo,
        contadores: existe
          ? grupo.contadores.map((item) => (item.id === contador.id ? contador : item))
          : [...grupo.contadores, contador],
      };
    });
    setContadorDraft(null);
    setBusqueda("");
    void guardar(next);
  }

  function borrarAgrupacion() {
    if (!agrupacionDraft?.id) return;
    const id = agrupacionDraft.id;
    setAgrupacionDraft(null);
    void guardar(agrupaciones.filter((grupo) => grupo.id !== id));
  }

  function borrarContador() {
    if (!contadorDraft?.id) return;
    const { agrupacionId, id } = contadorDraft;
    setContadorDraft(null);
    void guardar(
      agrupaciones.map((grupo) =>
        grupo.id === agrupacionId
          ? { ...grupo, contadores: grupo.contadores.filter((item) => item.id !== id) }
          : grupo,
      ),
    );
  }

  return (
    <div className="wa-metricas__tablero">
      <div className="wa-metricas__tablero-bar">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setAgrupacionDraft({ id: null, nombre: "" })}
        >
          Nueva agrupación
        </button>
      </div>

      {lista ? null : agrupaciones.length ? (
        agrupaciones.map((grupo) => (
          <section key={grupo.id} className="fl-table-card">
            <div className="wa-metricas__agrupacion-head">
              <h2>{grupo.nombre}</h2>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setAgrupacionDraft({ id: grupo.id, nombre: grupo.nombre })}
                >
                  Nombre
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    setContadorDraft({
                      agrupacionId: grupo.id,
                      id: null,
                      nombre: "",
                      color: COLORES[0]!,
                      modo: "etiquetas",
                      tagIds: [],
                      groupId: grupos[0]?.id ?? "",
                    })
                  }
                >
                  Nuevo contador
                </button>
              </div>
            </div>
            {grupo.contadores.length ? (
              <div className="wa-metricas__contadores">
                {grupo.contadores.map((contador) => {
                  const cantidad = contar(contador, filas, etiquetas);
                  return (
                    <button
                      key={contador.id}
                      type="button"
                      className="wa-metricas__contador"
                      style={{ background: contador.color }}
                      onClick={() =>
                        setContadorDraft({
                          agrupacionId: grupo.id,
                          id: contador.id,
                          nombre: contador.nombre,
                          color: contador.color,
                          modo: contador.modo,
                          tagIds: contador.tagIds,
                          groupId: contador.groupId ?? "",
                        })
                      }
                    >
                      <span>{contador.nombre}</span>
                      <strong>{periodoListo ? cantidad : "—"}</strong>
                      <small>{detalle(contador)}</small>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="wa-metricas__vacio">Esta agrupación todavía no tiene contadores.</p>
            )}
          </section>
        ))
      ) : (
        <p className="wa-metricas__vacio">Creá una agrupación para armar tus contadores.</p>
      )}

      <Modal
        open={agrupacionDraft != null}
        title={agrupacionDraft?.id ? "Nombre de la agrupación" : "Nueva agrupación"}
        onClose={() => setAgrupacionDraft(null)}
        footer={
          <>
            {agrupacionDraft?.id ? (
              <button type="button" className="btn btn-ghost wa-metricas__modal-borrar" onClick={borrarAgrupacion}>
                Eliminar
              </button>
            ) : null}
            <button type="submit" form="wa-metrica-agrupacion" className="btn btn-primary">
              Guardar
            </button>
          </>
        }
      >
        <form id="wa-metrica-agrupacion" onSubmit={guardarAgrupacion}>
          <label className="form-group">
            <span>Nombre</span>
            <input
              value={agrupacionDraft?.nombre ?? ""}
              onChange={(event) =>
                setAgrupacionDraft((current) =>
                  current ? { ...current, nombre: event.target.value } : current,
                )
              }
              placeholder="Pacientes"
              required
              autoFocus
            />
          </label>
        </form>
      </Modal>

      <Modal
        open={contadorDraft != null}
        title={contadorDraft?.id ? "Editar contador" : "Nuevo contador"}
        onClose={() => {
          setContadorDraft(null);
          setBusqueda("");
        }}
        wide
        footer={
          <>
            {contadorDraft?.id ? (
              <button type="button" className="btn btn-ghost wa-metricas__modal-borrar" onClick={borrarContador}>
                Eliminar
              </button>
            ) : null}
            <button type="submit" form="wa-metrica-contador" className="btn btn-primary">
              Guardar
            </button>
          </>
        }
      >
        {contadorDraft ? (
          <form id="wa-metrica-contador" className="wa-metricas__form" onSubmit={guardarContador}>
            <label className="form-group">
              <span>Nombre</span>
              <input
                value={contadorDraft.nombre}
                onChange={(event) =>
                  setContadorDraft((current) =>
                    current ? { ...current, nombre: event.target.value } : current,
                  )
                }
                placeholder="Paciente"
                required
                autoFocus
              />
            </label>
            <div className="form-group">
              <label>Color</label>
              <div className="wa-tag-colors">
                {COLORES.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`wa-tag-swatch${contadorDraft.color === color ? " is-active" : ""}`}
                    style={{ background: color }}
                    aria-label={color}
                    onClick={() =>
                      setContadorDraft((current) => (current ? { ...current, color } : current))
                    }
                  />
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Contar por</label>
              <div className="wa-metricas__modo">
                <button
                  type="button"
                  className={contadorDraft.modo === "etiquetas" ? "is-on" : ""}
                  onClick={() =>
                    setContadorDraft((current) => (current ? { ...current, modo: "etiquetas" } : current))
                  }
                >
                  Etiquetas
                </button>
                <button
                  type="button"
                  className={contadorDraft.modo === "grupo" ? "is-on" : ""}
                  onClick={() =>
                    setContadorDraft((current) => (current ? { ...current, modo: "grupo" } : current))
                  }
                >
                  Grupo
                </button>
              </div>
            </div>
            {contadorDraft.modo === "grupo" ? (
              <label className="form-group">
                <span>Grupo</span>
                <select
                  value={contadorDraft.groupId}
                  onChange={(event) =>
                    setContadorDraft((current) =>
                      current ? { ...current, groupId: event.target.value } : current,
                    )
                  }
                  required
                >
                  <option value="">Elegí un grupo</option>
                  {grupos.map((grupo) => (
                    <option key={grupo.id} value={grupo.id}>
                      {grupo.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="form-group">
                <label>Etiquetas</label>
                <input
                  type="search"
                  value={busqueda}
                  onChange={(event) => setBusqueda(event.target.value)}
                  placeholder="Buscar etiqueta…"
                  aria-label="Buscar etiqueta"
                />
                <ul className="wa-metricas__elige">
                  {etiquetasVisibles.map((tag) => {
                    const activa = contadorDraft.tagIds.includes(tag.id);
                    return (
                      <li key={tag.id}>
                        <button
                          type="button"
                          className={activa ? "is-on" : ""}
                          onClick={() =>
                            setContadorDraft((current) => {
                              if (!current) return current;
                              const tagIds = activa
                                ? current.tagIds.filter((id) => id !== tag.id)
                                : [...current.tagIds, tag.id];
                              return { ...current, tagIds };
                            })
                          }
                        >
                          {tag.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
