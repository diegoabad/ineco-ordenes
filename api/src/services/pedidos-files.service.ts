import fs from "node:fs/promises";
import path from "node:path";
import { uploadsPedidosDir } from "../config/paths.js";

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
