export type Paciente = {
  id: string;
  paciente: string;
  email: string;
  obraSocial: string;
  afiliado: string;
  prestacion: string;
  diagnostico: string;
  /** Médico habitual del paciente; null = usar el médico por defecto al imprimir. */
  medicoId: string | null;
  activo: boolean;
  creadoAt?: string;
};

export type Medico = {
  id: string;
  nombre: string;
  especialidad: string;
  matricula: string;
  firmaUrl: string | null;
  activo: boolean;
  creadoAt?: string;
};

/** Datos del médico usados al dibujar el PDF. */
export type ConfigMedico = Omit<Medico, "id" | "activo"> & {
  /** Data URL lista para jsPDF (se resuelve al imprimir). */
  firmaDataUrl?: string | null;
};

export type PacienteFormData = Omit<Paciente, "id" | "activo">;
export type MedicoFormData = Omit<Medico, "id" | "activo">;

export const EMPTY_PACIENTE: PacienteFormData = {
  paciente: "",
  email: "",
  obraSocial: "",
  afiliado: "",
  prestacion: "",
  diagnostico: "",
  medicoId: null,
};

export const EMPTY_MEDICO: MedicoFormData = {
  nombre: "",
  especialidad: "",
  matricula: "",
  firmaUrl: null,
};

export const DEFAULT_MEDICO: MedicoFormData = {
  nombre: "Leandro Kim",
  especialidad: "Médico Neurólogo",
  matricula: "162519",
  firmaUrl: null,
};

export type MedicoSavePayload = {
  data: MedicoFormData;
  id?: string;
  firmaFile?: File | null;
  removeFirma?: boolean;
};

export type EmailEnvioStatus = "ok" | "error";

export type EmailEnvio = {
  id: string;
  pacienteId: string;
  pacienteNombre: string;
  toEmail: string;
  medicoId: string | null;
  medicoNombre: string;
  fechaOrden: string;
  filename: string;
  pdfUrl: string | null;
  subject: string;
  status: EmailEnvioStatus;
  errorMessage: string | null;
  enviadoAt: string;
};

export type FiltroActivo = "activos" | "inactivos" | "todos";

/** Prestación del módulo presupuestos. */
export type Prestacion = {
  id: string;
  titulo: string;
  descripcion: string;
  tipo: string;
  duracionMinutos: number;
  /** Precio efectivo / transferencia (mismo valor). */
  precioEfectivo: number;
  precio3Cuotas: number;
  creadoAt?: string;
};

export type TipoPrestacion = {
  nombre: string;
  /** Color hex (#rrggbb) para chips en la UI. */
  color: string;
};

export type PresupuestosConfig = {
  tiposPrestacion: TipoPrestacion[];
  profesionales: ProfesionalPresupuesto[];
  modalidades: ModalidadPresupuesto[];
};

export type ProfesionalPresupuesto = {
  id: string;
  /** Ej.: Dr., Dra., Lic. */
  titulo: string;
  nombreApellido: string;
};

/** Modalidad de atención (Presencial / Virtual, etc.). */
export type ModalidadPresupuesto = {
  id: string;
  /** Nombre visible en el select, ej. Presencial. */
  titulo: string;
  /** Texto que va al PDF (dirección o “modalidad virtual”). */
  textoPdf: string;
};

export const DEFAULT_MODALIDADES_PRESUPUESTO: ModalidadPresupuesto[] = [
  {
    id: "presencial",
    titulo: "Presencial",
    textoPdf: "INECO - Marcelo T. de Alvear 1632, CABA",
  },
  {
    id: "virtual",
    titulo: "Virtual",
    textoPdf: "modalidad virtual",
  },
];

export const TIPO_COLOR_PALETTE = [
  "#2563eb",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#0891b2",
  "#db2777",
  "#4f46e5",
] as const;

export const DEFAULT_TIPOS_PRESTACION: TipoPrestacion[] = [
  { nombre: "Evaluación", color: TIPO_COLOR_PALETTE[0]! },
  { nombre: "Tratamiento", color: TIPO_COLOR_PALETTE[1]! },
];

export type PrestacionFormData = Omit<Prestacion, "id">;

export const EMPTY_PRESTACION: PrestacionFormData = {
  titulo: "",
  descripcion: "",
  tipo: DEFAULT_TIPOS_PRESTACION[0]!.nombre,
  duracionMinutos: 0,
  precioEfectivo: 0,
  precio3Cuotas: 0,
};

export type PresupuestoEstado = "pendiente" | "enviado" | "aceptado" | "rechazado" | "fallido";

export type PresupuestoItem = {
  prestacionId: string;
  titulo: string;
  descripcion: string;
  tipo: string;
  duracionMinutos: number;
  precioEfectivo: number;
  precio3Cuotas: number;
};

export type Presupuesto = {
  id: string;
  fecha: string;
  nombrePaciente: string;
  profesional: string;
  /** Id de modalidad en config (snapshot). */
  modalidadId: string;
  modalidadTitulo: string;
  modalidadTextoPdf: string;
  email: string;
  items: PresupuestoItem[];
  totalEfectivo: number;
  total3Cuotas: number;
  estado: PresupuestoEstado;
  pdfUrl: string | null;
  /** ISO del último intento de envío (éxito o fallo). */
  ultimoEnvioAt: string | null;
  creadoAt?: string;
};

export type PresupuestoFormData = {
  nombrePaciente: string;
  profesional: string;
  modalidadId: string;
  email: string;
  prestacionIds: string[];
};

export const PRESUPUESTO_ESTADO_LABEL: Record<PresupuestoEstado, string> = {
  pendiente: "Pendiente",
  enviado: "Enviado",
  aceptado: "Aceptado",
  rechazado: "Rechazado",
  fallido: "Fallido",
};
