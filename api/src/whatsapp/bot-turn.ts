import { accionPermitida, ejecutarAccion, textoAcciones, type AccionClave } from "./acciones.js";
import { getWhatsappBotConfig } from "./bot-config.js";
import { getWhatsappConocimiento } from "./conocimiento.js";
import {
  fillEmptyContactFields,
  getConversation,
  listRecentMessagesByConversation,
  replaceContactPatientFields,
  setConversationAssignee,
  setConversationIntencion,
  setConversationResumen,
  setConversationTags,
  appendConversationAuditoria,
} from "./firestore-store.js";
import {
  asegurarCasos,
  casoActivo,
  copiarFichaEnCaso,
  diffFicha,
  faltantesCaso,
  incorporarPersonas,
  pilaDeCasos,
  precargarCaso,
  preguntaDelCaso,
  resultadoReservar,
  textoEstadoDialogo,
  vincularDatoPedido,
  type WaPausaDialogo,
} from "./estado-dialogo.js";
import { listIntenciones } from "./intenciones.js";
import { getWhatsappMotorConfig } from "./motor-config.js";
import { completeStructured } from "./openai-client.js";
import { listWhatsappTagCatalog } from "./tags.js";
import type { WaAuditoriaPaso } from "./types.js";

const PREGUNTA_CONFLICTO =
  "Te puedo ayudar con las dos cosas, primero una y después la otra. ¿Preferís que empecemos por la cancelación del turno, o por el turno nuevo?";
const AVISO_SISTEMA_TURNOS =
  "Hubo un problema con el sistema de turnos y no pude reservarlo. Lo dejo derivado a una persona del equipo.";
const PREGUNTA_ALGO_MAS = "¿Necesitás algo más?";
const AVISO_FUERA =
  "Solo puedo ayudarte con consultas de INECO: turnos, tratamientos, profesionales, sedes y coberturas. ¿En qué te puedo ayudar?";
const AVISO_FUERA_DERIVA =
  "Te aviso: este canal es para consultas de INECO. Como seguís con otro tema, te paso con una persona del equipo.";
const AVISO_EQUIPO = "Listo. Alguien del equipo te va a escribir por este medio.";

const MODELO_DETECTAR = "gpt-6-luna";
const MODELO_RESPONDER = "gpt-6-luna";

const SLICES: Record<string, string[]> = {
  INFO_SUCURSALES: ["Institución", "Contacto", "Sedes", "Derivaciones", "Glosario"],
  INFO_PROFESIONALES: ["Institución", "Consultas", "Derivaciones", "Glosario", "Sedes"],
  INFO_TRATAMIENTOS: [
    "Institución",
    "Glosario",
    "Consultas",
    "Evaluaciones",
    "Programas",
    "Coberturas",
    "Derivaciones",
  ],
  TURNOS: ["Institución", "Contacto"],
  QUEJAS: ["Institución", "Contacto"],
};

type Deliver = (conversationId: string, text: string) => Promise<unknown>;

let deliver: Deliver = async () => {
  throw new Error("El envío del bot no está conectado");
};

export function setBotDeliver(fn: Deliver): void {
  deliver = fn;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const tickets = new Map<string, number>();
const running = new Set<string>();
const pending = new Set<string>();

function clampWait(raw: unknown, agrupar: boolean): number {
  if (!agrupar) return 0;
  const n = Number(raw ?? 40);
  if (!Number.isFinite(n)) return 40;
  return Math.min(120, Math.max(0, Math.round(n)));
}

async function waitMs(): Promise<number> {
  const [bot, motor] = await Promise.all([getWhatsappBotConfig(), getWhatsappMotorConfig()]);
  const mensajeria =
    bot?.data.mensajeria && typeof bot.data.mensajeria === "object"
      ? (bot.data.mensajeria as Record<string, unknown>)
      : {};
  return clampWait(mensajeria.tiempoEsperaEntreMensajes, motor.data.mensajeria.agruparMensajes);
}

export function scheduleBotTurn(conversationId: string, options?: { immediate?: boolean }): void {
  const ticket = (tickets.get(conversationId) ?? 0) + 1;
  tickets.set(conversationId, ticket);
  const previous = timers.get(conversationId);
  if (previous) clearTimeout(previous);
  const wait = options?.immediate ? Promise.resolve(0) : waitMs();
  void wait.then((ms) => {
    if (tickets.get(conversationId) !== ticket) return;
    const timer = setTimeout(() => {
      timers.delete(conversationId);
      void kick(conversationId);
    }, ms);
    timers.set(conversationId, timer);
  });
}

async function kick(conversationId: string): Promise<void> {
  if (running.has(conversationId)) {
    pending.add(conversationId);
    return;
  }
  running.add(conversationId);
  try {
    await runBotTurn(conversationId);
  } catch (error) {
    console.error("[whatsapp] bot", error);
  } finally {
    running.delete(conversationId);
    if (pending.has(conversationId)) {
      pending.delete(conversationId);
      scheduleBotTurn(conversationId);
    }
  }
}

const ETIQUETAS_BOT_NO = new Set(["pedido de info"]);

function etiquetasDelModelo(nombres: string[]): string[] {
  return nombres
    .map((name) => name.trim())
    .filter((name) => name && !ETIQUETAS_BOT_NO.has(name.toLowerCase()));
}

const BANDAS_EDAD = ["infanto", "adolescente", "adulto", "+60"];

function mencionaFrase(texto: string, frase: string): boolean {
  const escaped = frase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9+])${escaped}(?=$|[^a-z0-9])`).test(texto);
}

/** Una edad dicha en este mensaje reemplaza la banda anterior. */
function bandaEtaria(texto: string): "" | "infanto" | "adolescente" | "adulto" | "+60" {
  const t = sinTildes(texto);
  const edad = edadDicha(texto);
  if (edad != null) {
    if (edad >= 60) return "+60";
    if (edad >= 18) return "adulto";
    if (edad >= 13) return "adolescente";
    return "infanto";
  }
  if (/\b(adolescente|adolescencia)\b/.test(t)) return "adolescente";
  if (/\b(nino|nena|nene|infante|bebe|infanto)\b/.test(t)) return "infanto";
  if (/\+ ?60\b|\bmas de 60\b|\bmayores de 60\b/.test(t)) return "+60";
  if (/\badult[oa]\b/.test(t) && !/\bados\b/.test(t)) return "adulto";
  return "";
}

/** Lo que el mensaje nombra del catálogo, aunque el modelo deje las etiquetas vacías. */
function etiquetasNombradas(
  texto: string,
  items: { name: string; groupId: string }[],
  groups: { id: string; name: string }[],
): string[] {
  const t = sinTildes(texto);
  const sedeGroup = groups.find((group) => sinTildes(group.name) === "sedes");
  const out: string[] = [];
  const ordenadas = [...items].sort((a, b) => b.name.length - a.name.length);
  for (const item of ordenadas) {
    const nombre = sinTildes(item.name);
    if (!nombre || nombre === "pedido de info") continue;
    if (nombre === "particular" && !/\b(soy particular|pago particular|sin obra social)\b/.test(t)) continue;
    if (nombre === "con cobertura" && !mencionaFrase(t, nombre)) continue;
    if (mencionaFrase(t, nombre) && !out.includes(item.name)) out.push(item.name);
  }
  if (/\bados\b/.test(t) && !/\bados\s+(adultos?|infanto|infantil)\b/.test(t)) {
    for (const nombre of ["ADOS Adultos", "ADOS Infanto"]) {
      if (items.some((item) => item.name === nombre) && !out.includes(nombre)) out.push(nombre);
    }
  }
  if (/\binsomnio\b/.test(t) && items.some((item) => item.name === "Programa de Sueño") && !out.includes("Programa de Sueño")) {
    out.push("Programa de Sueño");
  }
  const coberturaGroup = groups.find((group) => sinTildes(group.name) === "coberturas");
  const coberturasPropias = items.filter((item) => {
    const nombre = sinTildes(item.name);
    return item.groupId === coberturaGroup?.id && nombre !== "con cobertura" && nombre !== "sin convenio";
  });
  const nombroConvenio = coberturasPropias.some((item) => mencionaFrase(t, sinTildes(item.name)));
  const coberturaAjena =
    /\b(ioma|osecac|medife|sancor|federada|accord|osseg|osplad|ospat|ospjn|osprera|osuthgra|ospep|ospaca|osdepyg|amffaa|prevencion salud|hospital italiano|hospital aleman|william hope|dasuten)\b/.test(
      t,
    ) ||
    (/\b(?:obra social|prepaga)\s+([a-z0-9]{3,})\b/.test(t) &&
      !coberturasPropias.some((item) =>
        mencionaFrase(t, sinTildes((t.match(/\b(?:obra social|prepaga)\s+([a-z0-9]{3,})\b/) ?? ["", ""])[1] ?? "")),
      ));
  if (!nombroConvenio && coberturaAjena && items.some((item) => sinTildes(item.name) === "sin convenio")) {
    const ajena = items.find((item) => sinTildes(item.name) === "sin convenio");
    if (ajena && !out.includes(ajena.name)) out.push(ajena.name);
  }
  const nombroSede = items.some((item) => item.groupId === sedeGroup?.id && out.includes(item.name));
  if (
    !nombroSede &&
    /\b(donde quedan|donde queda|las sedes|que sedes|las sucursales|sucursales)\b/.test(t)
  ) {
    const caba = items.find((item) => sinTildes(item.name) === "caba");
    if (caba && !out.includes(caba.name)) out.push(caba.name);
  }
  return out;
}

/** Si el modelo no eligió intención pero el mensaje nombra algo del catálogo, igual se responde. */
function claveDeLoNombrado(
  texto: string,
  items: { name: string; groupId: string }[],
  groups: { id: string; name: string }[],
  claves: Set<string>,
): string {
  const nombres = etiquetasNombradas(texto, items, groups);
  if (!nombres.length) return "";
  const grupoDe = new Map(groups.map((group) => [group.id, sinTildes(group.name)]));
  const grupos = new Set(
    nombres.map((nombre) => {
      const item = items.find((row) => row.name === nombre);
      return item ? grupoDe.get(item.groupId) ?? "" : "";
    }),
  );
  const preferidas: [string, string][] = [
    ["tratamientos", "INFO_TRATAMIENTOS"],
    ["profesionales", "INFO_PROFESIONALES"],
    ["coberturas", "INFO_COBERTURAS"],
    ["sedes", "INFO_SUCURSALES"],
  ];
  for (const [grupo, clave] of preferidas) {
    if (grupos.has(grupo) && claves.has(clave)) return clave;
  }
  return "";
}

function stringField(root: Record<string, unknown>, key: string): string {
  const value = root[key];
  return typeof value === "string" ? value.trim() : "";
}

function modelos(data: Record<string, unknown>): { detectar: string; responder: string } {
  const raw = data.modelos;
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    detectar: stringField(row, "detectar") || MODELO_DETECTAR,
    responder: stringField(row, "responder") || MODELO_RESPONDER,
  };
}

function sliceKnowledge(markdown: string, hints: string[]): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks: { title: string; body: string[] }[] = [];
  let title = "inicio";
  let body: string[] = [];
  const flush = () => {
    chunks.push({ title, body });
    body = [];
  };
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flush();
      title = line.replace(/^##\s+/, "").trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return chunks
    .filter(
      (chunk) =>
        chunk.title === "inicio" ||
        hints.some((hint) => chunk.title.toLowerCase().includes(hint.toLowerCase())),
    )
    .map((chunk) => {
      const text = chunk.body.join("\n").trim();
      if (!text) return "";
      return chunk.title === "inicio" ? text : `## ${chunk.title}\n${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

type Ficha = {
  telefono: string;
  consultaPara: string;
  relacionFamiliar: string;
  pacienteNombre: string;
  pacienteApellido: string;
  contactoNombre: string;
  contactoApellido: string;
  grupoEtario: string;
  cobertura: string;
  esPaciente: string;
  dni: string;
  sexo: string;
  email: string;
};

const ETIQUETA_DATO: Record<string, string> = {
  consultaPara: "si la consulta es para quien escribe o para otra persona",
  relacionFamiliar: "qué relación tiene quien escribe con el paciente",
  pacienteNombre: "el nombre del paciente",
  pacienteApellido: "el apellido del paciente",
  contactoNombre: "el nombre de quien escribe",
  contactoApellido: "el apellido de quien escribe",
  grupoEtario: "la edad del paciente, o si es niño o adulto",
  cobertura: "la obra social o prepaga",
  dni: "el DNI del paciente",
  sexo: "si el paciente es masculino o femenino",
  email: "el email",
};

function fichaDesdeContacto(contact: {
  phoneNumber?: string | null;
  consultaPara?: string | null;
  relacionFamiliar?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactoNombre?: string | null;
  contactoApellido?: string | null;
  grupoEtario?: string | null;
  cobertura?: string | null;
  esPaciente?: boolean | null;
  dni?: string | null;
  sexo?: string | null;
  email?: string | null;
} | null | undefined): Ficha {
  return {
    telefono: contact?.phoneNumber?.trim() ?? "",
    consultaPara: contact?.consultaPara ?? "",
    relacionFamiliar: contact?.relacionFamiliar ?? "",
    pacienteNombre: contact?.firstName?.trim() ?? "",
    pacienteApellido: contact?.lastName?.trim() ?? "",
    contactoNombre: contact?.contactoNombre?.trim() ?? "",
    contactoApellido: contact?.contactoApellido?.trim() ?? "",
    grupoEtario: contact?.grupoEtario ?? "",
    cobertura: contact?.cobertura?.trim() ?? "",
    esPaciente: contact?.esPaciente === true ? "si" : contact?.esPaciente === false ? "no" : "",
    dni: contact?.dni?.trim() ?? "",
    sexo: contact?.sexo ?? "",
    email: contact?.email?.trim() ?? "",
  };
}

function requeridosDe(clave: string, ficha: Ficha): string[] {
  const base: Record<string, string[]> = {
    TURNOS: ["consultaPara", "pacienteNombre", "pacienteApellido", "dni", "sexo", "grupoEtario"],
    INFO_TRATAMIENTOS: [],
    INFO_PROFESIONALES: [],
    QUEJAS: ["pacienteNombre"],
  };
  const campos = [...(base[clave] ?? [])];
  if (ficha.consultaPara === "tercero") {
    campos.push("relacionFamiliar", "contactoNombre");
  }
  return campos;
}

function inferirRelacion(
  textos: string[],
):
  | "Padre"
  | "Madre"
  | "Abuelo"
  | "Abuela"
  | "Hijo"
  | "Hija"
  | "Tío"
  | "Tía"
  | "Sobrino"
  | "Sobrina"
  | "Esposo"
  | "Esposa"
  | "Pareja"
  | "Novio"
  | "Novia"
  | "Tutor"
  | "" {
  const texto = textos
    .join("\n")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const reglas: [RegExp, Exclude<ReturnType<typeof inferirRelacion>, "">][] = [
    [/\b(mi|su|para mi|para su|es mi|por mi) (esposa)\b|\bsoy (la|su) esposa\b|\bmi mujer\b/, "Esposa"],
    [/\b(mi|su|para mi|para su|es mi|por mi) (esposo|marido)\b|\bsoy (el|su) (esposo|marido)\b/, "Esposo"],
    [/\b(mi|su|para mi|para su|es mi|por mi) novia\b|\bsoy (la|su) novia\b/, "Novia"],
    [/\b(mi|su|para mi|para su|es mi|por mi) novio\b|\bsoy (el|su) novio\b/, "Novio"],
    [/\b(mi|su|para mi|para su|es mi|por mi) pareja\b|\bsoy su pareja\b/, "Pareja"],
    [/\b(mi|su|para mi|para su|es mi|por mi) (hija|nena)\b|\bsoy (la|su) hija\b/, "Hija"],
    [/\b(mi|su|para mi|para su|es mi|por mi) (hijo|nene)\b|\bsoy (el|su) hijo\b/, "Hijo"],
    [/\b(mi|su|para mi|para su|es mi|por mi) abuela\b|\bsoy (la|su) abuela\b/, "Abuela"],
    [/\b(mi|su|para mi|para su|es mi|por mi) abuelo\b|\bsoy (el|su) abuelo\b/, "Abuelo"],
    [/\b(mi|su|para mi|para su|es mi|por mi) tia\b|\bsoy (la|su) tia\b/, "Tía"],
    [/\b(mi|su|para mi|para su|es mi|por mi) tio\b|\bsoy (el|su) tio\b/, "Tío"],
    [/\b(mi|su|para mi|para su|es mi|por mi) sobrina\b|\bsoy (la|su) sobrina\b/, "Sobrina"],
    [/\b(mi|su|para mi|para su|es mi|por mi) sobrino\b|\bsoy (el|su) sobrino\b/, "Sobrino"],
    [/\b(soy (el|la|su) tutor(a)?|mi tutor(a)?|su tutor(a)?)\b/, "Tutor"],
    [/\b(mi|su|para mi|para su|es mi|por mi) (mama|madre)\b|\bsoy (la|su) (mama|madre)\b/, "Madre"],
    [/\b(mi|su|para mi|para su|es mi|por mi) (papa|padre)\b|\bsoy (el|su) (papa|padre)\b/, "Padre"],
  ];
  for (const [regla, valor] of reglas) {
    if (regla.test(texto)) return valor;
  }
  return "";
}

function faltantesDe(clave: string, ficha: Ficha): string[] {
  return requeridosDe(clave, ficha).filter((campo) => !ficha[campo as keyof Ficha]);
}

function textoFicha(ficha: Ficha): string {
  return Object.entries(ficha)
    .map(([campo, valor]) => `${campo}: ${valor}`)
    .join("\n");
}

function buenosAiresNow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

function horaBuenosAires(now: Date): number {
  const hora = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  const n = Number(hora ?? "12");
  return n === 24 ? 0 : n;
}

function tratoHorario(now: Date): { saludo: string; despedida: string } {
  const hora = horaBuenosAires(now);
  if (hora >= 6 && hora < 12) return { saludo: "Buen día", despedida: "un excelente día" };
  if (hora >= 12 && hora < 20) return { saludo: "Buenas tardes", despedida: "una excelente tarde" };
  return { saludo: "Buenas noches", despedida: "una excelente noche" };
}

export type BotTurnIO = {
  now?: () => Date;
  skipUsage?: boolean;
  getConversation?: typeof getConversation;
  listMessages?: typeof listRecentMessagesByConversation;
  fillEmptyContactFields?: typeof fillEmptyContactFields;
  replaceContactFields?: typeof replaceContactPatientFields;
  setConversationResumen?: typeof setConversationResumen;
  setConversationTags?: typeof setConversationTags;
  setConversationAssignee?: typeof setConversationAssignee;
  setConversationIntencion?: typeof setConversationIntencion;
  appendAuditoria?: (id: string, paso: WaAuditoriaPaso) => Promise<void>;
  /** Si viene, reemplaza los modelos de la configuración solo en esta corrida. */
  modelos?: { detectar: string; responder: string };
  /** Solo pruebas. En producción el paso que redacta sigue en "none". */
  esfuerzoResponder?: "none" | "minimal" | "low" | "medium" | "high";
  /** Solo pruebas. Modelos que no aceptan el campo reasoning. */
  omitirRazonamiento?: boolean;
  onUsage?: (uso: {
    paso: "detectar" | "responder";
    modelo: string;
    tokensEntrada: number;
    tokensSalida: number;
    tokensTotal: number;
  }) => void;
  deliver?: Deliver;
  trace?: { terra?: unknown; lunaLlamada: boolean };
};

function textoIdentidad(bot: Record<string, unknown>): { nombre: string; texto: string } {
  const raw = bot.identidad;
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nombre = stringField(row, "nombre") || stringField(row, "nombreBot") || "Nina";
  const partes = Object.entries(row)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([key, value]) => `${key}: ${String(value).trim()}`);
  const texto = partes.length
    ? `Te llamás ${nombre}. ${partes.join(". ")}. Español de Argentina, con voseo.`
    : "Te llamás Nina. Sos la asistente virtual de INECO CABA. Tono amable, claro y profesional. Español de Argentina, con voseo.";
  return { nombre, texto };
}

function textosCharla(bot: Record<string, unknown>, nombre: string, now: Date): {
  saludo: string;
  pregunta: string;
  cierre: string;
} {
  const inicio =
    bot.inicio && typeof bot.inicio === "object" ? (bot.inicio as Record<string, unknown>) : {};
  const cierre =
    bot.cierre && typeof bot.cierre === "object" ? (bot.cierre as Record<string, unknown>) : {};
  const trato = tratoHorario(now);
  const aplicar = (texto: string) =>
    texto
      .replaceAll("{nombreBot}", nombre)
      .replaceAll("{saludo}", trato.saludo)
      .replaceAll("{despedida}", trato.despedida);
  const saludo = aplicar(
    stringField(inicio, "saludo") ||
      "¡{saludo}! Soy {nombreBot}, la asistente virtual de INECO.\nEste número de WhatsApp corresponde a nuestra sede central de CABA.",
  );
  return {
    saludo,
    pregunta: aplicar(
      stringField(inicio, "preguntaMotivo") ||
        "Si necesitás los datos de contacto de otra sede, decime cuál.\nSi tu consulta es para nuestra sede, contame en qué puedo ayudarte.",
    ),
    cierre: aplicar(
      stringField(cierre, "mensajeDespedida") ||
        "¡Gracias por comunicarte con INECO! Fue un gusto ayudarte. Que tengas {despedida}.",
    ),
  };
}

function capitulosDe(claves: string[], textoPersona = ""): string[] {
  const hints: string[] = [];
  for (const clave of claves) {
    for (const hint of SLICES[clave] ?? ["Institución"]) {
      if (!hints.includes(hint)) hints.push(hint);
    }
  }
  if (
    /\b(coberturas?|obra social|prepagas?|pami|swiss(?:\s+medical)?|osde|galeno|medicus|omint|cud|particular)\b/i.test(
      textoPersona,
    ) &&
    !hints.includes("Coberturas")
  ) {
    hints.push("Coberturas");
  }
  return hints.length ? hints : ["Institución"];
}

const SEDES_AJENAS: { re: RegExp; nombre: string }[] = [
  { re: /ramos(?:\s+mej[ií]a)?/gi, nombre: "Ramos Mejía" },
  { re: /quilmes/gi, nombre: "Quilmes" },
  { re: /temperley/gi, nombre: "Temperley" },
  { re: /moreno/gi, nombre: "Moreno" },
  { re: /pilar/gi, nombre: "Pilar" },
  { re: /jun[ií]n/gi, nombre: "Junín" },
  { re: /rosario/gi, nombre: "Rosario" },
  { re: /comodoro(?:\s+rivadavia)?/gi, nombre: "Comodoro Rivadavia" },
  { re: /san\s+juan/gi, nombre: "San Juan" },
];

function esSoloDespedida(textos: string[]): boolean {
  const junto = textos.join(" ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!junto || junto.includes("?")) return false;
  if (/\b(turno|precio|direcci[oó]n|sede|sucursal|doctor|doctora|horario|programa|cobertura)\b/.test(junto)) {
    return false;
  }
  return /\b(gracias|hasta luego|chau|adi[oó]s|nos vemos|era todo|nada m[aá]s)\b/.test(junto);
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function edadDicha(texto: string): number | null {
  const t = sinTildes(texto);
  const matches = [
    ...t.matchAll(/\b(?:tiene|tengo)\s+(\d{1,2})\b(?!\d)|\b(\d{1,2})\s+anos\b/g),
  ];
  const last = matches.at(-1);
  if (!last) return null;
  const n = Number(last[1] || last[2]);
  if (n < 1 || n > 110) return null;
  return n;
}

/** Deja en datos solo lo que este mensaje dice, y pisa edad o apellido si los corrige. */
function acotarDatosAlTexto(
  texto: string,
  datos: {
    pacienteNombre: string;
    pacienteApellido: string;
    contactoNombre: string;
    contactoApellido: string;
    grupoEtario: "" | "infanto" | "adulto";
    dni: string;
    sexo: "" | "masculino" | "femenino";
    email: string;
  },
): void {
  const t = sinTildes(texto);
  const dicho = (valor: string) => {
    const limpio = sinTildes(valor);
    return limpio.length > 1 && t.includes(limpio);
  };
  if (!dicho(datos.pacienteNombre)) datos.pacienteNombre = "";
  if (!dicho(datos.pacienteApellido)) datos.pacienteApellido = "";
  if (!dicho(datos.contactoNombre)) datos.contactoNombre = "";
  if (!dicho(datos.contactoApellido)) datos.contactoApellido = "";
  if (!dicho(datos.email)) datos.email = "";
  const dni = datos.dni.replace(/\D/g, "");
  if (!dni || !t.includes(dni)) datos.dni = "";
  if (datos.sexo && !t.includes(datos.sexo)) datos.sexo = "";
  const apellido = t.match(/\bapellido\s+(?:es|seria|correcto(?:\s+es)?)\s+([a-zñ]{2,})/);
  if (apellido?.[1]) {
    datos.pacienteApellido = apellido[1].charAt(0).toUpperCase() + apellido[1].slice(1);
  }
}

/** Un turno para quien escribe y otro para un familiar, o más de un turno nombrado. */
function nombraVariosTurnos(texto: string): boolean {
  const t = sinTildes(texto);
  if (!/\bturno/.test(t)) return false;
  if (/\b(dos|tres|2|3)\s+turnos\b|\botro turno\b|\bturnos?\s+para\b[\s\S]{0,40}\by\b/.test(t)) return true;
  const propio = /\bpara mi\b(?!\s+(hij|nen|espos|mama|papa|madre|padre|abuel|tio|tia|sobrin))/.test(t);
  const familiar = /\b(hij[oa]|nene|nena|espos[oa]|mama|papa|madre|padre|abuel[oa])\b/.test(t);
  return propio && familiar;
}

function temasDelMensaje(texto: string, temas: string[]): string[] {
  const limpios = temas.map((tema) => tema.trim()).filter(Boolean).slice(0, 6);
  if (limpios.length >= 2) return limpios;
  if (nombraVariosTurnos(texto) && limpios.length < 2) {
    return limpios.length ? [...limpios, "otro turno"] : ["turno para quien escribe", "otro turno"];
  }
  return limpios;
}

function noQuiereNadaMas(texto: string, cortesia: string): boolean {
  const t = sinTildes(texto).replace(/[!¡.?,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/\b(turno|precio|direccion|sede|doctor|doctora|horario|programa|cobertura|dni)\b/.test(t)) return false;
  if (t.includes("?")) return false;
  if (cortesia === "cierre") return true;
  return /^(no|nop|nada|no gracias|eso es todo|era todo|listo|chau|gracias|ok gracias|hasta luego|adios|nos vemos)( nada mas)?$/.test(
    t,
  ) || t === "nada mas" || t === "no nada mas";
}

function sinPresentacion(texto: string): string {
  return texto
    .split(/(?<=[.!?])\s+/)
    .filter((frase) => {
      const t = sinTildes(frase);
      return !/\bsoy nina\b/.test(t) && !/\basistente virtual\b/.test(t) && !/\bme llamo nina\b/.test(t);
    })
    .join(" ")
    .trim();
}

/** La persona pide cancelar. "Me cancelaron" es una queja, no un pedido de cancelar. */
function pideCancelar(texto: string): boolean {
  const t = sinTildes(texto);
  if (/\bme (lo |la |los |las )?cancel/.test(t)) return false;
  return /\b(quiero|necesito|puedo|quisiera|para|vengo a) cancel|\bcancel(ar|ame|alo|ala|enlo)\b/.test(t);
}

/** Cancelar y sacar otro turno no se pueden hacer juntos. Una queja más un turno van en cola. */
function hayConflictoDePedidos(texto: string): boolean {
  const t = sinTildes(texto);
  const turnoNuevo = /\b(sacar|sacame|otro turno|turno nuevo|uno nuevo|reprogram)\b/.test(t);
  return pideCancelar(texto) && turnoNuevo;
}

/** INFO se responde ya. Quejas piden un dato. Turnos piden varios. */
function pasosDeIntencion(clave: string): number {
  if (clave.startsWith("INFO_")) return 0;
  if (clave === "QUEJAS") return 1;
  if (clave === "TURNOS") return 2;
  return 1;
}

/** Pide el catálogo entero o que se ignoren las reglas. No es una consulta concreta. */
function esPedidoDeCatalogo(texto: string): boolean {
  const t = sinTildes(texto);
  return /\b(todos los precios|todas las tarifas|lista completa|pasame todo|aunque no esten|ignora las instrucciones|ignora que sos|sin limites)\b/.test(
    t,
  );
}

/** Pide que confirmemos una reserva que ya existiría. No es un turno nuevo. */
function pideConfirmarReserva(texto: string): boolean {
  const t = sinTildes(texto);
  return /\bconfirm/.test(t) && /\b(reserv|agend|ya qued|confirmad)/.test(t);
}

/** Saca mails que no están escritos en la base de este turno. */
function sinMailsInventados(texto: string, base: string): string {
  const permitidos = new Set(
    (base.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map((mail) => mail.toLowerCase()),
  );
  return texto
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, (mail) =>
      permitidos.has(mail.toLowerCase()) ? mail : "",
    )
    .replace(/\s+(o|y)\s*(?=[,.]|$)/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

/** Pregunta quién atiende o qué hace un profesional. Nombrar la especialidad no alcanza. */
function pideListaDeProfesionales(texto: string): boolean {
  const t = sinTildes(texto);
  return /\b(que profesionales|que profesional|quienes atienden|quien atiende|que medicos|que medico|que prestaciones|que hace)\b/.test(
    t,
  );
}

function sinSaludoInicial(texto: string): string {
  return texto
    .replace(
      /^(?:¡+\s*)?(?:hola|buen\s*d[ií]a|buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches)\b[!,.\s]*/i,
      "",
    )
    .trim();
}

function sedeFueraDeCaba(texto: string): string | null {
  const marcas: { index: number; sede: string | null }[] = [];
  for (const sede of SEDES_AJENAS) {
    for (const match of texto.matchAll(sede.re)) {
      marcas.push({ index: match.index ?? 0, sede: sede.nombre });
    }
  }
  for (const match of texto.matchAll(/caba|recoleta|alvear|sede central/gi)) {
    marcas.push({ index: match.index ?? 0, sede: null });
  }
  marcas.sort((a, b) => a.index - b.index);
  return marcas.length ? marcas[marcas.length - 1]!.sede : null;
}

/** "caba" si nombró la sede central, el nombre si nombró otra, null si no nombró sede. */
function sedeMencionada(texto: string): "caba" | string | null {
  const ajena = sedeFueraDeCaba(texto);
  if (ajena) return ajena;
  if (/caba|recoleta|alvear|sede central/i.test(texto)) return "caba";
  return null;
}

/**
 * Sede del turno de este mensaje. Una sede que solo aparece para pedir
 * dirección, teléfono u horario no cuenta: no es el lugar del turno ni de la cancelación.
 */
function sedeDelTurno(texto: string): string | null {
  const partes = texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
  let sede: string | null = null;
  let huboPedidoDeTurno = false;
  for (const parte of partes) {
    const t = sinTildes(parte);
    const lugar = sedeMencionada(parte);
    const pideTurnoAhi = /\b(turno|sacar|sacame|reserv)\b/.test(t) && /\b(en|para)\b/.test(t);
    const pideDato = /\b(direccion|telefono|whatsapp|horario|donde queda|donde quedan|como llego)\b/.test(t);
    const correccion = /\b(mejor|prefiero|en realidad|cambia|hacelo)\b/.test(t);
    if (/\b(turno|sacar|sacame)\b/.test(t)) huboPedidoDeTurno = true;
    if (pideDato && !pideTurnoAhi) continue;
    if (!lugar) continue;
    if (pideTurnoAhi || (huboPedidoDeTurno && correccion)) {
      sede = lugar === "caba" ? null : lugar;
    }
  }
  return sede;
}

function sinSignosDePregunta(bloques: string[], pregunta: string): { bloques: string[]; pregunta: string } {
  let unica = pregunta.trim();
  const limpios: string[] = [];
  for (const bloque of bloques) {
    const frases = bloque
      .split(/(?<=[.!?])\s+/)
      .map((frase) => frase.trim())
      .filter(Boolean);
    const datos = frases.filter((frase) => !frase.includes("?"));
    const preguntas = frases.filter((frase) => frase.includes("?"));
    if (!unica && preguntas[0]) unica = preguntas[0];
    if (datos.length) limpios.push(datos.join(" "));
  }
  return { bloques: limpios, pregunta: unica };
}
function textoEstado(conversation: {
  intencionAbierta?: string | null;
  intencionConcluida?: boolean;
  intencionPropuesta?: string | null;
  intencionCola?: string[] | null;
}, fase: "inicio" | "en_curso"): string {
  const abierta = conversation.intencionAbierta?.trim() || "";
  const faseTexto =
    fase === "inicio"
      ? "Fase: inicio. Todavía no hablamos. La primera respuesta saluda."
      : "Fase: en curso. Ya saludamos. No vuelvas a presentarte.";
  if (!abierta) return `${faseTexto}\nEstado: no hay una intención abierta.`;
  if (conversation.intencionConcluida) {
    return `${faseTexto}\nEstado: la intención ${abierta} ya está concluida. La conversación sigue.`;
  }
  const cola = (conversation.intencionCola ?? []).filter(Boolean);
  const colaTexto = cola.length ? ` En cola, para después: ${cola.join(", ")}.` : "";
  if (conversation.intencionPropuesta) {
    return `${faseTexto}\nEstado: la intención ${abierta} sigue abierta. Ya preguntamos si la dejan para pasar a ${conversation.intencionPropuesta}.${colaTexto}`;
  }
  return `${faseTexto}\nEstado: la intención ${abierta} está abierta y no está concluida.${colaTexto}`;
}

function textoMensajesPrevios(
  messages: { direction: string; text: string }[],
): string {
  const lines = messages
    .filter((message) => message.text.trim())
    .slice(-5)
    .map((message) => `${message.direction === "OUTBOUND" ? "Bot" : "Persona"}: ${message.text.trim()}`);
  return lines.length ? lines.join("\n") : "(no hay mensajes anteriores)";
}

const deteccionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intencion: { type: "string" },
    peligroActual: { type: "boolean" },
    dudaSinPeligro: { type: "boolean" },
    etiquetas: { type: "array", items: { type: "string" } },
    preguntaAclaracion: { type: "string" },
    resumen: { type: "string" },
    hecho: { type: "string" },
    continuarAnterior: { type: "boolean" },
    anteriorConcluida: { type: "boolean" },
    intencionConcluida: { type: "boolean" },
    intencionSecundaria: { type: "string" },
    otras: { type: "array", items: { type: "string" } },
    temas: { type: "array", items: { type: "string" } },
    requierePersona: { type: "boolean" },
    enConflicto: { type: "boolean" },
    hayPedido: { type: "boolean" },
    fueraDeIneco: { type: "boolean" },
    cortesia: { type: "string", enum: ["", "saludo", "cierre"] },
    accion: { type: "string" },
    consulta: { type: "string" },
    personas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          etiqueta: { type: "string" },
          consultaPara: { type: "string", enum: ["", "propio", "tercero"] },
          relacionFamiliar: { type: "string" },
          pacienteNombre: { type: "string" },
          pacienteApellido: { type: "string" },
          grupoEtario: { type: "string", enum: ["", "infanto", "adulto"] },
        },
        required: ["etiqueta", "consultaPara", "relacionFamiliar", "pacienteNombre", "pacienteApellido", "grupoEtario"],
      },
    },
    datos: {
      type: "object",
      additionalProperties: false,
      properties: {
        consultaPara: { type: "string", enum: ["", "propio", "tercero"] },
        relacionFamiliar: { type: "string" },
        pacienteNombre: { type: "string" },
        pacienteApellido: { type: "string" },
        contactoNombre: { type: "string" },
        contactoApellido: { type: "string" },
        grupoEtario: { type: "string", enum: ["", "infanto", "adulto"] },
        cobertura: { type: "string" },
        esPaciente: { type: "string", enum: ["", "si", "no"] },
        dni: { type: "string" },
        sexo: { type: "string", enum: ["", "masculino", "femenino"] },
        email: { type: "string" },
      },
      required: [
        "consultaPara",
        "relacionFamiliar",
        "pacienteNombre",
        "pacienteApellido",
        "contactoNombre",
        "contactoApellido",
        "grupoEtario",
        "cobertura",
        "esPaciente",
        "dni",
        "sexo",
        "email",
      ],
    },
  },
  required: [
    "intencion",
    "peligroActual",
    "dudaSinPeligro",
    "etiquetas",
    "preguntaAclaracion",
    "resumen",
    "hecho",
    "continuarAnterior",
    "anteriorConcluida",
    "intencionConcluida",
    "intencionSecundaria",
    "otras",
    "temas",
    "requierePersona",
    "enConflicto",
    "hayPedido",
    "fueraDeIneco",
    "cortesia",
    "accion",
    "consulta",
    "personas",
    "datos",
  ],
} as Record<string, unknown>;

const respuestaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    partes: {
      type: "array",
      items: { type: "string" },
    },
    pregunta: { type: "string" },
  },
  required: ["partes", "pregunta"],
} as Record<string, unknown>;

export async function runBotTurn(conversationId: string, io?: BotTurnIO): Promise<void> {
  const getConv = io?.getConversation ?? getConversation;
  const listMessages = io?.listMessages ?? listRecentMessagesByConversation;
  const fillContact = io?.fillEmptyContactFields ?? fillEmptyContactFields;
  const replaceContact = io?.replaceContactFields ?? replaceContactPatientFields;
  const saveResumen = io?.setConversationResumen ?? setConversationResumen;
  const saveTags = io?.setConversationTags ?? setConversationTags;
  const saveAssignee = io?.setConversationAssignee ?? setConversationAssignee;
  const saveIntencion = io?.setConversationIntencion ?? setConversationIntencion;
  const saveAuditoria = io?.appendAuditoria ?? appendConversationAuditoria;
  const send = io?.deliver ?? deliver;
  const ahoraFecha = buenosAiresNow(io?.now?.() ?? new Date());
  if (io?.trace) io.trace.lunaLlamada = false;
  const conversation = await getConv(conversationId);
  if (!conversation || conversation.status !== "OPEN") return;
  if (conversation.assigneeKind === "user") return;
  if (conversation.contact?.isBlocked) return;

  const messages = await listMessages(conversationId, 40);
  let lastOutbound = -1;
  messages.forEach((message, index) => {
    if (message.direction === "OUTBOUND") lastOutbound = index;
  });
  const batch = messages
    .slice(lastOutbound + 1)
    .filter((message) => message.direction === "INBOUND" && message.text.trim());
  if (!batch.length) return;
  const anterior = lastOutbound >= 0 ? messages[lastOutbound] : undefined;
  const primeroNuevo = batch[0];
  const pausaMs =
    anterior && primeroNuevo
      ? Date.parse(primeroNuevo.createdAt) - Date.parse(anterior.createdAt)
      : 0;
  const pausaLarga = Number.isFinite(pausaMs) && pausaMs >= 6 * 60 * 60 * 1000;
  const fase: "inicio" | "en_curso" = lastOutbound < 0 || pausaLarga ? "inicio" : "en_curso";

  const [botDoc, motorDoc, intenciones, catalog, conocimiento] = await Promise.all([
    getWhatsappBotConfig(),
    getWhatsappMotorConfig(),
    listIntenciones(),
    listWhatsappTagCatalog(),
    getWhatsappConocimiento(),
  ]);
  if (!intenciones.length) return;

  const bot = botDoc?.data ?? {};
  const motor = motorDoc.data;
  const desdeConfig = modelos(bot);
  const models = {
    detectar: io?.modelos?.detectar?.trim() || desdeConfig.detectar,
    responder: io?.modelos?.responder?.trim() || desdeConfig.responder,
  };
  const instrucciones = Array.isArray(bot.instrucciones)
    ? bot.instrucciones.filter((item): item is string => typeof item === "string")
    : [];
  const plazos =
    bot.plazos && typeof bot.plazos === "object" ? (bot.plazos as Record<string, unknown>) : {};

  const tagsByName = new Map(catalog.items.map((item) => [item.name.toLowerCase(), item]));
  const riesgo = intenciones.find((item) => item.esRiesgo);

  const contact = conversation.contact;
  const ficha = fichaDesdeContacto(contact);
  const identidad = textoIdentidad(bot);
  const charla = textosCharla(bot, identidad.nombre, io?.now?.() ?? new Date());
  const estado = textoEstado(conversation, fase);
  const ahora = `Fecha y hora en Buenos Aires: ${ahoraFecha}. Sirve para saber qué día es, no para prometer turnos.`;
  const previos = textoMensajesPrevios(messages.slice(0, lastOutbound + 1));

  const detection = await completeStructured<{
    intencion: string;
    peligroActual: boolean;
    dudaSinPeligro: boolean;
    etiquetas: string[];
    preguntaAclaracion: string;
    resumen: string;
    hecho: string;
    continuarAnterior: boolean;
    anteriorConcluida: boolean;
    intencionConcluida: boolean;
    intencionSecundaria: string;
    otras: string[];
    temas: string[];
    requierePersona: boolean;
    enConflicto: boolean;
    hayPedido: boolean;
    fueraDeIneco: boolean;
    cortesia: "" | "saludo" | "cierre";
    accion: string;
    consulta: string;
    personas: {
      etiqueta: string;
      consultaPara: "" | "propio" | "tercero";
      relacionFamiliar: string;
      pacienteNombre: string;
      pacienteApellido: string;
      grupoEtario: "" | "infanto" | "adulto";
    }[];
    datos: {
      consultaPara: "" | "propio" | "tercero";
      relacionFamiliar: string;
      pacienteNombre: string;
      pacienteApellido: string;
      contactoNombre: string;
      contactoApellido: string;
      grupoEtario: "" | "infanto" | "adulto";
      cobertura: string;
      esPaciente: "" | "si" | "no";
      dni: string;
      sexo: "" | "masculino" | "femenino";
      email: string;
    };
  }>({
    conversacionId: conversationId,
    paso: "detectar",
    modelo: models.detectar,
    reasoningEffort: "low",
    omitirRazonamiento: io?.omitirRazonamiento === true,
    schemaName: "deteccion",
    schema: deteccionSchema,
    onUsage: io?.onUsage,
    instructions: [
      "Clasificá el lote de mensajes de una persona que escribe al WhatsApp de INECO.",
      "intencion: una clave del catálogo solo si el lote pide eso. Si es un saludo, un cómo estás, una despedida, un agradecimiento, o no se entiende qué quiere, dejala vacía. No elijas una clave por descarte.",
      "Si hay un segundo tema, ponelo en intencionSecundaria. Si hay uno solo, o ninguno, intencionSecundaria vacía.",
      "Si hay más de una intención, intencion es la primera, intencionSecundaria la segunda y otras el resto, sin repetir claves. Si no hay más, otras es un array vacío.",
      "temas: una frase corta por cada pedido distinto, aunque sean de la misma intención. Dos turnos para dos personas son dos temas. Tres precios de tres tratamientos son tres temas. Si hay un solo pedido, un solo elemento. Si no hay pedido, un array vacío.",
      "requierePersona=true solo si pide algo de INECO que este canal no puede cerrar: confirmar una reserva, cancelar o reprogramar un turno que ya existe, un resultado, una historia clínica o un dato clínico. false si es un turno nuevo, un precio, una sede, una cobertura, una lista, una queja o un dato de la ficha.",
      "enConflicto=true solo si los pedidos no se pueden hacer juntos: cancelar un turno y sacar otro distinto. false si uno se responde con información (precio, sede, cobertura, tratamiento, profesional) y el otro es un turno o una queja: esos van los dos, el trámite largo queda en cola. false también si se pueden responder los dos, por ejemplo un precio y una dirección.",
      "hayPedido=false si no hay un pedido concreto: saludo, despedida, o un mensaje del que no se entiende la intención. Un sí, un no, un nombre o un DNI que responde algo nuestro es hayPedido=true.",
      "fueraDeIneco=true solo si el mensaje no tiene nada que ver con INECO: cultura general, tareas, clima, deportes, política, chistes, recetas, otras empresas o datos varios. false si habla de turnos, tratamientos, profesionales, sedes, precios, coberturas, pacientes, quejas, o responde un dato que pedimos. Un saludo o una despedida no son fuera de INECO.",
      "Si pasaron varias horas desde el último mensaje, un hola no continúa la pregunta anterior: continuarAnterior=false e intencion vacía, salvo que vuelva a pedir el tema.",
      "cortesia=saludo si se presenta, dice hola o pregunta cómo estás, sin otro pedido. cierre si se despide o agradece y no pide nada más, aunque hubiera un turno u otra consulta abierta: en ese caso intencion vacía. Vacío si no hay cortesía o si en el mismo mensaje pide algo.",
      "No diagnostiques. Un síntoma no confirma una condición.",
      "peligroActual solo si hay peligro en este momento: ideas de muerte o de hacerse daño, síntomas de ACV, dolor de cabeza súbito e intenso, convulsión que no cede, pérdida de conocimiento, confusión grave, dolor de pecho o falta de aire intensa, violencia o riesgo para otros.",
      "dudaSinPeligro=true solo si no hay peligro actual y hace falta una persona: malestar intenso sin un pedido concreto, frases ambiguas sobre la vida o la muerte sin una intención explícita, antecedente de intento o de autolesión, o la crisis de un tercero en curso. false si nombra una condición como motivo o pregunta por un servicio o un precio.",
      "etiquetas: nombres exactos del catálogo, solo las concretas. No inventes etiquetas ni diagnósticos. No uses Pedido de info: es demasiado genérica. Pedido de turno sí, cuando pide sacar, consultar, cancelar o reprogramar un turno.",
      "Si el mensaje nombra una sede, un programa, una cobertura o un profesional del catálogo, esa etiqueta va sí o sí. Si no nombra sede, la sucursal es CABA: este canal es el de la sede central. ADOS sin aclarar adultos o infanto: las dos. Si dice insomnio, poné Programa de Sueño. Si nombra una obra social o prepaga que no está en el catálogo, poné Sin convenio. Una edad nueva reemplaza la banda anterior: no dejes Infanto, Adolescente y Adulto juntas.",
      "Si nombra una sede, un programa, una evaluación, una cobertura o un profesional que está en las etiquetas, poné esa. Si pregunta por todas las sedes y todavía no elige una, no etiquetes una sede.",
      "Paciente solo si dice que ya es paciente de INECO. No paciente si dice que no lo es. Primera vez si dice que es la primera vez. Decir el nombre no es ser paciente. Que le hayan cancelado un turno, o que pida uno, tampoco. No pongas Paciente junto con No paciente ni con Primera vez.",
      "Si nombra una obra social, prepaga o certificado que está en las etiquetas, poné esa etiqueta sí o sí, con el nombre exacto del catálogo. No pongas una cobertura que no nombró.",
      "preguntaAclaracion dejala vacía. La pregunta por datos faltantes la arma el otro paso, solo si el campo no está en la ficha.",
      "datos: completá solo lo que este mensaje dice sobre el caso activo. Si hay varias personas, datos es solo de esa persona: no pongas ahí el nombre, el apellido ni la edad de otra. Si corrige un dato que ya estaba, poné el valor nuevo. Si este mensaje no habla de ese campo, dejalo vacío. No inventes. El teléfono ya viene de WhatsApp: no lo pidas ni lo cambies.",
      "dni: solo dígitos, si la persona lo dijo. email: solo si lo dijo.",
      "sexo=masculino o femenino solo si el texto lo dice. Si no se sabe, vacío.",
      "consultaPara=tercero si escribe por otra persona (por ejemplo \"para mi hijo\"). propio si la consulta es para quien escribe.",
      "relacionFamiliar es quién es el paciente para quien escribe: Padre, Madre, Abuelo, Abuela, Hijo, Hija, Tío, Tía, Sobrino, Sobrina, Esposo, Esposa, Pareja, Novio, Novia, Tutor u Otro.",
      "Si ya lo dijo, completalo y no dejes el campo vacío: mi hijo o mi nene = Hijo; mi hija o mi nena = Hija; mi papá o mi padre = Padre; mi mamá o mi madre = Madre; mi abuelo = Abuelo; mi abuela = Abuela; mi tío = Tío; mi tía = Tía; mi sobrino = Sobrino; mi sobrina = Sobrina; mi marido o mi esposo = Esposo; mi esposa o mi mujer = Esposa; mi pareja = Pareja; mi novio = Novio; mi novia = Novia; soy su tutor o tutora = Tutor. No vuelvas a preguntar la relación.",
      "personas: una entrada por cada persona que pide un turno, aunque no sea hijo, hija o mamá. Incluí al papá, la mamá, la esposa, el esposo, un abuelo o cualquiera que nombren, y a quien escribe si el turno también es para esa persona. etiqueta corta (quien escribe, papá Roberto, esposa Laura, Julián). consultaPara propio solo para quien escribe. Si no hay un turno, un array vacío. No inventes personas ni dupliques las que ya están en los casos.",
      "pacienteNombre y pacienteApellido son de la persona del caso activo. Si quien escribe dice soy, yo soy o me llamo, ese nombre y ese apellido son los suyos, aunque en el mismo mensaje nombre a otra persona.",
      "grupoEtario es la edad de la persona del caso activo. infanto si esa persona tiene menos de 18 o dice que es un niño. adulto si tiene 18 o más, o si dice que es adulta. Un número solo, cuando el dato pedido es la edad, también es la edad. La edad dicha junto a un hijo, una hija u otro familiar no es la de quien escribe. Si este mensaje no dice la edad del caso activo, dejalo vacío.",
      "resumen: una frase corta de toda la charla hasta ahora, actualizando el resumen anterior. No es una transcripción. No borres el pedido que ya se respondió: si preguntó una dirección y después un turno, la frase tiene las dos cosas. Ejemplo: Consulta por su hijo Franco. Preguntó por tratamientos de TDAH en CABA.",
      "hecho: una sola frase de lo que pasó en este mensaje, no repitas el resumen entero. Si solo saludó, hecho=Saludo. Si solo se despidió, hecho=Despedida. Si pidió un teléfono o un dato, decí solo eso.",
      "Los mensajes anteriores muestran qué preguntó el bot. Si el lote nuevo responde eso (sí, no, un nombre, un apellido, un DNI, una edad, me llamo o soy), continuarAnterior=true, fueraDeIneco=false y la intención sigue siendo la abierta. Completá ese dato en datos.",
      "Si se reanuda después de una persona, la charla sigue en el caso y el dato que quedaron guardados. Si este mensaje responde ese dato, o pregunta algo de INECO, fueraDeIneco=false y continuarAnterior=true. No la trates como una charla nueva. Si cambia de tema, continuarAnterior=false.",
      "Si preguntan qué dato habían dicho antes y hay correcciones, usá ese valor anterior. No lo inventes.",
      "intencionConcluida=true solo si, con este lote, la intención en la que quedamos ya no tiene nada pendiente.",
      "Un saludo, un cómo estás y una despedida no son intenciones: intencion vacía y la cortesía que corresponda.",
      "accion: una de estas claves, o vacío si no hace falta una lista. Vacía si solo pide un turno y nombra una especialidad: eso no es una búsqueda de listas. Usala solo si pregunta qué profesionales hacen una prestación o qué prestaciones hace un profesional. consulta: el nombre a buscar, sin Dr. ni Dra.",
      textoAcciones(),
      "Intenciones:",
      ...intenciones.map((item) => `- ${item.clave}: ${item.nombre}. ${item.descripcion}`),
      "Etiquetas:",
      catalog.items
        .filter((item) => !ETIQUETAS_BOT_NO.has(item.name.trim().toLowerCase()))
        .map((item) => item.name)
        .join(", "),
    ]
      .filter(Boolean)
      .join("\n"),
    content: [
      identidad.texto,
      ahora,
      estado,
      `Ficha. Vacío significa que todavía no lo tenemos:\n${textoFicha(ficha)}`,
      pausaLarga
        ? "Pasaron varias horas desde el último mensaje. La charla se saluda de nuevo. El resumen queda como contexto, no como pregunta pendiente."
        : "",
      conversation.resumen ? `Resumen de donde venía: ${conversation.resumen}` : "Resumen de donde venía: (todavía no hay)",
      textoEstadoDialogo({
        casos: conversation.casos ?? [],
        casoId: conversation.casoActivoId ?? "",
        datoPedido: conversation.datoPedido ?? "",
        pila: conversation.pilaTemas ?? [],
        resultado: conversation.ultimoResultado ?? null,
        reanudacion: conversation.pausa ?? null,
        historial: conversation.historialDatos ?? [],
      }),
      "datos se completa solo para el caso activo. Si todavía no hay casos y el mensaje pide turnos para más de una persona, datos es el de quien escribe: soy, yo soy o me llamo son su nombre y su apellido. La edad de un familiar no va en grupoEtario.",
      conversation.datoPedido
        ? `El dato que pedimos recién es ${ETIQUETA_DATO[conversation.datoPedido] ?? conversation.datoPedido}. Si este mensaje lo responde, completalo en ese campo y no en otro.`
        : "",
      `Mensajes anteriores:\n${previos}`,
      "Mensajes nuevos de la persona:",
      ...batch.map((message) => message.text.trim()),
    ]
      .filter(Boolean)
      .join("\n"),
    skipUsage: io?.skipUsage === true,
  });
  if (io?.trace) io.trace.terra = detection;

  const relacionDicha = inferirRelacion([
    ...messages.map((message) => message.text),
    ...batch.map((message) => message.text),
  ]);
  if (detection.datos && relacionDicha && !detection.datos.relacionFamiliar?.trim()) {
    detection.datos.relacionFamiliar = relacionDicha;
    if (!detection.datos.consultaPara) detection.datos.consultaPara = "tercero";
  }
  const textoLote = batch.map((message) => message.text).join("\n");
  if (detection.datos) {
    acotarDatosAlTexto(textoLote, detection.datos);
    const dicho = sinTildes(textoLote);
    const familiar = /\b(hij[oa]|nene|nena|espos[oa]|mama|papa|madre|padre|abuel[oa]|tio|tia|sobrin[oa]|para otra|familiar)\b/.test(dicho);
    const propio = /\bpara mi\b(?!\s+(hij|nen|espos|mama|papa|madre|padre|abuel))/.test(dicho);
    if (detection.datos.consultaPara === "tercero" && !familiar) detection.datos.consultaPara = "";
    if (detection.datos.consultaPara === "propio" && !propio) detection.datos.consultaPara = "";
  }

  let casosTurno = incorporarPersonas(
    asegurarCasos(conversation.casos ?? [], textoLote),
    Array.isArray(detection.personas) ? detection.personas : [],
  );
  let activo = casoActivo(casosTurno, conversation.casoActivoId ?? "");
  if (detection.datos && activo) {
    vincularDatoPedido(conversation.datoPedido ?? "", textoLote, detection.datos);
    precargarCaso(detection.datos, activo, casosTurno, textoLote);
  }

  const fichaPrevia = fichaDesdeContacto(contact);
  const contactoActual =
    contact && detection.datos ? await fillContact(contact.id, detection.datos) : contact;
  let fichaActual = fichaDesdeContacto(contactoActual ?? contact);
  if (activo) {
    casosTurno = casosTurno.map((caso) => (caso.id === activo?.id ? copiarFichaEnCaso(caso, fichaActual) : caso));
    activo = casoActivo(casosTurno, activo.id);
  }
  const historialDatos = [
    ...(conversation.historialDatos ?? []),
    ...diffFicha(fichaPrevia, fichaActual, activo?.id ?? "", new Date().toISOString()),
  ].slice(-30);
  const reanudacion = conversation.pausa ?? null;
  const resumen = await saveResumen(conversationId, detection.resumen ?? "");

  const coincidencia = intenciones.find((item) => item.clave === detection.intencion.trim());
  const secundariaPedida = intenciones.find(
    (item) => item.clave === detection.intencionSecundaria.trim() && item.clave !== coincidencia?.clave,
  );
  const principal = coincidencia ?? secundariaPedida;
  const previa = conversation.intencionAbierta?.trim() || "";
  const previaAbierta = Boolean(previa) && !conversation.intencionConcluida;
  const sinTema = !principal;
  const misma = principal?.clave === previa;
  const continuar = previaAbierta && (detection.continuarAnterior === true || misma);
  const conflicto = hayConflictoDePedidos(textoLote);

  let chosen = principal;
  let secundaria = coincidencia ? secundariaPedida : undefined;
  if (!pausaLarga && sinTema && previaAbierta && detection.cortesia === "") {
    chosen = intenciones.find((item) => item.clave === previa);
  } else if (!pausaLarga && continuar) {
    chosen = intenciones.find((item) => item.clave === previa) ?? principal;
    if (principal?.clave && principal.clave !== chosen?.clave && !secundaria) secundaria = principal;
  } else if (!pausaLarga && previaAbierta && detection.anteriorConcluida !== true && principal?.clave && principal.clave !== previa && !conflicto) {
    chosen = intenciones.find((item) => item.clave === previa) ?? principal;
    if (principal.clave !== chosen?.clave && !secundaria) secundaria = principal;
  }

  let colaPlan: string[] = [];
  let datosDeClave = "";
  let infosAhora: string[] = [];
  if (!conflicto && !pausaLarga) {
    const catalogo = new Set(intenciones.map((item) => item.clave));
    const detectadas: string[] = [];
    for (const raw of [
      detection.intencion,
      detection.intencionSecundaria,
      ...(Array.isArray(detection.otras) ? detection.otras : []),
    ]) {
      const clave = String(raw ?? "").trim();
      if (!clave || detectadas.includes(clave) || !catalogo.has(clave)) continue;
      detectadas.push(clave);
    }
    if (/\bquej/.test(sinTildes(textoLote)) && catalogo.has("QUEJAS") && !detectadas.includes("QUEJAS")) {
      detectadas.push("QUEJAS");
    }
    const heredadas =
      previaAbierta && detection.anteriorConcluida !== true
        ? [previa, ...(conversation.intencionCola ?? [])]
        : [];
    const todas = [...new Set([...detectadas, ...heredadas])];
    const infos = todas.filter((clave) => pasosDeIntencion(clave) === 0);
    const complejas = todas
      .filter((clave) => pasosDeIntencion(clave) > 0)
      .sort((a, b) => pasosDeIntencion(a) - pasosDeIntencion(b));
    infosAhora = infos;
    if ((infos.length && complejas.length) || complejas.length > 1) {
      const pendiente = complejas.find((clave) => faltantesDe(clave, fichaActual).length > 0) ?? "";
      if (infos.length) {
        chosen = intenciones.find((item) => item.clave === infos[0]);
        secundaria = infos[1] ? intenciones.find((item) => item.clave === infos[1]) : undefined;
      } else if (complejas.includes("QUEJAS") && pendiente && pendiente !== "QUEJAS") {
        chosen = intenciones.find((item) => item.clave === "QUEJAS");
        secundaria = undefined;
      } else {
        chosen = intenciones.find((item) => item.clave === (pendiente || complejas[0]!));
        secundaria = undefined;
      }
      datosDeClave = pendiente;
      colaPlan = pendiente
        ? complejas.filter((clave) => clave !== pendiente && clave !== chosen?.clave)
        : [];
    } else if (infos.length > 1) {
      chosen = intenciones.find((item) => item.clave === infos[0]);
      secundaria = intenciones.find((item) => item.clave === infos[1]);
    }
  }

  const estadoSiguiente = {
    intencionAbierta: datosDeClave || chosen?.clave || null,
    intencionConcluida: conflicto || datosDeClave ? false : detection.intencionConcluida === true,
    intencionPropuesta: conflicto ? secundaria?.clave ?? principal?.clave ?? null : null,
    intencionCola: conflicto ? [] : colaPlan,
  };

  const seguimiento = {
    advertenciasFuera: detection.fueraDeIneco === true ? (conversation.advertenciasFuera ?? 0) : 0,
    derivacionPendiente: conversation.derivacionPendiente === true,
    temasAnotados: [
      ...new Set([
        ...(conversation.temasAnotados ?? []),
        ...temasDelMensaje(textoLote, Array.isArray(detection.temas) ? detection.temas : []),
      ]),
    ].slice(0, 8),
    casos: casosTurno,
    casoActivoId: activo?.id ?? null,
    datoPedido: conversation.datoPedido ?? null,
    historialDatos,
    pilaTemas: pilaDeCasos(casosTurno, activo?.id ?? "", conversation.datoPedido ?? "", false),
    ultimoResultado: conversation.ultimoResultado ?? null,
    pausa: null as WaPausaDialogo | null,
  };
  const pausar = (intencion: string) => {
    seguimiento.pausa = {
      intencion,
      casoId: activo?.id ?? "",
      datoPedido: seguimiento.datoPedido ?? "",
    };
  };
  const guardar = (parcial: {
    intencionAbierta: string | null;
    intencionConcluida: boolean;
    intencionPropuesta: string | null;
    intencionCola?: string[];
  }) => saveIntencion(conversationId, { ...parcial, ...seguimiento });
  const temasDeEsteMensaje = temasDelMensaje(
    textoLote,
    Array.isArray(detection.temas) ? detection.temas : [],
  );

  const peligro = motor.seguridad.detectarRiesgos && detection.peligroActual === true;
  const duda = motor.seguridad.detectarRiesgos && !peligro && detection.dudaSinPeligro === true;

  const wantedNames = new Set(
    etiquetasDelModelo(Array.isArray(detection.etiquetas) ? detection.etiquetas : []).map((name) =>
      name.toLowerCase(),
    ),
  );
  for (const name of etiquetasNombradas(textoLote, catalog.items, catalog.groups)) {
    wantedNames.add(name.toLowerCase());
  }
  if (peligro) {
    const urgencia = tagsByName.get("urgencia");
    if (urgencia) wantedNames.add(urgencia.name.toLowerCase());
  }
  if (duda) {
    const derivado = tagsByName.get("derivado a asesor");
    if (derivado) wantedNames.add(derivado.name.toLowerCase());
  }
  if (chosen?.clave === "QUEJAS" || colaPlan.includes("QUEJAS") || datosDeClave === "QUEJAS") {
    const queja = tagsByName.get("queja");
    if (queja) wantedNames.add(queja.name.toLowerCase());
  }

  const nextTagIds = new Set(conversation.tagIds);
  if (
    wantedNames.has("no paciente") ||
    wantedNames.has("primera vez") ||
    fichaActual.esPaciente === "no"
  ) {
    wantedNames.delete("paciente");
    const paciente = tagsByName.get("paciente");
    if (paciente) nextTagIds.delete(paciente.id);
  } else if (wantedNames.has("paciente")) {
    const dijoPaciente = /\bpaciente\b/i.test(messages.map((message) => message.text).join("\n"));
    if (!dijoPaciente) wantedNames.delete("paciente");
  }
  if (wantedNames.has("paciente")) {
    wantedNames.delete("no paciente");
    const noPaciente = tagsByName.get("no paciente");
    if (noPaciente) nextTagIds.delete(noPaciente.id);
  }
  const banda = bandaEtaria(textoLote);
  if (banda) {
    for (const otra of BANDAS_EDAD) {
      if (otra === banda) continue;
      wantedNames.delete(otra);
      const previa = tagsByName.get(otra);
      if (previa) nextTagIds.delete(previa.id);
    }
    wantedNames.add(banda);
  }
  const sedeGroup = catalog.groups.find((group) => sinTildes(group.name) === "sedes");
  const sedes = catalog.items.filter((item) => item.groupId === sedeGroup?.id);
  const tieneSede = sedes.some(
    (sede) => wantedNames.has(sede.name.toLowerCase()) || nextTagIds.has(sede.id),
  );
  if (!tieneSede) {
    const caba = sedes.find((sede) => sinTildes(sede.name) === "caba");
    if (caba) wantedNames.add(caba.name.toLowerCase());
  }
  for (const name of wantedNames) {
    const tag = tagsByName.get(name);
    if (tag) nextTagIds.add(tag.id);
  }
  const tagsIguales =
    nextTagIds.size === conversation.tagIds.length &&
    [...nextTagIds].every((id) => conversation.tagIds.includes(id));
  if (!tagsIguales) {
    await saveTags(conversationId, [...nextTagIds]);
  }

  const anotar = (abierta: string | null, concluida: boolean) =>
    saveAuditoria(conversationId, {
      en: new Date().toISOString(),
      intencion: detection.intencion.trim(),
      secundaria: detection.intencionSecundaria.trim(),
      abierta: abierta?.trim() ?? "",
      concluida,
      peligro: detection.peligroActual === true,
      duda: detection.dudaSinPeligro === true,
      cortesia:
        detection.cortesia === "saludo" || detection.cortesia === "cierre" ? detection.cortesia : "",
      hecho: (detection.hecho ?? "").trim().slice(0, 240),
      resumen: (detection.resumen ?? "").trim().slice(0, 240),
      etiquetas: etiquetasDelModelo(Array.isArray(detection.etiquetas) ? detection.etiquetas : []),
    });

  if (peligro && riesgo) {
    seguimiento.derivacionPendiente = false;
    seguimiento.advertenciasFuera = 0;
    pausar(riesgo.clave);
    await guardar({
      intencionAbierta: riesgo.clave,
      intencionConcluida: true,
      intencionPropuesta: null,
      intencionCola: [],
    });
    await anotar(riesgo.clave, true);
    await send(conversationId, riesgo.mensajeRiesgo);
    await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
    return;
  }

  if (duda) {
    seguimiento.derivacionPendiente = false;
    pausar(chosen?.clave ?? previa);
    await guardar({
      intencionAbierta: chosen?.clave ?? (previa || null),
      intencionConcluida: true,
      intencionPropuesta: null,
      intencionCola: [],
    });
    await send(
      conversationId,
      "Gracias por escribirnos. Alguien del equipo te va a contactar por este medio. Este canal no es una guardia.",
    );
    await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
    await anotar(chosen?.clave ?? (previa || null), true);
    return;
  }

  if (
    seguimiento.derivacionPendiente &&
    noQuiereNadaMas(textoLote, detection.cortesia)
  ) {
    seguimiento.derivacionPendiente = false;
    pausar(previa);
    await guardar({
      intencionAbierta: previa || null,
      intencionConcluida: true,
      intencionPropuesta: null,
      intencionCola: [],
    });
    await anotar(previa || null, true);
    await send(conversationId, AVISO_EQUIPO);
    await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
    return;
  }

  if (detection.fueraDeIneco === true && sinTema) {
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
    if ((conversation.advertenciasFuera ?? 0) >= 1) {
      const derivado = tagsByName.get("derivado a asesor");
      if (derivado) {
        nextTagIds.add(derivado.id);
        await saveTags(conversationId, [...nextTagIds]);
      }
      seguimiento.advertenciasFuera = (conversation.advertenciasFuera ?? 0) + 1;
      seguimiento.derivacionPendiente = false;
      pausar(previa);
      await guardar({
        intencionAbierta: previa || null,
        intencionConcluida: true,
        intencionPropuesta: null,
        intencionCola: [],
      });
      await anotar(previa || null, true);
      await send(conversationId, AVISO_FUERA_DERIVA);
      await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
      return;
    }
    seguimiento.advertenciasFuera = 1;
    await send(conversationId, AVISO_FUERA);
    await guardar({
      intencionAbierta: previa || estadoSiguiente.intencionAbierta,
      intencionConcluida: conversation.intencionConcluida,
      intencionPropuesta: conversation.intencionPropuesta,
      intencionCola: conversation.intencionCola ?? [],
    });
    await anotar(previa || null, conversation.intencionConcluida);
    return;
  }

  const pideOtraCosa = batch.some(
    (message) => message.text.includes("?") || /\bturno\b/i.test(message.text),
  );
  const soloDespedida =
    esSoloDespedida(batch.map((message) => message.text)) ||
    (detection.cortesia === "cierre" && !pideOtraCosa);
  if (soloDespedida) {
    const pasaAlEquipo = seguimiento.derivacionPendiente;
    seguimiento.derivacionPendiente = false;
    if (pasaAlEquipo) pausar(previa);
    await guardar({
      intencionAbierta: previa || null,
      intencionConcluida: true,
      intencionPropuesta: null,
      intencionCola: [],
    });
    await anotar(previa || null, true);
    await send(conversationId, pasaAlEquipo ? AVISO_EQUIPO : charla.cierre);
    if (pasaAlEquipo) await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
    return;
  }

  if (!chosen && sinTema && detection.cortesia === "" && !pausaLarga) {
    const clave = claveDeLoNombrado(
      textoLote,
      catalog.items,
      catalog.groups,
      new Set(intenciones.map((item) => item.clave)),
    );
    const fallback = intenciones.find((item) => item.clave === clave);
    if (fallback) {
      chosen = fallback;
      estadoSiguiente.intencionAbierta = fallback.clave;
      estadoSiguiente.intencionConcluida = false;
    }
  }

  if (sinTema && !chosen && detection.cortesia === "saludo") {
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
    const pregunta = charla.pregunta || "¿En qué puedo ayudarte?";
    if (pregunta) await send(conversationId, pregunta);
    await anotar(previa || null, conversation.intencionConcluida);
    return;
  }

  if (sinTema && !chosen && !previaAbierta) {
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
    await send(conversationId, charla.pregunta || "¿En qué puedo ayudarte?");
    await anotar(previa || null, conversation.intencionConcluida);
    return;
  }

  const textosEntrantes = messages
    .filter((message) => message.direction === "INBOUND")
    .map((message) => message.text)
    .join("\n");
  const pideTurno =
    chosen?.clave === "TURNOS" ||
    secundaria?.clave === "TURNOS" ||
    detection.intencion.trim() === "TURNOS" ||
    detection.intencionSecundaria.trim() === "TURNOS";
  const sedeAjena = pideTurno ? sedeDelTurno(textoLote) : null;
  const confirmarReserva = pideConfirmarReserva(textoLote);
  const sedeInformada = sedeFueraDeCaba(textoLote);
  if (sedeAjena) {
    estadoSiguiente.intencionAbierta = "TURNOS";
    estadoSiguiente.intencionConcluida = true;
    estadoSiguiente.intencionPropuesta = null;
    estadoSiguiente.intencionCola = [];
    datosDeClave = "";
    colaPlan = [];
  }
  const soloConfirma =
    (confirmarReserva && esPedidoDeCatalogo(textoLote)) ||
    (confirmarReserva &&
      !sedeAjena &&
      !conflicto &&
      pasosDeIntencion(chosen?.clave ?? "") > 0 &&
      !secundaria &&
      infosAhora.length === 0);
  if (soloConfirma) {
    estadoSiguiente.intencionConcluida = true;
    estadoSiguiente.intencionPropuesta = null;
    estadoSiguiente.intencionCola = [];
    datosDeClave = "";
    colaPlan = [];
  }

  const claveDatos = datosDeClave || chosen?.clave || "";
  const cancelaExistente = pideCancelar(textoLote) && !conflicto;
  let faltan = sedeAjena || conflicto || confirmarReserva || cancelaExistente ? [] : faltantesDe(claveDatos, fichaActual);
  const fichaTurnoLista =
    !sedeAjena &&
    !conflicto &&
    !confirmarReserva &&
    !cancelaExistente &&
    pideTurno &&
    faltan.length === 0 &&
    (claveDatos === "TURNOS" || chosen?.clave === "TURNOS");
  if (fichaTurnoLista && activo) {
    casosTurno = casosTurno.map((caso) =>
      caso.id === activo?.id ? { ...copiarFichaEnCaso(caso, fichaActual), estado: "fallo" as const } : caso,
    );
    seguimiento.casos = casosTurno;
    seguimiento.ultimoResultado = resultadoReservar();
    const siguiente = casosTurno.find((caso) => caso.estado === "juntando");
    if (siguiente && contact) {
      const cargado = await replaceContact(contact.id, siguiente);
      fichaActual = fichaDesdeContacto(cargado ?? contact);
      faltan = faltantesDe("TURNOS", fichaActual);
      activo = siguiente;
      seguimiento.casoActivoId = siguiente.id;
      seguimiento.datoPedido = faltantesCaso(siguiente)[0] ?? null;
    } else {
      faltan = [];
      seguimiento.datoPedido = null;
      seguimiento.casoActivoId = null;
    }
  } else if (faltan[0]) {
    seguimiento.datoPedido = faltan[0];
  }
  seguimiento.pilaTemas = pilaDeCasos(
    casosTurno,
    activo?.id ?? "",
    seguimiento.datoPedido ?? "",
    Boolean(infosAhora.length && pideTurno && faltan.length),
  );
  if (cancelaExistente) {
    datosDeClave = "";
    seguimiento.derivacionPendiente = true;
  }
  if (fichaTurnoLista || detection.requierePersona === true) seguimiento.derivacionPendiente = true;
  const accion =
    conflicto || (chosen?.clave === "TURNOS" && faltan.length > 0 && !pideListaDeProfesionales(textoLote))
      ? null
      : accionPermitida(detection.accion?.trim() ?? "", chosen?.clave ?? "");
  const resultadoAccion = accion
    ? await ejecutarAccion(accion.clave as AccionClave, detection.consulta ?? "")
    : "";
  if (accion && resultadoAccion) {
    seguimiento.ultimoResultado = {
      accion: accion.clave,
      ok: !/no encontr|no está|sin coincid/i.test(resultadoAccion),
      motivo: resultadoAccion.slice(0, 240),
    };
  }

  const esInfo = !sedeAjena && Boolean(chosen?.clave?.startsWith("INFO_"));
  if (!conflicto && !sedeAjena && faltan.length) estadoSiguiente.intencionConcluida = false;
  if (!conflicto && esInfo && faltan.length === 0) estadoSiguiente.intencionConcluida = true;
  await anotar(estadoSiguiente.intencionAbierta, estadoSiguiente.intencionConcluida);
  if (soloConfirma) {
    seguimiento.derivacionPendiente = true;
    const derivado = tagsByName.get("derivado a asesor");
    if (derivado && !nextTagIds.has(derivado.id)) {
      nextTagIds.add(derivado.id);
      await saveTags(conversationId, [...nextTagIds]);
    }
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
    await send(
      conversationId,
      "Por este canal no puedo confirmar si un turno quedó reservado. Esa parte la va a ver una persona del equipo.",
    );
    await send(conversationId, PREGUNTA_ALGO_MAS);
    await guardar({ ...estadoSiguiente, intencionConcluida: true });
    if (conversation.assigneeKind === "none") {
      await saveAssignee(conversationId, { kind: "bot", name: identidad.nombre });
    }
    return;
  }
  const pedido = faltan[0] ? ETIQUETA_DATO[faltan[0]] ?? faltan[0] : "";
  const hints = capitulosDe(
    [...new Set([chosen?.clave ?? "", secundaria?.clave ?? "", ...infosAhora, claveDatos])].filter(Boolean),
    batch.map((message) => message.text).join("\n"),
  );
  if (sedeAjena && !hints.includes("Sedes")) hints.push("Sedes");
  const chapter = sliceKnowledge(conocimiento.text, hints);
  const objetivo =
    bot.conversacion && typeof bot.conversacion === "object"
      ? stringField(bot.conversacion as Record<string, unknown>, "objetivo")
      : "";
  const estilo =
    bot.conversacion && typeof bot.conversacion === "object"
      ? stringField(bot.conversacion as Record<string, unknown>, "estiloRespuesta")
      : "";
  const reply = await completeStructured<{ partes?: string[]; pregunta?: string }>({
    conversacionId: conversationId,
    paso: "responder",
    modelo: models.responder,
    reasoningEffort: io?.esfuerzoResponder ?? "none",
    omitirRazonamiento: io?.omitirRazonamiento === true,
    schemaName: "respuesta",
    schema: respuestaSchema,
    onUsage: io?.onUsage,
    instructions: [
      "Redactá en español de Argentina, en texto plano. Sin HTML.",
      "Hablá como la recepción de una institución de salud mental: cálido, claro y tranquilo, con voseo. Sin apuro y sin sonar a trámite. No digas 'con cuál seguimos', 'pedido' ni 'trámite'.",
      "La forma de la respuesta es fija: partes es un array de mensajes y cada string sale como un globo distinto. pregunta es otro globo, con una sola pregunta, o vacío. Ninguna parte puede tener un signo de pregunta: si hace falta preguntar, va una sola vez en pregunta y no se repite.",
      estilo
        ? `Estilo de redacción:\n${estilo}`
        : "No hay estilo cargado. Usá una sola parte corta y, si hace falta preguntar, hacelo en pregunta.",
      instrucciones.length ? `Instrucciones de redacción:\n${instrucciones.join("\n")}` : "",
      "Usá solo el texto de la base. No inventes precios, profesionales, coberturas ni direcciones. Copiá teléfonos, mails y direcciones tal como figuran. No armes un mail con el nombre de la sede. No respondas cultura general, clima, deportes, tareas ni ningún tema que no sea de INECO.",
      "No empieces ninguna parte con Hola, Buen día, Buenas tardes ni Buenas noches. El saludo, si corresponde, ya salió en otro mensaje.",
      "Si un dato dice no informado o en confirmación, no lo completes: pedí los datos y decí que el equipo informa.",
      "Si hay dos precios, decí los dos.",
      "Si pregunta por una obra social, prepaga o CUD, respondé con lo que dice Coberturas sobre esa cobertura: condiciones, mail y prestador, si están escritos. Si esa cobertura no está nombrada en Coberturas, decí que depende de la sede, la prestación y el plan, y pasá coberturas@ineco.org.ar. No digas que atienden por una cobertura que el texto no nombra.",
      "No preguntes la relación si ya dijo hijo, hija, padre, madre, abuelo, abuela, tío, tía, sobrino, sobrina, marido, esposo, esposa, pareja, novio, novia o tutor, o si la ficha ya tiene una.",
      "No digas que un turno quedó reservado. Si la ficha del turno ya está completa, decí que hubo un problema con el sistema de turnos y que lo derivás a una persona del equipo. No ofrezcas gestionar más adelante un turno de una sede que no sea CABA.",
      "Si el mensaje nombra varios turnos o varias personas, nombrá a cada una. Pedí los datos de una sola por vez, la del caso activo. No le atribuyas a esa persona la edad ni el nombre de otra.",
      "Si pregunta por varios tratamientos, precios o programas en el mismo mensaje, respondé cada uno que esté en la base. No elijas uno solo.",
      "Si una parte no se puede resolver (confirmar, cancelar o un dato clínico) y otra sí, resolvé la que se puede y decí que la otra la ve una persona. No dejes de contestar la que sí podés.",
      "Una sede nombrada para pedir dirección, teléfono u horario es solo un dato. No la uses como sede de un turno, de una cancelación ni de una reserva, salvo que digan que ese turno es ahí.",
      "Si piden confirmar una reserva y además otra cosa, la confirmación es una frase y el resto se responde. No tapes el resto del mensaje.",
      "Si el estado lista correcciones ya hechas y preguntan cuál era el dato anterior, respondé con ese valor. No lo inventes.",
      stringField(plazos, "seInforma") ? `Sí se puede informar: ${stringField(plazos, "seInforma")}` : "",
      stringField(plazos, "noSeInforma") ? `No se informa: ${stringField(plazos, "noSeInforma")}` : "",
      objetivo ? `Objetivo: ${objetivo}` : "",
      fase === "inicio"
        ? "La charla recién empieza. No saludes ni te presentes: el saludo ya sale en otro mensaje. Respondé el pedido. No agregues la pregunta de en qué podés ayudar si ya vas a hacer otra pregunta."
        : "La charla ya empezó. No saludes, no te presentes y no repitas tu nombre.",
      resultadoAccion
        ? "Si hay un resultado de listas, incluilo. Si hay varias coincidencias, nombrálas y no elijas una. Si no hay coincidencia, decí que no está en las listas y que el equipo lo confirma. No inventes horarios."
        : "",
      conflicto
        ? "Quiere cancelar un turno y sacar otro distinto. En partes, una sola frase corta de acogida, sin explicar el orden y sin preguntar. Ejemplo: Entiendo, lo vemos con calma. Si además pidió un dato (dirección, teléfono, precio), respondelo con la base en otra parte. No atribuyas esa sede a la cancelación ni al turno nuevo. La pregunta la pone el sistema. No pidas datos y no saludes."
        : chosen?.clave === "QUEJAS" && datosDeClave && datosDeClave !== "QUEJAS"
          ? `Tomá la queja ahora, en una frase, sin pedir otro dato. No preguntes con cuál seguir. En pregunta pedí solo el dato que falta para el turno. No escribas TURNOS ni el nombre interno de la intención.`
          : infosAhora.length && datosDeClave
            ? `Hay varios pedidos. Respondé ahora la información (${infosAhora.join(", ")}), con la base. No preguntes cuál va primero. En pregunta empezá solo ${datosDeClave}, pidiendo el dato que falta. No arranques lo que quedó en cola.`
          : colaPlan.length
            ? `En cola, para después: ${colaPlan.join(", ")}. Ahora seguí solo con ${datosDeClave || chosen?.clave || ""}. No preguntes cuál prefiere.`
            : sedeAjena
          ? ""
          : secundaria
            ? `Respondé los dos temas: ${chosen?.clave ?? ""} y ${secundaria.clave}. Una sola pregunta, en el campo pregunta.`
            : "",
      conflicto
        ? "Si pidió un dato además de la cancelación, respondelo. No mandes la cancelación ni el turno nuevo a una sede que solo nombró para pedir ese dato."
        : confirmarReserva
          ? `Una parte pide confirmar una reserva. Incluí, una sola vez: "Por este canal no puedo confirmar si un turno quedó reservado. El equipo es quien lo confirma." No pidas datos para esa confirmación. El resto del mensaje se responde igual.${sedeAjena ? ` El turno nuevo es para ${sedeAjena}: este canal solo gestiona turnos de CABA. Pasá el contacto de esa sede si está en la base y no ofrezcas sacarlo.` : ""}`
          : sedeAjena
            ? `Piden un turno para ${sedeAjena}. Este canal solo gestiona turnos de la sede de CABA. No pidas nombre, DNI, edad ni ningún otro dato. En partes decilo en una frase y, si la base tiene teléfono o WhatsApp de ${sedeAjena}, pasalo tal cual.${secundaria ? ` Además respondé el otro pedido (${secundaria.clave}) con la base.` : ""} pregunta vacía. No ofrezcas sacar ese turno.`
            : pedido
              ? `Para la intención principal falta un solo dato. La información va en partes. En pregunta pedí únicamente: ${pedido}. No pidas ningún dato que ya figure en la ficha. No repitas esa pregunta dentro de partes. No listes profesionales si no preguntó quién atiende.`
              : esInfo
                ? sedeInformada
                  ? `Respondé ahora lo que preguntó, con la base. No digas que ya estaba respondido. La sede es ${sedeInformada}: pasá solo el dato que esté escrito y no ofrezcas sacar un turno por este canal. pregunta vacía, o una sola oferta de ayuda con otra consulta de CABA.`
                  : "Respondé ahora lo que preguntó este mensaje, con la base. No digas que ya estaba respondido. No pidas nombre, edad, DNI ni si ya es paciente. En pregunta, una sola oferta: si lo podés ayudar en algo más, o si le gustaría sacar un turno en CABA."
                : cancelaExistente
                  ? "Pide cancelar un turno que ya existiría. No pidas nombre, DNI ni ningún dato. Decí que la cancelación la ve una persona del equipo. Si además hay un precio, una sede o una cobertura, respondelo con la base. pregunta vacía."
                : chosen?.clave === "TURNOS"
                  ? "La ficha ya está completa. No preguntes el motivo de la consulta ni ningún otro dato. En partes decí, una sola vez, que hubo un problema con el sistema de turnos y que lo derivás a una persona del equipo. Si había más de un turno, nombalos. pregunta vacía: el sistema pregunta si necesita algo más."
                  : "No falta ningún dato para esta intención. No pidas otro dato ni preguntes el motivo. Respondé el pedido y no digas que un turno quedó reservado.",
      identidad.texto,
    ]
      .filter(Boolean)
      .join("\n"),
    content: [
      identidad.texto,
      ahora,
      textoEstado(
        {
          intencionAbierta: estadoSiguiente.intencionAbierta,
          intencionConcluida: estadoSiguiente.intencionConcluida,
          intencionPropuesta: estadoSiguiente.intencionPropuesta,
        },
        fase,
      ),
      resumen ? `Resumen: ${resumen}` : "",
      `Ficha:\n${textoFicha(fichaActual)}`,
      textoEstadoDialogo({
        casos: seguimiento.casos,
        casoId: seguimiento.casoActivoId ?? "",
        datoPedido: seguimiento.datoPedido ?? "",
        pila: seguimiento.pilaTemas,
        resultado: seguimiento.ultimoResultado,
        reanudacion,
        historial: historialDatos,
      }),
      temasDeEsteMensaje.length > 1
        ? `Temas distintos de este mensaje: ${temasDeEsteMensaje.join(" | ")}. Si son información, respondé cada uno con la base. Si son turnos, nombrá a cada persona y pedí los datos de una sola.`
        : "",
      conflicto
        ? "No preguntes 'con cuál seguimos'. La pregunta la pone el sistema. En partes, una frase corta de acogida. Si pidió un dato de una sede, un precio o una cobertura, respondelo aparte. No mandes la cancelación ni el turno nuevo a esa sede."
        : confirmarReserva
          ? `Incluí una sola vez que por este canal no se puede confirmar si un turno quedó reservado. No pidas datos para esa confirmación. Respondé el resto del mensaje.${sedeAjena ? ` El turno nuevo es para ${sedeAjena}: pasá el contacto y no lo saques por este canal.` : ""}`
          : sedeAjena
            ? `El turno es para ${sedeAjena}, no para CABA. No pidas datos. Decí que este canal solo gestiona turnos de CABA y pasá el contacto de esa sede si está en la base.${secundaria ? " Respondé también el otro pedido con la base." : ""}`
            : esInfo && faltan.length === 0
              ? sedeInformada
                ? `Respondé ahora la consulta sobre ${sedeInformada}. No digas que ya estaba respondida. No ofrezcas sacar un turno.`
                : "Respondé ahora la consulta con la base. No digas que ya estaba respondida. En la pregunta ofrecé ayudar en algo más o sacar un turno en CABA."
              : faltan.length
                ? `Falta para la intención principal: ${faltan.join(", ")}. Pedí solo el primero, una sola vez, en pregunta. No agregues listas de profesionales.`
                : cancelaExistente
                  ? "Pide cancelar un turno existente. No pidas datos. Decí que lo ve una persona del equipo y respondé el resto con la base."
                : chosen?.clave === "TURNOS"
                  ? "No falta ningún dato. No preguntes el motivo. Cerrá diciendo que hubo un problema con el sistema de turnos y que lo derivás a una persona del equipo."
                  : "No falta ningún dato. Respondé el pedido sin pedir otro dato y sin decir que un turno quedó reservado.",
      `Intención principal: ${chosen?.clave ?? ""} ${chosen?.nombre ?? ""}`,
      secundaria ? `Segunda intención: ${secundaria.clave} ${secundaria.nombre}` : "",
      resultadoAccion ? `Resultado de las listas:\n${resultadoAccion}` : "",
      "Base:",
      chapter || "No hay texto cargado.",
      `Mensajes anteriores:\n${previos}`,
      "Mensajes nuevos de la persona:",
      ...batch.map((message) => message.text.trim()),
    ]
      .filter(Boolean)
      .join("\n"),
    skipUsage: io?.skipUsage === true,
  });
  if (io?.trace) io.trace.lunaLlamada = true;

  let bloques = (Array.isArray(reply.partes) ? reply.partes : [])
    .map((parte) => parte.trim())
    .filter(Boolean)
    .slice(0, 4);
  let pregunta = (reply.pregunta ?? "").trim();
  const limpio = sinSignosDePregunta(bloques, pregunta);
  bloques = limpio.bloques
    .map(sinSaludoInicial)
    .map(sinPresentacion)
    .map((parte) => sinMailsInventados(parte, chapter))
    .filter(Boolean);
  pregunta = sinMailsInventados(limpio.pregunta, chapter).replace(
    /^(?:TURNOS|QUEJAS|INFO_[A-Z_]+)\s*:\s*/i,
    "",
  );
  if (confirmarReserva && !bloques.some((parte) => /no puedo confirmar si un turno/i.test(parte))) {
    bloques.unshift(
      "Por este canal no puedo confirmar si un turno quedó reservado. Esa parte la va a ver una persona del equipo.",
    );
  }
  if (fichaTurnoLista) {
    const anotados = seguimiento.casos.filter((caso) => caso.estado === "fallo" || caso.estado === "juntando").map((caso) => caso.etiqueta);
    const varios = anotados.length > 1 ? `Anoté estos turnos: ${anotados.join(", ")}.` : "";
    bloques = bloques.filter((parte) => !/reservad|sistema de turnos|datos quedan/i.test(sinTildes(parte)));
    bloques.push([varios, AVISO_SISTEMA_TURNOS].filter(Boolean).join(" "));
    if (!faltan.length) pregunta = PREGUNTA_ALGO_MAS;
    else if (activo) pregunta = preguntaDelCaso(activo, seguimiento.datoPedido ?? faltan[0] ?? "");
  } else if (pideTurno && nombraVariosTurnos(textoLote) && faltan.length) {
    const junto = sinTildes(bloques.join(" "));
    const nombraFamiliar = /\b(hij|nene|nena|espos|mama|papa|madre|padre|abuel)\b/.test(junto);
    const nombraPropio = /\b(para vos|el tuyo|tu turno)\b/.test(junto);
    if (!nombraFamiliar || !nombraPropio) {
      bloques.unshift("Anoté los turnos, el tuyo y el de la otra persona. Vamos de a uno para no mezclar los datos.");
    }
    if (activo && faltan[0]) pregunta = preguntaDelCaso(activo, faltan[0]);
  }
  if (detection.requierePersona === true && !sedeAjena && !conflicto && !fichaTurnoLista) {
    seguimiento.derivacionPendiente = true;
    if (!bloques.some((parte) => /persona del equipo|deriv/i.test(sinTildes(parte)))) {
      bloques.push("Esa parte la va a ver una persona del equipo.");
    }
    if (!faltan.length) pregunta = PREGUNTA_ALGO_MAS;
  }
  if (cancelaExistente && !conflicto) {
    seguimiento.derivacionPendiente = true;
    if (!bloques.some((parte) => /persona del equipo|deriv/i.test(sinTildes(parte)))) {
      bloques.push("La cancelación la ve una persona del equipo.");
    }
    pregunta = PREGUNTA_ALGO_MAS;
  }
  if (conflicto) {
    bloques = bloques
      .map((parte) =>
        parte
          .split(/(?<=[.!?])\s+/)
          .filter((frase) => !/con cu[aá]l segu|primero una y despu[eé]s la otra/i.test(frase))
          .join(" ")
          .trim(),
      )
      .filter(Boolean);
    pregunta = PREGUNTA_CONFLICTO;
  }
  if (confirmarReserva && !conflicto && !sedeAjena) {
    seguimiento.derivacionPendiente = true;
    if (!faltan.length) pregunta = PREGUNTA_ALGO_MAS;
  } else if (sedeAjena) pregunta = "";
  if (seguimiento.derivacionPendiente) {
    const derivado = tagsByName.get("derivado a asesor");
    if (derivado && !nextTagIds.has(derivado.id)) {
      nextTagIds.add(derivado.id);
      await saveTags(conversationId, [...nextTagIds]);
    }
  }
  if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
  for (const parte of bloques) await send(conversationId, parte.slice(0, 700));
  if (pregunta) await send(conversationId, pregunta.slice(0, 500));
  await guardar(estadoSiguiente);
  if (conversation.assigneeKind === "none") {
    await saveAssignee(conversationId, { kind: "bot", name: identidad.nombre });
  }
}
