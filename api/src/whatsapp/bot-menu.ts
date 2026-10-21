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
import {
  botDaTurnos,
  getWhatsappBotConfig,
  TEXTO_TURNO_DATOS_LISTOS,
  TEXTO_TURNO_SIN_ASIGNAR,
} from "./bot-config.js";
import { getWhatsappConocimiento } from "./conocimiento.js";
import {
  createMessage,
  getConversation,
  listRecentMessagesByConversation,
  setConversationAssignee,
  setConversationMenu,
  setConversationTags,
} from "./firestore-store.js";
import { listWhatsappTagCatalog } from "./tags.js";
import type { MenuEstado, MenuPaso, WaConversation, WaMessage } from "./types.js";
import type { SalidaAccion } from "./acciones.js";
import type { WaTagCatalog } from "./tags.js";

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
  { n: "2", clave: "info", titulo: "Información" },
  { n: "3", clave: "tratamientos", titulo: "Tratamientos" },
  { n: "4", clave: "quejas", titulo: "Quejas" },
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
    esPaciente: prev?.esPaciente ?? "",
    profesional: prev?.profesional ?? "",
    tratamiento: prev?.tratamiento ?? "",
    pendiente: prev?.pendiente ?? "",
    opciones: prev?.opciones ?? [],
    horarios: prev?.horarios ?? "",
    hastaDia: prev?.hastaDia ?? 0,
    busqueda: prev?.busqueda ?? "",
    anularLuego: prev?.anularLuego ?? "",
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

function numerar(lineas: string[]): string {
  return lineas.map((linea, index) => `${index + 1}. ${linea}`).join("\n");
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

function listaMenu(): string {
  const lineas = OPCIONES.map((item) => `${item.n}. ${item.titulo}`);
  return `Desde acá puedo ayudarte con:\n\n${lineas.join("\n")}\n\n0. Volver atrás`;
}

function listaTurnos(): string {
  return [
    "¿Qué necesitás con los turnos?",
    "",
    "1. Sacar un turno",
    "2. Ver mis turnos",
    "3. Cancelar un turno",
    "4. Cambiar un turno",
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
  if (/\b(info|informacion)\b/.test(t)) return OPCIONES[1]!;
  if (/\btratamiento/.test(t)) return OPCIONES[2]!;
  if (/\bqueja/.test(t)) return OPCIONES[3]!;
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
  const catalogo = memoria?.catalogo ?? (await listWhatsappTagCatalog());
  const grupoSedes = catalogo.groups.find((group) => sinTildes(group.name) === "sedes");
  const pedidos = nombres.map((nombre) => sinTildes(nombre)).filter(Boolean);
  const elegidas = catalogo.items.filter((item) => pedidos.includes(sinTildes(item.name)));
  let ids = [...(conversation.tagIds ?? [])];
  if (sedeExclusiva && grupoSedes) {
    const sedes = new Set(catalogo.items.filter((item) => item.groupId === grupoSedes.id).map((item) => item.id));
    ids = ids.filter((id) => !sedes.has(id));
  }
  for (const tag of elegidas) {
    if (!ids.includes(tag.id)) ids.push(tag.id);
  }
  const quitar = new Set(
    pedidos.flatMap((nombre) => {
      if (nombre === "paciente") return ["no paciente"];
      if (nombre === "no paciente") return ["paciente"];
      return [];
    }),
  );
  if (quitar.size) {
    ids = ids.filter((id) => {
      const tag = catalogo.items.find((item) => item.id === id);
      return !tag || !quitar.has(sinTildes(tag.name));
    });
  }
  const cambio = ids.length !== (conversation.tagIds ?? []).length || ids.some((id, index) => id !== conversation.tagIds?.[index]);
  if (cambio && !memoria) await setConversationTags(conversation.id, ids);
  conversation.tagIds = ids;
  return elegidas.map((item) => item.name);
}

async function etiquetarSede(conversation: WaConversation, sede: string): Promise<void> {
  await etiquetarNombres(conversation, [sede], true);
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
    return [titulo ? `**${titulo.replace(/^\*\*|\*\*$/g, "")}**` : "", cuerpo].filter(Boolean).join("\n").trim().slice(0, 900);
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
  return (parrafo ?? "").slice(0, 900);
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
  const bot = await getWhatsappBotConfig();
  const data = bot?.data ?? {};
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
  return plantilla.replaceAll("{nombreBot}", nombre).replaceAll("{saludo}", trato(new Date()));
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

function aplicarFicha(estado: MenuEstado, ficha?: {
  pacienteNombre?: string;
  pacienteApellido?: string;
  sexo?: "" | "masculino" | "femenino";
  email?: string;
  esPaciente?: "" | "si" | "no";
  dni?: string;
}): void {
  if (!ficha) return;
  if (ficha.dni) estado.dni = ficha.dni;
  if (ficha.esPaciente) estado.esPaciente = ficha.esPaciente;
  if (!estado.nombre && ficha.pacienteNombre) estado.nombre = ficha.pacienteNombre;
  if (!estado.apellido && ficha.pacienteApellido) estado.apellido = ficha.pacienteApellido;
  if (!estado.email && ficha.email) estado.email = ficha.email;
  if (!estado.sexo && ficha.sexo) estado.sexo = ficha.sexo;
}

async function volverTurnos(
  conversation: WaConversation,
  estado: MenuEstado,
  previo = "",
): Promise<void> {
  const siguiente = vacio("turnos", { ...estado, pendiente: "", opciones: [], anularLuego: "", modo: "" });
  await guardar(conversation.id, siguiente);
  await decir(conversation.id, conversation.contactId, [previo, listaTurnos()].filter(Boolean).join("\n\n"));
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
  await etiquetarNombres(conversation, ["Derivado a asesor", "Pedido de turno"], true);
  await decir(conversation.id, conversation.contactId, TEXTO_TURNO_DATOS_LISTOS);
  await decir(
    conversation.id,
    conversation.contactId,
    "Listo. Alguien del equipo te va a escribir por este medio.",
  );
  if (!memoria) await setConversationAssignee(conversation.id, { kind: "user", name: "Equipo" });
  else {
    memoria.conversation.assigneeKind = "user";
    memoria.conversation.assigneeName = "Equipo";
  }
  await guardar(conversation.id, vacio("menu", estado));
}

async function pedirSiguienteDato(conversation: WaConversation, estado: MenuEstado): Promise<void> {
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
  // Sin dar turnos: con la ficha lista, deriva al equipo (no busca profesional ni horarios).
  if (!(await botMenuDaTurnos()) && (estado.modo === "sacar" || estado.modo === "cambiar")) {
    await cerrarTurnoParaOperador(conversation, estado);
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
  await etiquetarNombres(conversation, [estado.esPaciente === "si" ? "Paciente" : "No paciente"]);
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
      const salida = await accion(conversation, "turnos.delPaciente", `dni ${estado.dni}`, { dni: estado.dni });
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
  const salida = await accion(conversation, "turnos.delPaciente", `dni ${estado.dni}`, { dni: estado.dni });
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
  if (texto.startsWith("Para confirmar")) {
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
  const titulo = estado.modo === "cambiar" ? "Elegí el turno a cambiar" : "Elegí el turno a anular";
  await preguntar(conversation, `${titulo}:\n\n${numerar(futuras)}`);
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
  if (estado.modo === "cancelar") {
    const linea = estado.pendiente.replace(/^futuro:\s*/i, "");
    const salida = await accion(conversation, "turnos.cancelar", linea, {
      dni: estado.dni,
      textoPersona: linea,
    });
    if (!salida) {
      await volverTurnos(
        conversation,
        estado,
        "No pude cancelar ese turno. El sistema no lo pudo registrar.",
      );
      return;
    }
    if (salida.texto.startsWith("Turno cancelado")) {
      await volverTurnos(conversation, estado, salida.texto);
      return;
    }
    await volverTurnos(conversation, estado, mensajeFalloCancelar(salida.texto));
    return;
  }
  estado.anularLuego = estado.pendiente;
  estado.pendiente = "";
  estado.profesional = "";
  estado.tratamiento = "";
  await pedirSiguienteDato(conversation, estado);
}

async function mostrarPaso(conversation: WaConversation, estado: MenuEstado): Promise<void> {
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
  if (estado.paso === "profesional") {
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
      `Elegí el turno con el número:\n\n${numerar(estado.opciones)}\n\n0. Volver atrás`,
    );
    return;
  }
  if (estado.paso === "confirmar") {
    const texto = estado.pendiente.startsWith("futuro:")
      ? `Para confirmar ${estado.modo === "cambiar" ? "el cambio" : "la anulación"}:\n${estado.pendiente}\n\nRespondé sí o no.`
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
      if (!memoria) await setConversationAssignee(conversation.id, { kind: "user", name: "Equipo" });
      else {
        memoria.conversation.assigneeKind = "user";
        memoria.conversation.assigneeName = "Equipo";
      }
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
        .filter((item) => item.groupId === grupo?.id && sinTildes(item.name) !== "con cobertura")
        .map((item) => item.name)
        .slice(0, 18);
      estado.paso = "infoTema";
      estado.opciones = [...nombres, "Otra obra social"];
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
    const nombre = sinTildes(elegida) === "otra obra social" ? "Sin convenio" : elegida;
    await etiquetarNombres(conversation, [nombre]);
    const datos = fragmento(capitulo(conocimiento.text, "Coberturas"), nombre === "Sin convenio" ? texto : nombre);
    estado.paso = "info";
    estado.opciones = [];
    await guardar(conversation.id, estado);
    await decir(
      conversation.id,
      conversation.contactId,
      `${nombre === "Sin convenio" ? "Esa cobertura no tiene convenio con INECO." : `Anoté ${nombre}.`}${datos ? `\n\n${datos}` : ""}\n\n${listaInfo()}`,
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
      await guardar(conversation.id, vacio("menu", estado));
      await decir(conversation.id, conversation.contactId, listaMenu());
      return;
    }
    const modo =
      t === "1" || /\bsacar\b|\bnuevo\b/.test(t)
        ? "sacar"
        : t === "2" || /\b(ver|mis turnos|listar)\b/.test(t)
          ? "ver"
          : t === "3" || /\b(cancel|anul)/.test(t)
            ? "cancelar"
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
    await etiquetarNombres(conversation, ["Pedido de turno", "CABA"], true);
    const puedeDar = await botMenuDaTurnos();
    // Ver y cancelar siempre; sacar/cambiar sin dar turnos = tomar datos + operador.
    if (!puedeDar && (modo === "sacar" || modo === "cambiar")) {
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
    const elegido = indice(texto, estado.opciones.length);
    if (elegido < 0) {
      await preguntar(conversation, noValida(numerar(estado.opciones)));
      return;
    }
    estado.pendiente = estado.opciones[elegido]!;
    estado.paso = "confirmar";
    await guardar(conversation.id, estado);
    const verbo = estado.modo === "cambiar" ? "el cambio" : "la anulación";
    await preguntar(
      conversation,
      `Para confirmar ${verbo}:\n${estado.pendiente}\n\nRespondé sí o no.`,
    );
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
    const enTurnos = Boolean(estado.modo) || ["dni", "horarios", "tratamiento", "profesional", "confirmar", "elegirTurno", "turnos"].includes(estado.paso);
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

async function irAMenuCaba(conversation: WaConversation, previo = ""): Promise<void> {
  await etiquetarSede(conversation, "CABA");
  await guardar(conversation.id, vacio("menu"));
  await decir(
    conversation.id,
    conversation.contactId,
    [previo, `Listo, tu consulta es para CABA.\n\n${listaMenu()}`].filter(Boolean).join("\n\n"),
  );
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
    await irAMenuCaba(conversation);
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
    await guardar(conversation.id, vacio("sede"));
    await decir(conversation.id, conversation.contactId, listaSedes());
    return;
  }
  const opcion = opcionElegida(texto);
  if (!opcion) {
    await decir(conversation.id, conversation.contactId, noValida(listaMenu()));
    return;
  }
  if (opcion.clave === "turnos") {
    await etiquetarNombres(conversation, ["CABA"], true);
    await guardar(conversation.id, vacio("turnos", estado));
    await decir(conversation.id, conversation.contactId, listaTurnos());
    return;
  }
  if (opcion.clave === "info") {
    await guardar(conversation.id, vacio("info", estado));
    await decir(conversation.id, conversation.contactId, listaInfo());
    return;
  }
  if (opcion.clave === "tratamientos") {
    const siguiente = vacio("info", estado);
    siguiente.modo = "tratamientos";
    await responderInfo(conversation, { ...siguiente, paso: "info" }, "4");
    return;
  }
  const siguiente = vacio("queja", estado);
  siguiente.modo = "queja";
  await guardar(conversation.id, siguiente);
  await preguntar(conversation, "Contame qué pasó.");
}
