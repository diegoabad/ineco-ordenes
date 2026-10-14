import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "react-toastify";
import {
  fetchWhatsappMotorConfig,
  saveWhatsappMotorConfig,
  type WaMotorConfig,
} from "../services/whatsappCrmService";
import { LoadingBlock } from "./InecoMark";

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

type BoolField = {
  key: string;
  label: string;
  hint?: string;
};

type CategoryDef = {
  id: keyof WaMotorConfig;
  title: string;
  bools: BoolField[];
  textFields?: { key: string; label: string; hint?: string; multiline?: boolean }[];
};

const CATEGORIES: CategoryDef[] = [
  {
    id: "interpretacion",
    title: "Interpretación",
    bools: [
      { key: "detectarDatosAutomaticamente", label: "Detectar datos automáticamente" },
      { key: "detectarCambiosDeTema", label: "Detectar cambios de tema" },
      { key: "detectarIntencion", label: "Detectar intención" },
    ],
  },
  {
    id: "contexto",
    title: "Contexto",
    bools: [
      { key: "reutilizarDatosConocidos", label: "Reutilizar datos conocidos" },
      { key: "permitirCorrecciones", label: "Permitir correcciones" },
      { key: "conservarContexto", label: "Conservar contexto" },
      { key: "evitarPreguntasRepetidas", label: "Evitar preguntas repetidas" },
      { key: "omitirPreguntaSiMotivoConocido", label: "Omitir pregunta si el motivo es conocido" },
    ],
  },
  {
    id: "intenciones",
    title: "Intenciones",
    bools: [
      { key: "permitirCambiosDeIntencion", label: "Permitir cambios de intención" },
      { key: "permitirInterrupciones", label: "Permitir interrupciones" },
      { key: "retomarIntencionAnterior", label: "Retomar intención anterior" },
    ],
  },
  {
    id: "tiempo",
    title: "Tiempo",
    bools: [
      { key: "incluirFechaHoraActual", label: "Incluir fecha y hora actual" },
      { key: "interpretarFechasRelativas", label: "Interpretar fechas relativas" },
    ],
  },
  {
    id: "mensajeria",
    title: "Mensajería",
    bools: [
      { key: "agruparMensajes", label: "Agrupar mensajes" },
      { key: "evitarMensajesDuplicados", label: "Evitar mensajes duplicados" },
    ],
  },
  {
    id: "seguridad",
    title: "Seguridad",
    bools: [
      { key: "detectarRiesgos", label: "Detectar riesgos" },
      { key: "evaluacionPrioritaria", label: "Evaluación prioritaria" },
    ],
  },
  {
    id: "administracion",
    title: "Administración",
    bools: [],
    textFields: [
      { key: "id", label: "Id" },
      { key: "version", label: "Versión" },
    ],
  },
];

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className={`wa-motor-toggle${checked ? " is-on" : ""}`}>
      <span className="wa-motor-toggle__label">{label}</span>
      <span className="wa-motor-toggle__control">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="wa-motor-toggle__track" aria-hidden>
          <span className="wa-motor-toggle__thumb" />
        </span>
        <span className="wa-motor-toggle__state">{checked ? "Sí" : "No"}</span>
      </span>
    </label>
  );
}

function CategorySection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`wa-motor-card${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="wa-motor-card__title"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {title}
      </button>
      {open ? <div className="wa-motor-card__body">{children}</div> : null}
    </section>
  );
}

export function WhatsAppMotorPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<WaMotorConfig | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutosave = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    skipAutosave.current = true;
    try {
      const res = await fetchWhatsappMotorConfig();
      setConfig(res.data);
      setUpdatedAt(res.updatedAt);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cargar el motor");
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

  const persist = useCallback(async (next: WaMotorConfig) => {
    setSaving(true);
    try {
      const saved = await saveWhatsappMotorConfig(next);
      skipAutosave.current = true;
      setConfig(saved.data);
      setUpdatedAt(saved.updatedAt);
      window.setTimeout(() => {
        skipAutosave.current = false;
      }, 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar el motor");
    } finally {
      setSaving(false);
    }
  }, []);

  const schedulePersist = useCallback(
    (next: WaMotorConfig) => {
      setConfig(next);
      if (skipAutosave.current) return;
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void persist(next);
      }, 700);
    },
    [persist],
  );

  const setBool = (
    category: keyof WaMotorConfig,
    key: string,
    value: boolean,
  ) => {
    if (!config) return;
    const section = { ...(config[category] as Record<string, unknown>), [key]: value };
    schedulePersist({ ...config, [category]: section } as WaMotorConfig);
  };

  const setText = (category: keyof WaMotorConfig, key: string, value: string) => {
    if (!config) return;
    const section = { ...(config[category] as Record<string, unknown>), [key]: value };
    schedulePersist({ ...config, [category]: section } as WaMotorConfig);
  };

  if (loading || !config) {
    return <LoadingBlock label="Cargando motor…" />;
  }

  return (
    <div className="wa-config-panel wa-motor-panel fl-table-card">
      {saving ? (
        <div className="wa-config-panel__saving" aria-live="polite">
          Guardando…
        </div>
      ) : null}

      <div className="wa-config-panel__body">
        <div className="wa-motor-list">
          {CATEGORIES.map((cat) => {
            const section = config[cat.id] as Record<string, unknown>;
            return (
              <CategorySection key={cat.id} title={cat.title} defaultOpen>
                <div className="wa-motor-fields">
                  {cat.bools.map((field) => (
                    <ToggleSwitch
                      key={field.key}
                      label={field.label}
                      checked={Boolean(section[field.key])}
                      onChange={(next) => setBool(cat.id, field.key, next)}
                    />
                  ))}
                  {cat.textFields?.map((field) => (
                    <div key={field.key} className="wa-motor-field">
                      <label className="wa-motor-field__label">{field.label}</label>
                      {field.hint ? (
                        <p className="wa-motor-field__hint">{field.hint}</p>
                      ) : null}
                      {field.multiline ? (
                        <textarea
                          className="wa-motor-field__input"
                          rows={3}
                          value={String(section[field.key] ?? "")}
                          onChange={(e) => setText(cat.id, field.key, e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          className="wa-motor-field__input"
                          value={String(section[field.key] ?? "")}
                          onChange={(e) => setText(cat.id, field.key, e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </CategorySection>
            );
          })}
        </div>
      </div>

      {updatedAt ? (
        <div className="wa-config-panel__footer-meta">
          <span className="wa-config-panel__meta">
            Última guardada: {formatSavedAt(updatedAt)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
