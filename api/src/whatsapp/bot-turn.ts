import { accionPermitida, ejecutarAccion, textoAcciones, type AccionClave } from "./acciones.js";
import { getWhatsappBotConfig } from "./bot-config.js";
import { getWhatsappConocimiento } from "./conocimiento.js";
import {
  fillEmptyContactFields,
  getConversation,
  listRecentMessagesByConversation,
  setConversationAssignee,
  setConversationIntencion,
  setConversationResumen,
  setConversationTags,
  appendConversationAuditoria,
} from "./firestore-store.js";
import { listIntenciones } from "./intenciones.js";
import { getWhatsappMotorConfig } from "./motor-config.js";
import { completeStructured } from "./openai-client.js";
import { listWhatsappTagCatalog } from "./tags.js";
import type { WaAuditoriaPaso } from "./types.js";

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

export function scheduleBotTurn(conversationId: string): void {
  const ticket = (tickets.get(conversationId) ?? 0) + 1;
  tickets.set(conversationId, ticket);
  const previous = timers.get(conversationId);
  if (previous) clearTimeout(previous);
  void waitMs().then((ms) => {
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
    INFO_TRATAMIENTOS: ["consultaPara", "pacienteNombre", "grupoEtario"],
    INFO_PROFESIONALES: ["consultaPara", "pacienteNombre", "grupoEtario"],
    QUEJAS: ["pacienteNombre"],
  };
  const campos = [...(base[clave] ?? [])];
  if (ficha.consultaPara === "tercero") {
    campos.push("relacionFamiliar", "contactoNombre");
  }
  return campos;
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

export type BotTurnIO = {
  now?: () => Date;
  skipUsage?: boolean;
  getConversation?: typeof getConversation;
  listMessages?: typeof listRecentMessagesByConversation;
  fillEmptyContactFields?: typeof fillEmptyContactFields;
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

function textosCharla(bot: Record<string, unknown>, nombre: string): {
  saludo: string;
  pregunta: string;
  cierre: string;
} {
  const inicio =
    bot.inicio && typeof bot.inicio === "object" ? (bot.inicio as Record<string, unknown>) : {};
  const cierre =
    bot.cierre && typeof bot.cierre === "object" ? (bot.cierre as Record<string, unknown>) : {};
  const saludo = (stringField(inicio, "saludo") || "¡Hola! Soy {nombreBot}, asistente virtual de INECO.").replaceAll(
    "{nombreBot}",
    nombre,
  );
  return {
    saludo,
    pregunta: stringField(inicio, "preguntaMotivo"),
    cierre: stringField(cierre, "mensajeDespedida") || "Gracias por comunicarte con INECO. ¡Que tengas un buen día!",
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
function textoEstado(conversation: {
  intencionAbierta?: string | null;
  intencionConcluida?: boolean;
  intencionPropuesta?: string | null;
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
  if (conversation.intencionPropuesta) {
    return `${faseTexto}\nEstado: la intención ${abierta} sigue abierta. Ya preguntamos si la dejan para pasar a ${conversation.intencionPropuesta}.`;
  }
  return `${faseTexto}\nEstado: la intención ${abierta} está abierta y no está concluida.`;
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
    continuarAnterior: { type: "boolean" },
    anteriorConcluida: { type: "boolean" },
    intencionConcluida: { type: "boolean" },
    intencionSecundaria: { type: "string" },
    enConflicto: { type: "boolean" },
    hayPedido: { type: "boolean" },
    cortesia: { type: "string", enum: ["", "saludo", "cierre"] },
    accion: { type: "string" },
    consulta: { type: "string" },
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
    "continuarAnterior",
    "anteriorConcluida",
    "intencionConcluida",
    "intencionSecundaria",
    "enConflicto",
    "hayPedido",
    "cortesia",
    "accion",
    "consulta",
    "datos",
  ],
} as Record<string, unknown>;

const respuestaSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    texto: { type: "string" },
  },
  required: ["texto"],
} as Record<string, unknown>;

export async function runBotTurn(conversationId: string, io?: BotTurnIO): Promise<void> {
  const getConv = io?.getConversation ?? getConversation;
  const listMessages = io?.listMessages ?? listRecentMessagesByConversation;
  const fillContact = io?.fillEmptyContactFields ?? fillEmptyContactFields;
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
  const fase: "inicio" | "en_curso" = lastOutbound >= 0 ? "en_curso" : "inicio";

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
  const charla = textosCharla(bot, identidad.nombre);
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
    continuarAnterior: boolean;
    anteriorConcluida: boolean;
    intencionConcluida: boolean;
    intencionSecundaria: string;
    enConflicto: boolean;
    hayPedido: boolean;
    cortesia: "" | "saludo" | "cierre";
    accion: string;
    consulta: string;
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
      "enConflicto=true solo si los dos pedidos no se pueden hacer juntos, por ejemplo cancelar un turno y sacar otro distinto. Si se pueden responder los dos, false.",
      "hayPedido=false si no hay un pedido concreto: saludo, despedida, o un mensaje del que no se entiende la intención. Un sí, un no, un nombre o un DNI que responde algo nuestro es hayPedido=true.",
      "cortesia=saludo si se presenta, dice hola o pregunta cómo estás, sin otro pedido. cierre si se despide o agradece y no pide nada más. Vacío si no hay cortesía.",
      "No diagnostiques. Un síntoma no confirma una condición.",
      "peligroActual solo si hay peligro en este momento: ideas de muerte o de hacerse daño, síntomas de ACV, dolor de cabeza súbito e intenso, convulsión que no cede, pérdida de conocimiento, confusión grave, dolor de pecho o falta de aire intensa, violencia o riesgo para otros.",
      "dudaSinPeligro=true solo si no hay peligro actual y hace falta una persona: malestar intenso sin un pedido concreto, frases ambiguas sobre la vida o la muerte sin una intención explícita, antecedente de intento o de autolesión, o la crisis de un tercero en curso. false si nombra una condición como motivo o pregunta por un servicio o un precio.",
      "etiquetas: nombres exactos del catálogo, solo las que correspondan. No inventes etiquetas ni diagnósticos.",
      "Si nombra una obra social, prepaga o certificado que está en las etiquetas, poné esa etiqueta. No pongas una cobertura que no nombró.",
      "preguntaAclaracion dejala vacía. La pregunta por datos faltantes la arma el otro paso, solo si el campo no está en la ficha.",
      "datos: completá solo lo que el texto dice y que en la ficha está vacío. Si el campo ya tiene valor, dejalo vacío. No inventes. El teléfono ya viene de WhatsApp: no lo pidas ni lo cambies.",
      "dni: solo dígitos, si la persona lo dijo. email: solo si lo dijo.",
      "sexo=masculino o femenino solo si el texto lo dice. Si no se sabe, vacío.",
      "consultaPara=tercero si escribe por otra persona (por ejemplo \"para mi hijo\"). propio si la consulta es para quien escribe.",
      "relacionFamiliar es quién escribe respecto del paciente: Padre, Madre, Abuelo, Abuela, Hijo, Hija, Tío, Tía, Sobrino, Sobrina, Tutor u Otro. \"Para mi hijo\" significa que escribe un padre o una madre: usá Padre o Madre solo si el texto lo aclara (papá, mamá, padre, madre). Si no se sabe cuál, dejala vacía.",
      "pacienteNombre es el paciente. contactoNombre es quien escribe, cuando no es el paciente.",
      "grupoEtario=infanto si dice una edad menor de 18 o que es un niño. adulto si es un adulto o mayor de 18. Si no hay edad, vacío.",
      "resumen: una frase corta de por dónde venía la charla, actualizando el resumen anterior. No es una transcripción. Ejemplo: Consulta por su hijo. Preguntó por psiquiatría infantojuvenil.",
      "Los mensajes anteriores muestran qué preguntó el bot. Si el lote nuevo responde eso (sí, no, un nombre, un DNI, una edad), continuarAnterior=true y la intención sigue siendo la abierta.",
      "Si el tema es el mismo, continuarAnterior=true. Si cambia de tema, continuarAnterior=false.",
      "anteriorConcluida=true solo si la intención abierta ya quedó resuelta. Si todavía faltaba algo, false: no la cierres sola.",
      "intencionConcluida=true solo si, con este lote, la intención en la que quedamos ya no tiene nada pendiente.",
      "Un saludo, un cómo estás y una despedida no son intenciones: intencion vacía y la cortesía que corresponda.",
      "accion: una de estas claves, o vacío si no hace falta una lista. consulta: el nombre a buscar, sin Dr. ni Dra.",
      textoAcciones(),
      "Intenciones:",
      ...intenciones.map((item) => `- ${item.clave}: ${item.nombre}. ${item.descripcion}`),
      "Etiquetas:",
      catalog.items.map((item) => item.name).join(", "),
    ]
      .filter(Boolean)
      .join("\n"),
    content: [
      identidad.texto,
      ahora,
      estado,
      `Ficha. Vacío significa que todavía no lo tenemos:\n${textoFicha(ficha)}`,
      conversation.resumen ? `Resumen de donde venía: ${conversation.resumen}` : "Resumen de donde venía: (todavía no hay)",
      `Mensajes anteriores:\n${previos}`,
      "Mensajes nuevos de la persona:",
      ...batch.map((message) => message.text.trim()),
    ]
      .filter(Boolean)
      .join("\n"),
    skipUsage: io?.skipUsage === true,
  });
  if (io?.trace) io.trace.terra = detection;

  const contactoActual =
    contact && detection.datos ? await fillContact(contact.id, detection.datos) : contact;
  const fichaActual = fichaDesdeContacto(contactoActual ?? contact);
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
  const conflicto =
    detection.enConflicto === true &&
    Boolean(secundariaPedida) &&
    Boolean(principal) &&
    secundariaPedida?.clave !== principal?.clave;

  let chosen = principal;
  let secundaria = coincidencia ? secundariaPedida : undefined;
  if (sinTema && previaAbierta && detection.cortesia === "") {
    chosen = intenciones.find((item) => item.clave === previa);
  } else if (continuar) {
    chosen = intenciones.find((item) => item.clave === previa) ?? principal;
    if (principal?.clave && principal.clave !== chosen?.clave && !secundaria) secundaria = principal;
  } else if (previaAbierta && detection.anteriorConcluida !== true && principal?.clave && principal.clave !== previa && !conflicto) {
    chosen = intenciones.find((item) => item.clave === previa) ?? principal;
    if (principal.clave !== chosen?.clave && !secundaria) secundaria = principal;
  }
  const estadoSiguiente = {
    intencionAbierta: chosen?.clave ?? null,
    intencionConcluida: conflicto ? false : detection.intencionConcluida === true,
    intencionPropuesta: conflicto ? secundaria?.clave ?? principal?.clave ?? null : null,
  };

  const peligro = motor.seguridad.detectarRiesgos && detection.peligroActual === true;
  const duda = motor.seguridad.detectarRiesgos && !peligro && detection.dudaSinPeligro === true;

  const wantedNames = new Set(
    (Array.isArray(detection.etiquetas) ? detection.etiquetas : [])
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  if (peligro) {
    const urgencia = tagsByName.get("urgencia");
    if (urgencia) wantedNames.add(urgencia.name.toLowerCase());
  }
  if (duda) {
    const derivado = tagsByName.get("derivado a asesor");
    if (derivado) wantedNames.add(derivado.name.toLowerCase());
  }
  if (chosen?.clave === "QUEJAS") {
    const queja = tagsByName.get("queja");
    if (queja) wantedNames.add(queja.name.toLowerCase());
  }

  const nextTagIds = new Set(conversation.tagIds);
  for (const name of wantedNames) {
    const tag = tagsByName.get(name);
    if (tag) nextTagIds.add(tag.id);
  }
  if (nextTagIds.size !== conversation.tagIds.length) {
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
      resumen: (detection.resumen ?? "").trim().slice(0, 240),
      etiquetas: (Array.isArray(detection.etiquetas) ? detection.etiquetas : [])
        .map((name) => name.trim())
        .filter(Boolean),
    });

  if (peligro && riesgo) {
    await saveIntencion(conversationId, {
      intencionAbierta: riesgo.clave,
      intencionConcluida: true,
      intencionPropuesta: null,
    });
    await anotar(riesgo.clave, true);
    await send(conversationId, riesgo.mensajeRiesgo);
    await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
    return;
  }

  if (duda) {
    await saveIntencion(conversationId, {
      intencionAbierta: chosen?.clave ?? (previa || null),
      intencionConcluida: true,
      intencionPropuesta: null,
    });
    await send(
      conversationId,
      "Gracias por escribirnos. Alguien del equipo te va a contactar por este medio. Este canal no es una guardia.",
    );
    await saveAssignee(conversationId, { kind: "user", name: "Equipo" });
    await anotar(chosen?.clave ?? (previa || null), true);
    return;
  }

  if (sinTema && detection.cortesia === "cierre") {
    await saveIntencion(conversationId, {
      intencionAbierta: previa || null,
      intencionConcluida: true,
      intencionPropuesta: null,
    });
    await anotar(previa || null, true);
    await send(conversationId, charla.cierre);
    return;
  }

  if (sinTema && detection.cortesia === "saludo") {
    const saludoSolo =
      fase === "inicio"
        ? [charla.saludo, charla.pregunta].filter(Boolean).join("\n\n")
        : charla.pregunta || "¿En qué puedo ayudarte?";
    await send(conversationId, saludoSolo);
    await anotar(previa || null, conversation.intencionConcluida);
    return;
  }

  if (sinTema && !previaAbierta) {
    const descubrir =
      fase === "inicio"
        ? [charla.saludo, charla.pregunta || "¿En qué puedo ayudarte?"].filter(Boolean).join("\n\n")
        : charla.pregunta || "¿En qué puedo ayudarte?";
    await send(conversationId, descubrir);
    await anotar(previa || null, conversation.intencionConcluida);
    return;
  }

  const accion = conflicto
    ? null
    : accionPermitida(detection.accion?.trim() ?? "", chosen?.clave ?? "");
  const resultadoAccion = accion
    ? await ejecutarAccion(accion.clave as AccionClave, detection.consulta ?? "")
    : "";

  const faltan = faltantesDe(chosen?.clave ?? "", fichaActual);
  if (!conflicto && faltan.length) estadoSiguiente.intencionConcluida = false;
  await anotar(estadoSiguiente.intencionAbierta, estadoSiguiente.intencionConcluida);
  const pedido = faltan[0] ? ETIQUETA_DATO[faltan[0]] ?? faltan[0] : "";
  const chapter = sliceKnowledge(
    conocimiento.text,
    capitulosDe(
      [chosen?.clave ?? "", secundaria?.clave ?? ""].filter(Boolean),
      batch.map((message) => message.text).join("\n"),
    ),
  );
  const objetivo =
    bot.conversacion && typeof bot.conversacion === "object"
      ? stringField(bot.conversacion as Record<string, unknown>, "objetivo")
      : "";
  const estilo =
    bot.conversacion && typeof bot.conversacion === "object"
      ? stringField(bot.conversacion as Record<string, unknown>, "estiloRespuesta")
      : "";
  const reply = await completeStructured<{ texto: string }>({
    conversacionId: conversationId,
    paso: "responder",
    modelo: models.responder,
    reasoningEffort: io?.esfuerzoResponder ?? "none",
    omitirRazonamiento: io?.omitirRazonamiento === true,
    schemaName: "respuesta",
    schema: respuestaSchema,
    onUsage: io?.onUsage,
    instructions: [
      "Redactá un mensaje corto de WhatsApp, en español de Argentina, en texto plano.",
      "Usá solo el texto de la base. No inventes precios, profesionales, coberturas ni direcciones.",
      "Si un dato dice no informado o en confirmación, no lo completes: pedí los datos y decí que el equipo informa.",
      "Si hay dos precios, decí los dos.",
      "Si pregunta por una obra social, prepaga o CUD, respondé con lo que dice Coberturas sobre esa cobertura: condiciones, mail y prestador, si están escritos. Si esa cobertura no está nombrada en Coberturas, decí que depende de la sede, la prestación y el plan, y pasá coberturas@ineco.org.ar. No digas que atienden por una cobertura que el texto no nombra.",
      "No digas que un turno quedó reservado.",
      "No diagnostiques ni des medicación.",
      stringField(plazos, "seInforma") ? `Sí se puede informar: ${stringField(plazos, "seInforma")}` : "",
      stringField(plazos, "noSeInforma") ? `No se informa: ${stringField(plazos, "noSeInforma")}` : "",
      objetivo ? `Objetivo: ${objetivo}` : "",
      estilo ? `Estilo: ${estilo}.` : "",
      fase === "inicio"
        ? `La primera línea es exactamente esta, sin cambiarla: ${charla.saludo}. No agregues "${charla.pregunta}". Después respondé.`
        : "La charla ya empezó. No saludes, no te presentes y no repitas tu nombre.",
      resultadoAccion
        ? "Si hay un resultado de listas, incluilo. Si hay varias coincidencias, nombrálas y no elijas una. Si no hay coincidencia, decí que no está en las listas y que el equipo lo confirma. No inventes horarios."
        : "",
      conflicto
        ? `Hay dos pedidos que no se pueden hacer juntos: ${chosen?.clave ?? ""} y ${secundaria?.clave ?? principal?.clave ?? ""}. Preguntá solo con cuál siguen. No pidas datos y no saludes de nuevo.`
        : secundaria
          ? `Respondé los dos temas: ${chosen?.clave ?? ""} y ${secundaria.clave}. Una sola pregunta en todo el mensaje.`
          : "",
      conflicto
        ? ""
        : pedido
          ? `Para la intención principal falta un solo dato. Después de responder, pedí únicamente: ${pedido}. No pidas ningún dato que ya figure en la ficha.`
          : "La ficha ya tiene los datos que esta intención necesita. No pidas nombre, apellido, DNI, edad ni ningún otro dato.",
      identidad.texto,
      ...instrucciones,
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
      conflicto
        ? `Preguntá solo con cuál siguen: ${chosen?.clave ?? ""} o ${secundaria?.clave ?? principal?.clave ?? ""}.`
        : faltan.length
          ? `Falta para la intención principal: ${faltan.join(", ")}. Pedí solo el primero.`
          : "No falta ningún dato para esta intención.",
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

  const texto = reply.texto.trim();
  if (!texto) return;
  await send(conversationId, texto.slice(0, 1500));
  await saveIntencion(conversationId, estadoSiguiente);
  if (conversation.assigneeKind === "none") {
    await saveAssignee(conversationId, { kind: "bot", name: identidad.nombre });
  }
}
