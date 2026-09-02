import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

function sameBox(a, b) {
  if (!a || !b) return false;
  return (
    a.left === b.left &&
    a.width === b.width &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.listMaxHeight === b.listMaxHeight &&
    a.openUp === b.openUp
  );
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Elegí una opción...',
  disabled = false,
  maxHeight = 260,
}) {
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const menuStyleRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value]
  );
  const displayLabel = selectedOption ? selectedOption.label : '';

  const filtered = useMemo(() => {
    const q = inputText.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        String(o.value).toLowerCase().includes(q)
    );
  }, [options, inputText]);

  const updateMenuPosition = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const want = Math.min(maxHeight, 320);
    const openUp = spaceBelow < Math.min(want, 160) && spaceAbove > spaceBelow;
    const listMaxHeight = Math.max(
      120,
      Math.min(want, openUp ? spaceAbove : spaceBelow)
    );
    const next = {
      left: rect.left,
      width: rect.width,
      top: openUp ? undefined : rect.bottom + gap,
      bottom: openUp ? window.innerHeight - rect.top + gap : undefined,
      listMaxHeight,
      openUp,
    };
    if (sameBox(menuStyleRef.current, next)) return;
    menuStyleRef.current = next;
    setMenuStyle(next);
  };

  useLayoutEffect(() => {
    if (!open) {
      menuStyleRef.current = null;
      setMenuStyle(null);
      return undefined;
    }
    updateMenuPosition();

    let raf = 0;
    const onWin = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateMenuPosition);
    };

    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onWin, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWin);
      window.removeEventListener('scroll', onWin, true);
    };
  }, [open, maxHeight]);

  useEffect(() => {
    if (!open) {
      setInputText('');
      setHighlightIndex(0);
      return;
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [inputText]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(e) {
      const t = e.target;
      if (containerRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current || filtered.length === 0) return;
    const list = listRef.current;
    const el = list.children[highlightIndex];
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [open, highlightIndex, filtered.length]);

  const handleSelect = (opt) => {
    onChange(opt.value);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
      return;
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      handleSelect(filtered[highlightIndex]);
    }
  };

  const openMenu = () => {
    if (!disabled) setOpen(true);
  };

  const toggleMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setOpen((v) => !v);
  };

  const dropdown =
    open && menuStyle
      ? createPortal(
          <ul
            ref={listRef}
            className="searchable-select-dropdown searchable-select-dropdown--portal"
            style={{
              position: 'fixed',
              left: menuStyle.left,
              width: menuStyle.width,
              top: menuStyle.top,
              bottom: menuStyle.bottom,
              maxHeight: menuStyle.listMaxHeight,
              zIndex: 4000,
            }}
            role="listbox"
          >
            {filtered.length === 0 ? (
              <li className="searchable-select-item empty">Sin resultados</li>
            ) : (
              filtered.map((opt, i) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  className={
                    'searchable-select-item' +
                    (opt.value === value ? ' selected' : '') +
                    (i === highlightIndex ? ' highlight' : '')
                  }
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(opt);
                  }}
                  onMouseEnter={() => {
                    if (highlightIndex !== i) setHighlightIndex(i);
                  }}
                >
                  {opt.label}
                </li>
              ))
            )}
          </ul>,
          document.body
        )
      : null;

  return (
    <div className="searchable-select-wrap" ref={containerRef}>
      <div
        className={`searchable-select-input ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
        onMouseDown={(e) => {
          if (disabled) return;
          if (e.target === inputRef.current) return;
          toggleMenu(e);
        }}
      >
        <input
          ref={inputRef}
          type="text"
          readOnly={!open}
          value={open ? inputText : displayLabel}
          onChange={(e) => setInputText(e.target.value)}
          onFocus={openMenu}
          onClick={openMenu}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="searchable-select-field"
          autoComplete="off"
          aria-expanded={open}
          aria-haspopup="listbox"
        />
        <span className="searchable-select-arrow" aria-hidden>
          ▼
        </span>
      </div>
      {dropdown}
    </div>
  );
}
