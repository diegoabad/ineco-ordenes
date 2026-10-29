import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  fetchWaDerivacionTurno,
  saveWaDerivacionTurno,
} from "../services/whatsappCrmService";
import type { WaDerivacionConfig, WaDerivacionRegla } from "../types/whatsappCrm";
import { IconPlus, IconTrash } from "./Icons";
import { LoadingBlock } from "./InecoMark";

function newId(): string {
  return `drv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function claveDesdeNombre(nombre: string): string {
  const parts = nombre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length >= 3);
  // En Medexis suele ser APELLIDO primero.
  return parts[0] || "";
}

export function WhatsAppDerivacionPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defaultRecepcionista, setDefaultRecepcionista] = useState("Florencia Sosa");
  const [reglas, setReglas] = useState<WaDerivacionRegla[]>([]);
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchWaDerivacionTurno();
        if (cancelled) return;
        setDefaultRecepcionista(data.defaultRecepcionista || "Florencia Sosa");
        setReglas(data.reglas || []);
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "No se pudo cargar la derivación",
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

  const visibles = useMemo(() => {
    const q = filtro
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim();
    if (!q) return reglas;
    return reglas.filter((r) => {
      const blob = `${r.profesionalNombre} ${r.profesionalClave} ${r.recepcionistaNombre}`
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [reglas, filtro]);

  function addRegla() {
    setReglas((prev) => [
      ...prev,
      {
        id: newId(),
        profesionalNombre: "",
        profesionalClave: "",
        recepcionistaNombre: defaultRecepcionista,
      },
    ]);
  }

  function updateRegla(id: string, patch: Partial<WaDerivacionRegla>) {
    setReglas((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (
          patch.profesionalNombre != null &&
          !String(patch.profesionalClave ?? row.profesionalClave).trim()
        ) {
          next.profesionalClave = claveDesdeNombre(patch.profesionalNombre);
        }
        return next;
      }),
    );
  }

  function removeRegla(id: string) {
    setReglas((prev) => prev.filter((row) => row.id !== id));
  }

  async function onSave() {
    if (saving) return;
    const limpias = reglas
      .map((row) => ({
        ...row,
        profesionalNombre: row.profesionalNombre.trim(),
        profesionalClave:
          row.profesionalClave.trim() || claveDesdeNombre(row.profesionalNombre),
        recepcionistaNombre: row.recepcionistaNombre.trim(),
      }))
      .filter(
        (row) =>
          row.profesionalNombre && row.profesionalClave && row.recepcionistaNombre,
      );
    if (!defaultRecepcionista.trim()) {
      toast.error("Indicá la recepcionista por defecto");
      return;
    }
    setSaving(true);
    try {
      const data: WaDerivacionConfig = await saveWaDerivacionTurno({
        defaultRecepcionista: defaultRecepcionista.trim(),
        reglas: limpias,
      });
      setDefaultRecepcionista(data.defaultRecepcionista);
      setReglas(data.reglas);
      toast.success("Derivación guardada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="fl-table-card wa-derivacion-panel">
        <LoadingBlock label="Cargando derivación…" />
      </div>
    );
  }

  return (
    <div className="fl-table-card wa-derivacion-panel">
      <div className="wa-derivacion-panel__intro">
        <p>
          Cuando el bot de menú cierra un <strong>pedido de turno</strong>, asigna la
          conversación según el profesional. Si no matchea ninguna fila, usa la
          recepcionista por defecto.
        </p>
      </div>

      <div className="wa-derivacion-panel__default">
        <label className="form-group">
          <span>Recepcionista por defecto</span>
          <input
            type="text"
            value={defaultRecepcionista}
            onChange={(e) => setDefaultRecepcionista(e.target.value)}
            placeholder="Florencia Sosa"
          />
        </label>
      </div>

      <div className="wa-derivacion-panel__toolbar">
        <input
          type="search"
          className="wa-derivacion-panel__search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar profesional o recepcionista…"
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={addRegla}>
          <IconPlus size={16} />
          Agregar
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={saving}
          onClick={() => void onSave()}
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      <div className="wa-derivacion-panel__table-wrap">
        <table className="wa-derivacion-panel__table">
          <thead>
            <tr>
              <th>Profesional</th>
              <th>Clave (apellido)</th>
              <th>Recepcionista</th>
              <th aria-label="Quitar" />
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr>
                <td colSpan={4} className="wa-derivacion-panel__empty">
                  No hay reglas{filtro.trim() ? " con ese filtro" : ""}.
                </td>
              </tr>
            ) : (
              visibles.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="text"
                      value={row.profesionalNombre}
                      onChange={(e) =>
                        updateRegla(row.id, { profesionalNombre: e.target.value })
                      }
                      placeholder="APELLIDO NOMBRE"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.profesionalClave}
                      onChange={(e) =>
                        updateRegla(row.id, { profesionalClave: e.target.value })
                      }
                      placeholder="apellido"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.recepcionistaNombre}
                      onChange={(e) =>
                        updateRegla(row.id, { recepcionistaNombre: e.target.value })
                      }
                      placeholder="Nombre recepcionista"
                    />
                  </td>
                  <td className="wa-derivacion-panel__actions">
                    <button
                      type="button"
                      className="fl-icon-btn"
                      aria-label="Quitar regla"
                      onClick={() => removeRegla(row.id)}
                    >
                      <IconTrash size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
