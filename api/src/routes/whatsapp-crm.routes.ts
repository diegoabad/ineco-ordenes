import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { getUserById } from "../services/users.service.js";
import {
  addWhatsappOperator,
  countOperatorAssignments,
  isWhatsappOperator,
  listWhatsappOperators,
  removeWhatsappOperator,
} from "../whatsapp/operators.js";
import {
  getDerivacionTurnoConfig,
  saveDerivacionTurnoConfig,
} from "../whatsapp/derivacion-turno.js";
import { resolverPrestacionParaBusca } from "../whatsapp/bot-menu.js";
import { dniDesdeTelefono, listarTurnosFicha, type TurnoFichaItem } from "../whatsapp/acciones.js";
import { getBuscaTurnoConfig } from "../services/db.service.js";
import {
  createQuickReply,
  deleteQuickReply,
  listQuickReplies,
  updateQuickReply,
} from "../whatsapp/quick-replies.js";
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
  findOpenConversationByContact,
  createPruebaConversation,
  sendPruebaInbound,
} from "../whatsapp/runtime.js";
import {
  deleteAllPruebaConversations,
  listConversacionesMetricas,
  resolveConversation,
  setDiagnosticoPresuntivoHumano,
  setPruebaNota,
  updateContact,
  listRecentMessagesByConversation,
} from "../whatsapp/firestore-store.js";
import { nombresMotivosCatalogo, resolverNombreMotivoCatalogo } from "../whatsapp/motivos-catalogo.js";
import { listLlmUsageByConversation } from "../whatsapp/llm-usage.js";
import { getAccesosRapidos, saveAccesosRapidos } from "../whatsapp/accesos-rapidos.js";
import { getMetricaTablero, saveMetricaTablero } from "../whatsapp/metricas-tablero.js";
import {
  createWhatsappTag,
  createWhatsappTagGroup,
  deleteWhatsappTag,
  deleteWhatsappTagGroup,
  listWhatsappTagCatalog,
  ensureDiagnosticoTagsFromCatalog,
  listWhatsappTags,
  updateWhatsappTag,
  updateWhatsappTagGroup,
} from "../whatsapp/tags.js";
import {
  createWhatsappCobertura,
  deleteWhatsappCobertura,
  listWhatsappCoberturas,
  updateWhatsappCobertura,
} from "../whatsapp/coberturas.js";
import {
  getWhatsappBotConfig,
  saveWhatsappBotConfig,
} from "../whatsapp/bot-config.js";
import {
  getWhatsappMotorConfig,
  saveWhatsappMotorConfig,
} from "../whatsapp/motor-config.js";
import {
  createIntencion,
  deleteIntencion,
  listIntenciones,
  updateIntencion,
} from "../whatsapp/intenciones.js";
import {
  getWhatsappConocimiento,
  saveWhatsappConocimiento,
} from "../whatsapp/conocimiento.js";

const router = Router();
const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

function sendError(res: import("express").Response, error: unknown, fallback = "Error WhatsApp"): void {
  const raw = error instanceof Error ? error.message : fallback;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const quota =
    /RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(raw) ||
    /resource-exhausted/i.test(code);
  const message = quota
    ? "Firestore sin cuota por ahora (límite diario). Esperá un rato o subí el plan; mientras tanto no se pueden crear pruebas ni guardar chats."
    : raw.includes("Missing or insufficient permissions")
      ? "Firestore rechazó WhatsApp: faltan las reglas de whatsapp_contacts, whatsapp_conversations y whatsapp_messages."
      : raw;
  const status = quota
    ? 503
    : message.includes("no está conectado") || message.includes("no encontrada")
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

router.get("/derivacion-turno", async (_req, res) => {
  try {
    const data = await getDerivacionTurnoConfig();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo cargar la derivación de turnos");
  }
});

router.put("/derivacion-turno", async (req, res) => {
  try {
    const data = await saveDerivacionTurnoConfig({
      defaultRecepcionista: req.body?.defaultRecepcionista,
      reglas: req.body?.reglas,
    });
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo guardar la derivación de turnos");
  }
});

router.post("/match-prestacion", async (req, res) => {
  try {
    const texto = String(req.body?.texto ?? "").trim();
    if (!texto) {
      res.status(400).json({ ok: false, message: "Falta el tratamiento" });
      return;
    }
    const modalidadRaw = String(req.body?.modalidad ?? "").trim();
    const modalidad =
      modalidadRaw === "presencial" ||
      modalidadRaw === "virtual" ||
      modalidadRaw === "indistinto"
        ? modalidadRaw
        : "";
    const grupoRaw = String(req.body?.grupoEtario ?? "").trim();
    const grupoEtario = grupoRaw === "adulto" || grupoRaw === "infanto" ? grupoRaw : "";
    const data = await resolverPrestacionParaBusca({
      texto,
      profesionalDoc: String(req.body?.profesionalDoc ?? "").trim(),
      profesionalNombre: String(req.body?.profesionalNombre ?? "").trim(),
      modalidad,
      grupoEtario,
      fechaNacimiento: String(req.body?.fechaNacimiento ?? "").trim(),
      dni: String(req.body?.dni ?? "").replace(/\D/g, ""),
      conversacionId: String(req.body?.conversacionId ?? "").trim(),
    });
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo matchear la prestación");
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
      tagIds: Array.isArray(req.body?.tagIds)
        ? req.body.tagIds.map((id: unknown) => String(id ?? "").trim()).filter(Boolean)
        : req.body?.tagId
          ? [String(req.body.tagId).trim()].filter(Boolean)
          : [],
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
      tagIds:
        req.body?.tagIds === undefined
          ? undefined
          : Array.isArray(req.body.tagIds)
            ? req.body.tagIds.map((tid: unknown) => String(tid ?? "").trim()).filter(Boolean)
            : [],
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

function tagStatus(message: string): number {
  if (message.includes("no encontrad")) return 404;
  if (
    message.includes("nombre") ||
    message.includes("color") ||
    message.includes("grupo") ||
    message.includes("Ya existe") ||
    message.includes("cobertura") ||
    message.includes("etario")
  ) {
    return 400;
  }
  return 500;
}

router.get("/coberturas", async (req, res) => {
  try {
    const grupoEtario =
      typeof req.query.grupoEtario === "string" ? req.query.grupoEtario : null;
    const data = await listWhatsappCoberturas(grupoEtario);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron listar las coberturas");
  }
});

router.post("/coberturas", async (req, res) => {
  try {
    const data = await createWhatsappCobertura({
      nombre: String(req.body?.nombre ?? ""),
      gruposEtarios: req.body?.gruposEtarios,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la cobertura";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.patch("/coberturas/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await updateWhatsappCobertura(String(id ?? ""), {
      nombre: req.body?.nombre != null ? String(req.body.nombre) : undefined,
      gruposEtarios:
        req.body?.gruposEtarios !== undefined ? req.body.gruposEtarios : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la cobertura";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.delete("/coberturas/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteWhatsappCobertura(String(id ?? ""));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar la cobertura";
    res.status(tagStatus(message)).json({ ok: false, message });
  }
});

router.get("/accesos-rapidos", async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.id?.trim() ?? "";
    if (!userId) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    const data = await getAccesosRapidos(userId);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron leer los accesos rápidos");
  }
});

router.put("/accesos-rapidos", async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.id?.trim() ?? "";
    if (!userId) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    const data = await saveAccesosRapidos(userId, {
      tagIds: Array.isArray(req.body?.tagIds) ? req.body.tagIds : undefined,
      clusters: Array.isArray(req.body?.clusters) ? req.body.clusters : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron guardar los accesos rápidos");
  }
});

router.get("/tags", async (_req, res) => {
  try {
    // Semilla idempotente: grupo Diagnóstico + catálogo clínico (Parkinson, TDAH, etc.).
    try {
      await ensureDiagnosticoTagsFromCatalog();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(msg)) throw error;
    }
    // Etiquetas de los profesionales de derivación, en el grupo que corresponda.
    try {
      await getDerivacionTurnoConfig();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(msg)) throw error;
    }
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
    const firstName =
      typeof req.body?.firstName === "string" ? req.body.firstName.trim() : "";
    const lastName =
      typeof req.body?.lastName === "string" ? req.body.lastName.trim() : "";
    const cobertura =
      typeof req.body?.cobertura === "string" ? req.body.cobertura : "";
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const fechaNacimiento =
      typeof req.body?.fechaNacimiento === "string" ? req.body.fechaNacimiento.trim() : "";
    const grupoEtario =
      typeof req.body?.grupoEtario === "string" ? req.body.grupoEtario.trim() : "";
    const consultaPara =
      typeof req.body?.consultaPara === "string" ? req.body.consultaPara.trim() : "";
    const relacionFamiliar =
      typeof req.body?.relacionFamiliar === "string" ? req.body.relacionFamiliar : "";
    const contactoNombre =
      typeof req.body?.contactoNombre === "string"
        ? req.body.contactoNombre
        : typeof req.body?.terceroNombre === "string"
          ? req.body.terceroNombre
          : "";
    const contactoApellido =
      typeof req.body?.contactoApellido === "string" ? req.body.contactoApellido : "";
    const dni = typeof req.body?.dni === "string" ? req.body.dni : "";
    const sexo = typeof req.body?.sexo === "string" ? req.body.sexo.trim() : "";
    const esPacienteRaw = req.body?.esPaciente;
    const esPaciente =
      esPacienteRaw === true || esPacienteRaw === "true"
        ? true
        : esPacienteRaw === false || esPacienteRaw === "false"
          ? false
          : null;
    if (!firstName) {
      res.status(400).json({ ok: false, message: "El nombre del paciente es obligatorio" });
      return;
    }
    const data = await updateContact(String(id ?? ""), {
      firstName,
      lastName,
      cobertura,
      email,
      fechaNacimiento: fechaNacimiento || null,
      grupoEtario: grupoEtario || null,
      consultaPara: consultaPara || null,
      relacionFamiliar,
      contactoNombre,
      contactoApellido,
      dni,
      sexo: sexo || null,
      esPaciente,
    });
    if (!data) {
      res.status(404).json({ ok: false, message: "Contacto no encontrado" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar el contacto";
    const status =
      message.includes("obligatorio") ||
      message.includes("email") ||
      message.includes("fecha de nacimiento") ||
      message.includes("Infanto") ||
      message.includes("tercero") ||
      message.includes("relación familiar") ||
      message.includes("quien escribe") ||
      message.includes("sexo") ||
      message.includes("paciente")
        ? 400
        : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.post("/pruebas", async (req: AuthedRequest, res) => {
  try {
    const motor = req.body?.motor === "menu" ? "menu" : "ia";
    const data = await createPruebaConversation(
      {
        id: req.user?.id ?? "",
        nombre: req.user?.nombre?.trim() || req.user?.email || "",
      },
      motor,
    );
    const local = String(data.id).startsWith("local-");
    if (motor === "menu") {
      const { abrirBotMenu } = await import("../whatsapp/bot-menu.js");
      await abrirBotMenu(data.id);
      const refreshed = await getConversation(data.id);
      res.status(201).json({ ok: true, data: refreshed ?? data, local });
      return;
    }
    res.status(201).json({ ok: true, data, local });
  } catch (error) {
    sendError(res, error, "No se pudo crear la prueba");
  }
});

router.delete("/pruebas", async (_req, res) => {
  try {
    const data = await deleteAllPruebaConversations();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron borrar las pruebas");
  }
});

router.post("/pruebas/:id/mensajes", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    await sendPruebaInbound(String(id ?? ""), text);
    const [conversation, messages] = await Promise.all([
      getConversation(String(id ?? "")),
      listMessagesByConversation(String(id ?? "")),
    ]);
    res.json({ ok: true, data: { conversation, messages } });
  } catch (error) {
    sendError(res, error, "No se pudo enviar el mensaje de prueba");
  }
});

router.post("/pruebas/:id/nota", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const resultado = req.body?.resultado === "correcta" ? "correcta" : "incorrecta";
    const aclaraciones = Array.isArray(req.body?.aclaraciones) ? req.body.aclaraciones : [];
    const data = await setPruebaNota(String(id ?? ""), resultado, aclaraciones);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo guardar la nota");
  }
});

router.get("/metricas-tablero", async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.id?.trim() ?? "";
    if (!userId) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    const data = await getMetricaTablero(userId);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo leer el tablero");
  }
});

router.put("/metricas-tablero", async (req: AuthedRequest, res) => {
  try {
    const userId = req.user?.id?.trim() ?? "";
    if (!userId) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    const data = await saveMetricaTablero(userId, req.body?.agrupaciones);
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo guardar el tablero");
  }
});

router.get("/metricas", async (req, res) => {
  try {
    const desde = typeof req.query.desde === "string" ? req.query.desde.trim() : "";
    const hasta = typeof req.query.hasta === "string" ? req.query.hasta.trim() : "";
    const [filas, catalogo] = await Promise.all([
      listConversacionesMetricas(desde, hasta),
      listWhatsappTagCatalog(),
    ]);
    res.json({
      ok: true,
      data: {
        filas,
        grupos: catalogo.groups.map((group) => ({
          id: group.id,
          name: group.name,
          color: group.color,
        })),
        etiquetas: catalogo.items.map((tag) => ({
          id: tag.id,
          name: tag.name,
          groupId: tag.groupId,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron leer las métricas";
    const status = message.includes("fechas") ? 400 : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.get("/conversations", async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const assignee = typeof req.query.assignee === "string" ? req.query.assignee : undefined;
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
    const tagIdsRaw = req.query.tagIds;
    const tagIds = Array.isArray(tagIdsRaw)
      ? tagIdsRaw.map(String)
      : typeof tagIdsRaw === "string"
        ? tagIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const limit =
      typeof req.query.limit === "string" && req.query.limit.trim()
        ? Number(req.query.limit)
        : undefined;
    const offset =
      typeof req.query.offset === "string" && req.query.offset.trim()
        ? Number(req.query.offset)
        : undefined;
    const data = await listConversations({
      search,
      status,
      limit,
      offset,
      assignee,
      tagIds,
      dateFrom,
      dateTo,
      prueba: req.query.prueba === "1" || req.query.prueba === "true",
      pruebaMotor: req.query.motor === "menu" ? "menu" : req.query.prueba === "1" || req.query.prueba === "true" ? "ia" : undefined,
    });
    res.json({ ok: true, data: data.items, total: data.total, hasMore: data.hasMore, nextOffset: data.nextOffset });
  } catch (error) {
    sendError(res, error, "No se pudieron listar conversaciones");
  }
});

router.get("/conversations/by-contact/:contactId", async (req, res) => {
  try {
    const contactId = Array.isArray(req.params.contactId)
      ? req.params.contactId[0]
      : req.params.contactId;
    const found = await findOpenConversationByContact(String(contactId ?? "").trim());
    if (!found) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    const data = await getConversation(found.id);
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo abrir la conversación");
  }
});

function sinTildesRuta(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coincideProfesional(etiqueta: string, profesional: string): boolean {
  if (!etiqueta || !profesional) return false;
  if (profesional === etiqueta) return true;
  if (etiqueta.length >= 5 && profesional.includes(etiqueta)) return true;
  if (profesional.length >= 5 && etiqueta.includes(profesional)) return true;
  const delProfesional = new Set(profesional.split(" ").filter((parte) => parte.length >= 4));
  return etiqueta.split(" ").some((parte) => parte.length >= 4 && delProfesional.has(parte));
}

function dniDichoEnTexto(texto: string): string {
  const explicito = texto.match(/\bdni\b\D{0,12}(\d{7,9})\b/i);
  return explicito?.[1]?.replace(/\D/g, "") || "";
}

async function clasificarTurnosEnConversacion(
  conversationId: string,
  tagIds: string[],
  turnos: TurnoFichaItem[],
): Promise<string[]> {
  if (!turnos.length) return tagIds;
  const catalogo = await listWhatsappTagCatalog();
  const grupoDe = (nombre: string) =>
    catalogo.groups.find((group) => sinTildesRuta(group.name) === nombre)?.id;
  const profId = grupoDe("profesionales");
  const tratId = grupoDe("tratamientos");
  const sumar = new Set<string>();
  for (const turno of turnos) {
    const profesional = sinTildesRuta(turno.profesional);
    const prestacion = sinTildesRuta(turno.prestacion);
    for (const tag of catalogo.items) {
      const nombre = sinTildesRuta(tag.name);
      if (nombre.length < 4) continue;
      if (tag.groupId === profId && coincideProfesional(nombre, profesional)) sumar.add(tag.id);
      if (
        tag.groupId === tratId &&
        nombre.length >= 5 &&
        nombre !== "consulta" &&
        nombre !== "ineco" &&
        prestacion.includes(nombre)
      ) {
        sumar.add(tag.id);
      }
    }
  }
  if (!sumar.size) return tagIds;
  const next = [...new Set([...tagIds, ...sumar])];
  if (next.length === tagIds.length) return tagIds;
  const updated = await setConversationTags(conversationId, next);
  return updated?.tagIds ?? next;
}

router.get("/conversations/:id/historial-turnos", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const conversation = await getConversation(String(id ?? ""));
    if (!conversation) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    let dni = String(conversation.contact?.dni || conversation.menuEstado?.dni || "").replace(/\D/g, "");
    if (dni.length < 7) {
      const mensajes = await listRecentMessagesByConversation(conversation.id, 40);
      for (const mensaje of mensajes) {
        const hallado = dniDichoEnTexto(String(mensaje.text ?? ""));
        if (hallado) {
          dni = hallado;
          break;
        }
      }
    }
    if (dni.length < 7) {
      dni = await dniDesdeTelefono(
        conversation.contact?.phoneNumber || conversation.menuEstado?.telefono || "",
      );
    }
    if (dni.length < 7) {
      res.json({
        ok: true,
        data: {
          turnos: [],
          ultimosProfesionales: [],
          tagIds: conversation.tagIds ?? [],
          aviso: "No hay DNI para buscar los turnos.",
        },
      });
      return;
    }
    let config = null;
    try {
      config = await getBuscaTurnoConfig();
    } catch {
      config = null;
    }
    const turnos = await listarTurnosFicha(dni, config);
    const ultimosProfesionales: string[] = [];
    const vistos = new Set<string>();
    for (const turno of turnos) {
      const nombre = turno.profesional.trim();
      const clave = sinTildesRuta(nombre);
      if (!clave || vistos.has(clave)) continue;
      vistos.add(clave);
      ultimosProfesionales.push(nombre);
      if (ultimosProfesionales.length >= 3) break;
    }
    const tagIds = await clasificarTurnosEnConversacion(
      conversation.id,
      conversation.tagIds ?? [],
      turnos,
    );
    res.json({
      ok: true,
      data: {
        turnos,
        ultimosProfesionales,
        tagIds,
        aviso: turnos.length ? "" : "No hay turnos en el último año.",
      },
    });
  } catch (error) {
    sendError(res, error, "No se pudo cargar el historial de turnos");
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

/** Diagnóstico presuntivo corregido/confirmado por una persona del equipo. */
router.patch("/conversations/:id/diagnostico", async (req: AuthedRequest, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const conversation = await getConversation(id);
    if (!conversation) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    const raw = String(req.body?.diagnostico ?? "").trim();
    let diagnostico = "";
    if (raw) {
      diagnostico = resolverNombreMotivoCatalogo(raw) || raw;
      const validos = new Set(nombresMotivosCatalogo().map((n) => n.toLowerCase()));
      if (!validos.has(diagnostico.toLowerCase())) {
        res.status(400).json({
          ok: false,
          message: "Elegí un diagnóstico de la lista",
        });
        return;
      }
    }
    const data = await setDiagnosticoPresuntivoHumano(id, {
      diagnostico,
      byUserId: user.id,
      byName: user.nombre?.trim() || user.email || "Operador",
    });
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    try {
      const catalogo = await listWhatsappTagCatalog();
      const grupo = catalogo.groups.find(
        (g) => g.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() === "diagnostico",
      );
      const diagIds = new Set(
        catalogo.items
          .filter((item) => (grupo ? item.groupId === grupo.id : false))
          .map((item) => item.id),
      );
      const tag = diagnostico
        ? catalogo.items.find(
            (item) =>
              item.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase() ===
              diagnostico.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
          )
        : undefined;
      const sinDiag = (data.tagIds ?? conversation.tagIds ?? []).filter((tid) => !diagIds.has(tid));
      const next = tag ? [...new Set([...sinDiag, tag.id])] : sinDiag;
      await setConversationTags(id, next);
      const fresh = await getConversation(id);
      res.json({ ok: true, data: fresh ?? data });
      return;
    } catch {
      /* si falla el tag, igual quedó el diagnóstico */
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo guardar el diagnóstico");
  }
});

/** Marca episodio como resuelto por humano → bot + pausa hasta próximo inbound. */
router.post("/conversations/:id/resolve", async (req: AuthedRequest, res) => {
  try {
    const user = req.user;
    if (!user?.id) {
      res.status(401).json({ ok: false, message: "No autenticado" });
      return;
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const conversation = await getConversation(id);
    if (!conversation) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    if (conversation.assigneeKind !== "user" || conversation.assigneeUserId !== user.id) {
      res.status(403).json({
        ok: false,
        message: "Solo podés marcar como resuelta una conversación asignada a vos",
      });
      return;
    }
    if (conversation.resolutionStatus === "resolved") {
      res.status(400).json({ ok: false, message: "Esta conversación ya está resuelta" });
      return;
    }
    const data = await resolveConversation(id, {
      byKind: "human",
      byUserId: user.id,
      byName: user.nombre?.trim() || user.email,
      motivo: "manual",
    });
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudo marcar como resuelta");
  }
});

router.patch("/conversations/:id/tags", async (req, res) => {
  try {
    const rawList: unknown[] = Array.isArray(req.body?.tagIds) ? req.body.tagIds : [];
    if (!Array.isArray(req.body?.tagIds)) {
      res.status(400).json({ ok: false, message: "Etiquetas inválidas" });
      return;
    }
    const catalog = await listWhatsappTags();
    const allowed = new Set(catalog.map((tag) => tag.id));
    const tagIds = [...new Set(rawList.map((id) => String(id ?? "").trim()).filter((id) => id.length > 0))];
    // Solo rechazar altas de ids desconocidos. Si ya estaban (huérfanas del bot/cuota),
    // se limpian al guardar para no bloquear quitar/agregar etiquetas reales.
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const current = await getConversation(String(id ?? ""));
    if (!current) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    const prev = new Set((current.tagIds ?? []).map(String));
    const altasInvalidas = tagIds.filter((tagId) => !allowed.has(tagId) && !prev.has(tagId));
    if (altasInvalidas.length) {
      res.status(400).json({ ok: false, message: "Hay una etiqueta que no existe" });
      return;
    }
    const cleaned = tagIds.filter((tagId) => allowed.has(tagId));
    const data = await setConversationTags(String(id ?? ""), cleaned);
    if (!data) {
      res.status(404).json({ ok: false, message: "Conversación no encontrada" });
      return;
    }
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron guardar las etiquetas");
  }
});

router.get("/conversations/:id/llm-usage", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const items = await listLlmUsageByConversation(String(id ?? ""));
    res.json({ ok: true, items });
  } catch (error) {
    sendError(res, error, "No se pudo leer el uso del modelo");
  }
});

router.post("/conversations/:id/messages", uploadMedia.single("file"), async (req, res) => {
  try {
    if (req.file) {
      const caption = String(req.body?.message ?? "").trim();
      const conversationId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const data = await sendConversationMedia(
        String(conversationId ?? ""),
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
    const data = await sendConversationText(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id ?? ""), message);
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

router.get("/bot-config", async (_req, res) => {
  try {
    const doc = await getWhatsappBotConfig();
    res.json({
      ok: true,
      data: doc?.data ?? null,
      updatedAt: doc?.updatedAt ?? null,
    });
  } catch (error) {
    sendError(res, error, "No se pudo leer la configuración del bot");
  }
});

router.put("/bot-config", async (req, res) => {
  try {
    const body = req.body as { data?: unknown; json?: unknown };
    const hasJson = typeof body?.json === "string" && body.json.trim().length > 0;
    const hasData = !!body?.data && typeof body.data === "object" && !Array.isArray(body.data);
    if (!hasJson && !hasData) {
      res.status(400).json({ ok: false, message: "Enviá un objeto JSON en data o json" });
      return;
    }
    const saved = await saveWhatsappBotConfig({
      data: hasData ? (body.data as Record<string, unknown>) : undefined,
      json: hasJson ? String(body.json) : undefined,
    });
    res.json({
      ok: true,
      data: saved.data,
      json: saved.json,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    sendError(res, error, "No se pudo guardar la configuración del bot");
  }
});

function intencionStatus(message: string): number {
  if (message.includes("no encontrada")) return 404;
  if (
    message.includes("nombre") ||
    message.includes("clave") ||
    message.includes("mensaje de riesgo") ||
    message.includes("Ya existe")
  ) {
    return 400;
  }
  return 500;
}

router.get("/intenciones", async (_req, res) => {
  try {
    const data = await listIntenciones();
    res.json({ ok: true, data });
  } catch (error) {
    sendError(res, error, "No se pudieron listar las intenciones");
  }
});

router.post("/intenciones", async (req, res) => {
  try {
    const data = await createIntencion({
      nombre: String(req.body?.nombre ?? ""),
      clave: req.body?.clave != null ? String(req.body.clave) : undefined,
      descripcion: req.body?.descripcion != null ? String(req.body.descripcion) : "",
      esRiesgo: req.body?.esRiesgo === true,
      mensajeRiesgo: req.body?.mensajeRiesgo != null ? String(req.body.mensajeRiesgo) : "",
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la intención";
    res.status(intencionStatus(message)).json({ ok: false, message });
  }
});

router.patch("/intenciones/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const data = await updateIntencion(String(id ?? ""), {
      nombre: req.body?.nombre != null ? String(req.body.nombre) : undefined,
      clave: req.body?.clave != null ? String(req.body.clave) : undefined,
      descripcion:
        req.body?.descripcion !== undefined ? String(req.body.descripcion ?? "") : undefined,
      esRiesgo: typeof req.body?.esRiesgo === "boolean" ? req.body.esRiesgo : undefined,
      mensajeRiesgo:
        req.body?.mensajeRiesgo !== undefined ? String(req.body.mensajeRiesgo ?? "") : undefined,
    });
    res.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar la intención";
    res.status(intencionStatus(message)).json({ ok: false, message });
  }
});

router.delete("/intenciones/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await deleteIntencion(String(id ?? ""));
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar la intención";
    res.status(intencionStatus(message)).json({ ok: false, message });
  }
});

router.get("/motor-config", async (_req, res) => {
  try {
    const doc = await getWhatsappMotorConfig();
    res.json({
      ok: true,
      data: doc.data,
      updatedAt: doc.updatedAt || null,
    });
  } catch (error) {
    sendError(res, error, "No se pudo leer la configuración del motor");
  }
});

router.get("/conocimiento", async (_req, res) => {
  try {
    const doc = await getWhatsappConocimiento();
    res.json({
      ok: true,
      text: doc.text,
      updatedAt: doc.updatedAt || null,
    });
  } catch (error) {
    sendError(res, error, "No se pudo leer la base de conocimiento");
  }
});

router.put("/conocimiento", async (req, res) => {
  try {
    const text = req.body?.text;
    if (typeof text !== "string") {
      res.status(400).json({ ok: false, message: "Enviá el texto en text" });
      return;
    }
    const saved = await saveWhatsappConocimiento(text);
    res.json({ ok: true, text: saved.text, updatedAt: saved.updatedAt });
  } catch (error) {
    sendError(res, error, "No se pudo guardar la base de conocimiento");
  }
});

router.put("/motor-config", async (req, res) => {
  try {
    const body = req.body as { data?: unknown };
    const data = body?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      res.status(400).json({ ok: false, message: "Enviá un objeto en data" });
      return;
    }
    const saved = await saveWhatsappMotorConfig(data);
    res.json({ ok: true, data: saved.data, updatedAt: saved.updatedAt });
  } catch (error) {
    sendError(res, error, "No se pudo guardar la configuración del motor");
  }
});

export default router;
