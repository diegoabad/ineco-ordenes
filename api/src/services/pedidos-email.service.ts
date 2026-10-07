import fs from "node:fs/promises";
import path from "node:path";
import sgMail from "@sendgrid/mail";
import { env } from "../config/env.js";
import { uploadsPedidosDir } from "../config/paths.js";
import type { PedidoSistema } from "../types.js";

const PEDIDOS_TO = [
  "dabad@ineco.ar",
  "diegoabad.2289@gmail.com",
  "desarrollo@ineco.org.ar",
];

const PEDIDOS_FROM = {
  email: "sistemas@ineco.ar",
  name: "Ticket sistemas",
};

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

function seccionAfectada(pedido: PedidoSistema): string {
  if (pedido.seccion === "nueva" && pedido.seccionNueva.trim()) {
    return pedido.seccionNueva.trim();
  }
  return SECCION_LABEL[pedido.seccion];
}

function solicitadoPorLinea(pedido: PedidoSistema): string {
  const nombre = pedido.solicitadoPor.trim();
  const email = pedido.creadoPorEmail?.trim() || "";
  if (nombre && email && nombre.toLowerCase() !== email.toLowerCase()) {
    return `${nombre} (${email})`;
  }
  return nombre || email || "—";
}

export async function sendPedidoSistemaEmail(pedido: PedidoSistema): Promise<void> {
  ensureSendGrid();

  const seccion = seccionAfectada(pedido);
  const prioridad = PRIORIDAD_LABEL[pedido.prioridad];
  const solicitadoPor = solicitadoPorLinea(pedido);
  const detalle = pedido.detalle.trim() || "—";
  const subject = pedido.titulo.trim() || "Ticket sistema";
  const text = [
    `Detalle: ${detalle}`,
    "",
    `Sección afectada: ${seccion}`,
    `Prioridad: ${prioridad}`,
    `Solicitado por: ${solicitadoPor}`,
  ].join("\n");

  const html = `
    <p style="white-space:pre-wrap"><strong>Detalle:</strong> ${escapeHtml(detalle)}</p>
    <p><strong>Sección afectada:</strong> ${escapeHtml(seccion)}</p>
    <p><strong>Prioridad:</strong> ${escapeHtml(prioridad)}</p>
    <p><strong>Solicitado por:</strong> ${escapeHtml(solicitadoPor)}</p>
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
    from: PEDIDOS_FROM,
    subject,
    text,
    html,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

export async function sendPedidoCompletadoEmail(
  pedido: PedidoSistema,
  mensaje: string,
): Promise<void> {
  const to = pedido.creadoPorEmail?.trim();
  if (!to) throw new Error("Quien creó el pedido no tiene un email cargado");

  ensureSendGrid();

  const titulo = pedido.titulo.trim() || "tu pedido";
  const nota = mensaje.trim();
  const saludoNombre = pedido.solicitadoPor.trim();
  const saludo = saludoNombre ? `Hola ${saludoNombre},` : "Hola,";
  const cierre = `Finalizamos la tarea "${titulo}".`;
  const text = [saludo, "", cierre, ...(nota ? ["", nota] : [])].join("\n");
  const notaHtml = nota
    ? `<p style="white-space:pre-wrap">${escapeHtml(nota)}</p>`
    : "";
  const html = `
    <p>${escapeHtml(saludo)}</p>
    <p>${escapeHtml(cierre)}</p>
    ${notaHtml}
  `;

  await sgMail.send({
    to,
    from: PEDIDOS_FROM,
    subject: `Finalizamos: ${titulo}`,
    text,
    html,
  });
}
