import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";
import type { PedidoSistema } from "../types.js";

const PEDIDOS_TO = "tickets@ineco.ar";

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

const SECCION_LABEL: Record<PedidoSistema["seccion"], string> = {
  ordenes: "Órdenes",
  presupuestos: "Presupuestos",
  pami: "PAMI",
  "busca-turno": "Busca turno",
  nueva: "Nueva sección",
};

const PRIORIDAD_LABEL: Record<PedidoSistema["prioridad"], string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
};

export async function sendPedidoSistemaEmail(pedido: PedidoSistema): Promise<void> {
  ensureSendGrid();

  const seccion = SECCION_LABEL[pedido.seccion];
  const subject = "Ticket sistema";
  const text = [
    "Nuevo ticket al sistema",
    "",
    `Título: ${pedido.titulo}`,
    `Sección: ${seccion}`,
    ...(pedido.seccion === "nueva" && pedido.seccionNueva
      ? [`Nueva sección: ${pedido.seccionNueva}`]
      : []),
    `Solicitado por: ${pedido.solicitadoPor}`,
    `Prioridad: ${PRIORIDAD_LABEL[pedido.prioridad]}`,
    `Fotos: ${pedido.fotos.length}`,
    "",
    "Detalle:",
    pedido.detalle || "—",
  ].join("\n");

  const fotosHtml =
    pedido.fotos.length === 0
      ? "<p>Sin fotos adjuntas.</p>"
      : `<ul>${pedido.fotos.map((f) => `<li>${escapeHtml(f.nombre)}</li>`).join("")}</ul>`;

  const nuevaHtml =
    pedido.seccion === "nueva" && pedido.seccionNueva
      ? `<p><strong>Nueva sección:</strong> ${escapeHtml(pedido.seccionNueva)}</p>`
      : "";

  const html = `
    <h2>Nuevo ticket al sistema</h2>
    <p><strong>Título:</strong> ${escapeHtml(pedido.titulo)}</p>
    <p><strong>Sección:</strong> ${escapeHtml(seccion)}</p>
    ${nuevaHtml}
    <p><strong>Solicitado por:</strong> ${escapeHtml(pedido.solicitadoPor)}</p>
    <p><strong>Prioridad:</strong> ${escapeHtml(PRIORIDAD_LABEL[pedido.prioridad])}</p>
    <p><strong>Detalle:</strong></p>
    <p style="white-space:pre-wrap">${escapeHtml(pedido.detalle || "—")}</p>
    <p><strong>Fotos:</strong></p>
    ${fotosHtml}
  `;

  await sgMail.send({
    to: PEDIDOS_TO,
    from: { email: env.sendgrid.fromEmail, name: env.sendgrid.fromName },
    subject,
    text,
    html,
  });
}
