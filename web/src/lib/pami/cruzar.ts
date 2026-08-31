import type {
  Alerta,
  Coincidencia,
  ConcentracionAfiliado,
  DebitoRow,
  FileParseMeta,
  MotivoRechazo,
  PresentacionRow,
  PrestacionDuplicada,
  ResultadoPami,
} from "./types";
import {
  CODIGOS_DEBITO_CONOCIDOS,
  MAPEO_PRESTACION,
  MODULOS_CONOCIDOS,
  UMBRAL_FILAS_DESCARTADAS_A,
} from "./types";
import { formatFechaYmd } from "../fechas";

function toNumero(v: string): number {
  const n = Number(String(v).replace(/\D/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function codigoObservadoCoincideConModulos(
  codigos: number[],
  modulosPresentados: number[],
): boolean {
  if (codigos.length === 0 || modulosPresentados.length === 0) return true;
  const set = new Set(modulosPresentados);
  return codigos.every((codigo) => {
    const key = String(codigo) as keyof typeof MAPEO_PRESTACION;
    const mapped = MAPEO_PRESTACION[key]?.modulo;
    if (mapped === undefined) return true;
    return set.has(mapped);
  });
}

/** Garantiza `duplicadosDebitos` (recalcula desde débitos si hay filas). */
export function withDuplicadosDebitos(result: ResultadoPami): ResultadoPami {
  const debitos = Array.isArray(result.debitos) ? result.debitos : [];
  if (debitos.length > 0) {
    return {
      ...result,
      debitos,
      duplicadosDebitos: detectarDuplicadosDebitos(debitos),
    };
  }
  if (Array.isArray(result.duplicadosDebitos)) return result;
  return { ...result, duplicadosDebitos: [] };
}

/** Agrupa filas de Débitos con mismo afiliado + fecha + código (sin deduplicar). */
export function detectarDuplicadosDebitos(debitos: DebitoRow[]): PrestacionDuplicada[] {
  const groups = new Map<
    string,
    {
      afiliadoOriginal: string;
      afiliadoNormalizado: string;
      fecha: string;
      codigo: number;
      motivos: string[];
      cantidadFilas: number;
    }
  >();

  for (const row of debitos) {
    const codigo = toNumero(row.prestacion) || 0;
    const key = `${row.afiliadoKey}|${row.fecha}|${codigo}`;
    const cur = groups.get(key) ?? {
      afiliadoOriginal: row.afiliadoOriginal,
      afiliadoNormalizado: row.afiliadoKey,
      fecha: row.fecha,
      codigo,
      motivos: [],
      cantidadFilas: 0,
    };
    cur.cantidadFilas += 1;
    const motivo = row.orden.trim() || "(sin motivo)";
    if (!cur.motivos.includes(motivo)) cur.motivos.push(motivo);
    groups.set(key, cur);
  }

  return [...groups.values()]
    .filter((g) => g.cantidadFilas > 1)
    .sort(
      (a, b) =>
        b.cantidadFilas - a.cantidadFilas ||
        a.afiliadoOriginal.localeCompare(b.afiliadoOriginal),
    );
}

function buildAlertas(
  presentacion: PresentacionRow[],
  debitos: DebitoRow[],
  presentacionMeta: FileParseMeta,
  presentacionByKey: Map<string, PresentacionRow[]>,
  duplicados: PrestacionDuplicada[],
): Alerta[] {
  const alertas: Alerta[] = [];

  const conMotivosDistintos = duplicados.filter((d) => d.motivos.length > 1);
  for (const d of conMotivosDistintos) {
    const motivosTxt = d.motivos.join(" · ");
    alertas.push({
      tipo: "duplicado_motivos_distintos",
      titulo: "Prestación duplicada",
      meta: `${d.afiliadoOriginal} · ${formatFechaYmd(d.fecha)} · código ${d.codigo}`,
      badge: `${d.cantidadFilas} filas`,
      items: d.motivos,
      mensaje: `Prestación duplicada ${d.afiliadoOriginal} · ${formatFechaYmd(d.fecha)} · código ${d.codigo} (${d.cantidadFilas} filas). Motivos: ${motivosTxt}`,
    });
  }

  const soloRepetidos = duplicados.filter((d) => d.motivos.length <= 1);
  if (soloRepetidos.length > 0 && conMotivosDistintos.length === 0) {
    const n = soloRepetidos.reduce((s, d) => s + d.cantidadFilas - 1, 0);
    alertas.push({
      tipo: "duplicado_exacto",
      titulo: "Filas duplicadas en Débitos",
      meta: "Mismo afiliado, fecha y código — no se deduplicaron",
      badge: `${n} extra`,
      mensaje: `${n} fila(s) duplicada(s) en Débitos (mismo afiliado, fecha y código). No se deduplicaron.`,
    });
  }

  if (presentacionMeta.filasDescartadas > UMBRAL_FILAS_DESCARTADAS_A) {
    alertas.push({
      tipo: "filas_descartadas_altas",
      titulo: "Muchas filas descartadas en INECO",
      meta: `Lo habitual es ≤ ${UMBRAL_FILAS_DESCARTADAS_A} sin afiliado válido`,
      badge: `${presentacionMeta.filasDescartadas} descartadas`,
      mensaje: `El Excel INECO descartó ${presentacionMeta.filasDescartadas} filas sin afiliado válido (lo habitual es ≤ ${UMBRAL_FILAS_DESCARTADAS_A}). Puede haber cambiado el formato del archivo.`,
    });
  }

  const modulosDesconocidos = new Set<string>();
  for (const row of presentacion) {
    const n = toNumero(row.modulo);
    if (!Number.isFinite(n) || !MODULOS_CONOCIDOS.has(n)) {
      modulosDesconocidos.add(row.modulo.trim() || "(vacío)");
    }
  }
  if (modulosDesconocidos.size > 0) {
    const list = [...modulosDesconocidos];
    alertas.push({
      tipo: "modulo_desconocido",
      titulo: "Módulos desconocidos en Presentación",
      meta: "Se esperan 125001 / 140010",
      items: list,
      mensaje: `Módulos desconocidos en Presentación: ${list.join(", ")}. Se esperan 125001 / 140010.`,
    });
  }

  const codigosDesconocidos = new Set<string>();
  for (const row of debitos) {
    const n = toNumero(row.prestacion);
    if (!Number.isFinite(n) || !CODIGOS_DEBITO_CONOCIDOS.has(n)) {
      codigosDesconocidos.add(row.prestacion.trim() || "(vacío)");
    }
  }
  if (codigosDesconocidos.size > 0) {
    const list = [...codigosDesconocidos];
    alertas.push({
      tipo: "codigo_desconocido",
      titulo: "Códigos desconocidos en Débitos",
      meta: "Se esperan 125 / 140",
      items: list,
      mensaje: `Códigos de prestación desconocidos en Débitos: ${list.join(", ")}. Se esperan 125 / 140.`,
    });
  }

  let multiModulo = 0;
  for (const rows of presentacionByKey.values()) {
    const mods = new Set(rows.map((r) => r.modulo.trim()));
    if (mods.size > 1) multiModulo += 1;
  }
  if (multiModulo > 0) {
    alertas.push({
      tipo: "afiliado_multi_modulo",
      titulo: "Afiliados con más de un módulo",
      meta: "En la Presentación del mes",
      badge: String(multiModulo),
      mensaje:
        multiModulo === 1
          ? "1 afiliado tiene más de un módulo en la Presentación del mes."
          : `${multiModulo} afiliados tienen más de un módulo en la Presentación del mes.`,
    });
  }

  return alertas;
}

export function cruzarPami(
  presentacion: PresentacionRow[],
  debitos: DebitoRow[],
  presentacionMeta: FileParseMeta,
  debitosMeta: FileParseMeta,
): ResultadoPami {
  const presentacionByKey = new Map<string, PresentacionRow[]>();
  for (const row of presentacion) {
    const list = presentacionByKey.get(row.afiliadoKey) ?? [];
    list.push(row);
    presentacionByKey.set(row.afiliadoKey, list);
  }

  const debitosByKey = new Map<string, DebitoRow[]>();
  for (const row of debitos) {
    const list = debitosByKey.get(row.afiliadoKey) ?? [];
    list.push(row);
    debitosByKey.set(row.afiliadoKey, list);
  }

  const opsPorModulo: Record<string, number> = {};
  for (const row of presentacion) {
    const m = row.modulo.trim() || "(sin módulo)";
    opsPorModulo[m] = (opsPorModulo[m] ?? 0) + 1;
  }

  const prestacionesPorCodigo: Record<string, number> = {};
  for (const row of debitos) {
    const p = row.prestacion.trim() || "(sin prestación)";
    prestacionesPorCodigo[p] = (prestacionesPorCodigo[p] ?? 0) + 1;
  }

  const duplicadosDebitos = detectarDuplicadosDebitos(debitos);
  const dupKeys = new Set(
    duplicadosDebitos.map(
      (d) => `${d.afiliadoNormalizado}|${d.fecha}|${d.codigo}`,
    ),
  );

  const coincidencias: Coincidencia[] = [];
  for (const [key, presentaciones] of presentacionByKey) {
    const dets = debitosByKey.get(key);
    if (!dets || dets.length === 0) continue;

    const first = presentaciones[0]!;
    const presentacionOut = presentaciones.map((p) => ({
      modulo: toNumero(p.modulo) || 0,
      numeroOp: p.nroOp,
      numeroOme: p.nroOme,
      fecha: p.fecha,
      activada: p.activada,
    }));
    const modulos = presentacionOut.map((p) => p.modulo);
    const codigos = [
      ...new Set(
        dets
          .map((d) => toNumero(d.prestacion))
          .filter((n) => Number.isFinite(n)),
      ),
    ];

    coincidencias.push({
      afiliadoNormalizado: key,
      afiliadoOriginal: first.afiliadoOriginal,
      nombre: first.nombreApellido,
      presentacion: presentacionOut,
      cantidadObservadas: dets.length,
      codigosObservados: codigos,
      detalle: dets.map((d) => {
        const codigo = toNumero(d.prestacion) || 0;
        return {
          fecha: d.fecha,
          codigo,
          tipo: d.tipo,
          motivo: d.orden,
          esDuplicado: dupKeys.has(`${d.afiliadoKey}|${d.fecha}|${codigo}`),
        };
      }),
      codigoDistintoAlModulo: !codigoObservadoCoincideConModulos(codigos, modulos),
    });
  }

  coincidencias.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const keysPresentacion = new Set(presentacionByKey.keys());
  const keysDebitos = new Set(debitosByKey.keys());
  let soloEnPresentacion = 0;
  for (const k of keysPresentacion) {
    if (!keysDebitos.has(k)) soloEnPresentacion += 1;
  }
  let soloEnDebitos = 0;
  for (const k of keysDebitos) {
    if (!keysPresentacion.has(k)) soloEnDebitos += 1;
  }

  const total125 = prestacionesPorCodigo["125"] ?? 0;
  const porAfiliado125 = new Map<string, { original: string; cantidad: number }>();
  for (const row of debitos) {
    if (row.prestacion.trim() !== "125") continue;
    const cur = porAfiliado125.get(row.afiliadoKey) ?? {
      original: row.afiliadoOriginal,
      cantidad: 0,
    };
    cur.cantidad += 1;
    porAfiliado125.set(row.afiliadoKey, cur);
  }

  const concentracion125: ConcentracionAfiliado[] = [...porAfiliado125.entries()]
    .map(([afiliadoNormalizado, v]) => ({
      afiliadoNormalizado,
      afiliadoOriginal: v.original,
      cantidad: v.cantidad,
      porcentajeDelTotal: total125 > 0 ? (v.cantidad / total125) * 100 : 0,
      estaEnPresentacion: keysPresentacion.has(afiliadoNormalizado),
    }))
    .sort(
      (a, b) =>
        b.cantidad - a.cantidad || a.afiliadoOriginal.localeCompare(b.afiliadoOriginal),
    );

  const conMasDeUna = concentracion125.filter((r) => r.cantidad > 1).length;
  const conUnaSola = concentracion125.filter((r) => r.cantidad === 1).length;

  const motivoCount = new Map<string, number>();
  for (const row of debitos) {
    const m = row.orden.trim() || "(sin motivo)";
    motivoCount.set(m, (motivoCount.get(m) ?? 0) + 1);
  }
  const totalDebitos = debitos.length || 1;
  const motivos: MotivoRechazo[] = [...motivoCount.entries()]
    .map(([motivo, cantidad]) => ({
      motivo,
      cantidad,
      porcentaje: (cantidad / totalDebitos) * 100,
    }))
    .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo));

  const alertas = buildAlertas(
    presentacion,
    debitos,
    presentacionMeta,
    presentacionByKey,
    duplicadosDebitos,
  );

  return {
    carga: {
      archivoA: {
        nombre: presentacionMeta.fileName,
        filasValidas: presentacionMeta.filasDatos,
        filasDescartadas: presentacionMeta.filasDescartadas,
      },
      archivoB: {
        nombre: debitosMeta.fileName,
        filasValidas: debitosMeta.filasDatos,
        filasDescartadas: debitosMeta.filasDescartadas,
      },
    },
    resumen: {
      opsPresentadas: presentacionMeta.filasDatos,
      opsPorModulo,
      afiliadosPresentados: presentacionByKey.size,
      prestacionesObservadas: debitosMeta.filasDatos,
      prestacionesPorCodigo,
      afiliadosObservados: debitosByKey.size,
      afiliadosCoincidentes: coincidencias.length,
      soloEnPresentacion,
      soloEnDebitos,
      concentracion125: {
        afiliadosUnicos: concentracion125.length,
        totalPrestaciones: total125,
        conMasDeUna,
        conUnaSola,
      },
    },
    coincidencias,
    concentracion125,
    motivos,
    alertas,
    duplicadosDebitos,
    presentacion,
    debitos,
  };
}

/** Regresión: comparar strings crudos sin normalizar → 0 matches. */
export function coincidenciasSinNormalizar(
  presentacionOriginales: string[],
  debitosOriginales: string[],
): number {
  const setB = new Set(debitosOriginales.map((s) => s.trim()));
  let n = 0;
  const seen = new Set<string>();
  for (const a of presentacionOriginales) {
    const t = a.trim();
    if (seen.has(t)) continue;
    seen.add(t);
    if (setB.has(t)) n += 1;
  }
  return n;
}
