import { extractMessageContent, getContentType, proto } from "@whiskeysockets/baileys";
import { resolveChatPeerPhone, resolveInboundSenderPhone } from "./jid.utils.js";
import type { NormalizedWaMessage, WaMessageType } from "./types.js";

function unwrapMessageContent(message: proto.IMessage | null | undefined): proto.IMessage | undefined {
  if (!message) return undefined;
  if (message.deviceSentMessage?.message) {
    return unwrapMessageContent(message.deviceSentMessage.message);
  }
  return extractMessageContent(message) ?? undefined;
}

function mapType(contentKey: keyof proto.IMessage | undefined): WaMessageType {
  switch (contentKey) {
    case "conversation":
    case "extendedTextMessage":
      return "TEXT";
    case "imageMessage":
      return "IMAGE";
    case "audioMessage":
      return "AUDIO";
    case "videoMessage":
    case "ptvMessage":
      return "VIDEO";
    case "documentMessage":
      return "DOCUMENT";
    case "stickerMessage":
      return "STICKER";
    default:
      return "UNKNOWN";
  }
}

function extractText(message: proto.IMessage | null | undefined): string {
  const content = unwrapMessageContent(message);
  if (!content) return "";
  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  if (content.documentMessage?.caption) return content.documentMessage.caption;
  return "";
}

function displayBody(type: WaMessageType, text: string): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  switch (type) {
    case "IMAGE":
      return "Imagen";
    case "AUDIO":
      return "Audio";
    case "VIDEO":
      return "Video";
    case "DOCUMENT":
      return "Documento";
    case "STICKER":
      return "Sticker";
    default:
      return "";
  }
}

export function normalizeIncomingMessage(
  raw: unknown,
  peerPhoneOverride?: string | null,
): NormalizedWaMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const message = raw as proto.IWebMessageInfo;
  if (!message.key?.id || message.messageTimestamp == null) return null;

  const remoteJid = message.key.remoteJid ?? "";
  if (remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") return null;

  const content = unwrapMessageContent(message.message ?? undefined);
  const contentKey = content ? getContentType(content) : undefined;
  if (contentKey === "reactionMessage" || contentKey === "protocolMessage") return null;

  const fromMe = Boolean(message.key.fromMe);
  const key = message.key as proto.IMessageKey & { resolvedPeerPn?: string };
  const peerPhone =
    peerPhoneOverride ||
    (fromMe ? resolveChatPeerPhone(key, true) : resolveInboundSenderPhone(key));
  if (!peerPhone) return null;

  const type = mapType(contentKey);
  const text = displayBody(type, extractText(message.message ?? undefined));
  if (!text.trim()) return null;

  return {
    externalId: message.key.id,
    peerPhone,
    pushName: message.pushName ?? undefined,
    text,
    type,
    direction: fromMe ? "OUTBOUND" : "INBOUND",
    timestamp: new Date(Number(message.messageTimestamp) * 1000),
    isGroup: false,
    raw,
  };
}

export function mediaMetaFromRaw(raw: unknown): {
  mimeType: string | null;
  fileName: string | null;
} {
  if (!raw || typeof raw !== "object") return { mimeType: null, fileName: null };
  const message = raw as proto.IWebMessageInfo;
  const content = unwrapMessageContent(message.message ?? undefined);
  if (!content) return { mimeType: null, fileName: null };
  if (content.imageMessage) {
    return { mimeType: content.imageMessage.mimetype ?? "image/jpeg", fileName: null };
  }
  if (content.audioMessage) {
    return { mimeType: content.audioMessage.mimetype ?? "audio/ogg", fileName: null };
  }
  if (content.videoMessage) {
    return { mimeType: content.videoMessage.mimetype ?? "video/mp4", fileName: null };
  }
  if (content.documentMessage) {
    return {
      mimeType: content.documentMessage.mimetype ?? "application/octet-stream",
      fileName: content.documentMessage.fileName ?? null,
    };
  }
  if (content.stickerMessage) {
    return { mimeType: content.stickerMessage.mimetype ?? "image/webp", fileName: null };
  }
  return { mimeType: null, fileName: null };
}
