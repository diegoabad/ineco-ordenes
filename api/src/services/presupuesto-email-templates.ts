export type PresupuestoEmailConfig = {
  fromEmail: string;
  fromName: string;
  /** Plantilla al enviar el presupuesto (PDF). */
  subject: string;
  body: string;
  /** Plantilla al enviar el link de pago (Mercado Pago). */
  linkPagoSubject: string;
  linkPagoBody: string;
};

export type PresupuestoEmailTemplateKind = "presupuesto" | "linkPago";

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
  linkPagoSubject: "Link de pago - {{nombrePaciente}}",
  linkPagoBody:
    "Estimado/a {{nombrePaciente}},\n\n" +
    "¡Gracias por aceptar el presupuesto!\n\n" +
    "Para abonar el total en 3 cuotas sin interés, puede hacerlo desde el siguiente enlace:\n\n" +
    "{{linkPagoHipervinculo|Link de pago Mercado Pago}}\n\n" +
    "Monto: {{total3Cuotas}}\n\n" +
    "Ante cualquier consulta, puede responder a este correo.\n\n" +
    "Saludos cordiales,\n" +
    "Equipo de INECO",
};

/** Variables de la plantilla de presupuesto (envío PDF). */
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

/** Variables de la plantilla de link de pago. */
export const LINK_PAGO_EMAIL_TEMPLATE_VARS = [
  "nombrePaciente",
  "email",
  "nombreProfesional",
  "fechaPresupuesto",
  "totalEfectivo",
  "total3Cuotas",
  "cantidadPrestaciones",
  "listaPrestaciones",
  "linkPago",
  "linkPagoHipervinculo",
] as const;

/** Unión de todas las variables conocidas (reemplazo en templates). */
export const ALL_PRESUPUESTO_EMAIL_TEMPLATE_VARS = [
  ...PRESUPUESTO_EMAIL_TEMPLATE_VARS,
  "linkPago",
  "linkPagoHipervinculo",
] as const;

export type PresupuestoEmailTemplateVar =
  (typeof ALL_PRESUPUESTO_EMAIL_TEMPLATE_VARS)[number];

export const EMAIL_TEMPLATE_VARS_BY_KIND = {
  presupuesto: PRESUPUESTO_EMAIL_TEMPLATE_VARS,
  linkPago: LINK_PAGO_EMAIL_TEMPLATE_VARS,
} as const;

const TEMPLATE_VAR_ALIASES: Record<string, PresupuestoEmailTemplateVar> = {
  nombre: "nombrePaciente",
  fecha: "fechaPresupuesto",
  profesional: "nombreProfesional",
  link: "linkPago",
};

/** Texto por defecto del hipervínculo de Mercado Pago. */
export const LINK_PAGO_EMAIL_LABEL = "Link de pago Mercado Pago";

const TEMPLATE_TOKEN_RE =
  /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([^}]*?))?\s*\}\}/g;

/** Convierte la URL en un `<a>` con el texto visible indicado. */
export function formatLinkPagoHtml(
  url: string,
  label: string = LINK_PAGO_EMAIL_LABEL,
): string {
  const href = url.trim();
  if (!href) return "";
  const safeHref = href
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  const safeLabel = (label.trim() || LINK_PAGO_EMAIL_LABEL)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<a href="${safeHref}">${safeLabel}</a>`;
}

export function applyPresupuestoEmailTemplate(
  template: string,
  vars: Partial<Record<PresupuestoEmailTemplateVar, string>>,
  options?: { plainSubject?: boolean },
): string {
  return template.replace(TEMPLATE_TOKEN_RE, (_match, key: string, labelArg?: string) => {
    const resolved = (TEMPLATE_VAR_ALIASES[key] ?? key) as PresupuestoEmailTemplateVar;
    if (resolved === "linkPagoHipervinculo") {
      const url = (vars.linkPago ?? "").trim();
      if (!url) return "";
      const label = labelArg?.trim() || LINK_PAGO_EMAIL_LABEL;
      if (options?.plainSubject) return label;
      return formatLinkPagoHtml(url, label);
    }
    const value = vars[resolved];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

export function presupuestoEmailConfigWithDefaults(
  stored: Partial<PresupuestoEmailConfig> | null,
): PresupuestoEmailConfig {
  const storedSubject = stored?.subject?.trim() || "";
  const storedBody = stored?.body?.trim() || "";
  const storedLinkSubject = stored?.linkPagoSubject?.trim() || "";
  const storedLinkBody = stored?.linkPagoBody?.trim() || "";

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
    linkPagoSubject: storedLinkSubject || DEFAULT_PRESUPUESTO_EMAIL_CONFIG.linkPagoSubject,
    linkPagoBody: storedLinkBody || DEFAULT_PRESUPUESTO_EMAIL_CONFIG.linkPagoBody,
  };
}
