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
  "maxReintentos": 2
}`;

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
