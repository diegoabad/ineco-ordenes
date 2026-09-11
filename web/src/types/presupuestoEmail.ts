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
] as const;

export const ALL_PRESUPUESTO_EMAIL_TEMPLATE_VARS = [
  ...PRESUPUESTO_EMAIL_TEMPLATE_VARS,
  "linkPago",
] as const;

export type PresupuestoEmailTemplateVar =
  (typeof ALL_PRESUPUESTO_EMAIL_TEMPLATE_VARS)[number];

export const PRESUPUESTO_EMAIL_TEMPLATE_VAR_LABELS: Record<
  PresupuestoEmailTemplateVar,
  string
> = {
  nombrePaciente: "Nombre paciente",
  email: "Email",
  nombreProfesional: "Nombre profesional",
  fechaPresupuesto: "Fecha del presupuesto",
  totalEfectivo: "Total en efectivo",
  total3Cuotas: "Total en 3 cuotas",
  cantidadPrestaciones: "Cantidad de prestaciones",
  listaPrestaciones: "Lista de prestaciones",
  linkPago: "Link de pago",
};

export const EMAIL_TEMPLATE_VARS_BY_KIND: Record<
  PresupuestoEmailTemplateKind,
  readonly PresupuestoEmailTemplateVar[]
> = {
  presupuesto: PRESUPUESTO_EMAIL_TEMPLATE_VARS,
  linkPago: LINK_PAGO_EMAIL_TEMPLATE_VARS,
};

export const EMPTY_PRESUPUESTO_EMAIL_CONFIG: PresupuestoEmailConfig = {
  fromEmail: "",
  fromName: "",
  subject: "",
  body: "",
  linkPagoSubject: "",
  linkPagoBody: "",
};
