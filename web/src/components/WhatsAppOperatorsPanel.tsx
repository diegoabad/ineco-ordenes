import { FormEvent, useEffect, useMemo, useState, type CSSProperties, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import { fetchUserDirectory } from "../services/dataService";
import {
  addWaOperator,
  fetchWaOperatorAssignments,
  fetchWaOperators,
  removeWaOperator,
} from "../services/whatsappCrmService";
import type { UserDirectoryEntry } from "../types";
import type { WaOperator } from "../types/whatsappCrm";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconFile, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

const OPERATOR_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

type RemoveDraft = {
  operator: WaOperator;
  assignedCount: number;
  choice: string;
};

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
  const [removeDraft, setRemoveDraft] = useState<RemoveDraft | null>(null);
  const [simpleRemoveId, setSimpleRemoveId] = useState<string | null>(null);

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

  const transferOptions = useMemo(
    () =>
      removeDraft
        ? operators.filter((user) => user.id !== removeDraft.operator.id)
        : [],
    [operators, removeDraft],
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

  async function startRemove(operator: WaOperator) {
    if (saving) return;
    setSaving(true);
    try {
      const assignedCount = await fetchWaOperatorAssignments(operator.id);
      if (assignedCount <= 0) {
        setSimpleRemoveId(operator.id);
        return;
      }
      setRemoveDraft({
        operator,
        assignedCount,
        choice: "",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudieron consultar las conversaciones",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmSimpleRemove() {
    if (!simpleRemoveId || saving) return;
    setSaving(true);
    try {
      setOperators(await removeWaOperator(simpleRemoveId));
      setSimpleRemoveId(null);
      toast.success("Operadora eliminada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo quitar");
    } finally {
      setSaving(false);
    }
  }

  async function confirmAssignedRemove(event: FormEvent) {
    event.preventDefault();
    if (!removeDraft || saving) return;
    const choice = removeDraft.choice;
    if (!choice) {
      toast.error("Elegí qué hacer con las conversaciones");
      return;
    }
    setSaving(true);
    try {
      const reassign =
        choice === "none" || choice === "bot"
          ? { kind: choice }
          : { kind: "user" as const, userId: choice };
      setOperators(await removeWaOperator(removeDraft.operator.id, reassign));
      setRemoveDraft(null);
      toast.success("Operadora eliminada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo quitar");
    } finally {
      setSaving(false);
    }
  }

  const selected = available.find((user) => user.id === selectedId) ?? null;
  const simpleRemove = operators.find((user) => user.id === simpleRemoveId) ?? null;

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
                          onClick={() => void startRemove(user)}
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
              <label
                className={`wa-tag-swatch wa-tag-swatch--custom${
                  !OPERATOR_COLORS.includes(color.toLowerCase()) ? " is-active" : ""
                }`}
                title="Elegir color"
              >
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  aria-label="Elegir color personalizado"
                />
              </label>
            </div>
          </div>
          <span className="wa-tag" style={{ "--tag": color } as CSSProperties}>
            {selected?.nombre || "Operadora"}
          </span>
        </form>
      </Modal>

      <ConfirmDialog
        open={simpleRemove !== null}
        title="Eliminar operadora"
        message={
          simpleRemove
            ? `¿Quitar a ${simpleRemove.nombre}? No tiene conversaciones asignadas.`
            : ""
        }
        confirmLabel={saving ? "Eliminando…" : "Eliminar"}
        onConfirm={() => void confirmSimpleRemove()}
        onCancel={() => {
          if (!saving) setSimpleRemoveId(null);
        }}
      />

      <Modal
        open={removeDraft !== null}
        title="Eliminar operadora"
        onClose={() => {
          if (!saving) setRemoveDraft(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setRemoveDraft(null)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="wa-operator-remove-form"
              className="btn btn-danger"
              disabled={saving || !removeDraft?.choice}
            >
              {saving ? "Eliminando…" : "Eliminar"}
            </button>
          </>
        }
      >
        {removeDraft ? (
          <form
            id="wa-operator-remove-form"
            className="wa-operator-remove"
            onSubmit={(event) => void confirmAssignedRemove(event)}
          >
            <p className="wa-operator-remove__lead">
              <strong>{removeDraft.operator.nombre}</strong> tiene{" "}
              {removeDraft.assignedCount === 1
                ? "1 conversación asignada"
                : `${removeDraft.assignedCount} conversaciones asignadas`}
              .
            </p>
            <p className="wa-operator-remove__copy">
              Antes de eliminarla, elegí qué hacer con esas conversaciones.
            </p>
            <label className="form-group">
              <span className="wa-operator-remove__label">¿A dónde las pasamos?</span>
              <select
                className="ui-select"
                value={removeDraft.choice}
                onChange={(event) =>
                  setRemoveDraft((current) =>
                    current ? { ...current, choice: event.target.value } : current,
                  )
                }
                required
              >
                <option value="">Elegí una opción</option>
                <option value="none">Dejar sin asignar</option>
                <option value="bot">Pasar al bot</option>
                {transferOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.nombre}
                  </option>
                ))}
              </select>
            </label>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
