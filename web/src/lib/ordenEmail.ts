import { formatFechaYmd } from "./fechas";
import { formatNombrePersona } from "./nombrePersona";
import type { Paciente } from "../types";
import type { EmailConfig, EmailTemplateVar } from "../types/email";

const TEMPLATE_VAR_ALIASES: Record<string, EmailTemplateVar> = {
  nombre: "nombrePaciente",
  medico: "nombreMedico",
  fecha: "fechaOrden",
};

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

export type OrdenEmailVarsInput = {
  paciente: Paciente;
  medicoNombre: string;
  especialidad: string;
  matricula: string;
  fecha: string;
};

export function buildOrdenEmailVars(
  input: OrdenEmailVarsInput,
): Record<EmailTemplateVar, string> {
  const fechaRaw = input.fecha.trim();
  return {
    nombrePaciente: formatNombrePersona(input.paciente.paciente) || "—",
    email: input.paciente.email.trim() || "—",
    obraSocial: input.paciente.obraSocial.trim() || "—",
    afiliado: input.paciente.afiliado.trim() || "—",
    diagnostico: input.paciente.diagnostico.trim() || "—",
    prestacion: input.paciente.prestacion.trim() || "—",
    nombreMedico: formatNombrePersona(input.medicoNombre) || "—",
    especialidad: input.especialidad.trim() || "—",
    matricula: input.matricula.trim() || "—",
    fechaOrden: formatFechaYmd(fechaRaw) || fechaRaw || "—",
  };
}

export function renderOrdenEmailPreview(
  config: Pick<EmailConfig, "subject" | "body">,
  vars: Record<EmailTemplateVar, string>,
): { subject: string; body: string } {
  return {
    subject: applyEmailTemplate(config.subject, vars).trim() || "Orden médica",
    body: applyEmailTemplate(config.body, vars),
  };
}
