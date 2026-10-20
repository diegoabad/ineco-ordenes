export type WaFichaCaso = {
  consultaPara: string;
  relacionFamiliar: string;
  pacienteNombre: string;
  pacienteApellido: string;
  contactoNombre: string;
  contactoApellido: string;
  grupoEtario: string;
  dni: string;
  sexo: string;
};

export type WaCasoTurno = WaFichaCaso & {
  id: string;
  etiqueta: string;
  estado: "juntando" | "completo" | "fallo" | "derivado";
};

export type WaEventoDato = {
  en: string;
  casoId: string;
  campo: string;
  anterior: string;
  nuevo: string;
};

export type WaTemaPila = {
  clave: string;
  casoId: string;
  datoPedido: string;
};

export type WaResultadoAccion = {
  accion: string;
  ok: boolean;
  motivo: string;
  /** Próximo día a buscar, sin repetir los anteriores. */
  hastaDia?: number;
  /** Profesional y prestación de esa búsqueda. */
  busqueda?: string;
  /** Horarios ya encontrados, para sumarlos al ampliar. */
  horarios?: string;
  /** anular o cambiar, mientras se elige y se confirma ese turno. */
  objetivo?: string;
  /** Turno ya confirmado para anular cuando el nuevo quede dado. */
  anularLuego?: string;
};

export type WaPausaDialogo = {
  intencion: string;
  casoId: string;
  datoPedido: string;
};

const CAMPOS: (keyof WaFichaCaso)[] = [
  "consultaPara",
  "relacionFamiliar",
  "pacienteNombre",
  "pacienteApellido",
  "contactoNombre",
  "contactoApellido",
  "grupoEtario",
  "dni",
  "sexo",
];

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function capitalizar(texto: string): string {
  const limpio = texto.trim();
  if (!limpio) return "";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

function fichaVacia(): WaFichaCaso {
  return {
    consultaPara: "",
    relacionFamiliar: "",
    pacienteNombre: "",
    pacienteApellido: "",
    contactoNombre: "",
    contactoApellido: "",
    grupoEtario: "",
    dni: "",
    sexo: "",
  };
}

function variosTurnos(texto: string): boolean {
  const t = sinTildes(texto);
  if (!/\bturno/.test(t)) return false;
  if (/\b(dos|tres|2|3)\s+turnos\b|\botro turno\b/.test(t)) return true;
  const propio = /\bpara mi\b(?!\s+(hij|nen|espos|mama|papa|madre|padre|abuel))/.test(t);
  const familiar = /\b(hij[oa]|nene|nena|espos[oa]|mama|papa|madre|padre|abuel[oa])\b/.test(t);
  return propio && familiar;
}

function edadCerca(texto: string, pista: RegExp): "" | "infanto" | "adulto" {
  const t = sinTildes(texto);
  const match = t.match(pista);
  if (!match?.[1]) return "";
  const n = Number(match[1]);
  if (n < 1 || n > 110) return "";
  return n < 18 ? "infanto" : "adulto";
}

function persona(parcial: Partial<WaCasoTurno> & { etiqueta: string }): WaCasoTurno {
  return {
    ...fichaVacia(),
    id: "",
    estado: "juntando",
    consultaPara: parcial.consultaPara ?? "",
    relacionFamiliar: parcial.relacionFamiliar ?? "",
    pacienteNombre: parcial.pacienteNombre ?? "",
    grupoEtario: parcial.grupoEtario ?? "",
    etiqueta: parcial.etiqueta,
  };
}

export function personasDelTexto(texto: string): WaCasoTurno[] {
  const t = sinTildes(texto);
  if (!/\bturno/.test(t)) return [];
  const propio = /\bpara mi\b(?!\s+(hij|nen|espos|mama|papa|madre|padre|abuel))/.test(t);
  const hijo = t.match(/\b(?:hijo|nene)\s+([a-zñ]{2,})/);
  const hija = t.match(/\b(?:hija|nena)\s+([a-zñ]{2,})/);
  const mama = /\bmi (mama|madre)\b/.test(t);
  const edadHijo = edadCerca(texto, /\b(?:hijo|nene|hija|nena)\b[^.]{0,40}?\b(\d{1,2})\s+anos\b/);
  const lista: WaCasoTurno[] = [];
  if (variosTurnos(texto)) {
    if (propio) lista.push(persona({ etiqueta: "quien escribe", consultaPara: "propio" }));
    if (hijo) {
      lista.push(
        persona({
          etiqueta: `hijo ${capitalizar(hijo[1] ?? "")}`,
          consultaPara: "tercero",
          relacionFamiliar: "Hijo",
          pacienteNombre: capitalizar(hijo[1] ?? ""),
          grupoEtario: edadHijo,
        }),
      );
    }
    if (hija) {
      lista.push(
        persona({
          etiqueta: `hija ${capitalizar(hija[1] ?? "")}`,
          consultaPara: "tercero",
          relacionFamiliar: "Hija",
          pacienteNombre: capitalizar(hija[1] ?? ""),
          grupoEtario: edadHijo,
        }),
      );
    }
    if (mama) {
      lista.push(persona({ etiqueta: "mamá", consultaPara: "tercero", relacionFamiliar: "Madre", grupoEtario: "adulto" }));
    }
    return lista;
  }
  if (hijo) {
    return [
      persona({
        etiqueta: `hijo ${capitalizar(hijo[1] ?? "")}`,
        consultaPara: "tercero",
        relacionFamiliar: "Hijo",
        pacienteNombre: capitalizar(hijo[1] ?? ""),
        grupoEtario: edadHijo || (/\b(nino|nene)\b/.test(t) ? "infanto" : ""),
      }),
    ];
  }
  if (propio) return [persona({ etiqueta: "quien escribe", consultaPara: "propio" })];
  return [persona({ etiqueta: "turno" })];
}

export function asegurarCasos(previos: WaCasoTurno[], texto: string): WaCasoTurno[] {
  const out = previos.map((caso) => ({ ...caso }));
  if (!/\bturno/.test(sinTildes(texto)) && out.length === 0) return out;
  for (const nuevo of personasDelTexto(texto)) {
    if (out.some((caso) => sinTildes(caso.etiqueta) === sinTildes(nuevo.etiqueta))) continue;
    nuevo.id = `caso-${out.length + 1}`;
    out.push(nuevo);
  }
  return out.slice(0, 4);
}

export function incorporarPersonas(
  previos: WaCasoTurno[],
  personas: {
    etiqueta: string;
    consultaPara: "" | "propio" | "tercero";
    relacionFamiliar: string;
    pacienteNombre: string;
    pacienteApellido: string;
    grupoEtario: "" | "infanto" | "adulto";
  }[],
): WaCasoTurno[] {
  const out = previos.map((caso) => ({ ...caso }));
  for (const item of personas) {
    const nombre = item.pacienteNombre.trim();
    const apellido = item.pacienteApellido.trim();
    const etiqueta = item.etiqueta.trim() || (item.consultaPara === "propio" ? "quien escribe" : nombre);
    if (!etiqueta) continue;
    const ya = out.find((caso) => {
      if (sinTildes(caso.etiqueta) === sinTildes(etiqueta)) return true;
      if (nombre && caso.pacienteNombre && sinTildes(caso.pacienteNombre) === sinTildes(nombre)) return true;
      return item.consultaPara === "propio" && caso.consultaPara === "propio";
    });
    if (ya) {
      if (!ya.pacienteNombre && nombre) ya.pacienteNombre = capitalizar(nombre);
      if (!ya.pacienteApellido && apellido) ya.pacienteApellido = capitalizar(apellido);
      if (!ya.relacionFamiliar && item.relacionFamiliar.trim()) ya.relacionFamiliar = item.relacionFamiliar.trim();
      if (!ya.grupoEtario && (item.grupoEtario === "infanto" || item.grupoEtario === "adulto")) ya.grupoEtario = item.grupoEtario;
      if (!ya.consultaPara && (item.consultaPara === "propio" || item.consultaPara === "tercero")) ya.consultaPara = item.consultaPara;
      continue;
    }
    if (out.length >= 4) break;
    out.push({
      ...fichaVacia(),
      id: `caso-${out.length + 1}`,
      etiqueta,
      estado: "juntando",
      consultaPara: item.consultaPara === "propio" || item.consultaPara === "tercero" ? item.consultaPara : "",
      relacionFamiliar: item.relacionFamiliar.trim(),
      pacienteNombre: nombre ? capitalizar(nombre) : "",
      pacienteApellido: apellido ? capitalizar(apellido) : "",
      grupoEtario: item.grupoEtario === "infanto" || item.grupoEtario === "adulto" ? item.grupoEtario : "",
    });
  }
  const nombrados = out.filter((caso) => sinTildes(caso.etiqueta) !== "turno");
  if (!nombrados.length) return out.slice(0, 4);
  return [...nombrados, ...out.filter((caso) => sinTildes(caso.etiqueta) === "turno" && caso.pacienteNombre)].slice(0, 4);
}

export function casoActivo(casos: WaCasoTurno[], preferido = ""): WaCasoTurno | null {
  const marcado = preferido ? casos.find((caso) => caso.id === preferido && caso.estado === "juntando") : undefined;
  return marcado ?? casos.find((caso) => caso.estado === "juntando") ?? null;
}

export function precargarCaso(
  datos: {
    consultaPara: "" | "propio" | "tercero";
    relacionFamiliar: string;
    pacienteNombre: string;
    pacienteApellido: string;
    grupoEtario: "" | "infanto" | "adulto";
  },
  caso: WaCasoTurno,
  casos: WaCasoTurno[],
  texto: string,
): void {
  if (casos.length > 1 && caso.consultaPara === "propio") {
    datos.consultaPara = "propio";
    datos.relacionFamiliar = "";
    const otros = new Set(
      casos
        .filter((item) => item.id !== caso.id)
        .map((item) => sinTildes(item.pacienteNombre))
        .filter(Boolean),
    );
    if (otros.has(sinTildes(datos.pacienteNombre))) datos.pacienteNombre = "";
    if (otros.has(sinTildes(datos.pacienteApellido))) datos.pacienteApellido = "";
  }
  if (!datos.consultaPara && (caso.consultaPara === "propio" || caso.consultaPara === "tercero")) {
    datos.consultaPara = caso.consultaPara;
  }
  if (!datos.relacionFamiliar && caso.relacionFamiliar) datos.relacionFamiliar = caso.relacionFamiliar;
  if (!datos.pacienteNombre && caso.pacienteNombre) datos.pacienteNombre = caso.pacienteNombre;
  if (!datos.pacienteApellido && caso.pacienteApellido) datos.pacienteApellido = caso.pacienteApellido;
  if (!datos.grupoEtario && (caso.grupoEtario === "infanto" || caso.grupoEtario === "adulto")) {
    datos.grupoEtario = caso.grupoEtario;
  }
}

/** Documento de la persona: DNI con o sin puntos, más corto, o de otro país. */
export function documentoDePersona(texto: string): string {
  const sinParentesis = texto.replace(/\([^)]*\)/g, " ");
  const sirve = (valor: string): string => {
    const compacto = valor.replace(/[\s.\-_/]/g, "").toUpperCase();
    if (!/^[A-Z0-9]{5,15}$/.test(compacto)) return "";
    const digitos = compacto.replace(/\D/g, "");
    if (!digitos) return "";
    if (/^\d+$/.test(compacto)) return digitos.length <= 12 ? compacto : "";
    if (digitos.length < 3) return "";
    return compacto;
  };
  for (const parte of sinParentesis.split(/[\s,;:]+/)) {
    const doc = sirve(parte);
    if (doc) return doc;
  }
  return "";
}

export function vincularDatoPedido(
  campo: string,
  texto: string,
  datos: {
    consultaPara: "" | "propio" | "tercero";
    pacienteNombre: string;
    pacienteApellido: string;
    dni: string;
    sexo: "" | "masculino" | "femenino";
    grupoEtario: "" | "infanto" | "adulto";
  },
): void {
  const crudo = texto.trim();
  const t = sinTildes(crudo);
  if (!campo || !crudo) return;
  const palabra = /^[a-zñáéíóú]{2,}$/i.test(crudo) && !/^(si|sí|no|ok|hola|chau)$/.test(t);
  if (campo === "pacienteNombre" && !datos.pacienteNombre && palabra) datos.pacienteNombre = capitalizar(t);
  if (campo === "pacienteApellido" && !datos.pacienteApellido && palabra) datos.pacienteApellido = capitalizar(t);
  if (campo === "dni" && !datos.dni) {
    const doc = documentoDePersona(crudo);
    if (doc) datos.dni = doc;
  }
  if (campo === "sexo" && !datos.sexo) {
    if (/\bmasculino\b/.test(t)) datos.sexo = "masculino";
    if (/\bfemenino\b/.test(t)) datos.sexo = "femenino";
  }
  if (campo === "consultaPara" && !datos.consultaPara) {
    if (/^(para mi|yo|mio)$/.test(t)) datos.consultaPara = "propio";
    if (/otra|familiar|hijo|hija/.test(t)) datos.consultaPara = "tercero";
  }
}

export function copiarFichaEnCaso(
  caso: WaCasoTurno,
  ficha: WaFichaCaso,
): WaCasoTurno {
  const siguiente = { ...caso };
  for (const campo of CAMPOS) {
    if (ficha[campo]) siguiente[campo] = ficha[campo];
  }
  return siguiente;
}

export function diffFicha(
  antes: WaFichaCaso,
  despues: WaFichaCaso,
  casoId: string,
  en: string,
): WaEventoDato[] {
  const eventos: WaEventoDato[] = [];
  for (const campo of CAMPOS) {
    const previo = antes[campo] ?? "";
    const actual = despues[campo] ?? "";
    if (previo === actual || !actual) continue;
    eventos.push({ en, casoId, campo, anterior: previo, nuevo: actual });
  }
  return eventos;
}

export function faltantesCaso(caso: WaCasoTurno): string[] {
  const base = ["consultaPara", "pacienteNombre", "pacienteApellido", "dni", "sexo", "grupoEtario"];
  if (caso.consultaPara === "tercero") base.push("relacionFamiliar", "contactoNombre");
  return base.filter((campo) => !caso[campo as keyof WaFichaCaso]);
}

export function preguntaDelCaso(caso: WaCasoTurno, campo: string): string {
  const quien = caso.etiqueta === "quien escribe" || caso.etiqueta === "turno" ? "vos" : caso.etiqueta;
  if (campo === "pacienteNombre") return quien === "vos" ? "¿Cuál es tu nombre?" : `¿Cuál es el nombre de ${quien}?`;
  if (campo === "pacienteApellido") return quien === "vos" ? "¿Cuál es tu apellido?" : `¿Cuál es el apellido de ${quien}?`;
  if (campo === "dni") return quien === "vos" ? "¿Me pasás tu DNI?" : `¿Me pasás el DNI de ${quien}?`;
  if (campo === "sexo") return quien === "vos" ? "¿Sos masculino o femenino?" : `¿${quien} es masculino o femenino?`;
  if (campo === "grupoEtario") return quien === "vos" ? "¿Qué edad tenés?" : `¿Qué edad tiene ${quien}?`;
  if (campo === "consultaPara") return "¿La consulta es para vos o para otra persona?";
  if (campo === "relacionFamiliar") return "¿Qué relación tenés con el paciente?";
  if (campo === "contactoNombre") return "¿Cuál es tu nombre?";
  return "¿Me pasás ese dato?";
}

export function pilaDeCasos(casos: WaCasoTurno[], activoId: string, datoPedido: string, interrumpe: boolean): WaTemaPila[] {
  const espera = casos
    .filter((caso) => caso.estado === "juntando" && caso.id !== activoId)
    .map((caso) => ({ clave: "TURNOS", casoId: caso.id, datoPedido: "" }));
  if (!interrumpe || !activoId) return espera;
  return [{ clave: "TURNOS", casoId: activoId, datoPedido }, ...espera].slice(0, 6);
}

export function resultadoReservar(): WaResultadoAccion {
  return { accion: "reservar", ok: false, motivo: "El sistema de turnos no pudo reservar." };
}

export function textoEstadoDialogo(input: {
  casos: WaCasoTurno[];
  casoId: string;
  datoPedido: string;
  pila: WaTemaPila[];
  resultado: WaResultadoAccion | null;
  reanudacion: WaPausaDialogo | null;
  historial?: WaEventoDato[];
}): string {
  const activo = input.casos.find((caso) => caso.id === input.casoId);
  const etiquetaDe = (id: string) => input.casos.find((caso) => caso.id === id)?.etiqueta || id;
  const cambios = (input.historial ?? []).slice(-8);
  const lineas = [
    activo ? `Caso activo: ${activo.etiqueta} (${activo.estado}).` : "",
    input.casos.length ? `Casos: ${input.casos.map((caso) => `${caso.etiqueta} ${caso.estado}`).join(" | ")}.` : "",
    input.datoPedido ? `Dato que se está pidiendo: ${input.datoPedido}.` : "",
    cambios.length
      ? `Correcciones ya hechas: ${cambios
          .map((evento) => `${evento.campo} ${evento.anterior || "-"}→${evento.nuevo} (${etiquetaDe(evento.casoId) || "ficha"})`)
          .join(" | ")}.`
      : "",
    input.pila.length ? `En pausa: ${input.pila.map((tema) => `${tema.clave} ${etiquetaDe(tema.casoId)} ${tema.datoPedido}`.trim()).join(" | ")}.` : "",
    input.resultado ? `Última acción: ${input.resultado.accion}, ok=${input.resultado.ok ? "sí" : "no"}. ${input.resultado.motivo}` : "",
    input.reanudacion
      ? `Se reanuda después de una persona. Iba en ${input.reanudacion.intencion || "la charla"}, caso ${etiquetaDe(input.reanudacion.casoId) || "-"}, dato ${input.reanudacion.datoPedido || "-"}.`
      : "",
  ].filter(Boolean);
  return lineas.join("\n");
}

export function normalizarCasos(value: unknown): WaCasoTurno[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const etiqueta = String(item.etiqueta ?? "").trim();
      const id = String(item.id ?? "").trim();
      if (!id || !etiqueta) return null;
      const base = fichaVacia();
      for (const campo of CAMPOS) base[campo] = String(item[campo] ?? "").trim();
      const estado =
        item.estado === "fallo" || item.estado === "derivado" || item.estado === "completo" ? item.estado : "juntando";
      return { ...base, id, etiqueta, estado } satisfies WaCasoTurno;
    })
    .filter((caso): caso is WaCasoTurno => caso !== null)
    .slice(0, 4);
}

export function normalizarHistorial(value: unknown): WaEventoDato[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const campo = String(item.campo ?? "").trim();
      if (!campo) return null;
      return {
        en: String(item.en ?? ""),
        casoId: String(item.casoId ?? ""),
        campo,
        anterior: String(item.anterior ?? ""),
        nuevo: String(item.nuevo ?? ""),
      } satisfies WaEventoDato;
    })
    .filter((evento): evento is WaEventoDato => evento !== null)
    .slice(-30);
}

export function normalizarPila(value: unknown): WaTemaPila[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const clave = String(item.clave ?? "").trim();
      if (!clave) return null;
      return {
        clave,
        casoId: String(item.casoId ?? ""),
        datoPedido: String(item.datoPedido ?? ""),
      } satisfies WaTemaPila;
    })
    .filter((tema): tema is WaTemaPila => tema !== null)
    .slice(0, 6);
}

export function normalizarResultado(value: unknown): WaResultadoAccion | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const accion = String(item.accion ?? "").trim();
  if (!accion) return null;
  const hasta = Number(item.hastaDia);
  const busqueda = String(item.busqueda ?? "").trim();
  const horarios = String(item.horarios ?? "").trim();
  const objetivo = String(item.objetivo ?? "").trim();
  const anularLuego = String(item.anularLuego ?? "").trim();
  return {
    accion,
    ok: item.ok === true,
    motivo: String(item.motivo ?? "").slice(0, 1500),
    ...(Number.isFinite(hasta) && hasta > 0 ? { hastaDia: hasta } : {}),
    ...(busqueda ? { busqueda } : {}),
    ...(horarios ? { horarios: horarios.slice(0, 4000) } : {}),
    ...(objetivo === "anular" || objetivo === "cambiar" ? { objetivo } : {}),
    ...(anularLuego ? { anularLuego: anularLuego.slice(0, 400) } : {}),
  };
}

export function normalizarPausa(value: unknown): WaPausaDialogo | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return {
    intencion: String(item.intencion ?? ""),
    casoId: String(item.casoId ?? ""),
    datoPedido: String(item.datoPedido ?? ""),
  };
}
