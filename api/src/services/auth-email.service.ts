import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";
import type { AppModuleId, AppUserPublic } from "../types.js";

function ensureSendGrid(): void {
  if (!env.sendgrid.apiKey) {
    throw new Error("Falta configurar el servicio de correo en el servidor");
  }
  sgMail.setApiKey(env.sendgrid.apiKey);
}

const MODULE_LABELS: Record<AppModuleId, string> = {
  ordenes: "Órdenes",
  presupuestos: "Presupuestos",
  pami: "PAMI",
  "busca-turno": "Busca turno",
  "pedidos-sistema": "Pedidos sistema",
  usuarios: "Usuarios",
};

function modulesListHtml(modules: AppModuleId[]): string {
  if (modules.length === 0) return "<li>Sin pantallas asignadas</li>";
  return modules.map((m) => `<li>${MODULE_LABELS[m] ?? m}</li>`).join("");
}

function modulesListText(modules: AppModuleId[]): string {
  if (modules.length === 0) return "- Sin pantallas asignadas";
  return modules.map((m) => `- ${MODULE_LABELS[m] ?? m}`).join("\n");
}

export async function sendUserApprovedEmail(user: AppUserPublic): Promise<void> {
  ensureSendGrid();
  const roleLabel = user.role === "admin" ? "Administrador" : "Usuario";
  const subject = "Tu acceso a Órdenes Ineco fue aprobado";
  const text = [
    `Hola ${user.nombre},`,
    "",
    "Tu solicitud de acceso fue aprobada.",
    `Rol: ${roleLabel}`,
    "Pantallas habilitadas:",
    modulesListText(user.modules),
    "",
    "Ya podés ingresar con tu email y contraseña.",
    "",
    "Saludos,",
    env.sendgrid.fromName,
  ].join("\n");

  const html = `
    <p>Hola <strong>${escapeHtml(user.nombre)}</strong>,</p>
    <p>Tu solicitud de acceso fue <strong>aprobada</strong>.</p>
    <p><strong>Rol:</strong> ${escapeHtml(roleLabel)}</p>
    <p><strong>Pantallas habilitadas:</strong></p>
    <ul>${modulesListHtml(user.modules)}</ul>
    <p>Ya podés ingresar con tu email y contraseña.</p>
    <p>Saludos,<br/>${escapeHtml(env.sendgrid.fromName)}</p>
  `;

  await sgMail.send({
    to: user.email,
    from: { email: env.sendgrid.fromEmail, name: env.sendgrid.fromName },
    subject,
    text,
    html,
  });
}

export async function sendUserRejectedEmail(user: AppUserPublic): Promise<void> {
  ensureSendGrid();
  const subject = "Solicitud de acceso a Órdenes Ineco";
  const text = [
    `Hola ${user.nombre},`,
    "",
    "Tu solicitud de acceso fue rechazada.",
    "Si creés que es un error, contactá al administrador del sistema.",
    "",
    "Saludos,",
    env.sendgrid.fromName,
  ].join("\n");

  const html = `
    <p>Hola <strong>${escapeHtml(user.nombre)}</strong>,</p>
    <p>Tu solicitud de acceso fue <strong>rechazada</strong>.</p>
    <p>Si creés que es un error, contactá al administrador del sistema.</p>
    <p>Saludos,<br/>${escapeHtml(env.sendgrid.fromName)}</p>
  `;

  await sgMail.send({
    to: user.email,
    from: { email: env.sendgrid.fromEmail, name: env.sendgrid.fromName },
    subject,
    text,
    html,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
