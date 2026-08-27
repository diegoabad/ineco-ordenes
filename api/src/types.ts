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
};

export type Medico = {
  id: string;
  nombre: string;
  especialidad: string;
  matricula: string;
  firmaUrl: string | null;
  activo: boolean;
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

export type AppDb = {
  version: number;
  medicoSeleccionadoId: string | null;
  medicos: Medico[];
  pacientes: Paciente[];
};

/** Alta/edición: el flag activo se gestiona aparte. */
export type PacienteInput = Omit<Paciente, "id" | "activo">;
export type MedicoInput = Omit<Medico, "id" | "firmaUrl" | "activo">;
