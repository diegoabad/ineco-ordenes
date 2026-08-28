export type PresupuestoEmailConfig = {
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
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
};

export const EMPTY_PRESUPUESTO_EMAIL_CONFIG: PresupuestoEmailConfig = {
  fromEmail: "",
  fromName: "",
  subject: "",
  body: "",
};
