import { getBuscaTurnoConfig } from "../services/db.service.js";
import type { BuscaTurnoConfig, BuscaTurnoPrestacion, BuscaTurnoProfesional } from "../types.js";
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
  "quiero", "necesito", "busco", "buscar", "sacar", "sacame", "turno", "turnos", "horario", "horarios", "consulta",
  "online", "presencial", "domicilio", "minuto", "minutos", "sede", "primera", "primero", "segunda", "segundo",
  "vez", "mail", "soy", "femenino", "masculino", "anos", "edad", "ineco", "caba", "hijo", "hija",
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
  if (buscado?.[1]) return `¿Buscás a ${buscado[1].trim()}?`;
  if (texto.includes("profesionales con ese nombre")) return "¿Cuál buscabas?";
  if (texto.includes("falta el profesional")) return "¿Con qué profesional lo busco?";
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
    return "¿Necesitás algo más?";
  }
  if (texto.includes("no es paciente") || texto.includes("hay que pedir nombre")) return "¿Cuál es tu nombre?";
  if (texto.includes("para confirmar la anulación")) return "¿Confirmás que lo anulo?";
  if (texto.includes("para confirmar el cambio")) return "¿Confirmás que lo cambiamos?";
  if (texto.includes("elegí el turno a anular")) return "¿Cuál de estos turnos querés anular?";
  if (texto.includes("elegí el turno a cambiar")) return "¿Cuál de estos turnos querés cambiar?";
  if (texto.includes("cambio confirmado")) return "¿Para qué tratamiento y con qué profesional busco el turno nuevo?";
  if (texto.includes("quedó sin anular") || texto.includes("quedó sin cambios")) return "¿Necesitás algo más?";
  if (clave === "turnos.delPaciente" && /\d{4}-\d{2}-\d{2}/.test(resultado)) return "¿Necesitás algo más con ese turno?";
  if (texto.includes("esa opción no está") || texto.includes("ese horario no está")) return "¿Cuál de estas opciones querés?";
  if (texto.includes("no hay turnos libres")) return "¿Busco más adelante?";
  if (texto.includes("puedo buscar más adelante")) return "¿Busco más adelante?";
  if (/\d{4}-\d{2}-\d{2}/.test(resultado)) return "¿Cuál de estos horarios querés?";
  if (clave === "turnos.listarProfesionales") return "¿Con qué profesional lo busco?";
  if (clave === "turnos.listarTratamientos") return "¿Para qué tratamiento?";
  return "";
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function opcionesDe(resultado: string): string[] {
  return resultado
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea && !/^(hay más de un cruce|no elijas)/i.test(linea) && !linea.endsWith(":"));
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
  const encabezado = previo
    .split("\n")
    .map((linea) => linea.trim())
    .find((linea) => linea.endsWith(":"));
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
  if (/hay más de un cruce/i.test(previo)) return "turnos.libres";
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
  return resultado
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.includes("—") || /\(\d{4,}\)/.test(linea) || /^[A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑ0-9' .()-]{8,}$/.test(linea))
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
  const lines = profesionales.slice(0, 8).map((profesional) => {
    const prestaciones = Object.entries(config.prestaciones)
      .filter(([, prestacion]) => prestacion.enabled !== false)
      .filter(([, prestacion]) =>
        (prestacion.profesionales ?? []).some((item) => String(item.doc) === String(profesional.doc)),
      )
      .map(([codigo, prestacion]) => `${prestacion.nombre || codigo} (${codigo})`);
    const lista = prestaciones.length ? prestaciones.join("; ") : "ninguna prestación habilitada";
    return `${profesional.nombre} (${profesional.doc}, sede ${profesional.sede || "sin sede"}): ${lista}`;
  });
  const extra =
    profesionales.length > 8 ? `\nHay ${profesionales.length - 8} coincidencias más. No elijas una sola.` : "";
  return lines.join("\n") + extra;
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
      vistos.add(doc);
      nombres.push(`${item.nombre || doc} (${doc})`);
    }
  }
  if (!nombres.length) return "No hay un profesional habilitado para esa consulta.";
  const extra = nombres.length > 12 ? `\nHay ${nombres.length - 12} más.` : "";
  return nombres.slice(0, 12).join("\n") + extra;
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
  const origen = persona.trim() ? persona : consulta;
  const pedidos = tokens(origen).filter((token) => token.length >= 3 && !deTratamiento.has(token));
  if (!pedidos.length) return [];
  if (pedidos.some((token) => ![...deAlguien].some((nombre) => tokenParecido(token, nombre)))) return [];
  let candidatos = lista;
  for (const token of pedidos) {
    const exactos = candidatos.filter((item) => tokensDeNombre(item.nombre).includes(token));
    if (exactos.length) {
      candidatos = exactos;
      continue;
    }
    const medidos = candidatos
      .map((item) => ({
        item,
        distancia: Math.min(...tokensDeNombre(item.nombre).map((nombre) => distancia(token, nombre))),
      }))
      .filter((item) => item.distancia <= topeParecido(token));
    if (!medidos.length) return [];
    const mejor = Math.min(...medidos.map((item) => item.distancia));
    candidatos = medidos.filter((item) => item.distancia === mejor).map((item) => item.item);
  }
  return candidatos;
}

function textoDelNombre(consulta: string, persona: string, config: BuscaTurnoConfig | null): string {
  if (!config) return consulta;
  const nombres = new Set(habilitados(config).flatMap((item) => tokensDeNombre(item.nombre)));
  const dijoNombre = tokens(persona).some((token) => [...nombres].some((nombre) => tokenParecido(token, nombre)));
  return dijoNombre ? persona : consulta;
}

function textoNombreIncompleto(consulta: string, profesionales: BuscaTurnoProfesional[]): string {
  const pedidos = tokens(consulta).filter((token) =>
    profesionales.some((item) => tienePalabra(item.nombre, token)),
  );
  if (pedidos.length >= 2 || !profesionales.length) return "";
  if (profesionales.length > 1) {
    const lista = profesionales
      .slice(0, 12)
      .map((item) => `${item.nombre} (${item.doc})`)
      .join("\n");
    const extra = profesionales.length > 12 ? `\nHay ${profesionales.length - 12} más.` : "";
    return `Tenemos estos profesionales con ese nombre o apellido.\n${lista}${extra}`;
  }
  const unico = profesionales[0]?.nombre ?? "";
  const propios = tokensDeNombre(unico);
  if (propios.length >= 2) return `Buscás a ${unico}.`;
  return "";
}

function prestacionesDichas(config: BuscaTurnoConfig, consulta: string): [string, BuscaTurnoPrestacion][] {
  const dichos = tokens(consulta).filter((token) => token.length >= 4);
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
      const tratamientos = [...new Set(pares.map((par) => par.prestacion.nombre || par.codigo))];
      return `Estos son los tratamientos:\n${tratamientos.slice(0, 12).join("\n")}`;
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

async function diasLibres(
  par: { codigo: string; profesional: BuscaTurnoProfesional },
  desde: number,
  hasta: number,
): Promise<{ cuando: Date; texto: string }[]> {
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
      libres.push({ cuando, texto: `${hora} (${horaLocal(cuando)})` });
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
  return lineasHorario(guardados)
    .filter((linea) => !dichos.has(claveHorario(linea)))
    .join("\n");
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
      return solo(`${par}\n${profesionalesDePrestacion(config, consulta)}`);
    }
    if (par.startsWith("Falta el tratamiento") || par.startsWith("Ese profesional no hace")) {
      return solo(`${par}\n${tratamientosDeProfesional(config, consulta)}`);
    }
    return solo(par);
  }
  const busqueda = `${par.profesional.doc}|${par.codigo}`;
  if (!esCaba(par.profesional.sede)) {
    return solo(`${par.profesional.nombre} figura en ${par.profesional.sede}. Por este canal los turnos libres son los de CABA.`);
  }
  const dni = dniDicho(consulta, ctx.dni || "");
  const pareja = `${par.profesional.nombre} — ${par.prestacion.nombre || par.codigo}`;
  if (!dni) {
    return solo(`Falta el DNI del paciente para ver si ya está en INECO.\n${pareja}`);
  }
  const persona = await leerPersona(dni);
  const misma = ctx.busqueda === busqueda;
  const desde = misma ? Math.max(0, ctx.desdeDia ?? 0) : 0;
  const previas = misma ? lineasHorario(ctx.horariosPrevios ?? "") : [];
  if (ctx.masTemprano && (previas.length > 0 || desde > 0)) {
    const lista = previas.join("\n");
    return {
      texto: lista
        ? `${persona.texto}\nAntes de estas fechas no hay otros turnos libres. Estos son los que ya tenía:\n${lista}`
        : `${persona.texto}\nAntes de estas fechas no hay turnos libres de ${pareja}.`,
      hastaDia: desde,
      busqueda,
      horarios: lista,
      ficha: persona.ficha,
    };
  }
  if (desde >= TOPE_DIAS) {
    const lista = previas.join("\n");
    return {
      texto: `${persona.texto}\nYa busqué hasta el ${fechaBa(TOPE_DIAS - 1)}.${lista ? ` Siguen estos horarios:\n${lista}` : ` No hay turnos libres de ${pareja}.`}`,
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
      texto: `${persona.texto}\nNo hay turnos libres de ${pareja} ${periodo}.`,
      hastaDia: hasta,
      busqueda,
      ficha: persona.ficha,
    };
  }
  const aviso = !nuevos.length
    ? `No hay horarios nuevos ${periodo}. Siguen los que ya tenía:`
    : previas.length
      ? `Sumé horarios más adelante y siguen los anteriores:`
      : `${pareja}:`;
  return {
    texto: `${persona.texto}\n${aviso}\n${lista}`,
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
    .filter((linea) => /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(linea));
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
  const propio = ctxDni.replace(/\D/g, "");
  if (propio.length >= 7 && propio.length <= 9) return propio;
  const explicito = consulta.match(/\bdni\D{0,8}(\d{7,9})\b/i);
  if (explicito?.[1]) return explicito[1];
  const sueltos = [...consulta.matchAll(/(^|[^\d(])(\d{7,9})(?!\d)/g)].map((item) => item[2] ?? "");
  return sueltos.length === 1 ? sueltos[0]! : "";
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
  const opciones = previo
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.includes("—") || /\(\d{4}-\d{2}-\d{2}/.test(linea));
  if (opciones.length < 2) return "";
  const t = sinTildes(texto);
  if (/\bprimer[ao]?\b|\bsegund[ao]\b|\btercer[ao]?\b|\bcuart[ao]\b|\bquint[ao]\b/.test(t)) return "";
  if (/\bdni\b/.test(t) || /\b\d{7,9}\b/.test(texto)) return "";
  const valida = opciones.some((linea) => {
    const hora = linea.match(/\d{1,2}:\d{2}/);
    if (hora?.[0] && t.includes(hora[0])) return true;
    return tokens(linea).some((token) => token.length >= 4 && t.includes(token));
  });
  if (valida) return "";
  return `Esa opción no está entre las que te pasé.\n${opciones.join("\n")}`;
}

async function reservarTurno(
  config: BuscaTurnoConfig | null,
  consulta: string,
  ctx: ContextoAccion,
): Promise<SalidaAccion> {
  if (!config) return solo("No hay listas de profesionales ni prestaciones cargadas.");
  const par = parDeConsulta(config, consulta);
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
    return { texto: detalle(data) || "Medexis no pudo dar el turno.", ficha: persona.ficha };
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
  if (dni.length < 7) return "Falta el DNI del turno a cancelar.";
  const data = await medexisPost("api/Turno", {
    query: { Fecha: cuando.slice(0, 10), PrestadorDocumento: String(profesional.doc) },
  });
  if (data && typeof data === "object" && (data as { Resultado?: string }).Resultado === "ERROR") {
    return detalle(data) || "Medexis no devolvió el turno a cancelar.";
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
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "";
    return mensaje || "No pude cancelar el turno.";
  }
  if (anulado && typeof anulado === "object" && (anulado as { Resultado?: string }).Resultado === "ERROR") {
    return detalle(anulado) || "No pude cancelar el turno.";
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
  if (dni.length < 7) return "Falta el DNI del paciente para buscar sus turnos.";
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
