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
