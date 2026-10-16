import { randomUUID } from "node:crypto";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type proto,
  type AnyMessageContent,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import {
  getCachedPhoneForJid,
  isLidJid,
  isPhoneJid,
  jidToPhoneDigits,
  registerChatLidMapping,
  registerContactLidMapping,
  resolveChatPeerPhone,
  resolveInboundSenderPhone,
} from "./jid.utils.js";
import { baileysLogger } from "./logger.js";
import { normalizePhoneNumber, toWhatsappJid } from "./phone.js";
import type { BaileysSessionStore } from "./session-store.js";
import type { WaConnectionStatus, WaMessageStatus } from "./types.js";

type RawHandler = (raw: unknown, meta: { isBackfill: boolean }) => void;
type StatusHandler = (update: { externalMessageId: string; status: WaMessageStatus }) => void;

function mapBaileysStatus(status: number | undefined | null): WaMessageStatus | null {
  // proto.WebMessageInfo.Status: PENDING=0 SERVER_ACK=1 DELIVERY_ACK=2 READ=3 PLAYED=4
  if (status == null) return null;
  if (status >= 3) return "READ";
  if (status === 2) return "DELIVERED";
  if (status === 1) return "SENT";
  return "SENT";
}

export class BaileysProvider {
  private socket: WASocket | null = null;
  private status: WaConnectionStatus = "DISCONNECTED";
  private phoneNumber: string | undefined;
  private isConnecting = false;
  private allowAutoReconnect = true;
  private currentQrDataUrl: string | undefined;
  private readonly qrCallbacks: Array<(qr: string) => void> = [];
  private readonly connectedCallbacks: Array<(phone: string) => void> = [];
  private readonly disconnectedCallbacks: Array<() => void> = [];
  private readonly rawMessageCallbacks: RawHandler[] = [];
  private readonly messageStatusCallbacks: StatusHandler[] = [];

  constructor(private readonly sessionStore: BaileysSessionStore) {}

  getStatus(): WaConnectionStatus {
    return this.status;
  }

  getPhoneNumber(): string | undefined {
    return this.phoneNumber;
  }

  getQr(): string | undefined {
    return this.currentQrDataUrl;
  }

  onQr(cb: (qr: string) => void): void {
    this.qrCallbacks.push(cb);
  }

  onConnected(cb: (phone: string) => void): void {
    this.connectedCallbacks.push(cb);
  }

  onDisconnected(cb: () => void): void {
    this.disconnectedCallbacks.push(cb);
  }

  onRawMessage(cb: RawHandler): void {
    this.rawMessageCallbacks.push(cb);
  }

  onMessageStatusUpdate(cb: StatusHandler): void {
    this.messageStatusCallbacks.push(cb);
  }

  async connect(): Promise<void> {
    if (this.isConnecting || this.status === "CONNECTED") return;
    this.allowAutoReconnect = true;
    this.isConnecting = true;
    this.setStatus("CONNECTING");

    try {
      if (await this.sessionStore.hasSession()) {
        const valid = await this.sessionStore.validateSession();
        if (!valid) {
          await this.sessionStore.clearSession();
          throw new Error("Sesión WhatsApp inválida. Escaneá un QR de nuevo.");
        }
      }
      await this.startSocket();
    } catch (error) {
      this.isConnecting = false;
      this.setStatus("ERROR");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.allowAutoReconnect = false;
    this.isConnecting = false;
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.setStatus("DISCONNECTED");
    this.disconnectedCallbacks.forEach((cb) => cb());
  }

  async logout(): Promise<void> {
    this.allowAutoReconnect = false;
    this.isConnecting = false;
    try {
      if (this.socket) {
        await this.socket.logout();
      }
    } catch {
      /* ignore */
    }
    this.socket = null;
    await this.sessionStore.clearSession();
    this.phoneNumber = undefined;
    this.currentQrDataUrl = undefined;
    this.setStatus("DISCONNECTED");
    this.disconnectedCallbacks.forEach((cb) => cb());
  }

  async sendTextMessage(to: string, text: string): Promise<string> {
    if (!this.socket || this.status !== "CONNECTED") {
      throw new Error("WhatsApp no está conectado");
    }
    const jid = toWhatsappJid(normalizePhoneNumber(to));
    const result = await this.socket.sendMessage(jid, { text });
    return result?.key.id ?? randomUUID();
  }

  async sendMediaMessage(
    to: string,
    input: { buffer: Buffer; mimeType: string; fileName: string; caption?: string },
  ): Promise<string> {
    if (!this.socket || this.status !== "CONNECTED") {
      throw new Error("WhatsApp no está conectado");
    }
    const jid = toWhatsappJid(normalizePhoneNumber(to));
    const caption = input.caption?.trim() || undefined;
    const mime = input.mimeType.toLowerCase();
    let content: AnyMessageContent;
    if (mime.startsWith("image/")) {
      content = { image: input.buffer, caption, mimetype: input.mimeType };
    } else if (mime.startsWith("video/")) {
      content = { video: input.buffer, caption, mimetype: input.mimeType };
    } else if (mime.startsWith("audio/")) {
      content = { audio: input.buffer, mimetype: input.mimeType, ptt: false };
    } else {
      content = {
        document: input.buffer,
        mimetype: input.mimeType || "application/octet-stream",
        fileName: input.fileName || "archivo",
        caption,
      };
    }
    const result = await this.socket.sendMessage(jid, content);
    return result?.key.id ?? randomUUID();
  }

  async downloadMedia(raw: unknown): Promise<Buffer | null> {
    if (!this.socket) return null;
    try {
      const buffer = await downloadMediaMessage(
        raw as proto.IWebMessageInfo,
        "buffer",
        {},
        {
          logger: baileysLogger,
          reuploadRequest: this.socket.updateMediaMessage.bind(this.socket),
        },
      );
      return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
    } catch (error) {
      console.warn("[whatsapp] No se pudo descargar media", error);
      return null;
    }
  }

  async resolvePeerPhone(key: proto.IMessageKey | null | undefined, fromMe: boolean): Promise<string | null> {
    if (!key) return null;
    const sync = fromMe ? resolveChatPeerPhone(key, true) : resolveInboundSenderPhone(key);
    if (sync) return sync;

    const remoteJid = key.remoteJid ?? "";
    if (isPhoneJid(remoteJid)) return jidToPhoneDigits(remoteJid) || null;
    if (isLidJid(remoteJid)) return getCachedPhoneForJid(remoteJid);
    return null;
  }

  async restoreIfPossible(): Promise<void> {
    const has = await this.sessionStore.hasSession();
    if (!has) return;
    const valid = await this.sessionStore.validateSession();
    if (!valid) return;
    try {
      await this.connect();
    } catch (error) {
      console.warn("[whatsapp] No se pudo restaurar la sesión", error);
    }
  }

  private setStatus(status: WaConnectionStatus): void {
    this.status = status;
  }

  private async startSocket(): Promise<void> {
    if (this.socket) return;

    const { state, saveCreds } = await this.sessionStore.loadAuthState();
    const { version } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.socket.ev.on("creds.update", () => {
      void saveCreds();
    });

    this.socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(update);
    });

    this.socket.ev.on("chats.upsert", (chats) => {
      for (const chat of chats) {
        registerChatLidMapping({ id: chat.id, lidJid: chat.lidJid, pnJid: chat.pnJid });
      }
    });

    this.socket.ev.on("chats.update", (updates) => {
      for (const update of updates) {
        registerChatLidMapping({ id: update.id, lidJid: update.lidJid, pnJid: update.pnJid });
      }
    });

    this.socket.ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        registerContactLidMapping(contact);
      }
    });

    this.socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const message of messages) {
        this.rawMessageCallbacks.forEach((cb) => cb(message, { isBackfill: type === "append" }));
      }
    });

    this.socket.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id || update.status == null) continue;
        const status = mapBaileysStatus(update.status);
        if (!status) continue;
        this.messageStatusCallbacks.forEach((cb) =>
          cb({ externalMessageId: key.id!, status }),
        );
      }
    });
  }

  private async handleConnectionUpdate(update: {
    connection?: "close" | "connecting" | "open";
    lastDisconnect?: { error?: Error };
    qr?: string;
  }): Promise<void> {
    if (update.qr) {
      const qrDataUrl = await QRCode.toDataURL(update.qr);
      this.currentQrDataUrl = qrDataUrl;
      this.setStatus("WAITING_QR");
      this.qrCallbacks.forEach((cb) => cb(qrDataUrl));
    }

    if (update.connection === "connecting") {
      this.setStatus("CONNECTING");
    }

    if (update.connection === "open") {
      this.isConnecting = false;
      this.currentQrDataUrl = undefined;
      this.phoneNumber = this.socket?.user?.id.split(":")[0]?.split("@")[0];
      this.setStatus("CONNECTED");
      this.connectedCallbacks.forEach((cb) => cb(this.phoneNumber ?? "unknown"));
    }

    if (update.connection === "close") {
      this.isConnecting = false;
      this.socket = null;
      const boom = update.lastDisconnect?.error;
      const statusCode = boom instanceof Boom ? boom.output.statusCode : undefined;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const badSession = statusCode === DisconnectReason.badSession;

      if (badSession || loggedOut) {
        await this.sessionStore.clearSession();
        this.phoneNumber = undefined;
        this.setStatus("DISCONNECTED");
        this.disconnectedCallbacks.forEach((cb) => cb());
        return;
      }

      this.setStatus("DISCONNECTED");
      this.disconnectedCallbacks.forEach((cb) => cb());

      if (this.allowAutoReconnect) {
        this.setStatus("RECONNECTING");
        setTimeout(() => {
          void this.connect().catch((error) => {
            console.warn("[whatsapp] Reconnect falló", error);
          });
        }, 2000);
      }
    }
  }
}
