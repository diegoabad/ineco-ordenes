import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

/** Raíz del paquete API (`api/`), tanto en dev como en Docker (`/app/api`). */
export const API_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function uploadsFirmasDir(): string {
  return path.isAbsolute(env.uploadsDir)
    ? env.uploadsDir
    : path.join(API_ROOT, env.uploadsDir);
}

/** PDFs adjuntos de envíos (éxito o fallo), hermano de firmas. */
export function uploadsEnviosDir(): string {
  return path.join(path.dirname(uploadsFirmasDir()), "envios");
}

/** PDFs de presupuestos emitidos. */
export function uploadsPresupuestosDir(): string {
  return path.join(path.dirname(uploadsFirmasDir()), "presupuestos");
}

/** Excels y PDF del módulo PAMI. */
export function uploadsPamiDir(): string {
  return path.join(path.dirname(uploadsFirmasDir()), "pami");
}
