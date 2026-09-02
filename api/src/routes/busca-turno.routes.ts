import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { getBuscaTurnoConfig, saveBuscaTurnoConfig } from "../services/db.service.js";
import type { BuscaTurnoConfig } from "../types.js";

const router = Router();

function parseBody(body: unknown): Omit<BuscaTurnoConfig, "updatedAt" | "version"> & {
  version?: number;
  updatedBy?: string | null;
} {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    version: 2,
    sedesCarga: Array.isArray(raw.sedesCarga) ? (raw.sedesCarga as string[]) : ["INECO"],
    profesionales: Array.isArray(raw.profesionales) ? (raw.profesionales as BuscaTurnoConfig["profesionales"]) : [],
    prestaciones:
      raw.prestaciones && typeof raw.prestaciones === "object" && !Array.isArray(raw.prestaciones)
        ? (raw.prestaciones as BuscaTurnoConfig["prestaciones"])
        : {},
    updatedBy: raw.updatedBy != null ? String(raw.updatedBy) : null,
  };
}

router.get("/config", async (_req, res) => {
  try {
    const data = await getBuscaTurnoConfig();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer configuración de Busca turno",
    });
  }
});

router.put("/config", async (req, res) => {
  try {
    const parsed = parseBody(req.body);
    const user = (req as AuthedRequest).user;
    const data = await saveBuscaTurnoConfig({
      ...parsed,
      updatedBy: user?.email ?? parsed.updatedBy ?? null,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al guardar configuración de Busca turno";
    const status = /vacía/i.test(message) ? 400 : 500;
    res.status(status).json({ ok: false, message });
  }
});

export default router;
