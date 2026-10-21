import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { toast } from "react-toastify";
import {
  fetchWhatsappBotConfig,
  saveWhatsappBotConfig,
} from "../services/whatsappCrmService";
import { JsonDynamicForm, parseConfigJsonObject } from "./JsonDynamicForm";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";
import "./JsonDynamicForm.css";

const EXAMPLE_JSON = `{
  "saludo": "Hola, ¿en qué te puedo ayudar?",
  "activo": true,
  "sedePorDefecto": "INECO",
  "maxReintentos": 2,
  "turnos": {
    "darTurnos": true
  }
}`;

function leerDarTurnos(config: Record<string, unknown> | null): boolean {
  if (!config) return true;
  const seccion =
    config.turnos && typeof config.turnos === "object" && !Array.isArray(config.turnos)
      ? (config.turnos as Record<string, unknown>)
      : {};
  const raw = seccion.darTurnos ?? config.darTurnos;
  if (raw === false || raw === 0 || raw === "0" || raw === "no" || raw === "false") return false;
  return true;
}

function conDarTurnos(
  config: Record<string, unknown> | null,
  darTurnos: boolean,
): Record<string, unknown> {
  const base = { ...(config ?? {}) };
  const prev =
    base.turnos && typeof base.turnos === "object" && !Array.isArray(base.turnos)
      ? (base.turnos as Record<string, unknown>)
      : {};
  base.turnos = { ...prev, darTurnos };
  return base;
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Props = {
  openJsonRef?: MutableRefObject<(() => void) | null>;
  onStatusChange?: (status: { hasConfig: boolean; saving: boolean }) => void;
};

export function WhatsAppConfigPanel({ openJsonRef, onStatusChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutosave = useRef(true);

  const hasConfig = !!(config && Object.keys(config).length > 0);

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  useEffect(() => {
    onStatusChangeRef.current?.({ hasConfig, saving });
  }, [hasConfig, saving]);

  const load = useCallback(async () => {
    setLoading(true);
    skipAutosave.current = true;
    try {
      const res = await fetchWhatsappBotConfig();
      setConfig(res.data);
      setUpdatedAt(res.updatedAt);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar la configuración");
      setConfig(null);
    } finally {
      setLoading(false);
      window.setTimeout(() => {
        skipAutosave.current = false;
      }, 0);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  const openJsonModal = useCallback(() => {
    setJsonError("");
    setJsonText(
      config && Object.keys(config).length
        ? JSON.stringify(config, null, 2)
        : EXAMPLE_JSON,
    );
    setJsonModalOpen(true);
  }, [config]);

  useEffect(() => {
    if (!openJsonRef) return;
    openJsonRef.current = openJsonModal;
    return () => {
      openJsonRef.current = null;
    };
  }, [openJsonRef, openJsonModal]);

  const persistConfig = async (
    next: Record<string, unknown>,
    successMessage?: string,
    jsonSource?: string,
  ): Promise<boolean> => {
    if (!Object.keys(next).length) {
      toast.error("No hay configuración para guardar");
      return false;
    }
    setSaving(true);
    try {
      // Si viene del textarea, guardar ese texto para conservar el orden de claves.
      const json =
        typeof jsonSource === "string" && jsonSource.trim()
          ? jsonSource
          : JSON.stringify(next, null, 2);
      const saved = await saveWhatsappBotConfig(next, { json });
      skipAutosave.current = true;
      setConfig(saved.data);
      setUpdatedAt(saved.updatedAt);
      window.setTimeout(() => {
        skipAutosave.current = false;
      }, 0);
      if (successMessage) toast.success(successMessage);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const applyJson = async () => {
    try {
      const parsed = parseConfigJsonObject(jsonText);
      setJsonError("");
      const ok = await persistConfig(
        parsed,
        hasConfig ? "Configuración actualizada y guardada" : "Configuración creada y guardada",
        jsonText,
      );
      if (ok) setJsonModalOpen(false);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "JSON inválido");
    }
  };

  const onConfigChange = (next: unknown) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) return;
    const data = next as Record<string, unknown>;
    setConfig(data);
    if (skipAutosave.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void persistConfig(data);
    }, 700);
  };

  if (loading) {
    return <LoadingBlock label="Cargando configuración…" />;
  }

  return (
    <div className="wa-config-panel fl-table-card">
      {saving ? (
        <div className="wa-config-panel__saving" aria-live="polite">
          Guardando…
        </div>
      ) : null}

      <div className="wa-config-panel__body">
        <section className="wa-config-panel__turnos">
          <h3 className="wa-config-panel__turnos-title">Turnos</h3>
          <p className="wa-config-panel__hint">
            Aplica al bot de IA y al bot de menú. Si está en No, puede ver/cancelar turnos
            existentes y tomar datos, pero el turno lo asigna un operador.
          </p>
          <label className={`wa-motor-toggle${leerDarTurnos(config) ? " is-on" : ""}`}>
            <span className="wa-motor-toggle__label">Dar turnos (buscar profesionales, horarios y reservar)</span>
            <span className="wa-motor-toggle__control">
              <input
                type="checkbox"
                checked={leerDarTurnos(config)}
                disabled={saving}
                onChange={(e) => {
                  const next = conDarTurnos(config, e.target.checked);
                  setConfig(next);
                  void persistConfig(next, e.target.checked ? "Dar turnos activado" : "Dar turnos desactivado");
                }}
              />
              <span className="wa-motor-toggle__track" aria-hidden>
                <span className="wa-motor-toggle__thumb" />
              </span>
              <span className="wa-motor-toggle__state">{leerDarTurnos(config) ? "Sí" : "No"}</span>
            </span>
          </label>
        </section>

        {hasConfig ? (
          <JsonDynamicForm value={config} onChange={onConfigChange} />
        ) : (
          <div className="wa-config-panel__empty">
            <p>No hay configuración todavía.</p>
            <p>Usá <strong>Crear configuración</strong> arriba para pegar un JSON.</p>
          </div>
        )}
      </div>

      {updatedAt ? (
        <div className="wa-config-panel__footer-meta">
          <span className="wa-config-panel__meta">
            Última guardada: {formatSavedAt(updatedAt)}
          </span>
        </div>
      ) : null}

      <Modal
        open={jsonModalOpen}
        title={hasConfig ? "Actualizar configuración" : "Crear configuración"}
        onClose={() => {
          setJsonModalOpen(false);
          setJsonError("");
        }}
        wide
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setJsonModalOpen(false);
                setJsonError("");
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void applyJson()}
            >
              {saving ? "Guardando…" : "Aplicar y guardar"}
            </button>
          </>
        }
      >
        <p className="wa-config-panel__modal-hint">
          Pegá un objeto JSON. Se guarda en Firebase al confirmar.
        </p>
        <textarea
          className="wa-config-panel__textarea"
          rows={16}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            if (jsonError) setJsonError("");
          }}
          spellCheck={false}
          placeholder='{"saludo":"Hola","activo":true}'
        />
        {jsonError ? (
          <p className="wa-config-panel__error" role="alert">
            {jsonError}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
