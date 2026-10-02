import { Router } from "express";
import { getUserById } from "../services/users.service.js";
import {
  addWhatsappOperator,
  countOperatorAssignments,
  isWhatsappOperator,
  listWhatsappOperators,
  removeWhatsappOperator,
} from "../whatsapp/operators.js";
import {
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateQuickReply,
} from "../whatsapp/quick-replies.js";
import {
  createWhatsappFlow,
  deleteWhatsappFlow,
  listWhatsappFlows,
  updateWhatsappFlow,
} from "../whatsapp/flows.js";
import {
  createWhatsappProfileField,
  deleteWhatsappProfileField,
  ensureWhatsappProfileSchemaDefaults,
  updateWhatsappProfileField,
} from "../whatsapp/profile-schema.js";
import multer from "multer";
import { createReadStream, existsSync } from "node:fs";
import {
  connectWhatsapp,
  disconnectWhatsapp,
  getConversation,
  getMessage,
  getWhatsappStatus,
  listConversations,
  listMessagesByConversation,
  logoutWhatsapp,
  markConversationRead,
  mediaStorage,
  sendConversationMedia,
  sendConversationText,
  setConversationAssignee,
  setConversationTags,
} from "../whatsapp/runtime.js";
import { updateContactDisplayName } from "../whatsapp/firestore-store.js";
import {
  createWhatsappTag,
  createWhatsappTagGroup,
  deleteWhatsappTag,
  deleteWhatsappTagGroup,
  listWhatsappTagCatalog,
  listWhatsappTags,
  updateWhatsappTag,
  updateWhatsappTagGroup,
} from "../whatsapp/tags.js";

const router = Router();
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

function sendError(res: import("express").Response, error: unknown, fallback = "Error WhatsApp"): void {
  const raw = error instanceof Error ? error.message : fallback;
  const message = raw.includes("Missing or insufficient permissions")
    ? "Firestore rechazó WhatsApp: faltan las reglas de whatsapp_contacts, whatsapp_conversations y whatsapp_messages."
    : raw;
  const status =
    message.includes("no está conectado") || message.includes("no encontrada")
      ? 400
      : raw.includes("Missing or insufficient permissions")
        ? 403
        : 500;
  res.status(status).json({ ok: false, message });
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    configured: true,
    status: getWhatsappStatus().status,
  });
});

router.get("/whatsapp/status", (_req, res) => {
  res.json({ ok: true, data: getWhatsappStatus() });
});

router.post("/whatsapp/connect", async (_req, res) => {
  try {
    const data = await connectWhatsapp();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo conectar WhatsApp");
  }
});

router.post("/whatsapp/disconnect", async (_req, res) => {
  try {
    const data = await disconnectWhatsapp();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/whatsapp/logout", async (_req, res) => {
  try {
    const data = await logoutWhatsapp();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/operators", async (_req, res) => {
  try {
    const data = await listWhatsappOperators();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron listar las operadoras");
  }
});

router.post("/operators", async (req, res) => {
  try {
    const userId = String(req.body?.userId ?? "").trim();
    if (!userId) {
      res.status(400).json({ ok: false, message: "Elegí un usuario" });
      return;
    }
    const data = await addWhatsappOperator(userId, String(req.body?.color ?? ""));
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo agregar";
    const status = message.includes("no está activo") || message.includes("color") ? 400 : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.get("/operators/:userId/assignments", async (req, res) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const count = await countOperatorAssignments(String(userId ?? ""));
    res.json({ ok: true, data: { count } });
  } catch (error) {
    sendError(res, error, "No se pudieron consultar las conversaciones asignadas");
  }
});

router.delete("/operators/:userId", async (req, res) => {
  try {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const reassignRaw = req.body?.reassign;
    const reassign =
      reassignRaw && typeof reassignRaw === "object"
        ? {
            kind: String((reassignRaw as { kind?: unknown }).kind ?? "") as "none" | "bot" | "user",
            userId:
              (reassignRaw as { userId?: unknown }).userId != null
                ? String((reassignRaw as { userId?: unknown }).userId)
                : undefined,
          }
        : null;
    const data = await removeWhatsappOperator(String(userId ?? ""), reassign);
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo quitar la operadora";
    if (message === "HAS_ASSIGNED") {
      const count =
        error instanceof Error && "assignedCount" in error
          ? Number((error as Error & { assignedCount: number }).assignedCount)
          : 0;
      res.status(409).json({
        ok: false,
        code: "HAS_ASSIGNED",
        message: "La operadora tiene conversaciones asignadas",
        data: { count },
      });
      return;
    }
    const status =
      message.includes("Elegí") ||
      message.includes("no encontrado") ||
      message.includes("operadoras")
        ? 400
        : 500;
    res.status(status).json({ ok: false, message });
  }
});

function quickReplyStatus(message: string): number {
  if (message.includes("no encontrada")) return 404;
  if (
    message.includes("disparador") ||
    message.includes("vacío") ||
    message.includes("Ya existe")
  ) {
    return 400;
  }
  return 500;
}

router.get("/quick-replies", async (_req, res) => {
  try {
    const data = await listQuickReplies();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron listar las respuestas rápidas");
  }
});

router.post("/quick-replies", async (req, res) => {
  try {
    const data = await createQuickReply({
      trigger: String(req.body?.trigger ?? ""),
      title: req.body?.title != null ? String(req.body.title) : null,
      body: String(req.body?.body ?? ""),
      tagIds: Array.isArray(req.body?.tagIds) ? req.body.tagIds : undefined,
      isActive: req.body?.isActive !== false,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la respuesta";
    res.status(quickReplyStatus(message)).json({ ok: false, message });
  }
});

router.patch("/quick-replies/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await updateQuickReply(String(id ?? ""), {
      trigger: req.body?.trigger != null ? String(req.body.trigger) : undefined,
      title: req.body?.title !== undefined ? (req.body.title == null ? null : String(req.body.title)) : undefined,
      body: req.body?.body != null ? String(req.body.body) : undefined,
      tagIds: Array.isArray(req.body?.tagIds) ? req.body.tagIds : undefined,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la respuesta";
    res.status(quickReplyStatus(message)).json({ ok: false, message });
  }
});

router.delete("/quick-replies/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteQuickReply(String(id ?? ""));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar la respuesta";
    res.status(quickReplyStatus(message)).json({ ok: false, message });
  }
});

function flowStatus(message: string): number {
  if (message.includes("no encontrad")) return 404;
  if (
    message.includes("nombre") ||
    message.includes("paso") ||
    message.includes("Ya existe") ||
    message.includes("mensaje") ||
    message.includes("subflujo") ||
    message.includes("campo")
  ) {
    return 400;
  }
  return 500;
}

router.get("/flows", async (_req, res) => {
  try {
    const data = await listWhatsappFlows();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron listar los flujos");
  }
});

router.post("/flows", async (req, res) => {
  try {
    const data = await createWhatsappFlow({
      name: String(req.body?.name ?? ""),
      objective: req.body?.objective != null ? String(req.body.objective) : null,
      description: req.body?.description != null ? String(req.body.description) : null,
      triggers: req.body?.triggers,
      requiredFieldKeys: Array.isArray(req.body?.requiredFieldKeys)
        ? req.body.requiredFieldKeys.map((item: unknown) => String(item ?? ""))
        : undefined,
      childFlowIds: Array.isArray(req.body?.childFlowIds)
        ? req.body.childFlowIds.map((item: unknown) => String(item ?? ""))
        : undefined,
      steps: req.body?.steps,
      isActive: req.body?.isActive !== false,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el flujo";
    res.status(flowStatus(message)).json({ ok: false, message });
  }
});

router.patch("/flows/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await updateWhatsappFlow(String(id ?? ""), {
      name: req.body?.name != null ? String(req.body.name) : undefined,
      objective:
        req.body?.objective !== undefined
          ? req.body.objective == null
            ? null
            : String(req.body.objective)
          : undefined,
      description:
        req.body?.description !== undefined
          ? req.body.description == null
            ? null
            : String(req.body.description)
          : undefined,
      triggers: req.body?.triggers,
      requiredFieldKeys: Array.isArray(req.body?.requiredFieldKeys)
        ? req.body.requiredFieldKeys.map((item: unknown) => String(item ?? ""))
        : undefined,
      childFlowIds: Array.isArray(req.body?.childFlowIds)
        ? req.body.childFlowIds.map((item: unknown) => String(item ?? ""))
        : undefined,
      steps: req.body?.steps,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el flujo";
    res.status(flowStatus(message)).json({ ok: false, message });
  }
});

router.delete("/flows/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteWhatsappFlow(String(id ?? ""));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar el flujo";
    res.status(flowStatus(message)).json({ ok: false, message });
  }
});

function profileFieldStatus(message: string): number {
  if (message.includes("no encontrad")) return 404;
  if (
    message.includes("clave") ||
    message.includes("etiqueta") ||
    message.includes("Tipo") ||
    message.includes("Alcance") ||
    message.includes("enum") ||
    message.includes("Ya existe")
  ) {
    return 400;
  }
  return 500;
}

router.get("/profile-fields", async (_req, res) => {
  try {
    const data = await ensureWhatsappProfileSchemaDefaults();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron listar los campos de perfil");
  }
});

router.post("/profile-fields", async (req, res) => {
  try {
    const data = await createWhatsappProfileField({
      key: String(req.body?.key ?? ""),
      label: String(req.body?.label ?? ""),
      description: req.body?.description != null ? String(req.body.description) : null,
      type: String(req.body?.type ?? "text"),
      scope: req.body?.scope != null ? String(req.body.scope) : undefined,
      options: Array.isArray(req.body?.options)
        ? req.body.options.map((item: unknown) => String(item ?? ""))
        : undefined,
      group: req.body?.group != null ? String(req.body.group) : undefined,
      askPrompt: req.body?.askPrompt != null ? String(req.body.askPrompt) : null,
      confirmPrompt: req.body?.confirmPrompt != null ? String(req.body.confirmPrompt) : null,
      isActive: req.body?.isActive !== false,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el campo";
    res.status(profileFieldStatus(message)).json({ ok: false, message });
  }
});

router.patch("/profile-fields/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await updateWhatsappProfileField(String(id ?? ""), {
      key: req.body?.key != null ? String(req.body.key) : undefined,
      label: req.body?.label != null ? String(req.body.label) : undefined,
      description:
        req.body?.description !== undefined
          ? req.body.description == null
            ? null
            : String(req.body.description)
          : undefined,
      type: req.body?.type != null ? String(req.body.type) : undefined,
      scope: req.body?.scope != null ? String(req.body.scope) : undefined,
      options: Array.isArray(req.body?.options)
        ? req.body.options.map((item: unknown) => String(item ?? ""))
        : undefined,
      group: req.body?.group != null ? String(req.body.group) : undefined,
      askPrompt:
        req.body?.askPrompt !== undefined
          ? req.body.askPrompt == null
            ? null
            : String(req.body.askPrompt)
          : undefined,
      confirmPrompt:
        req.body?.confirmPrompt !== undefined
          ? req.body.confirmPrompt == null
            ? null
            : String(req.body.confirmPrompt)
          : undefined,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el campo";
    res.status(profileFieldStatus(message)).json({ ok: false, message });
  }
});

router.delete("/profile-fields/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteWhatsappProfileField(String(id ?? ""));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar el campo";
    res.status(profileFieldStatus(message)).json({ ok: false, message });
  }
});

function tagStatus(message: string): number {
  if (message.includes("no encontrad")) return 404;
  if (
    message.includes("nombre") ||
    message.includes("color") ||
    message.includes("grupo") ||
    message.includes("Ya existe")
  ) {
    return 400;
  }
  return 500;
}

router.get("/tags", async (_req, res) => {
  try {
    const data = await listWhatsappTagCatalog();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron listar las etiquetas");
  }
});

router.post("/tag-groups", async (req, res) => {
  try {
    const data = await createWhatsappTagGroup({
      name: String(req.body?.name ?? ""),
      color: String(req.body?.color ?? ""),
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear el grupo";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.patch("/tag-groups/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await updateWhatsappTagGroup(String(id ?? ""), {
      name: req.body?.name != null ? String(req.body.name) : undefined,
      color: req.body?.color != null ? String(req.body.color) : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el grupo";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.delete("/tag-groups/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteWhatsappTagGroup(String(id ?? ""));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar el grupo";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.post("/tags", async (req, res) => {
  try {
    const data = await createWhatsappTag({
      name: String(req.body?.name ?? ""),
      groupId: String(req.body?.groupId ?? ""),
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la etiqueta";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.patch("/tags/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await updateWhatsappTag(String(id ?? ""), {
      name: req.body?.name != null ? String(req.body.name) : undefined,
      groupId: req.body?.groupId != null ? String(req.body.groupId) : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la etiqueta";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.delete("/tags/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteWhatsappTag(String(id ?? ""));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar la etiqueta";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.patch("/contacts/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const displayName =
      typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
    if (!displayName) {
      res.status(400).json({ ok: false, message: "El nombre es obligatorio" });
      return;
    }
    const data = await updateContactDisplayName(String(id ?? ""), displayName);
    if (!data) {
      res.status(404).json({ ok: false, message: "Contacto no encontrado" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el contacto";
    const status = message.includes("obligatorio") ? 400 : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.get("/conversations", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit =
      typeof req.query.limit === "string" && req.query.limit.trim()
        ? Number(req.query.limit)
        : undefined;
    const offset =
      typeof req.query.offset === "string" && req.query.offset.trim()
        ? Number(req.query.offset)
        : undefined;
    const data = await listConversations({ search, status, limit, offset });
    res.json({ ok: true, data: data.items, total: data.total, hasMore: data.hasMore, nextOffset: data.nextOffset });
  } catch (error) {
    sendError(res, error, "No se pudieron listar conversaciones");
  }
});

router.get("/conversations/:id", async (req, res) => {
  try {
    const data = await getConversation(req.params.id);
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/conversations/:id/read", async (req, res) => {
  try {
    const data = await markConversationRead(req.params.id);
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch("/conversations/:id/assignee", async (req, res) => {
  try {
    const kind = req.body?.kind;
    if (kind !== "bot" && kind !== "user" && kind !== "none") {
      res.status(400).json({ ok: false, message: "Asignación inválida" });
      return;
    }
    let userId: string | null = null;
    let name: string | null = null;
    if (kind === "bot") {
      name = "Bot";
    } else if (kind === "user") {
      userId = String(req.body?.userId ?? "").trim();
      const user = userId ? await getUserById(userId) : null;
      if (!user || user.status !== "approved") {
        res.status(400).json({ ok: false, message: "Usuario no encontrado" });
        return;
      }
      if (!(await isWhatsappOperator(user.id))) {
        res.status(400).json({
          ok: false,
          message: "Esa persona no está entre las operadoras",
        });
        return;
      }
      name = user.nombre.trim() || user.email;
    }
    const data = await setConversationAssignee(req.params.id, { kind, userId, name });
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo asignar la conversación");
  }
});

router.patch("/conversations/:id/tags", async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.tagIds) ? req.body.tagIds : null;
    if (!raw) {
      res.status(400).json({ ok: false, message: "Etiquetas inválidas" });
      return;
    }
    const catalog = await listWhatsappTags();
    const allowed = new Set(catalog.map((tag) => tag.id));
    const tagIds = [...new Set(raw.map((id: unknown) => String(id ?? "").trim()).filter(Boolean))];
    if (tagIds.some((id) => !allowed.has(id))) {
      res.status(400).json({ ok: false, message: "Hay una etiqueta que no existe" });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await setConversationTags(String(id ?? ""), tagIds);
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron guardar las etiquetas");
  }
});

router.post("/conversations/:id/messages", uploadMedia.single("file"), async (req, res) => {
  try {
    if (req.file) {
      const caption = String(req.body?.message ?? "").trim();
      const data = await sendConversationMedia(
        req.params.id,
        {
          buffer: req.file.buffer,
          mimeType: req.file.mimetype || "application/octet-stream",
          fileName: req.file.originalname || "archivo",
        },
        caption || undefined,
      );
      res.status(201).json({ ok: true, data });
      return;
    }

    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ ok: false, message: "El mensaje no puede estar vacío" });
      return;
    }
    const data = await sendConversationText(req.params.id, message);
    res.status(201).json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo enviar el mensaje");
  }
});

router.get("/messages/conversation/:conversationId", async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 100) || 100;
    const data = await listMessagesByConversation(req.params.conversationId, limit);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron cargar mensajes");
  }
});

router.get("/messages/:id/media", async (req, res) => {
  try {
    const message = await getMessage(req.params.id);
    if (!message?.mediaPath) {
      res.status(404).json({ ok: false, message: "Media no encontrado" });
      return;
    }
    const absolute = mediaStorage.resolve(message.mediaPath);
    if (!existsSync(absolute)) {
      res.status(404).json({ ok: false, message: "Archivo de media no encontrado" });
      return;
    }
    if (message.mimeType) res.setHeader("Content-Type", message.mimeType);
    if (message.fileName) {
      res.setHeader("Content-Disposition", `inline; filename="${message.fileName}"`);
    }
    createReadStream(absolute).pipe(res);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
