import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type PedidosColorOption<T extends string> = {
  value: T;
  label: string;
  tone: string;
};

type Props<T extends string> = {
  value: T;
  options: PedidosColorOption<T>[];
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: T) => void;
};

type MenuPos = { top: number; left: number; width: number };

export function PedidosColorSelect<T extends string>({
  value,
  options,
  disabled = false,
  ariaLabel,
  onChange,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  function updatePos() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: r.left,
      width: Math.max(r.width, 132),
    });
  }

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
    function onScroll() {
      updatePos();
    }
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!current) return null;

  const menu =
    open && pos
      ? createPortal(
          <ul
            ref={menuRef}
            id={listId}
            className="pedidos-color-select__menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
          >
            {options.map((opt) => (
              <li key={opt.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  className={`pedidos-color-select__option pedidos-tone--${opt.tone}${
                    opt.value === value ? " is-selected" : ""
                  }`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="pedidos-color-select__dot" aria-hidden />
                  <span className="pedidos-color-select__label">{opt.label}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      className={`pedidos-color-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`pedidos-color-select__trigger pedidos-tone--${current.tone}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="pedidos-color-select__dot" aria-hidden />
        <span className="pedidos-color-select__label">{current.label}</span>
        <span className="pedidos-color-select__caret" aria-hidden />
      </button>
      {menu}
    </div>
  );
}
