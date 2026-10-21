import {
  accionPermitida,
  accionPorEleccion,
  completarConsulta,
  ejecutarAccion,
  formatearHorariosAgrupados,
  horarioOfrecido,
  horariosOmitidos,
  opcionesOmitidas,
  eligeBuscarOrientacion,
  eligeDerivacionOrientacion,
  noSabeTratamiento,
  pideMasFechas,
  pideMasTemprano,
  pideAfirmacion,
  pideNegacion,
  preguntaDeResultado,
  reservaRepetida,
  sinPreferenciaProfesional,
  TEXTO_ORIENTACION_TURNO,
  textoAcciones,
  textoDeTurnosPropios,
  turnoNombrado,
  turnosFuturosDe,
  textoOpcionInvalida,
  type AccionClave,
} from "./acciones.js";
import {
  botDaTurnos,
  getWhatsappBotConfig,
  TEXTO_TURNO_DATOS_LISTOS,
  TEXTO_TURNO_SIN_ASIGNAR,
} from "./bot-config.js";
import { getWhatsappConocimiento } from "./conocimiento.js";
import {
  fillEmptyContactFields,
  getConversation,
  listConversations,
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
  textoEstadoDialogo,
  documentoDePersona,
  vincularDatoPedido,
  type WaPausaDialogo,
} from "./estado-dialogo.js";
import { listIntenciones } from "./intenciones.js";
import { sexoDesdeNombre, sexoDesdeRelacion } from "../lib/nombrePersona.js";
import { getWhatsappMotorConfig } from "./motor-config.js";
import { completeStructured } from "./openai-client.js";
import { listWhatsappTagCatalog } from "./tags.js";
import type { WaAuditoriaPaso } from "./types.js";

const PREGUNTA_CONFLICTO =
  "Te puedo ayudar con las dos cosas, primero una y después la otra. ¿Preferís que empecemos por la cancelación del turno, o por el turno nuevo?";
const PREGUNTA_ALGO_MAS = "¿Te puedo ayudar en algo más?";
const PREGUNTA_EN_QUE = "¿En qué te puedo ayudar?";
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

/** Si el mensaje nombra más de una sede, queda la última: es la corrección. */
function sedeFinalDelMensaje(texto: string, sedes: { name: string }[]): string {
  const t = sinTildes(texto);
  let mejor = "";
  let pos = -1;
  const ordenadas = [...sedes].sort((a, b) => sinTildes(b.name).length - sinTildes(a.name).length);
  for (const sede of ordenadas) {
    const nombre = sinTildes(sede.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`(?:^|[^a-z0-9+])${nombre}(?=$|[^a-z0-9])`, "g");
    let ultimo = -1;
    let match: RegExpExecArray | null;
    while ((match = re.exec(t))) ultimo = match.index;
    if (ultimo > pos) {
      pos = ultimo;
      mejor = sede.name;
    }
  }
  return mejor;
}

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
  profesional: "el nombre del profesional con el que busca el turno",
  tratamiento: "el tratamiento o la consulta que quiere",
  horario: "cuál de los horarios ofrecidos elige",
  confirmaProfesional: "si confirma el profesional que le propusimos (sí o no)",
};

/** Pedidos de la búsqueda de turnos: no van a la ficha del paciente. */
const PEDIDOS_BUSQUEDA = new Set(["profesional", "tratamiento", "horario", "confirmaProfesional", "orientacionTurno"]);

/** Según la pregunta que acabamos de hacer, qué responde el próximo mensaje. */
export function datoPedidoDePregunta(pregunta: string, resultado = ""): string {
  const t = sinTildes(`${pregunta}\n${resultado}`);
  if (!t.trim()) return "";
  if (/buscas a |te referis a /.test(t)) return "confirmaProfesional";
  if (
    /con que profesional|tenes algun profesional|profesional en especial|falta el profesional|cual buscabas|profesionales con ese|cual de estos profesionales/.test(
      t,
    )
  ) {
    return "profesional";
  }
  if (/para que tratamiento|estos son los tratamientos|cual de estos tratamientos|falta el tratamiento|hay mas de un cruce/.test(t)) {
    return "tratamiento";
  }
  if (
    (/seguir buscando|hablar con alguien del equipo|que preferis/.test(t) && /1\.|2\./.test(`${pregunta}\n${resultado}`)) ||
    (/tratamiento aproximado/.test(t) && /profesional/.test(t))
  ) {
    // La menú 1/2 es orientacionTurno; el follow-up de buscar vuelve a tratamiento/profesional.
    if (/tratamiento aproximado/.test(t) && /profesional/.test(t) && !/1\.|2\./.test(`${pregunta}\n${resultado}`)) {
      return "tratamiento";
    }
    return "orientacionTurno";
  }
  if (/cual de estos horarios|falta el horario|horarios libres|busco mas adelante/.test(t)) return "horario";
  if (/pasas (tu |el )?dni|falta el dni/.test(t)) return "dni";
  if (/cual es (tu |el )?email|falta el email/.test(t)) return "email";
  if (/cual es (tu |el )?nombre|hay que pedir nombre/.test(t) && !/profesional/.test(t)) return "pacienteNombre";
  if (/cual es (tu |el )?apellido/.test(t)) return "pacienteApellido";
  if (/masculino o femenino|sexo/.test(t)) return "sexo";
  if (/que edad|nino o adulto|grupo etario/.test(t)) return "grupoEtario";
  if (/para vos o para otra|consulta es para/.test(t)) return "consultaPara";
  if (/tratamiento y con que profesional/.test(t)) return "profesional";
  return "";
}

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
  if (clave !== "TURNOS") {
    const base: Record<string, string[]> = {
      INFO_TRATAMIENTOS: [],
      INFO_PROFESIONALES: [],
      QUEJAS: ["pacienteNombre"],
    };
    return [...(base[clave] ?? [])];
  }
  // Primero para quién es; si es otra persona, relación y edad; recién después DNI/nombre.
  const campos = ["consultaPara"];
  if (ficha.consultaPara === "tercero") {
    campos.push("relacionFamiliar", "grupoEtario", "pacienteNombre", "pacienteApellido", "sexo", "dni", "contactoNombre");
  } else {
    campos.push("grupoEtario", "pacienteNombre", "pacienteApellido", "sexo", "dni");
  }
  if ((ficha.esPaciente === "si" || ficha.esPaciente === "no") && !ficha.email) campos.push("email");
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

/** Antes de listar Drs / buscar turnos: para quién + edad (+ relación si es otra persona). */
function faltanteFichaAntesDeBuscar(ficha: Ficha): string | null {
  if (!ficha.consultaPara) return "consultaPara";
  if (ficha.consultaPara === "tercero" && !ficha.relacionFamiliar) return "relacionFamiliar";
  if (!ficha.grupoEtario) return "grupoEtario";
  return null;
}

/** Datos mínimos para que un operador asigne el turno a mano. */
function fichaListaParaOperador(ficha: Ficha): boolean {
  if (!ficha.consultaPara || !ficha.grupoEtario || !ficha.pacienteNombre || !ficha.pacienteApellido || !ficha.dni) {
    return false;
  }
  if (ficha.consultaPara === "tercero" && !ficha.relacionFamiliar) return false;
  return true;
}

function yaAvisoTurnoSinAsignar(mensajes: { direction: string; text: string }[]): boolean {
  return mensajes.some(
    (m) =>
      m.direction === "OUTBOUND" &&
      /no puedo asignarte el turno ahora|va a dar una persona del equipo lo antes posible/i.test(m.text),
  );
}

function preguntaFichaAntesDeBuscar(campo: string, ficha: Ficha): string {
  if (campo === "consultaPara") return "¿La consulta es para vos o para otra persona?";
  if (campo === "relacionFamiliar") return "¿Qué relación tenés con el paciente?";
  if (campo === "grupoEtario") {
    return ficha.consultaPara === "tercero"
      ? "¿Qué edad tiene? (si es niño o adulto también sirve)"
      : "¿Qué edad tenés?";
  }
  return "¿Me pasás ese dato?";
}

/** Respuestas de ficha que no son nombre de profesional. */
function esRespuestaFichaBasica(texto: string): boolean {
  const t = sinTildes(texto).replace(/[!¡.?,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/^(para mi|para mi mismo|yo|mio|mia)$/.test(t)) return true;
  if (/^(otra|otra persona|para otra|para otra persona|familiar)$/.test(t)) return true;
  if (/\b(para mi hija|para mi hijo|para mi mama|para mi papa|es para mi|es para otra|es mi hij|es mi papa|es mi mama|soy la mama|soy el papa)\b/.test(t)) {
    return true;
  }
  if (/^(tiene |tengo )?\d{1,3}( anos?)?$/.test(t)) return true;
  // 1 y 2 suelen ser opciones de menú, no edades sueltas.
  if (/^\d{1,3}$/.test(t)) {
    const n = Number(t);
    return n >= 3 && n <= 120;
  }
  return false;
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

function respuestaEsCorta(texto: string): boolean {
  const t = sinTildes(texto);
  if (t.includes("?")) return false;
  if (/\b(turno|precio|cuanto|donde|direccion|sede|sucursal|cobertura|obra social|queja|cancel|profesional|tratamiento|programa|horario|whatsapp|telefono)\b/.test(t)) {
    return false;
  }
  return texto.trim().split(/\s+/).filter(Boolean).length <= 6;
}

/** El mensaje responde el dato que pedimos, con la forma de ese dato. */
export function datoTieneForma(campo: string, texto: string): boolean {
  const t = sinTildes(texto).trim();
  if (!t) return false;
  if (campo === "dni") return Boolean(documentoDePersona(texto));
  if (campo === "email") return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(texto);
  if (campo === "confirmaProfesional") {
    if (/\b(si|sí|no|nop|dale|ok)\b/.test(t) && t.split(/\s+/).length <= 3) return true;
    // Otro nombre: está corrigiendo al profesional, no confirmando.
    return /^[a-zñáéíóúü]+(?:\s+[a-zñáéíóúü]+){0,4}$/i.test(texto.trim()) && !/\d|@/.test(texto);
  }
  if (campo === "profesional" || campo === "tratamiento") {
    if (/^(si|sí|no|ok|hola|chau|gracias)$/.test(t)) return false;
    // Un documento suelto no es un profesional.
    if (documentoDePersona(texto) && !/[a-záéíóúñ]/i.test(texto)) return false;
    // Edad / para quién no son profesional ni tratamiento.
    if (esRespuestaFichaBasica(texto)) return false;
    if (campo === "profesional" && (sinPreferenciaProfesional(texto) || noSabeTratamiento(texto))) return false;
    if (campo === "tratamiento" && noSabeTratamiento(texto)) return false;
    // Solo un número 1-12 puede ser ítem de lista; edades >= 13 no.
    if (/^\d{1,3}$/.test(t)) {
      const n = Number(t);
      return n >= 1 && n <= 12;
    }
    // Nombre corto (hasta ~5 tokens); frases largas no son un Dr.
    const tokens = texto.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 5) return false;
    return /^[a-zñáéíóúü0-9]+(?:[\s\-./]+[a-zñáéíóúü0-9]+){0,6}$/i.test(texto.trim());
  }
  if (campo === "horario") {
    return (
      /^\d{1,2}$/.test(t) ||
      /\bprimer|\bsegund|\btercer|\bmas adelante|\balgo antes|\d{1,2}:\d{2}/.test(t) ||
      /\d{4}-\d{2}-\d{2}/.test(texto)
    );
  }
  if (campo === "orientacionTurno") {
    return eligeBuscarOrientacion(texto) || eligeDerivacionOrientacion(texto);
  }
  if (campo === "sexo") return /\b(masculino|femenino|hombre|mujer|varon)\b/.test(t) || /^(1|2)$/.test(t.trim());
  if (campo === "grupoEtario") {
    const edad = t.match(/\b(\d{1,3})\b/);
    if (edad) {
      const n = Number(edad[1]);
      if (n >= 1 && n <= 120) return true;
    }
    return /\b(nino|nena|nene|infante|bebe|adolescente|adulto|mayor)\b/.test(t);
  }
  if (
    campo === "pacienteNombre" ||
    campo === "pacienteApellido" ||
    campo === "contactoNombre" ||
    campo === "contactoApellido"
  ) {
    if (/\d|@/.test(texto)) return false;
    if (/^(hola|chau|si|no|ok|dale|gracias|bueno)$/.test(t)) return false;
    return /^[a-zñáéíóúü]+(?:\s+[a-zñáéíóúü]+){0,3}$/i.test(texto.trim());
  }
  if (campo === "consultaPara") {
    return /\b(para mi|yo|mio|otra persona|familiar|hij|espos|mama|papa|madre|padre|abuel)\b/.test(t);
  }
  return true;
}

export function avisoDato(campo: string): string {
  if (campo === "dni") return "Eso no parece un documento. Puede ser el DNI, con o sin puntos, o uno de otro país. ¿Me lo pasás de nuevo?";
  if (campo === "email") return "Ese email no es válido. Necesito uno con formato nombre@dominio.com. ¿Me lo pasás de nuevo?";
  if (campo === "profesional") return "Necesito el nombre del profesional. ¿Me lo decís de nuevo?";
  if (campo === "tratamiento") return "Necesito el tratamiento o el número de la lista. ¿Me lo decís de nuevo?";
  if (campo === "horario") return "Elegí un horario de la lista, o escribí más adelante.";
  if (campo === "confirmaProfesional") return "Respondé sí o no: ¿te referís a esa persona?";
  if (campo === "orientacionTurno") {
    return "Respondé 1 para seguir buscando acá, o 2 para hablar con alguien del equipo.";
  }
  if (campo === "sexo") return "Necesito saber si es masculino o femenino. ¿Me lo decís de nuevo?";
  if (campo === "grupoEtario") return "Necesito la edad en números, o si es un niño o un adulto. ¿Me la decís de nuevo?";
  if (campo === "pacienteNombre" || campo === "contactoNombre") return "Necesito el nombre en letras. ¿Me lo repetís?";
  if (campo === "pacienteApellido" || campo === "contactoApellido") return "Necesito el apellido en letras. ¿Me lo repetís?";
  if (campo === "consultaPara") return "¿La consulta es para vos o para otra persona?";
  return "Ese dato no coincide con lo que te pedí. ¿Me lo repetís?";
}

/** Frases de corrección: "perdón no era Marcelo era Pablo", "el apellido es García". */
export function esCorreccion(texto: string): boolean {
  const t = sinTildes(texto);
  return /\b(perdon|perdona|me equivoqu\w*|me confundi\w*|no era|en realidad|mejor|prefiero|corrijo|corrigo|el apellido(?:\s+correcto)?\s+es|el nombre(?:\s+correcto)?\s+es|el dni(?:\s+correcto)?\s+es|mi dni(?:\s+correcto)?\s+es|la edad(?:\s+correcta)?\s+es|el mail(?:\s+correcto)?\s+es|el email(?:\s+correcto)?\s+es)\b/.test(
    t,
  );
}

function capitalizarPalabra(valor: string): string {
  const limpio = valor.trim().replace(/\s+/g, " ");
  if (!limpio) return "";
  return limpio
    .split(" ")
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase())
    .join(" ");
}

/** Saca el valor nuevo de una corrección explícita. */
export function extraerCorreccion(texto: string): {
  profesional: string;
  pacienteNombre: string;
  pacienteApellido: string;
  dni: string;
  sexo: "" | "masculino" | "femenino";
  grupoEtario: "" | "infanto" | "adulto";
  email: string;
} {
  const vacio: {
    profesional: string;
    pacienteNombre: string;
    pacienteApellido: string;
    dni: string;
    sexo: "" | "masculino" | "femenino";
    grupoEtario: "" | "infanto" | "adulto";
    email: string;
  } = {
    profesional: "",
    pacienteNombre: "",
    pacienteApellido: "",
    dni: "",
    sexo: "",
    grupoEtario: "",
    email: "",
  };
  if (!esCorreccion(texto)) return vacio;
  const t = sinTildes(texto);
  const out = { ...vacio };

  const apellido =
    t.match(/\bapellido(?:\s+correcto)?\s+(?:es|seria)\s+([a-zñ]{2,})/) ||
    t.match(/\bno(?:\s+era)?\s+[a-zñ]{2,}\s*[;,.]?\s*(?:era|es|sino)\s+([a-zñ]{2,}).*\bapellido/) ||
    t.match(/\bapellido\b.*\bno(?:\s+era)?\s+[a-zñ]{2,}\s*[;,.]?\s*(?:era|es|sino)\s+([a-zñ]{2,})/);
  if (apellido?.[1] && /\bapellido\b/.test(t)) out.pacienteApellido = capitalizarPalabra(apellido[1]);

  const nombre =
    t.match(/\bnombre(?:\s+correcto)?\s+(?:es|seria)\s+([a-zñ]{2,})/) ||
    t.match(/\bme llamo\s+([a-zñ]{2,})/);
  if (nombre?.[1] && (/\bnombre\b/.test(t) || /\bme llamo\b/.test(t)) && !/\bapellido\b/.test(t)) {
    out.pacienteNombre = capitalizarPalabra(nombre[1]);
  }

  const dni = documentoDePersona(texto);
  if (dni && /\b(dni|documento)\b/.test(t)) out.dni = dni;

  if (/\bsexo\b/.test(t) || /\bmasculino\b|\bfemenino\b|\bhombre\b|\bmujer\b|\bvaron\b/.test(t)) {
    if (/\bmasculino\b|\bhombre\b|\bvaron\b/.test(t)) out.sexo = "masculino";
    if (/\bfemenino\b|\bmujer\b/.test(t)) out.sexo = "femenino";
  }

  const edad = edadDicha(texto);
  if (edad != null) out.grupoEtario = edad >= 18 ? "adulto" : "infanto";
  else if (/\badult/.test(t)) out.grupoEtario = "adulto";
  else if (/\b(nino|nena|nene|infanto)\b/.test(t)) out.grupoEtario = "infanto";

  const email = texto.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0];
  if (email && /\b(mail|email|correo)\b/.test(t)) out.email = email.toLowerCase();

  const hablaProf =
    /\b(profesional|doctor|doctora|dr\b|dra\b|medico|medica)\b/.test(t) ||
    /\bcon\s+[a-zñ]/.test(t) ||
    /\bno era\s+[a-zñ].*\b(?:era|es|sino)\s+(?:con\s+)?[a-zñ]/.test(t);
  if (hablaProf && !/\bapellido\b|\bnombre\b|\bdni\b|\bdocumento\b|\bedad\b|\bsexo\b|\bmail\b|\bemail\b/.test(t)) {
    const cambio =
      t.match(
        /\bno era\s+(?:el\s+)?(?:dr|dra|doctor|doctora)?\s*([a-zñ]+(?:\s+[a-zñ]+)?)\s*[;,.]?\s*(?:era|es|sino|sino que|mejor)\s+(?:con\s+)?(?:el\s+)?(?:dr|dra|doctor|doctora)?\s*([a-zñ]+(?:\s+[a-zñ]+)?)/,
      ) ||
      t.match(
        /\b(?:mejor|prefiero|en realidad|ahora)\s+(?:con\s+)?(?:el\s+)?(?:dr|dra|doctor|doctora)?\s*([a-zñ]+(?:\s+[a-zñ]+)?)/,
      );
    if (cambio) {
      const nuevo = (cambio[2] || cambio[1] || "").trim();
      if (nuevo) out.profesional = capitalizarPalabra(nuevo);
    }
  }

  // "Perdón, el apellido es García, no López"
  const apellidoSolo = t.match(/\bel apellido(?:\s+correcto)?\s+es\s+([a-zñ]{2,})/);
  if (apellidoSolo?.[1]) out.pacienteApellido = capitalizarPalabra(apellidoSolo[1]);

  return out;
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
  if (!dicho(datos.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email.trim())) datos.email = "";
  else datos.email = datos.email.trim().toLowerCase();
  const doc = documentoDePersona(datos.dni);
  const docEnTexto = documentoDePersona(texto);
  datos.dni = doc && (doc === docEnTexto || texto.replace(/[\s.\-_/]/g, "").toUpperCase().includes(doc)) ? doc : "";
  if (/\d/.test(datos.pacienteNombre)) datos.pacienteNombre = "";
  if (/\d/.test(datos.pacienteApellido)) datos.pacienteApellido = "";
  if (/\d/.test(datos.contactoNombre)) datos.contactoNombre = "";
  if (/\d/.test(datos.contactoApellido)) datos.contactoApellido = "";
  if (datos.sexo && !t.includes(datos.sexo) && !/\b(hombre|mujer|varon)\b/.test(t)) {
    const inferido = sexoDesdeNombre(datos.pacienteNombre);
    if (datos.sexo !== inferido) datos.sexo = "";
  }
  const apellido = t.match(/\bapellido\s+(?:es|seria|correcto(?:\s+es)?)\s+([a-zñ]{2,})/);
  if (apellido?.[1]) {
    datos.pacienteApellido = apellido[1].charAt(0).toUpperCase() + apellido[1].slice(1);
  }
}

function completarSexoSiFalta(datos: {
  pacienteNombre: string;
  relacionFamiliar?: string;
  sexo: "" | "masculino" | "femenino";
}): void {
  if (datos.sexo) return;
  datos.sexo =
    sexoDesdeNombre(datos.pacienteNombre) || sexoDesdeRelacion(datos.relacionFamiliar ?? "") || "";
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

function esPreguntaAlgoMas(texto: string): boolean {
  const t = sinTildes(texto);
  return /te puedo ayudar (en|con) algo mas|necesitas algo mas/.test(t);
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

/** Pregunta por turnos que ya tendría, no por uno nuevo. */
function pideSusTurnos(texto: string): boolean {
  const t = sinTildes(texto);
  if (/\b(libre|reserv|sacame|sacar un turno|quiero un turno)\b/.test(t)) return false;
  return /\bmis turnos\b|\bturnos (futuros|anteriores|pasados)\b|\bque turno me qued|\bque turno tengo\b|\bolvid|\bno me acuerdo\b/.test(t);
}

/** La persona pide cancelar. "Me cancelaron" es una queja, no un pedido de cancelar. */
function pideCancelar(texto: string): boolean {
  const t = sinTildes(texto);
  if (/\bme (lo |la |los |las )?(cancel|anul)/.test(t)) return false;
  return /\b(quiero|necesito|puedo|quisiera|para|vengo a) (cancel|anul)|\b(cancel|anul)(ar|a|ame|alo|ala|enlo)\b/.test(t);
}

/** Quiere mover un turno que ya tiene. No es una queja del tipo «me lo cambiaron». */
function pideCambiar(texto: string): boolean {
  const t = sinTildes(texto);
  if (/\bme (lo |la |los |las )?cambi/.test(t)) return false;
  return /\b(reprogram|cambiar (el |mi |un )?turno|cambia(rlo|melo|lo)|mover (el |mi )?turno|pasar (el |mi )?turno)\b/.test(t);
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
  const daTurnos = botDaTurnos(bot);
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
      "requierePersona=true solo si pide algo de INECO que este canal no puede cerrar: confirmar una reserva que no dimos en esta charla, un resultado, una historia clínica o un dato clínico. false si no sabe el tratamiento o el profesional (el sistema le ofrece buscar o hablar con el equipo). false si es un turno nuevo, cancelar, cambiar o reprogramar un turno, ver sus turnos, un precio, una sede, una cobertura, una lista, una queja o un dato de la ficha.",
      "enConflicto=true solo si los pedidos no se pueden hacer juntos: cancelar un turno y sacar otro distinto. false si uno se responde con información (precio, sede, cobertura, tratamiento, profesional) y el otro es un turno o una queja: esos van los dos, el trámite largo queda en cola. false también si se pueden responder los dos, por ejemplo un precio y una dirección.",
      "hayPedido=false si no hay un pedido concreto: saludo, despedida, o un mensaje del que no se entiende la intención. Un sí, un no, un nombre o un DNI que responde algo nuestro es hayPedido=true.",
      "fueraDeIneco=true solo si el mensaje no tiene nada que ver con INECO: cultura general, tareas, clima, deportes, política, chistes, recetas, otras empresas o datos varios. false si habla de turnos, tratamientos, profesionales, sedes, precios, coberturas, pacientes, quejas, o responde un dato que pedimos. Un saludo o una despedida no son fuera de INECO. Si fueraDeIneco=true y en el catálogo está «Fuera de tema», incluí esa etiqueta.",
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
      "Correcciones: si dice perdón, me equivoqué, no era, en realidad, mejor, el apellido es, el nombre es, el DNI es o la edad es, actualizá solo el campo corregido con el valor nuevo. Ejemplo: «perdón, el apellido es García, no López» → pacienteApellido=García. «me equivoqué, tiene 19» → grupoEtario adulto.",
      "Si corrige el profesional («perdón no era Marcelo era Pablo», «mejor con Pablo»), no pongas Pablo en pacienteNombre: es el profesional. accion=turnos.libres y consulta con el nombre nuevo para verificar si existe.",
      "Cuando dan un nombre de profesional (o lo corrigen), siempre buscá si está habilitado: no asumas que existe ni inventes horarios.",
      "dni: solo dígitos, si la persona lo dijo. email: solo si lo dijo.",
      "sexo=masculino o femenino si el texto lo dice (hombre/mujer) o si el nombre de pila lo deja claro (Ana→femenino, Juan→masculino). No hace falta que digan la palabra femenino o masculino. Si el nombre es ambiguo (Alex), vacío.",
      "consultaPara=tercero si escribe por otra persona (por ejemplo \"para mi hijo\"). propio si la consulta es para quien escribe.",
      "relacionFamiliar es quién es el paciente para quien escribe: Padre, Madre, Abuelo, Abuela, Hijo, Hija, Tío, Tía, Sobrino, Sobrina, Esposo, Esposa, Pareja, Novio, Novia, Tutor u Otro.",
      "Si ya lo dijo, completalo y no dejes el campo vacío: mi hijo o mi nene = Hijo; mi hija o mi nena = Hija; mi papá o mi padre = Padre; mi mamá o mi madre = Madre; mi abuelo = Abuelo; mi abuela = Abuela; mi tío = Tío; mi tía = Tía; mi sobrino = Sobrino; mi sobrina = Sobrina; mi marido o mi esposo = Esposo; mi esposa o mi mujer = Esposa; mi pareja = Pareja; mi novio = Novio; mi novia = Novia; soy su tutor o tutora = Tutor. No vuelvas a preguntar la relación.",
      "personas: una entrada por cada persona que pide un turno, aunque no sea hijo, hija o mamá. Incluí al papá, la mamá, la esposa, el esposo, un abuelo o cualquiera que nombren, y a quien escribe si el turno también es para esa persona. etiqueta corta (quien escribe, papá Roberto, esposa Laura, Julián). consultaPara propio solo para quien escribe. Si no hay un turno, un array vacío. No inventes personas ni dupliques las que ya están en los casos.",
      "pacienteNombre y pacienteApellido son de la persona del caso activo. Si quien escribe dice soy, yo soy o me llamo, ese nombre y ese apellido son los suyos, aunque en el mismo mensaje nombre a otra persona. Un DNI dicho como mi DNI es de quien escribe: no lo pongas en el caso de otra persona.",
      "grupoEtario es la edad de la persona del caso activo. infanto si esa persona tiene menos de 18 o dice que es un niño. adulto si tiene 18 o más, o si dice que es adulta. Un número solo, cuando el dato pedido es la edad, también es la edad. La edad dicha junto a un hijo, una hija u otro familiar no es la de quien escribe. Si este mensaje no dice la edad del caso activo, dejalo vacío.",
      "resumen: una frase corta de toda la charla hasta ahora, actualizando el resumen anterior. No es una transcripción. No borres el pedido que ya se respondió: si preguntó una dirección y después un turno, la frase tiene las dos cosas. Ejemplo: Consulta por su hijo Franco. Preguntó por tratamientos de TDAH en CABA.",
      "hecho: una sola frase de lo que pasó en este mensaje, no repitas el resumen entero. Si solo saludó, hecho=Saludo. Si solo se despidió, hecho=Despedida. Si pidió un teléfono o un dato, decí solo eso.",
      "Los mensajes anteriores muestran qué preguntó el bot. Si el lote nuevo responde eso (sí, no, un nombre, un apellido, un DNI, una edad, me llamo o soy), continuarAnterior=true, fueraDeIneco=false y la intención sigue siendo la abierta. Completá ese dato en datos.",
      "Si se reanuda después de una persona, la charla sigue en el caso y el dato que quedaron guardados. Si este mensaje responde ese dato, o pregunta algo de INECO, fueraDeIneco=false y continuarAnterior=true. No la trates como una charla nueva. Si cambia de tema, continuarAnterior=false.",
      "Si preguntan qué dato habían dicho antes y hay correcciones, usá ese valor anterior. No lo inventes.",
      "intencionConcluida=true solo si, con este lote, la intención en la que quedamos ya no tiene nada pendiente.",
      "Un saludo, un cómo estás y una despedida no son intenciones: intencion vacía y la cortesía que corresponda.",
      "accion: una clave de la lista, o vacío. turnos.listarProfesionales si preguntan quién atiende un tratamiento, si no tienen profesional en especial pero sí dijeron el tratamiento, o si piden un horario libre sin decir el profesional. Si preguntamos el tratamiento y dicen que no saben cuál, no inventes uno: requierePersona=true. turnos.listarTratamientos si preguntan qué hace un profesional. turnos.libres si piden horarios y la consulta tiene profesional y tratamiento, o si responden el DNI que pedimos para esa búsqueda, o si piden fechas más adelante. Si la acción anterior listó varios cruces y eligen uno que estaba en esa lista, consulta copia ese profesional y ese tratamiento y la acción es turnos.libres. Si eligen algo que no estaba en la lista, accion vacía. turnos.reservar solo si eligen un horario que estaba en la lista: consulta copia profesional, tratamiento y la fecha y hora tal cual, con el formato que figura entre paréntesis. turnos.delPaciente si piden sus turnos anteriores o futuros, cuál les quedó, o dicen que se olvidaron o no se acuerdan del turno: consulta lleva el DNI. No es un turno nuevo. turnos.delPaciente si piden anular o cambiar un turno: no pidas la sede ni la fecha, los turnos de este canal son de la misma sede y la fecha sale de la búsqueda. turnos.cancelar solo si ya confirmaron la anulación. Vacío si todavía no se puede ejecutar ninguna. No abras una ficha nueva si solo preguntan por turnos que ya tienen. Si el resultado dice que es paciente, no vuelvas a pedir los datos que ya figuran.",
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
        ? PEDIDOS_BUSQUEDA.has(conversation.datoPedido)
          ? `El dato que pedimos recién es ${ETIQUETA_DATO[conversation.datoPedido] ?? conversation.datoPedido}. Este mensaje responde eso: si pedimos el profesional, es el nombre del profesional (no el del paciente). No completes pacienteNombre ni pacienteApellido salvo que diga explícitamente me llamo, soy o mi nombre es. La acción debe usar ese texto para buscar el turno.`
          : `El dato que pedimos recién es ${ETIQUETA_DATO[conversation.datoPedido] ?? conversation.datoPedido}. Si este mensaje lo responde, completalo en ese campo y no en otro.`
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
  const ultimaPregunta =
    lastOutbound >= 0 && messages[lastOutbound]?.direction === "OUTBOUND"
      ? messages[lastOutbound]!.text
      : "";
  const pedidoPrevio =
    conversation.datoPedido?.trim() || datoPedidoDePregunta(ultimaPregunta) || "";
  const correccion = extraerCorreccion(textoLote);
  // Si estábamos pidiendo profesional y corrige "no era X era Y", es el profesional nuevo.
  if (
    !correccion.profesional &&
    esCorreccion(textoLote) &&
    (pedidoPrevio === "profesional" || pedidoPrevio === "confirmaProfesional")
  ) {
    const t = sinTildes(textoLote);
    const cambio =
      t.match(
        /\bno era\s+(?:el\s+)?(?:dr\.?|dra\.?|doctor|doctora)?\s*[a-zñ]+(?:\s+[a-zñ]+)?\s*[;,.]?\s*(?:era|es|sino|sino que|mejor)\s+(?:con\s+)?(?:el\s+)?(?:dr\.?|dra\.?|doctor|doctora)?\s*([a-zñ]+(?:\s+[a-zñ]+)?)/,
      ) ||
      t.match(
        /\bno(?:\s+era)?\s+(?:el\s+)?(?:dr\.?|dra\.?|doctor|doctora)?\s*[a-zñ]+\s*[;,.]?\s*(?:era|es|sino)\s+(?:con\s+)?(?:el\s+)?(?:dr\.?|dra\.?|doctor|doctora)?\s*([a-zñ]+(?:\s+[a-zñ]+)?)/,
      ) ||
      t.match(
        /\b(?:mejor|prefiero|en realidad|ahora)\s+(?:con\s+)?(?:el\s+)?(?:dr\.?|dra\.?|doctor|doctora)?\s*([a-zñ]+(?:\s+[a-zñ]+)?)/,
      );
    if (cambio?.[1]) correccion.profesional = capitalizarPalabra(cambio[1]);
  }
  let rechazoDato = "";
  if (detection.datos) {
    acotarDatosAlTexto(textoLote, detection.datos);
    if (correccion.pacienteNombre) detection.datos.pacienteNombre = correccion.pacienteNombre;
    if (correccion.pacienteApellido) detection.datos.pacienteApellido = correccion.pacienteApellido;
    if (correccion.dni) detection.datos.dni = correccion.dni;
    if (correccion.sexo) detection.datos.sexo = correccion.sexo;
    if (correccion.grupoEtario) detection.datos.grupoEtario = correccion.grupoEtario;
    if (correccion.email) detection.datos.email = correccion.email;
    completarSexoSiFalta(detection.datos);
    // Si preguntamos profesional/tratamiento/horario, un nombre corto no es la ficha
    // (salvo corrección explícita o respuesta clara de para quién / edad).
    if (
      PEDIDOS_BUSQUEDA.has(pedidoPrevio) &&
      !correccion.pacienteNombre &&
      !correccion.pacienteApellido &&
      !correccion.dni &&
      !correccion.sexo &&
      !correccion.grupoEtario &&
      !correccion.email &&
      !esRespuestaFichaBasica(textoLote) &&
      !/\b(me llamo|yo soy|mi nombre es|soy [a-záéíóúñ])/i.test(textoLote)
    ) {
      detection.datos.pacienteNombre = "";
      detection.datos.pacienteApellido = "";
      detection.datos.contactoNombre = "";
      detection.datos.contactoApellido = "";
      if (!(pedidoPrevio === "profesional" && documentoDePersona(textoLote))) detection.datos.dni = "";
      detection.datos.email = "";
      detection.datos.sexo = "";
      detection.datos.grupoEtario = "";
    }
    // Respuestas de ficha (para quién / edad / relación) aunque hayamos preguntado otra cosa.
    // No interpretar 1/2 del menú de orientación como edad.
    if (esRespuestaFichaBasica(textoLote) && pedidoPrevio !== "orientacionTurno") {
      const dichoFicha = sinTildes(textoLote);
      if (
        /^(para mi|para mi mismo|yo|mio|mia)$/.test(dichoFicha.trim()) ||
        /\bpara mi\b(?!\s+(hij|nen|espos|mama|papa|madre|padre|abuel))/.test(dichoFicha)
      ) {
        detection.datos.consultaPara = "propio";
      }
      if (
        /^(otra|otra persona|para otra|para otra persona|familiar)$/.test(dichoFicha.trim()) ||
        /\b(para otra|es para otra|para mi hij|es mi hij|para mi mama|para mi papa|es mi papa|es mi mama|soy la mama|soy el papa)\b/.test(
          dichoFicha,
        )
      ) {
        detection.datos.consultaPara = "tercero";
      }
      const edadMatch = dichoFicha.match(/\b(\d{1,3})\b/);
      if (edadMatch && !/^(1|2)$/.test(dichoFicha.trim())) {
        const n = Number(edadMatch[1]);
        if (n >= 1 && n <= 120) detection.datos.grupoEtario = n >= 18 ? "adulto" : "infanto";
      } else if (/\badult/.test(dichoFicha)) detection.datos.grupoEtario = "adulto";
      else if (/\b(nino|nena|nene|infanto)\b/.test(dichoFicha)) detection.datos.grupoEtario = "infanto";
    }
    // Pidieron profesional y mandaron solo el documento: lo anoto y sigo pidiendo el profesional.
    if (
      !correccion.profesional &&
      !esCorreccion(textoLote) &&
      pedidoPrevio === "profesional" &&
      documentoDePersona(textoLote) &&
      !/[a-záéíóúñ]/i.test(textoLote)
    ) {
      detection.datos.dni = documentoDePersona(textoLote);
      rechazoDato = "Anoté el documento. ¿Tenés algún profesional en especial?";
    } else if (
      !correccion.profesional &&
      !esCorreccion(textoLote) &&
      pedidoPrevio &&
      respuestaEsCorta(textoLote) &&
      !datoTieneForma(pedidoPrevio, textoLote) &&
      !esRespuestaFichaBasica(textoLote) &&
      !(pedidoPrevio === "profesional" && (sinPreferenciaProfesional(textoLote) || noSabeTratamiento(textoLote))) &&
      !(pedidoPrevio === "tratamiento" && noSabeTratamiento(textoLote)) &&
      !(pedidoPrevio === "orientacionTurno" && datoTieneForma("orientacionTurno", textoLote))
    ) {
      rechazoDato = avisoDato(pedidoPrevio);
      detection.datos.pacienteNombre = "";
      detection.datos.pacienteApellido = "";
      detection.datos.contactoNombre = "";
      detection.datos.contactoApellido = "";
      detection.datos.dni = "";
      detection.datos.email = "";
      detection.datos.sexo = "";
      detection.datos.grupoEtario = "";
      detection.datos.cobertura = "";
      detection.datos.consultaPara = "";
      detection.datos.relacionFamiliar = "";
      detection.datos.esPaciente = "";
    } else if (pedidoPrevio === "dni" && datoTieneForma("dni", textoLote)) {
      detection.datos.dni = documentoDePersona(textoLote) || detection.datos.dni;
    } else if (pedidoPrevio === "email" && datoTieneForma("email", textoLote)) {
      detection.datos.email = textoLote.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0]?.toLowerCase() ?? detection.datos.email;
    } else if (pedidoPrevio === "sexo" && datoTieneForma("sexo", textoLote)) {
      const t = sinTildes(textoLote);
      if (/\bfemenin|\bmujer\b|^1$/.test(t.trim())) detection.datos.sexo = "femenino";
      if (/\bmasculin|\bhombre\b|\bvaron\b|^2$/.test(t.trim())) detection.datos.sexo = "masculino";
    }
    const dicho = sinTildes(textoLote);
    const familiar = /\b(hij[oa]|nene|nena|espos[oa]|mama|papa|madre|padre|abuel[oa]|tio|tia|sobrin[oa]|para otra|familiar)\b/.test(dicho);
    const propio =
      /^(para mi|para mi mismo|yo|mio|mia)$/.test(dicho.trim()) ||
      /\bpara mi\b(?!\s+(hij|nen|espos|mama|papa|madre|padre|abuel))/.test(dicho);
    // Solo aceptar propio/tercero si el mensaje lo dice (el modelo suele inventar «propio»).
    if (detection.datos.consultaPara === "tercero" && !familiar && !propio) detection.datos.consultaPara = "";
    if (detection.datos.consultaPara === "propio" && !propio && !familiar) detection.datos.consultaPara = "";
    if (!detection.datos.consultaPara && propio) detection.datos.consultaPara = "propio";
    if (!detection.datos.consultaPara && familiar) detection.datos.consultaPara = "tercero";
    completarSexoSiFalta(detection.datos);
  }

  let casosTurno = incorporarPersonas(
    asegurarCasos(conversation.casos ?? [], textoLote),
    rechazoDato || !Array.isArray(detection.personas) ? [] : detection.personas,
  );
  let activo = casoActivo(casosTurno, conversation.casoActivoId ?? "");
  const corrigeFicha = Boolean(
    correccion.pacienteNombre ||
      correccion.pacienteApellido ||
      correccion.dni ||
      correccion.sexo ||
      correccion.grupoEtario ||
      correccion.email,
  );
  if (detection.datos && activo && !rechazoDato && (!PEDIDOS_BUSQUEDA.has(pedidoPrevio) || corrigeFicha || esRespuestaFichaBasica(textoLote))) {
    if (!PEDIDOS_BUSQUEDA.has(pedidoPrevio)) {
      vincularDatoPedido(pedidoPrevio, textoLote, detection.datos);
    }
    precargarCaso(detection.datos, activo, casosTurno, textoLote);
    // precargarCaso puede reponer un «propio» inventado: volver a exigir evidencia en el texto.
    {
      const dichoPost = sinTildes(textoLote);
      const familiarPost = /\b(hij[oa]|nene|nena|espos[oa]|mama|papa|madre|padre|abuel[oa]|tio|tia|sobrin[oa]|para otra|familiar)\b/.test(
        dichoPost,
      );
      const propioPost =
        /^(para mi|para mi mismo|yo|mio|mia)$/.test(dichoPost.trim()) ||
        /\bpara mi\b(?!\s+(hij|nen|espos|mama|papa|madre|padre|abuel))/.test(dichoPost);
      if (detection.datos.consultaPara === "propio" && !propioPost) detection.datos.consultaPara = "";
      if (detection.datos.consultaPara === "tercero" && !familiarPost && !propioPost) detection.datos.consultaPara = "";
      if (!detection.datos.consultaPara && propioPost) detection.datos.consultaPara = "propio";
      if (!detection.datos.consultaPara && familiarPost) detection.datos.consultaPara = "tercero";
    }
    if (activo.consultaPara === "tercero" && /\bmi dni\b/.test(sinTildes(textoLote))) detection.datos.dni = "";
  }

  const fichaPrevia = fichaDesdeContacto(contact);
  const contactoActual =
    contact && detection.datos
      ? PEDIDOS_BUSQUEDA.has(pedidoPrevio) && !corrigeFicha && !esRespuestaFichaBasica(textoLote)
        ? detection.datos.dni
          ? await fillContact(contact.id, {
              consultaPara: "",
              relacionFamiliar: "",
              pacienteNombre: "",
              pacienteApellido: "",
              contactoNombre: "",
              contactoApellido: "",
              grupoEtario: "",
              cobertura: "",
              esPaciente: "",
              dni: detection.datos.dni,
              sexo: "",
              email: "",
            })
          : contact
        : await fillContact(contact.id, detection.datos)
      : contact;
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
  const quiereCambiar = pideCambiar(textoLote) || hayConflictoDePedidos(textoLote);
  const conflicto = false;

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
  if (detection.fueraDeIneco === true && sinTema) {
    const fuera = tagsByName.get("fuera de tema");
    if (fuera) wantedNames.add(fuera.name.toLowerCase());
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
  const sedeDeAhora = sedeFinalDelMensaje(textoLote, sedes);
  if (sedeDeAhora) {
    for (const sede of sedes) {
      if (sinTildes(sede.name) === sinTildes(sedeDeAhora)) continue;
      wantedNames.delete(sede.name.toLowerCase());
      nextTagIds.delete(sede.id);
    }
    wantedNames.add(sedeDeAhora.toLowerCase());
  }
  // No etiquetar sede por defecto ni por invento del modelo: solo si este mensaje la nombra.
  const sedesDichas = new Set(
    [
      ...(sedeDeAhora ? [sedeDeAhora] : []),
      ...etiquetasNombradas(textoLote, catalog.items, catalog.groups).filter((nombre) =>
        sedes.some((sede) => sinTildes(sede.name) === sinTildes(nombre)),
      ),
    ].map((nombre) => sinTildes(nombre)),
  );
  for (const sede of sedes) {
    const key = sede.name.toLowerCase();
    if (!wantedNames.has(key)) continue;
    if (sedesDichas.has(sinTildes(sede.name))) continue;
    wantedNames.delete(key);
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
    // Siempre educado: en el primer contacto, saluda aunque el mensaje sea de riesgo.
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
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
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
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
      const fuera = tagsByName.get("fuera de tema");
      if (fuera) nextTagIds.add(fuera.id);
      const derivado = tagsByName.get("derivado a asesor");
      if (derivado) nextTagIds.add(derivado.id);
      if (fuera || derivado) {
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
  const respondioAlgoMas = esPreguntaAlgoMas(ultimaPregunta);
  // Después de «¿Te puedo ayudar en algo más?»: no → despedida; sí → preguntar en qué.
  if (respondioAlgoMas && noQuiereNadaMas(textoLote, detection.cortesia)) {
    const pasaAlEquipo = seguimiento.derivacionPendiente;
    seguimiento.derivacionPendiente = false;
    seguimiento.datoPedido = null;
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
  if (
    respondioAlgoMas &&
    pideAfirmacion(textoLote) &&
    !pideNegacion(textoLote) &&
    sinTema &&
    !pideOtraCosa
  ) {
    seguimiento.datoPedido = null;
    await guardar({
      intencionAbierta: previa || null,
      intencionConcluida: true,
      intencionPropuesta: null,
      intencionCola: [],
    });
    await anotar(previa || null, true);
    await send(conversationId, PREGUNTA_EN_QUE);
    return;
  }
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
  // motivo puede ser legible; las fechas exactas viven en horarios.
  const previoAccion = [
    conversation.ultimoResultado?.motivo ?? "",
    conversation.ultimoResultado?.horarios ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  const consultaAccionBase = completarConsulta(textoLote, detection.consulta ?? "", previoAccion);
  const confirmaPendiente = /^Para confirmar (la anulación|el cambio):/i.test(previoAccion);
  const eleccionPendiente = /^Elegí el turno a (anular|cambiar):/i.test(previoAccion);
  const sigueGestion =
    pideCancelar(textoLote) ||
    quiereCambiar ||
    confirmaPendiente ||
    eleccionPendiente ||
    (/falta el dni/i.test(previoAccion) && Boolean(documentoDePersona(textoLote))) ||
    Boolean(turnosFuturosDe(previoAccion).length && turnoNombrado(textoLote, previoAccion));
  const modoPedido: "" | "anular" | "cambiar" = !sigueGestion
    ? ""
    : quiereCambiar || conversation.ultimoResultado?.objetivo === "cambiar"
      ? "cambiar"
      : "anular";
  let resultadoForzado = "";
  let claveAccion =
    detection.accion?.trim() || accionPorEleccion(textoLote, consultaAccionBase, previoAccion);
  if (claveAccion === "turnos.reservar" && reservaRepetida(consultaAccionBase, previoAccion)) claveAccion = "";
  if (confirmaPendiente && pideAfirmacion(textoLote) && modoPedido === "anular") claveAccion = "turnos.cancelar";
  else if (confirmaPendiente && pideAfirmacion(textoLote) && modoPedido === "cambiar") {
    claveAccion = "";
    resultadoForzado = `Cambio confirmado:\n${turnosFuturosDe(previoAccion)[0] ?? ""}`.trim();
  } else if (confirmaPendiente && pideNegacion(textoLote)) {
    claveAccion = "";
    resultadoForzado = "Quedó sin anular.";
  } else if (eleccionPendiente) {
    const elegido = turnoNombrado(textoLote, previoAccion);
    claveAccion = "";
    resultadoForzado = elegido
      ? `Para confirmar ${modoPedido === "cambiar" ? "el cambio" : "la anulación"}:\n${elegido}`
      : previoAccion;
  } else if (
    (/busc[aá]s a /i.test(previoAccion) || pedidoPrevio === "confirmaProfesional") &&
    pideNegacion(textoLote)
  ) {
    claveAccion = "";
    resultadoForzado = "Falta el profesional. Decime el nombre y el apellido.";
  } else if (
    (/busc[aá]s a /i.test(previoAccion) || pedidoPrevio === "confirmaProfesional") &&
    pideAfirmacion(textoLote)
  ) {
    claveAccion = "turnos.libres";
  } else if (
    (/busc[aá]s a /i.test(previoAccion) || pedidoPrevio === "confirmaProfesional") &&
    !pideAfirmacion(textoLote) &&
    !pideNegacion(textoLote) &&
    datoTieneForma("profesional", textoLote)
  ) {
    // Pidió confirmación y mandó otro nombre: busca ese profesional.
    claveAccion = "turnos.libres";
  }
  else if (pideCancelar(textoLote) || quiereCambiar) claveAccion = "turnos.delPaciente";
  else if (pideSusTurnos(textoLote)) claveAccion = "turnos.delPaciente";
  else if ((pideMasFechas(textoLote) || pideMasTemprano(textoLote)) && conversation.ultimoResultado?.busqueda) {
    claveAccion = "turnos.libres";
  }
  else if (/falta el dni/i.test(previoAccion) && documentoDePersona(textoLote)) {
    claveAccion = conversation.ultimoResultado?.accion === "turnos.delPaciente" ? "turnos.delPaciente" : "turnos.libres";
  }
  else if (
    !claveAccion &&
    chosen?.clave === "TURNOS" &&
    (/\b(turno|horario|libre|disponib)\b/.test(sinTildes(textoLote)) ||
      (/—/.test(previoAccion) &&
        /\bprimer[ao]?\b|\bsegund[ao]\b|\btercer[ao]?\b|\bcuart[ao]\b|\bquint[ao]\b/.test(sinTildes(textoLote))))
  ) {
    claveAccion = "turnos.libres";
  }
  if (sedeAjena || rechazoDato) claveAccion = "";
  if (correccion.profesional && !sedeAjena && !rechazoDato) {
    claveAccion = "turnos.libres";
  }
  // Pidió turno con un Dr concreto: buscar ya, sin pasar antes por edad / para quién.
  if (
    !claveAccion &&
    !sedeAjena &&
    !rechazoDato &&
    (chosen?.clave === "TURNOS" || previa === "TURNOS") &&
    (datoTieneForma("profesional", textoLote) ||
      /\b(dr\.?|dra\.?|doctor(?:a)?)\s+[a-záéíóúñ]/i.test(sinTildes(textoLote)))
  ) {
    claveAccion = "turnos.libres";
  }
  // Config «no dar turnos»: no buscar profesionales, libres ni reservar (sí ver/cancelar propios).
  if (
    !daTurnos &&
    (claveAccion === "turnos.libres" ||
      claveAccion === "turnos.listarProfesionales" ||
      claveAccion === "turnos.listarTratamientos" ||
      claveAccion === "turnos.reservar" ||
      claveAccion === "profesionales.listarTratamientos" ||
      claveAccion === "prestaciones.listarProfesionales")
  ) {
    claveAccion = "";
  }
  // Sin para quién / edad no buscamos turnos ni listamos Drs (salvo anular/ver propios).
  // Si ya nombró un profesional concreto, no frenamos: vamos directo a buscar.
  const yaNombroProfesional =
    Boolean(correccion.profesional) ||
    datoTieneForma("profesional", textoLote) ||
    /\b(dr\.?|dra\.?|doctor(?:a)?)\s+[a-záéíóúñ]/i.test(sinTildes(textoLote));
  const faltaFichaBusqueda = yaNombroProfesional ? null : faltanteFichaAntesDeBuscar(fichaActual);
  if (
    faltaFichaBusqueda &&
    (claveAccion === "turnos.libres" ||
      claveAccion === "turnos.listarProfesionales" ||
      claveAccion === "turnos.listarTratamientos" ||
      claveAccion === "turnos.reservar" ||
      claveAccion === "profesionales.listarTratamientos" ||
      claveAccion === "prestaciones.listarProfesionales")
  ) {
    claveAccion = "";
  }
  // Si preguntamos profesional pero contestaron ficha (para mí / edad), no buscar.
  if (
    PEDIDOS_BUSQUEDA.has(pedidoPrevio) &&
    esRespuestaFichaBasica(textoLote) &&
    (claveAccion === "turnos.libres" || claveAccion === "turnos.listarProfesionales")
  ) {
    claveAccion = "";
  }
  const enTurnos =
    chosen?.clave === "TURNOS" || previa === "TURNOS" || conversation.intencionAbierta === "TURNOS";
  // Eligió orientación: buscar acá o hablar con el equipo (solo si el bot puede dar turnos).
  if (
    daTurnos &&
    !sedeAjena &&
    !rechazoDato &&
    enTurnos &&
    pedidoPrevio === "orientacionTurno"
  ) {
    if (eligeDerivacionOrientacion(textoLote)) {
      seguimiento.derivacionPendiente = true;
      const derivado = tagsByName.get("derivado a asesor");
      if (derivado && !nextTagIds.has(derivado.id)) {
        nextTagIds.add(derivado.id);
        await saveTags(conversationId, [...nextTagIds]);
      }
      pausar(previa || "TURNOS");
      await guardar({
        intencionAbierta: "TURNOS",
        intencionConcluida: true,
        intencionPropuesta: null,
        intencionCola: [],
      });
      await anotar("TURNOS", true);
      if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
      await send(
        conversationId,
        "Dale, alguien del equipo te va a orientar por este medio.",
      );
      await send(conversationId, AVISO_EQUIPO);
      await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
      return;
    }
    if (eligeBuscarOrientacion(textoLote)) {
      claveAccion = "";
      resultadoForzado =
        "Perfecto. Decime un tratamiento aproximado (por ejemplo psiquiatría o psicología) o el nombre de un profesional, y te ayudo a buscar.";
    } else {
      claveAccion = "";
      resultadoForzado = TEXTO_ORIENTACION_TURNO;
    }
  }
  // No sabe el tratamiento → ofrecer buscar o derivar (no inventar uno).
  else if (
    daTurnos &&
    !sedeAjena &&
    !rechazoDato &&
    enTurnos &&
    pedidoPrevio === "tratamiento" &&
    noSabeTratamiento(textoLote)
  ) {
    claveAccion = "";
    resultadoForzado = TEXTO_ORIENTACION_TURNO;
    detection.requierePersona = false;
    seguimiento.derivacionPendiente = false;
  }
  // Sabe el tratamiento (o ya está en la charla) pero no tiene profesional en especial → listar Drs.
  // Pisa una acción previa del modelo: «cualquiera» / «no sé» no deben ir a turnos.libres.
  else if (
    daTurnos &&
    !sedeAjena &&
    !rechazoDato &&
    enTurnos &&
    !faltaFichaBusqueda &&
    pedidoPrevio === "profesional" &&
    (sinPreferenciaProfesional(textoLote) || noSabeTratamiento(textoLote)) &&
    !datoTieneForma("profesional", textoLote)
  ) {
    const hayTratamientoEnContexto =
      /estos son los tratamientos|falta el tratamiento|psiquiat|psicol|consulta|evaluacion|programa|ados|neuropsic|tratamiento/i.test(
        `${previoAccion}\n${detection.consulta ?? ""}\n${textoLote}`,
      );
    if (hayTratamientoEnContexto && !noSabeTratamiento(textoLote)) {
      claveAccion = "turnos.listarProfesionales";
    } else {
      // Sin tratamiento claro o no sabe → ofrecer buscar o hablar con el equipo.
      claveAccion = "";
      resultadoForzado = TEXTO_ORIENTACION_TURNO;
      detection.requierePersona = false;
      seguimiento.derivacionPendiente = false;
    }
  } else if (
    !claveAccion &&
    !sedeAjena &&
    !rechazoDato &&
    !faltaFichaBusqueda &&
    (pedidoPrevio === "profesional" ||
      pedidoPrevio === "tratamiento" ||
      (pedidoPrevio === "confirmaProfesional" &&
        datoTieneForma("profesional", textoLote) &&
        !pideAfirmacion(textoLote) &&
        !pideNegacion(textoLote))) &&
    enTurnos &&
    !(pedidoPrevio === "profesional" && (sinPreferenciaProfesional(textoLote) || noSabeTratamiento(textoLote))) &&
    !(pedidoPrevio === "tratamiento" && noSabeTratamiento(textoLote)) &&
    !esRespuestaFichaBasica(textoLote)
  ) {
    claveAccion = "turnos.libres";
  }
  const nombreConfirmado =
    previoAccion.match(/busc[aá]s a ([^\n.]+)/i)?.[1]?.trim() ||
    previoAccion.match(/te refer[ií]s a ([^\n.?]+)/i)?.[1]?.trim() ||
    "";
  const confirmaProfesionalAhora =
    !correccion.profesional &&
    Boolean(nombreConfirmado) &&
    (pedidoPrevio === "confirmaProfesional" || /busc[aá]s a /i.test(previoAccion)) &&
    pideAfirmacion(textoLote);
  const consultaAccion = [
    claveAccion === "turnos.delPaciente" ||
    claveAccion === "turnos.cancelar" ||
    claveAccion === "turnos.listarProfesionales" ||
    pideMasFechas(textoLote) ||
    pideMasTemprano(textoLote) ||
    (!correccion.profesional &&
      /falta el dni|profesionales con ese|estos son los tratamientos|hay más de un cruce|falta el tratamiento/i.test(
        previoAccion,
      ))
      ? previoAccion
      : "",
    // Si acabamos de confirmar el profesional, mandamos el nombre (sin el «sí»).
    // Si corrige el profesional, no reusar el nombre anterior.
    correccion.profesional
      ? ""
      : confirmaProfesionalAhora ||
          (nombreConfirmado &&
            (claveAccion === "turnos.libres" || pedidoPrevio === "confirmaProfesional"))
        ? nombreConfirmado
        : "",
    consultaAccionBase,
    correccion.profesional ? correccion.profesional : "",
    claveAccion === "turnos.libres" ||
    claveAccion === "turnos.reservar" ||
    claveAccion === "turnos.delPaciente" ||
    claveAccion === "turnos.cancelar" ||
    claveAccion === "turnos.listarProfesionales"
      ? confirmaProfesionalAhora || correccion.profesional
        ? correccion.profesional
          ? textoLote
          : ""
        : textoLote
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const gestionaExistente = Boolean(modoPedido) && !/^Cambio confirmado:/i.test(resultadoForzado);
  const cancelaExistente = gestionaExistente;
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
      caso.id === activo?.id ? { ...copiarFichaEnCaso(caso, fichaActual), estado: "completo" as const } : caso,
    );
    seguimiento.casos = casosTurno;
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
  if (cancelaExistente) datosDeClave = "";
  if (detection.requierePersona === true) seguimiento.derivacionPendiente = true;

  // Bot sin dar turnos: tomar ficha y derivar; no buscar ni reservar.
  const turnoNuevoSinAsignar =
    !daTurnos &&
    !sedeAjena &&
    !conflicto &&
    !cancelaExistente &&
    !confirmarReserva &&
    (chosen?.clave === "TURNOS" || previa === "TURNOS" || conversation.intencionAbierta === "TURNOS") &&
    claveAccion !== "turnos.delPaciente" &&
    claveAccion !== "turnos.cancelar" &&
    modoPedido !== "anular" &&
    modoPedido !== "cambiar";
  if (turnoNuevoSinAsignar && fichaListaParaOperador(fichaActual)) {
    seguimiento.derivacionPendiente = true;
    const derivado = tagsByName.get("derivado a asesor");
    if (derivado && !nextTagIds.has(derivado.id)) {
      nextTagIds.add(derivado.id);
      await saveTags(conversationId, [...nextTagIds]);
    }
    pausar(previa || "TURNOS");
    await guardar({
      intencionAbierta: "TURNOS",
      intencionConcluida: true,
      intencionPropuesta: null,
      intencionCola: [],
    });
    await anotar("TURNOS", true);
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
    if (!yaAvisoTurnoSinAsignar(messages)) await send(conversationId, TEXTO_TURNO_SIN_ASIGNAR);
    await send(conversationId, TEXTO_TURNO_DATOS_LISTOS);
    await send(conversationId, AVISO_EQUIPO);
    await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
    return;
  }

  const accion = conflicto
    ? null
    : accionPermitida(claveAccion, chosen?.clave ?? "");
  const opcionRechazada =
    accion && (accion.clave === "turnos.libres" || accion.clave === "turnos.reservar")
      ? textoOpcionInvalida(textoLote, previoAccion)
      : "";
  const horarioRechazado =
    accion?.clave === "turnos.reservar" && !horarioOfrecido(consultaAccion, previoAccion)
      ? `Ese horario no está entre las opciones.\n${
          conversation.ultimoResultado?.horarios
            ? formatearHorariosAgrupados(
                conversation.ultimoResultado.horarios
                  .split("\n")
                  .map((linea) => linea.trim())
                  .filter((linea) => /\(\d{4}-\d{2}-\d{2}/.test(linea)),
              )
            : previoAccion
        }`
      : "";
  const salidaAccion =
    accion && !resultadoForzado && !opcionRechazada && !horarioRechazado
      ? await ejecutarAccion(accion.clave as AccionClave, consultaAccion, {
          dni: contact?.dni ?? "",
          nombre: contact?.firstName ?? "",
          apellido: contact?.lastName ?? "",
          sexo: contact?.sexo ?? "",
          telefono: contact?.phoneNumber ?? "",
          email: contact?.email ?? "",
          desdeDia: conversation.ultimoResultado?.hastaDia,
          busqueda: conversation.ultimoResultado?.busqueda,
          ampliar: pideMasFechas(textoLote),
          masTemprano: pideMasTemprano(textoLote),
          horariosPrevios: conversation.ultimoResultado?.horarios,
          // Un «sí» de confirmación no es el nombre del profesional.
          textoPersona:
            nombreConfirmado ||
            (pedidoPrevio === "confirmaProfesional" && pideAfirmacion(textoLote) ? "" : textoLote),
        })
      : null;
  let resultadoAccion = resultadoForzado || horarioRechazado || opcionRechazada || salidaAccion?.texto || "";
  if (modoPedido && accion?.clave === "turnos.delPaciente" && /futuro:/i.test(resultadoAccion)) {
    const propias = textoDeTurnosPropios(modoPedido, resultadoAccion, `${textosEntrantes}\n${consultaAccion}`);
    // Anulación clara (un solo turno o ya nombrado): cancelar ya, sin derivar ni pedir otro sí.
    if (modoPedido === "anular" && /^Para confirmar la anulación:/i.test(propias)) {
      const linea = propias.replace(/^Para confirmar la anulación:\s*/i, "").trim();
      const baja = await ejecutarAccion("turnos.cancelar", `${linea}\n${consultaAccion}`, {
        dni: contact?.dni ?? "",
        nombre: contact?.firstName ?? "",
        apellido: contact?.lastName ?? "",
        sexo: contact?.sexo ?? "",
        telefono: contact?.phoneNumber ?? "",
        email: contact?.email ?? "",
        textoPersona: textosEntrantes,
      });
      resultadoAccion = baja?.texto || "No pude cancelar el turno.";
    } else {
      resultadoAccion = propias;
    }
  }
  if (
    accion?.clave === "turnos.reservar" &&
    /turno dado:/i.test(resultadoAccion) &&
    conversation.ultimoResultado?.anularLuego
  ) {
    const baja = await ejecutarAccion("turnos.cancelar", `${conversation.ultimoResultado.anularLuego}\n${consultaAccion}`, {
      dni: contact?.dni ?? "",
      nombre: contact?.firstName ?? "",
      apellido: contact?.lastName ?? "",
      sexo: contact?.sexo ?? "",
      telefono: contact?.phoneNumber ?? "",
      email: contact?.email ?? "",
    });
    resultadoAccion = `${resultadoAccion}\n${baja.texto}`;
  }
  if (salidaAccion?.ficha && contact) {
    const cargada = await fillContact(contact.id, salidaAccion.ficha);
    if (cargada) {
      fichaActual = fichaDesdeContacto(cargada);
      if (!sedeAjena && !conflicto && !confirmarReserva && !cancelaExistente) {
        faltan = faltantesDe(claveDatos, fichaActual);
      }
    }
  }
  const anularLuego =
    /^Quedó sin anular/i.test(resultadoAccion) || /turno cancelado:/i.test(resultadoAccion)
      ? ""
      : /^Cambio confirmado:/i.test(resultadoAccion)
        ? (turnosFuturosDe(resultadoAccion)[0] ?? "")
        : (conversation.ultimoResultado?.anularLuego ?? "");
  const objetivoGuardado =
    /^Quedó sin anular/i.test(resultadoAccion) || /turno cancelado:/i.test(resultadoAccion)
      ? ""
      : anularLuego
        ? "cambiar"
        : modoPedido;
  if ((accion && resultadoAccion) || resultadoForzado) {
    seguimiento.ultimoResultado = {
      accion: accion?.clave || "turnos.delPaciente",
      ok: !/no encontr|no está|sin coincid|no está entre|no pude|no pudo|parámetros obligatorios/i.test(resultadoAccion),
      motivo: resultadoAccion.slice(0, 1500),
      ...(objetivoGuardado === "anular" || objetivoGuardado === "cambiar" ? { objetivo: objetivoGuardado } : {}),
      ...(anularLuego ? { anularLuego } : {}),
      ...(salidaAccion?.hastaDia ? { hastaDia: salidaAccion.hastaDia, busqueda: salidaAccion.busqueda } : {}),
      ...(salidaAccion?.horarios || conversation.ultimoResultado?.horarios
        ? { horarios: salidaAccion?.horarios || conversation.ultimoResultado?.horarios }
        : {}),
      ...(!salidaAccion?.hastaDia && opcionRechazada
        ? {
            hastaDia: conversation.ultimoResultado?.hastaDia,
            busqueda: conversation.ultimoResultado?.busqueda,
          }
        : {}),
    };
  }

  const esInfo = !sedeAjena && Boolean(chosen?.clave?.startsWith("INFO_"));
  if (!conflicto && !sedeAjena && faltan.length) estadoSiguiente.intencionConcluida = false;
  if (!conflicto && esInfo && faltan.length === 0) estadoSiguiente.intencionConcluida = true;
  await anotar(estadoSiguiente.intencionAbierta, estadoSiguiente.intencionConcluida);
  const preguntaAccion = preguntaDeResultado(resultadoAccion, chosen?.clave === "TURNOS" ? (accion?.clave ?? "") : "");
  if (preguntaAccion) {
    seguimiento.datoPedido = datoPedidoDePregunta(preguntaAccion, resultadoAccion) || null;
  }
  if (/falta el dni/i.test(resultadoAccion)) seguimiento.datoPedido = "dni";
  if (/no es paciente|hay que pedir nombre/i.test(resultadoAccion) && !fichaActual.pacienteNombre) {
    seguimiento.datoPedido = "pacienteNombre";
  }
  if (/falta el email/i.test(resultadoAccion)) seguimiento.datoPedido = "email";
  if (soloConfirma && !resultadoAccion) {
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
  // Mientras resolvemos profesional/tratamiento, no pedirle datos de ficha (DNI, etc.).
  const buscandoTurnoAhora =
    Boolean(preguntaAccion) ||
    /busc[aá]s a |falta el (profesional|tratamiento)|estos son los tratamientos|tenemos estos profesionales|profesionales con ese nombre/i.test(
      resultadoAccion,
    );
  const pedido = buscandoTurnoAhora ? "" : faltan[0] ? ETIQUETA_DATO[faltan[0]] ?? faltan[0] : "";
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
  if (rechazoDato) {
    seguimiento.datoPedido = pedidoPrevio;
    if (fase === "inicio" && charla.saludo) await send(conversationId, charla.saludo);
    await send(conversationId, rechazoDato);
    await guardar(estadoSiguiente);
    if (conversation.assigneeKind === "none") {
      await saveAssignee(conversationId, { kind: "bot", name: identidad.nombre });
    }
    return;
  }
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
      "No digas que un turno quedó reservado si la acción no lo dio. Si la ficha ya está completa y no hay un horario elegido, pedí el tratamiento y el profesional para buscar un turno libre. No ofrezcas un turno de una sede que no sea CABA. Si el resultado de esta acción trae «Tengo los siguientes turnos libres», no listes días ni horas en partes (el sistema manda ese listado). Si el resultado dice «Turno dado», confirmalo en una frase y no preguntes de nuevo el tratamiento ni el profesional. Si dice «Turno cancelado», confirmalo y no digas que lo ve el equipo. Si dice que antes no hay otros, no armes otra lista. Si el resultado lista profesionales o tratamientos, nombrá solo los nombres legibles: sin números de documento, sin códigos entre paréntesis y sin pegar el resultado crudo. Si dice que falta el tratamiento, el profesional sí está: pedí el tratamiento y no digas que no está habilitado. Si el resultado nombra un profesional de la lista, ese profesional sí está habilitado: no digas lo contrario. Si dice «Buscás a» un profesional, no lo repitas en partes: la pregunta del sistema confirma si se refiere a ese nombre completo, y no busques horarios todavía. Si lista profesionales con ese nombre o apellido, nombralos y preguntá cuál buscaba. Si lista tratamientos, nombralos uno por uno. Si dice que falta el profesional, ese nombre no está: mostrá la lista si vino y no pidas el DNI. Si dice que es paciente, no pidas los datos que ya figuran. Si dice que no es paciente, pedí solo el dato que falta. Si el horario o la consulta no estaban entre las opciones, no armes la lista vos. Si recién piden sacar un turno y todavía no dijeron profesional ni tratamiento, no arranques por el DNI: preguntá si tienen algún profesional en especial. Orden del turno: profesional, después tratamiento, recién después DNI si hace falta. Al reservar, usá la fecha exacta de ClavesISO (formato entre paréntesis).",
      !daTurnos && turnoNuevoSinAsignar
        ? "IMPORTANTE: este canal NO asigna ni reserva turnos. No busques profesionales, no listes horarios y no digas que un turno quedó dado. Pedí solo datos de ficha (para quién, edad, nombre, apellido, DNI). El turno lo asigna una persona del equipo."
        : "",
      "Si el mensaje nombra varios turnos o varias personas, nombrá a cada una. Pedí los datos de una sola por vez, la del caso activo. No le atribuyas a esa persona la edad ni el nombre de otra.",
      "Si pregunta por varios tratamientos, precios o programas en el mismo mensaje, respondé cada uno que esté en la base. No elijas uno solo.",
      "Si una parte no se puede resolver (confirmar, cancelar o un dato clínico) y otra sí, resolvé la que se puede y decí que la otra la ve una persona. No dejes de contestar la que sí podés.",
      "Una sede nombrada para pedir dirección, teléfono u horario es solo un dato. No la uses como sede de un turno, de una cancelación ni de una reserva, salvo que digan que ese turno es ahí.",
      "Si piden confirmar una reserva y además otra cosa, la confirmación es una frase y el resto se responde. No tapes el resto del mensaje.",
      "Si el estado lista correcciones ya hechas y preguntan cuál era el dato anterior, respondé con ese valor. No lo inventes.",
      "Si corrige un dato de la ficha, confirmá el valor nuevo en una frase corta y seguí con lo que faltaba. Si corrige el profesional, buscá si el nuevo existe y no digas que quedó el anterior.",
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
              ? `Para la intención principal falta un solo dato. La información va en partes. En pregunta pedí únicamente: ${pedido}. No pidas ningún dato que ya figure en la ficha. No repitas esa pregunta dentro de partes. Si el resultado trajo una lista de profesionales o de consultas, nombralos.`
              : esInfo
                ? sedeInformada
                  ? `Respondé ahora lo que preguntó, con la base. No digas que ya estaba respondido. La sede es ${sedeInformada}: pasá solo el dato que esté escrito y no ofrezcas sacar un turno por este canal. pregunta vacía, o solo: ¿Te puedo ayudar en algo más?`
                  : "Respondé ahora lo que preguntó este mensaje, con la base. No digas que ya estaba respondido. No pidas nombre, edad, DNI ni si ya es paciente. En pregunta, solo: ¿Te puedo ayudar en algo más? No ofrezcas sacar un turno."
                : cancelaExistente
                  ? "Está anulando o cambiando un turno que ya tiene. No pidas la sede: este canal siempre usa la misma. No pidas la fecha si no la dijo. Si el resultado pide elegir, preguntá cuál. Si pide confirmar, pedí esa confirmación y no digas que ya quedó anulado. Si falta el DNI, pedilo."
                : chosen?.clave === "TURNOS"
                  ? "La ficha ya está completa. No preguntes el motivo. Si hay un resultado de turnos libres, del paciente o de una reserva, decilo. Si no, pedí el tratamiento y el profesional para buscar un horario libre. No digas que el turno quedó dado si la acción no lo dio."
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
            : buscandoTurnoAhora
              ? "Estamos eligiendo profesional o tratamiento. Seguí solo el resultado de las listas. No pidas DNI ni otros datos de ficha todavía. No digas que un profesional de la lista no está habilitado. No pegues documentos ni códigos."
            : esInfo && faltan.length === 0
              ? sedeInformada
                ? `Respondé ahora la consulta sobre ${sedeInformada}. No digas que ya estaba respondida. No ofrezcas sacar un turno.`
                : "Respondé ahora la consulta con la base. No digas que ya estaba respondida. En la pregunta solo: ¿Te puedo ayudar en algo más? No ofrezcas sacar un turno."
              : faltan.length
                ? `Falta para la intención principal: ${faltan.join(", ")}. Pedí solo el primero, una sola vez, en pregunta. No agregues listas de profesionales.`
                : cancelaExistente
                  ? "Está anulando o cambiando un turno que ya tiene. No pidas la sede ni una fecha que no dijo. Seguí el resultado: elegir, confirmar o pedir el DNI. No digas que ya quedó anulado si el resultado no lo dice."
                : chosen?.clave === "TURNOS"
                  ? "No falta ningún dato de la ficha. No preguntes el motivo. Si no hay un horario elegido, pedí el tratamiento y el profesional. No digas que el turno quedó dado si la acción no lo dio."
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
  if (fichaTurnoLista && !resultadoAccion) {
    const anotados = seguimiento.casos
      .filter((caso) => caso.estado === "completo" || caso.estado === "juntando")
      .map((caso) => caso.etiqueta);
    if (anotados.length > 1) bloques.unshift(`Anoté estos turnos: ${anotados.join(", ")}.`);
    if (!faltan.length) pregunta = "¿Para qué tratamiento y con qué profesional busco un turno libre?";
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
  // Si ya ofrecimos menú de orientación, no derivar por requierePersona del modelo.
  if (
    detection.requierePersona === true &&
    !sedeAjena &&
    !conflicto &&
    !fichaTurnoLista &&
    !preguntaAccion &&
    !/hablar con alguien del equipo|seguir buscando/i.test(resultadoAccion)
  ) {
    seguimiento.derivacionPendiente = true;
    if (!bloques.some((parte) => /persona del equipo|deriv/i.test(sinTildes(parte)))) {
      bloques.push("Esa parte la va a ver una persona del equipo.");
    }
    if (!faltan.length) pregunta = PREGUNTA_ALGO_MAS;
  }
  // Cancelar/cambiar lo hace este canal: no derivar ni avisar que lo ve el equipo.
  if (cancelaExistente && !conflicto && /turno cancelado:/i.test(resultadoAccion)) {
    pregunta = PREGUNTA_ALGO_MAS;
    seguimiento.datoPedido = null;
    seguimiento.derivacionPendiente = false;
    if (!bloques.some((parte) => /cancel/i.test(sinTildes(parte)))) {
      const detalle = resultadoAccion.replace(/^Turno cancelado:\s*/i, "").trim();
      bloques = [detalle ? `Listo, cancelé el turno: ${detalle}` : "Listo, el turno quedó cancelado."];
    }
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
  // Una sola lista de horarios. El modelo no manda el listado: lo arma el sistema.
  const lineasHorarioGuardadas = (salidaAccion?.horarios ?? "")
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(linea));
  const listadoHumano = lineasHorarioGuardadas.length
    ? formatearHorariosAgrupados(lineasHorarioGuardadas)
    : "";
  const esTextoDeHorarios = (parte: string): boolean => {
    if (
      /turnos libres|horarios libres|horarios? disponibles|tengo estas opciones|estas opciones|clavesiso:|\(\d{4}-\d{2}-\d{2}|[ap]\.\s*m\./i.test(
        parte,
      )
    ) {
      return true;
    }
    if (/^-\s*\d{1,2}:\d{2}\b/m.test(parte)) return true;
    const dias = (parte.match(/\b(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi) || [])
      .length;
    const horas = (parte.match(/\b\d{1,2}:\d{2}\b/g) || []).length;
    return dias >= 1 && horas >= 1;
  };
  if (preguntaAccion && !conflicto && !sedeAjena) pregunta = preguntaAccion;
  // Menú orientación (buscar vs equipo): el cuerpo lo fija el sistema, no el modelo.
  if (/hablar con alguien del equipo/i.test(resultadoAccion) && /seguir buscando/i.test(resultadoAccion)) {
    const cuerpo = resultadoAccion.replace(/\n*¿Qué preferís\??\s*$/i, "").trim();
    if (cuerpo) bloques = [cuerpo];
  } else if (/tratamiento aproximado/i.test(resultadoAccion) && /nombre de un profesional/i.test(resultadoAccion)) {
    const cuerpo = resultadoAccion.replace(/\n*¿[^\n]*\??\s*$/i, "").trim();
    if (cuerpo) bloques = [cuerpo];
  }
  let horariosYaPuestos = false;
  if (listadoHumano && (accion?.clave === "turnos.libres" || /cuál de estos horarios/i.test(pregunta))) {
    // Un solo globo con el formato agrupado. Se descarta cualquier listado del modelo.
    bloques = [listadoHumano];
    pregunta = "¿Cuál de estos horarios querés?";
    horariosYaPuestos = true;
  } else if (listadoHumano && bloques.some(esTextoDeHorarios)) {
    bloques = bloques.filter((parte) => !esTextoDeHorarios(parte));
    bloques.push(listadoHumano);
    horariosYaPuestos = true;
  } else if (!listadoHumano) {
    const horariosFuera = horariosOmitidos(
      `${bloques.join("\n")}\n${pregunta}`,
      salidaAccion?.horarios ?? "",
    );
    if (horariosFuera) {
      bloques = bloques.filter((parte) => !esTextoDeHorarios(parte));
      bloques.push(horariosFuera);
      horariosYaPuestos = true;
    }
  }
  if (!horariosYaPuestos) {
    const opcionesFuera = opcionesOmitidas(`${bloques.join("\n")}\n${pregunta}`, resultadoAccion);
    if (opcionesFuera && !esTextoDeHorarios(opcionesFuera)) bloques.unshift(opcionesFuera);
  }
  // Si el turno se dio, no reabrir tratamiento/profesional ni horarios.
  if (/turno dado:/i.test(resultadoAccion) && !conflicto && !sedeAjena) {
    pregunta = PREGUNTA_ALGO_MAS;
    seguimiento.datoPedido = null;
    // Tirar listados viejos de tratamientos/horarios que el modelo haya mezclado.
    bloques = bloques.filter(
      (parte) =>
        !/cuál de estos tratamientos|estos son los tratamientos|siguientes turnos libres|clavesiso:/i.test(
          parte,
        ),
    );
    if (!bloques.length || !/reserv|quedó dado|turno dado|listo/i.test(bloques.join(" "))) {
      const detalle = resultadoAccion.replace(/^Turno dado:\s*/i, "").trim();
      bloques = [detalle ? `Listo, quedó reservado: ${detalle}` : "Listo, el turno quedó reservado."];
    }
    if (seguimiento.ultimoResultado) {
      const { horarios: _h, hastaDia: _d, busqueda: _b, ...rest } = seguimiento.ultimoResultado;
      seguimiento.ultimoResultado = rest;
    }
  }
  // Si la reserva falló, no dejes que el modelo diga que se reservó.
  if (
    accion?.clave === "turnos.reservar" &&
    resultadoAccion &&
    !/turno dado:/i.test(resultadoAccion) &&
    !conflicto
  ) {
    bloques = bloques.filter((parte) => !/reserv|quedó dado|se realizó correctamente/i.test(sinTildes(parte)));
    if (!bloques.length && resultadoAccion.trim()) bloques = [resultadoAccion.split("\n")[0]!.slice(0, 300)];
  }
  // Si la acción propone confirmar un profesional, no repetir «Buscás a…» en un globo aparte.
  if (/busc[aá]s a /i.test(resultadoAccion) && preguntaAccion) {
    bloques = bloques
      .map((parte) =>
        parte
          .split(/(?<=[.!?])\s+/)
          .filter((frase) => !/busc[aá]s a /i.test(frase))
          .join(" ")
          .trim(),
      )
      .filter(Boolean);
  }
  // Primero para quién / relación / edad — pisa listados de Drs si todavía falta la ficha básica.
  // Si ya pidió un Dr en especial, no anteponer edad/para quién: priorizar turnos u orientación.
  if (
    !conflicto &&
    !sedeAjena &&
    !cancelaExistente &&
    !confirmarReserva &&
    chosen?.clave === "TURNOS" &&
    !resultadoForzado
  ) {
    const faltaBasica = yaNombroProfesional ? null : faltanteFichaAntesDeBuscar(fichaActual);
    if (faltaBasica) {
      // No mandar listados de profesionales mientras falta para quién / edad.
      bloques = bloques.filter(
        (parte) =>
          !/tenemos estos profesionales|profesionales para|cuál de estos profesionales|no encontr|habilitado con/i.test(
            parte,
          ),
      );
      pregunta = preguntaFichaAntesDeBuscar(faltaBasica, fichaActual);
      seguimiento.datoPedido = faltaBasica;
    } else if (
      !daTurnos &&
      turnoNuevoSinAsignar &&
      faltan[0] &&
      (faltan[0] === "dni" ||
        faltan[0] === "pacienteNombre" ||
        faltan[0] === "pacienteApellido" ||
        faltan[0] === "sexo" ||
        faltan[0] === "contactoNombre" ||
        faltan[0] === "email")
    ) {
      // Sin dar turnos: seguir pidiendo ficha (no profesional ni horarios).
      bloques = bloques.filter(
        (parte) =>
          !/tenemos estos profesionales|cuál de estos profesionales|horarios|turnos libres/i.test(parte),
      );
      pregunta = activo
        ? preguntaDelCaso(activo, faltan[0])
        : preguntaFichaAntesDeBuscar(faltan[0], fichaActual);
      if (faltan[0] === "pacienteNombre" && !activo) {
        pregunta =
          fichaActual.consultaPara === "tercero" ? "¿Cuál es el nombre del paciente?" : "¿Cuál es tu nombre?";
      }
      if (faltan[0] === "pacienteApellido" && !activo) {
        pregunta =
          fichaActual.consultaPara === "tercero" ? "¿Cuál es el apellido del paciente?" : "¿Cuál es tu apellido?";
      }
      if (faltan[0] === "dni" && !activo) {
        pregunta =
          fichaActual.consultaPara === "tercero" ? "¿Me pasás el DNI del paciente?" : "¿Me pasás tu DNI?";
      }
      if (faltan[0] === "sexo" && !activo) {
        pregunta =
          fichaActual.consultaPara === "tercero"
            ? "¿El paciente es masculino o femenino?"
            : "¿Sos masculino o femenino?";
      }
      seguimiento.datoPedido = faltan[0];
    } else if (
      daTurnos &&
      !preguntaAccion &&
      !resultadoAccion &&
      (faltan[0] === "dni" ||
        faltan[0] === "pacienteNombre" ||
        faltan[0] === "pacienteApellido" ||
        faltan[0] === "sexo" ||
        faltan[0] === "contactoNombre")
    ) {
      pregunta = "¿Tenés algún profesional en especial?";
      seguimiento.datoPedido = "profesional";
    }
  }
  // Aviso único: este canal no asigna el turno; se toman datos para el equipo.
  if (turnoNuevoSinAsignar && !yaAvisoTurnoSinAsignar(messages)) {
    if (!bloques.some((parte) => /no puedo asignarte el turno ahora/i.test(parte))) {
      bloques = [TEXTO_TURNO_SIN_ASIGNAR, ...bloques];
    }
  }
  // Cierre de info: solo ofrecer más ayuda, sin empujar a sacar turno.
  if (
    !preguntaAccion &&
    !conflicto &&
    !sedeAjena &&
    !cancelaExistente &&
    !confirmarReserva &&
    esInfo &&
    faltan.length === 0 &&
    !sedeInformada
  ) {
    pregunta = PREGUNTA_ALGO_MAS;
  }
  if (confirmarReserva && !conflicto && !sedeAjena && !preguntaAccion) {
    seguimiento.derivacionPendiente = true;
    if (!faltan.length) pregunta = PREGUNTA_ALGO_MAS;
  } else if (sedeAjena) pregunta = "";
  const pedidoDePregunta = datoPedidoDePregunta(pregunta, resultadoAccion);
  if (pedidoDePregunta) seguimiento.datoPedido = pedidoDePregunta;
  else if (faltan[0] && !preguntaAccion) seguimiento.datoPedido = faltan[0];
  // El cierre «algo más» no espera un dato de ficha.
  if (esPreguntaAlgoMas(pregunta)) seguimiento.datoPedido = null;
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

function minutosInactividadDeConfig(bot: Record<string, unknown>): number {
  const cierre =
    bot.cierre && typeof bot.cierre === "object" ? (bot.cierre as Record<string, unknown>) : {};
  const n = Number(cierre.minutosInactividad ?? 30);
  if (!Number.isFinite(n)) return 30;
  return Math.max(5, Math.min(24 * 60, Math.round(n)));
}

/**
 * Si el bot habló último y la persona no respondió en X minutos,
 * se despide y cierra la intención.
 */
export async function cerrarPorInactividad(
  conversationId: string,
  opts?: { forzar?: boolean; minutos?: number },
): Promise<boolean> {
  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.status !== "OPEN") return false;
  if (conversation.assigneeKind === "user") return false;
  if (conversation.contact?.isBlocked) return false;

  const messages = await listRecentMessagesByConversation(conversationId, 30);
  const last = messages[messages.length - 1];
  if (!last || last.direction !== "OUTBOUND" || !last.text.trim()) return false;

  const botDoc = await getWhatsappBotConfig();
  const bot = botDoc?.data ?? {};
  const identidad = textoIdentidad(bot);
  const charla = textosCharla(bot, identidad.nombre, new Date());
  // No repetir despedida.
  if (sinTildes(last.text).includes(sinTildes(charla.cierre).slice(0, 40))) return false;

  const minutos = opts?.minutos ?? minutosInactividadDeConfig(bot);
  const edad = Date.now() - Date.parse(last.createdAt);
  if (!opts?.forzar && (!Number.isFinite(edad) || edad < minutos * 60_000)) return false;

  const esperando =
    Boolean(conversation.datoPedido) ||
    Boolean(conversation.intencionAbierta && conversation.intencionConcluida !== true) ||
    esPreguntaAlgoMas(last.text) ||
    /\?/.test(last.text);
  if (!opts?.forzar && !esperando) return false;

  await deliver(conversationId, charla.cierre);
  await setConversationIntencion(conversationId, {
    intencionAbierta: null,
    intencionConcluida: true,
    intencionPropuesta: null,
    intencionCola: [],
    advertenciasFuera: conversation.advertenciasFuera ?? 0,
    derivacionPendiente: false,
    temasAnotados: conversation.temasAnotados ?? [],
    casos: conversation.casos ?? [],
    casoActivoId: null,
    datoPedido: null,
    historialDatos: conversation.historialDatos ?? [],
    pilaTemas: [],
    ultimoResultado: conversation.ultimoResultado ?? null,
    pausa: null,
  });
  return true;
}

/** Barrido de charlas abiertas del bot que quedaron sin respuesta. */
export async function barrerInactividad(): Promise<number> {
  const [pruebas, reales] = await Promise.all([
    listConversations({ status: "OPEN", prueba: true, limit: 40 }),
    listConversations({ status: "OPEN", prueba: false, limit: 40 }),
  ]);
  let cerradas = 0;
  for (const conv of [...pruebas.items, ...reales.items]) {
    if (conv.assigneeKind === "user") continue;
    try {
      if (await cerrarPorInactividad(conv.id)) cerradas += 1;
    } catch (error) {
      console.warn("[whatsapp] cierre por inactividad", conv.id, error);
    }
  }
  return cerradas;
}
