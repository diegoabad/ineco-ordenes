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

async function boot(): Promise<void> {
  await ensureUploadsDir();
  await ensurePamiUploadsDir();
  await ensurePedidosUploadsDir();

  try {
    await reconcileUploadsOnStartup();
  } catch (error) {
    console.error("[uploads-reconcile] Falló el reconcile al arrancar", error);
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
  });
}

void boot();
