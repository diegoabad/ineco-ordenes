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
