export type Paciente = {
  id: string;
  paciente: string;
  email: string;
  obraSocial: string;
  afiliado: string;
  prestacion: string;
  diagnostico: string;
  medicoId: string | null;
  activo: boolean;
  /** ISO 8601; registros nuevos primero en tablas. */
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
  /** URL pública del PDF adjunto guardado (éxito o fallo). */
  pdfUrl: string | null;
  subject: string;
  status: EmailEnvioStatus;
  errorMessage: string | null;
  enviadoAt: string;
};

export type EmailEnvioInput = Omit<EmailEnvio, "id">;

/** Prestación del módulo presupuestos (varios precios de pago). */
export type Prestacion = {
  id: string;
  titulo: string;
  descripcion: string;
  /** Ej. Evaluación, Tratamiento (valores de config presupuestos). */
  tipo: string;
  /** Duración estimada en minutos (0 = sin cargar). */
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
  titulo: string;
  nombreApellido: string;
};

export type ModalidadPresupuesto = {
  id: string;
  titulo: string;
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
  modalidadId: string;
  modalidadTitulo: string;
  modalidadTextoPdf: string;
  email: string;
  items: PresupuestoItem[];
  totalEfectivo: number;
  total3Cuotas: number;
  estado: PresupuestoEstado;
  pdfUrl: string | null;
  creadoAt?: string;
};

export type PresupuestoCreateInput = {
  nombrePaciente: string;
  profesional: string;
  modalidadId: string;
  email: string;
  prestacionIds: string[];
  pdfBase64?: string;
  enviar?: boolean;
};

export type PresupuestoUpdateInput = PresupuestoCreateInput;

export const DEFAULT_TIPOS_PRESTACION: TipoPrestacion[] = [
  { nombre: "Evaluación", color: TIPO_COLOR_PALETTE[0]! },
  { nombre: "Tratamiento", color: TIPO_COLOR_PALETTE[1]! },
];

export type AppDb = {
  version: number;
  medicoSeleccionadoId: string | null;
  medicos: Medico[];
  pacientes: Paciente[];
};

/** Alta/edición: el flag activo se gestiona aparte. */
export type PacienteInput = Omit<Paciente, "id" | "activo" | "creadoAt">;
export type MedicoInput = Omit<Medico, "id" | "firmaUrl" | "activo" | "creadoAt">;
export type PrestacionInput = Omit<Prestacion, "id" | "creadoAt">;
