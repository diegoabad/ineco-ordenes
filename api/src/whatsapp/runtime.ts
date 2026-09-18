import path from "node:path";
import { API_ROOT } from "../config/paths.js";
import { env } from "../config/env.js";
import { BaileysProvider } from "./baileys.provider.js";
import {
  createMessage,
  findOrCreateContact,
  findOrCreateOpenConversation,
  getConversation,
  getMessage,
  listConversations,
  listMessagesByConversation,
  markConversationRead,
  setConversationAssignee,
  setConversationTags,
  updateMessageStatusByExternalId,
} from "./firestore-store.js";
import { MediaStorage } from "./media-storage.js";
import { mediaMetaFromRaw, normalizeIncomingMessage } from "./normalize.js";
import { normalizePhoneNumber } from "./phone.js";
import { BaileysSessionStore } from "./session-store.js";
import type { WaMessage, WaMessageType, WaStatusSnapshot } from "./types.js";

const sessionStore = new BaileysSessionStore(
  path.isAbsolute(env.whatsapp.sessionPath)
    ? env.whatsapp.sessionPath
    : path.join(API_ROOT, env.whatsapp.sessionPath),
);

const mediaStorage = new MediaStorage(
  path.isAbsolute(env.whatsapp.mediaPath)
    ? env.whatsapp.mediaPath
    : path.join(API_ROOT, env.whatsapp.mediaPath),
);

const provider = new BaileysProvider(sessionStore);

let lastConnectedAt: string | null = null;
let lastDisconnectedAt: string | null = null;
let lastError: string | null = null;
let bootstrapped = false;

provider.onConnected(() => {
  lastConnectedAt = new Date().toISOString();
  lastError = null;
});

provider.onDisconnected(() => {
  lastDisconnectedAt = new Date().toISOString();
});

provider.onRawMessage((raw, meta) => {
  void handleIncomingRaw(raw, meta.isBackfill);
});

provider.onMessageStatusUpdate(({ externalMessageId, status }) => {
  void updateMessageStatusByExternalId(externalMessageId, status).catch((error) => {
    console.warn("[whatsapp] status update", error);
  });
});

async function handleIncomingRaw(raw: unknown, _isBackfill: boolean): Promise<void> {
  try {
    const key =
      raw && typeof raw === "object"
        ? ((raw as { key?: { fromMe?: boolean } }).key ?? null)
        : null;
    const fromMe = Boolean(key?.fromMe);
    const peerOverride = await provider.resolvePeerPhone(
      raw && typeof raw === "object" ? ((raw as { key?: unknown }).key as never) : null,
      fromMe,
    );
    const normalized = normalizeIncomingMessage(raw, peerOverride);
    if (!normalized) return;

    const contact = await findOrCreateContact({
      phoneNumber: normalizePhoneNumber(normalized.peerPhone),
      whatsappName: normalized.pushName,
    });
    if (contact.isBlocked) return;

    const conversation = await findOrCreateOpenConversation(contact.id);

    let mediaPath: string | null = null;
    let mimeType: string | null = null;
    let fileName: string | null = null;
    if (["IMAGE", "AUDIO", "VIDEO", "DOCUMENT", "STICKER"].includes(normalized.type)) {
      const meta = mediaMetaFromRaw(raw);
      mimeType = meta.mimeType;
      fileName = meta.fileName;
      const buffer = await provider.downloadMedia(raw);
      if (buffer) {
        const saved = await mediaStorage.save(buffer, { mimeType, fileName });
        mediaPath = saved.relativePath;
        fileName = saved.fileName;
      }
    }

    await createMessage({
      conversationId: conversation.id,
      contactId: contact.id,
      direction: normalized.direction,
      type: normalized.type,
      text: normalized.text,
      externalMessageId: normalized.externalId,
      status: normalized.direction === "INBOUND" ? "RECEIVED" : "SENT",
      mimeType,
      fileName,
      mediaPath,
      createdAt: normalized.timestamp.toISOString(),
    });
  } catch (error) {
    console.error("[whatsapp] Error ingestando mensaje", error);
  }
}

export function getWhatsappStatus(): WaStatusSnapshot {
  return {
    status: provider.getStatus(),
    qr: provider.getQr() ?? null,
    phoneNumber: provider.getPhoneNumber() ?? null,
    lastConnectedAt,
    lastDisconnectedAt,
    error: lastError,
  };
}

export async function connectWhatsapp(): Promise<WaStatusSnapshot> {
  try {
    lastError = null;
    await provider.connect();
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Error al conectar WhatsApp";
    throw error;
  }
  return getWhatsappStatus();
}

export async function disconnectWhatsapp(): Promise<WaStatusSnapshot> {
  await provider.disconnect();
  return getWhatsappStatus();
}

export async function logoutWhatsapp(): Promise<WaStatusSnapshot> {
  await provider.logout();
  return getWhatsappStatus();
}

export async function bootstrapWhatsapp(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  await mediaStorage.ensureDirectory();
  await sessionStore.ensureDirectory();
  await provider.restoreIfPossible();
}

export async function sendConversationText(
  conversationId: string,
  text: string,
): Promise<WaMessage> {
  const conversation = await getConversation(conversationId);
  if (!conversation?.contact?.phoneNumber) {
    throw new Error("Conversación no encontrada");
  }
  if (conversation.contact.isBlocked) {
    throw new Error("El contacto está bloqueado");
  }
  if (provider.getStatus() !== "CONNECTED") {
    throw new Error("WhatsApp no está conectado. Escaneá el QR en Configuración.");
  }

  const externalId = await provider.sendTextMessage(conversation.contact.phoneNumber, text);
  return createMessage({
    conversationId: conversation.id,
    contactId: conversation.contactId,
    direction: "OUTBOUND",
    type: "TEXT",
    text,
    externalMessageId: externalId,
    status: "SENT",
  });
}

function mediaTypeFromMime(mimeType: string): WaMessageType {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

export async function sendConversationMedia(
  conversationId: string,
  file: { buffer: Buffer; mimeType: string; fileName: string },
  caption?: string,
): Promise<WaMessage> {
  const conversation = await getConversation(conversationId);
  if (!conversation?.contact?.phoneNumber) {
    throw new Error("Conversación no encontrada");
  }
  if (conversation.contact.isBlocked) {
    throw new Error("El contacto está bloqueado");
  }
  if (provider.getStatus() !== "CONNECTED") {
    throw new Error("WhatsApp no está conectado. Escaneá el QR.");
  }

  const type = mediaTypeFromMime(file.mimeType);
  const saved = await mediaStorage.save(file.buffer, {
    mimeType: file.mimeType,
    fileName: file.fileName,
  });
  const text =
    caption?.trim() ||
    (type === "IMAGE" ? "" : type === "VIDEO" ? "Video" : type === "AUDIO" ? "Audio" : file.fileName);

  const externalId = await provider.sendMediaMessage(conversation.contact.phoneNumber, {
    buffer: file.buffer,
    mimeType: file.mimeType,
    fileName: file.fileName,
    caption: caption?.trim() || undefined,
  });

  return createMessage({
    conversationId: conversation.id,
    contactId: conversation.contactId,
    direction: "OUTBOUND",
    type,
    text,
    externalMessageId: externalId,
    status: "SENT",
    mimeType: file.mimeType,
    fileName: saved.fileName,
    mediaPath: saved.relativePath,
  });
}

export {
  getConversation,
  getMessage,
  listConversations,
  listMessagesByConversation,
  markConversationRead,
  mediaStorage,
  setConversationAssignee,
  setConversationTags,
};
