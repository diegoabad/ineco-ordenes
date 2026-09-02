import { Router } from "express";
import { normalizeNombrePersona } from "../lib/nombrePersona.js";
import {
  createPaciente,
  listPacientes,
  setPacienteActivo,
  updatePaciente,
} from "../services/db.service.js";
import type { PacienteInput } from "../types.js";

const router = Router();

function parsePacienteInput(body: unknown): PacienteInput {
  const raw = body as Record<string, unknown>;
  const medicoId =
    typeof raw.medicoId === "string" && raw.medicoId.trim() ? raw.medicoId.trim() : null;

  return {
    paciente: normalizeNombrePersona(String(raw.paciente ?? "")),
    email: String(raw.email ?? "").trim(),
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

router.patch("/:id/activo", async (req, res) => {
  try {
    const activo = (req.body as { activo?: unknown })?.activo;
    if (typeof activo !== "boolean") {
      res.status(400).json({ ok: false, message: "Indicá activo: true o false" });
      return;
    }
    const paciente = await setPacienteActivo(paramId(req), activo);
    res.json({ ok: true, data: paciente });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al actualizar estado del paciente";
    res.status(message === "Paciente no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

export default router;
