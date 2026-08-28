import { Router } from "express";
import {
  getDb,
  getEmailConfig,
  getPresupuestoEmailConfig,
  listEmailEnvios,
  deleteEmailEnvio,
  saveEmailConfig,
  savePresupuestoEmailConfig,
  setMedicoSeleccionadoId,
} from "../services/db.service.js";
import { EMAIL_TEMPLATE_VARS, type EmailConfig } from "../services/email-templates.js";
import {
  PRESUPUESTO_EMAIL_TEMPLATE_VARS,
  type PresupuestoEmailConfig,
} from "../services/presupuesto-email-templates.js";
import { sendOrdenEmail } from "../services/email.service.js";

const router = Router();

function parseEmailConfig(body: unknown): EmailConfig {
  const raw = body as Record<string, unknown>;
  return {
    fromEmail: String(raw.fromEmail ?? "").trim(),
    fromName: String(raw.fromName ?? "").trim(),
    subject: String(raw.subject ?? "").trim(),
    body: String(raw.body ?? "").trim(),
  };
}

function parsePresupuestoEmailConfig(body: unknown): PresupuestoEmailConfig {
  const raw = body as Record<string, unknown>;
  return {
    fromEmail: String(raw.fromEmail ?? "").trim(),
    fromName: String(raw.fromName ?? "").trim(),
    subject: String(raw.subject ?? "").trim(),
    body: String(raw.body ?? "").trim(),
  };
}

router.get("/db", async (_req, res) => {
  try {
    const data = await getDb();
    res.json({ ok: true, data });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer datos",
    });
  }
});

router.put("/config/medico-seleccionado", async (req, res) => {
  try {
    const medicoSeleccionadoId =
      typeof req.body?.medicoSeleccionadoId === "string"
        ? req.body.medicoSeleccionadoId
        : req.body?.medicoSeleccionadoId === null
          ? null
          : undefined;

    if (medicoSeleccionadoId === undefined) {
      res.status(400).json({ ok: false, message: "medicoSeleccionadoId inválido" });
      return;
    }

    const data = await setMedicoSeleccionadoId(medicoSeleccionadoId);
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar configuración",
    });
  }
});

router.get("/config/email", async (_req, res) => {
  try {
    const data = await getEmailConfig();
    res.json({ ok: true, data, variables: EMAIL_TEMPLATE_VARS });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer config de email",
    });
  }
});

router.put("/config/email", async (req, res) => {
  try {
    const data = await saveEmailConfig(parseEmailConfig(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar config de email",
    });
  }
});

router.get("/config/presupuesto-email", async (_req, res) => {
  try {
    const data = await getPresupuestoEmailConfig();
    res.json({ ok: true, data, variables: PRESUPUESTO_EMAIL_TEMPLATE_VARS });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer plantilla de presupuesto",
    });
  }
});

router.put("/config/presupuesto-email", async (req, res) => {
  try {
    const data = await savePresupuestoEmailConfig(parsePresupuestoEmailConfig(req.body));
    res.json({ ok: true, data });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al guardar plantilla de presupuesto",
    });
  }
});

router.get("/email-envios", async (req, res) => {
  try {
    const page = Number(req.query.page);
    const pageSize = Number(req.query.pageSize);
    const mes = typeof req.query.mes === "string" ? req.query.mes : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const result = await listEmailEnvios({
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
      mes: mes || null,
      q: q || null,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Error al leer el historial de envíos",
    });
  }
});

router.delete("/email-envios/:id", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id!;
    await deleteEmailEnvio(id);
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo eliminar el registro";
    const status = message.includes("no encontrado") ? 404 : 500;
    res.status(status).json({ ok: false, message });
  }
});

router.post("/pacientes/:id/enviar-orden", async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id!;
    const pdfBase64 = String(req.body?.pdfBase64 ?? "").trim();
    if (!pdfBase64) {
      res.status(400).json({ ok: false, message: "Falta el PDF (pdfBase64)" });
      return;
    }

    const result = await sendOrdenEmail({
      pacienteId: id,
      pdfBase64,
      filename: typeof req.body?.filename === "string" ? req.body.filename : undefined,
      fecha: typeof req.body?.fecha === "string" ? req.body.fecha : undefined,
      medicoNombre: typeof req.body?.medicoNombre === "string" ? req.body.medicoNombre : undefined,
    });

    res.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar el email";
    const status =
      message === "Paciente no encontrado"
        ? 404
        : message.includes("SENDGRID_API_KEY") ||
            message.includes("SendGrid") ||
            message.includes("email") ||
            message.includes("PDF")
          ? 400
          : 500;
    console.error("[enviar-orden]", message);
    res.status(status).json({ ok: false, message });
  }
});

export default router;
