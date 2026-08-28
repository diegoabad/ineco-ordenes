import fs from "node:fs/promises";
import path from "node:path";
import { uploadsPresupuestosDir } from "../config/paths.js";

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
  return { filePath, publicUrl: presupuestoPdfPublicUrl(presupuestoId) };
}

export async function deletePresupuestoPdfFile(presupuestoId: string): Promise<void> {
  try {
    await fs.unlink(presupuestoPdfFilePath(presupuestoId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function readPresupuestoPdfBase64(presupuestoId: string): Promise<string> {
  const buffer = await fs.readFile(presupuestoPdfFilePath(presupuestoId));
  if (buffer.length === 0) throw new Error("PDF inválido");
  return buffer.toString("base64");
}
