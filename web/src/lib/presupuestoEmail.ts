import { formatFechaYmd } from "./fechas";
import { formatNombrePersona } from "./nombrePersona";
import { formatListaPrestaciones } from "./presupuestoPrestacionesList";
import { looksLikeRichHtml, normalizeRichHtml } from "./richText";
import type { Presupuesto, PresupuestoItem } from "../types";
import type {
  PresupuestoEmailConfig,
  PresupuestoEmailTemplateVar,
} from "../types/presupuestoEmail";

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

export type PresupuestoEmailVarsInput = {
  nombrePaciente: string;
  email: string;
  profesional: string;
  fecha: string;
  totalEfectivo: number;
  total3Cuotas: number;
  items: PresupuestoItem[];
  linkPago?: string;
};

export function buildPresupuestoEmailVars(
  input: PresupuestoEmailVarsInput,
): Record<PresupuestoEmailTemplateVar, string> {
  const linkUrl = input.linkPago?.trim() || "";
  return {
    nombrePaciente: formatNombrePersona(input.nombrePaciente) || "—",
    email: input.email.trim() || "—",
    nombreProfesional: formatNombrePersona(input.profesional) || "—",
    fechaPresupuesto: formatFechaYmd(input.fecha) || input.fecha.trim() || "—",
    totalEfectivo: formatMoney(input.totalEfectivo),
    total3Cuotas: formatMoney(input.total3Cuotas),
    cantidadPrestaciones: String(input.items.length),
    listaPrestaciones: formatListaPrestaciones(input.items),
    linkPago: linkUrl,
    // Placeholder; el HTML real se arma en applyPresupuestoEmailTemplate con el |texto.
    linkPagoHipervinculo: "",
  };
}

export function buildPresupuestoEmailVarsFromPresupuesto(
  p: Presupuesto,
  linkPago?: string,
): Record<PresupuestoEmailTemplateVar, string> {
  return buildPresupuestoEmailVars({
    nombrePaciente: p.nombrePaciente,
    email: p.email,
    profesional: p.profesional,
    fecha: p.fecha,
    totalEfectivo: p.totalEfectivo,
    total3Cuotas: p.total3Cuotas,
    items: p.items,
    linkPago,
  });
}

export function renderPresupuestoEmailPreview(
  config: Pick<PresupuestoEmailConfig, "subject" | "body">,
  vars: Record<PresupuestoEmailTemplateVar, string>,
): { subject: string; body: string } {
  const nombre = vars.nombrePaciente || "paciente";
  return {
    subject:
      applyPresupuestoEmailTemplate(config.subject, vars, { plainSubject: true }).trim() ||
      `Presupuesto - ${nombre}`,
    body: applyPresupuestoEmailTemplate(config.body, vars),
  };
}

export function renderLinkPagoEmailPreview(
  config: Pick<PresupuestoEmailConfig, "linkPagoSubject" | "linkPagoBody">,
  vars: Record<PresupuestoEmailTemplateVar, string>,
): { subject: string; body: string } {
  const nombre = vars.nombrePaciente || "paciente";
  let body = applyPresupuestoEmailTemplate(config.linkPagoBody, vars);
  // Texto plano + <a> del hipervínculo: convertir saltos para el editor / mail.
  if (looksLikeRichHtml(body) && body.includes("\n")) {
    body = body.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
  }
  return {
    subject:
      applyPresupuestoEmailTemplate(config.linkPagoSubject, vars, {
        plainSubject: true,
      }).trim() || `Link de pago - ${nombre}`,
    body: normalizeRichHtml(body),
  };
}
