import app from "./app.js";
import { env } from "./config/env.js";
import {
  uploadsEnviosDir,
  uploadsFirmasDir,
  uploadsPresupuestosDir,
  uploadsRootDir,
} from "./config/paths.js";
import { ensureUploadsDir } from "./services/image.service.js";
import { ensurePamiUploadsDir } from "./services/pami-files.service.js";
import { ensurePedidosUploadsDir } from "./services/pedidos-files.service.js";
import { reconcileUploadsOnStartup } from "./services/uploads-reconcile.service.js";
import { bootstrapWhatsapp } from "./whatsapp/runtime.js";

async function boot(): Promise<void> {
  await ensureUploadsDir();
  await ensurePamiUploadsDir();
  await ensurePedidosUploadsDir();

  // En local/tsx watch esto dispara muchas lecturas a Firestore y puede agotar la cuota.
  // Activar con UPLOADS_RECONCILE=1 (o en producción por defecto).
  const doReconcile =
    process.env.UPLOADS_RECONCILE === "1" ||
    process.env.UPLOADS_RECONCILE === "true" ||
    (process.env.NODE_ENV === "production" && process.env.UPLOADS_RECONCILE !== "0");
  if (doReconcile) {
    try {
      await reconcileUploadsOnStartup();
    } catch (error) {
      console.error("[uploads-reconcile] Falló el reconcile al arrancar", error);
    }
  } else {
    console.log("[uploads-reconcile] omitido (poné UPLOADS_RECONCILE=1 para forzarlo)");
  }

  try {
    await bootstrapWhatsapp();
  } catch (error) {
    console.error("[whatsapp] Falló el bootstrap de sesión", error);
  }

  app.listen(env.port, () => {
    console.log(`API corriendo en http://localhost:${env.port}`);
    console.log(`Health: GET http://localhost:${env.port}/health`);
    console.log(`Datos:  GET http://localhost:${env.port}/api/db`);
    console.log(`[uploads] UPLOADS_DIR=${env.uploadsDir}`);
    console.log(`[uploads] root=${uploadsRootDir()}`);
    console.log(`[uploads] firmas=${uploadsFirmasDir()}`);
    console.log(`[uploads] presupuestos=${uploadsPresupuestosDir()}`);
    console.log(`[uploads] envios=${uploadsEnviosDir()}`);
    console.log(`[whatsapp] session=${env.whatsapp.sessionPath}`);
  });
}

void boot();
