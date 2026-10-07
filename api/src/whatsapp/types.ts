export type WaConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "WAITING_QR"
  | "CONNECTED"
  | "RECONNECTING"
  | "ERROR";

export type WaMessageDirection = "INBOUND" | "OUTBOUND";
export type WaMessageType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "STICKER"
  | "UNKNOWN";
export type WaMessageStatus = "RECEIVED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
export type WaConversationStatus = "OPEN" | "ARCHIVED";

export type WaContactGrupoEtario = "infanto" | "adulto";
export type WaContactConsultaPara = "propio" | "tercero";

export type WaContact = {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  whatsappName: string | null;
  cobertura: string | null;
  email: string | null;
  grupoEtario: WaContactGrupoEtario | null;
  consultaPara: WaContactConsultaPara | null;
  /** Quien escribe por WhatsApp cuando no es el paciente. */
  contactoNombre: string | null;
  contactoApellido: string | null;
  relacionFamiliar: string | null;
  dni: string | null;
  esPaciente: boolean | null;
  isBlocked: boolean;
  lastInteractionAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WaConversation = {
  id: string;
  contactId: string;
  status: WaConversationStatus;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  assigneeKind: "none" | "bot" | "user";
    assigneeUserId: string | null;
    assigneeName: string | null;
    tagIds: string[];
    createdAt: string;
  updatedAt: string;
  contact?: WaContact;
};

export type WaMessage = {
  id: string;
  conversationId: string;
  contactId: string;
  direction: WaMessageDirection;
  type: WaMessageType;
  text: string;
  externalMessageId: string | null;
  status: WaMessageStatus;
  mimeType: string | null;
  fileName: string | null;
  mediaPath: string | null;
  mediaUrl: string | null;
  isDeleted: boolean;
  createdAt: string;
};

export type WaStatusSnapshot = {
  status: WaConnectionStatus;
  qr?: string | null;
  phoneNumber?: string | null;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  error?: string | null;
};

export type NormalizedWaMessage = {
  externalId: string;
  peerPhone: string;
  pushName?: string;
  text: string;
  type: WaMessageType;
  direction: WaMessageDirection;
  timestamp: Date;
  isGroup: boolean;
  raw: unknown;
};
