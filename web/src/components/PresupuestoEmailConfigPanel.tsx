import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "react-toastify";
import { canonicalRichHtml, normalizeRichHtml, richHtmlEquivalent } from "../lib/richText";
import {
  refreshTemplateVarDecorations,
  stripTemplateVarDecorations,
  TEMPLATE_VAR_TOKEN_RE,
} from "../lib/templateVars";
import {
  fetchPresupuestoEmailConfig,
  savePresupuestoEmailConfig,
} from "../services/dataService";
import type {
  PresupuestoEmailConfig,
  PresupuestoEmailTemplateVar,
} from "../types/presupuestoEmail";
import {
  EMPTY_PRESUPUESTO_EMAIL_CONFIG,
  PRESUPUESTO_EMAIL_TEMPLATE_VAR_LABELS,
} from "../types/presupuestoEmail";
import { BasicRichTextEditor } from "./BasicRichTextEditor";
import { TemplateVarTextField, type TemplateVarTextFieldHandle } from "./TemplateVarTextField";
import { IconAlert, IconCheck } from "./Icons";

function sameConfig(a: PresupuestoEmailConfig, b: PresupuestoEmailConfig): boolean {
  return (
    a.fromEmail === b.fromEmail &&
    a.fromName === b.fromName &&
    a.subject === b.subject &&
    richHtmlEquivalent(a.body, b.body)
  );
}

function normalizeConfig(config: PresupuestoEmailConfig): PresupuestoEmailConfig {
  return {
    ...config,
    body: canonicalRichHtml(config.body),
  };
}

type InsertTarget = "subject" | "body";

const VAR_GROUPS: { title: string; keys: readonly PresupuestoEmailTemplateVar[] }[] = [
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

function collectUsedVars(subject: string, body: string): Set<string> {
  const used = new Set<string>();
  const text = `${subject}\n${body}`;
  const re = new RegExp(TEMPLATE_VAR_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    used.add(match[1]!);
  }
  return used;
}

export function PresupuestoEmailConfigPanel() {
  const [form, setForm] = useState<PresupuestoEmailConfig>(EMPTY_PRESUPUESTO_EMAIL_CONFIG);
  const [saved, setSaved] = useState<PresupuestoEmailConfig>(EMPTY_PRESUPUESTO_EMAIL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);

  const subjectRef = useRef<TemplateVarTextFieldHandle>(null);
  const bodyAreaRef = useRef<HTMLDivElement | null>(null);
  const activeFieldRef = useRef<InsertTarget>("body");

  const dirty = !sameConfig(form, saved);
  const usedInSubject = collectUsedVars(form.subject, "");
  const usedInBody = collectUsedVars("", form.body);
  const usedVars = new Set<string>([...usedInSubject, ...usedInBody]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetchPresupuestoEmailConfig();
        if (cancelled) return;
        const data = normalizeConfig(res.data);
        setForm(data);
        setSaved(data);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "No se pudo cargar la config de email",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof PresupuestoEmailConfig>(key: K, value: PresupuestoEmailConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function rememberBodyField() {
    activeFieldRef.current = "body";
  }

  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const field = activeFieldRef.current;

    if (field === "body") {
      const el = bodyAreaRef.current;
      if (!el) return;
      el.focus();
      document.execCommand("insertText", false, token);
      const html = normalizeRichHtml(stripTemplateVarDecorations(el.innerHTML));
      set("body", html);
      refreshTemplateVarDecorations(el, html, true);
      return;
    }

    const subject = subjectRef.current;
    if (!subject) return;

    subject.rememberSelection();
    const { start, end } = subject.getSelection();
    const value = form.subject;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    const caret = start + token.length;

    set("subject", next);

    requestAnimationFrame(() => {
      subject.focus();
      subject.setSelection(caret, caret);
    });
  }

  function varLabel(key: string): string {
    return PRESUPUESTO_EMAIL_TEMPLATE_VAR_LABELS[key as PresupuestoEmailTemplateVar] ?? key;
  }

  function handleRestore() {
    setForm(saved);
    setEditorResetKey((key) => key + 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (!normalizeRichHtml(form.body).trim()) {
      toast.warning("Completá el cuerpo del mail");
      return;
    }
    setSaving(true);
    try {
      const payload = normalizeConfig({ ...form, body: normalizeRichHtml(form.body) });
      const next = normalizeConfig(await savePresupuestoEmailConfig(payload));
      setForm(next);
      setSaved(next);
      toast.success("Configuración de email guardada");
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
          <p className="fl-table-empty__title">Cargando configuración…</p>
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
              <section className="config-section">
                <header className="config-section__head">
                  <h3 className="config-section__title">Remitente</h3>
                </header>
                <div className="form-grid config-panel__grid">
                  <div className="form-group">
                    <label htmlFor="presup-fromEmail">Email remitente</label>
                    <input
                      id="presup-fromEmail"
                      type="email"
                      value={form.fromEmail}
                      onChange={(e) => set("fromEmail", e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="presup-fromName">Nombre remitente</label>
                    <input
                      id="presup-fromName"
                      value={form.fromName}
                      onChange={(e) => set("fromName", e.target.value)}
                      required
                    />
                  </div>
                </div>
              </section>

              <section className="config-section config-section--grow">
                <header className="config-section__head">
                  <h3 className="config-section__title">Plantilla del mail</h3>
                </header>
                <div className="form-group">
                  <label htmlFor="presup-subject">Asunto</label>
                  <TemplateVarTextField
                    id="presup-subject"
                    ref={subjectRef}
                    value={form.subject}
                    onChange={(v) => set("subject", v)}
                    onFocus={() => {
                      activeFieldRef.current = "subject";
                    }}
                    required
                    placeholder="Presupuesto - {{nombrePaciente}}"
                  />
                </div>
                <div className="form-group form-group--last">
                  <label htmlFor="presup-body">Cuerpo del mail</label>
                  <BasicRichTextEditor
                    id="presup-body"
                    className="config-panel__body-editor"
                    resetKey={`email-presup-${editorResetKey}`}
                    value={form.body}
                    highlightTemplateVars
                    onChange={(html) => set("body", canonicalRichHtml(html))}
                    placeholder="Cuerpo del mail. Enter = nueva línea. Pegar solo texto."
                    onAreaFocus={rememberBodyField}
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
                        const enAsunto = usedInSubject.has(v);
                        const enCuerpo = usedInBody.has(v);
                        const donde = enUso
                          ? [enAsunto ? "asunto" : null, enCuerpo ? "cuerpo" : null]
                              .filter(Boolean)
                              .join(" y ")
                          : "";
                        return (
                          <button
                            key={v}
                            type="button"
                            className={`config-var${enUso ? " is-used" : " is-unused"}`}
                            title={
                              enUso
                                ? `En uso (${donde}) · Insertar {{${v}}}`
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
              {saving ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
