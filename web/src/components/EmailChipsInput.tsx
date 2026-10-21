import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { isEmailAddress, joinEmails, parseEmailList } from "../lib/emails";
import { cargarRemitentes, filtrarRemitentes, type RemitenteMail } from "../lib/remitentesMail";

type Props = {
  id?: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
};

export function EmailChipsInput({
  id,
  value,
  onChange,
  disabled = false,
  readOnly = false,
  placeholder = "Agregá un email y presioná espacio o coma",
}: Props) {
  const emails = parseEmailList(value);
  const [draft, setDraft] = useState("");
  const [remitentes, setRemitentes] = useState<RemitenteMail[]>([]);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const locked = disabled || readOnly;

  useEffect(() => {
    if (locked) return;
    let vivo = true;
    void cargarRemitentes()
      .then((items) => {
        if (vivo) setRemitentes(items);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [locked]);

  const sugerencias = useMemo(
    () => (locked ? [] : filtrarRemitentes(draft, remitentes, emails)),
    [locked, draft, remitentes, emails],
  );
  const mostrarMenu = menuAbierto && sugerencias.length > 0;
  const indiceActivo = Math.min(activo, Math.max(sugerencias.length - 1, 0));

  useLayoutEffect(() => {
    if (!mostrarMenu) return;
    function place() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [mostrarMenu, draft, sugerencias.length]);

  function elegir(item: RemitenteMail) {
    const next = parseEmailList(joinEmails([...emails, item.email]));
    onChange?.(joinEmails(next));
    setDraft("");
    setMenuAbierto(false);
    setActivo(0);
  }

  function commit(raw: string) {
    const tokens = parseEmailList(raw);
    if (tokens.length === 0) {
      setDraft("");
      return;
    }
    const invalid = tokens.filter((token) => !isEmailAddress(token));
    const valid = tokens.filter((token) => isEmailAddress(token));
    if (invalid.length > 0) {
      toast.warning("Revisá el email: tiene que tener un formato válido");
      setDraft(invalid.join(" "));
    } else {
      setDraft("");
    }
    if (valid.length === 0) return;
    const next = parseEmailList(joinEmails([...emails, ...valid]));
    onChange?.(joinEmails(next));
  }

  function remove(email: string) {
    onChange?.(joinEmails(emails.filter((item) => item.toLowerCase() !== email.toLowerCase())));
  }

  return (
    <div ref={rootRef} className={`email-chips${locked ? " is-disabled" : ""}`}>
      {emails.map((email) => (
        <span key={email.toLowerCase()} className="email-chips__chip">
          <span>{email}</span>
          {locked ? null : (
            <button
              type="button"
              className="email-chips__remove"
              aria-label={`Quitar ${email}`}
              onClick={() => remove(email)}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {locked ? null : (
        <input
          id={id}
          type="text"
          inputMode="email"
          autoComplete="off"
          value={draft}
          placeholder={emails.length === 0 ? placeholder : ""}
          disabled={disabled}
          role="combobox"
          aria-expanded={mostrarMenu}
          aria-autocomplete="list"
          aria-controls={mostrarMenu ? `${id ?? "email-chips"}-sugerencias` : undefined}
          onFocus={() => setMenuAbierto(true)}
          onChange={(e) => {
            const next = e.target.value;
            setMenuAbierto(true);
            setActivo(0);
            if (/[\s,;]/.test(next)) {
              commit(next);
              return;
            }
            setDraft(next);
          }}
          onKeyDown={(e) => {
            if (mostrarMenu && e.key === "ArrowDown") {
              e.preventDefault();
              setActivo((i) => (i + 1) % sugerencias.length);
              return;
            }
            if (mostrarMenu && e.key === "ArrowUp") {
              e.preventDefault();
              setActivo((i) => (i - 1 + sugerencias.length) % sugerencias.length);
              return;
            }
            if (e.key === "Escape") {
              setMenuAbierto(false);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (mostrarMenu) {
                const item = sugerencias[indiceActivo];
                if (item) elegir(item);
                return;
              }
              commit(draft);
              return;
            }
            if (e.key === "Backspace" && draft === "" && emails.length > 0) {
              remove(emails[emails.length - 1]!);
            }
          }}
          onBlur={() => {
            setMenuAbierto(false);
            if (draft.trim()) commit(draft);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!/[\s,;]/.test(text)) return;
            e.preventDefault();
            commit(`${draft} ${text}`);
          }}
        />
      )}
      {mostrarMenu && menuPos
        ? createPortal(
        <ul
          id={`${id ?? "email-chips"}-sugerencias`}
          className="email-chips__menu"
          role="listbox"
          style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
        >
          {sugerencias.map((item, index) => (
            <li key={item.email.toLowerCase()} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === indiceActivo}
                className={`email-chips__option${index === indiceActivo ? " is-active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(item);
                }}
                onMouseEnter={() => setActivo(index)}
              >
                <span className="email-chips__option-mail">{item.email}</span>
                {item.nombre ? (
                  <span className="email-chips__option-nombre">{item.nombre}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>,
          document.body,
        )
        : null}
    </div>
  );
}
