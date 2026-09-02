import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import {
  uploadsEnviosDir,
  uploadsFirmasDir,
  uploadsPamiDir,
  uploadsPedidosDir,
  uploadsPresupuestosDir,
} from "./config/paths.js";
import { requireAuth, requireModule } from "./middleware/auth.middleware.js";
import { medexisProxy } from "./middleware/medexis.proxy.js";
import authRoutes from "./routes/auth.routes.js";
import buscaTurnoRoutes from "./routes/busca-turno.routes.js";
import configRoutes from "./routes/config.routes.js";
import medicosRoutes from "./routes/medicos.routes.js";
import pacientesRoutes from "./routes/pacientes.routes.js";
import pamiRoutes from "./routes/pami.routes.js";
import pedidosSistemaRoutes from "./routes/pedidos-sistema.routes.js";
import prestacionesRoutes from "./routes/prestaciones.routes.js";
import presupuestosRoutes from "./routes/presupuestos.routes.js";
import usuariosRoutes from "./routes/usuarios.routes.js";
import { ensureUploadsDir } from "./services/image.service.js";
import { ensurePamiUploadsDir } from "./services/pami-files.service.js";
import { ensurePedidosUploadsDir } from "./services/pedidos-files.service.js";

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(cookieParser());

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
app.use(
  "/uploads/pedidos",
  express.static(uploadsPedidosDir(), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);

/** Proxy Medexis antes de express.json (necesita el body crudo). */
app.use(
  "/api/medexis",
  requireAuth,
  requireModule("busca-turno"),
  medexisProxy,
);

app.use(express.json({ limit: "50mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/usuarios", usuariosRoutes);

app.use("/api", configRoutes);
app.use("/api/pacientes", requireAuth, requireModule("ordenes"), pacientesRoutes);
app.use("/api/medicos", medicosRoutes);
app.use(
  "/api/prestaciones",
  requireAuth,
  requireModule("presupuestos"),
  prestacionesRoutes,
);
app.use(
  "/api/presupuestos",
  requireAuth,
  requireModule("presupuestos"),
  presupuestosRoutes,
);
app.use("/api/pami", requireAuth, requireModule("pami"), pamiRoutes);
app.use(
  "/api/busca-turno",
  requireAuth,
  requireModule("busca-turno"),
  buscaTurnoRoutes,
);
app.use(
  "/api/pedidos-sistema",
  requireAuth,
  requireModule("pedidos-sistema"),
  pedidosSistemaRoutes,
);

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
void ensurePedidosUploadsDir();

export default app;
