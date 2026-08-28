export type PresupuestoEmailConfig = {
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
};

export const DEFAULT_PRESUPUESTO_EMAIL_CONFIG: PresupuestoEmailConfig = {
  fromEmail: "informes@ineco.ar",
  fromName: "Presupuestos Ineco",
  subject: "Presupuesto - {{nombrePaciente}}",
  body:
    "Estimado/a {{nombrePaciente}},\n\n" +
    "Le enviamos el presupuesto del módulo de evaluación según indicación de {{nombreProfesional}}.\n\n" +
    "Adjuntamos el detalle completo en PDF, con las prestaciones incluidas, costos y condiciones.\n\n" +
    "Ante cualquier consulta, puede responder a este correo.\n\n" +
    "Saludos cordiales,\n" +
    "Equipo de INECO",
};

export const PRESUPUESTO_EMAIL_TEMPLATE_VARS = [
  "nombrePaciente",
  "email",
  "nombreProfesional",
  "fechaPresupuesto",
  "totalEfectivo",
  "total3Cuotas",
  "cantidadPrestaciones",
  "listaPrestaciones",
] as const;

export type PresupuestoEmailTemplateVar = (typeof PRESUPUESTO_EMAIL_TEMPLATE_VARS)[number];

const TEMPLATE_VAR_ALIASES: Record<string, PresupuestoEmailTemplateVar> = {
  nombre: "nombrePaciente",
  fecha: "fechaPresupuesto",
  profesional: "nombreProfesional",
};

export function applyPresupuestoEmailTemplate(
  template: string,
  vars: Partial<Record<PresupuestoEmailTemplateVar, string>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const resolved = (TEMPLATE_VAR_ALIASES[key] ?? key) as PresupuestoEmailTemplateVar;
    const value = vars[resolved];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

export function presupuestoEmailConfigWithDefaults(
  stored: Partial<PresupuestoEmailConfig> | null,
): PresupuestoEmailConfig {
  const storedSubject = stored?.subject?.trim() || "";
  const storedBody = stored?.body?.trim() || "";

  return {
    fromEmail:
      stored?.fromEmail?.trim() ||
      process.env.SENDGRID_PRESUPUESTO_FROM_EMAIL?.trim() ||
      process.env.SENDGRID_FROM_EMAIL?.trim() ||
      DEFAULT_PRESUPUESTO_EMAIL_CONFIG.fromEmail,
    fromName:
      stored?.fromName?.trim() ||
      process.env.SENDGRID_PRESUPUESTO_FROM_NAME?.trim() ||
      DEFAULT_PRESUPUESTO_EMAIL_CONFIG.fromName,
    subject: storedSubject || DEFAULT_PRESUPUESTO_EMAIL_CONFIG.subject,
    body: storedBody || DEFAULT_PRESUPUESTO_EMAIL_CONFIG.body,
  };
}
