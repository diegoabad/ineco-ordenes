import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  addPedidoSistemaFotos,
  completarPedidoSistema,
  createPedidoSistema,
  deletePedidoSistema,
  getPedidoSistema,
  listPedidosSistema,
  removePedidoSistemaFoto,
  updatePedidoSistema,
} from "../services/db.service.js";
import type {
  AppUserPublic,
  PedidoSistema,
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

function viewer(req: AuthedRequest): AppUserPublic {
  if (!req.user) throw new Error("No autenticado");
  return req.user;
}

function esDuenoPedidos(user: AppUserPublic): boolean {
  return user.sistemas === true;
}

function esPedidoPropio(pedido: PedidoSistema, user: AppUserPublic): boolean {
  if (pedido.creadoPorUserId && pedido.creadoPorUserId === user.id) return true;
  const email = user.email.trim().toLowerCase();
  return Boolean(email && pedido.creadoPorEmail?.trim().toLowerCase() === email);
}

function assertPuedeVer(pedido: PedidoSistema, user: AppUserPublic): void {
  if (esDuenoPedidos(user) || esPedidoPropio(pedido, user)) return;
  throw new Error("Pedido no encontrado");
}

function assertPuedeEditarFotos(pedido: PedidoSistema, user: AppUserPublic): void {
  if (esPedidoPropio(pedido, user)) return;
  throw new Error("Solo quien creó el pedido puede cambiar los adjuntos");
}

function isSeccion(value: unknown): value is PedidoSistemaSeccion {
  return (
    value === "ordenes" ||
    value === "presupuestos" ||
    value === "pami" ||
    value === "busca-turno" ||
    value === "whatsapp" ||
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

router.get("/", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    const all = await listPedidosSistema();
    const data = esDuenoPedidos(user) ? all : all.filter((p) => esPedidoPropio(p, user));
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al listar pedidos",
    });
  }
});

router.get("/pendientes-count", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    if (!esDuenoPedidos(user)) {
      res.json({ ok: true, data: { count: 0 } });
      return;
    }
    const all = await listPedidosSistema();
    res.json({
      ok: true,
      data: { count: all.filter((p) => p.estado === "pendiente").length },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al contar pendientes",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    const data = await getPedidoSistema(paramId(req));
    assertPuedeVer(data, user);
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

router.post("/:id/completar", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    if (!esDuenoPedidos(user)) {
      res.status(403).json({ ok: false, message: "No podés cambiar el estado del pedido" });
      return;
    }
    const mensaje = String((req.body as { mensaje?: unknown })?.mensaje ?? "");
    const result = await completarPedidoSistema(paramId(req), mensaje);
    res.json({
      ok: true,
      data: result.pedido,
      emailError: result.emailError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al completar el pedido";
    res.status(message === "Pedido no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    const id = paramId(req);
    const current = await getPedidoSistema(id);
    assertPuedeVer(current, user);
    const input = parseUpdateInput(req.body);
    if (input.estado && input.estado !== current.estado && !esDuenoPedidos(user)) {
      res.status(403).json({ ok: false, message: "No podés cambiar el estado del pedido" });
      return;
    }
    const data = await updatePedidoSistema(id, input);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al actualizar pedido";
    res.status(message === "Pedido no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

router.post("/:id/fotos", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    const id = paramId(req);
    const current = await getPedidoSistema(id);
    assertPuedeVer(current, user);
    assertPuedeEditarFotos(current, user);
    const fotos = parseFotos((req.body as { fotos?: unknown })?.fotos);
    const data = await addPedidoSistemaFotos(id, fotos);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al subir adjuntos";
    const status =
      message === "Pedido no encontrado"
        ? 404
        : message.includes("Solo quien creó")
          ? 403
          : 400;
    res.status(status).json({ ok: false, message });
  }
});

router.delete("/:id/fotos", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    const id = paramId(req);
    const current = await getPedidoSistema(id);
    assertPuedeVer(current, user);
    assertPuedeEditarFotos(current, user);
    const url = String((req.body as { url?: unknown })?.url ?? "").trim();
    const data = await removePedidoSistemaFoto(id, url);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al eliminar adjunto";
    const status =
      message === "Pedido no encontrado" || message === "Adjunto no encontrado"
        ? 404
        : message.includes("Solo quien creó")
          ? 403
          : 400;
    res.status(status).json({ ok: false, message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const user = viewer(req as AuthedRequest);
    const id = paramId(req);
    const current = await getPedidoSistema(id);
    assertPuedeVer(current, user);
    await deletePedidoSistema(id);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al eliminar pedido";
    res.status(message === "Pedido no encontrado" ? 404 : 400).json({ ok: false, message });
  }
});

export default router;
