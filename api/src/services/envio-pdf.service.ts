import fs from "node:fs/promises";
import path from "node:path";
import { uploadsEnviosDir } from "../config/paths.js";

export function envioPdfFilePath(envioId: string): string {
  return path.join(uploadsEnviosDir(), `${envioId}.pdf`);
}

export function envioPdfPublicUrl(envioId: string): string {
  return `/uploads/envios/${envioId}.pdf`;
}

export async function ensureEnviosUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsEnviosDir(), { recursive: true });
}

export async function saveEnvioPdf(
  envioId: string,
  pdfBase64: string,
): Promise<{ filePath: string; publicUrl: string }> {
  await ensureEnviosUploadsDir();
  const buffer = Buffer.from(pdfBase64, "base64");
  if (buffer.length === 0) {
    throw new Error("PDF inválido");
  }
  const filePath = envioPdfFilePath(envioId);
  await fs.writeFile(filePath, buffer);
  return { filePath, publicUrl: envioPdfPublicUrl(envioId) };
}

export async function deleteEnvioPdfFile(envioId: string): Promise<void> {
  try {
    await fs.unlink(envioPdfFilePath(envioId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
