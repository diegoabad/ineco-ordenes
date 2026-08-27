import { Router } from "express";
import { uploadFirma } from "../middleware/upload.js";
import {
  createMedico,
  getMedicoById,
  listMedicos,
  setMedicoActivo,
  setMedicoFirmaUrl,
  updateMedico,
} from "../services/db.service.js";
import { deleteFirmaFile, optimizeAndSaveFirma } from "../services/image.service.js";
import type { MedicoInput } from "../types.js";

const router = Router();

function paramId(req: { params: { id?: string | string[] } }): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : id!;
}

function parseMedicoInput(body: unknown): MedicoInput {
  const raw = body as Record<string, unknown>;
  return {
    nombre: String(raw.nombre ?? "").trim(),
    especialidad: String(raw.especialidad ?? "").trim(),
    matricula: String(raw.matricula ?? "").replace(/^MN\s*/i, "").trim(),
  };
}

router.get("/", async (_req, res) => {
  try {
    const data = await listMedicos();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar médicos",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = parseMedicoInput(req.body);
    if (!input.nombre) {
      res.status(400).json({ ok: false, message: "El nombre del médico es obligatorio" });
      return;
    }
    const medico = await createMedico(input);
    res.status(201).json({ ok: true, data: medico });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al crear médico",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const input = parseMedicoInput(req.body);
    if (!input.nombre) {
      res.status(400).json({ ok: false, message: "El nombre del médico es obligatorio" });
      return;
    }
    const medico = await updateMedico(paramId(req), input);
    res.json({ ok: true, data: medico });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al actualizar médico";
    res.status(message === "Médico no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

router.patch("/:id/activo", async (req, res) => {
  try {
    const activo = (req.body as { activo?: unknown })?.activo;
    if (typeof activo !== "boolean") {
      res.status(400).json({ ok: false, message: "Indicá activo: true o false" });
      return;
    }
    const result = await setMedicoActivo(paramId(req), activo);
    res.json({
      ok: true,
      data: result.medico,
      meta: { pacientesReasignados: result.pacientesReasignados },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al actualizar estado del médico";
    const status =
      message === "Médico no encontrado"
        ? 404
        : message.includes("médico por defecto")
          ? 400
          : 400;
    res.status(status).json({ ok: false, message });
  }
});

router.get("/:id/firma-info", async (req, res) => {
  try {
    const medico = await getMedicoById(paramId(req));
    if (!medico) {
      res.status(404).json({ ok: false, message: "Médico no encontrado" });
      return;
    }

    res.json({
      ok: true,
      data: {
        id: medico.id,
        nombre: medico.nombre,
        especialidad: medico.especialidad,
        tieneFirma: Boolean(medico.firmaUrl),
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al obtener médico",
    });
  }
});

router.post("/:id/firma", uploadFirma.single("firma"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, message: "No se recibió ninguna imagen" });
      return;
    }

    const medicoId = paramId(req);
    const medico = await getMedicoById(medicoId);
    if (!medico) {
      res.status(404).json({ ok: false, message: "Médico no encontrado" });
      return;
    }

    await deleteFirmaFile(medicoId);
    const saved = await optimizeAndSaveFirma(medicoId, req.file.buffer);
    const actualizado = await setMedicoFirmaUrl(medicoId, saved.publicUrl);

    res.json({
      ok: true,
      data: actualizado,
      meta: { sizeBytes: saved.sizeBytes },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al guardar firma";
    res.status(message === "Médico no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

router.delete("/:id/firma", async (req, res) => {
  try {
    const medicoId = paramId(req);
    const medico = await getMedicoById(medicoId);
    if (!medico) {
      res.status(404).json({ ok: false, message: "Médico no encontrado" });
      return;
    }

    await deleteFirmaFile(medicoId);
    const actualizado = await setMedicoFirmaUrl(medicoId, null);
    res.json({ ok: true, data: actualizado });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al eliminar firma",
    });
  }
});

export default router;
