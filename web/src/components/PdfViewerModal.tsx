import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  clampPdfZoom,
  descargarPdfBlob,
  formatPdfZoomLabel,
  imprimirPdfBlob,
  loadPdfJs,
  PDF_ZOOM_DEFAULT,
  PDF_ZOOM_MIN,
  PDF_ZOOM_STEP,
} from "../lib/pdfViewer";
import { IconDownload, IconMinus, IconPlus, IconPrinter, IconX } from "./Icons";
import "./PdfViewerModal.css";

type PdfViewerModalProps = {
  open: boolean;
  blob: Blob | null;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Acciones en la barra superior (ej. confirmar presupuesto). */
  headerActions?: ReactNode;
  /** Panel lateral izquierdo (ej. plantilla editable). */
  sidePanel?: ReactNode;
  /** Contenido arriba del PDF (ej. variables), sin tapar la plantilla. */
  viewerTopPanel?: ReactNode;
  footer?: ReactNode;
  /** Oculta Descargar/Imprimir del header (útil en preview de confirmación). */
  hideFileActions?: boolean;
};

function distanciaPinch(touches: TouchList): number {
  const dx = touches[0]!.clientX - touches[1]!.clientX;
  const dy = touches[0]!.clientY - touches[1]!.clientY;
  return Math.hypot(dx, dy);
}

export function PdfViewerModal({
  open,
  blob,
  title,
  subtitle = "PDF",
  onClose,
  headerActions,
  sidePanel,
  viewerTopPanel,
  footer,
  hideFileActions = false,
}: PdfViewerModalProps) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(PDF_ZOOM_DEFAULT);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoomState] = useState(PDF_ZOOM_DEFAULT);

  const setZoom = useCallback((value: number | ((z: number) => number)) => {
    setZoomState((prev) => {
      const raw = typeof value === "function" ? value(prev) : value;
      const next = clampPdfZoom(raw);
      zoomRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setZoom(PDF_ZOOM_DEFAULT);
  }, [open, blob, setZoom]);

  useEffect(() => {
    if (!open || !blob || !pagesRef.current) return;

    const container = pagesRef.current;
    let cancelled = false;
    let objectUrl = "";

    setLoading(true);
    setError("");
    container.replaceChildren();

    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        const pdf = await pdfjs.getDocument({ url: objectUrl }).promise;
        if (cancelled) return;

        const scroller = scrollerRef.current;
        const containerWidth =
          scroller?.clientWidth ||
          container.clientWidth ||
          Math.min(document.documentElement.clientWidth, window.innerWidth);
        const maxWidth = Math.max(320, Math.min(containerWidth - 16, 820));
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const base = page.getViewport({ scale: 1 });
          const scale = maxWidth / base.width;
          const viewport = page.getViewport({ scale });
          const renderViewport = page.getViewport({ scale: scale * pixelRatio });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(renderViewport.width);
          canvas.height = Math.floor(renderViewport.height);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const context = canvas.getContext("2d");
          if (!context) continue;

          const sheet = document.createElement("div");
          sheet.className = "fl-pdf-mobile-viewer__page";
          sheet.appendChild(canvas);
          container.appendChild(sheet);

          await page.render({
            canvasContext: context,
            viewport: renderViewport,
          }).promise;
        }
      } catch {
        if (!cancelled) setError("No se pudo mostrar el PDF.");
      } finally {
        if (!cancelled) setLoading(false);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();

    return () => {
      cancelled = true;
      container.replaceChildren();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, blob]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !open) return;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchRef.current = { dist: distanciaPinch(e.touches), zoom: zoomRef.current };
      }
    }

    function onTouchMove(e: TouchEvent) {
      const pinch = pinchRef.current;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const dist = distanciaPinch(e.touches);
      if (pinch.dist <= 0) return;
      setZoom(pinch.zoom * (dist / pinch.dist));
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchRef.current = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [open, setZoom]);

  if (!open) return null;

  const zoomAlMinimo = zoom <= PDF_ZOOM_MIN + 0.001;

  return (
    <div className="fl-modal-backdrop fl-modal-backdrop--pdf" role="presentation">
      <div
        className={`fl-modal fl-modal--pdf-mobile${footer ? " fl-modal--pdf-mobile--with-footer" : ""}${
          sidePanel ? " fl-modal--pdf-split" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fl-modal__header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="fl-modal__subtitle">{subtitle}</p> : null}
          </div>
          <div className="fl-pdf-viewer__header-actions">
            {blob && !hideFileActions ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    descargarPdfBlob(blob, title.endsWith(".pdf") ? title : `${title}.pdf`)
                  }
                >
                  <IconDownload size={14} />
                  Descargar
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => imprimirPdfBlob(blob)}
                >
                  <IconPrinter size={14} />
                  Imprimir
                </button>
              </>
            ) : null}
            {headerActions ? (
              <div className="fl-pdf-viewer__header-confirm">{headerActions}</div>
            ) : null}
            <button type="button" className="fl-icon-btn" onClick={onClose} aria-label="Cerrar">
              <IconX size={18} />
            </button>
          </div>
        </div>

        <div className={`fl-modal__body${sidePanel ? " fl-modal__body--pdf-split" : ""}`}>
          {sidePanel ? <div className="fl-pdf-side-panel">{sidePanel}</div> : null}
          <div className="fl-pdf-mobile-viewer">
            {viewerTopPanel ? (
              <div className="fl-pdf-viewer-overlay-panel">{viewerTopPanel}</div>
            ) : null}
            <div
              className="fl-pdf-mobile-viewer__toolbar"
              role="toolbar"
              aria-label="Zoom del PDF"
            >
              <button
                type="button"
                className="fl-pdf-mobile-viewer__zoom-btn"
                onClick={() => setZoom((z) => z - PDF_ZOOM_STEP)}
                disabled={loading || zoomAlMinimo}
                aria-label="Alejar"
              >
                <IconMinus size={18} />
              </button>
              <span className="fl-pdf-mobile-viewer__zoom-label" aria-live="polite">
                {formatPdfZoomLabel(zoom)}
              </span>
              <button
                type="button"
                className="fl-pdf-mobile-viewer__zoom-btn"
                onClick={() => setZoom((z) => z + PDF_ZOOM_STEP)}
                disabled={loading}
                aria-label="Acercar"
              >
                <IconPlus size={18} />
              </button>
              <button
                type="button"
                className="fl-pdf-mobile-viewer__zoom-reset"
                onClick={() => setZoom(PDF_ZOOM_DEFAULT)}
                disabled={loading}
              >
                Restablecer
              </button>
            </div>

            <div className="fl-pdf-mobile-viewer__stage">
              {loading ? (
                <p className="fl-pdf-mobile-viewer__loading">Cargando PDF…</p>
              ) : null}
              {error ? (
                <p className="fl-pdf-mobile-viewer__error" role="alert">
                  {error}
                </p>
              ) : null}

              <div ref={scrollerRef} className="fl-pdf-mobile-viewer__scroller">
                <div
                  ref={pagesRef}
                  className="fl-pdf-mobile-viewer__pages"
                  style={{ zoom }}
                />
              </div>
            </div>
          </div>
        </div>

        {footer ? <div className="fl-modal__footer fl-pdf-viewer__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
