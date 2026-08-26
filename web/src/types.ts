export type Paciente = {
  id: string;
  paciente: string;
  obraSocial: string;
  afiliado: string;
  prestacion: string;
  diagnostico: string;
  /** Médico habitual del paciente; null = usar el médico por defecto al imprimir. */
  medicoId: string | null;
};

export type Medico = {
  id: string;
  nombre: string;
  especialidad: string;
  matricula: string;
  firmaUrl: string | null;
};

/** Datos del médico usados al dibujar el PDF. */
export type ConfigMedico = Omit<Medico, "id"> & {
  /** Data URL lista para jsPDF (se resuelve al imprimir). */
  firmaDataUrl?: string | null;
};

export type PacienteFormData = Omit<Paciente, "id">;
export type MedicoFormData = Omit<Medico, "id">;

export const EMPTY_PACIENTE: PacienteFormData = {
  paciente: "",
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
