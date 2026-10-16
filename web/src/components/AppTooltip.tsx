import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

type TipState = {
  text: string;
  x: number;
  y: number;
  placement: Placement;
  wrap: boolean;
};

const VIEW_PAD = 10;
const GAP = 8;

function shouldWrapTip(text: string): boolean {
  return text.length > 72 || text.includes("\n");
}

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

function isModalOverlayLayer(node: HTMLElement): boolean {
  return (
    node.classList.contains("fl-modal-backdrop") ||
    node.getAttribute("aria-modal") === "true"
  );
}

function findTipElement(
  clientX: number,
  clientY: number,
  fallbackTarget: EventTarget | null,
): HTMLElement | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    if (node.closest(".app-tooltip")) continue;
    const tipHost = node.closest("[data-tooltip], [title]");
    if (tipHost instanceof HTMLElement && readTipText(tipHost)) return tipHost;
    if (node instanceof HTMLElement && isModalOverlayLayer(node)) return null;
  }
  if (fallbackTarget instanceof Element) {
    const openBackdrop = document.querySelector(".fl-modal-backdrop");
    if (openBackdrop && !(fallbackTarget as Element).closest(".fl-modal-backdrop")) {
      return null;
    }
    const el = (fallbackTarget as Element).closest("[data-tooltip], [title]");
    if (el instanceof HTMLElement && readTipText(el)) return el;
  }
  return null;
}

function pickPlacement(rect: DOMRect, wrap: boolean): Placement {
  const spaceAbove = rect.top - VIEW_PAD;
  const spaceBelow = window.innerHeight - rect.bottom - VIEW_PAD;
  // Textos largos: preferir abajo para no salir por arriba
  if (wrap) {
    return spaceBelow >= 80 || spaceBelow >= spaceAbove ? "bottom" : "top";
  }
  if (spaceAbove < 44) return "bottom";
  if (spaceBelow < 44) return "top";
  return spaceBelow >= spaceAbove ? "bottom" : "top";
}

/**
 * Tooltip global: convierte `title` / `data-tooltip` en un tip visual.
 * Incluye botones disabled (via elementsFromPoint).
 * Se reposiciona para no salirse del viewport (desktop y mobile).
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
      const wrap = shouldWrapTip(text);
      const placement = pickPlacement(rect, wrap);
      const x = rect.left + rect.width / 2;
      const y = placement === "top" ? rect.top - GAP : rect.bottom + GAP;
      activeRef.current = el;
      setTip({ text, x, y, placement, wrap });
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

  useLayoutEffect(() => {
    if (!tip || !tipRef.current || !activeRef.current) return;
    const node = tipRef.current;
    const host = activeRef.current;
    const hostRect = host.getBoundingClientRect();

    // Ancho usable: en wrap ocupar casi todo el viewport para que el texto baje de renglón
    if (tip.wrap) {
      node.style.maxWidth = `${Math.max(160, window.innerWidth - VIEW_PAD * 2)}px`;
    }

    let r = node.getBoundingClientRect();
    let left = tip.x;
    const half = r.width / 2;
    left = Math.max(VIEW_PAD + half, Math.min(left, window.innerWidth - VIEW_PAD - half));

    let placement = tip.placement;
    let top = tip.y;

    const spaceBelow = window.innerHeight - hostRect.bottom - GAP - VIEW_PAD;
    const spaceAbove = hostRect.top - GAP - VIEW_PAD;
    const need = r.height;

    if (placement === "top" && need > spaceAbove && spaceBelow >= spaceAbove) {
      placement = "bottom";
      top = hostRect.bottom + GAP;
    } else if (placement === "bottom" && need > spaceBelow && spaceAbove > spaceBelow) {
      placement = "top";
      top = hostRect.top - GAP;
    }

    // Mantener el tip completo visible (sin scroll ni recorte)
    if (placement === "top") {
      const tipTop = top - need;
      if (tipTop < VIEW_PAD) top = VIEW_PAD + need;
      if (top > window.innerHeight - VIEW_PAD) top = window.innerHeight - VIEW_PAD;
    } else {
      if (top + need > window.innerHeight - VIEW_PAD) {
        top = Math.max(VIEW_PAD, window.innerHeight - VIEW_PAD - need);
      }
      if (top < VIEW_PAD) top = VIEW_PAD;
    }

    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.classList.toggle("app-tooltip--bottom", placement === "bottom");
    node.classList.toggle("app-tooltip--top", placement === "top");
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    <div
      ref={tipRef}
      className={`app-tooltip app-tooltip--${tip.placement}${tip.wrap ? " app-tooltip--wrap" : ""}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
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
