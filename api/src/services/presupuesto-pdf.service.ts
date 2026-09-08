import fs from "node:fs/promises";
import path from "node:path";
import {
  legacyPresupuestoPdfDirs,
  uploadsPresupuestosDir,
} from "../config/paths.js";

export function presupuestoPdfFilePath(presupuestoId: string): string {
  return path.join(uploadsPresupuestosDir(), `${presupuestoId}.pdf`);
}

export function presupuestoPdfPublicUrl(presupuestoId: string): string {
  return `/uploads/presupuestos/${presupuestoId}.pdf`;
}

export async function ensurePresupuestosUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsPresupuestosDir(), { recursive: true });
}

export function stripPdfBase64(input: string): string {
  const trimmed = input.trim();
  const m = /^data:application\/pdf;base64,(.+)$/i.exec(trimmed);
  return (m ? m[1] : trimmed).trim();
}

function candidatePdfPaths(presupuestoId: string): string[] {
  const name = `${presupuestoId}.pdf`;
  const primary = path.join(uploadsPresupuestosDir(), name);
  const legacy = legacyPresupuestoPdfDirs().map((dir) => path.join(dir, name));
  return [...new Set([primary, ...legacy])];
}

async function isReadablePdf(filePath: string): Promise<boolean> {
  try {
    const st = await fs.stat(filePath);
    return st.isFile() && st.size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Resuelve el PDF en disco. Si está en una ruta legacy, lo copia a la canónica
 * (volumen `uploads/presupuestos`) para que nginx/Express lo sirvan.
 */
export async function resolvePresupuestoPdfPath(
  presupuestoId: string,
): Promise<string | null> {
  const canonical = presupuestoPdfFilePath(presupuestoId);
  if (await isReadablePdf(canonical)) return canonical;

  for (const candidate of candidatePdfPaths(presupuestoId)) {
    if (candidate === canonical) continue;
    if (!(await isReadablePdf(candidate))) continue;

    try {
      await ensurePresupuestosUploadsDir();
      await fs.copyFile(candidate, canonical);
      console.warn(
        `[presupuesto-pdf] Recuperado ${presupuestoId} desde ${candidate} → ${canonical}`,
      );
      return canonical;
    } catch (error) {
      console.error(
        `[presupuesto-pdf] Encontrado en ${candidate} pero no se pudo copiar a ${canonical}`,
        error,
      );
      return candidate;
    }
  }

  return null;
}

export async function savePresupuestoPdf(
  presupuestoId: string,
  pdfBase64: string,
): Promise<{ filePath: string; publicUrl: string }> {
  await ensurePresupuestosUploadsDir();
  const buffer = Buffer.from(stripPdfBase64(pdfBase64), "base64");
  if (buffer.length === 0) {
    throw new Error("PDF inválido");
  }
  const filePath = presupuestoPdfFilePath(presupuestoId);
  await fs.writeFile(filePath, buffer);
  console.log(`[presupuesto-pdf] Guardado ${filePath} (${buffer.length} bytes)`);
  // Misma ruta en disco; query distinta para invalidar caché del navegador al editar.
  const publicUrl = `${presupuestoPdfPublicUrl(presupuestoId)}?v=${Date.now()}`;
  return { filePath, publicUrl };
}

export async function deletePresupuestoPdfFile(presupuestoId: string): Promise<void> {
  for (const filePath of candidatePdfPaths(presupuestoId)) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function readPresupuestoPdfBase64(presupuestoId: string): Promise<string> {
  const filePath = await resolvePresupuestoPdfPath(presupuestoId);
  if (!filePath) throw new Error("PDF no encontrado en disco");
  const buffer = await fs.readFile(filePath);
  if (buffer.length === 0) throw new Error("PDF inválido");
  return buffer.toString("base64");
}

export async function presupuestoPdfExists(presupuestoId: string): Promise<boolean> {
  return (await resolvePresupuestoPdfPath(presupuestoId)) !== null;
}
