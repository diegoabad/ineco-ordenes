import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "react-toastify";
import { fetchEmailConfig, saveEmailConfig } from "../services/dataService";
import type { EmailConfig, EmailTemplateVar } from "../types/email";
import {
  EMAIL_TEMPLATE_VAR_LABELS,
  EMPTY_EMAIL_CONFIG,
} from "../types/email";
import { IconAlert, IconCheck } from "./Icons";

function sameConfig(a: EmailConfig, b: EmailConfig): boolean {
  return (
    a.fromEmail === b.fromEmail &&
    a.fromName === b.fromName &&
    a.subject === b.subject &&
    a.body === b.body
  );
}

type InsertTarget = "subject" | "body";

const VAR_GROUPS: { title: string; keys: readonly EmailTemplateVar[] }[] = [
  {
    title: "Paciente",
    keys: ["nombrePaciente", "email", "obraSocial", "afiliado", "diagnostico", "prestacion"],
  },
  {
    title: "Médico",
    keys: ["nombreMedico", "especialidad", "matricula"],
  },
  {
    title: "Orden",
    keys: ["fechaOrden"],
  },
];

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Claves viejas → actuales (para detectar uso en plantillas mezcladas). */
const VAR_ALIASES: Record<string, EmailTemplateVar> = {
  nombre: "nombrePaciente",
  medico: "nombreMedico",
  fecha: "fechaOrden",
};

function normalizeVarKey(key: string): string {
  return VAR_ALIASES[key] ?? key;
}

/** {{clave}} completa en asunto o cuerpo. Si no queda ninguna, se destilda. */
function collectUsedVars(subject: string, body: string): Set<string> {
  const used = new Set<string>();
  const text = `${subject}\n${body}`;
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    used.add(normalizeVarKey(match[1]!));
  }
  return used;
}

type TokenRange = { start: number; end: number };

function listTokens(text: string): TokenRange[] {
  const tokens: TokenRange[] = [];
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Token bajo el cursor o que se borraría con Backspace/Supr. */
function tokenForDelete(
  text: string,
  pos: number,
  key: "Backspace" | "Delete",
): TokenRange | null {
  for (const t of listTokens(text)) {
    if (pos > t.start && pos < t.end) return t;
    if (key === "Backspace" && pos === t.end) return t;
    if (key === "Delete" && pos === t.start) return t;
  }
  return null;
}

/** Si la selección toca un token, la amplía para cubrir tokens enteros. */
function expandSelectionToTokens(text: string, start: number, end: number): TokenRange {
  let s = start;
  let e = end;
  for (const t of listTokens(text)) {
    const overlaps = s < t.end && e > t.start;
    if (overlaps) {
      s = Math.min(s, t.start);
      e = Math.max(e, t.end);
    }
  }
  return { start: s, end: e };
}

export function EmailConfigPanel() {
  const [form, setForm] = useState<EmailConfig>(EMPTY_EMAIL_CONFIG);
  const [saved, setSaved] = useState<EmailConfig>(EMPTY_EMAIL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const activeFieldRef = useRef<InsertTarget>("body");
  const selectionRef = useRef({ start: 0, end: 0 });

  const dirty = !sameConfig(form, saved);
  const usedInSubject = collectUsedVars(form.subject, "");
  const usedInBody = collectUsedVars("", form.body);
  const usedVars = new Set<string>([...usedInSubject, ...usedInBody]);

  // Siempre las agrupaciones fijas (no depender de lo que devuelva la API).
  const groupedVars = VAR_GROUPS;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetchEmailConfig();
        if (cancelled) return;
        setForm(res.data);
        setSaved(res.data);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo cargar la config de email");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof EmailConfig>(key: K, value: EmailConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function rememberField(field: InsertTarget, el: HTMLInputElement | HTMLTextAreaElement) {
    activeFieldRef.current = field;
    selectionRef.current = {
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
    };
  }

  function applyFieldValue(
    field: InsertTarget,
    next: string,
    caret: number,
    el: HTMLInputElement | HTMLTextAreaElement,
  ) {
    setForm((prev) => ({ ...prev, [field]: next }));
    el.value = next;
    el.setSelectionRange(caret, caret);
    selectionRef.current = { start: caret, end: caret };
    activeFieldRef.current = field;
  }

  /** Backspace/Supr sobre {{variable}} la borra entera. */
  function handleTemplateKeyDown(field: InsertTarget, e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key !== "Backspace" && e.key !== "Delete") return;

    const el = e.currentTarget;
    const value = el.value;
    const selStart = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? 0;

    if (selStart !== selEnd) {
      const expanded = expandSelectionToTokens(value, selStart, selEnd);
      if (expanded.start !== selStart || expanded.end !== selEnd) {
        e.preventDefault();
        const next = value.slice(0, expanded.start) + value.slice(expanded.end);
        applyFieldValue(field, next, expanded.start, el);
      }
      return;
    }

    const token = tokenForDelete(value, selStart, e.key as "Backspace" | "Delete");
    if (!token) return;

    e.preventDefault();
    const next = value.slice(0, token.start) + value.slice(token.end);
    applyFieldValue(field, next, token.start, el);
  }

  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const field = activeFieldRef.current;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    if (!el) return;

    const start = selectionRef.current.start;
    const end = selectionRef.current.end;
    const value = field === "subject" ? form.subject : form.body;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    const caret = start + token.length;

    set(field, next);

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      selectionRef.current = { start: caret, end: caret };
    });
  }

  function varLabel(key: string): string {
    return EMAIL_TEMPLATE_VAR_LABELS[key as EmailTemplateVar] ?? key;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    try {
      const next = await saveEmailConfig(form);
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
                  <p className="config-section__hint">
                    Quién aparece como remitente cuando se envía la orden.
                  </p>
                </header>
                <div className="form-grid config-panel__grid">
                  <div className="form-group">
                    <label htmlFor="fromEmail">Email remitente</label>
                    <input
                      id="fromEmail"
                      type="email"
                      value={form.fromEmail}
                      onChange={(e) => set("fromEmail", e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="fromName">Nombre remitente</label>
                    <input
                      id="fromName"
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
                  <p className="config-section__hint">
                    Asunto y cuerpo que recibe el paciente. Usá las variables de la derecha.
                  </p>
                </header>
                <div className="form-group">
                  <label htmlFor="subject">Asunto</label>
                  <input
                    id="subject"
                    ref={subjectRef}
                    value={form.subject}
                    onChange={(e) => set("subject", e.target.value)}
                    onFocus={(e) => rememberField("subject", e.currentTarget)}
                    onSelect={(e) => rememberField("subject", e.currentTarget)}
                    onKeyDown={(e) => handleTemplateKeyDown("subject", e)}
                    onKeyUp={(e) => rememberField("subject", e.currentTarget)}
                    onClick={(e) => rememberField("subject", e.currentTarget)}
                    required
                    placeholder="Orden médica - {{nombrePaciente}}"
                  />
                </div>
                <div className="form-group form-group--last">
                  <label htmlFor="body">Cuerpo del mail</label>
                  <textarea
                    id="body"
                    className="config-panel__body-input"
                    ref={bodyRef}
                    rows={9}
                    value={form.body}
                    onChange={(e) => set("body", e.target.value)}
                    onFocus={(e) => rememberField("body", e.currentTarget)}
                    onSelect={(e) => rememberField("body", e.currentTarget)}
                    onKeyDown={(e) => handleTemplateKeyDown("body", e)}
                    onKeyUp={(e) => rememberField("body", e.currentTarget)}
                    onClick={(e) => rememberField("body", e.currentTarget)}
                    required
                  />
                </div>
              </section>
            </div>

            <aside className="config-panel__aside" aria-label="Variables de plantilla">
              <header className="config-section__head">
                <h3 className="config-section__title">Variables</h3>
                <p className="config-section__hint">
                  En bordo = está en el asunto o en el cuerpo. Backspace/Supr sobre un{" "}
                  {"{{...}}"} lo borra entero.
                </p>
              </header>
              <div className="config-vars-groups">
                {groupedVars.map((group) => (
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
                onClick={() => setForm(saved)}
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
