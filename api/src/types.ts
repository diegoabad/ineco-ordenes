export type Paciente = {
  id: string;
  paciente: string;
  obraSocial: string;
  afiliado: string;
  prestacion: string;
  diagnostico: string;
  medicoId: string | null;
};

export type Medico = {
  id: string;
  nombre: string;
  especialidad: string;
  matricula: string;
  firmaUrl: string | null;
};

export type AppDb = {
  version: number;
  medicoSeleccionadoId: string | null;
  medicos: Medico[];
  pacientes: Paciente[];
};

export type PacienteInput = Omit<Paciente, "id">;
export type MedicoInput = Omit<Medico, "id" | "firmaUrl">;
