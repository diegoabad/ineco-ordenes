import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TipState = {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

function readTipText(el: Element): string | null {
  if (!(el instanceof HTMLElement)) return null;
  const data = el.getAttribute("data-tooltip")?.trim();
  if (data) return data;
  const title = el.getAttribute("title")?.trim();
  if (title) {
    el.setAttribute("data-tooltip", title);
    el.removeAttribute("title");
    return title;
  }
  return null;
}

function findTipElement(clientX: number, clientY: number, fallbackTarget: EventTarget | null): HTMLElement | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest(".app-tooltip")) continue;
    if (readTipText(node)) return node;
  }
  if (fallbackTarget instanceof Element) {
    const el = fallbackTarget.closest("[data-tooltip], [title]");
    if (el instanceof HTMLElement && readTipText(el)) return el;
  }
  return null;
}

/**
 * Tooltip global: convierte `title` / `data-tooltip` en un tip visual.
 * Incluye botones disabled (via elementsFromPoint).
 */
export function AppTooltipHost() {
  const [tip, setTip] = useState<TipState | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    function clearHide() {
      if (hideTimer.current != null) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    }

    function hide() {
      clearHide();
      activeRef.current = null;
      setTip(null);
    }

    function scheduleHide() {
      clearHide();
      hideTimer.current = window.setTimeout(hide, 40);
    }

    function place(el: HTMLElement, text: string) {
      clearHide();
      const rect = el.getBoundingClientRect();
      const gap = 10;
      const placement: "top" | "bottom" = rect.top < 52 ? "bottom" : "top";
      const x = rect.left + rect.width / 2;
      const y = placement === "top" ? rect.top - gap : rect.bottom + gap;
      activeRef.current = el;
      setTip({ text, x, y, placement });
    }

    function showFromPoint(clientX: number, clientY: number, fallbackTarget: EventTarget | null) {
      const el = findTipElement(clientX, clientY, fallbackTarget);
      if (!el) {
        scheduleHide();
        return;
      }
      const text = readTipText(el);
      if (!text) {
        scheduleHide();
        return;
      }
      if (activeRef.current === el) {
        clearHide();
        return;
      }
      place(el, text);
    }

    function onOver(e: MouseEvent) {
      showFromPoint(e.clientX, e.clientY, e.target);
    }

    function onMove(e: MouseEvent) {
      if (!activeRef.current) return;
      showFromPoint(e.clientX, e.clientY, e.target);
    }

    function onOut() {
      scheduleHide();
    }

    function onScrollOrResize() {
      if (!activeRef.current) return;
      const text = readTipText(activeRef.current);
      if (!text) {
        hide();
        return;
      }
      place(activeRef.current, text);
    }

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseout", onOut);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", hide);
    return () => {
      clearHide();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  useEffect(() => {
    if (!tip || !tipRef.current) return;
    const node = tipRef.current;
    const r = node.getBoundingClientRect();
    const pad = 10;
    let left = tip.x;
    const half = r.width / 2;
    left = Math.max(pad + half, Math.min(left, window.innerWidth - pad - half));
    node.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    <div
      ref={tipRef}
      className={`app-tooltip app-tooltip--${tip.placement}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      <span className="app-tooltip__accent" aria-hidden />
      <span className="app-tooltip__text">{tip.text}</span>
      <span className="app-tooltip__arrow" aria-hidden />
    </div>,
    document.body,
  );
}

/** Envuelve un control (opcional) si preferís data-tooltip explícito. */
export function Tip({
  content,
  children,
  className = "",
}: {
  content?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  if (!content?.trim()) return children;
  return (
    <span className={`ui-tip${className ? ` ${className}` : ""}`} data-tooltip={content}>
      {children}
    </span>
  );
}
