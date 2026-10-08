import fs from "node:fs/promises";
import path from "node:path";
import {
  API_ROOT,
  legacyPedidoDirs,
  uploadsFirmasDir,
  uploadsPedidosDir,
  uploadsRootDir,
} from "../config/paths.js";

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
  const extra = [
    path.join(uploadsRootDir(), fileName),
    path.join(uploadsFirmasDir(), fileName),
    path.join(uploadsFirmasDir(), "pedidos", fileName),
    path.join(API_ROOT, "uploads", "pedidos", fileName),
    path.join(API_ROOT, "pedidos", fileName),
  ];
  return [...new Set([primary, ...legacy, ...extra])];
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

/** Busca el archivo por nombre bajo uploads/ (por si quedó en una subcarpeta rara). */
async function findPedidoFotoUnderUploads(fileName: string): Promise<string | null> {
  const root = uploadsRootDir();
  const queue: string[] = [root];
  const seen = new Set<string>();
  let depth = 0;

  while (queue.length > 0 && depth < 4) {
    const levelCount = queue.length;
    for (let i = 0; i < levelCount; i += 1) {
      const dir = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          if (await isReadableFile(full)) return full;
        } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
          queue.push(full);
        }
      }
    }
    depth += 1;
  }
  return null;
}

export type ResolvePedidoFotoResult = {
  path: string | null;
  /** true si se copió desde una ruta legacy a la canónica. */
  recovered: boolean;
};

/**
 * Resuelve un adjunto en disco. Si está en una ruta legacy, lo copia a la canónica
 * (`uploads/pedidos`) para que nginx/Express lo sirvan.
 */
export async function resolvePedidoFotoPath(
  fileNameOrUrl: string,
): Promise<string | null> {
  const result = await resolvePedidoFotoPathDetailed(fileNameOrUrl);
  return result.path;
}

export async function resolvePedidoFotoPathDetailed(
  fileNameOrUrl: string,
): Promise<ResolvePedidoFotoResult> {
  const fileName =
    pedidoFotoFileNameFromUrl(fileNameOrUrl) ??
    (fileNameOrUrl.includes("/") || fileNameOrUrl.includes("\\")
      ? null
      : fileNameOrUrl.trim());
  if (!fileName) return { path: null, recovered: false };

  const canonical = path.join(uploadsPedidosDir(), fileName);
  if (await isReadableFile(canonical)) return { path: canonical, recovered: false };

  const candidates = candidatePedidoFotoPaths(fileName);
  const deep = await findPedidoFotoUnderUploads(fileName);
  if (deep) candidates.push(deep);

  for (const candidate of [...new Set(candidates)]) {
    if (candidate === canonical) continue;
    if (!(await isReadableFile(candidate))) continue;

    try {
      await ensurePedidosUploadsDir();
      await fs.copyFile(candidate, canonical);
      console.warn(
        `[pedido-files] Recuperado ${fileName} desde ${candidate} → ${canonical}`,
      );
      return { path: canonical, recovered: true };
    } catch (error) {
      console.error(
        `[pedido-files] Encontrado en ${candidate} pero no se pudo copiar a ${canonical}`,
        error,
      );
      return { path: candidate, recovered: false };
    }
  }

  console.warn(
    `[pedido-files] No se encontró ${fileName} (canónico=${canonical}; root=${uploadsRootDir()})`,
  );
  return { path: null, recovered: false };
}

export async function deletePedidoFotoFile(url: string): Promise<void> {
  const fileName = pedidoFotoFileNameFromUrl(url);
  if (!fileName) return;
  const filePath = path.join(uploadsPedidosDir(), fileName);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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

/** Siguiente índice libre mirando URLs ya guardadas (`pedidoId-N.ext`). */
export function nextPedidoFotoIndex(
  pedidoId: string,
  fotos: { url: string }[],
): number {
  let max = -1;
  const prefix = `${pedidoId}-`;
  for (const foto of fotos) {
    const name = pedidoFotoFileNameFromUrl(foto.url);
    if (!name?.startsWith(prefix)) continue;
    const m = /^(\d+)\./.exec(name.slice(prefix.length));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function withCacheBust(url: string): string {
  const base = String(url ?? "").split("?")[0] ?? "";
  if (!base) return url;
  return `${base}?v=${Date.now()}`;
}

/**
 * Intenta recuperar cada adjunto desde rutas legacy y refresca `?v=` si hubo recover.
 */
export async function ensurePedidoFotosResolved(
  fotos: { url: string; nombre: string }[],
): Promise<{ fotos: { url: string; nombre: string }[]; changed: boolean }> {
  let changed = false;
  const next: { url: string; nombre: string }[] = [];
  for (const foto of fotos) {
    const { recovered } = await resolvePedidoFotoPathDetailed(foto.url);
    if (recovered) {
      changed = true;
      next.push({ ...foto, url: withCacheBust(foto.url) });
    } else {
      next.push(foto);
    }
  }
  return { fotos: next, changed };
}
