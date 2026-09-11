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
  PresupuestoEmailTemplateKind,
  PresupuestoEmailTemplateVar,
} from "../types/presupuestoEmail";
import {
  EMAIL_TEMPLATE_VARS_BY_KIND,
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
    richHtmlEquivalent(a.body, b.body) &&
    a.linkPagoSubject === b.linkPagoSubject &&
    richHtmlEquivalent(a.linkPagoBody, b.linkPagoBody)
  );
}

function normalizeConfig(config: PresupuestoEmailConfig): PresupuestoEmailConfig {
  return {
    ...config,
    body: canonicalRichHtml(config.body),
    linkPagoBody: canonicalRichHtml(config.linkPagoBody),
  };
}

type InsertTarget = "subject" | "body";

type VarGroup = {
  title: string;
  keys: readonly PresupuestoEmailTemplateVar[];
};

const VAR_GROUPS_BY_KIND: Record<PresupuestoEmailTemplateKind, VarGroup[]> = {
  presupuesto: [
    { title: "Paciente", keys: ["nombrePaciente", "email"] },
    { title: "Profesional", keys: ["nombreProfesional"] },
    { title: "Presupuesto", keys: ["fechaPresupuesto", "totalEfectivo", "total3Cuotas"] },
    { title: "Prestaciones", keys: ["cantidadPrestaciones", "listaPrestaciones"] },
  ],
  linkPago: [
    { title: "Paciente", keys: ["nombrePaciente", "email"] },
    { title: "Profesional", keys: ["nombreProfesional"] },
    { title: "Presupuesto", keys: ["fechaPresupuesto", "totalEfectivo", "total3Cuotas"] },
    { title: "Prestaciones", keys: ["cantidadPrestaciones", "listaPrestaciones"] },
    { title: "Pago", keys: ["linkPago"] },
  ],
};

const KIND_LABEL: Record<PresupuestoEmailTemplateKind, string> = {
  presupuesto: "Presupuesto",
  linkPago: "Link de pago",
};

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

function activeSubject(config: PresupuestoEmailConfig, kind: PresupuestoEmailTemplateKind): string {
  return kind === "linkPago" ? config.linkPagoSubject : config.subject;
}

function activeBody(config: PresupuestoEmailConfig, kind: PresupuestoEmailTemplateKind): string {
  return kind === "linkPago" ? config.linkPagoBody : config.body;
}

export function PresupuestoEmailConfigPanel() {
  const [form, setForm] = useState<PresupuestoEmailConfig>(EMPTY_PRESUPUESTO_EMAIL_CONFIG);
  const [saved, setSaved] = useState<PresupuestoEmailConfig>(EMPTY_PRESUPUESTO_EMAIL_CONFIG);
  const [kind, setKind] = useState<PresupuestoEmailTemplateKind>("presupuesto");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);

  const subjectRef = useRef<TemplateVarTextFieldHandle>(null);
  const bodyAreaRef = useRef<HTMLDivElement | null>(null);
  const activeFieldRef = useRef<InsertTarget>("body");

  const dirty = !sameConfig(form, saved);
  const subjectValue = activeSubject(form, kind);
  const bodyValue = activeBody(form, kind);
  const usedInSubject = collectUsedVars(subjectValue, "");
  const usedInBody = collectUsedVars("", bodyValue);
  const usedVars = new Set<string>([...usedInSubject, ...usedInBody]);
  const varGroups = VAR_GROUPS_BY_KIND[kind];
  const allowedVars = new Set(EMAIL_TEMPLATE_VARS_BY_KIND[kind]);

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

  function setRemitente<K extends "fromEmail" | "fromName">(
    key: K,
    value: PresupuestoEmailConfig[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setActiveSubject(value: string) {
    setForm((prev) =>
      kind === "linkPago" ? { ...prev, linkPagoSubject: value } : { ...prev, subject: value },
    );
  }

  function setActiveBody(value: string) {
    setForm((prev) =>
      kind === "linkPago" ? { ...prev, linkPagoBody: value } : { ...prev, body: value },
    );
  }

  function changeKind(next: PresupuestoEmailTemplateKind) {
    if (next === kind) return;
    setKind(next);
    activeFieldRef.current = "body";
    setEditorResetKey((key) => key + 1);
  }

  function rememberBodyField() {
    activeFieldRef.current = "body";
  }

  function insertVariable(key: string) {
    if (!allowedVars.has(key as PresupuestoEmailTemplateVar)) return;
    const token = `{{${key}}}`;
    const field = activeFieldRef.current;

    if (field === "body") {
      const el = bodyAreaRef.current;
      if (!el) return;
      el.focus();
      document.execCommand("insertText", false, token);
      const html = normalizeRichHtml(stripTemplateVarDecorations(el.innerHTML));
      setActiveBody(html);
      refreshTemplateVarDecorations(el, html, true);
      return;
    }

    const subject = subjectRef.current;
    if (!subject) return;

    subject.rememberSelection();
    const { start, end } = subject.getSelection();
    const value = subjectValue;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    const caret = start + token.length;

    setActiveSubject(next);

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
      toast.warning("Completá el cuerpo del mail de presupuesto");
      return;
    }
    if (!normalizeRichHtml(form.linkPagoBody).trim()) {
      toast.warning("Completá el cuerpo del mail de link de pago");
      return;
    }
    if (!form.subject.trim()) {
      toast.warning("Completá el asunto del mail de presupuesto");
      return;
    }
    if (!form.linkPagoSubject.trim()) {
      toast.warning("Completá el asunto del mail de link de pago");
      return;
    }
    setSaving(true);
    try {
      const payload = normalizeConfig({
        ...form,
        body: normalizeRichHtml(form.body),
        linkPagoBody: normalizeRichHtml(form.linkPagoBody),
      });
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
              <details className="config-section config-section--collapsible">
                <summary className="config-section__summary">
                  <div className="config-section__lead">
                    <h3 className="config-section__title">Remitente</h3>
                    <span className="config-section__hint">Email y nombre de envío</span>
                  </div>
                </summary>
                <div className="form-grid config-panel__grid config-section__body">
                  <div className="form-group">
                    <label htmlFor="presup-fromEmail">Email remitente</label>
                    <input
                      id="presup-fromEmail"
                      type="email"
                      value={form.fromEmail}
                      onChange={(e) => setRemitente("fromEmail", e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="presup-fromName">Nombre remitente</label>
                    <input
                      id="presup-fromName"
                      value={form.fromName}
                      onChange={(e) => setRemitente("fromName", e.target.value)}
                      required
                    />
                  </div>
                </div>
              </details>

              <section className="config-section config-section--grow">
                <header className="config-section__head config-section__head--with-select">
                  <h3 className="config-section__title">Plantilla del mail</h3>
                  <label className="config-section__kind">
                    <select
                      value={kind}
                      onChange={(e) =>
                        changeKind(e.target.value as PresupuestoEmailTemplateKind)
                      }
                      aria-label="Tipo de plantilla"
                    >
                      <option value="presupuesto">{KIND_LABEL.presupuesto}</option>
                      <option value="linkPago">{KIND_LABEL.linkPago}</option>
                    </select>
                  </label>
                </header>
                <div className="form-group">
                  <label htmlFor="presup-subject">Asunto</label>
                  <TemplateVarTextField
                    id="presup-subject"
                    key={`subject-${kind}`}
                    ref={subjectRef}
                    value={subjectValue}
                    onChange={setActiveSubject}
                    onFocus={() => {
                      activeFieldRef.current = "subject";
                    }}
                    required
                    placeholder={
                      kind === "linkPago"
                        ? "Link de pago - {{nombrePaciente}}"
                        : "Presupuesto - {{nombrePaciente}}"
                    }
                  />
                </div>
                <div className="form-group form-group--last">
                  <label htmlFor="presup-body">Cuerpo del mail</label>
                  <BasicRichTextEditor
                    id="presup-body"
                    className="config-panel__body-editor"
                    resetKey={`email-presup-${kind}-${editorResetKey}`}
                    value={bodyValue}
                    highlightTemplateVars
                    onChange={(html) => setActiveBody(canonicalRichHtml(html))}
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
                <p className="config-section__hint">{KIND_LABEL[kind]}</p>
              </header>
              <div className="config-vars-groups">
                {varGroups.map((group) => (
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
