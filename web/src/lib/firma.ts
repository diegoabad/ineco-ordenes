import { resolveAssetUrl } from "../config/api";

export function firmaSrc(
  firmaUrl: string | null | undefined,
  cacheBust?: number | string,
): string | null {
  const src = resolveAssetUrl(firmaUrl);
  if (!src || cacheBust === undefined) return src;
  const sep = src.includes("?") ? "&" : "?";
  return `${src}${sep}v=${cacheBust}`;
}

export async function firmaToDataUrl(firmaUrl: string | null | undefined): Promise<string | null> {
  const src = firmaSrc(firmaUrl);
  if (!src) return null;
  if (src.startsWith("data:")) return src;

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error("No se pudo cargar la firma");
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la firma"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la firma"));
    img.src = src;
  });
}

/** Firma lista para PDF: fondo blanco sólido (evita negro por transparencia/WebP en jsPDF). */
export async function firmaToDataUrlForPdf(
  firmaUrl: string | null | undefined,
): Promise<string | null> {
  if (!firmaUrl) return null;

  try {
    const raw = await firmaToDataUrl(firmaUrl);
    if (!raw) return null;

    const img = await loadImage(raw);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width < 1 || height < 1) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}
