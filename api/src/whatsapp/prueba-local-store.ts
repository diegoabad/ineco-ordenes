/**
 * Pruebas WhatsApp en disco/memoria cuando Firestore no tiene cuota.
 * Persisten en api/data/whatsapp-pruebas-local.json para no perderse al reiniciar.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { API_ROOT } from "../config/paths.js";
import type {
  MenuEstado,
  WaContact,
  WaConversation,
  WaMessage,
  WaMessageDirection,
  WaMessageStatus,
  WaMessageType,
} from "./types.js";

type LocalBundle = {
  conversation: WaConversation;
  contact: WaContact;
  messages: WaMessage[];
};

const store = new Map<string, LocalBundle>();
/** Tags locales (sin catálogo Firebase): id estable por nombre. */
const localTagIds = new Map<string, string>();
/** Rango propio (99xxxxxx) para no chocar con el seq de Firebase (p. ej. 00009001). */
const LOCAL_PHONE_BASE = 99_000_000;
let seqLocal = 0;

const DATA_DIR = path.join(API_ROOT, "data");
const PERSIST_FILE = path.join(DATA_DIR, "whatsapp-pruebas-local.json");

function nowIso(): string {
  return new Date().toISOString();
}

function persist(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      seqLocal,
      tags: [...localTagIds.entries()],
      bundles: [...store.entries()].map(([id, b]) => ({
        id,
        conversation: b.conversation,
        contact: b.contact,
        messages: b.messages,
      })),
    };
    writeFileSync(PERSIST_FILE, JSON.stringify(payload), "utf8");
  } catch (error) {
    console.warn(
      "[whatsapp] no se pudo persistir pruebas locales",
      error instanceof Error ? error.message : error,
    );
  }
}

function isoFechaNacimiento(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!dmy) return null;
  return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
}

/** Si el pedido ya tiene fecha y la ficha no, copiarla (recupera pruebas viejas). */
function backfillFechaDesdePedido(contact: WaContact, conversation: WaConversation): WaContact {
  if ((contact.fechaNacimiento ?? "").trim()) return contact;
  const iso = isoFechaNacimiento(conversation.menuEstado?.fechaNacimiento);
  if (!iso) return contact;
  return { ...contact, fechaNacimiento: iso, updatedAt: nowIso() };
}

function hydrate(): void {
  try {
    if (!existsSync(PERSIST_FILE)) return;
    const raw = JSON.parse(readFileSync(PERSIST_FILE, "utf8")) as {
      seqLocal?: unknown;
      tags?: [string, string][];
      bundles?: {
        id?: string;
        conversation?: WaConversation;
        contact?: WaContact;
        messages?: WaMessage[];
      }[];
    };
    if (typeof raw.seqLocal === "number" && raw.seqLocal >= 0) seqLocal = raw.seqLocal;
    if (Array.isArray(raw.tags)) {
      for (const [name, id] of raw.tags) {
        if (name && id) localTagIds.set(String(name), String(id));
      }
    }
    if (!Array.isArray(raw.bundles)) return;
    let reparados = 0;
    for (const row of raw.bundles) {
      const id = String(row.id ?? row.conversation?.id ?? "").trim();
      if (!id || !row.conversation || !row.contact) continue;
      const contact = backfillFechaDesdePedido(row.contact, row.conversation);
      if (contact.fechaNacimiento && contact.fechaNacimiento !== row.contact.fechaNacimiento) {
        reparados += 1;
      }
      const conversation = { ...row.conversation, contact };
      store.set(id, {
        conversation,
        contact,
        messages: Array.isArray(row.messages) ? row.messages : [],
      });
    }
    if (reparados > 0) persist();
    if (store.size) {
      console.info(
        `[whatsapp] pruebas locales restauradas: ${store.size}` +
          (reparados ? ` (fecha nacimiento en ficha: ${reparados})` : ""),
      );
    }
  } catch (error) {
    console.warn(
      "[whatsapp] no se pudo leer pruebas locales",
      error instanceof Error ? error.message : error,
    );
  }
}

hydrate();

export function isQuotaError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return /RESOURCE_EXHAUSTED|Quota exceeded|resource-exhausted/i.test(raw + " " + code);
}

export function isLocalPruebaId(id: string): boolean {
  return id.startsWith("local-") || store.has(id);
}

export function getLocalBundle(id: string): LocalBundle | null {
  return store.get(id) ?? null;
}

export function getLocalContact(id: string): WaContact | null {
  for (const bundle of store.values()) {
    if (bundle.contact.id === id) return { ...bundle.contact };
  }
  return null;
}

export function patchLocalContact(id: string, patch: Partial<WaContact>): WaContact | null {
  for (const bundle of store.values()) {
    if (bundle.contact.id !== id) continue;
    bundle.contact = { ...bundle.contact, ...patch, updatedAt: nowIso() };
    bundle.conversation.contact = bundle.contact;
    persist();
    return { ...bundle.contact };
  }
  return null;
}

export function getLocalConversation(id: string): WaConversation | null {
  const bundle = store.get(id);
  if (!bundle) return null;
  return { ...bundle.conversation, contact: { ...bundle.contact } };
}

export function listLocalPruebas(motor?: "ia" | "menu"): WaConversation[] {
  const items = [...store.values()]
    .map((b) => ({ ...b.conversation, contact: { ...b.contact } }))
    .filter((c) => c.prueba);
  const filtrados =
    motor === "menu" || motor === "ia"
      ? items.filter((c) => (c.pruebaMotor === "menu" ? "menu" : "ia") === motor)
      : items;
  return filtrados.sort((a, b) => {
    const ta = Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || "") || 0;
    const tb = Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || "") || 0;
    return tb - ta;
  });
}

/** Borra todas las pruebas en memoria/disco y reinicia el seq local. */
export function clearAllLocalPruebas(): number {
  const n = store.size;
  store.clear();
  seqLocal = 0;
  persist();
  return n;
}

function nextLocalPhone(): string {
  const usados = new Set([...store.values()].map((b) => b.contact.phoneNumber));
  for (;;) {
    seqLocal += 1;
    const phone = String(LOCAL_PHONE_BASE + seqLocal);
    if (!usados.has(phone)) return phone;
  }
}

export function createLocalPruebaConversation(
  creador?: { id?: string | null; nombre?: string | null },
  motor: "ia" | "menu" = "ia",
): WaConversation {
  const phone = nextLocalPhone();
  const now = nowIso();
  const contactId = `local-c-${randomUUID()}`;
  const conversationId = `local-${randomUUID()}`;
  const contact: WaContact = {
    id: contactId,
    phoneNumber: phone,
    firstName: null,
    lastName: null,
    displayName: null,
    whatsappName: null,
    cobertura: null,
    email: null,
    fechaNacimiento: null,
    grupoEtario: null,
    consultaPara: null,
    contactoNombre: null,
    contactoApellido: null,
    relacionFamiliar: null,
    dni: null,
    sexo: null,
    esPaciente: null,
    isBlocked: false,
    lastInteractionAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const conversation: WaConversation = {
    id: conversationId,
    contactId,
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: now,
    assigneeKind: "bot",
    assigneeUserId: null,
    assigneeName: "Bot",
    tagIds: [],
    resolutionStatus: "open",
    resolvedAt: null,
    resolvedByKind: null,
    resolvedByUserId: null,
    resolvedByName: null,
    botPausedUntilInbound: false,
    resoluciones: [],
    motivoConsulta: null,
    diagnosticoIa: null,
    diagnosticoIaAt: null,
    diagnosticoHumano: null,
    diagnosticoHumanoByUserId: null,
    diagnosticoHumanoByName: null,
    diagnosticoHumanoAt: null,
    resumen: null,
    intencionAbierta: null,
    intencionConcluida: false,
    intencionPropuesta: null,
    intencionCola: [],
    advertenciasFuera: 0,
    derivacionPendiente: false,
    temasAnotados: [],
    casos: [],
    casoActivoId: null,
    datoPedido: null,
    historialDatos: [],
    pilaTemas: [],
    ultimoResultado: null,
    pausa: null,
    prueba: true,
    pruebaMotor: motor,
    menuPaso: null,
    menuEstado: null,
    pruebaResultado: null,
    pruebaNota: null,
    pruebaNotaEn: null,
    pruebaAclaraciones: [],
    pruebaCreadorId: creador?.id?.trim() || null,
    pruebaCreadorNombre: (creador?.nombre?.trim() || "Local") + " · sin Firebase",
    auditoria: [],
    createdAt: now,
    updatedAt: now,
    contact,
  };
  store.set(conversationId, { conversation, contact, messages: [] });
  persist();
  return { ...conversation, contact: { ...contact } };
}

export function setLocalConversationPatch(
  id: string,
  patch: Partial<WaConversation>,
): WaConversation | null {
  const bundle = store.get(id);
  if (!bundle) return null;
  bundle.conversation = {
    ...bundle.conversation,
    ...patch,
    updatedAt: nowIso(),
  };
  // Mantener contact embebido al día.
  if (patch.contact) bundle.contact = { ...bundle.contact, ...patch.contact };
  bundle.conversation.contact = bundle.contact;
  persist();
  return { ...bundle.conversation, contact: { ...bundle.contact } };
}

export function setLocalMenu(id: string, estado: MenuEstado): void {
  setLocalConversationPatch(id, { menuPaso: estado.paso, menuEstado: estado });
}

export function listLocalMessages(conversationId: string, max = 100): WaMessage[] {
  const bundle = store.get(conversationId);
  if (!bundle) return [];
  return bundle.messages.slice(-Math.min(Math.max(max, 1), 500));
}

export function createLocalMessage(input: {
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
}): WaMessage | null {
  const bundle = store.get(input.conversationId);
  if (!bundle) return null;
  if (input.externalMessageId) {
    const existing = bundle.messages.find((m) => m.externalMessageId === input.externalMessageId);
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
    mediaUrl: null,
    isDeleted: false,
    createdAt,
  };
  bundle.messages.push(message);
  bundle.conversation.lastMessagePreview = input.text.slice(0, 200);
  bundle.conversation.lastMessageAt = createdAt;
  bundle.conversation.updatedAt = createdAt;
  bundle.conversation.unreadCount = 0;
  persist();
  return message;
}

export function localTagIdForName(nombre: string): string {
  const key = nombre.trim().toLowerCase();
  let id = localTagIds.get(key);
  if (!id) {
    id = `local-tag-${randomUUID()}`;
    localTagIds.set(key, id);
    persist();
  }
  return id;
}

/** Para que el CRM resuelva nombres de tags sintéticos de pruebas en memoria. */
export function listLocalSyntheticTags(): { id: string; name: string }[] {
  return [...localTagIds.entries()].map(([name, id]) => ({ id, name }));
}
