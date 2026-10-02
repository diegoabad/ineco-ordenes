import type { WaContact } from "../types/whatsappCrm";
import { waContactLabel } from "../types/whatsappCrm";

export type QuickReply = {
  id: string;
  trigger: string;
  title: string | null;
  body: string;
  tagIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QuickReplyVars = {
  nombre: string;
  apellido: string;
  nombre_completo: string;
  telefono: string;
  whatsapp: string;
  operadora: string;
};

export const QUICK_REPLY_VARIABLES: { key: keyof QuickReplyVars; label: string }[] = [
  { key: "nombre", label: "Nombre" },
  { key: "apellido", label: "Apellido" },
  { key: "nombre_completo", label: "Nombre completo" },
  { key: "telefono", label: "Teléfono" },
  { key: "whatsapp", label: "Nombre de WhatsApp" },
  { key: "operadora", label: "Operadora asignada" },
];

export const QUICK_REPLY_PREVIEW: QuickReplyVars = {
  nombre: "María",
  apellido: "García",
  nombre_completo: "María García",
  telefono: "5491123456789",
  whatsapp: "María G.",
  operadora: "Ana",
};

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

export function formatTrigger(value: string): string {
  const normalized = normalizeTrigger(value);
  return normalized ? `/${normalized}` : "";
}

export function extractSlashQuery(value: string): string | null {
  if (!value.startsWith("/")) return null;
  const match = value.match(/^\/([a-z0-9_]*)$/i);
  return match ? match[1]!.toLowerCase() : null;
}

export function quickReplyVars(
  contact?: WaContact | null,
  operadora?: string | null,
): QuickReplyVars {
  return {
    nombre:
      contact?.firstName?.trim() ||
      contact?.displayName?.trim() ||
      contact?.whatsappName?.trim() ||
      "",
    apellido: contact?.lastName?.trim() || "",
    nombre_completo: contact ? waContactLabel(contact) : "",
    telefono: contact?.phoneNumber ?? "",
    whatsapp: contact?.whatsappName?.trim() || "",
    operadora: operadora?.trim() || "",
  };
}

export function resolveQuickReply(body: string, variables: QuickReplyVars): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => {
    const normalized = key.toLowerCase() as keyof QuickReplyVars;
    return variables[normalized] ?? "";
  });
}
