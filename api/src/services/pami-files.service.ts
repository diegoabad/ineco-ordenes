import fs from "node:fs/promises";
import path from "node:path";
import { uploadsPamiDir } from "../config/paths.js";

export async function ensurePamiUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsPamiDir(), { recursive: true });
}

function stripBase64(input: string): string {
  const trimmed = input.trim();
  const m = /^data:[^;]+;base64,(.+)$/i.exec(trimmed);
  return (m ? m[1] : trimmed).trim();
}

export async function savePamiFile(
  analisisId: string,
  kind: "presentacion" | "debitos" | "pdf",
  base64: string,
  ext: string,
): Promise<{ filePath: string; publicUrl: string }> {
  await ensurePamiUploadsDir();
  const buffer = Buffer.from(stripBase64(base64), "base64");
  if (buffer.length === 0) throw new Error(`Archivo ${kind} inválido`);
  const fileName = `${analisisId}-${kind}.${ext}`;
  const filePath = path.join(uploadsPamiDir(), fileName);
  await fs.writeFile(filePath, buffer);
  const publicUrl = `/uploads/pami/${fileName}?v=${Date.now()}`;
  return { filePath, publicUrl };
}

export async function deletePamiAnalisisFiles(analisisId: string): Promise<void> {
  const dir = uploadsPamiDir();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of entries) {
    if (!name.startsWith(`${analisisId}-`)) continue;
    try {
      await fs.unlink(path.join(dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
