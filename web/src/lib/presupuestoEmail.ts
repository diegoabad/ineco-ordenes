import { formatFechaYmd } from "./fechas";
import { formatNombrePersona } from "./nombrePersona";
import { formatListaPrestaciones } from "./presupuestoPrestacionesList";
import { looksLikeRichHtml, normalizeRichHtml } from "./richText";
import type { Presupuesto, PresupuestoItem } from "../types";
import type {
  PresupuestoEmailConfig,
  PresupuestoEmailTemplateKind,
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

const FALLBACK_SUBJECT: Record<PresupuestoEmailTemplateKind, string> = {
  presupuesto: "Presupuesto",
  presupuestoExterno: "Presupuesto",
  reenvio: "Reenvío de presupuesto",
  linkPago: "Link de pago",
};

export function plantillaSugeridaPresupuesto(p: {
  estado: string;
  ultimoEnvioAt: string | null;
  pacienteExterno?: boolean;
}): PresupuestoEmailTemplateKind {
  if (p.estado === "enviado" || p.estado === "fallido" || p.ultimoEnvioAt) return "reenvio";
  if (p.pacienteExterno) return "presupuestoExterno";
  return "presupuesto";
}

export function presupuestoEmailPair(
  config: PresupuestoEmailConfig,
  kind: PresupuestoEmailTemplateKind,
): { subject: string; body: string } {
  switch (kind) {
    case "presupuestoExterno":
      return { subject: config.externoSubject, body: config.externoBody };
    case "reenvio":
      return { subject: config.reenvioSubject, body: config.reenvioBody };
    case "linkPago":
      return { subject: config.linkPagoSubject, body: config.linkPagoBody };
    default:
      return { subject: config.subject, body: config.body };
  }
}

export function renderPresupuestoEmailByKind(
  config: PresupuestoEmailConfig,
  kind: PresupuestoEmailTemplateKind,
  vars: Record<PresupuestoEmailTemplateVar, string>,
): { subject: string; body: string } {
  const nombre = vars.nombrePaciente || "paciente";
  const pair = presupuestoEmailPair(config, kind);
  let body = applyPresupuestoEmailTemplate(pair.body, vars);
  if (kind === "linkPago" && looksLikeRichHtml(body) && body.includes("\n")) {
    body = normalizeRichHtml(body.replace(/\r\n/g, "\n").replace(/\n/g, "<br>"));
  }
  return {
    subject:
      applyPresupuestoEmailTemplate(pair.subject, vars, { plainSubject: true }).trim() ||
      `${FALLBACK_SUBJECT[kind]} - ${nombre}`,
    body,
  };
}
