import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useAuth } from "../auth/AuthContext";
import { usePedidosPendientes } from "../auth/PedidosPendientesContext";
import { resolveAssetUrl } from "../config/api";
import {
  addPedidoSistemaFotos,
  completarPedidoSistema,
  deletePedidoSistema,
  fetchPedidoSistema,
  fetchPedidosSistema,
  removePedidoSistemaFoto,
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
import { IconCheck, IconFile, IconPlus, IconSearch, IconTrash, IconUpload, IconX } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";
import { PedidoSistemaFormModal } from "./PedidoSistemaFormModal";
import { PedidosColorSelect, type PedidosColorOption } from "./PedidosColorSelect";
import { formatNombrePersona } from "../lib/nombrePersona";
import { TablePagination } from "./TablePagination";
import { useClientPagination } from "../hooks/useClientPagination";

const MAX_ADJUNTOS = 8;
const MAX_ADJUNTO_BYTES = 8 * 1024 * 1024;

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

function isImageAdjunto(nombre: string, url: string): boolean {
  const name = `${nombre} ${url}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(name);
}

function esCreadorPedido(pedido: PedidoSistema, userId?: string | null, email?: string | null): boolean {
  if (pedido.creadoPorUserId && userId && pedido.creadoPorUserId === userId) return true;
  const mine = email?.trim().toLowerCase() ?? "";
  return Boolean(mine && pedido.creadoPorEmail?.trim().toLowerCase() === mine);
}

async function fileToFotoInput(file: File): Promise<{ base64: string; nombre: string; mime?: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("No se pudo leer el archivo"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  return {
    base64,
    nombre: file.name,
    ...(file.type ? { mime: file.type } : {}),
  };
}

export function PedidosSistemaPanel() {
  const { user } = useAuth();
  const dueno = user?.sistemas === true;
  const { pedidosPendientesCount } = usePedidosPendientes();
  const prevPendientes = useRef<number | null>(null);
  const adjuntoInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<PedidoSistema[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<"todos" | PedidoSistemaEstado>("todos");
  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<PedidoSistema | null>(null);
  const [viewingLoading, setViewingLoading] = useState(false);
  const [adjuntosBusy, setAdjuntosBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<PedidoSistema | null>(null);
  const [aCompletar, setACompletar] = useState<PedidoSistema | null>(null);
  const [mensajeCompletar, setMensajeCompletar] = useState("");
  const [completando, setCompletando] = useState(false);

  const cargar = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      setItems(await fetchPedidosSistema());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar los pedidos");
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!dueno) return;
    if (prevPendientes.current === pedidosPendientesCount) return;
    const first = prevPendientes.current === null;
    prevPendientes.current = pedidosPendientesCount;
    if (first) return;
    void cargar({ quiet: true });
  }, [dueno, pedidosPendientesCount, cargar]);

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

  const { page, setPage, pageItems, total, pageSize } = useClientPagination(
    filtrados,
    `${filtroEstado}|${busqueda.trim().toLowerCase()}`,
  );

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

  function abrirCompletar(pedido: PedidoSistema) {
    setMensajeCompletar("");
    setACompletar(pedido);
  }

  async function confirmarCompletar() {
    if (!aCompletar || completando) return;
    const id = aCompletar.id;
    const mensaje = mensajeCompletar;
    setCompletando(true);
    try {
      const { pedido, emailError } = await completarPedidoSistema(id, mensaje);
      setItems((prev) => prev.map((p) => (p.id === id ? pedido : p)));
      setViewing((prev) => (prev?.id === id ? pedido : prev));
      setACompletar(null);
      setMensajeCompletar("");
      if (emailError) {
        toast.warning(`Pedido marcado como completado, pero no se pudo avisar por mail: ${emailError}`);
      } else {
        toast.success("Pedido completado. Avisamos por mail a quien lo creó.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar el pedido");
    } finally {
      setCompletando(false);
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

  function aplicarPedidoActualizado(updated: PedidoSistema) {
    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setViewing((prev) => (prev?.id === updated.id ? updated : prev));
  }

  async function abrirDetalle(pedido: PedidoSistema) {
    setViewing(pedido);
    setViewingLoading(true);
    try {
      // Fuerza recover de adjuntos en el servidor (nginx no pasa por Express).
      const fresh = await fetchPedidoSistema(pedido.id);
      aplicarPedidoActualizado(fresh);
    } catch (error) {
      toast.warning(
        error instanceof Error
          ? error.message
          : "No se pudieron recuperar los adjuntos del pedido",
      );
    } finally {
      setViewingLoading(false);
    }
  }

  async function onAgregarAdjuntos(files: FileList | null) {
    if (!viewing || !files?.length || adjuntosBusy) return;
    const room = MAX_ADJUNTOS - viewing.fotos.length;
    if (room <= 0) {
      toast.warning(`Podés adjuntar como máximo ${MAX_ADJUNTOS} archivos`);
      return;
    }

    const picked = Array.from(files).slice(0, room);
    const inputs: { base64: string; nombre: string; mime?: string }[] = [];
    for (const file of picked) {
      if (file.size > MAX_ADJUNTO_BYTES) {
        toast.warning(`"${file.name}" supera 8 MB`);
        continue;
      }
      inputs.push(await fileToFotoInput(file));
    }
    if (inputs.length === 0) return;

    setAdjuntosBusy(true);
    try {
      const updated = await addPedidoSistemaFotos(viewing.id, inputs);
      aplicarPedidoActualizado(updated);
      toast.success(inputs.length === 1 ? "Adjunto agregado" : "Adjuntos agregados");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron subir los adjuntos");
    } finally {
      setAdjuntosBusy(false);
      if (adjuntoInputRef.current) adjuntoInputRef.current.value = "";
    }
  }

  async function onQuitarAdjunto(url: string) {
    if (!viewing || adjuntosBusy) return;
    setAdjuntosBusy(true);
    try {
      const updated = await removePedidoSistemaFoto(viewing.id, url);
      aplicarPedidoActualizado(updated);
      toast.success("Adjunto eliminado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar el adjunto");
    } finally {
      setAdjuntosBusy(false);
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
                <th className="pedidos-col-detalle">Detalle</th>
                <th className="pedidos-col-select">Prioridad</th>
                <th className="pedidos-col-select">Estado</th>
                <th className="fl-col-actions fl-col-actions--2" aria-label="Acciones" />
              </tr>
            </thead>
            {!loading && filtrados.length > 0 ? (
              <tbody>
                {pageItems.map((p) => (
                  <tr
                    key={p.id}
                    className="pedidos-row"
                    onClick={() => void abrirDetalle(p)}
                  >
                    <td className="pedidos-col-fecha">
                      <span className="pedidos-cell-text" title={formatDateTime(p.creadoAt)}>
                        {formatDateOnly(p.creadoAt)}
                      </span>
                    </td>
                    <td className="pedidos-col-usuario">
                      <span
                        className="pedidos-cell-text"
                        title={formatNombrePersona(p.solicitadoPor)}
                      >
                        {formatNombrePersona(p.solicitadoPor)}
                      </span>
                    </td>
                    <td className="pedidos-col-titulo">
                      <span className="pedidos-cell-text" title={p.titulo}>
                        {p.titulo}
                      </span>
                    </td>
                    <td className="pedidos-col-detalle">
                      <span
                        className="pedidos-cell-text"
                        title={p.detalle?.trim() || undefined}
                      >
                        {p.detalle?.trim() || "—"}
                      </span>
                    </td>
                    <td className="pedidos-col-select">
                      <div onClick={(e) => e.stopPropagation()}>
                        <PedidosColorSelect
                          value={p.prioridad}
                          options={PRIORIDAD_OPTIONS}
                          disabled={updatingId === p.id}
                          ariaLabel="Prioridad"
                          onChange={(prioridad) => void patchPedido(p.id, { prioridad })}
                        />
                      </div>
                    </td>
                    <td className="pedidos-col-select">
                      <div onClick={(e) => e.stopPropagation()}>
                      <PedidosColorSelect
                        value={p.estado}
                        options={ESTADO_OPTIONS}
                        disabled={!dueno || updatingId === p.id}
                        ariaLabel="Estado"
                        onChange={(estado) => void patchPedido(p.id, { estado })}
                      />
                      </div>
                    </td>
                    <td className="fl-col-actions fl-col-actions--2">
                      <div className="fl-table-actions fl-table-actions--2">
                        {dueno ? (
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--success"
                            title={
                              p.estado === "finalizado"
                                ? "Ya está completado"
                                : "Marcar como completado"
                            }
                            disabled={p.estado === "finalizado" || completando}
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirCompletar(p);
                            }}
                          >
                            <IconCheck size={16} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Eliminar"
                          onClick={(e) => {
                            e.stopPropagation();
                            setABorrar(p);
                          }}
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
              <LoadingBlock label="Cargando pedidos…" />
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

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={loading ? 0 : total}
          onPageChange={setPage}
          disabled={loading}
        />
      </section>

      <PedidoSistemaFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={(pedido) => setItems((prev) => [pedido, ...prev])}
      />

      <Modal
        open={aCompletar !== null}
        title="Marcar como completado"
        className="fl-modal--pedido-completar"
        onClose={() => {
          if (completando) return;
          setACompletar(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={completando}
              onClick={() => setACompletar(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={completando || !aCompletar}
              onClick={() => void confirmarCompletar()}
            >
              {completando ? "Guardando…" : "Aceptar"}
            </button>
          </>
        }
      >
        <textarea
          className="pedido-completar__mensaje"
          rows={6}
          value={mensajeCompletar}
          onChange={(e) => setMensajeCompletar(e.target.value)}
          placeholder="Mensaje opcional"
          aria-label="Mensaje opcional"
          disabled={completando}
        />
      </Modal>

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
            <div className="fl-modal__body pedido-detalle">
              <div className="pedido-detalle__controls">
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
                    disabled={!dueno || updatingId === viewing.id}
                    ariaLabel="Estado"
                    onChange={(estado) => void patchPedido(viewing.id, { estado })}
                  />
                </div>
              </div>

              <dl className="pedido-detalle__meta">
                <div>
                  <dt>Fecha y hora</dt>
                  <dd>{formatDateTime(viewing.creadoAt)}</dd>
                </div>
                <div>
                  <dt>Usuario</dt>
                  <dd>{formatNombrePersona(viewing.solicitadoPor)}</dd>
                </div>
                <div>
                  <dt>Sección</dt>
                  <dd>{seccionLabel(viewing)}</dd>
                </div>
                <div>
                  <dt>Título</dt>
                  <dd>{viewing.titulo}</dd>
                </div>
              </dl>

              <div className="pedido-detalle__block">
                <p className="pedido-detalle__label">Detalle</p>
                <div className="pedidos-detalle-text">{viewing.detalle || "—"}</div>
              </div>

              <div className="pedido-detalle__block">
                <div className="pedido-detalle__adjuntos-head">
                  <p className="pedido-detalle__label">Adjuntos</p>
                  {esCreadorPedido(viewing, user?.id, user?.email) ? (
                    <>
                      <input
                        ref={adjuntoInputRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(e) => void onAgregarAdjuntos(e.target.files)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={
                          adjuntosBusy ||
                          viewingLoading ||
                          viewing.fotos.length >= MAX_ADJUNTOS
                        }
                        onClick={() => adjuntoInputRef.current?.click()}
                      >
                        <IconUpload size={14} />
                        {adjuntosBusy ? "Subiendo…" : "Subir"}
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="pedidos-adjuntos">
                  {viewingLoading && viewing.fotos.length === 0 ? (
                    <p className="text-muted pedidos-adjuntos__empty">Cargando adjuntos…</p>
                  ) : viewing.fotos.length > 0 ? (
                    <ul className="pedidos-adjuntos__grid">
                      {viewing.fotos.map((f, idx) => {
                        const src = fotoSrc(f.url);
                        const image = isImageAdjunto(f.nombre, f.url);
                        const canEdit = esCreadorPedido(viewing, user?.id, user?.email);
                        return (
                          <li key={`${f.url}-${idx}`} className="pedidos-adjuntos__item">
                            <div className="pedidos-adjuntos__thumb">
                              <a
                                href={src}
                                target="_blank"
                                rel="noreferrer"
                                title={f.nombre}
                                className={image ? undefined : "pedidos-adjuntos__file"}
                              >
                                {image ? (
                                  <img src={src} alt={f.nombre} />
                                ) : (
                                  <span className="pedidos-adjuntos__file-icon" aria-hidden>
                                    <IconFile size={18} />
                                  </span>
                                )}
                              </a>
                              {canEdit ? (
                                <button
                                  type="button"
                                  className="fl-icon-btn fl-icon-btn--danger pedidos-adjuntos__remove"
                                  title="Eliminar adjunto"
                                  aria-label={`Eliminar ${f.nombre}`}
                                  disabled={adjuntosBusy}
                                  onClick={() => void onQuitarAdjunto(f.url)}
                                >
                                  <IconTrash size={12} />
                                </button>
                              ) : null}
                            </div>
                            <span title={f.nombre}>{f.nombre}</span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-muted pedidos-adjuntos__empty">Sin adjuntos</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
