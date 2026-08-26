import { Router } from "express";
import {
  createPaciente,
  deletePaciente,
  listPacientes,
  updatePaciente,
} from "../services/db.service.js";
import type { PacienteInput } from "../types.js";

const router = Router();

function parsePacienteInput(body: unknown): PacienteInput {
  const raw = body as Record<string, unknown>;
  const medicoId =
    typeof raw.medicoId === "string" && raw.medicoId.trim() ? raw.medicoId.trim() : null;

  return {
    paciente: String(raw.paciente ?? "").trim(),
    obraSocial: String(raw.obraSocial ?? "").trim(),
    afiliado: String(raw.afiliado ?? "").trim(),
    prestacion: String(raw.prestacion ?? "").trim(),
    diagnostico: String(raw.diagnostico ?? "").trim(),
    medicoId,
  };
}

function paramId(req: { params: { id?: string | string[] } }): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : id!;
}

router.get("/", async (_req, res) => {
  try {
    const data = await listPacientes();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar pacientes",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = parsePacienteInput(req.body);
    if (!input.paciente) {
      res.status(400).json({ ok: false, message: "El nombre del paciente es obligatorio" });
      return;
    }
    const paciente = await createPaciente(input);
    res.status(201).json({ ok: true, data: paciente });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al crear paciente",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const input = parsePacienteInput(req.body);
    if (!input.paciente) {
      res.status(400).json({ ok: false, message: "El nombre del paciente es obligatorio" });
      return;
    }
    const paciente = await updatePaciente(paramId(req), input);
    res.json({ ok: true, data: paciente });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al actualizar paciente";
    res.status(message === "Paciente no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deletePaciente(paramId(req));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al eliminar paciente";
    res.status(message === "Paciente no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

export default router;
