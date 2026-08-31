import { formatFechaYmd } from "./fechas";
import { formatListaPrestaciones } from "./presupuestoPrestacionesList";
import type { Presupuesto, PresupuestoItem } from "../types";
import type {
  PresupuestoEmailConfig,
  PresupuestoEmailTemplateVar,
} from "../types/presupuestoEmail";

const TEMPLATE_VAR_ALIASES: Record<string, PresupuestoEmailTemplateVar> = {
  nombre: "nombrePaciente",
  fecha: "fechaPresupuesto",
  profesional: "nombreProfesional",
};

const moneyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatMoney(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return moneyFormatter.format(value);
}

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

export type PresupuestoEmailVarsInput = {
  nombrePaciente: string;
  email: string;
  profesional: string;
  fecha: string;
  totalEfectivo: number;
  total3Cuotas: number;
  items: PresupuestoItem[];
};

export function buildPresupuestoEmailVars(
  input: PresupuestoEmailVarsInput,
): Record<PresupuestoEmailTemplateVar, string> {
  return {
    nombrePaciente: input.nombrePaciente.trim() || "—",
    email: input.email.trim() || "—",
    nombreProfesional: input.profesional.trim() || "—",
    fechaPresupuesto: formatFechaYmd(input.fecha) || input.fecha.trim() || "—",
    totalEfectivo: formatMoney(input.totalEfectivo),
    total3Cuotas: formatMoney(input.total3Cuotas),
    cantidadPrestaciones: String(input.items.length),
    listaPrestaciones: formatListaPrestaciones(input.items),
  };
}

export function buildPresupuestoEmailVarsFromPresupuesto(
  p: Presupuesto,
): Record<PresupuestoEmailTemplateVar, string> {
  return buildPresupuestoEmailVars({
    nombrePaciente: p.nombrePaciente,
    email: p.email,
    profesional: p.profesional,
    fecha: p.fecha,
    totalEfectivo: p.totalEfectivo,
    total3Cuotas: p.total3Cuotas,
    items: p.items,
  });
}

export function renderPresupuestoEmailPreview(
  config: Pick<PresupuestoEmailConfig, "subject" | "body">,
  vars: Record<PresupuestoEmailTemplateVar, string>,
): { subject: string; body: string } {
  const nombre = vars.nombrePaciente || "paciente";
  return {
    subject:
      applyPresupuestoEmailTemplate(config.subject, vars).trim() || `Presupuesto - ${nombre}`,
    body: applyPresupuestoEmailTemplate(config.body, vars),
  };
}
