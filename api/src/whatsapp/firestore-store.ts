import { randomUUID } from "node:crypto";
import {
  collection,
  deleteDoc,
  deleteField,
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
import { formatNombrePersona } from "../lib/nombrePersona.js";
import { documentoDePersona } from "./estado-dialogo.js";
import {
  clearAllLocalPruebas,
  createLocalMessage,
  createLocalPruebaConversation,
  getLocalContact,
  getLocalConversation,
  isLocalPruebaId,
  isQuotaError,
  listLocalMessages,
  listLocalPruebas,
  patchLocalContact,
  setLocalConversationPatch,
  setLocalMenu,
} from "./prueba-local-store.js";
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
  WaResolucion,
  WaResolucionByKind,
  WaResolucionMotivo,
  WaResolutionStatus,
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

function personaONull(raw: unknown): string | null {
  if (raw == null) return null;
  return formatNombrePersona(String(raw)) || null;
}

function normalizeContact(id: string, raw: Record<string, unknown>): WaContact {
  const firstName = personaONull(raw.firstName);
  const lastName = personaONull(raw.lastName);
  const displayFromParts = [firstName, lastName].filter(Boolean).join(" ") || null;
  return {
    id,
    phoneNumber: String(raw.phoneNumber ?? ""),
    firstName,
    lastName,
    displayName: personaONull(raw.displayName) || displayFromParts,
    whatsappName: personaONull(raw.whatsappName),
    cobertura: personaONull(raw.cobertura),
    // Email: sin Title Case (se deja tal cual, solo trim).
    email: raw.email != null ? String(raw.email).trim() || null : null,
    fechaNacimiento: (() => {
      const rawFecha =
        raw.fechaNacimiento != null ? String(raw.fechaNacimiento).trim() : "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawFecha)) return rawFecha;
      return null;
    })(),
    grupoEtario: normalizeGrupoEtario(raw.grupoEtario),
    consultaPara: normalizeConsultaPara(raw.consultaPara),
    contactoNombre: (() => {
      const next = personaONull(raw.contactoNombre);
      if (next) return next;
      return personaONull(raw.terceroNombre);
    })(),
    contactoApellido: personaONull(raw.contactoApellido),
    relacionFamiliar: personaONull(raw.relacionFamiliar),
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
    "cerrado",
    "sede",
    "algoMas",
    "pacienteTipo",
    "primeraVezDatos",
    "otrasConsultas",
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
    "fechaNacimiento",
    "pedidoDatos",
    "confirmarPedido",
    "corregirPedido",
    "profesional",
    "tratamiento",
    "cobertura",
    "afiliado",
    "horarios",
    "elegirTurno",
    "motivoCancelacion",
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
  const modalidad =
    row.modalidad === "presencial" || row.modalidad === "virtual" || row.modalidad === "indistinto"
      ? row.modalidad
      : "";
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
    telefono: String(row.telefono ?? "").trim().slice(0, 40),
    fechaNacimiento: String(row.fechaNacimiento ?? "").trim().slice(0, 20),
    cobertura: String(row.cobertura ?? "").trim().slice(0, 120),
    nAfiliado: String(row.nAfiliado ?? "").trim().slice(0, 60),
    motivoConsulta: String(row.motivoConsulta ?? "").trim().slice(0, 400),
    edad: String(row.edad ?? "").trim().slice(0, 10),
    esPaciente,
    profesional: String(row.profesional ?? "").trim().slice(0, 120),
    tratamiento: String(row.tratamiento ?? "").trim().slice(0, 160),
    profesionalCatalogo: String(row.profesionalCatalogo ?? "").trim().slice(0, 120),
    tratamientoCatalogo: String(row.tratamientoCatalogo ?? "").trim().slice(0, 160),
    profesionalDoc: String(row.profesionalDoc ?? "").trim().slice(0, 40),
    prestacionCodigo: String(row.prestacionCodigo ?? "").trim().slice(0, 40),
    modalidad,
    pendiente: String(row.pendiente ?? "").trim().slice(0, 500),
    opciones: Array.isArray(row.opciones)
      ? row.opciones.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 20)
      : [],
    horarios: String(row.horarios ?? "").slice(0, 4000),
    hastaDia: Number(row.hastaDia ?? 0) || 0,
    busqueda: String(row.busqueda ?? "").slice(0, 80),
    anularLuego: String(row.anularLuego ?? "").slice(0, 400),
    pedidoIntro: row.pedidoIntro === true,
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

function normalizeResoluciones(value: unknown): WaResolucion[] {
  if (!Array.isArray(value)) return [];
  const out: WaResolucion[] = [];
  for (const row of value.slice(-200)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const byKind: WaResolucionByKind | null =
      r.byKind === "human" || r.byKind === "bot" ? r.byKind : null;
    const at = String(r.at ?? "").trim();
    if (!byKind || !at) continue;
    const motivo: WaResolucionMotivo | undefined =
      r.motivo === "manual" || r.motivo === "timeout" || r.motivo === "cierre_bot"
        ? r.motivo
        : undefined;
    out.push({
      id: String(r.id ?? "").trim() || randomUUID(),
      at,
      byKind,
      byUserId: r.byUserId != null ? String(r.byUserId).trim() || null : null,
      byName: r.byName != null ? String(r.byName).trim() || null : null,
      ...(motivo ? { motivo } : {}),
    });
  }
  return out;
}

function normalizeConversation(id: string, raw: Record<string, unknown>): WaConversation {
  const resolutionStatus: WaResolutionStatus =
    raw.resolutionStatus === "resolved" ? "resolved" : "open";
  const resolvedByKind: WaResolucionByKind | null =
    raw.resolvedByKind === "human" || raw.resolvedByKind === "bot" ? raw.resolvedByKind : null;
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
    resolutionStatus,
    resolvedAt: raw.resolvedAt != null ? String(raw.resolvedAt).trim() || null : null,
    resolvedByKind,
    resolvedByUserId: raw.resolvedByUserId != null ? String(raw.resolvedByUserId).trim() || null : null,
    resolvedByName: raw.resolvedByName != null ? String(raw.resolvedByName).trim() || null : null,
    botPausedUntilInbound: raw.botPausedUntilInbound === true,
    resoluciones: normalizeResoluciones(raw.resoluciones),
    motivoConsulta: raw.motivoConsulta != null ? String(raw.motivoConsulta).trim() || null : null,
    diagnosticoIa: raw.diagnosticoIa != null ? String(raw.diagnosticoIa).trim() || null : null,
    diagnosticoIaAt: raw.diagnosticoIaAt != null ? String(raw.diagnosticoIaAt).trim() || null : null,
    diagnosticoHumano:
      raw.diagnosticoHumano != null ? String(raw.diagnosticoHumano).trim() || null : null,
    diagnosticoHumanoByUserId:
      raw.diagnosticoHumanoByUserId != null
        ? String(raw.diagnosticoHumanoByUserId).trim() || null
        : null,
    diagnosticoHumanoByName:
      raw.diagnosticoHumanoByName != null
        ? String(raw.diagnosticoHumanoByName).trim() || null
        : null,
    diagnosticoHumanoAt:
      raw.diagnosticoHumanoAt != null ? String(raw.diagnosticoHumanoAt).trim() || null : null,
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
  const local = getLocalContact(id);
  if (local) return local;
  const snap = await getDoc(doc(firestore, CONTACTS, id));
  if (!snap.exists()) return null;
  return normalizeContact(snap.id, snap.data() as Record<string, unknown>);
}

function normalizeFechaNacimiento(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const dmy = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1]!.padStart(2, "0");
    const mm = dmy[2]!.padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return null;
}

export async function updateContact(
  id: string,
  input: {
    firstName: string;
    lastName: string;
    cobertura?: string;
    email?: string;
    fechaNacimiento?: string | null;
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
  const esLocal = Boolean(getLocalContact(id));
  const firstName = formatNombrePersona(input.firstName);
  const lastName = formatNombrePersona(input.lastName);
  if (!firstName) {
    throw new Error("El nombre del paciente es obligatorio");
  }
  const cobertura =
    input.cobertura !== undefined
      ? formatNombrePersona(input.cobertura) || null
      : existing.cobertura;
  const emailRaw =
    input.email !== undefined ? input.email.trim() : existing.email ?? "";
  const email = emailRaw || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("El email no es válido");
  }
  let fechaNacimiento =
    input.fechaNacimiento !== undefined
      ? normalizeFechaNacimiento(input.fechaNacimiento)
      : existing.fechaNacimiento;
  if (
    input.fechaNacimiento !== undefined &&
    String(input.fechaNacimiento ?? "").trim() &&
    !fechaNacimiento
  ) {
    throw new Error("La fecha de nacimiento no es válida");
  }
  if (input.fechaNacimiento !== undefined && !String(input.fechaNacimiento ?? "").trim()) {
    fechaNacimiento = null;
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
      ? formatNombrePersona(input.contactoNombre ?? "") || null
      : existing.contactoNombre;
  let contactoApellido =
    input.contactoApellido !== undefined
      ? formatNombrePersona(input.contactoApellido ?? "") || null
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
  const nextContact: Partial<WaContact> = {
    firstName,
    lastName: lastName || null,
    displayName,
    cobertura,
    email,
    fechaNacimiento,
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
  if (esLocal) {
    return patchLocalContact(id, nextContact) ?? existing;
  }
  await updateDoc(doc(firestore, CONTACTS, id), {
    ...nextContact,
    terceroNombre: null,
  });
  return {
    ...existing,
    firstName,
    lastName: lastName || null,
    displayName,
    phoneNumber: existing.phoneNumber,
    cobertura,
    email,
    fechaNacimiento,
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

async function createPruebaConversationFirebase(
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
    fechaNacimiento: null,
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
    batch.set(doc(firestore, CONTACTS, contact.id), contact);
  }
  const id = randomUUID();
  const conversation: WaConversation = {
    id,
    contactId: contact.id,
    status: "OPEN",
    unreadCount: 0,
    lastMessagePreview: null,
    // Para que la prueba nueva quede arriba en la lista (sin lastMessageAt va al final).
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
    pruebaCreadorNombre: creador?.nombre?.trim() || null,
    auditoria: [],
    createdAt: now,
    updatedAt: now,
  };
  batch.set(doc(firestore, CONVERSATIONS, id), conversation);
  await batch.commit();
  return { ...conversation, contact };
}

export async function createPruebaConversation(
  creador?: {
    id?: string | null;
    nombre?: string | null;
  },
  motor: "ia" | "menu" = "ia",
): Promise<WaConversation> {
  const forzarLocal =
    process.env.PRUEBA_SIN_FIREBASE === "1" || process.env.PRUEBA_SIN_FIREBASE === "true";
  // Bot de opciones: siempre local+disco. Si va a Firebase y falla el listado por cuota,
  // al entrar/salir de Conversaciones o Prueba bot la charla “desaparece”.
  if (forzarLocal || motor === "menu") {
    return createLocalPruebaConversation(creador, motor);
  }
  try {
    return await createPruebaConversationFirebase(creador, motor);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    console.warn("[whatsapp] Firestore sin cuota: creando prueba en memoria");
    return createLocalPruebaConversation(creador, motor);
  }
}

/** Borra todas las conversaciones de prueba (+ mensajes y contactos) y reinicia el seq. */
export async function deleteAllPruebaConversations(): Promise<{
  locales: number;
  firestore: number;
  mensajes: number;
  contactos: number;
}> {
  const locales = clearAllLocalPruebas();
  let firestoreCount = 0;
  let mensajes = 0;
  let contactos = 0;

  try {
    const snap = await getDocs(collection(firestore, CONVERSATIONS));
    const pruebas = snap.docs.filter((d) => (d.data() as { prueba?: unknown }).prueba === true);
    const contactIds = new Set<string>();

    for (const d of pruebas) {
      const data = d.data() as { contactId?: unknown };
      const contactId = String(data.contactId ?? "").trim();
      if (contactId) contactIds.add(contactId);

      // Mensajes de esa conversación.
      try {
        const mq = query(
          collection(firestore, MESSAGES),
          where("conversationId", "==", d.id),
        );
        const ms = await getDocs(mq);
        for (let i = 0; i < ms.docs.length; i += 400) {
          const batch = writeBatch(firestore);
          for (const m of ms.docs.slice(i, i + 400)) {
            batch.delete(m.ref);
            mensajes += 1;
          }
          await batch.commit();
        }
      } catch (error) {
        if (!isQuotaError(error)) throw error;
      }

      await deleteDoc(d.ref);
      firestoreCount += 1;
    }

    for (const contactId of contactIds) {
      try {
        await deleteDoc(doc(firestore, CONTACTS, contactId));
        contactos += 1;
      } catch (error) {
        if (!isQuotaError(error)) throw error;
      }
    }

    // Seq de números ficticios de cero.
    try {
      await setDoc(
        doc(firestore, "ordenes_config", "whatsapp_prueba_seq"),
        { next: 0, updatedAt: nowIso() },
        { merge: true },
      );
    } catch (error) {
      if (!isQuotaError(error)) throw error;
    }
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    console.warn("[whatsapp] Firestore sin cuota al borrar pruebas; solo se limpió memoria");
  }

  return { locales, firestore: firestoreCount, mensajes, contactos };
}

export type WaMetricaFilaStore = {
  tagIds: string[];
  assigneeKind: "none" | "bot" | "user";
  assigneeUserId: string | null;
  assigneeName: string | null;
  /** Snapshot actual del episodio. */
  resolutionStatus: WaResolutionStatus;
  /** Resoluciones del período (episodios cerrados). */
  resolucionesEnPeriodo: WaResolucion[];
};

export async function listConversacionesMetricas(
  desde: string,
  hasta: string,
): Promise<WaMetricaFilaStore[]> {
  const from = Date.parse(`${desde}T00:00:00-03:00`);
  const to = Date.parse(`${hasta}T23:59:59.999-03:00`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error("Elegí un rango de fechas válido");
  }
  const snap = await getDocs(collection(firestore, CONVERSATIONS));
  const filas: WaMetricaFilaStore[] = [];
  for (const item of snap.docs) {
    const raw = item.data();
    if (raw.prueba === true) continue;
    const cuando = Date.parse(String(raw.lastMessageAt || raw.createdAt || ""));
    const resoluciones = normalizeResoluciones(raw.resoluciones).filter((r) => {
      const at = Date.parse(r.at);
      return Number.isFinite(at) && at >= from && at <= to;
    });
    const enRangoActividad =
      Number.isFinite(cuando) && cuando >= from && cuando <= to;
    // Incluir si hubo actividad en el rango o al menos una resolución en el período.
    if (!enRangoActividad && !resoluciones.length) continue;
    const assigneeKind =
      raw.assigneeKind === "bot" || raw.assigneeKind === "user" ? raw.assigneeKind : "none";
    filas.push({
      tagIds: Array.isArray(raw.tagIds)
        ? [...new Set(raw.tagIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
        : [],
      assigneeKind,
      assigneeUserId: raw.assigneeUserId != null ? String(raw.assigneeUserId) : null,
      assigneeName: raw.assigneeName != null ? String(raw.assigneeName).trim() || null : null,
      resolutionStatus: raw.resolutionStatus === "resolved" ? "resolved" : "open",
      resolucionesEnPeriodo: resoluciones,
    });
  }
  return filas;
}

/** Pedido de turno → ficha: si la fecha quedó solo en menuEstado, copiarla al contacto. */
async function asegurarFechaNacimientoEnFicha(
  conversation: WaConversation,
  contact: WaContact | null | undefined,
): Promise<WaContact | null | undefined> {
  if (!contact) return contact;
  if ((contact.fechaNacimiento ?? "").trim()) return contact;
  const iso = normalizeFechaNacimiento(conversation.menuEstado?.fechaNacimiento ?? "");
  if (!iso) return contact;
  const updated = await fillEmptyContactFields(contact.id, { fechaNacimiento: iso });
  return updated ?? { ...contact, fechaNacimiento: iso };
}

export async function getConversation(id: string): Promise<WaConversation | null> {
  const local = getLocalConversation(id);
  if (local) {
    const contact = await asegurarFechaNacimientoEnFicha(local, local.contact);
    return { ...local, contact: contact ?? undefined };
  }
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  const conversation = normalizeConversation(snap.id, snap.data() as Record<string, unknown>);
  const contact = await asegurarFechaNacimientoEnFicha(
    conversation,
    await getContact(conversation.contactId),
  );
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
      try {
        const contact = await asegurarFechaNacimientoEnFicha(
          c,
          (await getContact(c.contactId)) ?? c.contact,
        );
        return { ...c, contact: contact ?? c.contact ?? undefined };
      } catch {
        // Sin cuota / error de lectura: no tumbar todo el listado.
        return { ...c, contact: c.contact ?? undefined };
      }
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
  const onlyPrueba = opts?.prueba === true;
  const motor = onlyPrueba ? (opts?.pruebaMotor === "menu" ? "menu" : "ia") : undefined;
  // Prueba bot (menú): también en Conversaciones (vista operadora).
  const locales = (
    onlyPrueba ? listLocalPruebas(motor) : listLocalPruebas("menu")
  ).filter((item) => !status || item.status === status);

  let items: WaConversation[] = [];
  try {
    const q = query(collection(firestore, CONVERSATIONS), where("status", "==", status));
    const snap = await getDocs(q);
    items = snap.docs.map((d) => normalizeConversation(d.id, d.data() as Record<string, unknown>));
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    console.warn("[whatsapp] Firestore sin cuota: listando con pruebas en memoria");
    items = [];
  }
  if (onlyPrueba) {
    items = items.filter((item) => item.prueba === true);
    items = items.filter((item) => (item.pruebaMotor === "menu" ? "menu" : "ia") === motor);
  } else {
    // CRM: chats reales + pruebas del bot de opciones (no las de IA).
    items = items.filter((item) => !item.prueba || item.pruebaMotor === "menu");
  }
  // Mezclar locales (arriba si son más nuevas).
  if (locales.length) {
    const ids = new Set(items.map((item) => item.id));
    items = [...locales.filter((item) => !ids.has(item.id)), ...items];
  }
  items.sort((a, b) => {
    const ta = Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || "") || 0;
    const tb = Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || "") || 0;
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
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, { unreadCount: 0, updatedAt: now });
  }
  await updateDoc(doc(firestore, CONVERSATIONS, id), {
    unreadCount: 0,
    updatedAt: now,
  });
  // Releer: si no, un snapshot viejo puede pisar assignee recién cambiado en el cliente.
  const fresh = await getConversation(id);
  return fresh ? { ...fresh, unreadCount: 0 } : { ...current, unreadCount: 0, updatedAt: now };
}

export async function setConversationAssignee(
  id: string,
  input: { kind: "none" | "bot" | "user"; userId?: string | null; name?: string | null },
): Promise<WaConversation | null> {
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, {
      assigneeKind: input.kind,
      assigneeUserId: input.kind === "user" ? input.userId ?? null : null,
      assigneeName: input.kind === "none" ? null : input.name ?? null,
    });
  }
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

/**
 * Marca el episodio como resuelto, pasa al bot y pausa respuestas hasta el próximo inbound.
 */
export async function resolveConversation(
  id: string,
  input: {
    byKind: WaResolucionByKind;
    byUserId?: string | null;
    byName?: string | null;
    motivo?: WaResolucionMotivo;
  },
): Promise<WaConversation | null> {
  const current = await getConversation(id);
  if (!current) return null;
  if (current.resolutionStatus === "resolved" && current.botPausedUntilInbound) {
    return current;
  }
  const now = nowIso();
  const entry: WaResolucion = {
    id: randomUUID(),
    at: now,
    byKind: input.byKind,
    byUserId: input.byKind === "human" ? input.byUserId ?? null : null,
    byName:
      input.byKind === "bot"
        ? input.byName?.trim() || "Bot"
        : input.byName?.trim() || current.assigneeName || "Operador",
    motivo: input.motivo ?? (input.byKind === "human" ? "manual" : "cierre_bot"),
  };
  const resoluciones = [...(current.resoluciones ?? []), entry].slice(-200);
  const patch = {
    resolutionStatus: "resolved" as const,
    resolvedAt: now,
    resolvedByKind: entry.byKind,
    resolvedByUserId: entry.byUserId,
    resolvedByName: entry.byName,
    botPausedUntilInbound: true,
    resoluciones,
    assigneeKind: "bot" as const,
    assigneeUserId: null as string | null,
    assigneeName: "Bot",
    derivacionPendiente: false,
    updatedAt: now,
  };
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, patch);
  }
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  await updateDoc(doc(firestore, CONVERSATIONS, id), patch);
  return normalizeConversation(id, { ...snap.data(), ...patch });
}

/** Guarda motivo + diagnóstico sugerido por la IA (primera vez / oportunidad). */
export async function setDiagnosticoPresuntivoIa(
  id: string,
  input: { diagnostico?: string | null; motivoConsulta?: string | null },
): Promise<WaConversation | null> {
  const current = await getConversation(id);
  if (!current) return null;
  const now = nowIso();
  const motivo = String(input.motivoConsulta ?? "").trim().slice(0, 800);
  const diag = String(input.diagnostico ?? "").trim().slice(0, 160);
  const patch = {
    ...(motivo ? { motivoConsulta: motivo } : {}),
    ...(diag ? { diagnosticoIa: diag, diagnosticoIaAt: now } : {}),
    updatedAt: now,
  };
  if (!motivo && !diag) return current;
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, patch);
  }
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  await updateDoc(doc(firestore, CONVERSATIONS, id), patch);
  return normalizeConversation(id, { ...snap.data(), ...patch });
}

/** Diagnóstico corregido/confirmado por una persona del equipo. */
export async function setDiagnosticoPresuntivoHumano(
  id: string,
  input: {
    diagnostico: string;
    byUserId: string;
    byName: string;
  },
): Promise<WaConversation | null> {
  const current = await getConversation(id);
  if (!current) return null;
  const diag = String(input.diagnostico ?? "").trim().slice(0, 160);
  const now = nowIso();
  const patch = {
    diagnosticoHumano: diag || null,
    diagnosticoHumanoByUserId: diag ? input.byUserId : null,
    diagnosticoHumanoByName: diag ? input.byName.trim() || "Operador" : null,
    diagnosticoHumanoAt: diag ? now : null,
    updatedAt: now,
  };
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, patch);
  }
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  const write = diag
    ? patch
    : {
        diagnosticoHumano: deleteField(),
        diagnosticoHumanoByUserId: deleteField(),
        diagnosticoHumanoByName: deleteField(),
        diagnosticoHumanoAt: deleteField(),
        updatedAt: now,
      };
  await updateDoc(doc(firestore, CONVERSATIONS, id), write);
  return normalizeConversation(id, { ...snap.data(), ...patch });
}

/** Tras inbound: si estaba resuelta/pausada, abre un episodio nuevo. */
export async function reopenConversationEpisodeIfNeeded(
  id: string,
): Promise<WaConversation | null> {
  const current = await getConversation(id);
  if (!current) return null;
  if (current.resolutionStatus !== "resolved" && !current.botPausedUntilInbound) {
    return current;
  }
  const now = nowIso();
  const patch = {
    resolutionStatus: "open" as const,
    resolvedAt: null as string | null,
    resolvedByKind: null as WaResolucionByKind | null,
    resolvedByUserId: null as string | null,
    resolvedByName: null as string | null,
    botPausedUntilInbound: false,
    updatedAt: now,
  };
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, patch);
  }
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
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
  fechaNacimiento?: string;
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
    const contactoNombre = formatNombrePersona(input.contactoNombre ?? "");
    const contactoApellido = formatNombrePersona(input.contactoApellido ?? "");
    if (contactoNombre && contactoNombre !== formatNombrePersona(existing.contactoNombre ?? "")) {
      patch.contactoNombre = contactoNombre;
    }
    if (contactoApellido && contactoApellido !== formatNombrePersona(existing.contactoApellido ?? "")) {
      patch.contactoApellido = contactoApellido;
    }
  }

  const pacienteNombre = formatNombrePersona(input.pacienteNombre ?? "");
  const pacienteApellido = formatNombrePersona(input.pacienteApellido ?? "");
  if (pacienteNombre && pacienteNombre !== formatNombrePersona(existing.firstName ?? "")) {
    patch.firstName = pacienteNombre;
  }
  if (pacienteApellido && pacienteApellido !== formatNombrePersona(existing.lastName ?? "")) {
    patch.lastName = pacienteApellido;
  }
  if (patch.firstName || patch.lastName) {
    const first = String(patch.firstName ?? existing.firstName ?? "");
    const last = String(patch.lastName ?? existing.lastName ?? "");
    patch.displayName = [formatNombrePersona(first), formatNombrePersona(last)]
      .filter(Boolean)
      .join(" ");
  }

  const grupo = normalizeGrupoEtario(input.grupoEtario);
  if (grupo && grupo !== existing.grupoEtario) patch.grupoEtario = grupo;
  const cobertura = formatNombrePersona(input.cobertura ?? "");
  if (cobertura && cobertura !== formatNombrePersona(existing.cobertura ?? "")) {
    patch.cobertura = cobertura;
  }
  const fechaNacimiento = normalizeFechaNacimiento(input.fechaNacimiento ?? "");
  if (fechaNacimiento && fechaNacimiento !== (existing.fechaNacimiento ?? "").trim()) {
    patch.fechaNacimiento = fechaNacimiento;
  }
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
  if (getLocalContact(id)) {
    return patchLocalContact(id, patch as Partial<WaContact>);
  }
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
  const nombre = formatNombrePersona(input.pacienteNombre);
  const apellido = formatNombrePersona(input.pacienteApellido);
  const grupo = input.grupoEtario === "infanto" || input.grupoEtario === "adulto" ? input.grupoEtario : null;
  const sexo = input.sexo === "masculino" || input.sexo === "femenino" ? input.sexo : null;
  const consulta = input.consultaPara === "propio" || input.consultaPara === "tercero" ? input.consultaPara : null;
  await updateDoc(doc(firestore, CONTACTS, id), {
    firstName: nombre || null,
    lastName: apellido || null,
    displayName: [nombre, apellido].filter(Boolean).join(" ") || null,
    consultaPara: consulta,
    relacionFamiliar: formatNombrePersona(input.relacionFamiliar) || null,
    contactoNombre: formatNombrePersona(input.contactoNombre) || null,
    contactoApellido: formatNombrePersona(input.contactoApellido) || null,
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
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, {
      pruebaResultado: resultado,
      pruebaNota,
      pruebaAclaraciones: resultado === "incorrecta" ? notas : [],
      pruebaNotaEn: now,
    });
  }
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
  const unique = [...new Set(tagIds.map((item) => item.trim()).filter(Boolean))];
  if (isLocalPruebaId(id)) {
    return setLocalConversationPatch(id, { tagIds: unique });
  }
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return null;
  const now = nowIso();
  const patch = { tagIds: unique, updatedAt: now };
  await updateDoc(doc(firestore, CONVERSATIONS, id), patch);
  return normalizeConversation(id, { ...snap.data(), ...patch });
}

export async function setConversationMenu(id: string, estado: MenuEstado): Promise<void> {
  if (isLocalPruebaId(id)) {
    setLocalMenu(id, estado);
    return;
  }
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
  if (isLocalPruebaId(conversationId)) {
    return listLocalMessages(conversationId, max);
  }
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
  if (isLocalPruebaId(conversationId)) {
    return listLocalMessages(conversationId, max);
  }
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
  if (isLocalPruebaId(input.conversationId)) {
    const local = createLocalMessage(input);
    if (!local) throw new Error("Prueba local no encontrada");
    return local;
  }
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
