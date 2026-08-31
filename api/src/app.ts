import cors from "cors";
import express from "express";
import {
  uploadsEnviosDir,
  uploadsFirmasDir,
  uploadsPamiDir,
  uploadsPresupuestosDir,
} from "./config/paths.js";
import configRoutes from "./routes/config.routes.js";
import medicosRoutes from "./routes/medicos.routes.js";
import pacientesRoutes from "./routes/pacientes.routes.js";
import pamiRoutes from "./routes/pami.routes.js";
import prestacionesRoutes from "./routes/prestaciones.routes.js";
import presupuestosRoutes from "./routes/presupuestos.routes.js";
import { ensureUploadsDir } from "./services/image.service.js";
import { ensurePamiUploadsDir } from "./services/pami-files.service.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ordenes-ineco-api" });
});

app.use("/uploads/firmas", express.static(uploadsFirmasDir()));
app.use("/uploads/envios", express.static(uploadsEnviosDir()));
app.use(
  "/uploads/presupuestos",
  express.static(uploadsPresupuestosDir(), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);
app.use(
  "/uploads/pami",
  express.static(uploadsPamiDir(), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);

app.use("/api", configRoutes);
app.use("/api/pacientes", pacientesRoutes);
app.use("/api/medicos", medicosRoutes);
app.use("/api/prestaciones", prestacionesRoutes);
app.use("/api/presupuestos", presupuestosRoutes);
app.use("/api/pami", pamiRoutes);

app.use(
  (
    err: Error & { code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ ok: false, message: "La imagen supera el tamaño máximo permitido" });
      return;
    }
    if (err.message === "Solo se permiten imágenes") {
      res.status(400).json({ ok: false, message: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ ok: false, message: "Error interno del servidor" });
  },
);

void ensureUploadsDir();
void ensurePamiUploadsDir();

export default app;
