import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";

function ensureSendGrid(): void {
  if (!env.sendgrid.apiKey) {
    throw new Error("Falta configurar el servicio de correo en el servidor");
  }
  sgMail.setApiKey(env.sendgrid.apiKey);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fechaFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export async function sendRecordatorioEmail(input: {
  to: string;
  nombre?: string;
  titulo: string;
  detalle: string;
  fechaHora: string;
}): Promise<void> {
  ensureSendGrid();
  const to = input.to.trim().toLowerCase();
  if (!to) throw new Error("Email de destino inválido");

  const titulo = input.titulo.trim() || "Recordatorio";
  const detalle = input.detalle.trim() || "Sin detalle";
  const cuando = (() => {
    const t = Date.parse(input.fechaHora);
    return Number.isFinite(t) ? fechaFmt.format(new Date(t)) : input.fechaHora;
  })();
  const saludo = input.nombre?.trim() ? `Hola ${input.nombre.trim()},` : "Hola,";
  const fromEmail = "recordatorio@ineco.ar";
  const fromName = "Recordatorios Ineco";

  const subject = `Recordatorio: ${titulo}`;
  const text = [
    saludo,
    "",
    "Tenés un recordatorio:",
    `Título: ${titulo}`,
    `Detalle: ${detalle}`,
    `Fecha y hora: ${cuando}`,
    "",
    "Saludos,",
    fromName,
  ].join("\n");

  const html = `
    <p>${escapeHtml(saludo)}</p>
    <p>Tenés un <strong>recordatorio</strong>:</p>
    <p><strong>Título:</strong> ${escapeHtml(titulo)}</p>
    <p><strong>Detalle:</strong> ${escapeHtml(detalle)}</p>
    <p><strong>Fecha y hora:</strong> ${escapeHtml(cuando)}</p>
    <p>Saludos,<br/>${escapeHtml(fromName)}</p>
  `;

  await sgMail.send({
    to,
    from: { email: fromEmail, name: fromName },
    subject,
    text,
    html,
  });
}
