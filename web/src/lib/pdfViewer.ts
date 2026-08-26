const PDF_JS_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDF_WORKER_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

export type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { url: string }) => { promise: Promise<PdfJsDocument> };
};

export type PdfJsDocument = {
  numPages: number;
  getPage: (num: number) => Promise<PdfJsPage>;
};

export type PdfJsPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
  }
}

let loadPromise: Promise<PdfJsLib> | null = null;

export function loadPdfJs(): Promise<PdfJsLib> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("pdf.js no disponible"));
  }
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    return Promise.resolve(window.pdfjsLib);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDF_JS_URL;
    script.async = true;
    script.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) {
        reject(new Error("No se pudo cargar el visor PDF"));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      resolve(lib);
    };
    script.onerror = () => reject(new Error("No se pudo cargar el visor PDF"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export const PDF_ZOOM_DEFAULT = 1;
export const PDF_ZOOM_MIN = 0.85;
export const PDF_ZOOM_MAX = 3;
export const PDF_ZOOM_STEP = 0.15;

export function clampPdfZoom(value: number): number {
  return Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, value));
}

export function formatPdfZoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function descargarPdfBlob(blob: Blob, filename: string): void {
  const file = new File([blob], filename, { type: "application/pdf" });
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function imprimirPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    }
  };
}

export function abrirPdfEnPestana(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
