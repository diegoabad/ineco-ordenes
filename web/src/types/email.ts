export type EmailConfig = {
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
};

/** Claves que se insertan en el texto: {{nombrePaciente}}, {{fechaOrden}}, etc. */
export const EMAIL_TEMPLATE_VARS = [
  "nombrePaciente",
  "email",
  "obraSocial",
  "afiliado",
  "diagnostico",
  "prestacion",
  "nombreMedico",
  "especialidad",
  "matricula",
  "fechaOrden",
] as const;

export type EmailTemplateVar = (typeof EMAIL_TEMPLATE_VARS)[number];

/** Solo para los botones (etiquetas claras). No cambian el agrupado. */
export const EMAIL_TEMPLATE_VAR_LABELS: Record<EmailTemplateVar, string> = {
  nombrePaciente: "Nombre paciente",
  email: "Email",
  obraSocial: "Obra social",
  afiliado: "Afiliado",
  diagnostico: "Diagnóstico",
  prestacion: "Prestación",
  nombreMedico: "Nombre profesional",
  especialidad: "Especialidad",
  matricula: "Matrícula",
  fechaOrden: "Fecha de la orden",
};

export const EMPTY_EMAIL_CONFIG: EmailConfig = {
  fromEmail: "",
  fromName: "",
  subject: "",
  body: "",
};
