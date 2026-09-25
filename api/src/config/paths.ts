import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

/** Raíz del paquete API (`api/`), tanto en dev como en Docker (`/app/api`). */
export const API_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * UPLOADS_DIR apunta a la carpeta de firmas (`.../uploads/firmas`).
 * La raíz de uploads (volumen Docker `./uploads`) es el padre de esa carpeta.
 */
export function uploadsRootDir(): string {
  const firmasOrRoot = path.isAbsolute(env.uploadsDir)
    ? env.uploadsDir
    : path.join(API_ROOT, env.uploadsDir);

  if (path.basename(firmasOrRoot).toLowerCase() === "firmas") {
    return path.dirname(firmasOrRoot);
  }
  // Si alguien configuró UPLOADS_DIR como la raíz `uploads`, usarla directo.
  return firmasOrRoot;
}

export function uploadsFirmasDir(): string {
  const configured = path.isAbsolute(env.uploadsDir)
    ? env.uploadsDir
    : path.join(API_ROOT, env.uploadsDir);
  if (path.basename(configured).toLowerCase() === "firmas") {
    return configured;
  }
  return path.join(configured, "firmas");
}

/** PDFs adjuntos de envíos (éxito o fallo). */
export function uploadsEnviosDir(): string {
  return path.join(uploadsRootDir(), "envios");
}

/** PDFs de presupuestos emitidos. */
export function uploadsPresupuestosDir(): string {
  return path.join(uploadsRootDir(), "presupuestos");
}

/** Excels y PDF del módulo PAMI. */
export function uploadsPamiDir(): string {
  return path.join(uploadsRootDir(), "pami");
}

/** Fotos adjuntas de pedidos al sistema. */
export function uploadsPedidosDir(): string {
  return path.join(uploadsRootDir(), "pedidos");
}

/** Rutas históricas / mal configuradas donde a veces quedaron PDFs. */
export function legacyPresupuestoPdfDirs(): string[] {
  const root = uploadsRootDir();
  return [
    path.join(uploadsFirmasDir(), "presupuestos"),
    path.join(API_ROOT, "presupuestos"),
    path.join(API_ROOT, "uploads", "presupuestos"),
    path.join(path.dirname(API_ROOT), "uploads", "presupuestos"),
    path.join(path.dirname(root), "presupuestos"),
  ];
}

/** Rutas históricas donde a veces quedaron PDFs de envíos de órdenes. */
export function legacyEnvioPdfDirs(): string[] {
  const root = uploadsRootDir();
  return [
    path.join(uploadsFirmasDir(), "envios"),
    path.join(API_ROOT, "envios"),
    path.join(API_ROOT, "uploads", "envios"),
    path.join(path.dirname(API_ROOT), "uploads", "envios"),
    path.join(path.dirname(root), "envios"),
  ];
}

/** Rutas históricas donde a veces quedaron firmas (fuera de uploads/firmas). */
export function legacyFirmaDirs(): string[] {
  const root = uploadsRootDir();
  return [
    root, // a veces quedaron .webp sueltos en ./uploads/
    path.join(API_ROOT, "uploads", "firmas"),
    path.join(API_ROOT, "firmas"),
    path.join(path.dirname(API_ROOT), "uploads", "firmas"),
    path.join(path.dirname(root), "firmas"),
  ];
}
