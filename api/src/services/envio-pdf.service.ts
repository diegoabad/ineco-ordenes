import fs from "node:fs/promises";
import path from "node:path";
import { legacyEnvioPdfDirs, uploadsEnviosDir } from "../config/paths.js";

export function envioPdfFilePath(envioId: string): string {
  return path.join(uploadsEnviosDir(), `${envioId}.pdf`);
}

export function envioPdfPublicUrl(envioId: string): string {
  return `/uploads/envios/${envioId}.pdf`;
}

export async function ensureEnviosUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsEnviosDir(), { recursive: true });
}

export function stripPdfBase64(input: string): string {
  const trimmed = input.trim();
  const m = /^data:application\/pdf;base64,(.+)$/i.exec(trimmed);
  return (m ? m[1] : trimmed).trim();
}

function candidatePdfPaths(envioId: string): string[] {
  const name = `${envioId}.pdf`;
  const primary = path.join(uploadsEnviosDir(), name);
  const legacy = legacyEnvioPdfDirs().map((dir) => path.join(dir, name));
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
 * (volumen `uploads/envios`) para que nginx/Express lo sirvan.
 */
export async function resolveEnvioPdfPath(envioId: string): Promise<string | null> {
  const canonical = envioPdfFilePath(envioId);
  if (await isReadablePdf(canonical)) return canonical;

  for (const candidate of candidatePdfPaths(envioId)) {
    if (candidate === canonical) continue;
    if (!(await isReadablePdf(candidate))) continue;

    try {
      await ensureEnviosUploadsDir();
      await fs.copyFile(candidate, canonical);
      console.warn(
        `[envio-pdf] Recuperado ${envioId} desde ${candidate} → ${canonical}`,
      );
      return canonical;
    } catch (error) {
      console.error(
        `[envio-pdf] Encontrado en ${candidate} pero no se pudo copiar a ${canonical}`,
        error,
      );
      return candidate;
    }
  }

  return null;
}

export async function saveEnvioPdf(
  envioId: string,
  pdfBase64: string,
): Promise<{ filePath: string; publicUrl: string }> {
  await ensureEnviosUploadsDir();
  const buffer = Buffer.from(stripPdfBase64(pdfBase64), "base64");
  if (buffer.length === 0) {
    throw new Error("PDF inválido");
  }
  const filePath = envioPdfFilePath(envioId);
  await fs.writeFile(filePath, buffer);
  console.log(`[envio-pdf] Guardado ${filePath} (${buffer.length} bytes)`);
  const publicUrl = `${envioPdfPublicUrl(envioId)}?v=${Date.now()}`;
  return { filePath, publicUrl };
}

export async function deleteEnvioPdfFile(envioId: string): Promise<void> {
  for (const filePath of candidatePdfPaths(envioId)) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export async function readEnvioPdfBase64(envioId: string): Promise<string> {
  const filePath = await resolveEnvioPdfPath(envioId);
  if (!filePath) throw new Error("PDF no encontrado en disco");
  const buffer = await fs.readFile(filePath);
  if (buffer.length === 0) throw new Error("PDF inválido");
  return buffer.toString("base64");
}

export async function envioPdfExists(envioId: string): Promise<boolean> {
  return (await resolveEnvioPdfPath(envioId)) !== null;
}
