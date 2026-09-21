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

export type WaContact = {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  whatsappName: string | null;
  isBlocked: boolean;
};

export type WaConversation = {
  id: string;
  contactId: string;
  status: WaConversationStatus;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  assigneeKind?: "none" | "bot" | "user";
  assigneeUserId?: string | null;
  assigneeName?: string | null;
  tagIds?: string[];
  contact?: WaContact;
};

export type WaOperator = {
  id: string;
  nombre: string;
  email: string;
  color: string;
};

export type WaTagGroup = {
  id: string;
  name: string;
  color: string;
};

export type WaTag = {
  id: string;
  name: string;
  groupId: string;
};

export type WaTagCatalog = {
  groups: WaTagGroup[];
  items: WaTag[];
};

export type WaMessage = {
  id: string;
  conversationId: string;
  contactId: string;
  direction: WaMessageDirection;
  type: WaMessageType;
  text: string;
  status: WaMessageStatus;
  mimeType: string | null;
  fileName: string | null;
  mediaUrl: string | null;
  isDeleted: boolean;
  createdAt: string;
};

export type WaConnectionStatus = {
  status?: string;
  phoneNumber?: string | null;
  qr?: string | null;
  error?: string | null;
};

export function waAssigneeLabel(conversation?: {
  assigneeKind?: "none" | "bot" | "user" | null;
  assigneeName?: string | null;
} | null): string {
  if (conversation?.assigneeKind === "bot") return "Bot";
  if (conversation?.assigneeKind === "user" && conversation.assigneeName?.trim()) {
    return conversation.assigneeName.trim();
  }
  return "Sin asignar";
}

export function waContactLabel(contact?: WaContact | null): string {
  if (!contact) return "Contacto";
  if (contact.displayName?.trim()) return contact.displayName.trim();
  const full = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (contact.whatsappName?.trim()) return contact.whatsappName.trim();
  return contact.phoneNumber || "Contacto";
}

/** Nombre y teléfono para tooltips / etiquetas de Inicio. */
export function waContactDetailLabel(contact?: WaContact | null): string {
  if (!contact) return "WhatsApp";
  const name = waContactLabel(contact);
  const phone = String(contact.phoneNumber ?? "").trim();
  if (phone && name !== phone) return `${name} · ${phone}`;
  return name || phone || "WhatsApp";
}
