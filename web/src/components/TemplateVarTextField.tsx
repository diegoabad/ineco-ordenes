import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import {
  expandSelectionToTemplateTokens,
  getContentEditablePlainText,
  getSelectionOffsets,
  plainTextToDecoratedHtml,
  refreshTemplateVarDecorations,
  setSelectionOffsets,
  templateTokenForDelete,
} from "../lib/templateVars";

export type TemplateVarTextFieldHandle = {
  focus: () => void;
  rememberSelection: () => void;
  getSelection: () => { start: number; end: number };
  setSelection: (start: number, end?: number) => void;
};

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  onFocus?: () => void;
};

export const TemplateVarTextField = forwardRef<TemplateVarTextFieldHandle, Props>(
  function TemplateVarTextField({ id, value, onChange, placeholder, required, onFocus }, ref) {
    const areaRef = useRef<HTMLDivElement>(null);
    const lastEmitted = useRef(value);
    const selectionRef = useRef({ start: 0, end: 0 });

    useImperativeHandle(ref, () => ({
      focus: () => areaRef.current?.focus(),
      rememberSelection: () => {
        const el = areaRef.current;
        if (!el) return;
        const offsets = getSelectionOffsets(el);
        if (offsets) selectionRef.current = offsets;
      },
      getSelection: () => selectionRef.current,
      setSelection: (start: number, end = start) => {
        const el = areaRef.current;
        if (!el) return;
        selectionRef.current = { start, end };
        requestAnimationFrame(() => {
          setSelectionOffsets(el, start, end);
        });
      },
    }));

    useEffect(() => {
      const el = areaRef.current;
      if (!el) return;
      if (getContentEditablePlainText(el) === value) return;
      el.innerHTML = plainTextToDecoratedHtml(value);
      lastEmitted.current = value;
    }, [value]);

    function rememberSelection() {
      const el = areaRef.current;
      if (!el) return;
      const offsets = getSelectionOffsets(el);
      if (offsets) selectionRef.current = offsets;
    }

    function syncFromDom() {
      const el = areaRef.current;
      if (!el) return;
      const plain = getContentEditablePlainText(el);
      lastEmitted.current = plain;
      onChange(plain);
      refreshTemplateVarDecorations(el, plain, false);
    }

    function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }

      if (e.key !== "Backspace" && e.key !== "Delete") return;

      const el = e.currentTarget;
      const plain = getContentEditablePlainText(el);
      const selStart = selectionRef.current.start;
      const selEnd = selectionRef.current.end;

      if (selStart !== selEnd) {
        const expanded = expandSelectionToTemplateTokens(plain, selStart, selEnd);
        if (expanded.start !== selStart || expanded.end !== selEnd) {
          e.preventDefault();
          const next = plain.slice(0, expanded.start) + plain.slice(expanded.end);
          onChange(next);
          lastEmitted.current = next;
          refreshTemplateVarDecorations(el, next, false);
          requestAnimationFrame(() => {
            setSelectionOffsets(el, expanded.start, expanded.start);
            selectionRef.current = { start: expanded.start, end: expanded.start };
          });
        }
        return;
      }

      const token = templateTokenForDelete(plain, selStart, e.key as "Backspace" | "Delete");
      if (!token) return;

      e.preventDefault();
      const next = plain.slice(0, token.start) + plain.slice(token.end);
      onChange(next);
      lastEmitted.current = next;
      refreshTemplateVarDecorations(el, next, false);
      requestAnimationFrame(() => {
        setSelectionOffsets(el, token.start, token.start);
        selectionRef.current = { start: token.start, end: token.start };
      });
    }

    function handleFocus(_e: FocusEvent<HTMLDivElement>) {
      rememberSelection();
      onFocus?.();
    }

    const empty = !value.trim();

    return (
      <div className="template-var-field-wrap">
        {required ? (
          <input
            type="text"
            className="template-var-field__validator"
            value={value}
            readOnly
            required
            tabIndex={-1}
            aria-hidden
          />
        ) : null}
        <div
          id={id}
          ref={areaRef}
          className={`template-var-field${empty ? " is-empty" : ""}`}
          contentEditable
          role="textbox"
          aria-multiline="false"
          data-placeholder={placeholder}
          suppressContentEditableWarning
          onInput={() => {
            rememberSelection();
            syncFromDom();
          }}
          onFocus={handleFocus}
          onBlur={() => syncFromDom()}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onClick={rememberSelection}
          onKeyDown={handleKeyDown}
        />
      </div>
    );
  },
);
