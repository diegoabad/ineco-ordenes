import { FormEvent, useEffect, useMemo, useState, type CSSProperties, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import { fetchUserDirectory } from "../services/dataService";
import {
  addWaOperator,
  fetchWaOperators,
  removeWaOperator,
} from "../services/whatsappCrmService";
import type { UserDirectoryEntry } from "../types";
import type { WaOperator } from "../types/whatsappCrm";
import { IconFile, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

const OPERATOR_COLORS = [
  "#a61948",
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

type Props = {
  addRef?: MutableRefObject<(() => void) | null>;
};

export function WhatsAppOperatorsPanel({ addRef }: Props) {
  const [operators, setOperators] = useState<WaOperator[]>([]);
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [color, setColor] = useState(OPERATOR_COLORS[0]!);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [ops, users] = await Promise.all([fetchWaOperators(), fetchUserDirectory()]);
        if (cancelled) return;
        setOperators(ops);
        setDirectory(users);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudieron cargar las operadoras");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const available = useMemo(
    () => directory.filter((user) => !operators.some((op) => op.id === user.id)),
    [directory, operators],
  );

  function openAdd() {
    setSelectedId("");
    setColor(OPERATOR_COLORS[0]!);
    setOpen(true);
  }

  if (addRef) addRef.current = openAdd;

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || saving) return;
    setSaving(true);
    try {
      setOperators(await addWaOperator(selectedId, color));
      setOpen(false);
      setSelectedId("");
      toast.success("Operadora agregada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo agregar");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(userId: string) {
    if (saving) return;
    setSaving(true);
    try {
      setOperators(await removeWaOperator(userId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo quitar");
    } finally {
      setSaving(false);
    }
  }

  const selected = available.find((user) => user.id === selectedId) ?? null;

  return (
    <>
      <section className="fl-table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th className="fl-col-actions fl-col-actions--2">Acciones</th>
              </tr>
            </thead>
            {!loading && operators.length > 0 ? (
              <tbody>
                {operators.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <span className="wa-tag" style={{ "--tag": user.color } as CSSProperties}>
                        {user.nombre}
                      </span>
                    </td>
                    <td>{user.email}</td>
                    <td className="fl-col-actions fl-col-actions--2">
                      <div className="fl-table-actions fl-table-actions--2">
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Quitar"
                          disabled={saving}
                          onClick={() => void onRemove(user.id)}
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
              <LoadingBlock label="Cargando operadoras…" />
            </div>
          ) : operators.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <div className="fl-table-empty__art">
                <IconFile size={32} />
              </div>
              <p className="fl-table-empty__title">Todavía no hay operadoras</p>
              <p className="fl-table-empty__hint">
                Agregá usuarios registrados para poder derivarles las conversaciones.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={open}
        title="Agregar operadora"
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
            <button type="submit" form="wa-operator-form" className="btn btn-primary" disabled={saving || !selectedId}>
              {saving ? "Agregando…" : "Agregar"}
            </button>
          </>
        }
      >
        <form id="wa-operator-form" onSubmit={(event) => void onAdd(event)}>
          <label className="form-group">
            <span>Usuario</span>
            <select
              className="ui-select"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={saving || available.length === 0}
              required
            >
              <option value="">
                {available.length === 0 ? "No hay más usuarios para agregar" : "Elegí un usuario"}
              </option>
              {available.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nombre} ({user.email})
                </option>
              ))}
            </select>
          </label>
          <div className="form-group">
            <label>Color</label>
            <div className="wa-tag-colors">
              {OPERATOR_COLORS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`wa-tag-swatch${color === item ? " is-active" : ""}`}
                  style={{ background: item }}
                  aria-label={item}
                  onClick={() => setColor(item)}
                />
              ))}
            </div>
          </div>
          <span className="wa-tag" style={{ "--tag": color } as CSSProperties}>
            {selected?.nombre || "Operadora"}
          </span>
        </form>
      </Modal>
    </>
  );
}
