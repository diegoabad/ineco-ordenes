import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uploadsFirmasDir } from "../config/paths.js";

const MAX_WIDTH = 600;
const WEBP_QUALITY = 82;

export function firmaFilePath(medicoId: string): string {
  return path.join(uploadsFirmasDir(), `${medicoId}.webp`);
}

export function firmaPublicUrl(medicoId: string): string {
  return `/uploads/firmas/${medicoId}.webp`;
}

export async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsFirmasDir(), { recursive: true });
}

export async function optimizeAndSaveFirma(
  medicoId: string,
  input: Buffer,
): Promise<{ filePath: string; publicUrl: string; sizeBytes: number }> {
  await ensureUploadsDir();

  const outputPath = firmaFilePath(medicoId);
  const optimized = await sharp(input)
    .rotate()
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
