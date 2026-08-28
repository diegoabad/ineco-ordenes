import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  createPrestacion,
  deletePrestacion,
  fetchPrestaciones,
  updatePrestacion,
} from "../services/dataService";
import type { Prestacion, PrestacionFormData, TipoPrestacion } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconEye, IconPencil, IconSearch, IconTrash } from "./Icons";
import { PrestacionFormModal } from "./PrestacionFormModal";
import { RichTextContent } from "./RichTextContent";
import { TipoPrestacionChip } from "./TipoPrestacionChip";
import { ViewDetailModal } from "./ViewDetailModal";
import { richTextPreview } from "../lib/richText";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDuracion(minutos: number): string {
  if (!minutos || minutos <= 0) return "—";
  return `${minutos} min`;
}

type Props = {
  /** Incrementar para abrir el modal de alta desde el header. */
  addRequestKey?: number;
  tiposPrestacion: TipoPrestacion[];
};

export function PrestacionesPanel({ addRequestKey = 0, tiposPrestacion }: Props) {
  const [items, setItems] = useState<Prestacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Prestacion | null>(null);
  const [viewing, setViewing] = useState<Prestacion | null>(null);
  const [aBorrar, setABorrar] = useState<Prestacion | null>(null);
  const lastAddRequestKey = useRef(0);

  useEffect(() => {
    if (addRequestKey > lastAddRequestKey.current) {
      lastAddRequestKey.current = addRequestKey;
      setEditing(null);
      setFormOpen(true);
    }
  }, [addRequestKey]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchPrestaciones());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las prestaciones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) =>
      [p.titulo, p.descripcion].join(" ").toLowerCase().includes(q),
    );
  }, [items, busqueda]);

  async function handleSave(data: PrestacionFormData, id?: string) {
    try {
      if (id) {
        const updated = await updatePrestacion(id, data);
        setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
        toast.success("Prestación actualizada");
      } else {
        const created = await createPrestacion(data);
        setItems((prev) => [created, ...prev]);
        toast.success("Prestación creada");
      }
      setFormOpen(false);
      setEditing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    }
  }

  async function confirmarBorrar() {
    if (!aBorrar) return;
    const id = aBorrar.id;
    setABorrar(null);
    try {
      await deletePrestacion(id);
      setItems((prev) => prev.filter((p) => p.id !== id));
      toast.success("Prestación eliminada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    }
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
              placeholder="Buscar prestación…"
              aria-label="Buscar prestaciones"
            />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <colgroup>
              <col className="col-prest-titulo" />
              <col className="col-prest-tipo" />
              <col className="col-prest-duracion" />
              <col className="col-prest-efectivo" />
              <col className="col-prest-cuotas" />
              <col className="col-actions col-actions--3" />
            </colgroup>
            <thead>
              <tr>
                <th>Título</th>
                <th>Tipo</th>
                <th className="fl-col-prest-num">Duración</th>
                <th className="fl-col-prest-num">Efect/Transf</th>
                <th className="fl-col-prest-num">3 cuotas</th>
                <th className="fl-col-actions fl-col-actions--3">Acciones</th>
              </tr>
            </thead>
            {!loading && filtradas.length > 0 ? (
              <tbody>
                {filtradas.map((p) => (
                  <tr key={p.id}>
                    <td className="fl-col-prest-titulo">
                      <span className="fl-texto-principal">{p.titulo}</span>
                      <span className="fl-prest-desc-preview text-muted">
                        {richTextPreview(p.descripcion) || "Sin descripción"}
                      </span>
                    </td>
                    <td>
                      <TipoPrestacionChip nombre={p.tipo} tipos={tiposPrestacion} />
                    </td>
                    <td className="fl-col-prest-num">{formatDuracion(p.duracionMinutos ?? 0)}</td>
                    <td className="fl-col-prest-num">{formatMoney(p.precioEfectivo)}</td>
                    <td className="fl-col-prest-num">{formatMoney(p.precio3Cuotas)}</td>
                    <td className="fl-col-actions fl-col-actions--3">
                      <div className="fl-table-actions">
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--view"
                          title="Ver detalle"
                          onClick={() => setViewing(p)}
                        >
                          <IconEye size={15} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--edit"
                          title="Editar"
                          onClick={() => {
                            setEditing(p);
                            setFormOpen(true);
                          }}
                        >
                          <IconPencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Eliminar"
                          onClick={() => setABorrar(p)}
                        >
                          <IconTrash size={15} />
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
              <p className="fl-table-empty__title">Cargando prestaciones…</p>
            </div>
          ) : filtradas.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">
                {items.length === 0 ? "Todavía no hay prestaciones" : "Sin resultados"}
              </p>
              <p className="fl-table-empty__hint">
                {items.length === 0
                  ? "Agregá la primera para empezar a armar presupuestos."
                  : "Probá con otro término de búsqueda."}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <PrestacionFormModal
        open={formOpen}
        initial={editing}
        tiposPrestacion={tiposPrestacion}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSave={(data, id) => void handleSave(data, id)}
      />

      <ViewDetailModal
        open={viewing !== null}
        title="Detalle de prestación"
        onClose={() => setViewing(null)}
        fields={
          viewing
            ? [
                { label: "Título", value: viewing.titulo },
                { label: "Tipo", value: <TipoPrestacionChip nombre={viewing.tipo} tipos={tiposPrestacion} /> },
                { label: "Duración (min)", value: formatDuracion(viewing.duracionMinutos ?? 0) },
                {
                  label: "Descripción",
                  value: <RichTextContent html={viewing.descripcion} className="detail-list__multiline" />,
                },
                {
                  label: "Precios",
                  value: (
                    <div className="detail-precios">
                      <div className="detail-precios__item">
                        <span className="detail-precios__label">Efect/Transf</span>
                        <span>{formatMoney(viewing.precioEfectivo)}</span>
                      </div>
                      <div className="detail-precios__item">
                        <span className="detail-precios__label">3 cuotas</span>
                        <span>{formatMoney(viewing.precio3Cuotas)}</span>
                      </div>
                    </div>
                  ),
                },
              ]
            : []
        }
      />

      <ConfirmDialog
        open={aBorrar !== null}
        title="Eliminar prestación"
        message={
          aBorrar
            ? `¿Eliminar “${aBorrar.titulo}”? Esta acción no se puede deshacer.`
            : ""
        }
        confirmLabel="Eliminar"
        onCancel={() => setABorrar(null)}
        onConfirm={() => void confirmarBorrar()}
      />
    </>
  );
}
