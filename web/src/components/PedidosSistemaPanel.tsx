import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { resolveAssetUrl } from "../config/api";
import {
  deletePedidoSistema,
  fetchPedidosSistema,
  updatePedidoSistema,
} from "../services/dataService";
import type {
  PedidoSistema,
  PedidoSistemaEstado,
  PedidoSistemaPrioridad,
} from "../types";
import {
  PEDIDO_SECCION_LABEL,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconEye, IconFile, IconPlus, IconSearch, IconTrash, IconX } from "./Icons";
import { PedidoSistemaFormModal } from "./PedidoSistemaFormModal";
import { PedidosColorSelect, type PedidosColorOption } from "./PedidosColorSelect";

const PRIORIDAD_OPTIONS: PedidosColorOption<PedidoSistemaPrioridad>[] = [
  { value: "baja", label: "Baja", tone: "amarillo" },
  { value: "media", label: "Media", tone: "naranja" },
  { value: "alta", label: "Alta", tone: "rojo" },
];

const ESTADO_OPTIONS: PedidosColorOption<PedidoSistemaEstado>[] = [
  { value: "pendiente", label: "Pendiente", tone: "amarillo" },
  { value: "en_proceso", label: "En proceso", tone: "indigo" },
  { value: "finalizado", label: "Finalizado", tone: "verde" },
];

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function seccionLabel(pedido: PedidoSistema): string {
  return PEDIDO_SECCION_LABEL[pedido.seccion] ?? pedido.seccion;
}

function fotoSrc(url: string): string {
  return resolveAssetUrl(url) ?? url;
}

export function PedidosSistemaPanel() {
  const [items, setItems] = useState<PedidoSistema[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | PedidoSistemaEstado>("todos");
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<PedidoSistema | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<PedidoSistema | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchPedidosSistema());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar los pedidos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return items.filter((p) => {
      if (filtroEstado !== "todos" && p.estado !== filtroEstado) return false;
      if (!q) return true;
      return [p.titulo, p.solicitadoPor, p.detalle, seccionLabel(p)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [items, busqueda, filtroEstado]);

  async function patchPedido(
    id: string,
    data: { estado?: PedidoSistemaEstado; prioridad?: PedidoSistemaPrioridad },
  ) {
    setUpdatingId(id);
    try {
      const updated = await updatePedidoSistema(id, data);
      setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setViewing((prev) => (prev?.id === id ? updated : prev));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar");
    } finally {
      setUpdatingId(null);
    }
  }

  async function confirmarBorrar() {
    if (!aBorrar) return;
    const id = aBorrar.id;
    setABorrar(null);
    try {
      await deletePedidoSistema(id);
      setItems((prev) => prev.filter((p) => p.id !== id));
      setViewing((prev) => (prev?.id === id ? null : prev));
      toast.success("Pedido eliminado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>Pedidos sistema</h1>
            <p>Pedidos internos de mejoras, bugs y nuevas secciones</p>
          </div>
        </div>
        <div className="app-header__actions">
          <button type="button" className="btn btn-primary" onClick={() => setFormOpen(true)}>
            <IconPlus size={16} />
            Crear pedido
          </button>
        </div>
      </header>

      <section className="fl-table-card">
        <div className="table-toolbar table-toolbar--filters">
          <div className="table-search">
            <span className="table-search__icon" aria-hidden>
              <IconSearch size={16} />
            </span>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por título, persona o detalle…"
            />
          </div>
          <label className="form-group table-toolbar__filter">
            <span>Estado</span>
            <select
              value={filtroEstado}
              onChange={(e) =>
                setFiltroEstado(e.target.value as "todos" | PedidoSistemaEstado)
              }
            >
              <option value="todos">Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="en_proceso">En proceso</option>
              <option value="finalizado">Finalizado</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="pedidos-col-fecha">Fecha</th>
                <th className="pedidos-col-usuario">Usuario</th>
                <th className="pedidos-col-titulo">Título</th>
                <th className="pedidos-col-select">Prioridad</th>
                <th className="pedidos-col-select">Estado</th>
                <th className="fl-col-actions pedidos-col-actions">Acciones</th>
              </tr>
            </thead>
            {!loading && filtrados.length > 0 ? (
              <tbody>
                {filtrados.map((p) => (
                  <tr key={p.id}>
                    <td
                      className="pedidos-col-fecha"
                      title={formatDateTime(p.creadoAt)}
                    >
                      {formatDateOnly(p.creadoAt)}
                    </td>
                    <td className="pedidos-col-usuario" title={p.solicitadoPor}>
                      {p.solicitadoPor}
                    </td>
                    <td className="pedidos-col-titulo" title={p.titulo}>
                      {p.titulo}
                    </td>
                    <td className="pedidos-col-select">
                      <PedidosColorSelect
                        value={p.prioridad}
                        options={PRIORIDAD_OPTIONS}
                        disabled={updatingId === p.id}
                        ariaLabel="Prioridad"
                        onChange={(prioridad) => void patchPedido(p.id, { prioridad })}
                      />
                    </td>
                    <td className="pedidos-col-select">
                      <PedidosColorSelect
                        value={p.estado}
                        options={ESTADO_OPTIONS}
                        disabled={updatingId === p.id}
                        ariaLabel="Estado"
                        onChange={(estado) => void patchPedido(p.id, { estado })}
                      />
                    </td>
                    <td className="fl-col-actions pedidos-col-actions">
                      <div className="fl-table-actions fl-table-actions--2">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          title="Ver detalle"
                          onClick={() => setViewing(p)}
                        >
                          <IconEye size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Eliminar"
                          onClick={() => setABorrar(p)}
                        >
                          <IconTrash size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>

          {loading ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">Cargando pedidos…</p>
            </div>
          ) : filtrados.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              {items.length === 0 ? (
                <>
                  <div className="fl-table-empty__art">
                    <IconFile size={32} />
                  </div>
                  <p className="fl-table-empty__title">Todavía no hay pedidos</p>
                  <p className="fl-table-empty__hint">
                    Creá el primero con el botón Crear pedido.
                  </p>
                </>
              ) : (
                <>
                  <p className="fl-table-empty__title">Sin resultados</p>
                  <p className="fl-table-empty__hint">
                    Probá con otra búsqueda o cambiá el filtro de estado.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <PedidoSistemaFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={(pedido) => setItems((prev) => [pedido, ...prev])}
      />

      <ConfirmDialog
        open={aBorrar !== null}
        title="Eliminar pedido"
        message={
          aBorrar
            ? `¿Eliminar el pedido "${aBorrar.titulo}"? Esta acción no se puede deshacer.`
            : ""
        }
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarBorrar()}
        onCancel={() => setABorrar(null)}
      />

      {viewing ? (
        <div className="fl-modal-backdrop" role="presentation">
          <div
            className="fl-modal fl-modal--wide fl-modal--pedido-detalle"
            role="dialog"
            aria-modal="true"
            aria-label="Detalle del pedido"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fl-modal__header">
              <h2>Detalle del pedido</h2>
              <button
                type="button"
                className="fl-icon-btn"
                onClick={() => setViewing(null)}
                aria-label="Cerrar"
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="fl-modal__body">
              <dl className="detail-list">
                <div className="detail-list__row">
                  <dt>Fecha y hora</dt>
                  <dd>{formatDateTime(viewing.creadoAt)}</dd>
                </div>
                <div className="detail-list__row">
                  <dt>Usuario</dt>
                  <dd>{viewing.solicitadoPor}</dd>
                </div>
                <div className="detail-list__row">
                  <dt>Sección</dt>
                  <dd>{seccionLabel(viewing)}</dd>
                </div>
                <div className="detail-list__row">
                  <dt>Título</dt>
                  <dd>{viewing.titulo}</dd>
                </div>
                <div className="detail-list__row detail-list__row--block pedidos-detalle-block">
                  <dt>Detalle</dt>
                  <dd className="pedidos-detalle-text">{viewing.detalle || "—"}</dd>
                </div>
                <div className="detail-list__row detail-list__row--block pedidos-detalle-block">
                  <dt>Adjuntos</dt>
                  <dd className="pedidos-adjuntos">
                    {viewing.fotos.length > 0 ? (
                      <ul className="pedidos-adjuntos__grid">
                        {viewing.fotos.map((f, idx) => (
                          <li key={`${f.url}-${idx}`} className="pedidos-adjuntos__item">
                            <a
                              href={fotoSrc(f.url)}
                              target="_blank"
                              rel="noreferrer"
                              title={f.nombre}
                            >
                              <img src={fotoSrc(f.url)} alt={f.nombre} />
                            </a>
                            <span title={f.nombre}>{f.nombre}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted pedidos-adjuntos__empty">Sin adjuntos</p>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="pedidos-detalle-actions">
                <div className="form-group">
                  <span>Prioridad</span>
                  <PedidosColorSelect
                    value={viewing.prioridad}
                    options={PRIORIDAD_OPTIONS}
                    disabled={updatingId === viewing.id}
                    ariaLabel="Prioridad"
                    onChange={(prioridad) => void patchPedido(viewing.id, { prioridad })}
                  />
                </div>
                <div className="form-group">
                  <span>Estado</span>
                  <PedidosColorSelect
                    value={viewing.estado}
                    options={ESTADO_OPTIONS}
                    disabled={updatingId === viewing.id}
                    ariaLabel="Estado"
                    onChange={(estado) => void patchPedido(viewing.id, { estado })}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
