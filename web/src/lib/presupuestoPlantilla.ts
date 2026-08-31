import { formatFechaYmd } from "./fechas";
import { formatListaPrestaciones } from "./presupuestoPrestacionesList";
import { richHtmlToPdfText } from "./richText";
import type { PresupuestoItem } from "../types";
import type { PresupuestoPlantillaVar } from "../types/presupuestoPlantilla";

const TEMPLATE_VAR_ALIASES: Record<string, PresupuestoPlantillaVar> = {
  nombre: "nombrePaciente",
  fecha: "fechaPresupuesto",
  profesional: "nombreProfesional",
  modalidad: "modalidadTitulo",
  lugar: "lugarEvaluacion",
  modalidadTexto: "lugarEvaluacion",
};

function formatMoney(value: number): string {
  if (!value || value <= 0) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function applyPresupuestoPlantilla(
  template: string,
  vars: Partial<Record<PresupuestoPlantillaVar, string>>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const resolved = (TEMPLATE_VAR_ALIASES[key] ?? key) as PresupuestoPlantillaVar;
    const value = vars[resolved];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

export type PresupuestoPlantillaContext = {
  nombrePaciente: string;
  email: string;
  nombreProfesional: string;
  modalidadTitulo: string;
  lugarEvaluacion: string;
  fecha: string;
  items: PresupuestoItem[];
  totalEfectivo: number;
  total3Cuotas: number;
};

export function buildPresupuestoPlantillaVars(
  input: PresupuestoPlantillaContext,
): Record<PresupuestoPlantillaVar, string> {
  return {
    nombrePaciente: input.nombrePaciente.trim() || "—",
    email: input.email.trim() || "—",
    nombreProfesional: input.nombreProfesional.trim() || "—",
    modalidadTitulo: input.modalidadTitulo.trim() || "—",
    lugarEvaluacion: input.lugarEvaluacion.trim() || "—",
    fechaPresupuesto: formatFechaYmd(input.fecha) || "—",
    totalEfectivo: formatMoney(input.totalEfectivo),
    total3Cuotas: formatMoney(input.total3Cuotas),
    cantidadPrestaciones: String(input.items.length),
    listaPrestaciones: formatListaPrestaciones(input.items),
  };
}

export function renderPresupuestoPlantillaHtml(
  templateHtml: string,
  input: PresupuestoPlantillaContext,
): string {
  const vars = buildPresupuestoPlantillaVars(input);
  return applyPresupuestoPlantilla(templateHtml, vars);
}

export function renderPresupuestoPlantillaBody(
  templateHtml: string,
  input: PresupuestoPlantillaContext,
): string {
  return richHtmlToPdfText(renderPresupuestoPlantillaHtml(templateHtml, input));
}
