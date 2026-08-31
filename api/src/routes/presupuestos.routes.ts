import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  createPresupuesto,
  deletePresupuesto,
  enviarPresupuesto,
  getPresupuestoPlantillaConfig,
  getPresupuestosConfig,
  listPresupuestos,
  PresupuestoEnvioError,
  savePresupuestoPlantillaConfig,
  savePresupuestosConfig,
  updatePresupuesto,
  updatePresupuestoEstado,
} from "../services/db.service.js";
import { PRESUPUESTO_PLANTILLA_VARS } from "../services/presupuesto-plantilla-templates.js";
import type { PresupuestoPlantillaConfig } from "../services/presupuesto-plantilla-templates.js";
import {
  DEFAULT_MODALIDADES_PRESUPUESTO,
  DEFAULT_TIPOS_PRESTACION,
  TIPO_COLOR_PALETTE,
  type ModalidadPresupuesto,
  type PresupuestoCreateInput,
  type PresupuestoEstado,
  type PresupuestosConfig,
  type ProfesionalPresupuesto,
  type TipoPrestacion,
} from "../types.js";

const router = Router();

function normalizeHexColor(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function parseProfesionalesPresupuesto(raw: unknown): ProfesionalPresupuesto[] {
  if (!Array.isArray(raw)) return [];
  const result: ProfesionalPresupuesto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const nombreApellido = String(obj.nombreApellido ?? obj.nombre ?? "").trim();
    if (!nombreApellido) continue;
    const id = String(obj.id ?? "").trim() || randomUUID();
    const titulo = String(obj.titulo ?? "").trim();
    result.push({ id, titulo, nombreApellido });
  }
  return result;
}

function parseModalidadesPresupuesto(raw: unknown): ModalidadPresupuesto[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_MODALIDADES_PRESUPUESTO.map((m) => ({ ...m }));
  }
  const result: ModalidadPresupuesto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const titulo = String(obj.titulo ?? "").trim();
    if (!titulo) continue;
    const id = String(obj.id ?? "").trim() || randomUUID();
    const textoPdf = String(obj.textoPdf ?? "").trim();
    result.push({ id, titulo, textoPdf });
  }
  if (result.length === 0) {
    throw new Error("Debe haber al menos una modalidad");
  }
  return result;
}

function parsePresupuestosConfig(body: unknown): PresupuestosConfig {
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.tiposPrestacion)) {
    return {
      tiposPrestacion: DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t })),
      profesionales: parseProfesionalesPresupuesto(raw.profesionales),
      modalidades: parseModalidadesPresupuesto(raw.modalidades),
    };
  }

  const tipos: TipoPrestacion[] = [];
  for (let i = 0; i < raw.tiposPrestacion.length; i++) {
    const item = raw.tiposPrestacion[i];
    if (typeof item === "string") {
      const nombre = item.trim();
      if (!nombre) continue;
      const preset = DEFAULT_TIPOS_PRESTACION.find((t) => t.nombre === nombre);
      tipos.push(
        preset ?? {
          nombre,
          color: TIPO_COLOR_PALETTE[tipos.length % TIPO_COLOR_PALETTE.length]!,
        },
      );
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const nombre = String(obj.nombre ?? "").trim();
      if (!nombre) continue;
      const color =
        normalizeHexColor(String(obj.color ?? "")) ??
        TIPO_COLOR_PALETTE[tipos.length % TIPO_COLOR_PALETTE.length]!;
      tipos.push({ nombre, color });
    }
  }

  const seen = new Set<string>();
  const unique = tipos.filter((t) => {
    const key = t.nombre.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    throw new Error("Debe haber al menos un tipo de prestación");
  }

  return {
    tiposPrestacion: unique,
    profesionales: parseProfesionalesPresupuesto(raw.profesionales),
    modalidades: parseModalidadesPresupuesto(raw.modalidades),
  };
}

function parsePresupuestoPlantillaConfig(body: unknown): PresupuestoPlantillaConfig {
  const raw = body as Record<string, unknown>;
  return {
    body: String(raw.body ?? "").trim(),
  };
}

function parseCreatePresupuesto(body: unknown): PresupuestoCreateInput {
  const raw = body as Record<string, unknown>;
  const prestacionIds = Array.isArray(raw.prestacionIds)
    ? raw.prestacionIds.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  return {
    nombrePaciente: String(raw.nombrePaciente ?? "").trim(),
    profesional: String(raw.profesional ?? "").trim(),
    modalidadId: String(raw.modalidadId ?? "").trim(),
    email: String(raw.email ?? "").trim(),
    prestacionIds,
    pdfBase64: String(raw.pdfBase64 ?? "").trim() || undefined,
    enviar: raw.enviar === true,
  };
}

router.get("/", async (_req, res) => {
  try {
    const data = await listPresupuestos();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar presupuestos",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const data = await createPresupuesto(parseCreatePresupuesto(req.body));
    res.status(201).json({ ok: true, data });
  } catch (error) {
    if (error instanceof PresupuestoEnvioError) {
      return res.status(400).json({
        ok: false,
        message: error.message,
        data: error.presupuesto,
      });
    }
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al crear presupuesto",
    });
  }
});

router.get("/config", async (_req, res) => {
  try {
    const data = await getPresupuestosConfig();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer configuración",
    });
  }
});

router.put("/config", async (req, res) => {
  try {
    const data = await savePresupuestosConfig(parsePresupuestosConfig(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar configuración",
    });
  }
});

router.get("/plantilla", async (_req, res) => {
  try {
    const data = await getPresupuestoPlantillaConfig();
    res.json({ ok: true, data, variables: PRESUPUESTO_PLANTILLA_VARS });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer plantilla de presupuesto",
    });
  }
});

router.put("/plantilla", async (req, res) => {
  try {
    const data = await savePresupuestoPlantillaConfig(parsePresupuestoPlantillaConfig(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar plantilla de presupuesto",
    });
  }
});

function parsePresupuestoEstado(body: unknown): PresupuestoEstado {
  const raw = body as Record<string, unknown>;
  const estado = String(raw.estado ?? "").trim();
  if (estado === "aceptado" || estado === "rechazado") {
    return estado;
  }
  throw new Error("Solo se puede marcar como aceptado o rechazado");
}

function parsePresupuestoEnvioOverrides(body: unknown): { subject?: string; body?: string } {
  if (!body || typeof body !== "object") return {};
  const raw = body as Record<string, unknown>;
  const subject = String(raw.subject ?? "").trim();
  const emailBody = typeof raw.body === "string" ? raw.body : "";
  return {
    subject: subject || undefined,
    body: emailBody.trim() ? emailBody : undefined,
  };
}

router.post("/:id/enviar", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id!;
    const data = await enviarPresupuesto(id, parsePresupuestoEnvioOverrides(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    if (error instanceof PresupuestoEnvioError) {
      return res.status(400).json({
        ok: false,
        message: error.message,
        data: error.presupuesto,
      });
    }
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al enviar presupuesto",
    });
  }
});

router.patch("/:id/estado", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id!;
    const data = await updatePresupuestoEstado(id, parsePresupuestoEstado(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al actualizar estado del presupuesto",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id!;
    const data = await updatePresupuesto(id, parseCreatePresupuesto(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    if (error instanceof PresupuestoEnvioError) {
      return res.status(400).json({
        ok: false,
        message: error.message,
        data: error.presupuesto,
      });
    }
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al actualizar presupuesto",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deletePresupuesto(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al eliminar presupuesto",
    });
  }
});

export default router;
