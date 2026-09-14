import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { legacyFirmaDirs, uploadsFirmasDir } from "../config/paths.js";
import { ensureEnviosUploadsDir } from "./envio-pdf.service.js";
import { ensurePresupuestosUploadsDir } from "./presupuesto-pdf.service.js";

const MAX_WIDTH = 600;
const WEBP_QUALITY = 82;
const FIRMA_EXTS = [".webp", ".png", ".jpg", ".jpeg"] as const;

export function firmaFilePath(medicoId: string): string {
  return path.join(uploadsFirmasDir(), `${medicoId}.webp`);
}

export function firmaPublicUrl(medicoId: string): string {
  return `/uploads/firmas/${medicoId}.webp`;
}

export async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsFirmasDir(), { recursive: true });
  await ensureEnviosUploadsDir();
  await ensurePresupuestosUploadsDir();
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

/** IDs posibles del archivo: el del médico y el embebido en firmaUrl vieja. */
export function firmaCandidateIds(medicoId: string, firmaUrl?: string | null): string[] {
  const ids = [medicoId.trim()].filter(Boolean);
  const raw = firmaUrl?.trim() || "";
  const match = /\/uploads\/firmas\/([^/?#]+)\.(webp|png|jpe?g)$/i.exec(raw);
  if (match?.[1] && !ids.includes(match[1])) ids.push(match[1]);
  return ids;
}

function candidateFirmaPaths(ids: string[]): string[] {
  const dirs = [uploadsFirmasDir(), ...legacyFirmaDirs()];
  const out: string[] = [];
  for (const dir of dirs) {
    for (const id of ids) {
      for (const ext of FIRMA_EXTS) {
        out.push(path.join(dir, `${id}${ext}`));
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Resuelve la firma en disco. Si está en una ruta/extensión legacy, la copia
 * a la canónica `uploads/firmas/{medicoId}.webp` para que nginx/API la sirvan.
 */
export async function resolveFirmaPath(
  medicoId: string,
  firmaUrl?: string | null,
): Promise<{ path: string; recovered: boolean } | null> {
  const canonical = firmaFilePath(medicoId);
  if (await isReadableFile(canonical)) {
    return { path: canonical, recovered: false };
  }

  const ids = firmaCandidateIds(medicoId, firmaUrl);
  for (const candidate of candidateFirmaPaths(ids)) {
    if (candidate === canonical) continue;
    if (!(await isReadableFile(candidate))) continue;

    try {
      await ensureUploadsDir();
      if (path.extname(candidate).toLowerCase() === ".webp") {
        await fs.copyFile(candidate, canonical);
      } else {
        const buf = await fs.readFile(candidate);
        const optimized = await sharp(buf)
          .rotate()
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .resize({
            width: MAX_WIDTH,
            height: MAX_WIDTH,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: WEBP_QUALITY, effort: 4 })
          .toBuffer();
        await fs.writeFile(canonical, optimized);
      }
      console.warn(`[firma] Recuperada ${medicoId} desde ${candidate} → ${canonical}`);
      return { path: canonical, recovered: true };
    } catch (error) {
      console.error(
        `[firma] Encontrada en ${candidate} pero no se pudo copiar a ${canonical}`,
        error,
      );
      return { path: candidate, recovered: true };
    }
  }

  return null;
}

export async function optimizeAndSaveFirma(
  medicoId: string,
  input: Buffer,
): Promise<{ filePath: string; publicUrl: string; sizeBytes: number }> {
  await ensureUploadsDir();

  const outputPath = firmaFilePath(medicoId);
  const optimized = await sharp(input)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize({
      width: MAX_WIDTH,
      height: MAX_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer();

  await fs.writeFile(outputPath, optimized);

  return {
    filePath: outputPath,
    publicUrl: firmaPublicUrl(medicoId),
    sizeBytes: optimized.length,
  };
}

export async function deleteFirmaFile(medicoId: string): Promise<void> {
  const filePath = firmaFilePath(medicoId);
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
