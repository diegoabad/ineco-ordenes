import { Router } from "express";
import { getDb, setMedicoSeleccionadoId } from "../services/db.service.js";

const router = Router();

router.get("/db", async (_req, res) => {
  try {
    const data = await getDb();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer datos",
    });
  }
});

router.put("/config/medico-seleccionado", async (req, res) => {
  try {
    const medicoSeleccionadoId =
      typeof req.body?.medicoSeleccionadoId === "string"
        ? req.body.medicoSeleccionadoId
        : req.body?.medicoSeleccionadoId === null
          ? null
          : undefined;

    if (medicoSeleccionadoId === undefined) {
      res.status(400).json({ ok: false, message: "medicoSeleccionadoId inválido" });
      return;
    }

    const data = await setMedicoSeleccionadoId(medicoSeleccionadoId);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar configuración",
    });
  }
});

export default router;
