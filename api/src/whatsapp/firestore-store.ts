import { randomUUID } from "node:crypto";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import type {
  WaContact,
  WaConversation,
  WaConversationStatus,
  WaMessage,
  WaMessageDirection,
  WaMessageStatus,
  WaMessageType,
} from "./types.js";

const CONTACTS = "whatsapp_contacts";
const CONVERSATIONS = "whatsapp_conversations";
const MESSAGES = "whatsapp_messages";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeContact(id: string, raw: Record<string, unknown>): WaContact {
  return {
    id,
    phoneNumber: String(raw.phoneNumber ?? ""),
    firstName: raw.firstName != null ? String(raw.firstName) : null,
    lastName: raw.lastName != null ? String(raw.lastName) : null,
    displayName: raw.displayName != null ? String(raw.displayName) : null,
    whatsappName: raw.whatsappName != null ? String(raw.whatsappName) : null,
    isBlocked: raw.isBlocked === true,
    lastInteractionAt: raw.lastInteractionAt != null ? String(raw.lastInteractionAt) : null,
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso()),
  };
}

function normalizeConversation(id: string, raw: Record<string, unknown>): WaConversation {
  return {
    id,
    contactId: String(raw.contactId ?? ""),
    status: (String(raw.status ?? "OPEN") as WaConversationStatus) || "OPEN",
    unreadCount: Number(raw.unreadCount ?? 0) || 0,
    lastMessagePreview: raw.lastMessagePreview != null ? String(raw.lastMessagePreview) : null,
    lastMessageAt: raw.lastMessageAt != null ? String(raw.lastMessageAt) : null,
    assigneeKind:
      raw.assigneeKind === "bot" || raw.assigneeKind === "user" ? raw.assigneeKind : "none",
    assigneeUserId: raw.assigneeUserId != null ? String(raw.assigneeUserId) : null,
    assigneeName: raw.assigneeName != null ? String(raw.assigneeName) : null,
    tagIds: Array.isArray(raw.tagIds)
      ? [...new Set(raw.tagIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
      : [],
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso()),
  };
}

function normalizeMessage(id: string, raw: Record<string, unknown>): WaMessage {
  const mediaPath = raw.mediaPath != null ? String(raw.mediaPath) : null;
  return {
    id,
    conversationId: String(raw.conversationId ?? ""),
    contactId: String(raw.contactId ?? ""),
    direction: String(raw.direction ?? "INBOUND") as WaMessageDirection,
    type: String(raw.type ?? "TEXT") as WaMessageType,
    text: String(raw.text ?? ""),
    externalMessageId: raw.externalMessageId != null ? String(raw.externalMessageId) : null,
    status: String(raw.status ?? "RECEIVED") as WaMessageStatus,
    mimeType: raw.mimeType != null ? String(raw.mimeType) : null,
    fileName: raw.fileName != null ? String(raw.fileName) : null,
    mediaPath,
    mediaUrl: mediaPath ? `/api/whatsapp-crm/messages/${id}/media` : null,
    isDeleted: raw.isDeleted === true,
    createdAt: String(raw.createdAt ?? nowIso()),
  };
}

export async function findContactByPhone(phoneNumber: string): Promise<WaContact | null> {
  const q = query(collection(firestore, CONTACTS), where("phoneNumber", "==", phoneNumber), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return normalizeContact(d.id, d.data() as Record<string, unknown>);
}

export async function getContact(id: string): Promise<WaContact | null> {
  const snap = await getDoc(doc(firestore, CONTACTS, id));
  if (!snap.exists()) return null;
  return normalizeContact(snap.id, snap.data() as Record<string, unknown>);
}

export async function updateContactDisplayName(
  id: string,
  displayName: string,
): Promise<WaContact | null> {
  const existing = await getContact(id);
  if (!existing) return null;
  const name = displayName.trim();
  if (!name) {
    throw new Error("El nombre es obligatorio");
  }
  const now = nowIso();
  await updateDoc(doc(firestore, CONTACTS, id), {
    displayName: name,
    updatedAt: now,
  });
  return {
    ...existing,
    displayName: name,
    updatedAt: now,
  };
}

export async function findOrCreateContact(input: {
  phoneNumber: string;
  whatsappName?: string | null;
}): Promise<WaContact> {
  const existing = await findContactByPhone(input.phoneNumber);
  const now = nowIso();
  if (existing) {
    const patch: {
      lastInteractionAt: string;
      updatedAt: string;
      whatsappName?: string;
    } = {
      lastInteractionAt: now,
      updatedAt: now,
    };
    if (input.whatsappName?.trim() && !existing.whatsappName) {
      patch.whatsappName = input.whatsappName.trim();
    }
    await updateDoc(doc(firestore, CONTACTS, existing.id), patch);
    return {
      ...existing,
      whatsappName: patch.whatsappName ?? existing.whatsappName,
      lastInteractionAt: now,
      updatedAt: now,
    };
  }

  const id = randomUUID();
  const contact: WaContact = {
    id,
    phoneNumber: input.phoneNumber,
    firstName: null,
    lastName: null,
    displayName: null,
    whatsappName: input.whatsappName?.trim() || null,
    isBlocked: false,
    lastInteractionAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(firestore, CONTACTS, id), contact);
  return contact;
}

export async function findOpenConversationByContact(contactId: string): Promise<WaConversation | null> {
  const q = query(
    collection(firestore, CONVERSATIONS),
    where("contactId", "==", contactId),
    where("status", "==", "OPEN"),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return normalizeConversation(d.id, d.data() as Record<string, unknown>);
}

export async function findOrCreateOpenConversation(contactId: string): Promise<WaConversation> {
  const existing = await findOpenConversationByContact(contactId);
  if (existing) return existing;
  const now = nowIso();
  const id = randomUUID();
  const conversation: WaConversation = {
    id,
    contactId,
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(firestore, CONVERSATIONS, id), conversation);
  return conversation;
}

export async function getConversation(id: string): Promise<WaConversation | null> {
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  const conversation = normalizeConversation(snap.id, snap.data() as Record<string, unknown>);
  const contact = await getContact(conversation.contactId);
  return { ...conversation, contact: contact ?? undefined };
}

export type ConversationListResult = {
  items: WaConversation[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

async function withContacts(items: WaConversation[]): Promise<WaConversation[]> {
  return Promise.all(
    items.map(async (c) => {
      const contact = await getContact(c.contactId);
      return { ...c, contact: contact ?? undefined };
    }),
  );
}

export async function listConversations(opts?: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<ConversationListResult> {
  const status = opts?.status?.trim() || "OPEN";
  const pageSize = Math.min(Math.max(Number(opts?.limit ?? 40) || 40, 1), 100);
  const offset = Math.max(Number(opts?.offset ?? 0) || 0, 0);
  const q = query(collection(firestore, CONVERSATIONS), where("status", "==", status));
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => normalizeConversation(d.id, d.data() as Record<string, unknown>));
  items.sort((a, b) => {
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return tb - ta;
  });

  const search = opts?.search?.trim().toLowerCase();
  if (search) {
    const hydrated = await withContacts(items);
    const filtered = hydrated.filter((c) => {
      const phone = c.contact?.phoneNumber?.toLowerCase() ?? "";
      const name = [
        c.contact?.displayName,
        c.contact?.firstName,
        c.contact?.lastName,
        c.contact?.whatsappName,
        c.lastMessagePreview,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return phone.includes(search) || name.includes(search);
    });
    const page = filtered.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    return {
      items: page,
      total: filtered.length,
      hasMore: nextOffset < filtered.length,
      nextOffset: nextOffset < filtered.length ? nextOffset : null,
    };
  }

  const total = items.length;
  const page = items.slice(offset, offset + pageSize);
  const hydrated = await withContacts(page);
  const nextOffset = offset + hydrated.length;
  return {
    items: hydrated,
    total,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
}

export async function markConversationRead(id: string): Promise<WaConversation | null> {
  const current = await getConversation(id);
  if (!current) return null;
  const now = nowIso();
  await updateDoc(doc(firestore, CONVERSATIONS, id), {
    unreadCount: 0,
    updatedAt: now,
  });
  return { ...current, unreadCount: 0, updatedAt: now };
}

export async function setConversationAssignee(
  id: string,
  input: { kind: "none" | "bot" | "user"; userId?: string | null; name?: string | null },
): Promise<WaConversation | null> {
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  const now = nowIso();
  const patch = {
    assigneeKind: input.kind,
    assigneeUserId: input.kind === "user" ? input.userId ?? null : null,
    assigneeName: input.kind === "none" ? null : input.name ?? null,
    updatedAt: now,
  };
  await updateDoc(doc(firestore, CONVERSATIONS, id), patch);
  return normalizeConversation(id, { ...snap.data(), ...patch });
}

export async function listConversationIdsAssignedToUser(userId: string): Promise<string[]> {
  const id = userId.trim();
  if (!id) return [];
  const q = query(collection(firestore, CONVERSATIONS), where("assigneeUserId", "==", id));
  const snap = await getDocs(q);
  return snap.docs.map((item) => item.id);
}

export async function reassignConversationsFromUser(
  fromUserId: string,
  input: { kind: "none" | "bot" | "user"; userId?: string | null; name?: string | null },
): Promise<number> {
  const ids = await listConversationIdsAssignedToUser(fromUserId);
  for (const id of ids) {
    await setConversationAssignee(id, input);
  }
  return ids.length;
}

export async function setConversationTags(
  id: string,
  tagIds: string[],
): Promise<WaConversation | null> {
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  const now = nowIso();
  const unique = [...new Set(tagIds.map((item) => item.trim()).filter(Boolean))];
  const patch = { tagIds: unique, updatedAt: now };
  await updateDoc(doc(firestore, CONVERSATIONS, id), patch);
  return normalizeConversation(id, { ...snap.data(), ...patch });
}

export async function findMessageByExternalId(externalMessageId: string): Promise<WaMessage | null> {
  const q = query(
    collection(firestore, MESSAGES),
    where("externalMessageId", "==", externalMessageId),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0]!;
  return normalizeMessage(d.id, d.data() as Record<string, unknown>);
}

export async function getMessage(id: string): Promise<WaMessage | null> {
  const snap = await getDoc(doc(firestore, MESSAGES, id));
  if (!snap.exists()) return null;
  return normalizeMessage(snap.id, snap.data() as Record<string, unknown>);
}

export async function listMessagesByConversation(
  conversationId: string,
  max = 100,
): Promise<WaMessage[]> {
  const q = query(
    collection(firestore, MESSAGES),
    where("conversationId", "==", conversationId),
    orderBy("createdAt", "asc"),
    limit(Math.min(Math.max(max, 1), 500)),
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => normalizeMessage(d.id, d.data() as Record<string, unknown>));
  } catch {
    // Si falta índice compuesto, fallback sin orderBy.
    const fallback = query(
      collection(firestore, MESSAGES),
      where("conversationId", "==", conversationId),
      limit(Math.min(Math.max(max, 1), 500)),
    );
    const snap = await getDocs(fallback);
    return snap.docs
      .map((d) => normalizeMessage(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}

export async function createMessage(input: {
  conversationId: string;
  contactId: string;
  direction: WaMessageDirection;
  type: WaMessageType;
  text: string;
  externalMessageId?: string | null;
  status: WaMessageStatus;
  mimeType?: string | null;
  fileName?: string | null;
  mediaPath?: string | null;
  createdAt?: string;
}): Promise<WaMessage> {
  if (input.externalMessageId) {
    const existing = await findMessageByExternalId(input.externalMessageId);
    if (existing) return existing;
  }

  const id = randomUUID();
  const createdAt = input.createdAt ?? nowIso();
  const message: WaMessage = {
    id,
    conversationId: input.conversationId,
    contactId: input.contactId,
    direction: input.direction,
    type: input.type,
    text: input.text,
    externalMessageId: input.externalMessageId ?? null,
    status: input.status,
    mimeType: input.mimeType ?? null,
    fileName: input.fileName ?? null,
    mediaPath: input.mediaPath ?? null,
    mediaUrl: input.mediaPath ? `/api/whatsapp-crm/messages/${id}/media` : null,
    isDeleted: false,
    createdAt,
  };

  const { mediaUrl: _mediaUrl, ...toStore } = message;
  await setDoc(doc(firestore, MESSAGES, id), toStore);

  const unreadInc = input.direction === "INBOUND" ? 1 : 0;
  const convSnap = await getDoc(doc(firestore, CONVERSATIONS, input.conversationId));
  const prevUnread = Number(convSnap.data()?.unreadCount ?? 0) || 0;
  await updateDoc(doc(firestore, CONVERSATIONS, input.conversationId), {
    lastMessagePreview: input.text.slice(0, 200),
    lastMessageAt: createdAt,
    updatedAt: nowIso(),
    unreadCount: input.direction === "INBOUND" ? prevUnread + unreadInc : prevUnread,
  });

  return message;
}

export async function updateMessageStatusByExternalId(
  externalMessageId: string,
  status: WaMessageStatus,
): Promise<void> {
  const existing = await findMessageByExternalId(externalMessageId);
  if (!existing) return;
  await updateDoc(doc(firestore, MESSAGES, existing.id), { status });
}
