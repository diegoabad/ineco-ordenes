import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { getGestionProfesional, saveGestionProfesional } from "../services/db.service.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const data = await getGestionProfesional();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer Gestión profesional",
    });
  }
});

router.put("/", async (req, res) => {
  try {
    const user = (req as AuthedRequest).user;
    const data = await saveGestionProfesional(req.body, user?.email ?? null);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al guardar Gestión profesional";
    const status = /demasiad/i.test(message) ? 400 : 500;
    res.status(status).json({ ok: false, message });
  }
});

export default router;
