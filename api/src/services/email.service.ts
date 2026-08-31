import sgMail from "@sendgrid/mail";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { formatListaPrestaciones } from "../lib/presupuestoPrestacionesList.js";
import { applyEmailTemplate } from "./email-templates.js";
import {
  applyPresupuestoEmailTemplate,
} from "./presupuesto-email-templates.js";
import { emailBodyToHtml, emailBodyToPlainText } from "../lib/richText.js";
import type { PresupuestoItem } from "../types.js";
import {
  createEmailEnvio,
  getDb,
  getEmailConfig,
  getMedicoById,
  getPacienteById,
  getPresupuestoEmailConfig,
} from "./db.service.js";
import { saveEnvioPdf } from "./envio-pdf.service.js";

export type SendOrdenEmailInput = {
  pacienteId: string;
  pdfBase64: string;
  filename?: string;
  fecha?: string;
  medicoNombre?: string;
  /** Si vienen, se usan tal cual (preview editable del cliente). */
  subject?: string;
  body?: string;
};

function ensureSendGrid(): void {
  if (!env.sendgrid.apiKey) {
    throw new Error("Falta configurar el servicio de correo en el servidor");
  }
  sgMail.setApiKey(env.sendgrid.apiKey);
}

function stripDataUrlPrefix(base64: string): string {
  const trimmed = base64.trim();
  const comma = trimmed.indexOf(",");
  if (trimmed.startsWith("data:") && comma >= 0) {
    return trimmed.slice(comma + 1);
  }
  return trimmed;
}

async function resolveMedicoForPaciente(pacienteMedicoId: string | null) {
  if (pacienteMedicoId) {
    const assigned = await getMedicoById(pacienteMedicoId);
    if (assigned) return assigned;
  }
  const db = await getDb();
  if (!db.medicoSeleccionadoId) return null;
  return getMedicoById(db.medicoSeleccionadoId);
}

/** Mensaje claro para historial / detalle (no técnico). */
export function clearEmailErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "No se pudo enviar el mail. Reintentá más tarde.";
  }

  const err = error as {
    message?: string;
    code?: number;
    response?: { body?: { errors?: Array<{ message?: string }> } };
  };

  const details =
    err.response?.body?.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join("; ") || "";

  const status = err.code;
  const raw = (details || err.message || "").trim();

  if (status === 401 || /^unauthorized$/i.test(raw) || /not whitelisted|ip address/i.test(raw)) {
    return "El servicio de correo rechazó el envío porque esta computadora no está autorizada (restricción de IP). Pedile a sistemas que habilite tu IP en SendGrid o probá desde el servidor.";
  }

  if (status === 403 || /access forbidden|ip access management/i.test(raw)) {
    return "El servicio de correo bloqueó el envío por seguridad (IP no autorizada o permisos insuficientes). Pedile a sistemas que revise SendGrid.";
  }

  if (/from|sender|verified|identity/i.test(raw)) {
    return "El email remitente no está verificado en el servicio de correo. Revisá la configuración del remitente.";
  }

  if (/Falta configurar el servicio|SENDGRID_API_KEY/i.test(raw)) {
    return "Falta configurar el servicio de correo en el servidor. Pedile a sistemas que revise la API key de SendGrid.";
  }

  if (/paciente no encontrado/i.test(raw)) {
    return "No se encontró el paciente. Puede haber sido eliminado.";
  }

  if (/no tiene email/i.test(raw)) {
    return "El paciente no tiene un email cargado.";
  }

  if (/pdf inválido/i.test(raw)) {
    return "No se pudo generar el PDF de la orden para adjuntarlo.";
  }

  // Si ya es un mensaje en español claro, lo usamos.
  if (raw && !/^unauthorized$/i.test(raw) && raw.length > 8) {
    return raw;
  }

  return "No se pudo enviar el mail. Reintentá más tarde.";
}

export async function sendOrdenEmail(
  input: SendOrdenEmailInput,
): Promise<{ to: string; envioId: string }> {
  const paciente = await getPacienteById(input.pacienteId);
  if (!paciente) throw new Error("Paciente no encontrado");
  if (!paciente.email?.trim()) {
    throw new Error("El paciente no tiene email cargado");
  }

  const medico = await resolveMedicoForPaciente(paciente.medicoId);
  const medicoNombre = input.medicoNombre?.trim() || medico?.nombre || "";
  const fechaOrdenRaw = input.fecha?.trim() || "";
  const fechaOrdenFmt = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaOrdenRaw);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : fechaOrdenRaw || "—";
  })();
  const config = await getEmailConfig();
  const vars = {
    nombrePaciente: paciente.paciente,
    email: paciente.email,
    obraSocial: paciente.obraSocial || "—",
    afiliado: paciente.afiliado || "—",
    diagnostico: paciente.diagnostico || "—",
    prestacion: paciente.prestacion || "—",
    nombreMedico: medicoNombre || "—",
    especialidad: medico?.especialidad?.trim() || "—",
    matricula: medico?.matricula?.trim() || "—",
    fechaOrden: fechaOrdenFmt,
  };

  const subject =
    input.subject?.trim() ||
    applyEmailTemplate(config.subject, vars).trim() ||
    "Orden médica";
  const bodyRaw = input.body?.trim() || applyEmailTemplate(config.body, vars);
  const bodyText = emailBodyToPlainText(bodyRaw);
  const bodyHtml = emailBodyToHtml(bodyRaw);

  const filename =
    input.filename?.trim() ||
    `orden-${paciente.paciente.replace(/\s+/g, "-") || "paciente"}.pdf`;

  const pdfContent = stripDataUrlPrefix(input.pdfBase64);
  if (!pdfContent) throw new Error("PDF inválido");

  const envioId = randomUUID();
  let pdfUrl: string | null = null;
  try {
    const saved = await saveEnvioPdf(envioId, pdfContent);
    pdfUrl = saved.publicUrl;
  } catch (saveError) {
    console.error("[email-historial] No se pudo guardar el PDF", saveError);
  }

  const baseEnvio = {
    pacienteId: paciente.id,
    pacienteNombre: paciente.paciente,
    toEmail: paciente.email.trim(),
    medicoId: medico?.id ?? null,
    medicoNombre,
    fechaOrden: fechaOrdenRaw,
    filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
    pdfUrl,
    subject,
    enviadoAt: new Date().toISOString(),
  };

  try {
    ensureSendGrid();
    await sgMail.send({
      to: paciente.email.trim(),
      from: {
        email: config.fromEmail,
        name: config.fromName,
      },
      subject,
      text: bodyText,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${bodyHtml}</div>`,
      attachments: [
        {
          content: pdfContent,
          filename: baseEnvio.filename,
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    });

    const envio = await createEmailEnvio(
      {
        ...baseEnvio,
        status: "ok",
        errorMessage: null,
      },
      { id: envioId },
    );

    return { to: paciente.email.trim(), envioId: envio.id };
  } catch (error) {
    const clear = clearEmailErrorMessage(error);
    try {
      await createEmailEnvio(
        {
          ...baseEnvio,
          status: "error",
          errorMessage: clear,
        },
        { id: envioId },
      );
    } catch (logError) {
      console.error("[email-historial] No se pudo guardar el fallo", logError);
    }
    throw new Error(clear);
  }
}

export type SendPresupuestoEmailInput = {
  toEmail: string;
  nombrePaciente: string;
  profesional?: string;
  pdfBase64: string;
  filename?: string;
  fechaPresupuesto?: string;
  totalEfectivo?: number;
  total3Cuotas?: number;
  cantidadPrestaciones?: number;
  items?: PresupuestoItem[];
  /** Si vienen, se usan tal cual (preview editable del cliente). */
  subject?: string;
  body?: string;
};

const moneyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatPresupuestoMoney(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return moneyFormatter.format(value);
}

export async function sendPresupuestoEmail(
  input: SendPresupuestoEmailInput,
): Promise<{ to: string }> {
  const to = input.toEmail.trim();
  if (!to) throw new Error("El email es obligatorio para enviar el presupuesto");

  const nombrePaciente = input.nombrePaciente.trim() || "paciente";
  const config = await getPresupuestoEmailConfig();
  const fechaRaw = input.fechaPresupuesto?.trim() || "";
  const fechaFmt = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaRaw);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : fechaRaw || "—";
  })();
  const vars = {
    nombrePaciente,
    email: to,
    nombreProfesional: input.profesional?.trim() || "—",
    fechaPresupuesto: fechaFmt,
    totalEfectivo: formatPresupuestoMoney(input.totalEfectivo),
    total3Cuotas: formatPresupuestoMoney(input.total3Cuotas),
    cantidadPrestaciones:
      input.cantidadPrestaciones !== undefined ? String(input.cantidadPrestaciones) : "—",
    listaPrestaciones: formatListaPrestaciones(input.items ?? []),
  };

  const subject =
    input.subject?.trim() ||
    applyPresupuestoEmailTemplate(config.subject, vars).trim() ||
    `Presupuesto - ${nombrePaciente}`;
  const bodyRaw =
    input.body?.trim() || applyPresupuestoEmailTemplate(config.body, vars);
  const bodyText = emailBodyToPlainText(bodyRaw);
  const bodyHtml = emailBodyToHtml(bodyRaw);

  const filename =
    input.filename?.trim() ||
    `presupuesto-${nombrePaciente.replace(/\s+/g, "-").toLowerCase() || "paciente"}.pdf`;

  const pdfContent = stripDataUrlPrefix(input.pdfBase64);
  if (!pdfContent) throw new Error("PDF inválido");

  try {
    ensureSendGrid();
    await sgMail.send({
      to,
      from: {
        email: config.fromEmail,
        name: config.fromName,
      },
      subject,
      text: bodyText,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">${bodyHtml}</div>`,
      attachments: [
        {
          content: pdfContent,
          filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    });

    return { to };
  } catch (error) {
    throw new Error(clearEmailErrorMessage(error));
  }
}
