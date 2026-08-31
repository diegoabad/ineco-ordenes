import { normalizarTextoCelda } from "./normalizar";

export type ColumnaEsperada = {
  /** Nombre legible para el mensaje de error. */
  label: string;
  /** Alias normalizados (sin acentos, minúsculas). */
  aliases: string[];
  /**
   * Si true, exige coincidencia exacta con algún alias (evita que "op" matchee
   * cualquier columna). Si false, permite que el header contenga el alias.
   */
  exact?: boolean;
};

/** Columnas fijas del Excel INECO (Presentación). La cantidad de filas es dinámica. */
export const COLUMNAS_PRESENTACION_INECO: ColumnaEsperada[] = [
  {
    label: "Nombre y apellido",
    aliases: ["nombre y apellido"],
  },
  {
    label: "Modulo",
    aliases: ["modulo"],
  },
  {
    label: "N° de Afiliado",
    aliases: [
      "n de afiliado",
      "nro de afiliado",
      "numero de afiliado",
      "n afiliado",
    ],
  },
  {
    label: "N° OME",
    aliases: ["n ome", "nro ome", "numero de ome", "ome"],
    exact: true,
  },
  {
    label: "Número de OP",
    aliases: ["numero de op", "n de op", "nro de op", "n op", "op"],
    exact: true,
  },
  {
    label: "Fecha",
    aliases: ["fecha"],
    exact: true,
  },
  {
    label: "Activada",
    aliases: ["activada"],
    exact: true,
  },
];

/** Columnas fijas del Excel PAMI (Débitos). La cantidad de filas es dinámica. */
export const COLUMNAS_DEBITOS_PAMI: ColumnaEsperada[] = [
  {
    label: "ORDEn",
    aliases: ["orden"],
    exact: true,
  },
  {
    label: "Fecha",
    aliases: ["fecha"],
    exact: true,
  },
  {
    label: "Afiliado",
    aliases: ["afiliado"],
    exact: true,
  },
  {
    label: "Prestacion",
    aliases: ["prestacion"],
    exact: true,
  },
  {
    label: "TIPO",
    aliases: ["tipo"],
    exact: true,
  },
];

export function headerCoincide(headerNorm: string, col: ColumnaEsperada): boolean {
  for (const alias of col.aliases) {
    const a = normalizarTextoCelda(alias);
    if (!a) continue;
    if (headerNorm === a) return true;
    if (!col.exact && (headerNorm.includes(a) || a.includes(headerNorm))) return true;
  }
  // Caso especial afiliado INECO: headers tipo "n° de afiliado"
  if (col.label === "N° de Afiliado") {
    if (headerNorm.includes("afiliado") && headerNorm !== "afiliado") return true;
  }
  return false;
}

export function resolverColumna(
  headers: Map<string, number>,
  col: ColumnaEsperada,
): number | null {
  for (const [h, idx] of headers) {
    if (headerCoincide(h, col)) return idx;
  }
  return null;
}

export class ExcelFormatoError extends Error {
  readonly archivo: "INECO" | "PAMI";
  readonly faltantes: string[];
  readonly encontradas: string[];

  constructor(opts: {
    archivo: "INECO" | "PAMI";
    faltantes: string[];
    encontradas: string[];
    detalle?: string;
  }) {
    const halladas =
      opts.encontradas.length > 0
        ? ` Columnas detectadas: ${opts.encontradas.join(" · ")}.`
        : "";
    const extra = opts.detalle ? ` ${opts.detalle}` : "";
    let msg: string;
    if (opts.faltantes.length > 0) {
      const lista = opts.faltantes.map((f) => `«${f}»`).join(", ");
      msg = `El Excel ${opts.archivo} no tiene el formato esperado. Faltan columnas: ${lista}.${halladas}${extra}`;
    } else {
      msg = `El Excel ${opts.archivo} no se pudo usar.${halladas}${extra}`;
    }
    super(msg);
    this.name = "ExcelFormatoError";
    this.archivo = opts.archivo;
    this.faltantes = opts.faltantes;
    this.encontradas = opts.encontradas;
  }
}

export function validarYResolverColumnas(
  headers: Map<string, number>,
  esperadas: ColumnaEsperada[],
  archivo: "INECO" | "PAMI",
): Map<string, number> {
  const encontradas = [...headers.keys()].filter(Boolean);
  const faltantes: string[] = [];
  const resolved = new Map<string, number>();

  for (const col of esperadas) {
    const idx = resolverColumna(headers, col);
    if (idx === null) faltantes.push(col.label);
    else resolved.set(col.label, idx);
  }

  if (faltantes.length > 0) {
    throw new ExcelFormatoError({ archivo, faltantes, encontradas });
  }

  return resolved;
}
