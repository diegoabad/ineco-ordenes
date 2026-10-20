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
import { getWhatsappBotConfig } from "./bot-config.js";
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

const PIE = "0. Volver atrás\n00. Cancelar el proceso";

function conPie(texto: string): string {
  return `${texto}\n\n${PIE}`;
}

function quiereVolver(texto: string): boolean {
  const t = sinTildes(texto).trim();
  return t === "0" || t === "volver" || t === "atras" || t === "volver atras";
}

function quiereCancelar(texto: string): boolean {
  const t = sinTildes(texto).trim();
  return t === "00" || t === "cancelar el proceso";
}

function mensajeError(error: unknown): string {
  const texto = error instanceof Error ? error.message : "";
  if (!texto || /password|token|https?:\/\//i.test(texto)) {
    return "Hubo un problema con el sistema. Podés reintentar, volver atrás con 0 o cancelar con 00.";
  }
  return `${texto.slice(0, 240)}\n\nPodés reintentar, volver atrás con 0 o cancelar con 00.`;
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

function noValida(lista: string): string {
  return `Esa opción no es válida. Elegí un número de la lista.\n\n${lista}`;
}

function listaSedes(): string {
  return `¿Para qué sucursal es tu consulta?\nRespondé con el número.\n\n${numerar(SEDES)}`;
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
    "00. Cancelar el proceso",
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

function datosDeSede(markdown: string, sede: string): string {
  const texto = capitulo(markdown, "Sedes") || markdown;
  const buscado = sinTildes(sede);
  const trozos = texto.split(/\n(?=#{2,4}\s+)/);
  const bloque = trozos.find((trozo) => sinTildes(trozo).includes(buscado));
  if (bloque && sinTildes(bloque).includes(buscado)) return bloque.trim().slice(0, 900);
  const parrafo = texto
    .split(/\n\s*\n/)
    .map((parte) => parte.trim())
    .find((parte) => sinTildes(parte).includes(buscado));
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
  await decir(conversation.id, conversation.contactId, conPie(texto));
}

async function accion(
  conversation: WaConversation,
  clave: Parameters<typeof ejecutarAccion>[0],
  consulta: string,
  ctx: Parameters<typeof ejecutarAccion>[2],
): Promise<SalidaAccion | null> {
  try {
    return memoria?.accion
      ? await memoria.accion(clave, consulta, ctx)
      : await ejecutarAccion(clave, consulta, ctx);
  } catch (error) {
    await decir(conversation.id, conversation.contactId, mensajeError(error));
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
  await preguntar(conversation, "¿Me pasás el DNI del paciente?");
}

async function pedirSiguienteDato(conversation: WaConversation, estado: MenuEstado): Promise<void> {
  empujar(estado);
  if (!estado.nombre) {
    estado.paso = "nombre";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "¿Cuál es el nombre del paciente?");
    return;
  }
  if (!estado.apellido) {
    estado.paso = "apellido";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "¿Cuál es el apellido?");
    return;
  }
  if (!estado.sexo) {
    estado.paso = "sexo";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "¿El sexo es 1 femenino o 2 masculino?");
    return;
  }
  if (!estado.email) {
    estado.paso = "email";
    await guardar(conversation.id, estado);
    await preguntar(conversation, "¿Cuál es el email?");
    return;
  }
  estado.paso = "profesional";
  estado.opciones = [];
  estado.profesional = "";
  estado.tratamiento = "";
  await guardar(conversation.id, estado);
  await preguntar(
    conversation,
    estado.modo === "cambiar"
      ? "¿Con qué profesional busco el turno nuevo?"
      : "¿Con qué profesional busco el turno?",
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
      if (!salida) return;
      await volverTurnos(conversation, estado, salida.texto);
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
  if (!salida) return;
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

async function ofrecerProfesional(
  conversation: WaConversation,
  estado: MenuEstado,
  texto: string,
): Promise<void> {
  empujar(estado);
  const salida = await accion(conversation, "turnos.listarTratamientos", texto, { textoPersona: texto });
  if (!salida) return;
  const resultado = salida.texto.trim();
  if (resultado.startsWith("Buscás a")) {
    const nombre = resultado.replace(/^Buscás a\s*/i, "").replace(/\.$/, "").trim();
    estado.paso = "confirmar";
    estado.pendiente = nombre;
    await guardar(conversation.id, estado);
    await preguntar(conversation, `¿Buscás a ${nombre}?\nRespondé sí o no.`);
    return;
  }
  const lineas = resultado.split("\n").map((linea) => linea.trim()).filter((linea) => /\(\d+/.test(linea));
  if (lineas.length > 1 || /profesionales con ese nombre|hay más de un/i.test(resultado)) {
    estado.paso = "profesional";
    estado.opciones = lineas;
    await guardar(conversation.id, estado);
    await preguntar(conversation, `Tenemos estos profesionales:\n\n${numerar(lineas)}\n\n¿Cuál buscabas?`);
    return;
  }
  if (resultado.startsWith("Falta el profesional") || !lineas.length) {
    estado.paso = "profesional";
    estado.opciones = [];
    await guardar(conversation.id, estado);
    await preguntar(conversation, "No hay un profesional habilitado con ese nombre. ¿Me decís el nombre y el apellido?");
    return;
  }
  const nombre = lineas[0]!.split("(")[0]?.trim() || texto;
  const tratamientos = lineas[0]!
    .split(":")
    .slice(1)
    .join(":")
    .split(";")
    .map((item) => item.trim().replace(/\s*\([^)]*\)\s*$/, ""))
    .filter(Boolean);
  estado.profesional = nombre;
  estado.opciones = tratamientos;
  estado.paso = "tratamiento";
  estado.pendiente = "";
  await guardar(conversation.id, estado);
  await preguntar(conversation, `Estos son los tratamientos de ${nombre}:\n\n${numerar(tratamientos)}`);
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
  if (!salida) return;
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
  const visibles = lineas.map((linea) => linea.replace(/\s*\([^)]*\)\s*$/, ""));
  await preguntar(
    conversation,
    `Estos son los horarios libres:\n\n${numerar(visibles)}\n\nEscribí el número. Si querés ver más adelante, escribí más adelante.`,
  );
}

async function reservarElegido(
  conversation: WaConversation,
  estado: MenuEstado,
  linea: string,
): Promise<void> {
  const iso = linea.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)/)?.[1] ?? "";
  if (!iso) {
    await preguntar(conversation, noValida(numerar(estado.opciones.map((linea) => linea.replace(/\s*\([^)]*\)\s*$/, "")))));
    return;
  }
  const consulta = `${estado.profesional} ${estado.tratamiento} (${iso})`;
  const salida = await accion(conversation, "turnos.reservar", consulta, ctxDe(estado, conversation.contact?.phoneNumber ?? ""));
  if (!salida) return;
  if (!salida.texto.startsWith("Turno dado")) {
    await decir(conversation.id, conversation.contactId, salida.texto);
    return;
  }
  let extra = "";
  if (estado.anularLuego) {
    const linea = estado.anularLuego.replace(/^futuro:\s*/i, "");
    const cancelado = await accion(conversation, "turnos.cancelar", linea, {
      dni: estado.dni,
      textoPersona: linea,
    });
    if (!cancelado) return;
    extra = cancelado.texto.startsWith("Turno cancelado")
      ? "El turno anterior quedó cancelado."
      : `No pude cancelar el turno anterior. ${cancelado.texto}`;
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
    if (!salida) return;
    await volverTurnos(conversation, estado, salida.texto);
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
    await preguntar(conversation, "¿Me pasás el DNI del paciente?");
    return;
  }
  if (estado.paso === "nombre") {
    await preguntar(conversation, "¿Cuál es el nombre del paciente?");
    return;
  }
  if (estado.paso === "apellido") {
    await preguntar(conversation, "¿Cuál es el apellido?");
    return;
  }
  if (estado.paso === "sexo") {
    await preguntar(conversation, "¿El sexo es 1 femenino o 2 masculino?");
    return;
  }
  if (estado.paso === "email") {
    await preguntar(conversation, "¿Cuál es el email?");
    return;
  }
  if (estado.paso === "profesional") {
    await preguntar(
      conversation,
      estado.opciones.length
        ? `Tenemos estos profesionales:\n\n${numerar(estado.opciones)}\n\n¿Cuál buscabas?`
        : "¿Con qué profesional lo busco?",
    );
    return;
  }
  if (estado.paso === "tratamiento") {
    await preguntar(conversation, `Elegí un número de la lista.\n\n${numerar(estado.opciones)}`);
    return;
  }
  if (estado.paso === "horarios") {
    const visibles = estado.opciones.map((linea) => linea.replace(/\s*\([^)]*\)\s*$/, ""));
    await preguntar(
      conversation,
      visibles.length
        ? `Estos son los horarios libres:\n\n${numerar(visibles)}\n\nEscribí el número o más adelante.`
        : "Escribí más adelante para seguir buscando.",
    );
    return;
  }
  if (estado.paso === "elegirTurno") {
    await preguntar(conversation, `Elegí un número de la lista.\n\n${numerar(estado.opciones)}`);
    return;
  }
  if (estado.paso === "confirmar") {
    const texto = estado.pendiente.startsWith("futuro:")
      ? `Para confirmar ${estado.modo === "cambiar" ? "el cambio" : "la anulación"}:\n${estado.pendiente}\n\nRespondé sí o no.`
      : `¿Buscás a ${estado.pendiente}?\nRespondé sí o no.`;
    await preguntar(conversation, texto);
    return;
  }
  if (estado.paso === "queja") {
    await preguntar(conversation, "Contame qué pasó.");
    return;
  }
  await preguntar(conversation, listaInfo());
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
    "00. Cancelar el proceso",
  ].join("\n");
}

async function responderInfo(conversation: WaConversation, estado: MenuEstado, texto: string): Promise<void> {
  const t = sinTildes(texto).trim();
  if (quiereCancelar(t) || (estado.paso === "info" && (t === "0" || t === "menu"))) {
    await guardar(conversation.id, vacio("menu", estado));
    await decir(
      conversation.id,
      conversation.contactId,
      `${quiereCancelar(t) ? "Cancelé este proceso.\n\n" : ""}${listaMenu()}`,
    );
    return;
  }
  if (quiereVolver(t) && estado.paso !== "info") {
    estado.paso = "info";
    estado.opciones = [];
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
    estado.paso = "info";
    estado.opciones = [];
    await guardar(conversation.id, estado);
    await decir(
      conversation.id,
      conversation.contactId,
      `${datos}\n\n${listaInfo()}`,
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
        await preguntar(conversation, `Esa opción no es válida. ¿Buscás a ${nombre}? Respondé sí o no.`);
        return;
      }
      consulta = nombre;
      estado.pendiente = "";
    }
    const salida = await accion(conversation, "turnos.listarTratamientos", consulta, { textoPersona: consulta });
    if (!salida) return;
    const resultado = salida.texto.trim();
    if (resultado.startsWith("Buscás a")) {
      const nombre = resultado.replace(/^Buscás a\s*/i, "").replace(/\.$/, "").trim();
      estado.pendiente = `confirma:${nombre}`;
      await guardar(conversation.id, estado);
      await preguntar(conversation, `¿Buscás a ${nombre}? Respondé sí o no.`);
      return;
    }
    const lineas = resultado.split("\n").map((linea) => linea.trim()).filter((linea) => /\(\d+/.test(linea));
    if (lineas.length > 1 || /profesionales con ese nombre|hay más de un/i.test(resultado)) {
      estado.opciones = lineas;
      await guardar(conversation.id, estado);
      await preguntar(conversation, `Hay más de un profesional. Elegí un número de la lista.\n\n${numerar(lineas)}`);
      return;
    }
    if (resultado.startsWith("Falta el profesional") || !lineas.length) {
      await preguntar(conversation, "No hay un profesional habilitado con ese nombre. ¿Me decís el nombre y el apellido?");
      return;
    }
    const nombre = (lineas[0]!.split("(")[0] ?? "").trim();
    await etiquetarParecido(conversation, nombre);
    estado.paso = "info";
    estado.opciones = [];
    estado.pendiente = "";
    await guardar(conversation.id, estado);
    await decir(conversation.id, conversation.contactId, `${resultado.slice(0, 900)}\n\n${listaInfo()}`);
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
  if (quiereCancelar(t)) {
    await guardar(conversation.id, vacio("menu"));
    await decir(conversation.id, conversation.contactId, `Cancelé este proceso.\n\n${listaMenu()}`);
    return;
  }
  if (quiereVolver(t) && estado.paso !== "turnos") {
    const previo = estado.pila.pop();
    if (!previo) {
      await volverTurnos(conversation, estado);
      return;
    }
    estado.paso = previo.paso;
    estado.opciones = previo.opciones;
    await guardar(conversation.id, estado);
    await mostrarPaso(conversation, estado);
    return;
  }

  if (estado.paso === "turnos") {
    if (t === "0" || t === "menu") {
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
      await preguntar(conversation, "Eso no parece un documento. Puede ser el DNI, con o sin puntos, o uno de otro país. ¿Me lo pasás de nuevo?");
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
      await preguntar(conversation, noValida("1. Femenino\n2. Masculino"));
      return;
    }
    estado.sexo = sexo;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "email") {
    const email = emailDe(texto);
    if (!email) {
      await preguntar(conversation, "Ese email no es válido. ¿Me lo pasás de nuevo?");
      return;
    }
    estado.email = email;
    await pedirSiguienteDato(conversation, estado);
    return;
  }

  if (estado.paso === "profesional") {
    const elegido = indice(texto, estado.opciones.length);
    if (estado.opciones.length && elegido < 0) {
      await preguntar(conversation, noValida(numerar(estado.opciones)));
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
      await preguntar(conversation, "Dale. ¿Con qué profesional lo busco?");
      return;
    }
    if (!pideAfirmacion(texto)) {
      await preguntar(conversation, `¿Buscás a ${estado.pendiente}? Respondé sí o no.`);
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
    await decir(conversation.id, conversation.contactId, mensajeError(error));
  }
}

async function responderMenu(conversation: WaConversation, estado: MenuEstado, texto: string): Promise<void> {
  if (estado.paso === "sede") {
    const sede = sedeElegida(texto);
    if (!sede) {
      await decir(conversation.id, conversation.contactId, noValida(listaSedes()));
      return;
    }
    await etiquetarSede(conversation, sede);
    if (sinTildes(sede) !== "caba") {
      const datos = await mensajeDeSede(sede);
      await decir(
        conversation.id,
        conversation.contactId,
        `${datos}\n\nSi tu consulta es para CABA, elegila de la lista.\n\n${listaSedes()}`,
      );
      return;
    }
    await guardar(conversation.id, vacio("menu"));
    await decir(conversation.id, conversation.contactId, `Listo, tu consulta es para CABA.\n\n${listaMenu()}`);
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
