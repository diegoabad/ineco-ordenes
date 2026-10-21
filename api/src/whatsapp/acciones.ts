import { getBuscaTurnoConfig } from "../services/db.service.js";
import type { BuscaTurnoConfig, BuscaTurnoPrestacion, BuscaTurnoProfesional } from "../types.js";
import { documentoDePersona } from "./estado-dialogo.js";
import { detalle, medexisPost } from "./medexis-client.js";

export type AccionClave =
  | "profesionales.listarTratamientos"
  | "prestaciones.listarProfesionales"
  | "turnos.listarProfesionales"
  | "turnos.listarTratamientos"
  | "turnos.libres"
  | "turnos.reservar"
  | "turnos.delPaciente"
  | "turnos.cancelar";

export type AccionDef = {
  clave: AccionClave;
  nombre: string;
  intenciones: string[];
};

export type ContextoAccion = {
  dni?: string;
  nombre?: string;
  apellido?: string;
  sexo?: string;
  telefono?: string;
  email?: string;
  /** Día desde el que sigue la búsqueda, si es la misma consulta. */
  desdeDia?: number;
  busqueda?: string;
  /** La persona pidió fechas más adelante. */
  ampliar?: boolean;
  /** Pidió un horario anterior a los que ya tiene. */
  masTemprano?: boolean;
  /** Horarios ya mostrados de esta misma búsqueda. */
  horariosPrevios?: string;
  /** Lo que escribió la persona, sin el nombre que complete el modelo. */
  textoPersona?: string;
};

export type FichaPersona = {
  pacienteNombre?: string;
  pacienteApellido?: string;
  sexo?: "" | "masculino" | "femenino";
  email?: string;
  esPaciente?: "" | "si" | "no";
  dni?: string;
  fechaNacimiento?: string;
};

export type SalidaAccion = {
  texto: string;
  hastaDia?: number;
  busqueda?: string;
  horarios?: string;
  ficha?: FichaPersona;
};

const TURNOS = ["TURNOS", "INFO_PROFESIONALES", "INFO_TRATAMIENTOS"];

export const ACCIONES: AccionDef[] = [
  {
    clave: "turnos.listarProfesionales",
    nombre: "Profesionales que hacen un tratamiento, como en busca turno",
    intenciones: TURNOS,
  },
  {
    clave: "turnos.listarTratamientos",
    nombre: "Tratamientos que hace un profesional, como en busca turno",
    intenciones: TURNOS,
  },
  {
    clave: "turnos.libres",
    nombre: "Próximos turnos libres de un profesional para un tratamiento",
    intenciones: ["TURNOS"],
  },
  {
    clave: "turnos.reservar",
    nombre: "Dar un turno en un horario libre ya elegido",
    intenciones: ["TURNOS"],
  },
  {
    clave: "turnos.delPaciente",
    nombre: "Turnos anteriores y futuros de un paciente",
    intenciones: ["TURNOS"],
  },
  {
    clave: "turnos.cancelar",
    nombre: "Cancelar un turno ya dado, con DNI, profesional y horario",
    intenciones: ["TURNOS"],
  },
  {
    clave: "profesionales.listarTratamientos",
    nombre: "Qué prestaciones hace un profesional",
    intenciones: TURNOS,
  },
  {
    clave: "prestaciones.listarProfesionales",
    nombre: "Qué profesionales hacen una prestación",
    intenciones: TURNOS,
  },
];

const STOP = new Set([
  "dr", "dra", "doctor", "doctora", "el", "la", "los", "las", "de", "del", "con", "por", "para", "una", "uno", "un",
  "quiero", "necesito", "busco", "busca", "buscas", "buscar", "buscaba", "buscabas", "sacar", "sacame", "turno",
  "turnos", "horario", "horarios", "consulta", "online", "presencial", "domicilio", "minuto", "minutos", "sede",
  "primera", "primero", "segunda", "segundo", "vez", "mail", "soy", "femenino", "masculino", "anos", "edad",
  "ineco", "caba", "hijo", "hija",
]);

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return norm(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP.has(token));
}

export function accionPermitida(clave: string, intencion: string): AccionDef | null {
  const found = ACCIONES.find((item) => item.clave === clave);
  if (!found || !found.intenciones.includes(intencion)) return null;
  return found;
}

export function textoAcciones(): string {
  return ACCIONES.map(
    (item) => `- ${item.clave}: ${item.nombre}. Intenciones: ${item.intenciones.join(", ")}.`,
  ).join("\n");
}

function solo(texto: string): SalidaAccion {
  return { texto };
}

export async function consultarPaciente(dni: string): Promise<{ texto: string; ficha: FichaPersona }> {
  return leerPersona(dni.replace(/\D/g, ""));
}

export async function ejecutarAccion(
  clave: AccionClave,
  consulta: string,
  ctx: ContextoAccion = {},
): Promise<SalidaAccion> {
  const config = await getBuscaTurnoConfig();
  if (!config && clave !== "turnos.delPaciente" && clave !== "turnos.reservar" && clave !== "turnos.cancelar") {
    return solo("No hay listas de profesionales ni prestaciones cargadas.");
  }
  const query = tokens(consulta);
  const dicha = textoDelNombre(consulta, ctx.textoPersona ?? "", config);
  if (clave === "profesionales.listarTratamientos" || clave === "turnos.listarTratamientos") {
    if (!config) return solo("No hay listas de profesionales ni prestaciones cargadas.");
    if (!query.length) return solo(listarTratamientos(config));
    const nombrados = profesionalesNombrados(config, dicha);
    const incompleto = textoNombreIncompleto(dicha, nombrados);
    if (incompleto) return solo(incompleto);
    return solo(tratamientosDeProfesional(config, dicha));
  }
  if (clave === "prestaciones.listarProfesionales" || clave === "turnos.listarProfesionales") {
    if (!config) return solo("No hay listas de profesionales ni prestaciones cargadas.");
    if (!query.length) return solo(listarProfesionales(config));
    return solo(profesionalesDePrestacion(config, dicha));
  }
  if (clave === "turnos.libres") return turnosLibres(config, consulta, ctx);
  if (clave === "turnos.reservar") return reservarTurno(config, consulta, ctx);
  if (clave === "turnos.cancelar") return solo(await cancelarTurno(config, consulta, ctx));
  return solo(await turnosDelPaciente(consulta, ctx, config));
}

function sinAcentos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function pideMasFechas(texto: string): boolean {
  return /\b(mas adelante|mas opciones|otras fechas|mas lejos|mas futuro|el mes que viene|los siguientes|busco mas)\b/.test(
    sinAcentos(texto),
  );
}

export function pideMasTemprano(texto: string): boolean {
  return /\b(mas temprano|algo antes|mas cerca|no tenes (algo )?antes|tenes (algo )?antes|hay (algo )?antes|uno anterior|una anterior)\b/.test(
    sinAcentos(texto),
  );
}

/** La pregunta que sigue al resultado. Vacío si el resultado no pide una elección. */
export function preguntaDeResultado(resultado: string, clave = ""): string {
  const texto = resultado.toLowerCase();
  if (!texto.trim()) return "";
  const buscado = resultado.match(/Buscás a ([^\n.]+)/i);
  if (buscado?.[1]) return `¿Con ese nombre te referís a ${buscado[1].trim()}?`;
  if (
    texto.includes("hablar con alguien del equipo") &&
    (texto.includes("seguir buscando") || texto.includes("1.") || texto.includes("qué preferís"))
  ) {
    return "¿Qué preferís?";
  }
  if (texto.includes("tratamiento aproximado") && texto.includes("nombre de un profesional")) {
    return "¿Para qué tratamiento o con qué profesional te ayudo?";
  }
  if (texto.includes("profesionales con ese nombre")) return "¿Cuál buscabas?";
  if (texto.includes("tenemos estos profesionales")) return "¿Cuál de estos profesionales preferís?";
  if (texto.includes("falta el profesional") && !texto.includes("no hay uno habilitado")) {
    return "¿Tenés algún profesional en especial?";
  }
  if (texto.includes("no hay uno habilitado") || texto.includes("no tiene tratamientos habilitados")) {
    return "¿Qué preferís?";
  }
  if (texto.includes("falta el tratamiento") || texto.includes("no hace ese tratamiento")) return "¿Para qué tratamiento?";
  if (texto.includes("estos son los tratamientos") || texto.includes("hay más de un cruce")) return "¿Cuál de estos tratamientos querés?";
  if (texto.includes("falta el horario")) return "¿Cuál de estos horarios querés?";
  if (texto.includes("falta el dni") || texto.includes("falta el horario o el dni")) return "¿Me pasás el DNI?";
  if (texto.includes("falta el email")) return "¿Cuál es el email?";
  if (texto.includes("faltan dni")) return "¿Me pasás el nombre, el apellido y el DNI?";
  if (
    texto.includes("turno dado:") ||
    texto.includes("turno cancelado:") ||
    texto.includes("no hay un turno dado") ||
    texto.includes("no encontré un turno")
  ) {
    return "¿Te puedo ayudar en algo más?";
  }
  if (texto.includes("no es paciente") || texto.includes("hay que pedir nombre")) return "¿Cuál es tu nombre?";
  if (texto.includes("para confirmar la anulación")) return "¿Confirmás que lo anulo?";
  if (texto.includes("para confirmar el cambio")) return "¿Confirmás que lo cambiamos?";
  if (texto.includes("elegí el turno a anular")) return "¿Cuál de estos turnos querés anular?";
  if (texto.includes("elegí el turno a cambiar")) return "¿Cuál de estos turnos querés cambiar?";
  if (texto.includes("cambio confirmado")) return "¿Para qué tratamiento y con qué profesional busco el turno nuevo?";
  if (texto.includes("quedó sin anular") || texto.includes("quedó sin cambios")) {
    return "¿Te puedo ayudar en algo más?";
  }
  if (clave === "turnos.delPaciente" && /\d{4}-\d{2}-\d{2}/.test(resultado)) {
    return "¿Te puedo ayudar en algo más?";
  }
  if (texto.includes("esa opción no está") || texto.includes("ese horario no está")) return "¿Cuál de estas opciones querés?";
  if (texto.includes("no hay turnos libres")) return "¿Busco más adelante?";
  if (texto.includes("puedo buscar más adelante")) return "¿Busco más adelante?";
  if (texto.includes("siguientes turnos libres") || texto.includes("turnos libres")) {
    return "¿Cuál de estos horarios querés?";
  }
  if (/\d{4}-\d{2}-\d{2}/.test(resultado)) return "¿Cuál de estos horarios querés?";
  // Solo preguntar por la lista si el resultado realmente trajo opciones.
  if (clave === "turnos.listarProfesionales" && /tenemos estos profesionales|profesionales para/i.test(resultado)) {
    return "¿Cuál de estos profesionales preferís?";
  }
  if (clave === "turnos.listarTratamientos" && /estos son los tratamientos|tratamientos de/i.test(resultado)) {
    return "¿Para qué tratamiento?";
  }
  return "";
}

/** No sabe / no elige tratamiento. */
export function noSabeTratamiento(texto: string): boolean {
  const t = sinAcentos(texto).replace(/[!¡.?,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (
    /\b(no se|ni idea|no tengo idea|no se cual|no se que|no se el tratamiento|no se para que|no se bien|no tengo claro|no se bien que)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return /^(no|nop|ninguno|ninguna|ni idea)$/.test(t);
}

/** No tiene profesional en especial: listar los de la prestación. */
export function sinPreferenciaProfesional(texto: string): boolean {
  const t = sinAcentos(texto).replace(/[!¡.?,]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (
    /\b(cualquiera|el que sea|el que tengan|no tengo preferencia|sin preferencia|no en especial|en especial|me da igual|indistinto|da igual|el primero que|no conozco|no se de ningun|no tengo (un )?profesional|sin profesional|ningun profesional|no tengo doctor|sin doctor)\b/.test(
      t,
    )
  ) {
    // «en especial» solo cuenta si niega (no / ninguno / sin).
    if (/\ben especial\b/.test(t) && !/\b(no|sin|ningun)/.test(t)) return false;
    return true;
  }
  return /^(no|nop|ninguno|ninguna|cualquiera|me da igual|da igual)$/.test(t);
}

/** Eligió hablar con una persona del equipo. */
export function eligeDerivacionOrientacion(texto: string): boolean {
  const t = sinAcentos(texto).replace(/[!¡.?,]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(2|dos)$/.test(t)) return true;
  return /\b(equipo|humano|persona|asesor|operador|alguien|deriv|hablar con|que me llamen|con una persona)\b/.test(t);
}

/** Eligió seguir buscando opciones solo. */
export function eligeBuscarOrientacion(texto: string): boolean {
  const t = sinAcentos(texto).replace(/[!¡.?,]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(1|uno)$/.test(t)) return true;
  return /\b(buscar|buscando|seguir|opcion|opciones|profesional|tratamiento|yo (lo )?busco|seguimos|continuar)\b/.test(t);
}

export const TEXTO_ORIENTACION_TURNO =
  "Sin problema. Podés:\n1. Seguir buscando acá (un profesional o un tratamiento aproximado)\n2. Hablar con alguien del equipo\n\n¿Qué preferís?";

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function opcionesDe(resultado: string): string[] {
  // Si hay horarios con fecha exacta, esas son las opciones (no los encabezados legibles).
  const conIso = resultado
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(linea))
    .filter((linea) => !/^ClavesISO:/i.test(linea));
  if (conIso.length) return conIso;
  return resultado
    .split("\n")
    .map((linea) => linea.trim())
    .filter(
      (linea) =>
        linea &&
        !linea.endsWith(":") &&
        !/^-\s*\d{1,2}:\d{2}/.test(linea) &&
        !/^(hay más|no elijas|falta el|tenemos estos|busc[aá]s a|para |el (dr|dra|doctor)|además|tengo los siguientes|clavesiso|jueves|lunes|martes|mi[eé]rcoles|viernes|s[aá]bado|domingo)/i.test(
          linea,
        ),
    );
}

/** Si elige «la primera» o un horario de la lista anterior, la consulta queda con esa línea. */
export function completarConsulta(texto: string, consulta: string, previo: string): string {
  const base = consulta.trim();
  if (!previo.trim()) return base;
  const t = sinTildes(texto);
  if (/\bcancel/.test(t) && /turno dado:/i.test(previo)) return `${previo}\n${base}`.trim();
  const opciones = opcionesDe(previo);
  if (!opciones.length) return base;
  let indice = -1;
  if (/\bprimer/.test(t)) indice = 0;
  else if (/\bsegund/.test(t)) indice = 1;
  else if (/\btercer/.test(t)) indice = 2;
  else {
    const hora = texto.match(/\b(\d{1,2}:\d{2})\b/);
    if (hora) indice = opciones.findIndex((linea) => linea.includes(hora[1]!));
  }
  if (indice < 0 || !opciones[indice]) return base;
  // Preferir «Con Profesional — Tratamiento:», no el título del listado legible.
  const encabezado = previo
    .split("\n")
    .map((linea) => linea.trim())
    .find((linea) => /—/.test(linea) && linea.endsWith(":"))
    ?? previo
      .split("\n")
      .map((linea) => linea.trim())
      .find((linea) => linea.endsWith(":") && !/turnos libres|horarios/i.test(linea));
  return [encabezado?.replace(/:$/, "") ?? "", opciones[indice], base].filter(Boolean).join("\n");
}

/** Una elección sobre la lista anterior define la acción, si el modelo no la puso. */
export function accionPorEleccion(texto: string, consulta: string, previo: string): string {
  const t = sinTildes(texto);
  if (!previo.trim()) return "";
  if (/\bcancel/.test(t) && /turno dado:|futuro:/i.test(previo)) return "turnos.cancelar";
  const elige = /\bprimer[ao]?\b|\bsegund[ao]\b|\btercer[ao]?\b|\b(ese horario|esa consulta|esa opcion)\b/.test(t);
  if (!elige) return "";
  if (horaPedida(consulta) && !/turno dado:/i.test(previo)) return "turnos.reservar";
  if (
    /hay más de un cruce|estos son los tratamientos|profesionales con ese nombre|tenemos estos profesionales/i.test(
      previo,
    )
  ) {
    return "turnos.libres";
  }
  // «la primera» sobre una lista de horarios.
  if (/\(\d{4}-\d{2}-\d{2}/.test(previo)) return "turnos.reservar";
  return "";
}

export function pideAfirmacion(texto: string): boolean {
  const t = sinTildes(texto).trim();
  if (/^(no|nop|mejor no|dejalo|deja)\b/.test(t)) return false;
  return /^(si|sisi|dale|ok|bueno|confirmo|de acuerdo|anula|anulalo|cambialo|hacelo)\b/.test(t);
}

export function pideNegacion(texto: string): boolean {
  return /^(no|nop|mejor no|dejalo|deja)\b/.test(sinTildes(texto).trim());
}

export function turnosFuturosDe(texto: string): string[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => /^futuro:/i.test(linea));
}

/** El turno que la persona ya nombró dentro de una lista. Vacío si no alcanza para elegir uno. */
export function turnoNombrado(texto: string, lista: string): string {
  const futuras = turnosFuturosDe(lista);
  if (!futuras.length) return "";
  const t = sinTildes(texto);
  if (/\bprimer/.test(t)) return futuras[0] ?? "";
  if (/\bsegund/.test(t)) return futuras[1] ?? "";
  if (/\btercer/.test(t)) return futuras[2] ?? "";
  const cuando = horaPedida(texto);
  if (cuando) {
    const porHora = futuras.find((linea) => horaPedida(linea)?.slice(0, 16) === cuando.slice(0, 16));
    if (porHora) return porHora;
  }
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const fechaDicha = t.match(new RegExp(`\\b(\\d{1,2}) de (${meses.join("|")})\\b`));
  if (fechaDicha) {
    const dia = fechaDicha[1]!.padStart(2, "0");
    const mes = String(meses.indexOf(fechaDicha[2]!) + 1).padStart(2, "0");
    const hora = texto.match(/\b(\d{1,2}):(\d{2})\b/);
    const hhmm = hora ? `${hora[1]!.padStart(2, "0")}:${hora[2]}` : "";
    const porFecha = futuras.filter((linea) => {
      const iso = linea.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (iso?.[2] !== mes || iso?.[3] !== dia) return false;
      return !hhmm || linea.includes(hhmm);
    });
    if (porFecha.length === 1) return porFecha[0]!;
  }
  const dichos = tokens(texto).filter((token) => token.length >= 4);
  const porNombre = futuras.filter((linea) => dichos.some((token) => sinTildes(linea).includes(token)));
  if (porNombre.length === 1) return porNombre[0]!;
  if (/\b(ese|esa|el unico|la unica)\b/.test(t) && futuras.length === 1) return futuras[0]!;
  return "";
}

export function textoDeTurnosPropios(modo: "anular" | "cambiar", listado: string, consulta: string): string {
  const futuras = turnosFuturosDe(listado);
  if (!futuras.length) return /^anterior:/im.test(listado) ? "No hay turnos futuros para anular." : listado;
  const elegido = turnoNombrado(consulta, listado);
  const verbo = modo === "cambiar" ? "el cambio" : "la anulación";
  if (elegido || futuras.length === 1) return `Para confirmar ${verbo}:\n${elegido || futuras[0]}`;
  const titulo = modo === "cambiar" ? "Elegí el turno a cambiar" : "Elegí el turno a anular";
  return `${titulo}:\n${futuras.join("\n")}`;
}

export function opcionesOmitidas(respuesta: string, resultado: string): string {
  const texto = norm(respuesta);
  // No reinyectar listados crudos de profesionales/códigos: el modelo ya tiene el resultado.
  if (/falta el profesional|falta el tratamiento|busc[aá]s a |estos son los tratamientos/i.test(resultado)) {
    return "";
  }
  // Los horarios se reinyectan legibles vía horariosOmitidos / formatearHorariosAgrupados.
  if (/siguientes turnos libres|clavesiso:|\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}/i.test(resultado)) {
    return "";
  }
  return resultado
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.includes("—") && !/\(\d{4}-\d{2}-\d{2}/.test(linea))
    .filter((linea) => {
      const firma = norm(linea).replace(/\d+/g, "").replace(/\s+/g, " ").trim();
      return firma.length >= 8 && !texto.includes(firma);
    })
    .join("\n");
}

export function reservaRepetida(consulta: string, previo: string): boolean {
  if (!/turno dado:/i.test(previo)) return false;
  const pedido = horaPedida(consulta);
  const dado = horaPedida(previo);
  return Boolean(pedido && dado) && pedido.slice(0, 16) === dado.slice(0, 16);
}

function tratamientosDeProfesional(config: BuscaTurnoConfig, consulta: string): string {
  const profesionales = profesionalesNombrados(config, consulta);
  if (!profesionales.length) {
    return "Falta el profesional. No hay uno habilitado con ese nombre.";
  }
  const filtro = tokens(consulta).filter((token) => token.length >= 5);
  const nombres: string[] = [];
  for (const profesional of profesionales.slice(0, 3)) {
    const prestaciones = Object.entries(config.prestaciones)
      .filter(([, prestacion]) => prestacion.enabled !== false)
      .filter(([, prestacion]) =>
        (prestacion.profesionales ?? []).some((item) => String(item.doc) === String(profesional.doc)),
      )
      .filter(([, prestacion]) => {
        if (!filtro.length) return true;
        const nombre = norm(prestacion.nombre || "");
        // Si el mensaje nombró un tipo (psiquiatría, etc.), priorizar esas.
        return filtro.some((token) => nombre.includes(token));
      });
    const elegidas = (prestaciones.length ? prestaciones : Object.entries(config.prestaciones)
      .filter(([, prestacion]) => prestacion.enabled !== false)
      .filter(([, prestacion]) =>
        (prestacion.profesionales ?? []).some((item) => String(item.doc) === String(profesional.doc)),
      )).slice(0, 12);
    for (const [codigo, prestacion] of elegidas) {
      const nombre = (prestacion.nombre || codigo).trim();
      const linea = `${nombre} (${codigo})`;
      if (nombre && !nombres.includes(linea)) nombres.push(linea);
    }
  }
  if (!nombres.length) return "Ese profesional no tiene tratamientos habilitados en busca turno.";
  const quien = profesionales[0]?.nombre?.trim() || "ese profesional";
  // El nombre va en el encabezado para no perderlo cuando eligen «la primera».
  return `Estos son los tratamientos de ${quien}:\n${nombres.join("\n")}`;
}

function profesionalesDePrestacion(config: BuscaTurnoConfig, consulta: string): string {
  const prestaciones = prestacionesDichas(config, consulta);
  if (!prestaciones.length) {
    return "No hay una prestación habilitada que coincida con lo que pidió.";
  }
  const vistos = new Set<string>();
  const nombres: string[] = [];
  for (const [, prestacion] of prestaciones) {
    for (const item of prestacion.profesionales ?? []) {
      const doc = String(item.doc);
      if (vistos.has(doc)) continue;
      // Solo profesionales habilitados en busca turno.
      const habilitado = habilitados(config).some((p) => String(p.doc) === doc);
      if (!habilitado) continue;
      vistos.add(doc);
      nombres.push(item.nombre || doc);
    }
  }
  if (!nombres.length) return "No hay un profesional habilitado para esa consulta.";
  const extra = nombres.length > 12 ? `\nHay ${nombres.length - 12} más.` : "";
  return `Tenemos estos profesionales para esa consulta.\n${nombres.slice(0, 12).join("\n")}${extra}`;
}

function habilitados(config: BuscaTurnoConfig): BuscaTurnoProfesional[] {
  return config.profesionales.filter((item) => item.enabled !== false);
}

function listarProfesionales(config: BuscaTurnoConfig): string {
  const lista = habilitados(config).slice(0, 20);
  if (!lista.length) return "No hay profesionales habilitados.";
  return lista.map((item) => `${item.nombre} (${item.doc})`).join("\n");
}

function listarTratamientos(config: BuscaTurnoConfig): string {
  const lista = Object.entries(config.prestaciones)
    .filter(([, item]) => item.enabled !== false)
    .slice(0, 20);
  if (!lista.length) return "No hay tratamientos habilitados.";
  return lista.map(([codigo, item]) => `${item.nombre || codigo} (${codigo})`).join("\n");
}

function tienePalabra(texto: string, token: string): boolean {
  return new RegExp(`(?:^|\\s)${token}(?:\\s|$)`).test(norm(texto));
}

function tokensDeNombre(nombre: string): string[] {
  return tokens(nombre).filter((token) => token.length >= 3);
}

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const fila = Array.from({ length: b.length + 1 }, (_, indice) => indice);
  for (let i = 1; i <= a.length; i += 1) {
    let previo = fila[0]!;
    fila[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const actual = fila[j]!;
      fila[j] = a[i - 1] === b[j - 1] ? previo : Math.min(previo, fila[j]!, fila[j - 1]!) + 1;
      previo = actual;
    }
  }
  return fila[b.length]!;
}

function topeParecido(token: string): number {
  if (token.length >= 8) return 2;
  if (token.length >= 5) return 1;
  return 0;
}

function tokenParecido(token: string, candidato: string): boolean {
  if (token === candidato) return true;
  // «marcelocetkovich» pegado: el apellido o el nombre van adentro del token.
  if (token.length >= 8 && candidato.length >= 4 && token.includes(candidato)) return true;
  if (candidato.length >= 8 && token.length >= 4 && candidato.includes(token)) return true;
  const tope = topeParecido(token);
  if (!tope || Math.abs(token.length - candidato.length) > tope) return false;
  return distancia(token, candidato) <= tope;
}

function profesionalesNombrados(config: BuscaTurnoConfig, consulta: string, persona = ""): BuscaTurnoProfesional[] {
  const lista = habilitados(config);
  const deAlguien = new Set(lista.flatMap((item) => tokensDeNombre(item.nombre)));
  const deTratamiento = new Set(
    Object.entries(config.prestaciones).flatMap(([codigo, item]) => tokens(`${item.nombre} ${codigo}`)),
  );
  const pedidosDe = (origen: string) =>
    tokens(origen).filter(
      (token) =>
        token.length >= 3 &&
        !/^\d+$/.test(token) &&
        !deTratamiento.has(token) &&
        // Solo tokens que parecen parte de un nombre de profesional (ignora Ana/Pérez del paciente, etc.).
        [...deAlguien].some((nombre) => tokenParecido(token, nombre)),
    );
  // «sí» u otras respuestas cortas no son un nombre: usar la consulta (p. ej. Buscás a CETKOVICH…).
  const pedidosPersona = persona.trim() ? pedidosDe(persona) : [];
  const pedidos = pedidosPersona.length ? pedidosPersona : pedidosDe(consulta);
  if (!pedidos.length) return [];

  // Puntúa por tokens que matchean: un apellido largo gana a un nombre corto del paciente.
  const puntuados = lista
    .map((item) => {
      const propios = tokensDeNombre(item.nombre);
      let puntos = 0;
      let hits = 0;
      for (const token of pedidos) {
        const exacto = propios.includes(token);
        const cerca = propios.some((nombre) => tokenParecido(token, nombre));
        if (!exacto && !cerca) continue;
        hits += 1;
        puntos += exacto ? token.length * 2 : token.length;
      }
      return { item, hits, puntos };
    })
    .filter((row) => row.hits > 0);
  if (!puntuados.length) return [];
  const mejor = Math.max(...puntuados.map((row) => row.puntos));
  const finalistas = puntuados.filter((row) => row.puntos === mejor).map((row) => row.item);
  // Si el mensaje trae nombre+apellido de un solo profesional, priorizá ese.
  if (pedidos.length >= 2 && finalistas.length > 1) {
    const conTodos = finalistas.filter((item) => {
      const propios = tokensDeNombre(item.nombre);
      return pedidos.every((token) => propios.some((nombre) => tokenParecido(token, nombre)));
    });
    if (conTodos.length) return conTodos;
  }
  return finalistas;
}

function textoDelNombre(consulta: string, persona: string, config: BuscaTurnoConfig | null): string {
  if (!config) return consulta;
  const nombres = new Set(habilitados(config).flatMap((item) => tokensDeNombre(item.nombre)));
  const dijoNombre = tokens(persona).some((token) => [...nombres].some((nombre) => tokenParecido(token, nombre)));
  return dijoNombre ? persona : consulta;
}

function textoNombreIncompleto(consulta: string, profesionales: BuscaTurnoProfesional[]): string {
  const pedidos = tokens(consulta).filter((token) =>
    profesionales.some((item) => tienePalabra(item.nombre, token) || tokensDeNombre(item.nombre).some((n) => tokenParecido(token, n))),
  );
  if (!profesionales.length) return "";
  if (profesionales.length > 1) {
    const lista = profesionales
      .slice(0, 12)
      .map((item) => `${item.nombre} (${item.doc})`)
      .join("\n");
    const extra = profesionales.length > 12 ? `\nHay ${profesionales.length - 12} más.` : "";
    return `Tenemos estos profesionales con ese nombre o apellido.\n${lista}${extra}`;
  }
  if (pedidos.length >= 2) return "";
  const unico = profesionales[0]!;
  const propios = tokensDeNombre(unico.nombre);
  if (propios.length < 2) return "";
  // En Medexis el formato es APELLIDO NOMBRES: si ya dijo el apellido, no hace falta confirmar.
  const apellido = propios[0]!;
  const dijoApellido = pedidos.some((token) => tokenParecido(token, apellido) || apellido.startsWith(token));
  if (dijoApellido) return "";
  return `Buscás a ${unico.nombre}.`;
}

function prestacionesDichas(config: BuscaTurnoConfig, consulta: string): [string, BuscaTurnoPrestacion][] {
  // Si ya eligió un código concreto, usar el de la última línea con (código):
  // la consulta suele traer toda la lista previa + la opción elegida al final.
  let codigoElegido = "";
  for (const linea of consulta.split("\n").map((item) => item.trim()).reverse()) {
    const m = linea.match(/\((\d{3,})\)\s*$/);
    if (m?.[1]) {
      codigoElegido = m[1];
      break;
    }
  }
  if (codigoElegido) {
    const prestacion = config.prestaciones[codigoElegido];
    if (prestacion && prestacion.enabled !== false) return [[codigoElegido, prestacion]];
  }

  const dichos = tokens(consulta).filter((token) => token.length >= 4 && !/^\d+$/.test(token));
  return Object.entries(config.prestaciones).filter(([codigo, item]) => {
    if (item.enabled === false) return false;
    const nombre = norm(`${item.nombre} ${codigo}`);
    return dichos.some((token) => tienePalabra(nombre, token) || nombre.includes(token));
  });
}

function parDeConsulta(
  config: BuscaTurnoConfig,
  consulta: string,
  persona = "",
): { codigo: string; prestacion: BuscaTurnoPrestacion; profesional: BuscaTurnoProfesional } | string {
  const profesionales = profesionalesNombrados(config, consulta, persona);
  const incompleto = textoNombreIncompleto(consulta, profesionales);
  if (incompleto) return incompleto;
  const prestaciones = prestacionesDichas(config, consulta);
  if (!profesionales.length) return "Falta el profesional. No hay uno habilitado con ese nombre.";
  if (!prestaciones.length) return "Falta el tratamiento.";
  const pares = prestaciones.flatMap(([codigo, prestacion]) =>
    profesionales
      .filter((profesional) =>
        (prestacion.profesionales ?? []).some((item) => String(item.doc) === String(profesional.doc)),
      )
      .map((profesional) => ({ codigo, prestacion, profesional })),
  );
  if (!pares.length) return "Ese profesional no hace ese tratamiento en busca turno.";
  if (pares.length > 1) {
    const mismos = new Set(pares.map((par) => String(par.profesional.doc))).size === 1;
    if (mismos) {
      const quien = pares[0]!.profesional.nombre;
      const tratamientos = [...new Set(pares.map((par) => `${par.prestacion.nombre || par.codigo} (${par.codigo})`))];
      return `Estos son los tratamientos de ${quien}:\n${tratamientos.slice(0, 12).join("\n")}`;
    }
    return `Hay más de un cruce. No elijas uno.\n${pares
      .slice(0, 8)
      .map((par) => `${par.profesional.nombre} (${par.profesional.doc}) — ${par.prestacion.nombre || par.codigo}`)
      .join("\n")}`;
  }
  return pares[0]!;
}

function fechaBa(dias: number): string {
  const fecha = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(fecha);
}

function esCaba(sede: string): boolean {
  const texto = norm(sede);
  if (!texto) return true;
  return texto.includes("caba") || texto === "ineco" || texto.includes("central") || texto.includes("recoleta");
}

function horaLocal(cuando: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(cuando);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "00";
  return `${valor("year")}-${valor("month")}-${valor("day")} ${valor("hour")}:${valor("minute")}:${valor("second")}`;
}

const BLOQUE = 20;
const TOPE_DIAS = 120;

/** Igual que Busca Turno: Medexis no filtra la modalidad en Disponible. Virtual es el edificio. */
export function esSlotVirtual(row: Record<string, unknown>): boolean {
  const edificio = String(row.edificio ?? row.Edificio ?? "");
  return /video\s*-?\s*consulta\s*medexis/i.test(edificio);
}

export function modalidadDePrestacion(nombre: string): "virtual" | "presencial" {
  const texto = norm(nombre);
  if (/\bonline\b|\bvirtual\b|\bvideoconsulta\b|\bvideo consulta\b/.test(texto)) return "virtual";
  return "presencial";
}

async function diasLibres(
  par: { codigo: string; prestacion: BuscaTurnoPrestacion; profesional: BuscaTurnoProfesional },
  desde: number,
  hasta: number,
): Promise<{ cuando: Date; texto: string }[]> {
  const modalidad = modalidadDePrestacion(par.prestacion.nombre || par.codigo);
  const vistos = new Set<string>();
  const libres: { cuando: Date; texto: string }[] = [];
  const listas = await Promise.all(
    Array.from({ length: Math.max(0, hasta - desde) }, (_, indice) => desde + indice).map(async (dia) => {
      try {
        const data = await medexisPost("api/Turno/Disponible", {
          body: {
            prestacionCodigo: par.codigo,
            profesionalDocumentos: [String(par.profesional.doc)],
            modalidad: "PRESENCIAL",
            filtros: {
              fechaDesde: fechaBa(dia),
              fechaHasta: fechaBa(dia + 1),
              turnoEstado: "D",
              modalidad: "PRESENCIAL",
            },
            limite: 20,
          },
        });
        if (Array.isArray(data)) return data;
        const row = data as { Turnos?: unknown[]; turnos?: unknown[] };
        return row.Turnos ?? row.turnos ?? [];
      } catch {
        return [];
      }
    }),
  );
  for (const lista of listas) {
    for (const item of lista) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const virtual = esSlotVirtual(row);
      if (modalidad === "virtual" ? !virtual : virtual) continue;
      const crudo = String(row.turnoFechaHora || row.TurnoFechaHora || "");
      const cuando = new Date(crudo);
      if (!crudo || Number.isNaN(cuando.getTime()) || vistos.has(crudo)) continue;
      vistos.add(crudo);
      const hora = new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(cuando);
      const modo = virtual ? "virtual" : "presencial";
      libres.push({ cuando, texto: `${hora}, ${modo} (${horaLocal(cuando)})` });
    }
  }
  libres.sort((a, b) => a.cuando.getTime() - b.cuando.getTime());
  return libres;
}

function sexoPersona(valor: string): "" | "masculino" | "femenino" {
  const texto = norm(valor);
  if (texto.startsWith("f")) return "femenino";
  if (texto.startsWith("m")) return "masculino";
  return "";
}

async function leerPersona(dni: string): Promise<{ texto: string; ficha: FichaPersona }> {
  const ficha: FichaPersona = { dni, esPaciente: "no" };
  try {
    const data = await medexisPost("api/Persona", { query: { Documento: dni } });
    const fila = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const documento = String(fila?.PersonaDocumento ?? fila?.personaDocumento ?? "").replace(/\D/g, "");
    if (!fila || !documento) {
      return {
        texto: "No es paciente de INECO. Hay que pedir nombre, apellido, sexo y email.",
        ficha,
      };
    }
    const nombre = String(fila.PersonaNombre ?? fila.personaNombre ?? "").trim();
    const apellido = String(fila.PersonaApellido ?? fila.personaApellido ?? "").trim();
    const email = String(fila.PersonaEmail ?? fila.personaEmail ?? "").trim();
    const sexo = sexoPersona(String(fila.PersonaSexo ?? fila.personaSexo ?? ""));
    const nacimiento = String(fila.PersonaFechaNacimiento ?? fila.personaFechaNacimiento ?? "").slice(0, 10);
    ficha.esPaciente = "si";
    if (nombre) ficha.pacienteNombre = nombre;
    if (apellido) ficha.pacienteApellido = apellido;
    if (email) ficha.email = email;
    if (sexo) ficha.sexo = sexo;
    if (nacimiento) ficha.fechaNacimiento = nacimiento;
    const partes = [`Es paciente: ${[nombre, apellido].filter(Boolean).join(" ")}.`.trim()];
    if (email) partes.push(`Email ${email}.`);
    if (sexo) partes.push(`Sexo ${sexo}.`);
    if (!email) partes.push("Falta el email.");
    return { texto: partes.join(" "), ficha };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "";
    if (/no existe/i.test(mensaje)) {
      return {
        texto: "No es paciente de INECO. Hay que pedir nombre, apellido, sexo y email.",
        ficha,
      };
    }
    return {
      texto: "No pude revisar si ya es paciente. Hay que pedir nombre, apellido, sexo y email.",
      ficha: { dni },
    };
  }
}

function parGuardado(
  config: BuscaTurnoConfig,
  busqueda: string,
): { codigo: string; prestacion: BuscaTurnoPrestacion; profesional: BuscaTurnoProfesional } | null {
  const [doc, codigo] = busqueda.split("|");
  if (!doc || !codigo) return null;
  const profesional = habilitados(config).find((item) => String(item.doc) === doc);
  const prestacion = config.prestaciones[codigo];
  if (!profesional || !prestacion || prestacion.enabled === false) return null;
  return { codigo, prestacion, profesional };
}

export function horariosOmitidos(respuesta: string, guardados: string): string {
  const dichos = new Set(lineasHorario(respuesta).map(claveHorario));
  // Si la respuesta ya armó el listado legible, no reinyectar.
  if (/siguientes turnos libres|tengo estos turnos|horarios libres:/i.test(respuesta)) return "";
  const faltan = lineasHorario(guardados).filter((linea) => !dichos.has(claveHorario(linea)));
  if (!faltan.length) return "";
  return formatearHorariosAgrupados(faltan);
}

/** Lista legible agrupada por día, para WhatsApp. */
export function formatearHorariosAgrupados(lineas: string[]): string {
  const slots: { claveDia: string; etiqueta: string; hora: string }[] = [];
  for (const linea of lineas) {
    const m = linea.match(/\((\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::\d{2})?\)/);
    if (!m) continue;
    const [, y, mes, dia, hh, mm] = m;
    const claveDia = `${y}-${mes}-${dia}`;
    const cuando = new Date(`${claveDia}T12:00:00-03:00`);
    const weekday = new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(cuando);
    const mesNombre = new Intl.DateTimeFormat("es-AR", {
      month: "long",
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(cuando);
    const etiqueta = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${dia} de ${mesNombre}`;
    slots.push({ claveDia, etiqueta, hora: `${hh}:${mm}` });
  }
  if (!slots.length) return "";
  const bloques: string[] = ["Tengo los siguientes turnos libres:"];
  let diaActual = "";
  for (const slot of slots) {
    if (slot.claveDia !== diaActual) {
      diaActual = slot.claveDia;
      bloques.push("", slot.etiqueta);
    }
    bloques.push(`- ${slot.hora}`);
  }
  return bloques.join("\n");
}

function textoConHorarios(persona: string, aviso: string, lineas: string[]): string {
  // Solo texto legible acá. Las fechas exactas viven en SalidaAccion.horarios.
  const humano = formatearHorariosAgrupados(lineas);
  const cuerpo = humano || lineas.join("\n");
  return [persona, aviso, cuerpo].filter(Boolean).join("\n");
}

async function turnosLibres(
  config: BuscaTurnoConfig | null,
  consulta: string,
  ctx: ContextoAccion,
): Promise<SalidaAccion> {
  if (!config) return solo("No hay listas de profesionales ni prestaciones cargadas.");
  const guardado =
    ctx.busqueda && (ctx.ampliar || ctx.masTemprano) ? parGuardado(config, ctx.busqueda) : null;
  const textoNombre = textoDelNombre(consulta, ctx.textoPersona ?? "", config);
  const par = guardado ?? parDeConsulta(config, textoNombre, ctx.textoPersona ?? "");
  if (typeof par === "string") {
    if (par.startsWith("Falta el profesional")) {
      if (/no hay uno habilitado/i.test(par)) {
        return solo(`${par}\n${TEXTO_ORIENTACION_TURNO}`);
      }
      const sugeridos = profesionalesDePrestacion(config, consulta);
      // Si no mencionó un tratamiento, no mezclar "sin prestación" con "sin profesional".
      if (sugeridos.startsWith("No hay una prestación")) return solo(`${par}\n${TEXTO_ORIENTACION_TURNO}`);
      return solo(`${par}\n${sugeridos}`);
    }
    if (par.startsWith("Falta el tratamiento") || par.startsWith("Ese profesional no hace")) {
      const lista = tratamientosDeProfesional(config, consulta);
      if (lista.startsWith("Estos son los tratamientos")) return solo(lista);
      return solo(`${par}\n${lista}\n${TEXTO_ORIENTACION_TURNO}`);
    }
    return solo(par);
  }
  const busqueda = `${par.profesional.doc}|${par.codigo}`;
  if (!esCaba(par.profesional.sede)) {
    return solo(`${par.profesional.nombre} figura en ${par.profesional.sede}. Por este canal los turnos libres son los de CABA.`);
  }
  const dni = dniDicho(consulta, ctx.dni || "");
  const pareja = `${par.profesional.nombre} — ${par.prestacion.nombre || par.codigo} (${par.codigo})`;
  // Mostrar turnos libres sin exigir DNI; el DNI se pide al reservar.
  const persona = dni ? await leerPersona(dni) : { texto: "", ficha: undefined };
  const misma = ctx.busqueda === busqueda;
  const desde = misma ? Math.max(0, ctx.desdeDia ?? 0) : 0;
  const previas = misma ? lineasHorario(ctx.horariosPrevios ?? "") : [];
  if (ctx.masTemprano && (previas.length > 0 || desde > 0)) {
    const lista = previas.join("\n");
    return {
      texto: lista
        ? textoConHorarios(
            persona.texto,
            "Antes de estas fechas no hay otros turnos libres. Estos son los que ya tenía:",
            previas,
          )
        : [persona.texto, `Antes de estas fechas no hay turnos libres de ${pareja}.`].filter(Boolean).join("\n"),
      hastaDia: desde,
      busqueda,
      horarios: lista,
      ficha: persona.ficha,
    };
  }
  if (desde >= TOPE_DIAS) {
    const lista = previas.join("\n");
    return {
      texto: lista
        ? textoConHorarios(
            persona.texto,
            `Ya busqué hasta el ${fechaBa(TOPE_DIAS - 1)}. Siguen estos horarios:`,
            previas,
          )
        : [persona.texto, `Ya busqué hasta el ${fechaBa(TOPE_DIAS - 1)}. No hay turnos libres de ${pareja}.`]
            .filter(Boolean)
            .join("\n"),
      hastaDia: desde,
      busqueda,
      horarios: lista,
      ficha: persona.ficha,
    };
  }
  let hasta = desde;
  let nuevos: { cuando: Date; texto: string }[] = [];
  while (hasta < TOPE_DIAS && nuevos.length === 0) {
    const fin = Math.min(hasta + BLOQUE, TOPE_DIAS);
    nuevos = await diasLibres(par, hasta, fin);
    hasta = fin;
  }
  const juntos = unirHorarios(
    previas,
    nuevos.slice(0, 8).map((item) => item.texto),
  );
  const lista = juntos.join("\n");
  const periodo = `entre el ${fechaBa(desde)} y el ${fechaBa(Math.max(desde, hasta - 1))}`;
  if (!juntos.length) {
    return {
      texto: [persona.texto, `No hay turnos libres de ${pareja} ${periodo}.`, TEXTO_ORIENTACION_TURNO]
        .filter(Boolean)
        .join("\n"),
      hastaDia: hasta,
      busqueda,
      ficha: persona.ficha,
    };
  }
  const aviso = !nuevos.length
    ? `No hay horarios nuevos ${periodo}. Siguen los que ya tenía:`
    : previas.length
      ? "Sumé horarios más adelante y siguen los anteriores:"
      : `Con ${par.profesional.nombre} — ${par.prestacion.nombre || par.codigo}:`;
  return {
    texto: textoConHorarios(persona.texto, aviso, juntos),
    hastaDia: hasta,
    busqueda,
    horarios: lista,
    ficha: persona.ficha,
  };
}

function lineasHorario(texto: string): string[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(linea))
    .filter((linea) => !/^ClavesISO:/i.test(linea))
    // Solo slots completos, no una fecha suelta entre paréntesis.
    .filter((linea) => !/^\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?\)\s*$/.test(linea));
}

function claveHorario(linea: string): string {
  return linea.match(/\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1] ?? linea;
}

function unirHorarios(previas: string[], nuevas: string[]): string[] {
  const mapa = new Map<string, string>();
  for (const linea of [...previas, ...nuevas]) mapa.set(claveHorario(linea), linea);
  return [...mapa.values()].sort((a, b) => claveHorario(a).localeCompare(claveHorario(b)));
}

/** DNI de la ficha o dicho en el mensaje. No usa el documento de un profesional, que viene entre paréntesis. */
function dniDicho(consulta: string, ctxDni: string): string {
  const propio = documentoDePersona(ctxDni);
  if (propio) return propio;
  return documentoDePersona(consulta);
}

function horaPedida(consulta: string): string {
  const iso = consulta.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/);
  if (iso) return `${iso[1]} ${iso[2]}:${iso[3] ?? "00"}`;
  const local = consulta.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!local) return "";
  const dia = local[1]!.padStart(2, "0");
  const mes = local[2]!.padStart(2, "0");
  const hora = local[4]!.padStart(2, "0");
  return `${local[3]}-${mes}-${dia} ${hora}:${local[5]}:00`;
}

export function horarioOfrecido(consulta: string, previo: string): boolean {
  const ofrecidos = [...previo.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g)].map((item) => item[0]);
  if (!ofrecidos.length) return true;
  const pedido = horaPedida(consulta);
  if (!pedido) return false;
  return ofrecidos.some((item) => item.slice(0, 16) === pedido.slice(0, 16));
}

export function textoOpcionInvalida(texto: string, previo: string): string {
  if (!previo.trim() || pideMasFechas(texto) || pideMasTemprano(texto)) return "";
  const horarios = lineasHorario(previo);
  const opciones = horarios.length
    ? horarios
    : previo
        .split("\n")
        .map((linea) => linea.trim())
        .filter((linea) => linea.includes("—") || /\(\d{4}-\d{2}-\d{2}/.test(linea));
  if (opciones.length < 2) return "";
  const t = sinTildes(texto);
  if (/\bprimer[ao]?\b|\bsegund[ao]\b|\btercer[ao]?\b|\bcuart[ao]\b|\bquint[ao]\b/.test(t)) return "";
  if (/\bdni\b/.test(t) || documentoDePersona(texto)) return "";
  const valida = opciones.some((linea) => {
    const hora = linea.match(/\d{1,2}:\d{2}/);
    if (hora?.[0] && t.includes(hora[0])) return true;
    return tokens(linea).some((token) => token.length >= 4 && t.includes(token));
  });
  if (valida) return "";
  const lista = horarios.length ? formatearHorariosAgrupados(horarios) : opciones.join("\n");
  return `Esa opción no está entre las que te pasé.\n${lista}`;
}

async function reservarTurno(
  config: BuscaTurnoConfig | null,
  consulta: string,
  ctx: ContextoAccion,
): Promise<SalidaAccion> {
  if (!config) return solo("No hay listas de profesionales ni prestaciones cargadas.");
  // Si recién listamos libres, la pareja profesional|tratamiento ya está en busqueda.
  const guardado = ctx.busqueda ? parGuardado(config, ctx.busqueda) : null;
  const par = guardado ?? parDeConsulta(config, consulta);
  if (typeof par === "string") return solo(par);
  const cuando = horaPedida(consulta);
  if (!cuando) return solo("Falta el horario elegido. Primero hay que listar los turnos libres y que la persona elija uno.");
  const dni = dniDicho(consulta, ctx.dni || "");
  if (!dni) return solo(`Falta el DNI del paciente para ver si ya está en INECO.\n${par.profesional.nombre} — ${par.prestacion.nombre || par.codigo}`);
  const persona = await leerPersona(dni);
  const nombre = persona.ficha.pacienteNombre || ctx.nombre || "";
  const apellido = persona.ficha.pacienteApellido || ctx.apellido || "";
  const email = persona.ficha.email || ctx.email || "";
  const sexo = persona.ficha.sexo || (ctx.sexo === "femenino" || ctx.sexo === "masculino" ? ctx.sexo : "");
  if (persona.ficha.esPaciente !== "si" && (!nombre || !apellido || !sexo || !email)) {
    return { texto: persona.texto, ficha: persona.ficha };
  }
  if (!nombre || !apellido) return { texto: `${persona.texto}\nFaltan nombre o apellido del paciente.`, ficha: persona.ficha };
  if (!email) return { texto: `${persona.texto}\nFalta el email del paciente para dar el turno.`, ficha: persona.ficha };
  const nacimiento = persona.ficha.fechaNacimiento || fechaBa(0);
  const data = await medexisPost("api/TurnoNuevo", {
    body: {
      turno: [
        {
          PersonaTipoDocumento: "AR",
          PersonaDocumento: dni,
          PersonaNombre: nombre,
          PersonaApellido: apellido,
          PersonaFechaNacimiento: nacimiento,
          PersonaSexo: sexo === "femenino" ? "FEMENINO" : "MASCULINO",
          PersonaEmail: email,
          PersonaTelefonoCel: (ctx.telefono || "").replace(/\D/g, ""),
          PersonaIdioma: "es",
          PrestadorDocumento: String(par.profesional.doc),
          Sede: par.profesional.sede || "INECO",
          TurnoFechaHora: cuando,
          TurnoPrestacion: par.codigo,
          GeneraPago: "N",
          TurnoX: 1,
        },
      ],
    },
  });
  if (data && typeof data === "object" && (data as { Resultado?: string }).Resultado === "ERROR") {
    // No devolvemos el detalle técnico de Medexis (precio cero, códigos, etc.).
    return { texto: "No pude dar el turno. El sistema no pudo registrarlo.", ficha: persona.ficha };
  }
  return {
    texto: `Turno dado: ${par.profesional.nombre}, ${par.prestacion.nombre || par.codigo}, ${cuando}.`,
    ficha: persona.ficha,
  };
}

function filasTurno(data: unknown): Record<string, unknown>[] {
  const lista = Array.isArray(data)
    ? data
    : ((data as { Turnos?: unknown[] })?.Turnos ?? (data as { turnos?: unknown[] })?.turnos ?? []);
  return lista.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function mismaHora(crudo: string, cuando: string): boolean {
  const a = horaPedida(crudo);
  const b = horaPedida(cuando);
  return Boolean(a && b) && a.slice(0, 16) === b.slice(0, 16);
}

function profesionalDeConsulta(config: BuscaTurnoConfig, consulta: string): BuscaTurnoProfesional | string {
  const lista = profesionalesNombrados(config, consulta);
  const incompleto = textoNombreIncompleto(consulta, lista);
  if (incompleto) return incompleto;
  if (!lista.length) return "Falta el profesional. No hay uno habilitado con ese nombre.";
  if (lista.length > 1) return "Hay más de un profesional con ese nombre.";
  return lista[0]!;
}

async function cancelarTurno(
  config: BuscaTurnoConfig | null,
  consulta: string,
  ctx: ContextoAccion,
): Promise<string> {
  if (!config) return "No hay listas de profesionales ni prestaciones cargadas.";
  const profesional = profesionalDeConsulta(config, consulta);
  if (typeof profesional === "string") return profesional;
  const cuando = horaPedida(consulta);
  if (!cuando) return "No hay un turno dado en esta charla para cancelar.";
  const dni = dniDicho(consulta, ctx.dni || "");
  if (!dni) return "Falta el DNI del turno a cancelar.";
  const data = await medexisPost("api/Turno", {
    query: { Fecha: cuando.slice(0, 10), PrestadorDocumento: String(profesional.doc) },
  });
  if (data && typeof data === "object" && (data as { Resultado?: string }).Resultado === "ERROR") {
    return "No pude cancelar el turno. El sistema no pudo registrarlo.";
  }
  const fila = filasTurno(data).find((row) => {
    const documento = String(row.PersonaDocumento || row.personaDocumento || "").replace(/\D/g, "");
    const crudo = String(row.turnoFechaHora || row.TurnoFechaHora || "");
    return documento === dni && mismaHora(crudo, cuando);
  });
  if (!fila) return `No encontré un turno de ${profesional.nombre} el ${cuando} para el DNI ${dni}.`;
  const sede = String(fila.Sede || fila.sede || profesional.sede || "INECO");
  const cuandoFila = String(fila.TurnoFechaHora || fila.turnoFechaHora || cuando);
  const prestador = String(fila.PrestadorDocumento || fila.prestadorDocumento || profesional.doc);
  let anulado: unknown;
  try {
    anulado = await medexisPost("api/Turno", {
      query: {
        PrestadorDocumento: prestador,
        PersonaDocumento: dni,
        TurnoFechaHora: cuandoFila,
        Sede: sede,
      },
    });
  } catch {
    return "No pude cancelar el turno. El sistema no pudo registrarlo.";
  }
  if (anulado && typeof anulado === "object" && (anulado as { Resultado?: string }).Resultado === "ERROR") {
    return "No pude cancelar el turno. El sistema no pudo registrarlo.";
  }
  return `Turno cancelado: ${profesional.nombre}, ${cuandoFila}.`;
}

function textoFilas(lista: Record<string, unknown>[]): string {
  const ahora = Date.now();
  return lista
    .slice(0, 12)
    .map((row) => {
      const crudo = String(row.turnoFechaHora || row.TurnoFechaHora || row.Fecha || "");
      const cuando = new Date(crudo);
      const momento = !Number.isNaN(cuando.getTime()) && cuando.getTime() < ahora ? "anterior" : "futuro";
      const profesional = String(row.profesionalNombre || row.PrestadorNombre || row.PrestadorApellido || "");
      const prestacion = String(row.prestacionNombre || row.PrestacionNombre || row.TurnoPrestacion || "");
      const conQuien = profesional ? ` con ${profesional}` : "";
      return `${momento}: ${crudo || "sin fecha"}${conQuien} ${prestacion}`.trim();
    })
    .join("\n");
}

async function turnosDelPaciente(
  consulta: string,
  ctx: ContextoAccion,
  config: BuscaTurnoConfig | null,
): Promise<string> {
  const dni = dniDicho(consulta, ctx.dni || "");
  if (!dni) return "Falta el DNI del paciente para buscar sus turnos.";
  const data = await medexisPost("api/Turno", {
    query: {
      PersonaDocumento: dni,
      FechaDesde: fechaBa(-180),
      FechaHasta: fechaBa(180),
    },
  });
  if (data && typeof data === "object" && (data as { Resultado?: string }).Resultado === "ERROR") {
    return detalle(data) || "Medexis no devolvió los turnos del paciente.";
  }
  const lista = filasTurno(data);
  if (lista.length) return textoFilas(lista);
  const cuando = horaPedida(consulta);
  const par = config ? parDeConsulta(config, consulta) : "sin config";
  if (cuando && typeof par !== "string") {
    const porProfesional = await medexisPost("api/Turno", {
      query: { Fecha: cuando.slice(0, 10), PrestadorDocumento: String(par.profesional.doc) },
    });
    const propias = filasTurno(porProfesional).filter((row) => {
      const documento = String(row.PersonaDocumento || row.personaDocumento || "").replace(/\D/g, "");
      return !documento || documento === dni;
    });
    if (propias.length) return textoFilas(propias);
  }
  return `No hay turnos anteriores ni futuros para el DNI ${dni}.`;
}
