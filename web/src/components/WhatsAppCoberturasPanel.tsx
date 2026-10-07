import { FormEvent, useEffect, useState, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import {
  createWaCobertura,
  deleteWaCobertura,
  fetchWaCoberturas,
  updateWaCobertura,
} from "../services/whatsappCrmService";
import type { WaCobertura, WaContactGrupoEtario } from "../types/whatsappCrm";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconFile, IconPencil, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

type Draft = {
  id: string | null;
  nombre: string;
  gruposEtarios: WaContactGrupoEtario[];
};

const emptyDraft = (): Draft => ({
  id: null,
  nombre: "",
  gruposEtarios: ["adulto"],
});

type Props = {
  createRef?: MutableRefObject<(() => void) | null>;
};

function gruposLabel(grupos: WaContactGrupoEtario[]): string {
  const hasInfanto = grupos.includes("infanto");
  const hasAdulto = grupos.includes("adulto");
  if (hasInfanto && hasAdulto) return "Infanto y Adulto";
  if (hasInfanto) return "Infanto";
  if (hasAdulto) return "Adulto";
  return "—";
}

export function WhatsAppCoberturasPanel({ createRef }: Props) {
  const [items, setItems] = useState<WaCobertura[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchWaCoberturas();
        if (!cancelled) setItems(data);
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "No se pudieron cargar las coberturas",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const removing = items.find((item) => item.id === removeId) ?? null;

  function openCreate() {
    setDraft(emptyDraft());
  }

  if (createRef) createRef.current = openCreate;

  function openEdit(item: WaCobertura) {
    setDraft({
      id: item.id,
      nombre: item.nombre,
      gruposEtarios: [...item.gruposEtarios],
    });
  }

  function toggleGrupo(grupo: WaContactGrupoEtario) {
    setDraft((current) => {
      if (!current) return current;
      const has = current.gruposEtarios.includes(grupo);
      return {
        ...current,
        gruposEtarios: has
          ? current.gruposEtarios.filter((g) => g !== grupo)
          : [...current.gruposEtarios, grupo],
      };
    });
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;
    const nombre = draft.nombre.trim();
    if (!nombre) {
      toast.error("Ingresá un nombre");
      return;
    }
    if (draft.gruposEtarios.length === 0) {
      toast.error("Elegí al menos Infanto o Adulto");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nombre,
        gruposEtarios: draft.gruposEtarios,
      };
      if (draft.id) {
        const updated = await updateWaCobertura(draft.id, payload);
        setItems((prev) =>
          prev
            .map((item) => (item.id === updated.id ? updated : item))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
        );
        toast.success("Cobertura actualizada");
      } else {
        const created = await createWaCobertura(payload);
        setItems((prev) =>
          [...prev, created].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
        );
        toast.success("Cobertura creada");
      }
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!removeId || saving) return;
    setSaving(true);
    try {
      await deleteWaCobertura(removeId);
      setItems((prev) => prev.filter((item) => item.id !== removeId));
      setRemoveId(null);
      toast.success("Cobertura eliminada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="fl-table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Grupo etario</th>
                <th className="fl-col-actions fl-col-actions--2">Acciones</th>
              </tr>
            </thead>
            {!loading && items.length > 0 ? (
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.nombre}</strong>
                    </td>
                    <td>{gruposLabel(item.gruposEtarios)}</td>
                    <td className="fl-col-actions fl-col-actions--2">
                      <div className="fl-table-actions fl-table-actions--2">
                        <button
                          type="button"
                          className="fl-icon-btn"
                          title="Editar"
                          onClick={() => openEdit(item)}
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="fl-icon-btn fl-icon-btn--danger"
                          title="Eliminar"
                          onClick={() => setRemoveId(item.id)}
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
              <LoadingBlock label="Cargando coberturas…" />
            </div>
          ) : items.length === 0 ? (
            <div className="fl-table-empty fl-table-empty--fill">
              <IconFile size={36} />
              <p className="fl-table-empty__title">Sin coberturas</p>
              <p className="fl-table-empty__hint">
                Creá las obras sociales disponibles según Infanto o Adulto.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "Editar cobertura" : "Nueva cobertura"}
        onClose={() => !saving && setDraft(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDraft(null)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="wa-cobertura-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </>
        }
      >
        {draft ? (
          <form id="wa-cobertura-form" className="form-grid" onSubmit={(e) => void onSave(e)}>
            <div className="form-group form-group--full">
              <label htmlFor="wa-cobertura-nombre">Nombre</label>
              <input
                id="wa-cobertura-nombre"
                value={draft.nombre}
                onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
                placeholder="Ej. OSPIS"
                required
                autoFocus
              />
            </div>
            <div className="form-group form-group--full">
              <span className="form-label-like">Aplica a</span>
              <div className="wa-cobertura-grupos">
                <label className="usuarios-modules-check wa-cobertura-check">
                  <input
                    type="checkbox"
                    checked={draft.gruposEtarios.includes("infanto")}
                    onChange={() => toggleGrupo("infanto")}
                  />
                  Infanto
                </label>
                <label className="usuarios-modules-check wa-cobertura-check">
                  <input
                    type="checkbox"
                    checked={draft.gruposEtarios.includes("adulto")}
                    onChange={() => toggleGrupo("adulto")}
                  />
                  Adulto
                </label>
              </div>
            </div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Eliminar cobertura"
        message={
          removing
            ? `¿Eliminar «${removing.nombre}»? Los contactos que ya la tengan seguirán mostrando el texto guardado.`
            : ""
        }
        confirmLabel="Eliminar"
        danger
        busy={saving}
        onCancel={() => setRemoveId(null)}
        onConfirm={() => void onRemove()}
      />
    </>
  );
}
