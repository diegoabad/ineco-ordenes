/**
 * Formulario dinámico a partir de un JSON:
 * string → input, number → number, boolean → switch, array/object → anidados.
 */
import { useState } from "react";

function labelFromKey(key) {
  const raw = String(key ?? "");
  if (!raw) return "Valor";
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function setAtPath(root, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const next = [...root];
    const idx = Number(head);
    next[idx] = setAtPath(next[idx], rest, value);
    return next;
  }
  const base =
    root && typeof root === "object" && !Array.isArray(root) ? { ...root } : {};
  base[head] = setAtPath(base[head], rest, value);
  return base;
}

function isInstructionListKey(key) {
  const k = String(key ?? "").toLowerCase();
  return (
    k === "instrucciones" ||
    k === "instructions" ||
    k === "pasos" ||
    k === "steps" ||
    k === "reglas" ||
    k === "rules"
  );
}

function isPrimitiveStringList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string")
  );
}

function FieldRow({ label, children, compact = false, align = "center" }) {
  return (
    <div
      className={`json-dyn-field${compact ? " json-dyn-field--compact" : ""}${
        align === "start" ? " json-dyn-field--start" : ""
      }`}
    >
      <label className="json-dyn-label">{label}</label>
      <div className="json-dyn-control">{children}</div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange, labelOn = "Sí", labelOff = "No" }) {
  return (
    <label className={`json-dyn-toggle${checked ? " is-on" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="json-dyn-toggle__track" aria-hidden>
        <span className="json-dyn-toggle__thumb" />
      </span>
      <span className="json-dyn-toggle__text">{checked ? labelOn : labelOff}</span>
    </label>
  );
}

/** Solo monta hijos al abrir (evita congelar con configs grandes). */
function CollapsibleSection({ title, defaultOpen = false, nested = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`json-dyn-group${nested ? " json-dyn-group--nested" : ""}${open ? " is-open" : ""}`}
    >
      <button
        type="button"
        className="json-dyn-group__title"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {title}
      </button>
      {open ? <div className="json-dyn-group__body">{children}</div> : null}
    </div>
  );
}

/** Sección raíz desplegable: título afuera + contenedor. */
function CardSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`json-dyn-card${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="json-dyn-card__title"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {title}
      </button>
      {open ? <div className="json-dyn-card__body">{children}</div> : null}
    </section>
  );
}

function InstructionList({ value, path, onChange, title }) {
  return (
    <div className="json-dyn-steps">
      {title ? <div className="json-dyn-steps__title">{title}</div> : null}
      <ol className="json-dyn-steps__list">
        {value.map((item, index) => (
          <li key={`${path.join(".")}.${index}`} className="json-dyn-steps__item">
            <span className="json-dyn-steps__num" aria-hidden>
              {index + 1}
            </span>
            <textarea
              className="json-dyn-input json-dyn-textarea json-dyn-steps__input"
              rows={2}
              value={item}
              onChange={(e) => onChange([...path, index], e.target.value)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function NodeEditor({ value, path, onChange, depth = 0 }) {
  if (value === null || value === undefined) {
    return (
      <FieldRow label={labelFromKey(path[path.length - 1])} compact>
        <input
          className="json-dyn-input"
          value=""
          placeholder="null"
          onChange={(e) => {
            const text = e.target.value;
            onChange(path, text === "" ? null : text);
          }}
        />
      </FieldRow>
    );
  }

  if (typeof value === "boolean") {
    return (
      <FieldRow label={labelFromKey(path[path.length - 1])} compact>
        <ToggleSwitch checked={value} onChange={(next) => onChange(path, next)} />
      </FieldRow>
    );
  }

  if (typeof value === "number") {
    return (
      <FieldRow label={labelFromKey(path[path.length - 1])} compact>
        <input
          type="number"
          className="json-dyn-input json-dyn-input--number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = e.target.value === "" ? 0 : Number(e.target.value);
            onChange(path, Number.isFinite(n) ? n : 0);
          }}
        />
      </FieldRow>
    );
  }

  if (typeof value === "string") {
    const multiline = value.length > 80 || value.includes("\n");
    return (
      <FieldRow
        label={labelFromKey(path[path.length - 1])}
        compact
        align={multiline ? "start" : "center"}
      >
        {multiline ? (
          <textarea
            className="json-dyn-input json-dyn-textarea"
            rows={3}
            value={value}
            onChange={(e) => onChange(path, e.target.value)}
          />
        ) : (
          <input
            type="text"
            className="json-dyn-input"
            value={value}
            onChange={(e) => onChange(path, e.target.value)}
          />
        )}
      </FieldRow>
    );
  }

  if (Array.isArray(value)) {
    const key = path[path.length - 1];
    const asSteps =
      isInstructionListKey(key) || (isPrimitiveStringList(value) && depth <= 2);

    if (asSteps && isPrimitiveStringList(value)) {
      return (
        <InstructionList
          value={value}
          path={path}
          onChange={onChange}
          title={`${labelFromKey(key)} (${value.length})`}
        />
      );
    }

    const defaultOpen = value.length <= 8 && depth <= 1;
    return (
      <CollapsibleSection
        title={`${labelFromKey(key)} (${value.length})`}
        defaultOpen={defaultOpen}
        nested={depth > 0}
      >
        {value.length === 0 ? (
          <p className="json-dyn-empty">Lista vacía</p>
        ) : (
          value.map((item, index) => (
            <div key={`${path.join(".")}.${index}`} className="json-dyn-array-item">
              <div className="json-dyn-array-item__head">
                <span className="json-dyn-steps__num">{index + 1}</span>
              </div>
              <NodeEditor
                value={item}
                path={[...path, index]}
                onChange={onChange}
                depth={depth + 1}
              />
            </div>
          ))
        )}
      </CollapsibleSection>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    const key = path[path.length - 1];
    const isRoot = path.length === 0;
    if (isRoot) {
      return (
        <div className="json-dyn-group">
          <div className="json-dyn-group__body json-dyn-group__body--root">
            {entries.map(([childKey, childVal]) => {
              const title = labelFromKey(childKey);
              const childPath = [childKey];

              if (
                childVal &&
                typeof childVal === "object" &&
                !Array.isArray(childVal)
              ) {
                const childEntries = Object.entries(childVal);
                return (
                  <CardSection key={childKey} title={title} defaultOpen>
                    {childEntries.length === 0 ? (
                      <p className="json-dyn-empty">Objeto vacío</p>
                    ) : (
                      childEntries.map(([k, v]) => (
                        <NodeEditor
                          key={`${childKey}.${k}`}
                          value={v}
                          path={[childKey, k]}
                          onChange={onChange}
                          depth={2}
                        />
                      ))
                    )}
                  </CardSection>
                );
              }

              if (Array.isArray(childVal) && isPrimitiveStringList(childVal)) {
                return (
                  <CardSection
                    key={childKey}
                    title={`${title} (${childVal.length})`}
                    defaultOpen
                  >
                    <InstructionList
                      value={childVal}
                      path={childPath}
                      onChange={onChange}
                    />
                  </CardSection>
                );
              }

              return (
                <CardSection key={childKey} title={title} defaultOpen>
                  <NodeEditor
                    value={childVal}
                    path={childPath}
                    onChange={onChange}
                    depth={1}
                  />
                </CardSection>
              );
            })}
          </div>
        </div>
      );
    }
    const defaultOpen = entries.length <= 12 && depth <= 1;
    return (
      <CollapsibleSection
        title={labelFromKey(key)}
        defaultOpen={defaultOpen}
        nested={depth > 0}
      >
        {entries.length === 0 ? (
          <p className="json-dyn-empty">Objeto vacío</p>
        ) : (
          entries.map(([childKey, childVal]) => (
            <NodeEditor
              key={[...path, childKey].join(".")}
              value={childVal}
              path={[...path, childKey]}
              onChange={onChange}
              depth={depth + 1}
            />
          ))
        )}
      </CollapsibleSection>
    );
  }

  return (
    <FieldRow label={labelFromKey(path[path.length - 1])} compact>
      <input
        className="json-dyn-input"
        value={String(value)}
        onChange={(e) => onChange(path, e.target.value)}
      />
    </FieldRow>
  );
}

export function JsonDynamicForm({ value, onChange }) {
  if (value == null || typeof value !== "object") {
    return <p className="json-dyn-empty">No hay configuración para editar.</p>;
  }

  const handleChange = (path, nextValue) => {
    onChange(setAtPath(value, path, nextValue));
  };

  return (
    <div className="json-dyn-form">
      <NodeEditor value={value} path={[]} onChange={handleChange} depth={0} />
    </div>
  );
}

/** Valida que el JSON pegado sea un objeto (no array / primitivo). */
export function parseConfigJsonObject(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("JSON inválido");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("El JSON debe ser un objeto { ... }");
  }
  return parsed;
}
