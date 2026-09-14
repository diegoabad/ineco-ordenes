import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import {
  aceptarInicioRecordatorio,
  createInicioItem,
  deleteInicioItem,
  listInicioItems,
  notifyInicioRecordatorioEmail,
  reorderInicioItems,
  updateInicioItem,
} from "../services/inicio.service.js";
import type {
  InicioItemCreateInput,
  InicioItemTipo,
  InicioItemUpdateInput,
  InicioNotaColor,
  InicioRecurrencia,
} from "../types.js";

const router = Router();

function paramId(req: { params: { id?: string | string[] } }): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0]! : id!;
}

function isTipo(value: unknown): value is InicioItemTipo {
  return value === "tarea" || value === "nota" || value === "recordatorio";
}

function isNotaColor(value: unknown): value is InicioNotaColor {
  return (
    value === "gris" ||
    value === "amarillo" ||
    value === "verde" ||
    value === "azul" ||
    value === "rosa" ||
    value === "naranja"
  );
}

function isRecurrencia(value: unknown): value is InicioRecurrencia {
  return (
    value === "none" ||
    value === "semanal" ||
    value === "mensual" ||
    value === "cada_n_dias"
  );
}

function parseIntervaloDias(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Intervalo de días inválido");
  return Math.trunc(n);
}

function requireUserId(req: AuthedRequest): string {
  const id = req.user?.id?.trim();
  if (!id) throw new Error("No autenticado");
  return id;
}

function parseSharedWithIds(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("Lista de usuarios inválida");
  return raw.map((id) => String(id ?? "").trim()).filter(Boolean);
}

function parseCreateInput(body: unknown): InicioItemCreateInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  if (!isTipo(raw.tipo)) throw new Error("Tipo inválido");
  let recurrencia: InicioRecurrencia | undefined;
  if (raw.recurrencia !== undefined) {
    if (!isRecurrencia(raw.recurrencia)) throw new Error("Recurrencia inválida");
    recurrencia = raw.recurrencia;
  }
  const sharedWithIds = parseSharedWithIds(raw.sharedWithIds);
  return {
    tipo: raw.tipo,
    titulo: String(raw.titulo ?? "").trim(),
    detalle: String(raw.detalle ?? "").trim(),
    fechaHora: raw.fechaHora == null ? null : String(raw.fechaHora),
    ...(isNotaColor(raw.color) ? { color: raw.color } : {}),
    ...(raw.avisoApp !== undefined ? { avisoApp: Boolean(raw.avisoApp) } : {}),
    ...(raw.avisoEmail !== undefined ? { avisoEmail: Boolean(raw.avisoEmail) } : {}),
    ...(recurrencia !== undefined ? { recurrencia } : {}),
    ...(raw.intervaloDias !== undefined
      ? { intervaloDias: parseIntervaloDias(raw.intervaloDias) }
      : {}),
    ...(raw.origenTareaId !== undefined
      ? {
          origenTareaId:
            raw.origenTareaId == null ? null : String(raw.origenTareaId).trim() || null,
        }
      : {}),
    ...(sharedWithIds !== undefined ? { sharedWithIds } : {}),
  };
}

function parseUpdateInput(body: unknown): InicioItemUpdateInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const input: InicioItemUpdateInput = {};
  if (raw.titulo !== undefined) input.titulo = String(raw.titulo ?? "").trim();
  if (raw.detalle !== undefined) input.detalle = String(raw.detalle ?? "").trim();
  if (raw.fechaHora !== undefined) {
    input.fechaHora = raw.fechaHora == null ? null : String(raw.fechaHora);
  }
  if (raw.hecha !== undefined) input.hecha = Boolean(raw.hecha);
  if (raw.color !== undefined) {
    if (!isNotaColor(raw.color)) throw new Error("Color inválido");
    input.color = raw.color;
  }
  if (raw.avisoApp !== undefined) input.avisoApp = Boolean(raw.avisoApp);
  if (raw.avisoEmail !== undefined) input.avisoEmail = Boolean(raw.avisoEmail);
  if (raw.emailEnviadoAt !== undefined) {
    input.emailEnviadoAt =
      raw.emailEnviadoAt == null ? null : String(raw.emailEnviadoAt);
  }
  if (raw.recurrencia !== undefined) {
    if (!isRecurrencia(raw.recurrencia)) throw new Error("Recurrencia inválida");
    input.recurrencia = raw.recurrencia;
  }
  if (raw.intervaloDias !== undefined) {
    input.intervaloDias = parseIntervaloDias(raw.intervaloDias);
  }
  if (raw.pinned !== undefined) input.pinned = Boolean(raw.pinned);
  if (raw.sharedWithIds !== undefined) {
    input.sharedWithIds = parseSharedWithIds(raw.sharedWithIds) ?? [];
  }
  return input;
}

router.get("/", async (req, res) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const tipoRaw = typeof req.query.tipo === "string" ? req.query.tipo : undefined;
    const tipo = tipoRaw && isTipo(tipoRaw) ? tipoRaw : undefined;
    if (tipoRaw && !tipo) {
      res.status(400).json({ ok: false, message: "Tipo inválido" });
      return;
    }
    const data = await listInicioItems(userId, tipo);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al listar";
    res.status(message === "No autenticado" ? 401 : 500).json({ ok: false, message });
  }
});

router.post("/", async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const userId = requireUserId(authed);
    const input = parseCreateInput(req.body);
    const data = await createInicioItem(userId, input, authed.user?.nombre);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al crear";
    const status =
      message === "No autenticado"
        ? 401
        : message.includes("obligator") ||
            message.includes("inválid") ||
            message.includes("Tipo") ||
            message.includes("adelante") ||
            message.includes("pasado") ||
            message.includes("Elegí") ||
            message.includes("Escribí") ||
            message.includes("Recurrencia") ||
            message.includes("Intervalo") ||
            message.includes("cuántos días") ||
            message.includes("usuarios")
          ? 400
          : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.put("/reorder", async (req, res) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const raw = (req.body ?? {}) as Record<string, unknown>;
    if (!isTipo(raw.tipo)) throw new Error("Tipo inválido");
    const ids = Array.isArray(raw.ids) ? raw.ids.map((id) => String(id ?? "")) : [];
    const data = await reorderInicioItems(userId, raw.tipo, ids);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al reordenar";
    const status =
      message === "No autenticado"
        ? 401
        : message.includes("inválid") ||
            message.includes("coincide") ||
            message.includes("Tipo") ||
            message.includes("duplicad")
          ? 400
          : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.post("/:id/aceptar", async (req, res) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const result = await aceptarInicioRecordatorio(userId, paramId(req));
    res.json({ ok: true, deleted: result.deleted, data: result.item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al aceptar";
    const status =
      message === "No autenticado"
        ? 401
        : message === "Ítem no encontrado"
          ? 404
          : message.includes("permiso")
            ? 403
            : message.includes("No es") || message.includes("no tiene") || message.includes("recurrente")
              ? 400
              : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.post("/:id/notify-email", async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const userId = requireUserId(authed);
    const email = authed.user?.email?.trim() || "";
    if (!email) throw new Error("No hay email de usuario para avisar");
    const data = await notifyInicioRecordatorioEmail(
      userId,
      paramId(req),
      email,
      authed.user?.nombre,
    );
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al notificar";
    const status =
      message === "No autenticado"
        ? 401
        : message === "Ítem no encontrado"
          ? 404
          : message.includes("permiso")
            ? 403
            : message.includes("todavía") ||
                message.includes("No es") ||
                message.includes("no avisa") ||
                message.includes("no tiene") ||
                message.includes("email") ||
                message.includes("correo")
              ? 400
              : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    const input = parseUpdateInput(req.body);
    const data = await updateInicioItem(userId, paramId(req), input);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al actualizar";
    const status =
      message === "No autenticado"
        ? 401
        : message === "Ítem no encontrado"
          ? 404
          : message.includes("permiso")
            ? 403
            : message.includes("obligator") ||
                message.includes("inválid") ||
                message.includes("adelante") ||
                message.includes("pasado") ||
                message.includes("Elegí") ||
                message.includes("Recurrencia") ||
                message.includes("Intervalo") ||
                message.includes("cuántos días") ||
                message.includes("dueño") ||
                message.includes("compartir") ||
                message.includes("asignar") ||
                message.includes("usuarios")
              ? 400
              : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const userId = requireUserId(req as AuthedRequest);
    await deleteInicioItem(userId, paramId(req));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al eliminar";
    const status =
      message === "No autenticado"
        ? 401
        : message === "Ítem no encontrado"
          ? 404
          : message.includes("dueño") || message.includes("permiso")
            ? 403
            : 500;
    res.status(status).json({ ok: false, message });
  }
});

export default router;
