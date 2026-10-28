import { randomUUID } from "node:crypto";
import {
  consultarPaciente,
  ejecutarAccion,
  pideAfirmacion,
  pideMasFechas,
  pideMasTemprano,
  pideNegacion,
  textoDeTurnosPropios,
} from "./acciones.js";
import { documentoDePersona } from "./estado-dialogo.js";
import { sexoDesdeNombre } from "../lib/nombrePersona.js";
import { getBuscaTurnoConfig } from "../services/db.service.js";
import type { BuscaTurnoConfig, BuscaTurnoPrestacion, BuscaTurnoProfesional } from "../types.js";
import {
  botDaTurnos,
  getWhatsappBotConfig,
  TEXTO_TURNO_DATOS_LISTOS,
  TEXTO_TURNO_SIN_ASIGNAR,
} from "./bot-config.js";
import { getWhatsappConocimiento } from "./conocimiento.js";
import {
  createMessage,
  fillEmptyContactFields,
  getContact,
  getConversation,
  listRecentMessagesByConversation,
  setConversationAssignee,
  setConversationMenu,
  setConversationTags,
} from "./firestore-store.js";
import { completeStructured } from "./openai-client.js";
import { listWhatsappOperators } from "./operators.js";
import { ensureWhatsappTagsByName, listWhatsappTagCatalog } from "./tags.js";
import { isLocalPruebaId, isQuotaError, localTagIdForName } from "./prueba-local-store.js";
import { listUsersByStatus } from "../services/users.service.js";
import type { MenuEstado, MenuPaso, WaConversation, WaMessage } from "./types.js";
import type { SalidaAccion } from "./acciones.js";
import type { WaTagCatalog } from "./tags.js";

const MODELO_PEDIDO_DATOS = "gpt-6-luna";

type CampoPedido =
  | "dni"
  | "nombre"
  | "apellido"
  | "email"
  | "telefono"
  | "fechaNacimiento"
  | "profesional"
  | "tratamiento"
  | "modalidad"
  | "cobertura"
  | "nAfiliado";

const ETIQUETA_CAMPO_PEDIDO: Record<CampoPedido, string> = {
  dni: "DNI",
  nombre: "Nombre del paciente",
  apellido: "Apellido del paciente",
  email: "Email",
  telefono: "Teléfono",
  fechaNacimiento: "Fecha de nacimiento",
  profesional: "Nombre del profesional",
  tratamiento: "Prestación o motivo",
  modalidad: "Modalidad (presencial, virtual o indistinto)",
  cobertura: "Cobertura",
  nAfiliado: "N° de afiliado",
};

type MemoriaMenu = {
  conversation: WaConversation;
  messages: WaMessage[];
  catalogo: WaTagCatalog;
  conocimiento: string;
  accion?: typeof ejecutarAccion;
  paciente?: typeof consultarPaciente;
};

let memoria: MemoriaMenu | null = null;

/** Solo para pruebas. En producción queda en null y se usa Firestore. */
export function usarMemoriaMenu(valor: MemoriaMenu | null): void {
  memoria = valor;
}

const SEDES = [
  "CABA",
  "Ramos Mejía",
  "Quilmes",
  "Temperley",
  "Moreno",
  "Pilar",
  "Junín",
  "Rosario",
  "Comodoro Rivadavia",
  "San Juan",
];

const OPCIONES = [
  { n: "1", clave: "turnos", titulo: "Turnos" },
  { n: "2", clave: "pagos", titulo: "Informar pago" },
  { n: "3", clave: "recetas", titulo: "Solicitar recetas" },
];

const TEXTO_INFORMAR_PAGO =
  "Por favor, remita el comprobante al correo pagos@ineco.ar. En el asunto señale Pago DNI (su número). En el cuerpo del mail puede detallar a qué servicio y/o concepto refiere para facilitar la integración en su ficha del sistema administrativo.";

const TEXTO_SOLICITAR_RECETAS =
  "Puede realizar el requerimiento en su perfil de la app INECO: ineco.org.ar/nuestra-app";

const MOTIVOS_CANCELACION = [
  "Costo / arancel",
  "No puedo en ese horario",
  "Motivos personales",
  "Ya no lo necesito",
  "Otro motivo",
];

/** Texto libre: la salida va en la misma frase, no como menú aparte. */
function conVolver(texto: string): string {
  const base = texto.trim();
  if (/toc[aá] 0\b|0 para volver/i.test(base)) return base;
  return `${base} O tocá 0 para volver atrás.`;
}

function quiereVolver(texto: string): boolean {
  const t = sinTildes(texto).trim();
  // 00 quedó deprecado: hace lo mismo que volver atrás.
  return (
    t === "0" ||
    t === "00" ||
    t === "volver" ||
    t === "atras" ||
    t === "volver atras" ||
    t === "cancelar" ||
    t === "cancelar el proceso"
  );
}

function pideIndistinto(texto: string): boolean {
  const t = sinTildes(texto).trim();
  return (
    t === "indistinto" ||
    t === "cualquiera" ||
    t === "da igual" ||
    t === "el que sea" ||
    t === "no se" ||
    t === "nose" ||
    /\b(indistinto|cualquiera|sin preferencia|me da igual|el que sea|no tengo preferencia)\b/.test(t)
  );
}

function preguntaProfesional(cambiar: boolean): string {
  const para = cambiar ? "para el turno nuevo" : "";
  return conVolver(
    `¿Tenés algún médico en particular ${para}? Escribí el nombre y apellido, o escribí indistinto y te muestro una lista.`
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function mensajeError(error: unknown): string {
  const texto = error instanceof Error ? error.message : "";
  if (!texto || /password|token|https?:\/\//i.test(texto) || esErrorSistema(texto)) {
    return "Hubo un problema con el sistema. Podés elegir otra opción para seguir.";
  }
  return `${texto.slice(0, 240)}\n\nPodés elegir otra opción para seguir.`;
}

/** Errores de Medexis / internos: no se muestran al paciente. */
function esErrorSistema(texto: string): boolean {
  const t = sinTildes(texto);
  if (
    /precio cero|codigo de prestacion|medexis|resultado.?error|exception|stack|password|token|https?:|api\/turno|null reference|sql|timeout|econn|quota|resource_exhausted/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^no pude (dar|cancelar)/i.test(texto.trim())) return true;
  // Mensajes nuestros accionables: no son error de sistema.
  if (
    /^(turno dado|turno cancelado|falta el|faltan |no hay |estos son|tenemos estos|buscas a|no encontre|ese profesional|hay mas de|con ese dni|figura |no figura|para confirmar)/i.test(
      sinTildes(texto.trim()),
    )
  ) {
    return false;
  }
  // Reglas de negocio opacas del sistema de turnos.
  if (/\bno (puede|pudo|se puede)\b/.test(t) && !/\b(email|dni|horario|nombre|apellido)\b/.test(t)) {
    return true;
  }
  return false;
}

function mensajeFalloReserva(crudo: string): string {
  if (/falta el email|faltan nombre|falta.*apellido|falta el dni|falta el horario/i.test(crudo)) {
    return crudo;
  }
  if (esErrorSistema(crudo) || !crudo.trim()) {
    return "No pude darte ese turno. El sistema no lo pudo registrar.";
  }
  return crudo;
}

function mensajeFalloCancelar(crudo: string): string {
  if (/^turno cancelado/i.test(crudo.trim())) return crudo;
  if (/no encontr|no hay un turno/i.test(crudo)) return crudo;
  if (esErrorSistema(crudo) || !crudo.trim()) {
    return "No pude cancelar ese turno. El sistema no lo pudo registrar.";
  }
  return crudo;
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function vacio(paso: MenuPaso, prev?: Partial<MenuEstado> | null): MenuEstado {
  return {
    paso,
    modo: prev?.modo ?? "",
    dni: prev?.dni ?? "",
    nombre: prev?.nombre ?? "",
    apellido: prev?.apellido ?? "",
    sexo: prev?.sexo ?? "",
    email: prev?.email ?? "",
    telefono: prev?.telefono ?? "",
    fechaNacimiento: prev?.fechaNacimiento ?? "",
    cobertura: prev?.cobertura ?? "",
    nAfiliado: prev?.nAfiliado ?? "",
    motivoConsulta: prev?.motivoConsulta ?? "",
    edad: prev?.edad ?? "",
    esPaciente: prev?.esPaciente ?? "",
    profesional: prev?.profesional ?? "",
    tratamiento: prev?.tratamiento ?? "",
    profesionalCatalogo: prev?.profesionalCatalogo ?? "",
    tratamientoCatalogo: prev?.tratamientoCatalogo ?? "",
    profesionalDoc: prev?.profesionalDoc ?? "",
    prestacionCodigo: prev?.prestacionCodigo ?? "",
    modalidad: prev?.modalidad ?? "",
    pendiente: prev?.pendiente ?? "",
    opciones: prev?.opciones ?? [],
    horarios: prev?.horarios ?? "",
    hastaDia: prev?.hastaDia ?? 0,
    busqueda: prev?.busqueda ?? "",
    anularLuego: prev?.anularLuego ?? "",
    pedidoIntro: prev?.pedidoIntro ?? false,
    pila: prev?.pila ?? [],
  };
}

function trato(now: Date): string {
  const hora = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  if (hora >= 6 && hora < 12) return "Buen día";
  if (hora >= 12 && hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

async function decir(conversationId: string, contactId: string, text: string): Promise<void> {
  if (memoria) {
    memoria.messages.push({
      id: `out-${memoria.messages.length + 1}`,
      conversationId,
      contactId,
      direction: "OUTBOUND",
      type: "TEXT",
      text,
      externalMessageId: null,
      status: "SENT",
      mimeType: null,
      fileName: null,
      mediaPath: null,
      mediaUrl: null,
      isDeleted: false,
      createdAt: new Date().toISOString(),
    });
    return;
  }
  await createMessage({
    conversationId,
    contactId,
    direction: "OUTBOUND",
    type: "TEXT",
    text,
    externalMessageId: `menu-${randomUUID()}`,
    status: "SENT",
  });
}

async function guardar(conversationId: string, estado: MenuEstado): Promise<void> {
  if (memoria && memoria.conversation.id === conversationId) {
    memoria.conversation.menuPaso = estado.paso;
    memoria.conversation.menuEstado = estado;
    return;
  }
  await setConversationMenu(conversationId, estado);
}

function numerar(lineas: string[], separar = false): string {
  const unidos = lineas.map((linea, index) => `${index + 1}. ${linea}`);
  return unidos.join(separar ? "\n\n" : "\n");
}

/** Horarios agrupados por día, con número para elegir. */
function formatearHorariosMenu(lineas: string[]): string {
  const bloques: string[] = ["Tengo los siguientes turnos libres:"];
  let diaActual = "";
  let n = 0;
  for (const linea of lineas) {
    const m = linea.match(/\((\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::\d{2})?\)/);
    if (!m) continue;
    const [, y, mes, dia, hh, mm] = m;
    const claveDia = `${y}-${mes}-${dia}`;
    if (claveDia !== diaActual) {
      diaActual = claveDia;
      const cuando = new Date(`${claveDia}T12:00:00-03:00`);
      const weekday = new Intl.DateTimeFormat("es-AR", {
        weekday: "long",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(cuando);
      const mesNombre = new Intl.DateTimeFormat("es-AR", {
        month: "long",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(cuando);
      bloques.push(
        "",
        `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${dia} de ${mesNombre}`,
      );
    }
    n += 1;
    bloques.push(`${n}. ${hh}:${mm}`);
  }
  return bloques.join("\n");
}

function noValida(lista: string): string {
  return `Esa opción no es válida. Elegí un número de la lista.\n\n${lista}`;
}

function listaSedes(): string {
  return `¿Para qué sucursal es tu consulta?\nRespondé con el número.\n\n${numerar(SEDES)}`;
}

function preguntaAlgoMas(sedeNoCaba: boolean): string {
  const aviso = sedeNoCaba
    ? "Este WhatsApp gestiona solo la sede de CABA. Te dejé el contacto de esa sucursal.\n\n"
    : "";
  return `${aviso}¿Te puedo ayudar en algo más?\n\n1. Sí\n2. No, gracias`;
}

function opcionesTrasSi(desde: "sede" | "info"): string {
  if (desde === "sede") {
    return [
      "¿En qué te ayudo?",
      "",
      "1. Continuar con CABA (turnos, info, tratamientos, quejas)",
      "2. Ver otra sucursal",
    ].join("\n");
  }
  return [
    "¿En qué te ayudo?",
    "",
    "1. Menú principal (turnos, info, tratamientos, quejas)",
    "2. Ver otra sucursal",
  ].join("\n");
}

function desdeAlgoMas(estado: MenuEstado): "sede" | "info" {
  return estado.pendiente === "desde:info" || estado.pendiente === "elige:info" ? "info" : "sede";
}

function listaPacienteTipo(): string {
  return [
    "1. Ya soy paciente",
    "2. Primera vez en INECO",
    "3. Otras consultas",
    "",
    "0. Volver atrás",
  ].join("\n");
}

const TEXTO_OTRAS_CONSULTAS_PEDIR =
  "Cuéntenos brevemente su consulta respecto de INECO Clínica Sede Central CABA (Marcelo T. de Alvear 1652) —administrativa, coberturas, reclamos u otra actividad— y un asesor le responderá.";

const TEXTO_OTRAS_CONSULTAS_CIERRE =
  "Gracias. Un asesor continuará la conversación a la brevedad.";

function listaMenu(modo: "inicio" | "otraVez" = "otraVez"): string {
  const lineas = OPCIONES.map((item) => `${item.n}. ${item.titulo}`);
  const titulo =
    modo === "inicio" ? "¿Con qué te puedo ayudar?" : "¿Necesitás ayuda con algo más?";
  return `${titulo}\n\n${lineas.join("\n")}\n\n0. Volver atrás (terminar conversación)`;
}

function listaTurnos(): string {
  return [
    "¿Te puedo ayudar en algo más con los turnos?",
    "",
    "1. Próximos turnos",
    "2. Cancelar turnos",
    "3. Pedir turno",
    "",
    "0. Volver atrás",
  ].join("\n");
}

function textoInformarPago(dni: string): string {
  if (dni) {
    return TEXTO_INFORMAR_PAGO.replace("Pago DNI (su número)", `Pago DNI ${dni}`);
  }
  return TEXTO_INFORMAR_PAGO;
}

/** `futuro: … | profesional … | prestacion …` → texto legible para elegir. */
function etiquetaFuturo(linea: string): string {
  const crudo = linea.replace(/^futuro:\s*/i, "").trim();
  const fecha = crudo.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  const profesional =
    crudo.match(/\|\s*profesional\s+([^|]+)/i)?.[1]?.trim() ||
    crudo.match(/\bcon\s+([^|]+?)(?:\s+prestacion\b|$)/i)?.[1]?.trim() ||
    "";
  const prestacion =
    crudo.match(/\|\s*prestacion\s+([^|]+)/i)?.[1]?.trim() ||
    "";
  if (!fecha) {
    return [profesional && `Prof.: ${profesional}`, prestacion && `Prest.: ${prestacion}`]
      .filter(Boolean)
      .join(" · ") || crudo;
  }
  const [, y, mes, dia, hh, mm] = fecha;
  const cuando = new Date(`${y}-${mes}-${dia}T12:00:00-03:00`);
  const weekdayRaw = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(cuando);
  const weekday = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);
  const anioCorto = String(y).slice(-2);
  const lineas = [`${weekday} ${dia}/${mes}/${anioCorto} ${hh}:${mm}`];
  if (profesional) lineas.push(`Prof.: ${profesional}`);
  if (prestacion) lineas.push(`Prest.: ${prestacion}`);
  if (lineas.length === 1) {
    const resto = crudo
      .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/, "")
      .replace(/\|\s*profesional\s+[^|]+/i, "")
      .replace(/\|\s*prestacion\s+[^|]+/i, "")
      .replace(/^con\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (resto) lineas.push(resto);
  }
  return lineas.join("\n");
}

function listaMotivosCancelacion(): string {
  return [
    "¿Cuál es el motivo de la cancelación?",
    "",
    ...MOTIVOS_CANCELACION.map((motivo, i) => `${i + 1}. ${motivo}`),
    "",
    "0. Volver atrás",
  ].join("\n");
}

function sedeElegida(texto: string): string | null {
  const t = sinTildes(texto).trim();
  const numero = t.match(/^\d{1,2}$/);
  if (numero) {
    const n = Number(numero[0]);
    return SEDES[n - 1] ?? null;
  }
  const hit = SEDES.find((nombre) => {
    const limpio = sinTildes(nombre);
    return t === limpio || t.includes(limpio);
  });
  if (hit) return hit;
  if (/\bcaba\b|recoleta|alvear|sede central/.test(t)) return "CABA";
  return null;
}

function opcionElegida(texto: string): (typeof OPCIONES)[number] | null {
  const t = sinTildes(texto).trim();
  const numero = t.match(/^\d$/);
  if (numero) return OPCIONES.find((item) => item.n === numero[0]) ?? null;
  if (/\bturno/.test(t)) return OPCIONES[0]!;
  if (/\bpago/.test(t)) return OPCIONES[1]!;
  if (/\breceta/.test(t)) return OPCIONES[2]!;
  return null;
}

function indice(texto: string, cantidad: number): number {
  const t = sinTildes(texto).trim();
  let valor = -1;
  if (/\bprimer/.test(t)) valor = 0;
  else if (/\bsegund/.test(t)) valor = 1;
  else if (/\btercer/.test(t)) valor = 2;
  else {
    const n = t.match(/^\d{1,2}$/);
    if (!n) return -1;
    valor = Number(n[0]) - 1;
  }
  return valor >= 0 && valor < cantidad ? valor : -1;
}

function dniDe(texto: string): string {
  return documentoDePersona(texto);
}

function emailDe(texto: string): string {
  return texto.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0]?.toLowerCase() ?? "";
}

function sexoDe(texto: string): "" | "masculino" | "femenino" {
  const t = sinTildes(texto);
  if (t === "1" || /\bfemenin|\bmujer\b/.test(t)) return "femenino";
  if (t === "2" || /\bmasculin|\bhombre\b|\bvaron\b/.test(t)) return "masculino";
  return "";
}

async function etiquetarNombres(
  conversation: WaConversation,
  nombres: string[],
  sedeExclusiva = false,
): Promise<string[]> {
  const pedidosNombres = nombres.map((n) => n.trim()).filter(Boolean);
  if (!pedidosNombres.length) return [];
  const esLocal = isLocalPruebaId(conversation.id) || Boolean(memoria);

  // Catálogo: en prueba local solo leemos (si ensure crea ids y falla el write, el CRM no los ve).
  // Lo que falte se completa con id sintético estable (listLocalSyntheticTags).
  let catalogo = memoria?.catalogo ?? null;
  try {
    if (!catalogo) catalogo = await listWhatsappTagCatalog();
    if (!esLocal) {
      const faltan = pedidosNombres.filter(
        (nombre) => !catalogo!.items.some((item) => sinTildes(item.name) === sinTildes(nombre)),
      );
      if (faltan.length) {
        try {
          catalogo = await ensureWhatsappTagsByName(faltan);
        } catch (error) {
          if (!isQuotaError(error)) throw error;
        }
      }
    }
    if (memoria) memoria.catalogo = catalogo;
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    catalogo = { groups: [], items: [] };
  }

  const grupoSedes = catalogo.groups.find((group) => sinTildes(group.name) === "sedes");
  const pedidos = pedidosNombres.map((nombre) => sinTildes(nombre));
  let ids = [...(conversation.tagIds ?? [])];
  if (sedeExclusiva && grupoSedes) {
    const sedes = new Set(catalogo.items.filter((item) => item.groupId === grupoSedes.id).map((item) => item.id));
    ids = ids.filter((id) => !sedes.has(id));
  }

  const aplicados: string[] = [];
  for (const nombre of pedidosNombres) {
    const real = catalogo.items.find((item) => sinTildes(item.name) === sinTildes(nombre));
    // Preferir id real del catálogo; si no está (cuota) y es prueba local, id sintético que el CRM resuelve.
    const id = real?.id ?? (esLocal ? localTagIdForName(nombre) : "");
    if (!id) continue;
    if (!ids.includes(id)) ids.push(id);
    aplicados.push(real?.name ?? nombre);
  }

  const quitar = new Set(
    pedidos.flatMap((nombre) => {
      if (nombre === "paciente") return ["no paciente"];
      if (nombre === "no paciente") return ["paciente"];
      if (nombre === "adulto") return ["infanto", "adolescente", "+60"];
      if (nombre === "infanto") return ["adulto", "adolescente", "+60"];
      return [];
    }),
  );
  if (quitar.size) {
    ids = ids.filter((id) => {
      const tag = catalogo.items.find((item) => item.id === id);
      if (tag) return !quitar.has(sinTildes(tag.name));
      return true;
    });
  }

  const cambio =
    ids.length !== (conversation.tagIds ?? []).length ||
    ids.some((id, index) => id !== conversation.tagIds?.[index]);
  if (cambio && !memoria) await setConversationTags(conversation.id, ids);
  conversation.tagIds = ids;
  if (memoria?.conversation?.id === conversation.id) {
    memoria.conversation.tagIds = ids;
  }
  return aplicados;
}

async function etiquetarSede(conversation: WaConversation, sede: string): Promise<void> {
  await etiquetarNombres(conversation, [sede], true);
}

const ASESOR_DEFAULT_NOMBRE = "Diego Abad";

/** Cuando el bot deja de atender: asignar a Diego Abad (operador o usuario). */
async function derivarAAsesor(conversation: WaConversation): Promise<void> {
  const esDiego = (nombre: string) => {
    const n = sinTildes(nombre);
    return n.includes("diego") && n.includes("abad");
  };
  let userId: string | null = null;
  let nombre = ASESOR_DEFAULT_NOMBRE;
  try {
    const ops = await listWhatsappOperators();
    const op = ops.find((item) => esDiego(item.nombre));
    if (op) {
      userId = op.id;
      nombre = op.nombre.trim() || ASESOR_DEFAULT_NOMBRE;
    }
  } catch {
    /* sin operadores */
  }
  if (!userId) {
    try {
      const users = await listUsersByStatus("approved");
      const u = users.find((item) => esDiego(item.nombre) || esDiego(item.email));
      if (u) {
        userId = u.id;
        nombre = u.nombre.trim() || ASESOR_DEFAULT_NOMBRE;
      }
    } catch {
      /* sin usuarios */
    }
  }
  if (!memoria) {
    await setConversationAssignee(conversation.id, {
      kind: "user",
      userId,
      name: nombre,
    });
  } else {
    memoria.conversation.assigneeKind = "user";
    memoria.conversation.assigneeUserId = userId;
    memoria.conversation.assigneeName = nombre;
  }
}

const TAG_COBERTURA_PARTICULAR = "Particular";
const TAG_COBERTURA_NO_SOPORTADA = "OS no soportada";

/** Etiquetas auxiliares del grupo (no son una prepaga/obra concreta). */
function esTagCoberturaMeta(nombre: string): boolean {
  const n = sinTildes(nombre);
  return (
    n === "con cobertura" ||
    n === "sin convenio" ||
    n === "sin cobertura" ||
    n === "no soportada" ||
    n === "os no soportada"
  );
}

function tagNoSoportada(items: { name: string }[]): string {
  return (
    items.find((item) => {
      const n = sinTildes(item.name);
      return (
        n === "os no soportada" ||
        n === "no soportada" ||
        n === "sin convenio" ||
        n === "sin cobertura"
      );
    })?.name || TAG_COBERTURA_NO_SOPORTADA
  );
}

/** Etiqueta del grupo Coberturas (IOMA, Swiss Medical, OSPIS, Prevención, Particular, OS no soportada). */
async function etiquetarCobertura(
  conversation: WaConversation,
  cobertura: string,
): Promise<void> {
  const crudo = cobertura.trim();
  if (!crudo) return;
  const catalogo = memoria?.catalogo ?? (await listWhatsappTagCatalog());
  if (memoria) memoria.catalogo = catalogo;
  const grupo = catalogo.groups.find((g) => sinTildes(g.name) === "coberturas");
  const items = grupo
    ? catalogo.items.filter((item) => item.groupId === grupo.id)
    : catalogo.items;
  const buscado = sinTildes(crudo);
  const esParticular =
    /\bparticular\b/.test(buscado) ||
    buscado === "sin obra social" ||
    buscado === "sin prepaga";

  let nombreTag = "";
  if (esParticular) {
    nombreTag =
      items.find((item) => sinTildes(item.name) === "particular")?.name || TAG_COBERTURA_PARTICULAR;
  } else {
    const candidatas = items
      .filter((item) => !esTagCoberturaMeta(item.name))
      .sort((a, b) => b.name.length - a.name.length);
    const match = candidatas.find((item) => {
      const n = sinTildes(item.name);
      if (n.length < 3) return false;
      // Coincidencia exacta o el texto incluye el nombre de la etiqueta (ej. "ioma 123").
      return n === buscado || buscado.includes(n) || (n.length >= 4 && n.includes(buscado));
    });
    nombreTag = match?.name || tagNoSoportada(items);
  }
  if (!nombreTag) return;

  // Una sola cobertura del grupo a la vez.
  if (grupo) {
    const idsGrupo = new Set(items.map((item) => item.id));
    conversation.tagIds = (conversation.tagIds ?? []).filter((id) => !idsGrupo.has(id));
  }
  await etiquetarNombres(conversation, [nombreTag]);
  // Ficha del contacto: guardar la cobertura (no solo la etiqueta).
  if (!memoria) {
    const updated = await fillEmptyContactFields(conversation.contactId, {
      cobertura: nombreTag,
    });
    if (updated) conversation.contact = updated;
  } else if (conversation.contact) {
    conversation.contact.cobertura = nombreTag;
  }
}

async function etiquetarParecido(conversation: WaConversation, texto: string): Promise<void> {
  const catalogo = memoria?.catalogo ?? (await listWhatsappTagCatalog());
  const grupoSedes = catalogo.groups.find((group) => sinTildes(group.name) === "sedes");
  const buscado = sinTildes(texto);
  const nombres = catalogo.items
    .filter((item) => item.groupId !== grupoSedes?.id)
    .map((item) => item.name)
    .filter((nombre) => {
      const limpio = sinTildes(nombre);
      return limpio.length >= 5 && (buscado.includes(limpio) || limpio.includes(buscado));
    });
  if (nombres.length) await etiquetarNombres(conversation, nombres);
}

function capitulo(markdown: string, pista: string): string {
  const lineas = markdown.replace(/\r\n/g, "\n").split("\n");
  let titulo = "";
  let cuerpo: string[] = [];
  const bloques: { titulo: string; texto: string }[] = [];
  const cerrar = () => {
    const texto = cuerpo.join("\n").trim();
    if (titulo && texto) bloques.push({ titulo, texto });
    cuerpo = [];
  };
  for (const linea of lineas) {
    if (/^##\s+/.test(linea)) {
      cerrar();
      titulo = linea.replace(/^##\s+/, "").trim();
    } else cuerpo.push(linea);
  }
  cerrar();
  const bloque = bloques.find((item) => sinTildes(item.titulo).includes(sinTildes(pista)));
  return bloque?.texto ?? "";
}

/** Parte sedes por ### / #### o por títulos **INECO …** (evita devolver toda una zona). */
function entradasDeSede(texto: string): { titulo: string; cuerpo: string }[] {
  const lineas = texto.replace(/\r\n/g, "\n").split("\n");
  const out: { titulo: string; cuerpo: string }[] = [];
  let titulo = "";
  let cuerpo: string[] = [];
  const cerrar = () => {
    const t = cuerpo.join("\n").trim();
    if (titulo || t) out.push({ titulo, cuerpo: t });
    cuerpo = [];
  };
  for (const linea of lineas) {
    const heading = linea.match(/^#{2,4}\s+(.+)$/);
    const negrita = linea.match(/^\*\*([^*]+)\*\*\s*$/);
    if (heading || negrita) {
      cerrar();
      titulo = (heading?.[1] ?? negrita?.[1] ?? "").trim();
      continue;
    }
    cuerpo.push(linea);
  }
  cerrar();
  return out;
}

function tituloEsSede(titulo: string, buscado: string): boolean {
  const t = sinTildes(titulo);
  if (!buscado || !t.includes(buscado)) return false;
  // "Gran Buenos Aires — Zona Oeste" no es una sede; "INECO Ramos Mejía" sí.
  if (/zona|gran buenos|interior|caba y|todas las/.test(t) && !/\bineco\b/.test(t)) return false;
  return (
    t === buscado ||
    t.startsWith(buscado) ||
    /\bineco\b/.test(t) ||
    new RegExp(`(?:^|\\W)${buscado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\W|$)`).test(t)
  );
}

/** WhatsApp: sin markdown crudo (** ## -). */
function textoPlanoWhatsapp(texto: string): string {
  return texto
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^[-*•]\s+/gm, "• ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Solo dirección / tel / WhatsApp / email; sin listados de servicios. */
function soloContactoSede(texto: string): string {
  return textoPlanoWhatsapp(texto)
    .split("\n")
    .filter((linea) => {
      const t = sinTildes(linea).replace(/^[•\-]\s*/, "");
      if (!t.trim()) return false;
      if (/^servicios?\b/.test(t)) return false;
      if (/\bservicios?\s*\(/.test(t)) return false;
      if (/^prestaciones?\b/.test(t)) return false;
      if (/^tratamientos?\b/.test(t) && !/\b(tel|whatsapp|email|mail|@)\b/.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function datosDeSede(markdown: string, sede: string): string {
  const texto = capitulo(markdown, "Sedes") || markdown;
  const buscado = sinTildes(sede);
  if (!buscado) return "";
  const entradas = entradasDeSede(texto);
  const porTitulo = entradas
    .filter((item) => tituloEsSede(item.titulo, buscado))
    .sort((a, b) => a.titulo.length - b.titulo.length);
  if (porTitulo[0]) {
    const { titulo, cuerpo } = porTitulo[0];
    const limpioTitulo = textoPlanoWhatsapp(titulo.replace(/^\*\*|\*\*$/g, ""));
    return soloContactoSede([limpioTitulo, cuerpo].filter(Boolean).join("\n")).slice(0, 900);
  }
  // Último recurso: párrafo que nombra la sede, sin arrastrar otra sede en negrita.
  const parrafo = texto
    .split(/\n\s*\n/)
    .map((parte) => parte.trim())
    .filter(Boolean)
    .find((parte) => {
      const limpio = sinTildes(parte);
      if (!limpio.includes(buscado)) return false;
      const otras = SEDES.map((nombre) => sinTildes(nombre)).filter((nombre) => nombre && nombre !== buscado);
      return !otras.some((otra) => limpio.includes(`ineco ${otra}`) || limpio.includes(`**ineco ${otra}`));
    });
  return soloContactoSede(parrafo ?? "").slice(0, 900);
}

async function mensajeDeSede(sede: string): Promise<string> {
  const conocimiento = memoria
    ? { text: memoria.conocimiento, updatedAt: "" }
    : await getWhatsappConocimiento();
  const datos = datosDeSede(conocimiento.text, sede);
  if (!datos) return `Anoté ${sede}. No hay un texto de contacto cargado para esa sucursal.`;
  return `Estos son los datos de ${sede}:\n\n${datos}`;
}

function fragmento(texto: string, nombre: string): string {
  const partes = texto.split(/\n\s*\n/).map((parte) => parte.trim()).filter(Boolean);
  const buscado = sinTildes(nombre);
  const propio = partes.find((parte) => buscado && sinTildes(parte).includes(buscado));
  return (propio || partes[0] || "").slice(0, 900);
}

function empujar(estado: MenuEstado): void {
  estado.pila = [...estado.pila, { paso: estado.paso, opciones: estado.opciones }].slice(-8);
}

async function preguntar(conversation: WaConversation, texto: string): Promise<void> {
  const limpio = texto.trim();
  // Si ya es un menú numerado con 0, no duplicamos la frase de volver.
  const conOpcionCero = /\n0\.\s/m.test(limpio) || /^0\.\s/m.test(limpio);
  await decir(conversation.id, conversation.contactId, conOpcionCero ? limpio : conVolver(limpio));
}

async function accion(
  _conversation: WaConversation,
  clave: Parameters<typeof ejecutarAccion>[0],
  consulta: string,
  ctx: Parameters<typeof ejecutarAccion>[2],
): Promise<SalidaAccion | null> {
  try {
    return memoria?.accion
      ? await memoria.accion(clave, consulta, ctx)
      : await ejecutarAccion(clave, consulta, ctx);
  } catch {
    // El caller recupera el flujo (menú de turnos / opciones). No filtramos el error crudo.
    return null;
  }
}

async function saludo(): Promise<string> {
  let data: Record<string, unknown> = {};
  try {
    const bot = await getWhatsappBotConfig();
    data = bot?.data ?? {};
  } catch {
    /* sin cuota / sin config: saludo default */
  }
  const identidad =
    data.identidad && typeof data.identidad === "object"
      ? (data.identidad as Record<string, unknown>)
      : {};
  const inicio =
    data.inicio && typeof data.inicio === "object" ? (data.inicio as Record<string, unknown>) : {};
  const nombre =
    (typeof identidad.nombre === "string" && identidad.nombre.trim()) ||
    (typeof identidad.nombreBot === "string" && identidad.nombreBot.trim()) ||
    "Nina";
  const plantilla =
    (typeof inicio.saludo === "string" && inicio.saludo.trim()) ||
    "¡{saludo}! Soy {nombreBot}, la asistente virtual de INECO.\nEste número de WhatsApp corresponde a nuestra sede central de CABA.";
  const texto = plantilla.replaceAll("{nombreBot}", nombre).replaceAll("{saludo}", trato(new Date()));
  const avisoUrgencias =
    "Este canal no atiende urgencias. Si las tiene, comuníquese con su médico o servicio de emergencias.";
  return `${texto}\n\n${avisoUrgencias}`;
}

/** Primeros mensajes al abrir una prueba del bot de opciones. */
export async function abrirBotMenu(conversationId: string): Promise<void> {
  const conversation = memoria?.conversation ?? (await getConversation(conversationId));
  if (!conversation?.contactId || conversation.pruebaMotor !== "menu") return;
  await decir(conversationId, conversation.contactId, await saludo());
  await decir(conversationId, conversation.contactId, listaSedes());
  await guardar(conversationId, vacio("sede"));
}

function ctxDe(estado: MenuEstado, telefono: string) {
  return {
    dni: estado.dni,
    nombre: estado.nombre,
    apellido: estado.apellido,
    sexo: estado.sexo,
    email: estado.email,
    telefono,
    textoPersona: `${estado.profesional} ${estado.tratamiento}`.trim(),
  };
}

function completarSexoDesdeNombre(estado: MenuEstado): void {
  if (estado.sexo) return;
  estado.sexo =
    sexoDesdeNombre(estado.nombre) ||
    sexoDesdeNombre(`${estado.nombre} ${estado.apellido}`);
}

function aplicarFicha(estado: MenuEstado, ficha?: {
  pacienteNombre?: string;
  pacienteApellido?: string;
  sexo?: "" | "masculino" | "femenino";
  email?: string;
  esPaciente?: "" | "si" | "no";
  dni?: string;
  fechaNacimiento?: string;
}): void {
  if (!ficha) return;
  if (ficha.dni) estado.dni = ficha.dni;
  if (ficha.esPaciente) estado.esPaciente = ficha.esPaciente;
  if (!estado.nombre && ficha.pacienteNombre) estado.nombre = ficha.pacienteNombre;
  if (!estado.apellido && ficha.pacienteApellido) estado.apellido = ficha.pacienteApellido;
  if (!estado.email && ficha.email) estado.email = ficha.email;
  if (!estado.sexo && ficha.sexo) estado.sexo = ficha.sexo;
  if (!estado.fechaNacimiento && ficha.fechaNacimiento) estado.fechaNacimiento = ficha.fechaNacimiento;
}

async function asegurarTelefono(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  if (estado.telefono.trim()) return;
  const contact = conversation.contact ?? (await getContact(conversation.contactId));
  estado.telefono = (contact?.phoneNumber ?? "").trim();
}

function lineaDato(etiqueta: string, valor: string): string {
  return `• ${etiqueta}: ${valor.trim() || "a completar"}`;
}

function lineaMatchCatalogo(etiqueta: string, dicho: string, catalogo: string): string {
  const d = dicho.trim();
  const c = catalogo.trim();
  if (c && d && sinTildes(c) !== sinTildes(d)) {
    return `• ${etiqueta}: ${c} (dijo: ${d})`;
  }
  return lineaDato(etiqueta, c || d);
}

function labelModalidadPedido(valor: MenuEstado["modalidad"]): string {
  if (valor === "presencial") return "Presencial";
  if (valor === "virtual") return "Virtual";
  if (valor === "indistinto") return "Indistinto";
  return "";
}

function resumenPedidoTurno(estado: MenuEstado): string {
  const quien = [estado.nombre, estado.apellido].filter(Boolean).join(" ");
  const grupo = grupoEtarioDeEstado(estado);
  const nac = estado.fechaNacimiento ? fechaNacimientoLegible(estado.fechaNacimiento) : "";
  const sexo =
    estado.sexo === "femenino" ? "Femenino" : estado.sexo === "masculino" ? "Masculino" : "";
  return [
    "Datos del pedido de turno:",
    "",
    lineaDato("DNI", estado.dni),
    lineaDato("Nombre y apellido", quien),
    lineaDato("Sexo", sexo),
    lineaDato("Mail", estado.email),
    lineaDato("Teléfono", estado.telefono),
    // Profesional: solo lo que dijo el paciente (el match queda interno para el equipo).
    lineaDato("Profesional", estado.profesional),
    lineaMatchCatalogo("Prestación / motivo", estado.tratamiento, estado.tratamientoCatalogo),
    lineaDato("Modalidad", labelModalidadPedido(estado.modalidad)),
    lineaDato("Cobertura", estado.cobertura),
    lineaDato("N° de afiliado", estado.nAfiliado),
    lineaDato("Fecha de nacimiento", nac),
    lineaDato("Edad", estado.edad),
    lineaDato("Grupo etario", grupo === "adulto" ? "Adulto" : grupo === "infanto" ? "Infanto" : ""),
    lineaDato("Paciente INECO", estado.esPaciente === "si" ? "Sí" : estado.esPaciente === "no" ? "No" : ""),
  ].join("\n");
}

function tokensMatch(texto: string): string[] {
  return sinTildes(texto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

function scoreMatchTexto(consulta: string, candidato: string): number {
  const pedidos = tokensMatch(consulta);
  const propios = tokensMatch(candidato);
  if (!pedidos.length || !propios.length) return 0;
  let puntos = 0;
  let hits = 0;
  for (const token of pedidos) {
    const exacto = propios.includes(token);
    const cerca = propios.some(
      (p) => p === token || (token.length >= 4 && (p.startsWith(token) || token.startsWith(p))),
    );
    if (!exacto && !cerca) continue;
    hits += 1;
    puntos += exacto ? token.length * 2 : token.length;
  }
  const c = sinTildes(consulta).trim();
  const n = sinTildes(candidato).trim();
  if (c && n && (n === c || n.includes(c) || c.includes(n))) puntos += Math.min(c.length, 12);
  if (!hits && puntos < 8) return 0;
  return puntos;
}

function mejorProfesionalCatalogo(
  config: BuscaTurnoConfig,
  dicho: string,
): BuscaTurnoProfesional | null {
  const texto = dicho.trim();
  if (!texto) return null;
  const lista = config.profesionales.filter((item) => item.enabled !== false);
  const puntuados = lista
    .map((item) => ({ item, puntos: scoreMatchTexto(texto, item.nombre) }))
    .filter((row) => row.puntos >= 4)
    .sort((a, b) => b.puntos - a.puntos);
  if (!puntuados.length) return null;
  const mejor = puntuados[0]!;
  const segundo = puntuados[1];
  if (segundo && segundo.puntos >= mejor.puntos * 0.85 && segundo.puntos >= mejor.puntos - 2) {
    // Ambiguo: preferir si el apellido (primer token Medexis) coincide fuerte.
    const apellido = tokensMatch(mejor.item.nombre)[0] ?? "";
    if (apellido && tokensMatch(texto).some((t) => t === apellido || apellido.startsWith(t))) {
      return mejor.item;
    }
    return null;
  }
  return mejor.item;
}

/** Etario implícito en el nombre de la prestación (infantil ≠ adulto). */
function etarioDePrestacionNombre(nombre: string): "" | "infanto" | "adulto" {
  const t = sinTildes(nombre);
  if (
    /\binfantil\b|\binfanto\b|\bnin[o0]s?\b|\bninos?\b|\bpediatr|\badolec|\badolesc/.test(t)
  ) {
    return "infanto";
  }
  if (/\badulto?s?\b|\bmayores\b|\bgeriatr/.test(t)) return "adulto";
  return "";
}

function modalidadDePrestacionNombre(nombre: string): "virtual" | "presencial" {
  const t = sinTildes(nombre);
  if (/\bonline\b|\bvirtual\b|\bvideoconsulta\b|\bvideo\s*consulta\b|\btelemedicina\b/.test(t)) {
    return "virtual";
  }
  return "presencial";
}

type PrestacionMatchOpts = {
  profesionalDoc?: string;
  modalidad?: MenuEstado["modalidad"];
  grupoEtario?: "" | "infanto" | "adulto";
};

function mejorPrestacionCatalogo(
  config: BuscaTurnoConfig,
  dicho: string,
  opts: PrestacionMatchOpts | string = {},
): { codigo: string; prestacion: BuscaTurnoPrestacion } | null {
  // Compat: llamadas viejas pasaban solo el doc del profesional.
  const opciones: PrestacionMatchOpts =
    typeof opts === "string" ? { profesionalDoc: opts } : opts ?? {};
  const texto = dicho.trim();
  if (!texto) return null;
  const todas = Object.entries(config.prestaciones).filter(([, item]) => item.enabled !== false);
  // Con profesional match: solo trámites de ese dr (sin caer al catálogo global).
  let candidatos = opciones.profesionalDoc
    ? todas.filter(([, item]) =>
        (item.profesionales ?? []).some((p) => String(p.doc) === String(opciones.profesionalDoc)),
      )
    : todas;
  if (!candidatos.length) return null;

  const modalidadPedida = opciones.modalidad || "";
  const grupoPedido = opciones.grupoEtario || "";

  // Filtrar incompatibles: adulto + presencial no debe caer en "infantil online".
  if (modalidadPedida === "presencial" || modalidadPedida === "virtual") {
    const filtrados = candidatos.filter(
      ([, item]) => modalidadDePrestacionNombre(item.nombre || "") === modalidadPedida,
    );
    if (filtrados.length) candidatos = filtrados;
  }
  if (grupoPedido === "adulto" || grupoPedido === "infanto") {
    const filtrados = candidatos.filter(([, item]) => {
      const e = etarioDePrestacionNombre(item.nombre || "");
      // Neutras (sin marca) sirven; las del otro grupo no.
      return !e || e === grupoPedido;
    });
    if (filtrados.length) candidatos = filtrados;
  }

  const ranking = candidatos
    .map(([codigo, prestacion]) => {
      const nombre = prestacion.nombre || "";
      let puntos = Math.max(scoreMatchTexto(texto, nombre), scoreMatchTexto(texto, codigo));
      // Bonus si modalidad/etario coinciden explícitamente.
      if (
        modalidadPedida &&
        modalidadPedida !== "indistinto" &&
        modalidadDePrestacionNombre(nombre) === modalidadPedida
      ) {
        puntos += 6;
      }
      const etarioNom = etarioDePrestacionNombre(nombre);
      if (grupoPedido && etarioNom === grupoPedido) puntos += 8;
      // Penalizar fuerte el cruce (por si el filtro no alcanzó).
      if (grupoPedido === "adulto" && etarioNom === "infanto") puntos -= 40;
      if (grupoPedido === "infanto" && etarioNom === "adulto") puntos -= 40;
      if (modalidadPedida === "presencial" && modalidadDePrestacionNombre(nombre) === "virtual") {
        puntos -= 30;
      }
      if (modalidadPedida === "virtual" && modalidadDePrestacionNombre(nombre) === "presencial") {
        puntos -= 20;
      }
      return { codigo, prestacion, puntos };
    })
    .filter((row) => row.puntos >= 4)
    .sort((a, b) => b.puntos - a.puntos);
  if (!ranking.length) return null;
  const mejor = ranking[0]!;
  // Si el "mejor" sigue siendo incompatible, no forzar: que elija el operador.
  const nombreMejor = mejor.prestacion.nombre || "";
  if (grupoPedido === "adulto" && etarioDePrestacionNombre(nombreMejor) === "infanto") return null;
  if (grupoPedido === "infanto" && etarioDePrestacionNombre(nombreMejor) === "adulto") return null;
  if (
    modalidadPedida === "presencial" &&
    modalidadDePrestacionNombre(nombreMejor) === "virtual"
  ) {
    return null;
  }
  const segundo = ranking[1];
  if (segundo && segundo.puntos >= mejor.puntos * 0.9 && segundo.puntos >= mejor.puntos - 2) {
    return null;
  }
  return { codigo: mejor.codigo, prestacion: mejor.prestacion };
}

function modalidadDePedido(texto: string): MenuEstado["modalidad"] {
  const t = sinTildes(texto);
  if (!t.trim()) return "";
  if (/\bindistinto\b|\bcualquiera\b|\bda igual\b|\bambas\b|\bno importa\b|\bcualquier modalidad\b/.test(t)) {
    return "indistinto";
  }
  if (/\bvirtual\b|\bonline\b|\bvideoconsulta\b|\bvideo\s*consulta\b|\btelemedicina\b/.test(t)) {
    return "virtual";
  }
  if (/\bpresencial\b|\ben consultorio\b|\ben sede\b|\ben el centro\b/.test(t)) {
    return "presencial";
  }
  return "";
}

/** Match interno contra BuscaTurno (el paciente puede escribir libre; el equipo ve el catálogo). */
async function matchearPedidoConCatalogo(estado: MenuEstado): Promise<void> {
  try {
    const config = await getBuscaTurnoConfig();
    if (!config) return;
    const prof =
      mejorProfesionalCatalogo(config, estado.profesional) ||
      (!estado.profesionalCatalogo
        ? null
        : mejorProfesionalCatalogo(config, estado.profesionalCatalogo));
    if (prof) {
      estado.profesionalCatalogo = prof.nombre;
      estado.profesionalDoc = String(prof.doc ?? "").trim();
    }
    // Prestación: trámites del dr + modalidad + grupo etario (adulto ≠ infantil online).
    const dichoPrest = estado.tratamiento.trim();
    const prest = mejorPrestacionCatalogo(config, dichoPrest || estado.tratamientoCatalogo, {
      profesionalDoc: prof?.doc,
      modalidad: estado.modalidad,
      grupoEtario: grupoEtarioDeEstado(estado),
    });
    if (prest) {
      estado.tratamientoCatalogo = prest.prestacion.nombre?.trim() || prest.codigo;
      estado.prestacionCodigo = prest.codigo;
    } else {
      // Sin match claro: el operador elige en Busca Turno.
      estado.tratamientoCatalogo = "";
      estado.prestacionCodigo = "";
    }
  } catch {
    /* sin catálogo no bloqueamos el pedido */
  }
}

function fechaNacimientoDe(texto: string): string {
  const t = texto.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const latam = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (latam) {
    const dia = latam[1]!.padStart(2, "0");
    const mes = latam[2]!.padStart(2, "0");
    const anio = latam[3]!;
    const cuando = new Date(`${anio}-${mes}-${dia}T12:00:00-03:00`);
    if (Number.isNaN(cuando.getTime())) return "";
    return `${anio}-${mes}-${dia}`;
  }
  return "";
}

function fechaNacimientoLegible(valor: string): string {
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return valor;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** 18 o más → adulto; menos de 18 → infanto. */
function grupoEtarioDeEdad(edad: number): "" | "infanto" | "adulto" {
  if (!Number.isFinite(edad) || edad < 0 || edad > 120) return "";
  return edad >= 18 ? "adulto" : "infanto";
}

function edadAniosDeFecha(fecha: string): number | null {
  const m = fecha.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const anio = Number(m[1]);
  // Fechas placeholder / basura de sistemas (ej. 0001, 1900, hoy por default).
  if (anio < 1920 || anio > new Date().getFullYear()) return null;
  const hoyTxt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (`${m[1]}-${m[2]}-${m[3]}` === hoyTxt) return null;
  const nacimiento = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00-03:00`);
  if (Number.isNaN(nacimiento.getTime())) return null;
  const [y, mes, dia] = hoyTxt.split("-").map(Number);
  let edad = y! - anio;
  if (mes! < Number(m[2]) || (mes === Number(m[2]) && dia! < Number(m[3]))) edad -= 1;
  if (!Number.isFinite(edad) || edad < 0 || edad > 120) return null;
  return edad;
}

function grupoEtarioDeFecha(fecha: string): "" | "infanto" | "adulto" {
  const edad = edadAniosDeFecha(fecha);
  return edad == null ? "" : grupoEtarioDeEdad(edad);
}

function grupoEtarioDeEstado(estado: MenuEstado): "" | "infanto" | "adulto" {
  const porFecha = grupoEtarioDeFecha(estado.fechaNacimiento);
  if (porFecha) return porFecha;
  // Importante: "" → Number("") = 0; no tratar “sin edad” como 0 años (Infanto).
  const crudo = String(estado.edad ?? "").replace(/\D/g, "").trim();
  if (!crudo) return "";
  return grupoEtarioDeEdad(Number(crudo));
}

const TEXTO_PRIMERA_VEZ_PEDIR = [
  "Para darle orientación personalizada sobre atención en INECO Clínica Sede Central CABA (Marcelo T. de Alvear 1652), envíanos en un solo mensaje:",
  "• Edad de la persona",
  "• Motivo de la consulta",
  "• Cobertura",
  "• Nombre y apellido, mail y celular",
].join("\n");

const TEXTO_PRIMERA_VEZ_CIERRE =
  "Gracias. Un asesor continuará la conversación a la brevedad.";

async function sincronizarPacienteYEdad(
  conversation: WaConversation,
  estado: MenuEstado,
): Promise<void> {
  const grupo = grupoEtarioDeEstado(estado);
  const tags: string[] = [];
  if (estado.esPaciente === "si") tags.push("Paciente");
  if (estado.esPaciente === "no") tags.push("No paciente");
  if (grupo === "adulto") tags.push("Adulto");
  if (grupo === "infanto") tags.push("Infanto");
  if (tags.length) await etiquetarNombres(conversation, tags);
  // Si no hay edad/fecha confiable, sacar Infanto/Adulto que hayan quedado de antes.
  if (!grupo) await quitarEtiquetasEdad(conversation);

  if (!memoria) {
    const updated = await fillEmptyContactFields(conversation.contactId, {
      esPaciente: estado.esPaciente === "si" || estado.esPaciente === "no" ? estado.esPaciente : "",
      grupoEtario: grupo || "",
      pacienteNombre: estado.nombre || undefined,
      pacienteApellido: estado.apellido || undefined,
      dni: estado.dni || undefined,
      sexo: estado.sexo || undefined,
      email: estado.email || undefined,
      cobertura: estado.cobertura || undefined,
    });
    if (updated) conversation.contact = updated;
  } else if (conversation.contact) {
    if (estado.esPaciente === "si") conversation.contact.esPaciente = true;
    if (estado.esPaciente === "no") conversation.contact.esPaciente = false;
    if (grupo) conversation.contact.grupoEtario = grupo;
    if (estado.sexo) conversation.contact.sexo = estado.sexo;
    if (estado.cobertura.trim()) conversation.contact.cobertura = estado.cobertura.trim();
  }
}

async function quitarEtiquetasEdad(conversation: WaConversation): Promise<void> {
  const catalogo = memoria?.catalogo ?? (await listWhatsappTagCatalog());
  const quitar = new Set(["infanto", "adulto", "adolescente", "+60"]);
  const ids = (conversation.tagIds ?? []).filter((id) => {
    const tag = catalogo.items.find((item) => item.id === id);
    return !tag || !quitar.has(sinTildes(tag.name));
  });
  if (ids.length === (conversation.tagIds ?? []).length) return;
  if (!memoria) await setConversationTags(conversation.id, ids);
  conversation.tagIds = ids;
}

async function volverTurnos(
  conversation: WaConversation,
  estado: MenuEstado,
  previo = "",
): Promise<void> {
  const siguiente = vacio("turnos", { ...estado, pendiente: "", opciones: [], anularLuego: "", modo: "" });
  await guardar(conversation.id, siguiente);
  // Listado / confirmación en un globo; el menú de turnos en otro.
  if (previo.trim()) {
    await decir(conversation.id, conversation.contactId, previo.trim());
  }
  await decir(conversation.id, conversation.contactId, listaTurnos());
}

async function pedirDni(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  empujar(estado);
  estado.paso = "dni";
  await guardar(conversation.id, estado);
  await preguntar(
    conversation,
    "Pasame el DNI del paciente, sin puntos ni espacios.",
  );
}

async function botMenuDaTurnos(): Promise<boolean> {
  const bot = await getWhatsappBotConfig();
  return botDaTurnos(bot?.data ?? {});
}

async function cerrarTurnoParaOperador(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  await asegurarTelefono(conversation, estado);
  // Completar edad desde fecha si el paciente no la escribió.
  if (!estado.edad.trim() && estado.fechaNacimiento.trim()) {
    const anios = edadAniosDeFecha(estado.fechaNacimiento);
    if (anios != null) estado.edad = String(anios);
  }
  // Sexo solo acá (al cerrar el pedido), no en el DNI: menos writes/llamados.
  completarSexoDesdeNombre(estado);
  await matchearPedidoConCatalogo(estado);
  await sincronizarPacienteYEdad(conversation, estado);
  // Derivación ya hecha: etiquetas + asignación al equipo. Un solo cierre; el menú sigue.
  await etiquetarNombres(conversation, ["Derivado a asesor", "pedir-turno", "turnos"]);
  await etiquetarCobertura(conversation, estado.cobertura);
  await etiquetarParecido(
    conversation,
    [estado.profesionalCatalogo || estado.profesional, estado.tratamientoCatalogo || estado.tratamiento]
      .filter(Boolean)
      .join(" "),
  );
  await derivarAAsesor(conversation);
  await decir(conversation.id, conversation.contactId, resumenPedidoTurno(estado));
  // Cierre final: sin menú “¿algo más?”.
  await guardar(
    conversation.id,
    vacio("sede", {
      ...estado,
      modo: "",
      pendiente: "",
      opciones: [],
      pila: [],
    }),
  );
  await decir(conversation.id, conversation.contactId, TEXTO_TURNO_DATOS_LISTOS);
}

function camposFaltantesPedido(estado: MenuEstado): CampoPedido[] {
  const faltan: CampoPedido[] = [];
  if (!estado.profesional.trim()) faltan.push("profesional");
  if (!estado.tratamiento.trim()) faltan.push("tratamiento");
  if (!estado.modalidad) faltan.push("modalidad");
  if (!estado.nombre.trim()) faltan.push("nombre");
  if (!estado.apellido.trim()) faltan.push("apellido");
  if (!estado.dni.trim()) faltan.push("dni");
  if (!estado.email.trim()) faltan.push("email");
  if (!estado.telefono.trim()) faltan.push("telefono");
  if (!estado.cobertura.trim()) faltan.push("cobertura");
  if (!estado.nAfiliado.trim()) faltan.push("nAfiliado");
  if (!estado.fechaNacimiento.trim()) faltan.push("fechaNacimiento");
  return faltan;
}

function etiquetaListaPedido(campos: CampoPedido[]): string[] {
  const set = new Set(campos);
  const out: string[] = [];
  if (set.has("profesional")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.profesional}`);
  if (set.has("tratamiento")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.tratamiento}`);
  if (set.has("modalidad")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.modalidad}`);
  if (set.has("nombre") && set.has("apellido")) out.push("• Nombre del paciente");
  else {
    if (set.has("nombre")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.nombre}`);
    if (set.has("apellido")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.apellido}`);
  }
  if (set.has("dni")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.dni}`);
  if (set.has("email")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.email}`);
  if (set.has("telefono")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.telefono}`);
  if (set.has("cobertura")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.cobertura}`);
  if (set.has("nAfiliado")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.nAfiliado}`);
  if (set.has("fechaNacimiento")) out.push(`• ${ETIQUETA_CAMPO_PEDIDO.fechaNacimiento}`);
  return out;
}

function mensajePedirDatosJuntos(_estado: MenuEstado, faltan: CampoPedido[]): string {
  return [
    "Para pedirte el turno, mandame en un solo mensaje estos datos:",
    "",
    ...etiquetaListaPedido(faltan),
  ].join("\n");
}

type PedidoExtraido = {
  dni: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  profesional: string;
  prestacion: string;
  profesionalCatalogo: string;
  prestacionCatalogo: string;
  modalidad: string;
  cobertura: string;
  nAfiliado: string;
  fechaNacimiento: string;
  sexo: string;
};

function nombresPrestacionesDeProf(
  config: BuscaTurnoConfig,
  profesionalDoc?: string,
): string[] {
  const todas = Object.entries(config.prestaciones).filter(([, item]) => item.enabled !== false);
  const filas = profesionalDoc
    ? todas.filter(([, item]) =>
        (item.profesionales ?? []).some((p) => String(p.doc) === String(profesionalDoc)),
      )
    : todas;
  return filas
    .map(([, item]) => item.nombre.trim())
    .filter(Boolean)
    .slice(0, 160);
}

async function listasCatalogoPedido(profesionalDoc?: string): Promise<{
  profesionales: string[];
  prestaciones: string[];
}> {
  try {
    const config = await getBuscaTurnoConfig();
    if (!config) return { profesionales: [], prestaciones: [] };
    const profesionales = config.profesionales
      .filter((item) => item.enabled !== false)
      .map((item) => item.nombre.trim())
      .filter(Boolean)
      .slice(0, 120);
    return {
      profesionales,
      prestaciones: nombresPrestacionesDeProf(config, profesionalDoc),
    };
  } catch {
    return { profesionales: [], prestaciones: [] };
  }
}

function pedidoExtraidoVacio(): PedidoExtraido {
  return {
    dni: "",
    nombre: "",
    apellido: "",
    email: "",
    telefono: "",
    profesional: "",
    prestacion: "",
    profesionalCatalogo: "",
    prestacionCatalogo: "",
    modalidad: "",
    cobertura: "",
    nAfiliado: "",
    fechaNacimiento: "",
    sexo: "",
  };
}

/** Parseo sin IA para mensajes tipo: «cetkovich consulta psiquiatrica prevencion 123456 22/06/1989». */
function extractPedidoHeuristico(
  texto: string,
  config?: BuscaTurnoConfig | null,
): PedidoExtraido {
  const out = pedidoExtraidoVacio();
  let resto = texto.replace(/\s+/g, " ").trim();
  if (!resto) return out;

  const fechaMatch = resto.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}|\d{4}-\d{2}-\d{2})\b/);
  if (fechaMatch?.[1]) {
    out.fechaNacimiento = fechaNacimientoDe(fechaMatch[1]) || "";
    resto = resto.replace(fechaMatch[0], " ");
  }

  const mail = emailDe(resto);
  if (mail) {
    out.email = mail;
    resto = resto.replace(mail, " ");
  }

  const modalidad = modalidadDePedido(resto);
  if (modalidad) {
    out.modalidad = modalidad;
    resto = resto
      .replace(/\bindistinto\b|\bcualquiera\b|\bda igual\b|\bambas\b|\bno importa\b/gi, " ")
      .replace(/\bvirtual\b|\bonline\b|\bvideoconsulta\b|\bvideo\s*consulta\b|\btelemedicina\b/gi, " ")
      .replace(/\bpresencial\b|\ben consultorio\b|\ben sede\b|\ben el centro\b/gi, " ");
  }

  const coberturas: { re: RegExp; nombre: string }[] = [
    { re: /\bswiss\s*medical\b/i, nombre: "Swiss Medical" },
    { re: /\bprevenci[oó]n\b/i, nombre: "Prevención" },
    { re: /\biospis\b/i, nombre: "OSPIS" },
    { re: /\bioma\b/i, nombre: "IOMA" },
    { re: /\bparticular\b/i, nombre: "Particular" },
    { re: /\bosde\b/i, nombre: "OSDE" },
    { re: /\bpami\b/i, nombre: "PAMI" },
    { re: /\bgaleno\b/i, nombre: "Galeno" },
    { re: /\bmedicus\b/i, nombre: "Medicus" },
    { re: /\bomint\b/i, nombre: "Omint" },
  ];
  for (const item of coberturas) {
    if (item.re.test(resto)) {
      out.cobertura = item.nombre;
      resto = resto.replace(item.re, " ");
      break;
    }
  }

  const nums = [...resto.matchAll(/\b(\d{5,11})\b/g)].map((m) => m[1]!).filter(Boolean);
  for (const n of nums) {
    if (!out.nAfiliado && (out.cobertura || n.length <= 10)) {
      out.nAfiliado = n;
      resto = resto.replace(n, " ");
      break;
    }
  }
  for (const n of [...resto.matchAll(/\b(\d{7,8})\b/g)].map((m) => m[1]!)) {
    if (!out.dni) {
      out.dni = n;
      resto = resto.replace(n, " ");
      break;
    }
  }

  resto = resto.replace(/\s+/g, " ").trim();
  if (config) {
    const prof = mejorProfesionalCatalogo(config, resto);
    if (prof) {
      out.profesionalCatalogo = prof.nombre;
      const tokensProf = tokensMatch(prof.nombre);
      const dichos = tokensMatch(resto);
      const usados = dichos.filter((t) =>
        tokensProf.some((p) => p === t || p.startsWith(t) || t.startsWith(p)),
      );
      out.profesional = usados.length ? usados.join(" ") : resto.split(" ")[0] || prof.nombre;
      for (const t of usados) {
        resto = resto.replace(new RegExp(`\\b${t}\\b`, "ig"), " ");
      }
      if (!usados.length && out.profesional) {
        resto = resto.replace(new RegExp(`\\b${out.profesional}\\b`, "ig"), " ");
      }
      resto = resto.replace(/\s+/g, " ").trim();
      const prest = mejorPrestacionCatalogo(config, resto, {
        profesionalDoc: prof.doc,
        modalidad: (out.modalidad as MenuEstado["modalidad"]) || "",
      });
      if (prest) {
        out.prestacionCatalogo = prest.prestacion.nombre?.trim() || prest.codigo;
        out.prestacion = resto || out.prestacionCatalogo;
        resto = "";
      }
    }
  }

  const palabras = resto.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!out.profesional && palabras.length) {
    out.profesional = palabras[0]!;
    out.prestacion = palabras.slice(1).join(" ");
  } else if (!out.prestacion && palabras.length) {
    out.prestacion = palabras.join(" ");
  }

  if (!out.sexo && out.nombre) {
    out.sexo = sexoDesdeNombre(out.nombre) || "";
  }
  return out;
}

function mergePedidoExtraido(base: PedidoExtraido, extra: PedidoExtraido): PedidoExtraido {
  const pick = (a: string, b: string) => (b.trim() ? b.trim() : a.trim());
  return {
    dni: pick(base.dni, extra.dni),
    nombre: pick(base.nombre, extra.nombre),
    apellido: pick(base.apellido, extra.apellido),
    email: pick(base.email, extra.email),
    telefono: pick(base.telefono, extra.telefono),
    profesional: pick(base.profesional, extra.profesional),
    prestacion: pick(base.prestacion, extra.prestacion),
    profesionalCatalogo: pick(base.profesionalCatalogo, extra.profesionalCatalogo),
    prestacionCatalogo: pick(base.prestacionCatalogo, extra.prestacionCatalogo),
    modalidad: pick(base.modalidad, extra.modalidad),
    cobertura: pick(base.cobertura, extra.cobertura),
    nAfiliado: pick(base.nAfiliado, extra.nAfiliado),
    fechaNacimiento: pick(base.fechaNacimiento, extra.fechaNacimiento),
    sexo: pick(base.sexo, extra.sexo),
  };
}

async function parsearPedidoDatosConIa(
  conversationId: string,
  texto: string,
  faltan: CampoPedido[],
): Promise<PedidoExtraido> {
  let modelo = MODELO_PEDIDO_DATOS;
  try {
    const bot = await getWhatsappBotConfig();
    const rawModelos =
      bot?.data && typeof bot.data === "object"
        ? (bot.data as { modelos?: { detectar?: unknown } }).modelos
        : undefined;
    if (typeof rawModelos?.detectar === "string" && rawModelos.detectar.trim()) {
      modelo = rawModelos.detectar.trim();
    }
  } catch {
    /* sin config Firebase: seguimos con el modelo default */
  }
  let config: BuscaTurnoConfig | null = null;
  try {
    config = await getBuscaTurnoConfig();
  } catch {
    config = null;
  }
  const heuristico = extractPedidoHeuristico(texto, config);
  const profDoc =
    config && heuristico.profesionalCatalogo
      ? mejorProfesionalCatalogo(config, heuristico.profesionalCatalogo)?.doc
      : undefined;
  const catalogo = await listasCatalogoPedido(profDoc);

  try {
    const ia = await completeStructured<PedidoExtraido>({
      conversacionId: conversationId,
      paso: "detectar",
      modelo,
      reasoningEffort: "low",
      skipUsage: isLocalPruebaId(conversationId),
      schemaName: "pedido_turno_datos",
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "dni",
          "nombre",
          "apellido",
          "email",
          "telefono",
          "profesional",
          "prestacion",
          "profesionalCatalogo",
          "prestacionCatalogo",
          "modalidad",
          "cobertura",
          "nAfiliado",
          "fechaNacimiento",
          "sexo",
        ],
        properties: {
          dni: { type: "string" },
          nombre: { type: "string" },
          apellido: { type: "string" },
          email: { type: "string" },
          telefono: { type: "string" },
          profesional: { type: "string" },
          prestacion: { type: "string" },
          profesionalCatalogo: { type: "string" },
          prestacionCatalogo: { type: "string" },
          modalidad: { type: "string", enum: ["", "presencial", "virtual", "indistinto"] },
          cobertura: { type: "string" },
          nAfiliado: { type: "string" },
          fechaNacimiento: { type: "string" },
          sexo: { type: "string", enum: ["", "masculino", "femenino"] },
        },
      },
      instructions: [
        "Extraé datos de un mensaje de WhatsApp para un pedido de turno en INECO (Argentina).",
        "Devolvé solo JSON con el schema. Si un dato no está, dejá string vacío.",
        "No inventes datos. Separá nombre y apellido si vienen juntos.",
        "fechaNacimiento en YYYY-MM-DD si podés; si viene dd/mm/aaaa, convertí.",
        "profesional = como lo escribió el paciente (puede ser parcial o con typos).",
        "prestacion = prestación, tratamiento, consulta o motivo que pide (texto libre del paciente).",
        "profesionalCatalogo = si el profesional matchea con la lista, copiá el nombre EXACTO de la lista; si no hay match claro, vacío.",
        "prestacionCatalogo = si la prestación/motivo matchea con la lista, copiá el nombre EXACTO; si no, vacío. Si la lista es de un profesional concreto, elegí solo de esa lista.",
        "modalidad = presencial, virtual o indistinto (si dice cualquiera/da igual). Si no lo dice, vacío.",
        "cobertura: obra social/prepaga (Prevención, IOMA, Swiss Medical, OSPIS, particular…).",
        "nAfiliado: número de afiliado; si dice particular o no tiene, usá «particular».",
        "sexo=masculino o femenino si el texto lo dice (hombre/mujer) o si el nombre de pila lo deja claro (Ana→femenino, Diego/Juan→masculino). Si el nombre es ambiguo (Alex), vacío.",
        `Campos que necesitamos ubicar ahora: ${faltan.map((c) => ETIQUETA_CAMPO_PEDIDO[c]).join(", ")}.`,
        catalogo.profesionales.length
          ? `Lista de profesionales (elegí profesionalCatalogo solo de acá):\n${catalogo.profesionales.join("\n")}`
          : "",
        catalogo.prestaciones.length
          ? `Lista de prestaciones${profDoc ? " de ese profesional" : ""} (elegí prestacionCatalogo solo de acá):\n${catalogo.prestaciones.join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      content: `Mensaje del paciente:\n${texto}`,
    });
    // La IA pisa el heurístico cuando trae dato; si falla un campo, queda el heurístico.
    return mergePedidoExtraido(heuristico, ia);
  } catch (error) {
    console.warn(
      "[bot-menu] parseo IA del pedido falló; uso heurístico",
      error instanceof Error ? error.message : error,
    );
    return heuristico;
  }
}

function aplicarPedidoExtraido(estado: MenuEstado, extraido: PedidoExtraido, faltan: CampoPedido[]): void {
  const puede = (clave: CampoPedido) => faltan.includes(clave) || !String(estado[clave] ?? "").trim();

  if (puede("dni")) {
    const dni = documentoDePersona(extraido.dni) || extraido.dni.replace(/\D/g, "").trim();
    if (dni) estado.dni = dni;
  }
  if (puede("telefono") && extraido.telefono.trim()) {
    estado.telefono = extraido.telefono.trim();
  }
  if (puede("nombre") && extraido.nombre.trim()) estado.nombre = extraido.nombre.trim();
  if (puede("apellido") && extraido.apellido.trim()) estado.apellido = extraido.apellido.trim();
  if (puede("email")) {
    const mail = emailDe(extraido.email);
    if (mail) estado.email = mail;
  }
  if (puede("profesional") && extraido.profesional.trim()) {
    estado.profesional = extraido.profesional.trim();
  }
  if (puede("tratamiento") && extraido.prestacion.trim()) {
    estado.tratamiento = extraido.prestacion.trim();
  }
  if (extraido.profesionalCatalogo?.trim()) {
    estado.profesionalCatalogo = extraido.profesionalCatalogo.trim();
  }
  if (extraido.prestacionCatalogo?.trim()) {
    estado.tratamientoCatalogo = extraido.prestacionCatalogo.trim();
  }
  if (!estado.modalidad) {
    const mod = modalidadDePedido(extraido.modalidad);
    if (mod) estado.modalidad = mod;
  }
  if (puede("cobertura") && extraido.cobertura.trim()) {
    estado.cobertura = extraido.cobertura.trim();
  }
  if (puede("nAfiliado") && extraido.nAfiliado.trim()) {
    estado.nAfiliado = extraido.nAfiliado.trim();
  }
  if (puede("fechaNacimiento")) {
    const fecha = fechaNacimientoDe(extraido.fechaNacimiento) || fechaNacimientoDe(
      extraido.fechaNacimiento.replace(/\s+/g, ""),
    );
    if (fecha) estado.fechaNacimiento = fecha;
  }

  // Si mandó "Nombre Apellido" solo en nombre y pedíamos ambos.
  if (faltan.includes("apellido") && !estado.apellido.trim() && estado.nombre.includes(" ")) {
    const partes = estado.nombre.trim().split(/\s+/);
    if (partes.length >= 2) {
      estado.nombre = partes[0]!;
      estado.apellido = partes.slice(1).join(" ");
    }
  }

  // Sexo desde IA o por nombre de pila.
  if (!estado.sexo) {
    const dicho = sexoDe(extraido.sexo || "");
    const delSchema =
      extraido.sexo === "masculino" || extraido.sexo === "femenino" ? extraido.sexo : dicho;
    estado.sexo =
      delSchema ||
      sexoDesdeNombre(estado.nombre) ||
      sexoDesdeNombre(`${estado.nombre} ${estado.apellido}`);
  }
}

/** Pedido al equipo: un mensaje pidiendo todo lo que falte; la IA ubica la respuesta. */
async function pedirSiguienteDatoPedido(
  conversation: WaConversation,
  estado: MenuEstado,
): Promise<void> {
  await asegurarTelefono(conversation, estado);
  const faltan = camposFaltantesPedido(estado);
  if (!faltan.length) {
    await cerrarTurnoParaOperador(conversation, estado);
    return;
  }
  estado.pedidoIntro = true;
  estado.paso = "pedidoDatos";
  estado.opciones = [];
  await guardar(conversation.id, estado);
  await preguntar(conversation, mensajePedirDatosJuntos(estado, faltan));
}

async function recibirPedidoDatosJuntos(
  conversation: WaConversation,
  estado: MenuEstado,
  texto: string,
): Promise<void> {
  const faltanAntes = camposFaltantesPedido(estado);
  if (!faltanAntes.length) {
    await cerrarTurnoParaOperador(conversation, estado);
    return;
  }
  try {
    const extraido = await parsearPedidoDatosConIa(conversation.id, texto, faltanAntes);
    aplicarPedidoExtraido(estado, extraido, faltanAntes);
    await matchearPedidoConCatalogo(estado);
    await sincronizarPacienteYEdad(conversation, estado);
  } catch (error) {
    console.warn(
      "[bot-menu] pedido datos",
      error instanceof Error ? error.message : error,
    );
    await preguntar(
      conversation,
      [
        "No pude leer bien esos datos. Mandamelos de nuevo en un solo mensaje.",
        "",
        ...etiquetaListaPedido(faltanAntes),
      ].join("\n"),
    );
    return;
  }

  const faltan = camposFaltantesPedido(estado);
  if (!faltan.length) {
    await cerrarTurnoParaOperador(conversation, estado);
    return;
  }

  // Si no avanzó nada, pedir de nuevo sin cerrar.
  const avanzó = faltanAntes.some((campo) => !faltan.includes(campo));
  estado.paso = "pedidoDatos";
  await guardar(conversation.id, estado);
  await preguntar(
    conversation,
    [
      avanzó
        ? "Me faltan algunos datos. Mandamelos en un solo mensaje:"
        : "No pude ubicar los datos. Mandamelos en un solo mensaje:",
      "",
      ...etiquetaListaPedido(faltan),
    ].join("\n"),
  );
}

async function pedirSiguienteDato(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  // Pedir turno (y cambiar sin dar turnos): un mensaje con lo que falta → deriva al equipo.
  if (estado.modo === "sacar" || (estado.modo === "cambiar" && !(await botMenuDaTurnos()))) {
    await pedirSiguienteDatoPedido(conversation, estado);
    return;
  }
  empujar(estado);
  if (!estado.nombre) {
    estado.paso = "nombre";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "¿Cómo se llama el paciente? Solo el nombre.");
    return;
  }
  if (!estado.apellido) {
    estado.paso = "apellido";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "¿Y el apellido?");
    return;
  }
  if (!estado.sexo) {
    const inferido = sexoDesdeNombre(estado.nombre);
    if (inferido) {
      estado.sexo = inferido;
    } else {
      estado.paso = "sexo";
      await guardar(conversation.id, estado);
      await preguntar(
        conversation,
        "¿El sexo del paciente?\n\n1. Femenino\n2. Masculino\n\n0. Volver atrás",
      );
      return;
    }
  }
  if (!estado.email) {
    estado.paso = "email";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "Pasame un email de contacto.");
    return;
  }
  estado.paso = "profesional";
  estado.opciones = [];
  estado.profesional = "";
  estado.tratamiento = "";
  await guardar(conversation.id, estado);
  await decir(conversation.id, conversation.contactId, preguntaProfesional(estado.modo === "cambiar"));
}

async function ofrecerListaProfesionales(
  conversation: WaConversation,
  estado: MenuEstado,
): Promise<void> {
  const salida = await accion(conversation, "turnos.listarProfesionales", "", {});
  if (!salida || esErrorSistema(salida.texto)) {
    await volverTurnos(
      conversation,
      estado,
      "No pude armar la lista de médicos. El sistema no respondió.",
    );
    return;
  }
  const lineas = lineasConCodigo(salida.texto);
  if (!lineas.length) {
    await preguntar(
      conversation,
      "Ahora no tengo una lista para mostrarte. Escribí el nombre y apellido del médico.",
    );
    return;
  }
  estado.paso = "profesional";
  estado.opciones = lineas;
  await guardar(conversation.id, estado);
  await preguntar(
    conversation,
    `Estos son algunos médicos. Elegí un número, o escribí otro nombre:\n\n${numerar(lineas)}\n\n0. Volver atrás`,
  );
}

async function despuesDelDni(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  try {
    const persona = memoria?.paciente
      ? await memoria.paciente(estado.dni)
      : await consultarPaciente(estado.dni);
    aplicarFicha(estado, persona.ficha);
  } catch (error) {
    await decir(conversation.id, conversation.contactId, mensajeError(error));
    return;
  }
  await sincronizarPacienteYEdad(conversation, estado);

  // Identificación al entrar como "Ya soy paciente": saludar y abrir menú de servicios.
  if (estado.pendiente === "identificar") {
    estado.pendiente = "";
    if (estado.esPaciente !== "si") {
      await guardar(conversation.id, vacio("pacienteTipo", estado));
      await decir(
        conversation.id,
        conversation.contactId,
        [
          "No encontré ese DNI como paciente de INECO.",
          "Podés intentar otro DNI eligiendo otra vez «Ya soy paciente», o continuar como primera vez.",
          "",
          listaPacienteTipo(),
        ].join("\n"),
      );
      return;
    }
    const quien = [estado.nombre, estado.apellido].filter(Boolean).join(" ");
    await irAMenuServicios(
      conversation,
      estado,
      quien ? `Hola, ${quien}. Ya te identifiqué en el sistema.` : "Ya te identifiqué como paciente de INECO.",
    );
    return;
  }

  if (estado.modo === "ver" || estado.modo === "cancelar" || estado.modo === "cambiar") {
    if (estado.esPaciente !== "si") {
      await volverTurnos(
        conversation,
        estado,
        "Con ese DNI no figura un paciente, así que no hay turnos cargados.",
      );
      return;
    }
    if (estado.modo === "ver") {
      const salida = await accion(
        conversation,
        "turnos.delPaciente",
        `proximos dni ${estado.dni}`,
        { dni: estado.dni },
      );
      if (!salida) {
        await volverTurnos(
          conversation,
          estado,
          "No pude consultar los turnos. El sistema no respondió.",
        );
        return;
      }
      await volverTurnos(
        conversation,
        estado,
        esErrorSistema(salida.texto)
          ? "No pude consultar los turnos. El sistema no respondió."
          : salida.texto,
      );
      return;
    }
    // Cancelar sí; cambiar sin dar turnos = tomar datos y que lo reasigne el equipo.
    if (estado.modo === "cambiar" && !(await botMenuDaTurnos())) {
      await pedirSiguienteDato(conversation, estado);
      return;
    }
    await listarParaElegir(conversation, estado);
    return;
  }
  // Pedir turno: mensaje directo con lo que falta (sin preguntar médico por Medexis).
  if (estado.modo === "sacar") {
    await pedirSiguienteDatoPedido(conversation, estado);
    return;
  }
  if (estado.esPaciente === "si") {
    const quien = [estado.nombre, estado.apellido].filter(Boolean).join(" ");
    await decir(
      conversation.id,
      conversation.contactId,
      quien ? `Figura como paciente: ${quien}.` : "Figura como paciente de INECO.",
    );
  } else {
    await decir(
      conversation.id,
      conversation.contactId,
      "No figura como paciente. Te pido los datos de a uno.",
    );
  }
  await pedirSiguienteDato(conversation, estado);
}

async function listarParaElegir(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  empujar(estado);
  const consulta =
    estado.modo === "cancelar" ? `elegir dni ${estado.dni}` : `dni ${estado.dni}`;
  const salida = await accion(conversation, "turnos.delPaciente", consulta, { dni: estado.dni });
  if (!salida || esErrorSistema(salida.texto)) {
    await volverTurnos(
      conversation,
      estado,
      "No pude consultar los turnos. El sistema no respondió.",
    );
    return;
  }
  const modo = estado.modo === "cambiar" ? "cambiar" : "anular";
  const texto = textoDeTurnosPropios(modo, salida.texto, "");
  const futuras = texto.split("\n").map((linea) => linea.trim()).filter((linea) => linea.startsWith("futuro:"));
  if (!futuras.length) {
    await volverTurnos(conversation, estado, texto);
    return;
  }
  // Cancelar: si hay uno solo, igual lo mostramos numerado para confirmar la elección.
  if (estado.modo !== "cancelar" && texto.startsWith("Para confirmar")) {
    estado.paso = "confirmar";
    estado.pendiente = futuras[0]!;
    estado.opciones = futuras;
    await guardar(conversation.id, estado);
    await preguntar(conversation, `${texto}\n\nRespondé sí o no.`);
    return;
  }
  estado.paso = "elegirTurno";
  estado.opciones = futuras;
  await guardar(conversation.id, estado);
  const titulo =
    estado.modo === "cambiar"
      ? "Elegí el turno a cambiar"
      : "Elegí el turno que querés cancelar";
  const listado = numerar(
    futuras.map((linea) => etiquetaFuturo(linea)),
    true,
  );
  await preguntar(conversation, `${titulo}:\n\n${listado}\n\n0. Volver atrás`);
}

async function pedirMotivoCancelacion(
  conversation: WaConversation,
  estado: MenuEstado,
): Promise<void> {
  estado.paso = "motivoCancelacion";
  await guardar(conversation.id, estado);
  const elegido = etiquetaFuturo(estado.pendiente);
  await decir(
    conversation.id,
    conversation.contactId,
    `Perfecto, el turno será cancelado:\n${elegido}`,
  );
  await preguntar(conversation, listaMotivosCancelacion());
}

async function registrarPedidoCancelacion(
  conversation: WaConversation,
  estado: MenuEstado,
  motivo: string,
): Promise<void> {
  const turno = etiquetaFuturo(estado.pendiente);
  const quien = [estado.nombre, estado.apellido].filter(Boolean).join(" ") || "Paciente";
  // Queda en el hilo del chat para el equipo; no se anula en Medexis todavía.
  await decir(
    conversation.id,
    conversation.contactId,
    [
      "Pedido de cancelación registrado (pendiente de procesar)",
      `Paciente: ${quien}`,
      `DNI: ${estado.dni || "—"}`,
      `Turno:`,
      turno,
      `Motivo: ${motivo}`,
    ].join("\n"),
  );
  await etiquetarNombres(conversation, ["turnos", "cancelar-turno"]);
  await volverTurnos(
    conversation,
    estado,
    "Listo. Registramos tu pedido de cancelación. El equipo lo va a procesar.",
  );
}

function lineasConCodigo(resultado: string): string[] {
  return resultado
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => /\(\d+/.test(linea));
}

/** Parsea la salida de turnos.listarTratamientos (confirmación, varios, o tratamientos). */
function leerListarTratamientos(resultado: string): {
  tipo: "confirma" | "profesionales" | "tratamientos" | "vacio";
  nombre: string;
  lineas: string[];
} {
  const texto = resultado.trim();
  if (texto.startsWith("Buscás a")) {
    return {
      tipo: "confirma",
      nombre: texto.replace(/^Buscás a\s*/i, "").replace(/\.$/, "").trim(),
      lineas: [],
    };
  }
  if (/profesionales con ese nombre|hay más de un/i.test(texto)) {
    return { tipo: "profesionales", nombre: "", lineas: lineasConCodigo(texto) };
  }
  const deTratamientos = texto.match(/estos son los tratamientos de\s+([^:\n]+)\s*:/i);
  if (deTratamientos) {
    const lineas = lineasConCodigo(texto);
    return {
      tipo: lineas.length ? "tratamientos" : "vacio",
      nombre: deTratamientos[1]!.trim(),
      lineas,
    };
  }
  // Formato viejo: NOMBRE (doc): trat1; trat2
  const lineas = lineasConCodigo(texto);
  if (texto.startsWith("Falta el profesional") || !lineas.length) {
    return { tipo: "vacio", nombre: "", lineas: [] };
  }
  if (lineas.length === 1 && lineas[0]!.includes(":")) {
    const nombre = lineas[0]!.split("(")[0]?.trim() || "";
    const tratamientos = lineas[0]!
      .split(":")
      .slice(1)
      .join(":")
      .split(";")
      .map((item) => item.trim().replace(/\s*\([^)]*\)\s*$/, ""))
      .filter(Boolean);
    return { tipo: "tratamientos", nombre, lineas: tratamientos };
  }
  // Varias líneas con (código) sin encabezado de tratamientos ⇒ lista de profesionales.
  if (lineas.length > 1) {
    return { tipo: "profesionales", nombre: "", lineas };
  }
  const nombre = lineas[0]!.split("(")[0]?.trim() || "";
  return { tipo: "tratamientos", nombre, lineas: [nombre] };
}

async function ofrecerProfesional(
  conversation: WaConversation,
  estado: MenuEstado,
  texto: string,
): Promise<void> {
  empujar(estado);
  const salida = await accion(conversation, "turnos.listarTratamientos", texto, { textoPersona: texto });
  if (!salida || esErrorSistema(salida.texto)) {
    await volverTurnos(
      conversation,
      estado,
      "No pude buscar ese profesional. El sistema no respondió.",
    );
    return;
  }
  const leido = leerListarTratamientos(salida.texto);
  if (leido.tipo === "confirma") {
    estado.paso = "confirmar";
    estado.pendiente = leido.nombre;
    await guardar(conversation.id, estado);
    await preguntar(conversation, `¿Te referís a ${leido.nombre}? Respondé sí o no.`);
    return;
  }
  if (leido.tipo === "profesionales") {
    estado.paso = "profesional";
    estado.opciones = leido.lineas;
    await guardar(conversation.id, estado);
    await preguntar(
      conversation,
      `Hay más de un médico con ese nombre. Elegí un número:\n\n${numerar(leido.lineas)}\n\n0. Volver atrás`,
    );
    return;
  }
  if (leido.tipo === "vacio" || !leido.lineas.length) {
    estado.paso = "profesional";
    estado.opciones = [];
    await guardar(conversation.id, estado);
    await preguntar(
      conversation,
      "No encontré ese nombre. Escribí nombre y apellido, o indistinto para ver una lista.",
    );
    return;
  }
  const tratamientos = leido.lineas.map((item) => item.replace(/\s*\([^)]*\)\s*$/, "").trim()).filter(Boolean);
  estado.profesional = leido.nombre || texto;
  estado.opciones = tratamientos;
  estado.paso = "tratamiento";
  estado.pendiente = "";
  await guardar(conversation.id, estado);
  await preguntar(
    conversation,
    `Estos son los tratamientos de ${estado.profesional}. Elegí un número:\n\n${numerar(tratamientos)}\n\n0. Volver atrás`,
  );
}

async function buscarHorarios(
  conversation: WaConversation,
  estado: MenuEstado,
  ampliar = false,
  antes = false,
): Promise<void> {
  empujar(estado);
  const consulta = `${estado.profesional} ${estado.tratamiento}`.trim();
  const salida = await accion(conversation, "turnos.libres", consulta, {
    ...ctxDe(estado, conversation.contact?.phoneNumber ?? ""),
    textoPersona: consulta,
    desdeDia: ampliar || antes ? estado.hastaDia : 0,
    busqueda: ampliar || antes ? estado.busqueda : "",
    ampliar,
    masTemprano: antes,
    horariosPrevios: ampliar || antes ? estado.horarios : "",
  });
  if (!salida || esErrorSistema(salida.texto)) {
    await volverTurnos(
      conversation,
      estado,
      "No pude buscar horarios. El sistema no respondió.",
    );
    return;
  }
  aplicarFicha(estado, salida.ficha);
  if (salida.horarios) estado.horarios = salida.horarios;
  if (salida.hastaDia != null) estado.hastaDia = salida.hastaDia;
  if (salida.busqueda) estado.busqueda = salida.busqueda;
  const lineas = (salida.horarios || "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => /\(\d{4}-\d{2}-\d{2}/.test(linea));
  estado.paso = "horarios";
  estado.opciones = lineas;
  await guardar(conversation.id, estado);
  if (!lineas.length) {
    await preguntar(conversation, `${salida.texto}\n\nEscribí más adelante para seguir buscando.`);
    return;
  }
  await preguntar(
    conversation,
    `${formatearHorariosMenu(lineas)}\n\nEscribí el número del horario. Si querés ver más fechas, escribí más adelante.\n\n0. Volver atrás`,
  );
}

async function reservarElegido(
  conversation: WaConversation,
  estado: MenuEstado,
  linea: string,
): Promise<void> {
  const iso = linea.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)/)?.[1] ?? "";
  if (!iso) {
    await preguntar(conversation, noValida(formatearHorariosMenu(estado.opciones)));
    return;
  }
  const consulta = `${estado.profesional} ${estado.tratamiento} (${iso})`;
  const salida = await accion(conversation, "turnos.reservar", consulta, ctxDe(estado, conversation.contact?.phoneNumber ?? ""));
  if (!salida) {
    await volverTurnos(
      conversation,
      estado,
      "No pude darte ese turno. El sistema no lo pudo registrar.",
    );
    return;
  }
  if (!salida.texto.startsWith("Turno dado")) {
    if (/falta el email/i.test(salida.texto)) {
      estado.paso = "email";
      estado.email = "";
      await guardar(conversation.id, estado);
      await preguntar(conversation, "Pasame un email de contacto.");
      return;
    }
    if (/faltan nombre|falta.*apellido/i.test(salida.texto)) {
      if (!estado.nombre) estado.nombre = "";
      if (!estado.apellido) estado.apellido = "";
      await pedirSiguienteDato(conversation, estado);
      return;
    }
    await volverTurnos(conversation, estado, mensajeFalloReserva(salida.texto));
    return;
  }
  let extra = "";
  if (estado.anularLuego) {
    const lineaAnular = estado.anularLuego.replace(/^futuro:\s*/i, "");
    const cancelado = await accion(conversation, "turnos.cancelar", lineaAnular, {
      dni: estado.dni,
      textoPersona: lineaAnular,
    });
    if (!cancelado) {
      extra = "El turno nuevo quedó, pero no pude cancelar el anterior.";
    } else if (cancelado.texto.startsWith("Turno cancelado")) {
      extra = "El turno anterior quedó cancelado.";
    } else {
      extra = mensajeFalloCancelar(cancelado.texto).replace(
        /^No pude cancelar ese turno/,
        "El turno nuevo quedó, pero no pude cancelar el anterior",
      );
    }
  }
  await volverTurnos(conversation, estado, [salida.texto, extra].filter(Boolean).join("\n"));
}

async function confirmarTurno(conversation: WaConversation, estado: MenuEstado, texto: string): Promise<void> {
  if (pideNegacion(texto)) {
    await volverTurnos(
      conversation,
      estado,
      estado.modo === "cambiar" ? "Quedó sin cambios." : "Quedó sin anular.",
    );
    return;
  }
  if (!pideAfirmacion(texto)) {
    await preguntar(conversation, "Esa opción no es válida. Respondé sí o no.");
    return;
  }
  // Cancelar por menú: no anula en Medexis; solo pide motivo y guarda el pedido.
  if (estado.modo === "cancelar") {
    await pedirMotivoCancelacion(conversation, estado);
    return;
  }
  estado.anularLuego = estado.pendiente;
  estado.pendiente = "";
  estado.profesional = "";
  estado.tratamiento = "";
  await pedirSiguienteDato(conversation, estado);
}

async function mostrarPaso(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  if (estado.paso === "pacienteTipo") {
    await decir(conversation.id, conversation.contactId, listaPacienteTipo());
    return;
  }
  if (estado.paso === "primeraVezDatos") {
    await preguntar(conversation, TEXTO_PRIMERA_VEZ_PEDIR);
    return;
  }
  if (estado.paso === "otrasConsultas") {
    await preguntar(conversation, TEXTO_OTRAS_CONSULTAS_PEDIR);
    return;
  }
  if (estado.paso === "turnos") {
    await decir(conversation.id, conversation.contactId, listaTurnos());
    return;
  }
  if (estado.paso === "info") {
    await decir(conversation.id, conversation.contactId, listaInfo());
    return;
  }
  if (estado.paso === "menu") {
    await decir(conversation.id, conversation.contactId, listaMenu());
    return;
  }
  if (estado.paso === "dni") {
    await preguntar(conversation, "Pasame el DNI del paciente, sin puntos ni espacios.");
    return;
  }
  if (estado.paso === "nombre") {
    await preguntar(conversation, "¿Cómo se llama el paciente? Solo el nombre.");
    return;
  }
  if (estado.paso === "apellido") {
    await preguntar(conversation, "¿Y el apellido?");
    return;
  }
  if (estado.paso === "sexo") {
    await preguntar(
      conversation,
      "¿El sexo del paciente?\n\n1. Femenino\n2. Masculino\n\n0. Volver atrás",
    );
    return;
  }
  if (estado.paso === "email") {
    await preguntar(conversation, "Pasame un email de contacto.");
    return;
  }
  if (estado.paso === "pedidoDatos") {
    const faltan = camposFaltantesPedido(estado);
    await preguntar(
      conversation,
      faltan.length
        ? mensajePedirDatosJuntos(estado, faltan)
        : "Si ya mandaste los datos, esperá un momento.",
    );
    return;
  }
  if (estado.paso === "fechaNacimiento") {
    await preguntar(conversation, "¿Cuál es la fecha de nacimiento? (día/mes/año)");
    return;
  }
  if (estado.paso === "cobertura") {
    await preguntar(conversation, "¿Cuál es la cobertura? (obra social, prepaga o particular)");
    return;
  }
  if (estado.paso === "afiliado") {
    await preguntar(
      conversation,
      "¿Cuál es el número de afiliado? Si es particular, escribí «particular».",
    );
    return;
  }
  if (estado.paso === "profesional") {
    if (estado.pedidoIntro && !estado.opciones.length) {
      await preguntar(conversation, "¿Con qué profesional querés el turno?");
      return;
    }
    if (estado.opciones.length) {
      await preguntar(
        conversation,
        `Estos son algunos médicos. Elegí un número, o escribí otro nombre:\n\n${numerar(estado.opciones)}\n\n0. Volver atrás`,
      );
    } else {
      await decir(conversation.id, conversation.contactId, preguntaProfesional(estado.modo === "cambiar"));
    }
    return;
  }
  if (estado.paso === "tratamiento") {
    if (estado.pedidoIntro && !estado.opciones.length) {
      await preguntar(conversation, "¿Qué prestación o consulta necesitás?");
      return;
    }
    await preguntar(
      conversation,
      `Elegí el tratamiento con el número:\n\n${numerar(estado.opciones)}\n\n0. Volver atrás`,
    );
    return;
  }
  if (estado.paso === "horarios") {
    await preguntar(
      conversation,
      estado.opciones.length
        ? `${formatearHorariosMenu(estado.opciones)}\n\nEscribí el número del horario. Si querés ver más fechas, escribí más adelante.\n\n0. Volver atrás`
        : "No encontré horarios en estas fechas. Escribí más adelante para seguir buscando.",
    );
    return;
  }
  if (estado.paso === "elegirTurno") {
    await preguntar(
      conversation,
      `Elegí el turno:\n\n${numerar(
        estado.opciones.map((linea) => etiquetaFuturo(linea)),
        true,
      )}\n\n0. Volver atrás`,
    );
    return;
  }
  if (estado.paso === "motivoCancelacion") {
    await preguntar(conversation, listaMotivosCancelacion());
    return;
  }
  if (estado.paso === "confirmar") {
    const texto = estado.pendiente.startsWith("futuro:")
      ? `Para confirmar ${estado.modo === "cambiar" ? "el cambio" : "la anulación"}:\n${etiquetaFuturo(estado.pendiente)}\n\nRespondé sí o no.`
      : `¿Te referís a ${estado.pendiente}? Respondé sí o no.`;
    await preguntar(conversation, texto);
    return;
  }
  if (estado.paso === "queja") {
    await preguntar(conversation, "Contame qué pasó.");
    return;
  }
  await decir(conversation.id, conversation.contactId, listaInfo());
}

function listaInfo(): string {
  return [
    "¿Sobre qué querés información?",
    "",
    "1. Sucursales",
    "2. Coberturas",
    "3. Profesionales",
    "4. Tratamientos",
    "5. Datos de INECO",
    "",
    "0. Volver atrás",
  ].join("\n");
}

async function responderInfo(conversation: WaConversation, estado: MenuEstado, texto: string): Promise<void> {
  const t = sinTildes(texto).trim();
  // 0 = salir de lo que estamos haciendo (info) y volver al menú principal.
  if (quiereVolver(t) && (estado.paso === "info" || t === "menu")) {
    await guardar(conversation.id, vacio("menu", estado));
    await decir(conversation.id, conversation.contactId, listaMenu());
    return;
  }
  if (quiereVolver(t) && estado.paso !== "info") {
    estado.paso = "info";
    estado.opciones = [];
    estado.modo = "";
    await guardar(conversation.id, estado);
    await decir(conversation.id, conversation.contactId, listaInfo());
    return;
  }
  if (estado.paso === "queja") {
    if (texto.trim().length < 4) {
      await preguntar(conversation, "Necesito un poco más de detalle. ¿Qué pasó?");
      return;
    }
    await etiquetarNombres(conversation, ["Queja"]);
    estado.paso = "confirmar";
    estado.modo = "queja";
    estado.pendiente = "equipo";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "Quedó anotada la queja.\n\n1. Que la vea una persona del equipo\n2. Seguir en el menú");
    return;
  }
  if (estado.paso === "confirmar" && estado.modo === "queja") {
    if (t === "1" || pideAfirmacion(texto)) {
      await derivarAAsesor(conversation);
      await decir(conversation.id, conversation.contactId, "Se la dejo al equipo.");
      return;
    }
    if (t === "2" || pideNegacion(texto)) {
      await guardar(conversation.id, vacio("menu", estado));
      await decir(conversation.id, conversation.contactId, listaMenu());
      return;
    }
    await preguntar(conversation, noValida("1. Que la vea una persona del equipo\n2. Seguir en el menú"));
    return;
  }
  if (estado.paso === "info") {
    const modos = ["sucursales", "coberturas", "profesionales", "tratamientos", "institucion"] as const;
    const elegido = indice(texto, modos.length);
    if (elegido < 0) {
      await decir(conversation.id, conversation.contactId, noValida(listaInfo()));
      return;
    }
    estado.modo = modos[elegido]!;
    if (estado.modo === "institucion") {
      const conocimiento = memoria
    ? { text: memoria.conocimiento, updatedAt: "" }
    : await getWhatsappConocimiento();
      const textoInfo = fragmento(capitulo(conocimiento.text, "Institución") || capitulo(conocimiento.text, "Contacto"), "");
      await guardar(conversation.id, vacio("info", estado));
      await decir(
        conversation.id,
        conversation.contactId,
        `${textoInfo || "No hay un texto de datos institucionales cargado."}\n\n${listaInfo()}`,
      );
      return;
    }
    if (estado.modo === "sucursales") {
      estado.paso = "infoTema";
      estado.opciones = [...SEDES];
      await guardar(conversation.id, estado);
      await preguntar(conversation, `¿De qué sucursal querés los datos?\n\n${numerar(SEDES)}`);
      return;
    }
    if (estado.modo === "coberturas") {
      const catalogo = memoria?.catalogo ?? (await listWhatsappTagCatalog());
      const grupo = catalogo.groups.find((item) => sinTildes(item.name) === "coberturas");
      const nombres = catalogo.items
        .filter((item) => item.groupId === grupo?.id && !esTagCoberturaMeta(item.name))
        .map((item) => item.name)
        .slice(0, 18);
      estado.paso = "infoTema";
      estado.opciones = [...nombres, "Otra / OS no soportada"];
      await guardar(conversation.id, estado);
      await preguntar(conversation, `¿Cuál es la cobertura?\n\n${numerar(estado.opciones)}`);
      return;
    }
    if (estado.modo === "tratamientos") {
      const salida = await accion(conversation, "turnos.listarTratamientos", "", {});
      if (!salida) return;
      const lineas = salida.texto.split("\n").map((linea) => linea.trim()).filter(Boolean);
      estado.paso = "infoTema";
      estado.opciones = lineas;
      await guardar(conversation.id, estado);
      await preguntar(conversation, `Estos son los tratamientos:\n\n${numerar(lineas)}\n\nEscribí el número.`);
      return;
    }
    estado.paso = "infoTema";
    estado.opciones = [];
    await guardar(conversation.id, estado);
    await preguntar(conversation, "¿De qué profesional querés información?");
    return;
  }

  const conocimiento = memoria
    ? { text: memoria.conocimiento, updatedAt: "" }
    : await getWhatsappConocimiento();
  if (estado.modo === "sucursales") {
    const n = indice(texto, estado.opciones.length);
    const sede = n >= 0 ? estado.opciones[n]! : sedeElegida(texto);
    if (!sede) {
      await preguntar(conversation, noValida(numerar(estado.opciones)));
      return;
    }
    await etiquetarSede(conversation, sede);
    const datos = await mensajeDeSede(sede);
    const siguiente = vacio("algoMas", estado);
    siguiente.pendiente = "desde:info";
    await guardar(conversation.id, siguiente);
    await decir(
      conversation.id,
      conversation.contactId,
      `${datos}\n\n${preguntaAlgoMas(sinTildes(sede) !== "caba")}`,
    );
    return;
  }
  if (estado.modo === "coberturas") {
    const n = indice(texto, estado.opciones.length);
    const escrita = estado.opciones.filter((item) => {
      const limpio = sinTildes(item);
      return limpio.length >= 4 && (t === limpio || t.includes(limpio));
    });
    const elegida = n >= 0 ? estado.opciones[n] : escrita.length === 1 ? escrita[0] : undefined;
    if (!elegida) {
      await preguntar(conversation, noValida(numerar(estado.opciones)));
      return;
    }
    const otra =
      /otra|os no soportada|no soportada|sin convenio|sin cobertura/.test(sinTildes(elegida));
    const nombre = otra ? TAG_COBERTURA_NO_SOPORTADA : elegida;
    await etiquetarNombres(conversation, [nombre]);
    const datos = fragmento(capitulo(conocimiento.text, "Coberturas"), otra ? texto : nombre);
    estado.paso = "info";
    estado.opciones = [];
    await guardar(conversation.id, estado);
    await decir(
      conversation.id,
      conversation.contactId,
      `${otra ? "Esa cobertura no está entre las que soportamos por este canal." : `Anoté ${nombre}.`}${datos ? `\n\n${datos}` : ""}\n\n${listaInfo()}`,
    );
    return;
  }
  if (estado.modo === "profesionales") {
    let consulta = texto;
    if (estado.opciones.length) {
      const elegido = indice(texto, estado.opciones.length);
      if (elegido < 0) {
        await preguntar(conversation, noValida(numerar(estado.opciones)));
        return;
      }
      consulta = (estado.opciones[elegido]!.split("(")[0] ?? "").trim();
      estado.opciones = [];
    } else if (estado.pendiente.startsWith("confirma:")) {
      const nombre = estado.pendiente.slice("confirma:".length);
      if (pideNegacion(texto)) {
        estado.pendiente = "";
        await guardar(conversation.id, estado);
        await preguntar(conversation, "¿De qué profesional querés información?");
        return;
      }
      if (!pideAfirmacion(texto)) {
        await preguntar(conversation, `Esa opción no es válida. ¿Con ese nombre te referís a ${nombre}? Respondé sí o no.`);
        return;
      }
      consulta = nombre;
      estado.pendiente = "";
    }
    const salida = await accion(conversation, "turnos.listarTratamientos", consulta, { textoPersona: consulta });
    if (!salida) return;
    const leido = leerListarTratamientos(salida.texto);
    if (leido.tipo === "confirma") {
      estado.pendiente = `confirma:${leido.nombre}`;
      await guardar(conversation.id, estado);
      await preguntar(conversation, `¿Con ese nombre te referís a ${leido.nombre}? Respondé sí o no.`);
      return;
    }
    if (leido.tipo === "profesionales") {
      estado.opciones = leido.lineas;
      await guardar(conversation.id, estado);
      await preguntar(conversation, `Hay más de un profesional. Elegí un número de la lista.\n\n${numerar(leido.lineas)}`);
      return;
    }
    if (leido.tipo === "vacio" || !leido.lineas.length) {
      await preguntar(conversation, "No encontré ese nombre entre los profesionales. ¿Me decís el nombre y el apellido?");
      return;
    }
    await etiquetarParecido(conversation, leido.nombre || consulta);
    estado.paso = "info";
    estado.opciones = [];
    estado.pendiente = "";
    await guardar(conversation.id, estado);
    await decir(conversation.id, conversation.contactId, `${salida.texto.trim().slice(0, 900)}\n\n${listaInfo()}`);
    return;
  }
  const n = indice(texto, estado.opciones.length);
  if (n < 0) {
    await preguntar(conversation, noValida(numerar(estado.opciones)));
    return;
  }
  const tratamiento = estado.opciones[n]!.replace(/\s*\([^)]*\)\s*$/, "");
  await etiquetarParecido(conversation, tratamiento);
  const datos = fragmento(capitulo(conocimiento.text, "Tratamiento") || capitulo(conocimiento.text, "Consulta"), tratamiento);
  const salida = await accion(conversation, "turnos.listarProfesionales", tratamiento, { textoPersona: tratamiento });
  if (!salida) return;
  estado.paso = "info";
  estado.opciones = [];
  await guardar(conversation.id, estado);
  await decir(
    conversation.id,
    conversation.contactId,
    [`Anoté ${tratamiento}.`, datos, salida.texto.slice(0, 700), listaInfo()].filter(Boolean).join("\n\n"),
  );
}

async function caminoTurnos(conversation: WaConversation, estado: MenuEstado, texto: string): Promise<void> {
  const t = sinTildes(texto).trim();
  // 0 = cancelar lo que estamos haciendo y volver al menú de turnos (o al principal).
  if (quiereVolver(t) && estado.paso !== "turnos") {
    await volverTurnos(conversation, estado, "Listo, cancelé esto.");
    return;
  }

  if (estado.paso === "turnos") {
    if (quiereVolver(t) || t === "menu") {
      await irAMenuServicios(conversation, estado);
      return;
    }
    // 1 próximos · 2 cancelar · 3 pedir
    const modo =
      t === "1" || /\bproxim|\bver\b|\bmis turnos\b|\blistar\b/.test(t)
        ? "ver"
        : t === "2" || /\b(cancel|anul)/.test(t)
          ? "cancelar"
          : t === "3" || /\b(pedir|sacar|nuevo)\b/.test(t)
            ? "sacar"
            : t === "4" || /\b(cambi|reprogram|mover)\b/.test(t)
              ? "cambiar"
              : "";
    if (!modo) {
      await decir(conversation.id, conversation.contactId, noValida(listaTurnos()));
      return;
    }
    estado.modo = modo;
    estado.anularLuego = "";
    estado.pendiente = "";
    estado.pila = [];
    if (modo === "sacar" || modo === "cambiar") {
      estado.profesional = "";
      estado.tratamiento = "";
      estado.cobertura = "";
      estado.nAfiliado = "";
      estado.pedidoIntro = false;
      // Mail / fecha pueden venir de Medexis; si ya están, no los borramos.
    }
    const tagsTurno =
      modo === "sacar"
        ? ["turnos", "pedir-turno", "CABA"]
        : modo === "cancelar"
          ? ["turnos", "cancelar-turno", "CABA"]
          : modo === "ver"
            ? ["turnos", "proximos-turnos", "CABA"]
            : ["turnos", "CABA"];
    await etiquetarNombres(conversation, tagsTurno, true);
    // Pedir turno: no reserva en Medexis; junta datos y deriva (sin aviso largo).
    if (modo === "sacar") {
      await asegurarTelefono(conversation, estado);
      if (estado.dni) {
        try {
          const persona = memoria?.paciente
            ? await memoria.paciente(estado.dni)
            : await consultarPaciente(estado.dni);
          aplicarFicha(estado, persona.ficha);
          await sincronizarPacienteYEdad(conversation, estado);
        } catch {
          /* seguimos igual con lo que haya */
        }
      }
      await pedirSiguienteDatoPedido(conversation, estado);
      return;
    }
    if (modo === "cambiar" && !(await botMenuDaTurnos())) {
      await decir(conversation.id, conversation.contactId, TEXTO_TURNO_SIN_ASIGNAR);
    }
    if (!estado.dni) {
      await pedirDni(conversation, estado);
      return;
    }
    await despuesDelDni(conversation, estado);
    return;
  }

  if (estado.paso === "dni") {
    if (quiereVolver(t) && estado.pendiente === "identificar") {
      await irAPacienteTipo(conversation);
      return;
    }
    const dni = dniDe(texto);
    if (!dni) {
      await preguntar(
        conversation,
        "Eso no parece un DNI. Pasamelo de nuevo, sin puntos ni espacios.",
      );
      return;
    }
    estado.dni = dni;
    await despuesDelDni(conversation, estado);
    return;
  }

  if (estado.paso === "nombre" || estado.paso === "apellido") {
    const limpio = texto.replace(/\s+/g, " ").trim();
    if (limpio.length < 2 || /\d/.test(limpio)) {
      await preguntar(conversation, "Necesito ese dato en letras. ¿Me lo repetís?");
      return;
    }
    if (estado.paso === "nombre") estado.nombre = limpio;
    else estado.apellido = limpio;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "sexo") {
    const sexo = sexoDe(texto);
    if (!sexo) {
      await preguntar(
        conversation,
        "Elegí un número de la lista.\n\n1. Femenino\n2. Masculino\n\n0. Volver atrás",
      );
      return;
    }
    estado.sexo = sexo;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "email") {
    const email = emailDe(texto);
    if (!email) {
      await preguntar(conversation, "Ese email no es válido. Pasamelo de nuevo, por ejemplo nombre@correo.com.");
      return;
    }
    estado.email = email;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "pedidoDatos") {
    if (quiereVolver(t)) {
      await volverTurnos(conversation, estado);
      return;
    }
    await recibirPedidoDatosJuntos(conversation, estado, texto);
    return;
  }

  if (estado.paso === "fechaNacimiento") {
    const fecha = fechaNacimientoDe(texto);
    if (!fecha) {
      await preguntar(conversation, "No entendí la fecha. Escribila como día/mes/año, por ejemplo 15/03/1990.");
      return;
    }
    estado.fechaNacimiento = fecha;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "cobertura") {
    const limpio = texto.replace(/\s+/g, " ").trim();
    if (limpio.length < 2) {
      await preguntar(conversation, "Necesito el nombre de la cobertura, o «particular».");
      return;
    }
    estado.cobertura = limpio;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "afiliado") {
    const limpio = texto.replace(/\s+/g, " ").trim();
    if (limpio.length < 1) {
      await preguntar(conversation, "Pasame el número de afiliado, o escribí «particular».");
      return;
    }
    estado.nAfiliado = limpio;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "profesional") {
    if (pideIndistinto(texto) && !estado.opciones.length) {
      await ofrecerListaProfesionales(conversation, estado);
      return;
    }
    const elegido = indice(texto, estado.opciones.length);
    if (estado.opciones.length && elegido < 0 && !pideIndistinto(texto)) {
      // Si escribe un nombre libre aunque haya lista, lo buscamos.
      if (/[a-zA-ZáéíóúÁÉÍÓÚñÑ]{3,}/.test(texto) && !/^\d+$/.test(texto.trim())) {
        await ofrecerProfesional(conversation, estado, texto);
        return;
      }
      await preguntar(
        conversation,
        `Elegí un número de la lista, o escribí el nombre:\n\n${numerar(estado.opciones)}\n\n0. Volver atrás`,
      );
      return;
    }
    const consulta =
      elegido >= 0 ? (estado.opciones[elegido]!.split("(")[0] ?? "").trim() : texto;
    await ofrecerProfesional(conversation, estado, consulta);
    return;
  }

  if (estado.paso === "confirmar" && !estado.pendiente.startsWith("futuro:")) {
    if (pideNegacion(texto)) {
      estado.pendiente = "";
      estado.paso = "profesional";
      estado.opciones = [];
      await guardar(conversation.id, estado);
      await decir(conversation.id, conversation.contactId, preguntaProfesional(estado.modo === "cambiar"));
      return;
    }
    if (!pideAfirmacion(texto)) {
      await preguntar(conversation, `¿Te referís a ${estado.pendiente}? Respondé sí o no.`);
      return;
    }
    await ofrecerProfesional(conversation, estado, estado.pendiente);
    return;
  }

  if (estado.paso === "tratamiento") {
    const elegido = indice(texto, estado.opciones.length);
    if (elegido < 0) {
      await preguntar(conversation, noValida(numerar(estado.opciones)));
      return;
    }
    estado.tratamiento = estado.opciones[elegido]!;
    estado.horarios = "";
    estado.hastaDia = 0;
    estado.busqueda = "";
    await buscarHorarios(conversation, estado);
    return;
  }

  if (estado.paso === "horarios") {
    if (pideMasFechas(texto)) {
      await buscarHorarios(conversation, estado, true, false);
      return;
    }
    if (pideMasTemprano(texto)) {
      await buscarHorarios(conversation, estado, false, true);
      return;
    }
    const elegido = indice(texto, estado.opciones.length);
    if (elegido < 0) {
      await preguntar(
        conversation,
        estado.opciones.length
          ? noValida(numerar(estado.opciones.map((linea) => linea.replace(/\s*\([^)]*\)\s*$/, ""))))
          : "Esa opción no es válida. Escribí más adelante para seguir buscando.",
      );
      return;
    }
    await reservarElegido(conversation, estado, estado.opciones[elegido]!);
    return;
  }

  if (estado.paso === "elegirTurno") {
    if (quiereVolver(t)) {
      await volverTurnos(conversation, estado);
      return;
    }
    const elegido = indice(texto, estado.opciones.length);
    if (elegido < 0) {
      await preguntar(
        conversation,
        noValida(numerar(estado.opciones.map((linea) => etiquetaFuturo(linea)), true)),
      );
      return;
    }
    estado.pendiente = estado.opciones[elegido]!;
    if (estado.modo === "cancelar") {
      await pedirMotivoCancelacion(conversation, estado);
      return;
    }
    estado.paso = "confirmar";
    await guardar(conversation.id, estado);
    await preguntar(
      conversation,
      `Para confirmar el cambio:\n${etiquetaFuturo(estado.pendiente)}\n\nRespondé sí o no.`,
    );
    return;
  }

  if (estado.paso === "motivoCancelacion") {
    if (quiereVolver(t)) {
      estado.pendiente = "";
      await listarParaElegir(conversation, estado);
      return;
    }
    const elegido = indice(texto, MOTIVOS_CANCELACION.length);
    if (elegido < 0) {
      await preguntar(conversation, noValida(listaMotivosCancelacion()));
      return;
    }
    await registrarPedidoCancelacion(conversation, estado, MOTIVOS_CANCELACION[elegido]!);
    return;
  }

  if (estado.paso === "confirmar") {
    await confirmarTurno(conversation, estado, texto);
  }
}

/** Responde el último mensaje de la persona, sin modelo. */
export async function runMenuTurn(conversationId: string): Promise<void> {
  const conversation = memoria?.conversation ?? (await getConversation(conversationId));
  if (!conversation?.contactId || conversation.pruebaMotor !== "menu") return;
  if (conversation.assigneeKind === "user") return;
  const messages = memoria?.messages ?? (await listRecentMessagesByConversation(conversationId, 8));
  const last = messages[messages.length - 1];
  if (!last || last.direction !== "INBOUND" || !last.text.trim()) return;
  const texto = last.text.trim();
  const estado = conversation.menuEstado ?? vacio(conversation.menuPaso === "menu" ? "menu" : "sede");
  try {
    await responderMenu(conversation, estado, texto);
  } catch (error) {
    const enTurnos =
      Boolean(estado.modo) ||
      [
        "dni",
        "horarios",
        "tratamiento",
        "profesional",
        "confirmar",
        "elegirTurno",
        "motivoCancelacion",
        "fechaNacimiento",
        "pedidoDatos",
        "cobertura",
        "afiliado",
        "email",
        "nombre",
        "apellido",
        "turnos",
      ].includes(estado.paso);
    if (enTurnos) {
      await volverTurnos(conversation, estado, mensajeError(error));
      return;
    }
    await guardar(conversation.id, vacio("menu", estado));
    await decir(
      conversation.id,
      conversation.contactId,
      `${mensajeError(error)}\n\n${listaMenu()}`,
    );
  }
}

async function irAPacienteTipo(conversation: WaConversation, previo = ""): Promise<void> {
  await etiquetarSede(conversation, "CABA");
  await guardar(conversation.id, vacio("pacienteTipo"));
  await decir(
    conversation.id,
    conversation.contactId,
    [previo, listaPacienteTipo()].filter(Boolean).join("\n\n"),
  );
}

async function irAMenuServicios(conversation: WaConversation, estado: MenuEstado, previo = ""): Promise<void> {
  const siguiente = vacio("menu", {
    ...estado,
    modo: "",
    pendiente: "",
    opciones: [],
    pila: [],
  });
  await guardar(conversation.id, siguiente);
  // Con saludo de identificación → "¿Con qué te puedo ayudar?"; si vuelve → "algo más".
  const menu = listaMenu(previo.trim() ? "inicio" : "otraVez");
  await decir(
    conversation.id,
    conversation.contactId,
    [previo, menu].filter(Boolean).join("\n\n"),
  );
}

async function irAMenuCaba(conversation: WaConversation, previo = ""): Promise<void> {
  await irAPacienteTipo(conversation, previo);
}

async function cerrarAlgoMas(conversation: WaConversation): Promise<void> {
  await guardar(conversation.id, vacio("sede"));
  await decir(
    conversation.id,
    conversation.contactId,
    "Dale, quedo a tu disposición. Si necesitás algo más, escribime.",
  );
}

async function verOtraSucursal(conversation: WaConversation, desde: "sede" | "info"): Promise<void> {
  if (desde === "info") {
    const siguiente = vacio("infoTema", { modo: "sucursales" });
    siguiente.opciones = [...SEDES];
    await guardar(conversation.id, siguiente);
    await preguntar(conversation, `¿De qué sucursal querés los datos?\n\n${numerar(SEDES)}`);
    return;
  }
  await guardar(conversation.id, vacio("sede"));
  await decir(conversation.id, conversation.contactId, listaSedes());
}

async function responderAlgoMas(
  conversation: WaConversation,
  estado: MenuEstado,
  texto: string,
): Promise<void> {
  const t = sinTildes(texto).trim();
  const desde = desdeAlgoMas(estado);

  if (estado.pendiente.startsWith("elige:")) {
    if (t === "1" || /\bcaba\b|menu|menú|turno|continuar|seguir/.test(t)) {
      await irAMenuCaba(conversation);
      return;
    }
    if (t === "2" || /\botra sucursal\b|\bsucursal\b/.test(t)) {
      await verOtraSucursal(conversation, desde);
      return;
    }
    if (quiereVolver(t)) {
      estado.pendiente = desde === "info" ? "desde:info" : "desde:sede";
      await guardar(conversation.id, estado);
      await decir(conversation.id, conversation.contactId, preguntaAlgoMas(desde === "sede"));
      return;
    }
    await decir(conversation.id, conversation.contactId, noValida(opcionesTrasSi(desde)));
    return;
  }

  if (t === "2" || pideNegacion(texto) || /\bno[, ]?gracias\b/.test(t)) {
    await cerrarAlgoMas(conversation);
    return;
  }
  if (t === "1" || pideAfirmacion(texto) || t === "si" || t === "sí") {
    estado.pendiente = desde === "info" ? "elige:info" : "elige:sede";
    await guardar(conversation.id, estado);
    await decir(conversation.id, conversation.contactId, opcionesTrasSi(desde));
    return;
  }
  await decir(conversation.id, conversation.contactId, noValida(preguntaAlgoMas(desde === "sede")));
}

async function responderPacienteTipo(
  conversation: WaConversation,
  estado: MenuEstado,
  texto: string,
): Promise<void> {
  const t = sinTildes(texto).trim();
  if (quiereVolver(t) || t === "0") {
    await guardar(conversation.id, vacio("sede"));
    await decir(conversation.id, conversation.contactId, listaSedes());
    return;
  }
  if (t === "1" || /\bya soy paciente\b|\bsoy paciente\b|\bpaciente\b/.test(t)) {
    estado.esPaciente = "si";
    estado.pendiente = "identificar";
    estado.modo = "";
    estado.dni = "";
    estado.nombre = "";
    estado.apellido = "";
    await etiquetarNombres(conversation, ["Paciente"]);
    await pedirDni(conversation, estado);
    return;
  }
  if (t === "2" || /\bprimera vez\b|\bnueva?\b|\bno soy paciente\b/.test(t)) {
    estado.esPaciente = "no";
    estado.pendiente = "";
    estado.modo = "";
    await etiquetarNombres(conversation, ["No paciente"]);
    await iniciarPrimeraVez(conversation, estado);
    return;
  }
  if (t === "3" || /\botras consultas?\b|\botra consulta\b|\btemas? varios\b/.test(t)) {
    estado.pendiente = "";
    estado.modo = "";
    await iniciarOtrasConsultas(conversation, estado);
    return;
  }
  await decir(conversation.id, conversation.contactId, noValida(listaPacienteTipo()));
}

async function iniciarOtrasConsultas(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  estado.paso = "otrasConsultas";
  estado.opciones = [];
  await guardar(conversation.id, estado);
  await preguntar(conversation, TEXTO_OTRAS_CONSULTAS_PEDIR);
}

async function cerrarOtrasConsultas(
  conversation: WaConversation,
  estado: MenuEstado,
  texto: string,
): Promise<void> {
  const consulta = texto.replace(/\s+/g, " ").trim();
  estado.motivoConsulta = consulta.slice(0, 400);
  await etiquetarNombres(conversation, ["Temas varios", "Derivado a asesor"]);
  await decir(
    conversation.id,
    conversation.contactId,
    ["Otras consultas (Temas varios)", lineaDato("Consulta", estado.motivoConsulta)].join("\n"),
  );
  await decir(conversation.id, conversation.contactId, TEXTO_OTRAS_CONSULTAS_CIERRE);
  await derivarAAsesor(conversation);
  await guardar(conversation.id, vacio("menu", estado));
}

async function iniciarPrimeraVez(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  estado.paso = "primeraVezDatos";
  estado.esPaciente = "no";
  estado.opciones = [];
  await guardar(conversation.id, estado);
  await preguntar(conversation, TEXTO_PRIMERA_VEZ_PEDIR);
}

type PrimeraVezExtraido = {
  edad: string;
  motivoConsulta: string;
  cobertura: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
};

async function parsearPrimeraVezConIa(conversationId: string, texto: string): Promise<PrimeraVezExtraido> {
  const bot = await getWhatsappBotConfig();
  const rawModelos =
    bot?.data && typeof bot.data === "object"
      ? (bot.data as { modelos?: { detectar?: unknown } }).modelos
      : undefined;
  const modelo =
    (typeof rawModelos?.detectar === "string" && rawModelos.detectar.trim()) || MODELO_PEDIDO_DATOS;

  return completeStructured<PrimeraVezExtraido>({
    conversacionId: conversationId,
    paso: "detectar",
    modelo,
    reasoningEffort: "low",
    schemaName: "primera_vez_datos",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["edad", "motivoConsulta", "cobertura", "nombre", "apellido", "email", "telefono"],
      properties: {
        edad: { type: "string" },
        motivoConsulta: { type: "string" },
        cobertura: { type: "string" },
        nombre: { type: "string" },
        apellido: { type: "string" },
        email: { type: "string" },
        telefono: { type: "string" },
      },
    },
    instructions: [
      "Extraé datos de un mensaje de WhatsApp de alguien que consulta por primera vez en INECO (Argentina).",
      "Devolvé solo JSON. Si un dato no está, string vacío.",
      "edad: número de años de la persona a atender (solo dígitos si podés).",
      "motivoConsulta: por qué consulta / qué necesita.",
      "Separá nombre y apellido si vienen juntos. email y telefono/celular si figuran.",
      "No inventes datos.",
    ].join("\n"),
    content: `Mensaje:\n${texto}`,
  });
}

async function cerrarPrimeraVezConAsesor(
  conversation: WaConversation,
  estado: MenuEstado,
): Promise<void> {
  await sincronizarPacienteYEdad(conversation, estado);
  await etiquetarNombres(conversation, ["No paciente", "Derivado a asesor"]);
  const quien = [estado.nombre, estado.apellido].filter(Boolean).join(" ");
  const grupo = grupoEtarioDeEstado(estado);
  await decir(
    conversation.id,
    conversation.contactId,
    [
      "Orientación primera vez (derivado a asesor)",
      lineaDato("Nombre y apellido", quien),
      lineaDato("Edad", estado.edad),
      lineaDato("Grupo etario", grupo === "adulto" ? "Adulto" : grupo === "infanto" ? "Infanto" : ""),
      lineaDato("Motivo", estado.motivoConsulta),
      lineaDato("Cobertura", estado.cobertura),
      lineaDato("Mail", estado.email),
      lineaDato("Celular", estado.telefono),
    ].join("\n"),
  );
  await decir(conversation.id, conversation.contactId, TEXTO_PRIMERA_VEZ_CIERRE);
  await derivarAAsesor(conversation);
  await guardar(conversation.id, vacio("menu", { ...estado, esPaciente: "no" }));
}

async function recibirPrimeraVezDatos(
  conversation: WaConversation,
  estado: MenuEstado,
  texto: string,
): Promise<void> {
  try {
    const extraido = await parsearPrimeraVezConIa(conversation.id, texto);
    if (extraido.edad.trim()) estado.edad = extraido.edad.replace(/\D/g, "") || extraido.edad.trim();
    if (extraido.motivoConsulta.trim()) estado.motivoConsulta = extraido.motivoConsulta.trim();
    if (extraido.cobertura.trim()) estado.cobertura = extraido.cobertura.trim();
    if (extraido.nombre.trim()) estado.nombre = extraido.nombre.trim();
    if (extraido.apellido.trim()) estado.apellido = extraido.apellido.trim();
    const mail = emailDe(extraido.email);
    if (mail) estado.email = mail;
    if (extraido.telefono.trim()) estado.telefono = extraido.telefono.trim();
    if (!estado.apellido.trim() && estado.nombre.includes(" ")) {
      const partes = estado.nombre.trim().split(/\s+/);
      if (partes.length >= 2) {
        estado.nombre = partes[0]!;
        estado.apellido = partes.slice(1).join(" ");
      }
    }
  } catch {
    // Igual derivamos: el mensaje queda en el chat para el asesor.
  }
  if (!estado.telefono.trim()) await asegurarTelefono(conversation, estado);
  // Cualquier respuesta pasa a un humano (fin del bot).
  await cerrarPrimeraVezConAsesor(conversation, estado);
}

async function responderMenu(conversation: WaConversation, estado: MenuEstado, texto: string): Promise<void> {
  if (estado.paso === "algoMas") {
    await responderAlgoMas(conversation, estado, texto);
    return;
  }

  if (estado.paso === "sede") {
    const sede = sedeElegida(texto);
    if (!sede) {
      await decir(conversation.id, conversation.contactId, noValida(listaSedes()));
      return;
    }
    await etiquetarSede(conversation, sede);
    if (sinTildes(sede) !== "caba") {
      const datos = await mensajeDeSede(sede);
      const siguiente = vacio("algoMas", estado);
      siguiente.pendiente = "desde:sede";
      await guardar(conversation.id, siguiente);
      await decir(
        conversation.id,
        conversation.contactId,
        `${datos}\n\n${preguntaAlgoMas(true)}`,
      );
      return;
    }
    await irAPacienteTipo(conversation);
    return;
  }

  if (estado.paso === "pacienteTipo") {
    await responderPacienteTipo(conversation, estado, texto);
    return;
  }

  if (estado.paso === "primeraVezDatos") {
    if (quiereVolver(sinTildes(texto).trim())) {
      await irAPacienteTipo(conversation);
      return;
    }
    await recibirPrimeraVezDatos(conversation, estado, texto);
    return;
  }

  if (estado.paso === "otrasConsultas") {
    if (quiereVolver(sinTildes(texto).trim())) {
      await irAPacienteTipo(conversation);
      return;
    }
    const limpio = texto.replace(/\s+/g, " ").trim();
    if (limpio.length < 3) {
      await preguntar(conversation, TEXTO_OTRAS_CONSULTAS_PEDIR);
      return;
    }
    await cerrarOtrasConsultas(conversation, estado, limpio);
    return;
  }

  if (
    estado.paso === "info" ||
    estado.paso === "infoTema" ||
    estado.paso === "queja" ||
    (estado.paso === "confirmar" && estado.modo === "queja")
  ) {
    await responderInfo(conversation, estado, texto);
    return;
  }

  if (estado.paso !== "menu") {
    await caminoTurnos(conversation, estado, texto);
    return;
  }

  if (/^0$/.test(texto) || sinTildes(texto) === "menu" || quiereVolver(texto)) {
    await cerrarAlgoMas(conversation);
    return;
  }
  const opcion = opcionElegida(texto);
  if (!opcion) {
    await decir(conversation.id, conversation.contactId, noValida(listaMenu()));
    return;
  }
  if (opcion.clave === "turnos") {
    await etiquetarNombres(conversation, ["turnos", "CABA"], true);
    await guardar(conversation.id, vacio("turnos", estado));
    await decir(conversation.id, conversation.contactId, listaTurnos());
    return;
  }
  if (opcion.clave === "pagos") {
    await etiquetarNombres(conversation, ["pagos"]);
    await decir(conversation.id, conversation.contactId, textoInformarPago(estado.dni));
    await irAMenuServicios(conversation, estado);
    return;
  }
  if (opcion.clave === "recetas") {
    await etiquetarNombres(conversation, ["recetas"]);
    await decir(conversation.id, conversation.contactId, TEXTO_SOLICITAR_RECETAS);
    await irAMenuServicios(conversation, estado);
    return;
  }
  await decir(conversation.id, conversation.contactId, noValida(listaMenu()));
}
