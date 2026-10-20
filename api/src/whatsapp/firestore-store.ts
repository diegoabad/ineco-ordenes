import { randomUUID } from "node:crypto";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import { documentoDePersona } from "./estado-dialogo.js";
import type {
  MenuEstado,
  MenuPaso,
  WaContact,
  WaContactConsultaPara,
  WaContactGrupoEtario,
  WaContactSexo,
  WaConversation,
  WaConversationStatus,
  WaAuditoriaPaso,
  WaMessage,
  WaMessageDirection,
  WaMessageStatus,
  WaMessageType,
} from "./types.js";
import {
  normalizarCasos,
  normalizarHistorial,
  normalizarPausa,
  normalizarPila,
  normalizarResultado,
  type WaFichaCaso,
} from "./estado-dialogo.js";

const CONTACTS = "whatsapp_contacts";
const CONVERSATIONS = "whatsapp_conversations";
const MESSAGES = "whatsapp_messages";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeGrupoEtario(raw: unknown): WaContactGrupoEtario | null {
  return raw === "infanto" || raw === "adulto" ? raw : null;
}

function normalizeConsultaPara(raw: unknown): WaContactConsultaPara | null {
  return raw === "propio" || raw === "tercero" ? raw : null;
}

function normalizeSexo(raw: unknown): WaContactSexo | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return value === "masculino" || value === "femenino" ? value : null;
}

function normalizeContact(id: string, raw: Record<string, unknown>): WaContact {
  return {
    id,
    phoneNumber: String(raw.phoneNumber ?? ""),
    firstName: raw.firstName != null ? String(raw.firstName) : null,
    lastName: raw.lastName != null ? String(raw.lastName) : null,
    displayName: raw.displayName != null ? String(raw.displayName) : null,
    whatsappName: raw.whatsappName != null ? String(raw.whatsappName) : null,
    cobertura: raw.cobertura != null ? String(raw.cobertura).trim() || null : null,
    email: raw.email != null ? String(raw.email).trim() || null : null,
    grupoEtario: normalizeGrupoEtario(raw.grupoEtario),
    consultaPara: normalizeConsultaPara(raw.consultaPara),
    contactoNombre: (() => {
      const next =
        raw.contactoNombre != null ? String(raw.contactoNombre).trim() : "";
      if (next) return next;
      const legacy =
        raw.terceroNombre != null ? String(raw.terceroNombre).trim() : "";
      return legacy || null;
    })(),
    contactoApellido:
      raw.contactoApellido != null ? String(raw.contactoApellido).trim() || null : null,
    relacionFamiliar:
      raw.relacionFamiliar != null ? String(raw.relacionFamiliar).trim() || null : null,
    dni: raw.dni != null ? String(raw.dni).trim() || null : null,
    sexo: normalizeSexo(raw.sexo),
    esPaciente:
      raw.esPaciente === true ? true : raw.esPaciente === false ? false : null,
    isBlocked: raw.isBlocked === true,
    lastInteractionAt: raw.lastInteractionAt != null ? String(raw.lastInteractionAt) : null,
    createdAt: String(raw.createdAt ?? nowIso()),
    updatedAt: String(raw.updatedAt ?? nowIso()),
  };
}

function menuPasoDe(raw: unknown): MenuPaso | null {
  const paso = String(raw ?? "");
  const validos: MenuPaso[] = [
    "sede",
    "menu",
    "turnos",
    "info",
    "infoTema",
    "queja",
    "dni",
    "nombre",
    "apellido",
    "sexo",
    "email",
    "profesional",
    "tratamiento",
    "horarios",
    "elegirTurno",
    "confirmar",
  ];
  return validos.includes(paso as MenuPaso) ? (paso as MenuPaso) : null;
}

function normalizarMenuEstado(raw: unknown, pasoRaw: unknown): MenuEstado | null {
  const paso = menuPasoDe(
    raw && typeof raw === "object" ? (raw as { paso?: unknown }).paso : pasoRaw,
  );
  if (!paso) return null;
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sexo = row.sexo === "femenino" || row.sexo === "masculino" ? row.sexo : "";
  const modos = [
    "sacar",
    "ver",
    "cancelar",
    "cambiar",
    "sucursales",
    "coberturas",
    "profesionales",
    "tratamientos",
    "institucion",
    "queja",
  ];
  const modo = modos.includes(String(row.modo)) ? (row.modo as MenuEstado["modo"]) : "";
  const esPaciente = row.esPaciente === "si" || row.esPaciente === "no" ? row.esPaciente : "";
  const pila = Array.isArray(row.pila)
    ? row.pila.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const fila = item as { paso?: unknown; opciones?: unknown };
        const pasoPila = menuPasoDe(fila.paso);
        if (!pasoPila) return [];
        return [
          {
            paso: pasoPila,
            opciones: Array.isArray(fila.opciones)
              ? fila.opciones.map((opcion) => String(opcion ?? "").trim()).filter(Boolean).slice(0, 20)
              : [],
          },
        ];
      }).slice(-8)
    : [];
  return {
    paso,
    modo,
    dni: documentoDePersona(String(row.dni ?? "")) || String(row.dni ?? "").replace(/[\s.\-_/]/g, "").toUpperCase().slice(0, 15),
    nombre: String(row.nombre ?? "").trim().slice(0, 80),
    apellido: String(row.apellido ?? "").trim().slice(0, 80),
    sexo,
    email: String(row.email ?? "").trim().slice(0, 120),
    esPaciente,
    profesional: String(row.profesional ?? "").trim().slice(0, 120),
    tratamiento: String(row.tratamiento ?? "").trim().slice(0, 160),
    pendiente: String(row.pendiente ?? "").trim().slice(0, 500),
    opciones: Array.isArray(row.opciones)
      ? row.opciones.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 20)
      : [],
    horarios: String(row.horarios ?? "").slice(0, 4000),
    hastaDia: Number(row.hastaDia ?? 0) || 0,
    busqueda: String(row.busqueda ?? "").slice(0, 80),
    anularLuego: String(row.anularLuego ?? "").slice(0, 400),
    pila,
  };
}

function normalizeAuditoria(raw: unknown): WaAuditoriaPaso[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const cortesia = row.cortesia === "saludo" || row.cortesia === "cierre" ? row.cortesia : "";
    return [
      {
        en: String(row.en ?? ""),
        intencion: String(row.intencion ?? "").trim(),
        secundaria: String(row.secundaria ?? "").trim(),
        abierta: String(row.abierta ?? "").trim(),
        concluida: row.concluida === true,
        peligro: row.peligro === true,
        duda: row.duda === true,
        cortesia,
        hecho: String(row.hecho ?? "").trim(),
        resumen: String(row.resumen ?? "").trim(),
        etiquetas: Array.isArray(row.etiquetas)
          ? row.etiquetas.map((name) => String(name).trim()).filter(Boolean)
          : [],
      },
    ];
  });
}

function normalizePruebaAclaraciones(value: unknown): { messageId: string; texto: string }[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: { messageId: string; texto: string }[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const messageId = String((row as { messageId?: unknown }).messageId ?? "").trim();
    const texto = String((row as { texto?: unknown }).texto ?? "").trim();
    if (!messageId || !texto || seen.has(messageId)) continue;
    seen.add(messageId);
    items.push({ messageId, texto: texto.slice(0, 2000) });
  }
  return items;
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
    resumen: raw.resumen != null ? String(raw.resumen).trim() || null : null,
    intencionAbierta: raw.intencionAbierta != null ? String(raw.intencionAbierta).trim() || null : null,
    intencionConcluida: raw.intencionConcluida === true,
    intencionPropuesta:
      raw.intencionPropuesta != null ? String(raw.intencionPropuesta).trim() || null : null,
    intencionCola: Array.isArray(raw.intencionCola)
      ? raw.intencionCola.map((clave) => String(clave ?? "").trim()).filter(Boolean).slice(0, 6)
      : [],
    advertenciasFuera: Number(raw.advertenciasFuera ?? 0) || 0,
    derivacionPendiente: raw.derivacionPendiente === true,
    temasAnotados: Array.isArray(raw.temasAnotados)
      ? raw.temasAnotados.map((tema) => String(tema ?? "").trim()).filter(Boolean).slice(0, 8)
      : [],
    casos: normalizarCasos(raw.casos),
    casoActivoId: raw.casoActivoId != null ? String(raw.casoActivoId).trim() || null : null,
    datoPedido: raw.datoPedido != null ? String(raw.datoPedido).trim() || null : null,
    historialDatos: normalizarHistorial(raw.historialDatos),
    pilaTemas: normalizarPila(raw.pilaTemas),
    ultimoResultado: normalizarResultado(raw.ultimoResultado),
    pausa: normalizarPausa(raw.pausa),
    prueba: raw.prueba === true,
    pruebaMotor: raw.pruebaMotor === "menu" ? "menu" : "ia",
    menuPaso: menuPasoDe(raw.menuPaso),
    menuEstado: normalizarMenuEstado(raw.menuEstado, raw.menuPaso),
    pruebaResultado:
      raw.pruebaResultado === "correcta" || raw.pruebaResultado === "incorrecta"
        ? raw.pruebaResultado
        : raw.pruebaNota
          ? "incorrecta"
          : null,
    pruebaNota: raw.pruebaNota != null ? String(raw.pruebaNota).trim() || null : null,
    pruebaNotaEn: raw.pruebaNotaEn != null ? String(raw.pruebaNotaEn) : null,
    pruebaAclaraciones: normalizePruebaAclaraciones(raw.pruebaAclaraciones),
    pruebaCreadorId: raw.pruebaCreadorId != null ? String(raw.pruebaCreadorId).trim() || null : null,
    pruebaCreadorNombre:
      raw.pruebaCreadorNombre != null ? String(raw.pruebaCreadorNombre).trim() || null : null,
    auditoria: normalizeAuditoria(raw.auditoria),
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

export async function updateContact(
  id: string,
  input: {
    firstName: string;
    lastName: string;
    cobertura?: string;
    email?: string;
    grupoEtario?: string | null;
    consultaPara?: string | null;
    contactoNombre?: string | null;
    contactoApellido?: string | null;
    relacionFamiliar?: string | null;
    dni?: string | null;
    sexo?: string | null;
    esPaciente?: boolean | null;
  },
): Promise<WaContact | null> {
  const existing = await getContact(id);
  if (!existing) return null;
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName) {
    throw new Error("El nombre del paciente es obligatorio");
  }
  const cobertura =
    input.cobertura !== undefined
      ? input.cobertura.trim() || null
      : existing.cobertura;
  const emailRaw =
    input.email !== undefined ? input.email.trim() : existing.email ?? "";
  const email = emailRaw || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("El email no es válido");
  }
  const grupoEtario =
    input.grupoEtario !== undefined
      ? normalizeGrupoEtario(input.grupoEtario)
      : existing.grupoEtario;
  const consultaPara =
    input.consultaPara !== undefined
      ? normalizeConsultaPara(input.consultaPara)
      : existing.consultaPara;
  if (input.grupoEtario !== undefined && input.grupoEtario && !grupoEtario) {
    throw new Error("Indicá si es Infanto o Adulto");
  }
  if (input.consultaPara !== undefined && input.consultaPara && !consultaPara) {
    throw new Error("Indicá si la consulta es para el paciente o para un tercero");
  }
  let relacionFamiliar =
    input.relacionFamiliar !== undefined
      ? input.relacionFamiliar?.trim() || null
      : existing.relacionFamiliar;
  let contactoNombre =
    input.contactoNombre !== undefined
      ? input.contactoNombre?.trim() || null
      : existing.contactoNombre;
  let contactoApellido =
    input.contactoApellido !== undefined
      ? input.contactoApellido?.trim() || null
      : existing.contactoApellido;
  if (consultaPara !== "tercero") {
    relacionFamiliar = null;
    contactoNombre = null;
    contactoApellido = null;
  } else {
    if (!relacionFamiliar) {
      throw new Error("Indicá la relación familiar con el paciente");
    }
    if (!contactoNombre) {
      throw new Error("Indicá el nombre de quien escribe (el contacto)");
    }
  }
  const dni =
    input.dni !== undefined ? input.dni?.replace(/\D/g, "").trim() || null : existing.dni;
  const sexo = input.sexo !== undefined ? normalizeSexo(input.sexo) : existing.sexo;
  if (input.sexo && !sexo) {
    throw new Error("Indicá si el sexo es masculino o femenino");
  }
  const esPaciente =
    input.esPaciente !== undefined
      ? input.esPaciente === true
        ? true
        : input.esPaciente === false
          ? false
          : null
      : existing.esPaciente;
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const now = nowIso();
  await updateDoc(doc(firestore, CONTACTS, id), {
    firstName,
    lastName: lastName || null,
    displayName,
    cobertura,
    email,
    grupoEtario,
    consultaPara,
    relacionFamiliar,
    contactoNombre,
    contactoApellido,
    terceroNombre: null,
    dni,
    sexo,
    esPaciente,
    updatedAt: now,
  });
  return {
    ...existing,
    firstName,
    lastName: lastName || null,
    displayName,
    phoneNumber: existing.phoneNumber,
    cobertura,
    email,
    grupoEtario,
    consultaPara,
    relacionFamiliar,
    contactoNombre,
    contactoApellido,
    dni,
    sexo,
    esPaciente,
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
    cobertura: null,
    email: null,
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

  // Si había una cerrada, reabrirla para no duplicar el hilo.
  const byContact = query(
    collection(firestore, CONVERSATIONS),
    where("contactId", "==", contactId),
  );
  const snap = await getDocs(byContact);
  if (!snap.empty) {
    const latest = snap.docs
      .map((d) => normalizeConversation(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => {
        const aAt = a.lastMessageAt || a.updatedAt || a.createdAt;
        const bAt = b.lastMessageAt || b.updatedAt || b.createdAt;
        return bAt.localeCompare(aAt);
      })[0];
    if (latest) {
      const reopened = await setConversationStatus(latest.id, "OPEN");
      if (reopened) return reopened;
    }
  }

  const now = nowIso();
  const id = randomUUID();
  const conversation: WaConversation = {
    id,
    contactId,
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    assigneeKind: "none",
    assigneeUserId: null,
    assigneeName: null,
    tagIds: [],
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
    prueba: false,
    pruebaMotor: "ia",
    menuPaso: null,
    menuEstado: null,
    pruebaResultado: null,
    pruebaNota: null,
    pruebaNotaEn: null,
    pruebaAclaraciones: [],
    auditoria: [],
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(firestore, CONVERSATIONS, id), conversation);
  return conversation;
}

function numeroFicticio(n: number): string {
  if (n >= 1 && n <= 9) return String(n).repeat(8);
  return String(n).padStart(8, "0");
}

export async function createPruebaConversation(
  creador?: {
    id?: string | null;
    nombre?: string | null;
  },
  motor: "ia" | "menu" = "ia",
): Promise<WaConversation> {
  const seqRef = doc(firestore, "ordenes_config", "whatsapp_prueba_seq");
  const seq = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(seqRef);
    const current = Number(snap.data()?.next ?? 0);
    const next = Number.isFinite(current) && current >= 1 ? current + 1 : 1;
    tx.set(seqRef, { next, updatedAt: nowIso() }, { merge: true });
    return next;
  });
  const phone = numeroFicticio(seq);
  const existing = await findContactByPhone(phone);
  const now = nowIso();
  const limpio = {
    firstName: null,
    lastName: null,
    displayName: null,
    cobertura: null,
    email: null,
    grupoEtario: null,
    consultaPara: null,
    contactoNombre: null,
    contactoApellido: null,
    relacionFamiliar: null,
    dni: null,
    sexo: null,
    esPaciente: null,
    lastInteractionAt: now,
    updatedAt: now,
  };
  const batch = writeBatch(firestore);
  let contact: WaContact;
  if (existing) {
    batch.update(doc(firestore, CONTACTS, existing.id), limpio);
    contact = { ...existing, ...limpio };
  } else {
    contact = {
      id: randomUUID(),
      phoneNumber: phone,
      firstName: null,
      lastName: null,
      displayName: null,
      whatsappName: null,
      cobertura: null,
      email: null,
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
    batch.set(doc(firestore, CONTACTS, contact.id), contact);
  }
  const id = randomUUID();
  const conversation: WaConversation = {
    id,
    contactId: contact.id,
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
    assigneeKind: "bot",
    assigneeUserId: null,
    assigneeName: "Bot",
    tagIds: [],
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
    pruebaCreadorNombre: creador?.nombre?.trim() || null,
    auditoria: [],
    createdAt: now,
    updatedAt: now,
  };
  batch.set(doc(firestore, CONVERSATIONS, id), conversation);
  await batch.commit();
  return { ...conversation, contact };
}

export async function listConversacionesMetricas(
  desde: string,
  hasta: string,
): Promise<
  {
    tagIds: string[];
    assigneeKind: "none" | "bot" | "user";
    assigneeUserId: string | null;
    assigneeName: string | null;
  }[]
> {
  const from = Date.parse(`${desde}T00:00:00-03:00`);
  const to = Date.parse(`${hasta}T23:59:59.999-03:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error("Elegí un rango de fechas válido");
  }
  const snap = await getDocs(collection(firestore, CONVERSATIONS));
  const filas: {
    tagIds: string[];
    assigneeKind: "none" | "bot" | "user";
    assigneeUserId: string | null;
    assigneeName: string | null;
  }[] = [];
  for (const item of snap.docs) {
    const raw = item.data();
    if (raw.prueba === true) continue;
    const cuando = Date.parse(String(raw.lastMessageAt || raw.createdAt || ""));
    if (!Number.isFinite(cuando) || cuando < from || cuando > to) continue;
    const assigneeKind =
      raw.assigneeKind === "bot" || raw.assigneeKind === "user" ? raw.assigneeKind : "none";
    filas.push({
      tagIds: Array.isArray(raw.tagIds)
        ? [...new Set(raw.tagIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
        : [],
      assigneeKind,
      assigneeUserId: raw.assigneeUserId != null ? String(raw.assigneeUserId) : null,
      assigneeName: raw.assigneeName != null ? String(raw.assigneeName).trim() || null : null,
    });
  }
  return filas;
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
  assignee?: string;
  tagIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  prueba?: boolean;
  pruebaMotor?: "ia" | "menu";
}): Promise<ConversationListResult> {
  const status = opts?.status?.trim() || "OPEN";
  const pageSize = Math.min(Math.max(Number(opts?.limit ?? 40) || 40, 1), 100);
  const offset = Math.max(Number(opts?.offset ?? 0) || 0, 0);
  const q = query(collection(firestore, CONVERSATIONS), where("status", "==", status));
  const snap = await getDocs(q);
  let items = snap.docs.map((d) => normalizeConversation(d.id, d.data() as Record<string, unknown>));
  const onlyPrueba = opts?.prueba === true;
  items = items.filter((item) => item.prueba === onlyPrueba);
  if (onlyPrueba) {
    const motor = opts?.pruebaMotor === "menu" ? "menu" : "ia";
    items = items.filter((item) => (item.pruebaMotor === "menu" ? "menu" : "ia") === motor);
  }
  items.sort((a, b) => {
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return tb - ta;
  });

  const assignee = opts?.assignee?.trim() || "";
  if (assignee === "none") {
    items = items.filter((c) => {
      const kind = c.assigneeKind || "none";
      return kind === "none" || (!c.assigneeUserId && kind !== "bot" && kind !== "user");
    });
  } else if (assignee === "bot") {
    items = items.filter((c) => (c.assigneeKind || "") === "bot");
  } else if (assignee) {
    items = items.filter(
      (c) => (c.assigneeKind || "") === "user" && String(c.assigneeUserId ?? "") === assignee,
    );
  }

  const tagIds = (opts?.tagIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (tagIds.length > 0) {
    const wanted = new Set(tagIds);
    items = items.filter((c) => (c.tagIds ?? []).some((id) => wanted.has(id)));
  }

  const dateFrom = opts?.dateFrom?.trim() || "";
  const dateTo = opts?.dateTo?.trim() || "";
  if (dateFrom || dateTo) {
    const fromMs = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : Number.NEGATIVE_INFINITY;
    const toMs = dateTo ? Date.parse(`${dateTo}T23:59:59.999`) : Number.POSITIVE_INFINITY;
    items = items.filter((c) => {
      if (!c.lastMessageAt) return false;
      const t = Date.parse(c.lastMessageAt);
      return Number.isFinite(t) && t >= fromMs && t <= toMs;
    });
  }

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
        c.contact?.cobertura,
        c.contact?.email,
        c.contact?.dni,
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

export async function setConversationStatus(
  id: string,
  status: WaConversationStatus,
): Promise<WaConversation | null> {
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  const now = nowIso();
  const patch = { status, updatedAt: now };
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

const RELACIONES = new Set([
  "Padre",
  "Madre",
  "Abuelo",
  "Abuela",
  "Hijo",
  "Hija",
  "Tío",
  "Tía",
  "Sobrino",
  "Sobrina",
  "Esposo",
  "Esposa",
  "Pareja",
  "Novio",
  "Novia",
  "Tutor",
  "Otro",
]);

function matchRelacion(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  for (const option of RELACIONES) {
    if (option.toLowerCase() === text.toLowerCase()) return option;
  }
  return null;
}

export type DatosVaciosContacto = {
  consultaPara?: "propio" | "tercero" | "";
  relacionFamiliar?: string;
  pacienteNombre?: string;
  pacienteApellido?: string;
  contactoNombre?: string;
  contactoApellido?: string;
  grupoEtario?: "infanto" | "adulto" | "";
  cobertura?: string;
  esPaciente?: "si" | "no" | "";
  dni?: string;
  sexo?: "masculino" | "femenino" | "";
  email?: string;
};

/** Completa vacíos y pisa un dato cuando el mensaje trae otro valor. */
export function datosVaciosParaContacto(
  existing: WaContact,
  input: DatosVaciosContacto,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const consulta = normalizeConsultaPara(input.consultaPara);
  const nextConsulta = consulta || existing.consultaPara;
  if (consulta && consulta !== existing.consultaPara) patch.consultaPara = consulta;

  if (nextConsulta === "tercero") {
    const relacion = matchRelacion(input.relacionFamiliar ?? "");
    if (relacion && relacion !== (existing.relacionFamiliar ?? "")) patch.relacionFamiliar = relacion;
    const contactoNombre = input.contactoNombre?.trim() ?? "";
    const contactoApellido = input.contactoApellido?.trim() ?? "";
    if (contactoNombre && contactoNombre !== (existing.contactoNombre ?? "").trim()) {
      patch.contactoNombre = contactoNombre;
    }
    if (contactoApellido && contactoApellido !== (existing.contactoApellido ?? "").trim()) {
      patch.contactoApellido = contactoApellido;
    }
  }

  const pacienteNombre = input.pacienteNombre?.trim() ?? "";
  const pacienteApellido = input.pacienteApellido?.trim() ?? "";
  if (pacienteNombre && pacienteNombre !== (existing.firstName ?? "").trim()) patch.firstName = pacienteNombre;
  if (pacienteApellido && pacienteApellido !== (existing.lastName ?? "").trim()) {
    patch.lastName = pacienteApellido;
  }
  if (patch.firstName || patch.lastName) {
    const first = String(patch.firstName ?? existing.firstName ?? "");
    const last = String(patch.lastName ?? existing.lastName ?? "");
    patch.displayName = [first, last].filter(Boolean).join(" ");
  }

  const grupo = normalizeGrupoEtario(input.grupoEtario);
  if (grupo && grupo !== existing.grupoEtario) patch.grupoEtario = grupo;
  const cobertura = input.cobertura?.trim() ?? "";
  if (cobertura && cobertura !== (existing.cobertura ?? "").trim()) patch.cobertura = cobertura;
  if (existing.esPaciente == null && input.esPaciente === "si") patch.esPaciente = true;
  if (existing.esPaciente == null && input.esPaciente === "no") patch.esPaciente = false;
  const dni = documentoDePersona(input.dni ?? "");
  if (dni && dni !== (existing.dni ?? "").replace(/[\s.\-_/]/g, "").toUpperCase()) patch.dni = dni;
  const sexo = normalizeSexo(input.sexo);
  if (sexo && sexo !== existing.sexo) patch.sexo = sexo;
  const email = input.email?.trim() ?? "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email !== (existing.email ?? "").trim()) patch.email = email;
  return patch;
}

/** Completa vacíos y pisa un dato cuando el mensaje trae otro valor. */
export async function fillEmptyContactFields(
  id: string,
  input: DatosVaciosContacto,
): Promise<WaContact | null> {
  const existing = await getContact(id);
  if (!existing) return null;
  const patch = datosVaciosParaContacto(existing, input);
  if (Object.keys(patch).length === 0) return existing;
  patch.updatedAt = nowIso();
  await updateDoc(doc(firestore, CONTACTS, id), patch as { [key: string]: string | boolean | null });
  return getContact(id);
}

export async function setConversationIntencion(
  id: string,
  input: {
    intencionAbierta: string | null;
    intencionConcluida: boolean;
    intencionPropuesta: string | null;
    intencionCola?: string[];
    advertenciasFuera?: number;
    derivacionPendiente?: boolean;
    temasAnotados?: string[];
    casos?: WaConversation["casos"];
    casoActivoId?: string | null;
    datoPedido?: string | null;
    historialDatos?: WaConversation["historialDatos"];
    pilaTemas?: WaConversation["pilaTemas"];
    ultimoResultado?: WaConversation["ultimoResultado"];
    pausa?: WaConversation["pausa"];
  },
): Promise<void> {
  await updateDoc(doc(firestore, CONVERSATIONS, id), {
    intencionAbierta: input.intencionAbierta,
    intencionConcluida: input.intencionConcluida,
    intencionPropuesta: input.intencionPropuesta,
    intencionCola: (input.intencionCola ?? []).slice(0, 6),
    advertenciasFuera: input.advertenciasFuera ?? 0,
    derivacionPendiente: input.derivacionPendiente === true,
    temasAnotados: (input.temasAnotados ?? []).slice(0, 8),
    casos: normalizarCasos(input.casos),
    casoActivoId: input.casoActivoId ?? null,
    datoPedido: input.datoPedido ?? null,
    historialDatos: normalizarHistorial(input.historialDatos),
    pilaTemas: normalizarPila(input.pilaTemas),
    ultimoResultado: input.ultimoResultado ?? null,
    pausa: input.pausa ?? null,
    updatedAt: nowIso(),
  });
}

export async function replaceContactPatientFields(
  id: string,
  input: WaFichaCaso,
): Promise<WaContact | null> {
  const existing = await getContact(id);
  if (!existing) return null;
  const nombre = input.pacienteNombre.trim();
  const apellido = input.pacienteApellido.trim();
  const grupo = input.grupoEtario === "infanto" || input.grupoEtario === "adulto" ? input.grupoEtario : null;
  const sexo = input.sexo === "masculino" || input.sexo === "femenino" ? input.sexo : null;
  const consulta = input.consultaPara === "propio" || input.consultaPara === "tercero" ? input.consultaPara : null;
  await updateDoc(doc(firestore, CONTACTS, id), {
    firstName: nombre || null,
    lastName: apellido || null,
    displayName: [nombre, apellido].filter(Boolean).join(" ") || null,
    consultaPara: consulta,
    relacionFamiliar: input.relacionFamiliar.trim() || null,
    contactoNombre: input.contactoNombre.trim() || null,
    contactoApellido: input.contactoApellido.trim() || null,
    grupoEtario: grupo,
    dni: input.dni.trim() || null,
    sexo,
    updatedAt: nowIso(),
  });
  return getContact(id);
}

export async function setConversationResumen(
  id: string,
  resumen: string,
): Promise<string | null> {
  const text = resumen.trim().replace(/\s+/g, " ").slice(0, 240);
  if (!text) return null;
  await updateDoc(doc(firestore, CONVERSATIONS, id), {
    resumen: text,
    updatedAt: nowIso(),
  });
  return text;
}

export async function setPruebaNota(
  id: string,
  resultado: "correcta" | "incorrecta",
  aclaraciones: { messageId: string; texto: string }[],
): Promise<WaConversation | null> {
  const current = await getConversation(id);
  if (!current?.prueba) throw new Error("No es una conversación de prueba");
  const notas = normalizePruebaAclaraciones(aclaraciones);
  if (resultado === "incorrecta" && notas.length === 0) {
    throw new Error("Elegí al menos un mensaje y contá qué pasó");
  }
  const now = nowIso();
  const pruebaNota =
    resultado === "incorrecta"
      ? notas
          .map((item) => item.texto)
          .join("\n\n")
          .slice(0, 4000)
      : null;
  await updateDoc(doc(firestore, CONVERSATIONS, id), {
    pruebaResultado: resultado,
    pruebaNota,
    pruebaAclaraciones: resultado === "incorrecta" ? notas : [],
    pruebaNotaEn: now,
    updatedAt: now,
  });
  return getConversation(id);
}

export async function appendConversationAuditoria(
  id: string,
  paso: WaAuditoriaPaso,
): Promise<void> {
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return;
  const prev = normalizeAuditoria(snap.data()?.auditoria);
  await updateDoc(doc(firestore, CONVERSATIONS, id), {
    auditoria: [...prev, paso].slice(-40),
    updatedAt: nowIso(),
  });
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

export async function setConversationMenu(id: string, estado: MenuEstado): Promise<void> {
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return;
  await updateDoc(doc(firestore, CONVERSATIONS, id), {
    menuPaso: estado.paso,
    menuEstado: estado,
    updatedAt: nowIso(),
  });
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

export async function listRecentMessagesByConversation(
  conversationId: string,
  max = 40,
): Promise<WaMessage[]> {
  const q = query(
    collection(firestore, MESSAGES),
    where("conversationId", "==", conversationId),
    orderBy("createdAt", "desc"),
    limit(Math.min(Math.max(max, 1), 80)),
  );
  try {
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => normalizeMessage(d.id, d.data() as Record<string, unknown>))
      .reverse();
  } catch {
    const all = await listMessagesByConversation(conversationId, 80);
    return all.slice(-max);
  }
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

  const convSnap = await getDoc(doc(firestore, CONVERSATIONS, input.conversationId));
  const convData = convSnap.data();
  const esPrueba = convData?.prueba === true;
  const prevUnread = Number(convData?.unreadCount ?? 0) || 0;
  await updateDoc(doc(firestore, CONVERSATIONS, input.conversationId), {
    lastMessagePreview: input.text.slice(0, 200),
    lastMessageAt: createdAt,
    updatedAt: nowIso(),
    unreadCount: esPrueba ? 0 : input.direction === "INBOUND" ? prevUnread + 1 : prevUnread,
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
