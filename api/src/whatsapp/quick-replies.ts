import { randomUUID } from "node:crypto";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

export type QuickReply = {
  id: string;
  trigger: string;
  title: string | null;
  body: string;
  /** Etiquetas opcionales a asignar al usar la respuesta. */
  tagIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const REPLIES_DOC = doc(firestore, "ordenes_config", "whatsapp_quick_replies");

export function normalizeTrigger(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function normalizeTagIds(raw: unknown, legacyTagId?: unknown): string[] {
  const fromArray = Array.isArray(raw)
    ? raw.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
  const legacy = String(legacyTagId ?? "").trim();
  if (legacy) fromArray.push(legacy);
  return [...new Set(fromArray)];
}

function normalizeItem(raw: unknown): QuickReply | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const trigger = normalizeTrigger(String(row.trigger ?? ""));
  const body = String(row.body ?? "").trim();
  if (!id || !trigger || !body) return null;
  const title = row.title != null ? String(row.title).trim() : "";
  return {
    id,
    trigger,
    title: title || null,
    body,
    tagIds: normalizeTagIds(row.tagIds, row.tagId),
    isActive: row.isActive !== false,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

async function readAll(): Promise<QuickReply[]> {
  const snap = await getDoc(REPLIES_DOC);
  const raw = snap.exists() ? snap.data()?.items : [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeItem)
    .filter((item): item is QuickReply => item !== null)
    .sort((a, b) => a.trigger.localeCompare(b.trigger, "es"));
}

async function writeAll(items: QuickReply[]): Promise<void> {
  await setDoc(REPLIES_DOC, { items, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function listQuickReplies(): Promise<QuickReply[]> {
  return readAll();
}

export async function createQuickReply(input: {
  trigger: string;
  title?: string | null;
  body: string;
  tagIds?: string[] | null;
  isActive?: boolean;
}): Promise<QuickReply> {
  const trigger = normalizeTrigger(input.trigger);
  const body = String(input.body ?? "").trim();
  if (!trigger) throw new Error("Ingresá un disparador, por ejemplo /saludo");
  if (!body) throw new Error("El mensaje no puede estar vacío");
  const items = await readAll();
  if (items.some((item) => item.trigger === trigger)) {
    throw new Error("Ya existe una respuesta con ese disparador");
  }
  const now = new Date().toISOString();
  const created: QuickReply = {
    id: randomUUID(),
    trigger,
    title: input.title?.trim() || null,
    body,
    tagIds: normalizeTagIds(input.tagIds),
    isActive: input.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  await writeAll([...items, created]);
  return created;
}

export async function updateQuickReply(
  id: string,
  input: {
    trigger?: string;
    title?: string | null;
    body?: string;
    tagIds?: string[] | null;
    isActive?: boolean;
  },
): Promise<QuickReply> {
  const items = await readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Respuesta no encontrada");
  const current = items[index]!;
  const trigger =
    input.trigger !== undefined ? normalizeTrigger(input.trigger) : current.trigger;
  const body = input.body !== undefined ? input.body.trim() : current.body;
  if (!trigger) throw new Error("Ingresá un disparador, por ejemplo /saludo");
  if (!body) throw new Error("El mensaje no puede estar vacío");
  if (items.some((item) => item.id !== id && item.trigger === trigger)) {
    throw new Error("Ya existe una respuesta con ese disparador");
  }
  const next: QuickReply = {
    ...current,
    trigger,
    title: input.title !== undefined ? input.title?.trim() || null : current.title,
    body,
    tagIds: input.tagIds !== undefined ? normalizeTagIds(input.tagIds) : current.tagIds,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : current.isActive,
    updatedAt: new Date().toISOString(),
  };
  const copy = [...items];
  copy[index] = next;
  await writeAll(copy);
  return next;
}

export async function deleteQuickReply(id: string): Promise<void> {
  const items = await readAll();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) throw new Error("Respuesta no encontrada");
  await writeAll(next);
}
