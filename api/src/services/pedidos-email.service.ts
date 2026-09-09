import fs from "node:fs/promises";
import path from "node:path";
import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";
import { uploadsPedidosDir } from "../config/paths.js";
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

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "txt":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

function filePathFromFotoUrl(url: string): string | null {
  const clean = url.split("?")[0] ?? "";
  const match = /\/uploads\/pedidos\/([^/]+)$/i.exec(clean);
  if (!match?.[1]) return null;
  return path.join(uploadsPedidosDir(), match[1]);
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
    `Adjuntos: ${pedido.fotos.length}`,
    "",
    "Detalle:",
    pedido.detalle || "—",
  ].join("\n");

  const adjuntosHtml =
    pedido.fotos.length === 0
      ? "<p>Sin adjuntos.</p>"
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
    <p><strong>Adjuntos:</strong></p>
    ${adjuntosHtml}
  `;

  const attachments: {
    content: string;
    filename: string;
    type: string;
    disposition: "attachment";
  }[] = [];

  for (const foto of pedido.fotos) {
    const filePath = filePathFromFotoUrl(foto.url);
    if (!filePath) continue;
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).replace(/^\./, "") || "bin";
      attachments.push({
        content: buffer.toString("base64"),
        filename: foto.nombre.trim() || path.basename(filePath),
        type: mimeFromExt(ext),
        disposition: "attachment",
      });
    } catch (error) {
      console.error(`No se pudo adjuntar archivo de pedido ${pedido.id}:`, foto.url, error);
    }
  }

  await sgMail.send({
    to: PEDIDOS_TO,
    from: { email: env.sendgrid.fromEmail, name: env.sendgrid.fromName },
    subject,
    text,
    html,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}
