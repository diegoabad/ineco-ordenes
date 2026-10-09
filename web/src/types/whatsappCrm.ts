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

export type WaCobertura = {
  id: string;
  nombre: string;
  gruposEtarios: WaContactGrupoEtario[];
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

/** Nombre del paciente (datos clínicos / agenda). */
export function waPatientLabel(contact?: WaContact | null): string {
  if (!contact) return "";
  const full = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return contact.displayName?.trim() || "";
}

/**
 * Header del chat:
 * - Título: nombre de agenda; si no hay agenda, el número de teléfono
 * - Debajo: solo si es familiar/tercero → "Padre: Nombre" (u otra relación)
 */
export function waContactThreadHeader(contact?: WaContact | null): {
  title: string;
  subtitle: string | null;
  phone: string;
} {
  const phone = String(contact?.phoneNumber ?? "").trim();
  if (!contact) {
    return { title: phone || "Contacto", subtitle: null, phone };
  }

  const patient = waPatientLabel(contact);
  const title = patient || phone || "Contacto";

  const contactoNombre = [contact.contactoNombre, contact.contactoApellido]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(" ");
  const relacion = contact.relacionFamiliar?.trim() || "";

  let subtitle: string | null = null;
  if (contact.consultaPara === "tercero") {
    if (relacion && contactoNombre) subtitle = `${relacion}: ${contactoNombre}`;
    else if (relacion) subtitle = relacion;
    else if (contactoNombre) subtitle = contactoNombre;
  }

  return { title, subtitle, phone };
}

/** Nombre y teléfono para tooltips / etiquetas de Inicio. */
export function waContactDetailLabel(contact?: WaContact | null): string {
  if (!contact) return "WhatsApp";
  const header = waContactThreadHeader(contact);
  const name = header.subtitle ? `${header.title} · ${header.subtitle}` : header.title;
  if (header.phone && name !== header.phone) return `${name} · ${header.phone}`;
  return name || header.phone || "WhatsApp";
}
