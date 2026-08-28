import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import { canonicalRichHtml, normalizeRichHtml, richHtmlEquivalent } from "../lib/richText";
import {
  refreshTemplateVarDecorations,
  stripTemplateVarDecorations,
  TEMPLATE_VAR_TOKEN_RE,
} from "../lib/templateVars";
import {
  fetchPresupuestoPlantillaConfig,
  savePresupuestoPlantillaConfig,
} from "../services/dataService";
import type {
  PresupuestoPlantillaConfig,
  PresupuestoPlantillaVar,
} from "../types/presupuestoPlantilla";
import {
  EMPTY_PRESUPUESTO_PLANTILLA_CONFIG,
  PRESUPUESTO_PLANTILLA_VAR_LABELS,
} from "../types/presupuestoPlantilla";
import { BasicRichTextEditor } from "./BasicRichTextEditor";
import { IconAlert, IconCheck } from "./Icons";

const TOKEN_RE = TEMPLATE_VAR_TOKEN_RE;

const VAR_GROUPS: { title: string; keys: readonly PresupuestoPlantillaVar[] }[] = [
  {
    title: "Paciente",
    keys: ["nombrePaciente", "email"],
  },
  {
    title: "Profesional",
    keys: ["nombreProfesional"],
  },
  {
    title: "Presupuesto",
    keys: ["fechaPresupuesto", "totalEfectivo", "total3Cuotas"],
  },
  {
    title: "Prestaciones",
    keys: ["cantidadPrestaciones", "listaPrestaciones"],
  },
];

function sameConfig(a: PresupuestoPlantillaConfig, b: PresupuestoPlantillaConfig): boolean {
  return richHtmlEquivalent(a.body, b.body);
}

function normalizeConfig(config: PresupuestoPlantillaConfig): PresupuestoPlantillaConfig {
  return {
    body: canonicalRichHtml(config.body),
  };
}

function collectUsedVars(body: string): Set<string> {
  const used = new Set<string>();
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    used.add(match[1]!);
  }
  return used;
}

export function PresupuestoPlantillaPanel() {
  const [form, setForm] = useState<PresupuestoPlantillaConfig>(EMPTY_PRESUPUESTO_PLANTILLA_CONFIG);
  const [saved, setSaved] = useState<PresupuestoPlantillaConfig>(EMPTY_PRESUPUESTO_PLANTILLA_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);

  const bodyAreaRef = useRef<HTMLDivElement | null>(null);
  const dirty = !sameConfig(form, saved);
  const usedVars = collectUsedVars(form.body);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetchPresupuestoPlantillaConfig();
        if (cancelled) return;
        const data = normalizeConfig(res.data);
        setForm(data);
        setSaved(data);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "No se pudo cargar la plantilla de presupuesto",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const el = bodyAreaRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertText", false, token);
    const html = normalizeRichHtml(stripTemplateVarDecorations(el.innerHTML));
    setForm((prev) => ({ ...prev, body: html }));
    refreshTemplateVarDecorations(el, html, true);
  }

  function varLabel(key: string): string {
    return PRESUPUESTO_PLANTILLA_VAR_LABELS[key as PresupuestoPlantillaVar] ?? key;
  }

  function handleRestore() {
    setForm(saved);
    setEditorResetKey((key) => key + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      const payload = normalizeConfig({ body: normalizeRichHtml(form.body) });
      const next = normalizeConfig(await savePresupuestoPlantillaConfig(payload));
      setForm(next);
      setSaved(next);
      toast.success("Plantilla de presupuesto guardada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="fl-table-card config-panel">
        <div className="fl-table-empty config-panel__loading">
          <p className="fl-table-empty__title">Cargando plantilla…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="fl-table-card config-panel">
      <form className="config-panel__form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="config-panel__body">
          <div className="config-panel__layout">
            <div className="config-panel__main">
              <section className="config-section config-section--grow">
                <header className="config-section__head">
                  <h3 className="config-section__title">Plantilla del presupuesto</h3>
                </header>
                <div className="form-group form-group--last">
                  <label htmlFor="presup-plantilla-body">Cuerpo</label>
                  <BasicRichTextEditor
                    id="presup-plantilla-body"
                    className="config-panel__body-editor"
                    resetKey={`plantilla-${editorResetKey}`}
                    value={form.body}
                    highlightTemplateVars
                    onChange={(html) =>
                      setForm((prev) => ({ ...prev, body: canonicalRichHtml(html) }))
                    }
                    placeholder="Contenido de la plantilla. Enter = nueva línea. Pegar solo texto."
                    onAreaMount={(el) => {
                      bodyAreaRef.current = el;
                    }}
                  />
                </div>
              </section>
            </div>

            <aside className="config-panel__aside" aria-label="Variables de plantilla">
              <header className="config-section__head">
                <h3 className="config-section__title">Variables</h3>
              </header>
              <div className="config-vars-groups">
                {VAR_GROUPS.map((group) => (
                  <div key={group.title} className="config-vars-group">
                    <p className="config-vars-group__title">{group.title}</p>
                    <div className="config-vars__list">
                      {group.keys.map((v) => {
                        const enUso = usedVars.has(v);
                        return (
                          <button
                            key={v}
                            type="button"
                            className={`config-var${enUso ? " is-used" : " is-unused"}`}
                            title={
                              enUso
                                ? `En uso · Insertar {{${v}}}`
                                : `Sin usar · Insertar {{${v}}}`
                            }
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertVariable(v)}
                          >
                            {varLabel(v)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>

        <div className="config-panel__footer">
          <span className={`chip config-panel__status${dirty ? " is-dirty" : " is-saved"}`}>
            {dirty ? (
              <>
                <IconAlert size={14} />
                Hay cambios sin guardar
              </>
            ) : (
              <>
                <IconCheck size={14} />
                Todo guardado
              </>
            )}
          </span>
          <div className="config-panel__footer-actions">
            {dirty ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={handleRestore}
              >
                Restaurar
              </button>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
              {saving ? "Guardando…" : "Guardar plantilla"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
