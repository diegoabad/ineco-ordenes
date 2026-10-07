import { useState } from "react";
import { toast } from "react-toastify";
import { isEmailAddress, joinEmails, parseEmailList } from "../lib/emails";

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
  const locked = disabled || readOnly;

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
    <div className={`email-chips${locked ? " is-disabled" : ""}`}>
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
          onChange={(e) => {
            const next = e.target.value;
            if (/[\s,;]/.test(next)) {
              commit(next);
              return;
            }
            setDraft(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
              return;
            }
            if (e.key === "Backspace" && draft === "" && emails.length > 0) {
              remove(emails[emails.length - 1]!);
            }
          }}
          onBlur={() => {
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
    </div>
  );
}
