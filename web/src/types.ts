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
};

export type Medico = {
  id: string;
  nombre: string;
  especialidad: string;
  matricula: string;
  firmaUrl: string | null;
  activo: boolean;
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
