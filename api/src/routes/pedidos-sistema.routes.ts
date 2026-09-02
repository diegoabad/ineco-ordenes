import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  createPedidoSistema,
  deletePedidoSistema,
  getPedidoSistema,
  listPedidosSistema,
  updatePedidoSistema,
} from "../services/db.service.js";
import type {
  PedidoSistemaCreateInput,
  PedidoSistemaEstado,
  PedidoSistemaFotoInput,
  PedidoSistemaPrioridad,
  PedidoSistemaSeccion,
  PedidoSistemaUpdateInput,
} from "../types.js";

const router = Router();

function paramId(req: { params: { id?: string | string[] } }): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : id!;
}

function isSeccion(value: unknown): value is PedidoSistemaSeccion {
  return (
    value === "ordenes" ||
    value === "presupuestos" ||
    value === "pami" ||
    value === "busca-turno" ||
    value === "nueva"
  );
}

function isPrioridad(value: unknown): value is PedidoSistemaPrioridad {
  return value === "baja" || value === "media" || value === "alta";
}

function isEstado(value: unknown): value is PedidoSistemaEstado {
  return value === "pendiente" || value === "en_proceso" || value === "finalizado";
}

function parseFotos(raw: unknown): PedidoSistemaFotoInput[] {
  if (!Array.isArray(raw)) return [];
  const out: PedidoSistemaFotoInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const base64 = String(o.base64 ?? "").trim();
    if (!base64) continue;
    const mime = String(o.mime ?? "").trim();
    out.push({
      base64,
      nombre: String(o.nombre ?? "foto").trim() || "foto",
      ...(mime ? { mime } : {}),
    });
  }
  return out;
}

function parseCreateInput(body: unknown): PedidoSistemaCreateInput {
  const raw = body as Record<string, unknown>;
  return {
    seccion: isSeccion(raw.seccion) ? raw.seccion : "nueva",
    seccionNueva: String(raw.seccionNueva ?? "").trim(),
    titulo: String(raw.titulo ?? "").trim(),
    detalle: String(raw.detalle ?? "").trim(),
    cuando: String(raw.cuando ?? "").trim(),
    solicitadoPor: String(raw.solicitadoPor ?? "").trim(),
    prioridad: isPrioridad(raw.prioridad) ? raw.prioridad : "media",
    fotos: parseFotos(raw.fotos),
  };
}

function parseUpdateInput(body: unknown): PedidoSistemaUpdateInput {
  const raw = body as Record<string, unknown>;
  const input: PedidoSistemaUpdateInput = {};
  if (raw.prioridad !== undefined) {
    if (!isPrioridad(raw.prioridad)) throw new Error("Prioridad inválida");
    input.prioridad = raw.prioridad;
  }
  if (raw.estado !== undefined) {
    if (!isEstado(raw.estado)) throw new Error("Estado inválido");
    input.estado = raw.estado;
  }
  if (raw.titulo !== undefined) input.titulo = String(raw.titulo ?? "").trim();
  if (raw.detalle !== undefined) input.detalle = String(raw.detalle ?? "").trim();
  if (raw.cuando !== undefined) input.cuando = String(raw.cuando ?? "").trim();
  return input;
}

router.get("/", async (_req, res) => {
  try {
    const data = await listPedidosSistema();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar pedidos",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const data = await getPedidoSistema(paramId(req));
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al obtener pedido";
    res.status(message === "Pedido no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = parseCreateInput(req.body);
    const user = (req as AuthedRequest).user;
    const data = await createPedidoSistema(input, {
      userId: user?.id ?? null,
      email: user?.email ?? null,
      nombre: user?.nombre ?? null,
    });
    res.status(201).json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al crear pedido",
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const input = parseUpdateInput(req.body);
    const data = await updatePedidoSistema(paramId(req), input);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al actualizar pedido";
    res.status(message === "Pedido no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deletePedidoSistema(paramId(req));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al eliminar pedido";
    res.status(message === "Pedido no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

export default router;
