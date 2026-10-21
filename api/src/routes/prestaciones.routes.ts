import { Router } from "express";
import {
  createPrestacion,
  deletePrestacion,
  listPrestaciones,
  updatePrestacion,
} from "../services/db.service.js";
import {
  esTipoTratamiento,
  parseFrecuenciaTratamiento,
  parseSesionesTratamiento,
  type PrestacionInput,
} from "../types.js";

const router = Router();

function parseMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function parseMinutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return 0;
}

function parsePrestacionInput(body: unknown): PrestacionInput {
  const raw = body as Record<string, unknown>;
  const tipo = String(raw.tipo ?? "").trim() || "Evaluación";
  const tratamiento = esTipoTratamiento(tipo);
  const frecuencia = tratamiento ? parseFrecuenciaTratamiento(raw.frecuencia) : null;
  const sesiones = tratamiento ? parseSesionesTratamiento(raw.frecuencia, raw.sesiones) : null;
  if (tratamiento && !frecuencia) {
    throw new Error("Elegí la frecuencia del tratamiento");
  }
  if (tratamiento && (!sesiones || sesiones < 1)) {
    throw new Error("Las sesiones tienen que ser 1 o más");
  }
  return {
    titulo: String(raw.titulo ?? "").trim(),
    descripcion: String(raw.descripcion ?? "").trim(),
    tipo,
    duracionMinutos: parseMinutes(raw.duracionMinutos),
    precioEfectivo: parseMoney(raw.precioEfectivo),
    precio3Cuotas: tratamiento ? 0 : parseMoney(raw.precio3Cuotas),
    frecuencia,
    sesiones,
  };
}

function paramId(req: { params: { id?: string | string[] } }): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : id!;
}

router.get("/", async (_req, res) => {
  try {
    const data = await listPrestaciones();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar prestaciones",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = parsePrestacionInput(req.body);
    if (!input.titulo) {
      res.status(400).json({ ok: false, message: "El título es obligatorio" });
      return;
    }
    const prestacion = await createPrestacion(input);
    res.status(201).json({ ok: true, data: prestacion });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al crear prestación",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const input = parsePrestacionInput(req.body);
    if (!input.titulo) {
      res.status(400).json({ ok: false, message: "El título es obligatorio" });
      return;
    }
    const prestacion = await updatePrestacion(paramId(req), input);
    res.json({ ok: true, data: prestacion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al actualizar prestación";
    res.status(message === "Prestación no encontrada" ? 404 : 400).json({ ok: false, message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deletePrestacion(paramId(req));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al eliminar prestación";
    res.status(message === "Prestación no encontrada" ? 404 : 400).json({ ok: false, message });
  }
});

export default router;
