import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconChevronLeft, IconChevronRight } from "./Icons";

type Props = {
  children: ReactNode;
  "aria-label"?: string;
  className?: string;
};

/**
 * Barra de pestañas con scroll horizontal y flechas cuando no entran.
 * Las pestañas mantienen su ancho natural (no se achican).
 */
export function ScrollableAppTabs({
  children,
  "aria-label": ariaLabel,
  className = "",
}: Props) {
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const hasOverflow = max > 2;
    setOverflowing(hasOverflow);
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft < max - 2);
  }, []);

  useLayoutEffect(() => {
    update();
  }, [update, children]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => update();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    for (const child of el.children) {
      ro.observe(child);
    }

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [update, children]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const active = el.querySelector(".app-tabs__btn.is-active");
    if (!(active instanceof HTMLElement)) return;
    active.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    const t = window.setTimeout(update, 280);
    return () => window.clearTimeout(t);
  }, [children, update]);

  function scrollByDir(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(140, Math.round(el.clientWidth * 0.55));
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  }

  return (
    <div
      className={`app-tabs-scroll${overflowing ? " is-overflowing" : ""}${
        className ? ` ${className}` : ""
      }`}
    >
      {overflowing ? (
        <button
          type="button"
          className="app-tabs-scroll__arrow"
          aria-label="Ver pestañas anteriores"
          disabled={!canLeft}
          onClick={() => scrollByDir(-1)}
        >
          <IconChevronLeft size={18} />
        </button>
      ) : null}

      <nav
        ref={scrollerRef}
        className="app-tabs app-tabs--full app-tabs--scrollable"
        aria-label={ariaLabel}
      >
        {children}
      </nav>

      {overflowing ? (
        <button
          type="button"
          className="app-tabs-scroll__arrow"
          aria-label="Ver más pestañas"
          disabled={!canRight}
          onClick={() => scrollByDir(1)}
        >
          <IconChevronRight size={18} />
        </button>
      ) : null}
    </div>
  );
}
