export type EmailConfig = {
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
};

export const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  fromEmail: "informes@ineco.ar",
  fromName: "Órdenes Ineco",
  subject: "Orden médica - {{nombrePaciente}}",
  body:
    "Hola {{nombrePaciente}},\n\nAdjuntamos tu orden médica correspondiente a la fecha {{fechaOrden}}.\n\nMédico: {{nombreMedico}}\nEspecialidad: {{especialidad}}\nMatrícula: {{matricula}}\nDiagnóstico: {{diagnostico}}\n\nSaludos.",
};

const LEGACY_DEFAULT_BODIES = [
  "Hola {{nombre}},\n\nAdjuntamos tu orden médica correspondiente a la fecha {{fecha}}.\n\nMédico: {{medico}}\nDiagnóstico: {{diagnostico}}\n\nSaludos.",
  "Hola {{nombre}},\n\nAdjuntamos tu orden médica correspondiente a la fecha {{fecha}}.\n\nMédico: {{medico}}\nEspecialidad: {{especialidad}}\nMatrícula: {{matricula}}\nDiagnóstico: {{diagnostico}}\n\nSaludos.",
  "Hola {{nombre}},\n\nAdjuntamos tu orden médica correspondiente a la fecha de la orden {{fecha}}.\n\nMédico: {{medico}}\nEspecialidad: {{especialidad}}\nMatrícula: {{matricula}}\nDiagnóstico: {{diagnostico}}\n\nSaludos.",
];

/** Variables del sistema (las que se insertan en {{...}}). */
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

/** Claves viejas en plantillas guardadas. */
const TEMPLATE_VAR_ALIASES: Record<string, EmailTemplateVar> = {
  nombre: "nombrePaciente",
  medico: "nombreMedico",
  fecha: "fechaOrden",
};

export function migrateEmailTemplateText(text: string): string {
  return text
    .replace(/\{\{\s*nombre\s*\}\}/g, "{{nombrePaciente}}")
    .replace(/\{\{\s*medico\s*\}\}/g, "{{nombreMedico}}")
    .replace(/\{\{\s*fecha\s*\}\}/g, "{{fechaOrden}}");
}

export function applyEmailTemplate(
  template: string,
  vars: Partial<Record<EmailTemplateVar, string>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const resolved = (TEMPLATE_VAR_ALIASES[key] ?? key) as EmailTemplateVar;
    const value = vars[resolved];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

export function emailConfigWithEnvDefaults(stored: Partial<EmailConfig> | null): EmailConfig {
  const storedBody = stored?.body?.trim() || "";
  const storedSubject = stored?.subject?.trim() || "";

  const body =
    !storedBody || LEGACY_DEFAULT_BODIES.includes(storedBody)
      ? DEFAULT_EMAIL_CONFIG.body
      : migrateEmailTemplateText(storedBody);

  const subject = !storedSubject
    ? DEFAULT_EMAIL_CONFIG.subject
    : migrateEmailTemplateText(storedSubject);

  return {
    fromEmail:
      stored?.fromEmail?.trim() ||
      process.env.SENDGRID_FROM_EMAIL?.trim() ||
      DEFAULT_EMAIL_CONFIG.fromEmail,
    fromName:
      stored?.fromName?.trim() ||
      process.env.SENDGRID_FROM_NAME?.trim() ||
      DEFAULT_EMAIL_CONFIG.fromName,
    subject,
    body,
  };
}
