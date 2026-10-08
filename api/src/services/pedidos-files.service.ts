import fs from "node:fs/promises";
import path from "node:path";
import { legacyPedidoDirs, uploadsPedidosDir } from "../config/paths.js";

export async function ensurePedidosUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsPedidosDir(), { recursive: true });
}

function stripBase64(input: string): string {
  const trimmed = input.trim();
  const m = /^data:[^;]+;base64,(.+)$/i.exec(trimmed);
  return (m ? m[1] : trimmed).trim();
}

function extFromMimeOrName(mime: string | undefined, nombre: string): string {
  const fromName = path.extname(nombre).replace(/^\./, "").toLowerCase();
  if (fromName && /^[a-z0-9]+$/i.test(fromName) && fromName.length <= 8) {
    return fromName;
  }
  const m = (mime ?? "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("msword") || m.includes("wordprocessingml")) return "docx";
  if (m.includes("spreadsheetml") || m.includes("excel")) return "xlsx";
  if (m.includes("presentationml") || m.includes("powerpoint")) return "pptx";
  if (m.includes("text/plain")) return "txt";
  if (m.includes("csv")) return "csv";
  if (m.includes("zip")) return "zip";
  return "bin";
}

export function pedidoFotoFileNameFromUrl(url: string): string | null {
  const clean = String(url ?? "").split("?")[0] ?? "";
  const match = /\/uploads\/pedidos\/([^/]+)$/i.exec(clean);
  const name = match?.[1]?.trim() ?? "";
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return null;
  }
  return name;
}

function candidatePedidoFotoPaths(fileName: string): string[] {
  const primary = path.join(uploadsPedidosDir(), fileName);
  const legacy = legacyPedidoDirs().map((dir) => path.join(dir, fileName));
  return [...new Set([primary, ...legacy])];
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    const st = await fs.stat(filePath);
    return st.isFile() && st.size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Resuelve un adjunto en disco. Si está en una ruta legacy, lo copia a la canónica
 * (`uploads/pedidos`) para que nginx/Express lo sirvan.
 */
export async function resolvePedidoFotoPath(
  fileNameOrUrl: string,
): Promise<string | null> {
  const fileName =
    pedidoFotoFileNameFromUrl(fileNameOrUrl) ??
    (fileNameOrUrl.includes("/") || fileNameOrUrl.includes("\\")
      ? null
      : fileNameOrUrl.trim());
  if (!fileName) return null;

  const canonical = path.join(uploadsPedidosDir(), fileName);
  if (await isReadableFile(canonical)) return canonical;

  for (const candidate of candidatePedidoFotoPaths(fileName)) {
    if (candidate === canonical) continue;
    if (!(await isReadableFile(candidate))) continue;

    try {
      await ensurePedidosUploadsDir();
      await fs.copyFile(candidate, canonical);
      console.warn(
        `[pedido-files] Recuperado ${fileName} desde ${candidate} → ${canonical}`,
      );
      return canonical;
    } catch (error) {
      console.error(
        `[pedido-files] Encontrado en ${candidate} pero no se pudo copiar a ${canonical}`,
        error,
      );
      return candidate;
    }
  }

  return null;
}

export async function savePedidoFoto(
  pedidoId: string,
  index: number,
  base64: string,
  nombre: string,
  mime?: string,
): Promise<{ url: string; nombre: string }> {
  await ensurePedidosUploadsDir();
  const buffer = Buffer.from(stripBase64(base64), "base64");
  if (buffer.length === 0) throw new Error("Archivo inválido");
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error("Cada archivo puede pesar como máximo 8 MB");
  }
  const ext = extFromMimeOrName(mime, nombre);
  const safeName = `${pedidoId}-${index}.${ext}`;
  const filePath = path.join(uploadsPedidosDir(), safeName);
  await fs.writeFile(filePath, buffer);
  return {
    url: `/uploads/pedidos/${safeName}?v=${Date.now()}`,
    nombre: nombre.trim() || safeName,
  };
}
