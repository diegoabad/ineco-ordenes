/** Clave interna de afiliado (solo dígitos). */
export type AfiliadoKey = string;

export const MAPEO_PRESTACION = {
  "125": { modulo: 125001, descripcion: "Sesión de rehabilitación neurocognitiva" },
  "140": { modulo: 140010, descripcion: "Módulo mensual de rehabilitación jornada simple" },
} as const;

export const MODULOS_CONOCIDOS = new Set([125001, 140010]);
export const CODIGOS_DEBITO_CONOCIDOS = new Set([125, 140]);

/** Umbral: el bloque de totales del Archivo A suele descartar ~8 filas. */
export const UMBRAL_FILAS_DESCARTADAS_A = 12;

export type CodigoDebito = keyof typeof MAPEO_PRESTACION;
export type CodigoModulo = (typeof MAPEO_PRESTACION)[CodigoDebito]["modulo"];

export type PresentacionRow = {
  nombreApellido: string;
  modulo: string;
  afiliadoOriginal: string;
  afiliadoKey: AfiliadoKey;
  nroOme: string;
  nroOp: string;
  fecha: string;
  activada: string;
};

export type DebitoRow = {
  orden: string;
  fecha: string;
  afiliadoOriginal: string;
  afiliadoKey: AfiliadoKey;
  prestacion: string;
  tipo: string;
};

export type FileParseMeta = {
  fileName: string;
  filasDatos: number;
  filasDescartadas: number;
};

export type MetadatosArchivo = {
  nombre: string;
  filasValidas: number;
  filasDescartadas: number;
};

export type MetadatosCarga = {
  archivoA: MetadatosArchivo;
  archivoB: MetadatosArchivo;
};

export type ResumenConcentracion125 = {
  afiliadosUnicos: number;
  totalPrestaciones: number;
  conMasDeUna: number;
  conUnaSola: number;
};

export type ResumenPami = {
  opsPresentadas: number;
  opsPorModulo: Record<string, number>;
  afiliadosPresentados: number;
  prestacionesObservadas: number;
  prestacionesPorCodigo: Record<string, number>;
  afiliadosObservados: number;
  afiliadosCoincidentes: number;
  soloEnPresentacion: number;
  soloEnDebitos: number;
  concentracion125: ResumenConcentracion125;
};

export type CoincidenciaPresentacion = {
  modulo: number;
  numeroOp: string;
  numeroOme: string;
  fecha: string;
  activada: string;
};

export type CoincidenciaDetalle = {
  fecha: string;
  codigo: number;
  tipo: string;
  motivo: string;
  /** Forma parte de un grupo duplicado (mismo afiliado+fecha+código). */
  esDuplicado?: boolean;
};

export type Coincidencia = {
  afiliadoNormalizado: string;
  afiliadoOriginal: string;
  nombre: string;
  presentacion: CoincidenciaPresentacion[];
  cantidadObservadas: number;
  codigosObservados: number[];
  detalle: CoincidenciaDetalle[];
  /** Se presentó un módulo y se observó prestación de otro tipo. */
  codigoDistintoAlModulo: boolean;
};

export type ConcentracionAfiliado = {
  afiliadoOriginal: string;
  afiliadoNormalizado: string;
  cantidad: number;
  porcentajeDelTotal: number;
  estaEnPresentacion: boolean;
};

export type MotivoRechazo = {
  motivo: string;
  cantidad: number;
  porcentaje: number;
};

export type Alerta = {
  tipo: string;
  /** Texto plano (Excel / fallback). */
  mensaje: string;
  /** Título corto para el cartel. */
  titulo?: string;
  /** Línea secundaria (afiliado · fecha · código). */
  meta?: string;
  /** Chip a la derecha (ej. "2 filas"). */
  badge?: string;
  /** Lista estructurada (ej. motivos). */
  items?: string[];
  filas?: number[];
};

/** Mismo afiliado + fecha + código en Débitos, con una o más filas (motivos distintos o no). */
export type PrestacionDuplicada = {
  afiliadoOriginal: string;
  afiliadoNormalizado: string;
  fecha: string;
  codigo: number;
  motivos: string[];
  cantidadFilas: number;
};

/** Contrato de salida de la sección PAMI. */
export type ResultadoPami = {
  carga: MetadatosCarga;
  resumen: ResumenPami;
  coincidencias: Coincidencia[];
  concentracion125: ConcentracionAfiliado[];
  motivos: MotivoRechazo[];
  alertas: Alerta[];
  /** Prestaciones del Archivo B repetidas (afiliado+fecha+código); se listan todos los motivos. */
  duplicadosDebitos: PrestacionDuplicada[];
  /** Filas parseadas (export / persistencia; no son parte de la UI). */
  presentacion: PresentacionRow[];
  debitos: DebitoRow[];
};

/** Alias histórico. */
export type PamiAnalisisResult = ResultadoPami;
