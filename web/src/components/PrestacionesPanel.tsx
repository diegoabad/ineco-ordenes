import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  createPrestacion,
  deletePrestacion,
  fetchPrestaciones,
  updatePrestacion,
} from "../services/dataService";
import {
  esTipoTratamiento,
  etiquetaFrecuencia,
  type Prestacion,
  type PrestacionFormData,
  type TipoPrestacion,
} from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconEye, IconPencil, IconSearch, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { PrestacionFormModal } from "./PrestacionFormModal";
import { RichTextContent } from "./RichTextContent";
import { TablePagination } from "./TablePagination";
import { TipoPrestacionChip } from "./TipoPrestacionChip";
import { ViewDetailModal } from "./ViewDetailModal";
import { useClientPagination } from "../hooks/useClientPagination";
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

type PestanaPrestacion = "evaluacion" | "tratamiento" | "otras";

const PESTANAS: { id: Exclude<PestanaPrestacion, "otras">; label: string }[] = [
  { id: "evaluacion", label: "Evaluación" },
  { id: "tratamiento", label: "Tratamiento" },
];

function normalizarTipo(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function pestanaDeTipo(nombre: string): PestanaPrestacion {
  const tipo = normalizarTipo(nombre);
  if (tipo === "evaluacion") return "evaluacion";
  if (tipo === "tratamiento") return "tratamiento";
  return "otras";
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
  const [pestana, setPestana] = useState<PestanaPrestacion>("evaluacion");
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

  const hayOtras = useMemo(
    () => items.some((p) => pestanaDeTipo(p.tipo) === "otras"),
    [items],
  );

  const tipoInicial = useMemo(() => {
    if (pestana === "otras") return tiposPrestacion[0]?.nombre ?? "Evaluación";
    const encontrada = tiposPrestacion.find((t) => pestanaDeTipo(t.nombre) === pestana);
    return encontrada?.nombre ?? (pestana === "evaluacion" ? "Evaluación" : "Tratamiento");
  }, [pestana, tiposPrestacion]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return items.filter((p) => {
      if (pestanaDeTipo(p.tipo) !== pestana) return false;
      if (!q) return true;
      return [p.titulo, p.descripcion].join(" ").toLowerCase().includes(q);
    });
  }, [items, busqueda, pestana]);

  const { page, setPage, pageItems, total, pageSize } = useClientPagination(
    filtradas,
    `${pestana}|${busqueda.trim().toLowerCase()}`,
  );

  useEffect(() => {
    if (pestana === "otras" && !hayOtras) setPestana("evaluacion");
  }, [pestana, hayOtras]);

  const etiquetaPestana =
    pestana === "evaluacion" ? "evaluación" : pestana === "tratamiento" ? "tratamiento" : "otro tipo";

  async function handleSave(data: PrestacionFormData, id?: string) {
    try {
      if (id) {
        const updated = await updatePrestacion(id, data);
        setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
        setPestana(pestanaDeTipo(updated.tipo));
        toast.success("Prestación actualizada");
      } else {
        const created = await createPrestacion(data);
        setItems((prev) => [created, ...prev]);
        setPestana(pestanaDeTipo(created.tipo));
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
      <div className="app-tabs app-tabs--full" role="tablist" aria-label="Tipos de prestación">
        {PESTANAS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={pestana === item.id}
            className={`app-tabs__btn${pestana === item.id ? " is-active" : ""}`}
            onClick={() => setPestana(item.id)}
          >
            {item.label}
          </button>
        ))}
        {hayOtras ? (
          <button
            type="button"
            role="tab"
            aria-selected={pestana === "otras"}
            className={`app-tabs__btn${pestana === "otras" ? " is-active" : ""}`}
            onClick={() => setPestana("otras")}
          >
            Otras
          </button>
        ) : null}
      </div>

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
                <th className="fl-col-prest-num">
                  {pestana === "tratamiento" ? "Por sesión" : "Efect/Transf"}
                </th>
                <th className="fl-col-prest-num">
                  {pestana === "tratamiento" ? "Frecuencia" : "3 cuotas"}
                </th>
                <th className="fl-col-actions fl-col-actions--3" aria-label="Acciones" />
              </tr>
            </thead>
            {!loading && filtradas.length > 0 ? (
              <tbody>
                {pageItems.map((p) => (
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
                    <td className="fl-col-prest-num">
                      {esTipoTratamiento(p.tipo)
                        ? etiquetaFrecuencia(p.frecuencia, p.sesiones)
                        : formatMoney(p.precio3Cuotas)}
                    </td>
                    <td className="fl-col-actions fl-col-actions--3">
                      <div className="fl-table-actions fl-table-actions--3">
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
              <LoadingBlock label="Cargando prestaciones…" />
            </div>
          ) : filtradas.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <p className="fl-table-empty__title">
                {busqueda.trim()
                  ? "Sin resultados"
                  : `Todavía no hay prestaciones de ${etiquetaPestana}`}
              </p>
              <p className="fl-table-empty__hint">
                {busqueda.trim()
                  ? "Probá con otro término o cambiá de pestaña."
                  : `Agregá una de ${etiquetaPestana} para empezar a armar presupuestos.`}
              </p>
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

      <PrestacionFormModal
        open={formOpen}
        initial={editing}
        tiposPrestacion={tiposPrestacion}
        tipoInicial={tipoInicial}
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
                ...(esTipoTratamiento(viewing.tipo)
                  ? [
                      {
                        label: "Frecuencia",
                        value: etiquetaFrecuencia(viewing.frecuencia, viewing.sesiones),
                      },
                    ]
                  : []),
                {
                  label: "Descripción",
                  value: <RichTextContent html={viewing.descripcion} className="detail-list__multiline" />,
                },
                {
                  label: "Precios",
                  value: (
                    <div className="detail-precios">
                      <div className="detail-precios__item">
                        <span className="detail-precios__label">
                          {esTipoTratamiento(viewing.tipo) ? "Honorarios por sesión" : "Efect/Transf"}
                        </span>
                        <span>{formatMoney(viewing.precioEfectivo)}</span>
                      </div>
                      {esTipoTratamiento(viewing.tipo) ? null : (
                        <div className="detail-precios__item">
                          <span className="detail-precios__label">3 cuotas</span>
                          <span>{formatMoney(viewing.precio3Cuotas)}</span>
                        </div>
                      )}
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
