import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode } from "react";
import { toast } from "react-toastify";
import { useAuth } from "../auth/AuthContext";
import { formatFechaConDia, formatFechaHora, formatFechaYmd, fechaHoyIso, indiceDiaSemanaYmd } from "../lib/fechas";
import { formatNombrePersona } from "../lib/nombrePersona";
import {
  extractSlashQuery,
  formatTrigger,
  quickReplyVars,
  resolveQuickReply,
  type QuickReply,
} from "../lib/quickReplies";
import {
  consumePendingWaContact,
  subscribeOpenWaContact,
} from "../lib/whatsappNav";
import {
  assignWaConversation,
  resolveWaConversation,
  setWaDiagnosticoPresuntivo,
  connectWhatsapp,
  fetchWaConversation,
  fetchWaConversationByContact,
  fetchWaHistorialTurnos,
  fetchWaConversations,
  fetchWaMessages,
  fetchWaLlmUsage,
  fetchWaOperators,
  type WaLlmUsage,
  fetchQuickReplies,
  fetchWaAccesos,
  fetchWaTagCatalog,
  fetchWhatsappBotConfig,
  fetchWhatsappCrmHealth,
  fetchWhatsappMotorConfig,
  fetchWhatsappStatus,
  markWaConversationRead,
  matchWaPrestacion,
  createWaPrueba,
  saveWaAccesos,
  saveWaPruebaNota,
  sendWaMedia,
  sendWaMessage,
  sendWaPruebaMessage,
  setWaConversationTags,
  updateWaContact,
  type WaTurnoFicha,
  waMediaUrl,
} from "../services/whatsappCrmService";
import type { WaContact, WaConversation, WaMessage, WaOperator, WaTag, WaTagGroup } from "../types/whatsappCrm";
import { waAssigneeLabel, waContactLabel, waContactThreadHeader, waPruebaTitulo } from "../types/whatsappCrm";
import { DatePicker } from "./DatePicker";
import {
  IconCheck,
  IconCollapse,
  IconConversations,
  IconExpand,
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconGrip,
  IconLink,
  IconMinus,
  IconAlert,
  IconPin,
  IconPlus,
  IconSearch,
  IconUsers,
} from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import {
  WhatsAppContactFollowUpModal,
  type WaFollowUpKind,
} from "./WhatsAppContactFollowUpModal";
import { WhatsAppContactProfileModal } from "./WhatsAppContactProfileModal";
import BuscaTurnoApp from "./busca-turno/BuscaTurnoApp";
import { fetchBuscaTurnoConfig } from "./busca-turno/buscaTurnoConfigApi";
import { anularTurno, apiPost, getTurnos } from "./busca-turno/medexisApi";

const CONVERSATIONS_PAGE_SIZE = 40;

type DatoCampo =
  | "firstName"
  | "lastName"
  | "fullName"
  | "dni"
  | "email"
  | "contactoNombre"
  | "contactoApellido";

function esCaracterDePalabra(char: string): boolean {
  return /[\p{L}\p{N}@._+-]/u.test(char);
}

function seleccionarPalabra(x: number, y: number, root: HTMLElement): string {
  const doc = document as Document & {
    caretPositionFromPoint?: (px: number, py: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (px: number, py: number) => Range | null;
  };
  const hit = doc.caretPositionFromPoint?.(x, y);
  const rangeHit = hit ? null : doc.caretRangeFromPoint?.(x, y);
  const rawNode = hit?.offsetNode ?? rangeHit?.startContainer ?? null;
  const rawOffset = hit?.offset ?? rangeHit?.startOffset ?? 0;
  if (!rawNode || !root.contains(rawNode)) return "";
  let textNode: Text | null = null;
  let offset = rawOffset;
  if (rawNode.nodeType === Node.TEXT_NODE) {
    textNode = rawNode as Text;
  } else if (rawNode.nodeType === Node.ELEMENT_NODE) {
    const child = rawNode.childNodes[Math.min(rawOffset, rawNode.childNodes.length - 1)];
    if (child?.nodeType === Node.TEXT_NODE) {
      textNode = child as Text;
      offset = rawOffset >= rawNode.childNodes.length ? textNode.length : 0;
    }
  }
  if (!textNode) return "";
  const value = textNode.textContent ?? "";
  let start = Math.min(offset, value.length);
  let end = start;
  if (start > 0 && !esCaracterDePalabra(value[start] ?? "") && esCaracterDePalabra(value[start - 1] ?? "")) {
    start -= 1;
    end = start;
  }
  while (start > 0 && esCaracterDePalabra(value[start - 1] ?? "")) start -= 1;
  while (end < value.length && esCaracterDePalabra(value[end] ?? "")) end += 1;
  if (start === end) return "";
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return value.slice(start, end);
}

function datoOpciones(text: string, tercero: boolean): { campo: DatoCampo; label: string }[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const items: { campo: DatoCampo; label: string }[] = [
    { campo: "firstName", label: "Nombre" },
    { campo: "lastName", label: "Apellido" },
  ];
  if (words.length >= 2) items.push({ campo: "fullName", label: "Nombre y apellido" });
  items.push({ campo: "dni", label: "DNI" }, { campo: "email", label: "Email" });
  if (tercero) {
    items.push(
      { campo: "contactoNombre", label: "Nombre de quien escribe" },
      { campo: "contactoApellido", label: "Apellido de quien escribe" },
    );
  }
  return items;
}

function sameMessageList(a: WaMessage[], b: WaMessage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.id !== y.id) return false;
    if ((x.text ?? "") !== (y.text ?? "")) return false;
    if (x.status !== y.status) return false;
    if (x.isDeleted !== y.isDeleted) return false;
  }
  return true;
}

function mergeMensajesServidor(prev: WaMessage[], server: WaMessage[]): WaMessage[] {
  const locales = prev.filter((item) => item.id.startsWith("local-"));
  let next: WaMessage[];
  if (!locales.length) {
    next = server;
  } else {
    const usados = new Set<string>();
    const pendientes = locales.filter((local) => {
      const match = server.find((msg) => {
        if (usados.has(msg.id)) return false;
        if (msg.direction !== local.direction) return false;
        if ((msg.text ?? "").trim() !== (local.text ?? "").trim()) return false;
        const delta = Math.abs(Date.parse(msg.createdAt) - Date.parse(local.createdAt));
        return Number.isFinite(delta) && delta < 20_000;
      });
      if (!match) return true;
      usados.add(match.id);
      return false;
    });
    next = !pendientes.length
      ? server
      : [...server, ...pendientes].sort(
          (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
        );
  }
  return sameMessageList(prev, next) ? prev : next;
}

type WaInboxFilters = {
  assignee: string;
  tagIds: string[];
  dateFrom: string;
  dateTo: string;
};

const EMPTY_WA_FILTERS: WaInboxFilters = {
  assignee: "",
  tagIds: [],
  dateFrom: "",
  dateTo: "",
};

function countWaFilters(filters: WaInboxFilters): number {
  let n = 0;
  if (filters.assignee) n += 1;
  if (filters.tagIds.length > 0) n += 1;
  if (filters.dateFrom || filters.dateTo) n += 1;
  return n;
}

function waFiltersQuery(filters: WaInboxFilters): {
  assignee?: string;
  tagIds?: string[];
  dateFrom?: string;
  dateTo?: string;
} {
  return {
    assignee: filters.assignee || undefined,
    tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };
}

function formatPreviewTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return formatFechaHora(iso);
  } catch {
    return "";
  }
}

/** Firma liviana para no re-renderizar la lista si el poll no cambió nada visible. */
function conversationListSignature(c: WaConversation): string {
  const contact = c.contact;
  return [
    c.id,
    c.lastMessageAt ?? "",
    c.updatedAt ?? "",
    String(c.unreadCount ?? 0),
    c.assigneeKind ?? "",
    c.assigneeUserId ?? "",
    c.assigneeName ?? "",
    (c.tagIds ?? []).join(","),
    c.lastMessagePreview ?? "",
    c.resumen ?? "",
    c.pruebaResultado ?? "",
    contact?.displayName ?? "",
    contact?.firstName ?? "",
    contact?.lastName ?? "",
    contact?.updatedAt ?? "",
  ].join("\u001f");
}

function sameConversationList(a: WaConversation[], b: WaConversation[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (conversationListSignature(a[i]!) !== conversationListSignature(b[i]!)) return false;
  }
  return true;
}

function patchConversationInList(
  list: WaConversation[],
  incoming: WaConversation,
  touch: AssigneeTouch | null,
): WaConversation[] {
  const idx = list.findIndex((item) => item.id === incoming.id);
  if (idx < 0) return list;
  const current = list[idx]!;
  const merged = mergeConversationKeepAssignee(current, incoming, touch);
  if (conversationListSignature(merged) === conversationListSignature(current)) return list;
  const next = list.slice();
  next[idx] = merged;
  return next;
}

type CancelTurnoPendiente = {
  dni: string;
  profesional: string;
  prestacion: string;
  /** `YYYY-MM-DD HH:mm` */
  fechaHora: string;
  resumen: string;
  messageId?: string;
};

type AccionPendienteKind = "busca_turno" | "cancelar_turno";

type AccionPendiente = {
  id: string;
  kind: AccionPendienteKind;
  createdAt: string;
  title: string;
  explanation: string;
  details: Array<{ label: string; value: string }>;
  messageText: string;
};

function esMensajePedidoTurno(text: string): boolean {
  return /^Datos del pedido de turno:/i.test(String(text ?? "").trim());
}

/** Pedido cerrado: el paciente ya eligió el turno y el motivo. No espera a que la recepción lo anule. */
function esMensajeCancelacionTurno(text: string): boolean {
  const t = String(text ?? "").trim();
  return (
    /^Pedido de cancelación registrado/i.test(t) ||
    /registramos tu pedido de cancelaci[oó]n/i.test(t)
  );
}

function textoPrevioCancelacion(
  lista: Array<{ direction?: string; isDeleted?: boolean; text?: string | null }>,
  index: number,
): string {
  for (let i = index - 1; i >= 0 && i >= index - 8; i -= 1) {
    const prev = lista[i];
    if (!prev || prev.direction !== "OUTBOUND" || prev.isDeleted) continue;
    const body = String(prev.text ?? "");
    if (/ser[aá] cancelado/i.test(body) || /FechaISO/i.test(body)) return body;
  }
  return "";
}

function campoGlobo(text: string, etiqueta: string): string {
  const re = new RegExp(`^[•\\-]?\\s*${etiqueta}:\\s*(.+)$`, "im");
  return text.match(re)?.[1]?.trim() || "";
}

function normWa(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Extrae DNI / prof / fecha del globo de cancelación para anular en Medexis. */
function parseCancelacionBubble(text: string, dniEstado = ""): CancelTurnoPendiente | null {
  const dni = (campoGlobo(text, "DNI") || dniEstado).replace(/\D/g, "");
  const profesional = campoGlobo(text, "Prof\\.") || campoGlobo(text, "Profesional");
  const prestacion = campoGlobo(text, "Prest\\.") || campoGlobo(text, "Prestaci[oó]n");
  let fechaHora = campoGlobo(text, "FechaISO").replace("T", " ").slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(fechaHora)) {
    const legible = text.match(
      /(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/i,
    );
    if (legible) {
      const dia = legible[1]!.padStart(2, "0");
      const mes = legible[2]!.padStart(2, "0");
      let anio = legible[3]!;
      if (anio.length === 2) anio = `20${anio}`;
      const hh = legible[4]!.padStart(2, "0");
      const mm = legible[5]!;
      fechaHora = `${anio}-${mes}-${dia} ${hh}:${mm}`;
    } else {
      fechaHora = "";
    }
  }
  if (!dni || !profesional || !fechaHora) return null;
  const resumen = [
    `DNI ${dni}`,
    profesional,
    prestacion || null,
    fechaHora,
  ]
    .filter(Boolean)
    .join(" · ");
  return { dni, profesional, prestacion, fechaHora, resumen };
}

function filasTurnoMedexis(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (!data || typeof data !== "object") return [];
  const row = data as Record<string, unknown>;
  if (row.Resultado === "ERROR" || row.Respuesta === "ERROR") return [];
  const lista = row.Turnos ?? row.turnos;
  if (Array.isArray(lista)) {
    return lista.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (row.TurnoFechaHora || row.turnoFechaHora) return [row];
  return [];
}

/** `YYYY-MM-DD HH:mm` en hora Argentina. */
function fechaHoraBaDeCrudo(crudo: string): string {
  const d = new Date(crudo);
  if (!Number.isNaN(d.getTime())) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const g = (tipo: string) => parts.find((p) => p.type === tipo)?.value || "";
    return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
  }
  const iso = crudo.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}`;
  return "";
}

type FranjaTurno = { dia: number; desde: number; hasta: number };
type PreferenciaTurnos = { franjas: FranjaTurno[]; texto: string };

function reloj(minutos: number): string {
  const hora = Math.floor(minutos / 60);
  const minuto = minutos % 60;
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

function agruparHorarios(minutos: number[]): { desde: number; hasta: number; etiqueta: string }[] {
  const ordenados = [...minutos].sort((a, b) => a - b);
  const grupos: number[][] = [];
  for (const minuto of ordenados) {
    const ultimo = grupos[grupos.length - 1];
    const previo = ultimo?.[ultimo.length - 1];
    if (ultimo && previo != null && minuto - previo <= 120) ultimo.push(minuto);
    else grupos.push([minuto]);
  }
  return grupos.map((grupo) => {
    const menor = Math.min(...grupo);
    const mayor = Math.max(...grupo);
    const etiqueta =
      menor === mayor ? `a las ${reloj(menor)}` : `entre las ${reloj(menor)} y las ${reloj(mayor)}`;
    return { desde: menor, hasta: mayor, etiqueta };
  });
}

function preferenciaDeTurnos(
  turnos: { fecha: string; hora: string; estado: string }[],
): PreferenciaTurnos | null {
  const base = turnos.filter((turno) => {
    const estado = normWa(turno.estado);
    return !estado.includes("cancel") && !estado.includes("anul");
  });
  if (base.length < 1) return null;
  const porDia = new Map<number, number[]>();
  for (const turno of base) {
    const dia = indiceDiaSemanaYmd(turno.fecha);
    const hora = /^(\d{1,2}):(\d{2})/.exec(turno.hora.trim());
    if (dia == null || !hora) continue;
    const minuto = Number(hora[1]) * 60 + Number(hora[2]);
    const lista = porDia.get(dia) ?? [];
    lista.push(minuto);
    porDia.set(dia, lista);
  }
  const franjas = [...porDia.entries()]
    .sort((a, b) => ((a[0] + 6) % 7) - ((b[0] + 6) % 7))
    .flatMap(([dia, minutos]) =>
      agruparHorarios(minutos).map((franja) => ({
        dia,
        desde: franja.desde,
        hasta: franja.hasta,
        etiqueta: franja.etiqueta,
      })),
    );
  if (!franjas.length) return null;
  const nombres = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const grupos = new Map<string, string[]>();
  for (const franja of franjas) {
    const dias = grupos.get(franja.etiqueta) ?? [];
    dias.push(nombres[franja.dia] ?? "");
    grupos.set(franja.etiqueta, dias);
  }
  const texto = [...grupos.entries()]
    .map(([hora, dias]) => {
      const lista =
        dias.length === 1 ? dias[0] : `${dias.slice(0, -1).join(", ")} y ${dias[dias.length - 1]}`;
      const titulo = lista ? lista.charAt(0).toUpperCase() + lista.slice(1) : lista;
      return `${titulo} ${hora}`;
    })
    .join(" · ");
  return { franjas: franjas.map(({ dia, desde, hasta }) => ({ dia, desde, hasta })), texto };
}

function mismaPrestacion(a: string, b: string): boolean {
  const marca = (texto: string) =>
    ["infantil", "online", "virtual", "domicilio", "30"]
      .filter((item) => normWa(texto).includes(item))
      .sort()
      .join("|");
  if (!normWa(a) || !normWa(b)) return false;
  if (normWa(a) === normWa(b)) return true;
  return scoreNombreProf(a, b) >= 80 && marca(a) === marca(b);
}

function claseEstadoTurno(estado: string): string {
  const n = normWa(estado);
  if (n.includes("cancel") || n.includes("anul")) return "is-cancelado";
  if (n.includes("ausente")) return "is-ausente";
  if (n.includes("presente")) return "is-presente";
  if (n.includes("reserv")) return "is-reservado";
  if (n.includes("dispon")) return "is-disponible";
  if (n.includes("asign") || n.includes("proxim")) return "is-proximo";
  return "is-sindato";
}

function scoreNombreProf(buscado: string, candidato: string): number {
  const a = normWa(buscado);
  const b = normWa(candidato);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 80;
  const ta = a.split(/\s+/).filter((t) => t.length >= 3);
  const tb = new Set(b.split(/\s+/).filter((t) => t.length >= 3));
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  return hits * 20;
}

async function anularTurnoDesdePedido(pedido: CancelTurnoPendiente): Promise<string> {
  const fecha = pedido.fechaHora.slice(0, 10);
  const objetivo = pedido.fechaHora.slice(0, 16);

  // 1) Por paciente (como el bot al listar turnos): más fiable que solo por profesional.
  let rows: Record<string, unknown>[] = [];
  try {
    const porPersona = await apiPost("/Turno", {
      PersonaDocumento: pedido.dni,
      FechaDesde: fecha,
      FechaHasta: fecha,
    });
    rows = filasTurnoMedexis(porPersona);
  } catch {
    rows = [];
  }
  // Algunas respuestas Medexis ignoran el mismo día en Desde=Hasta: ampliar +1.
  if (!rows.length) {
    try {
      const maniana = new Date(`${fecha}T12:00:00-03:00`);
      maniana.setDate(maniana.getDate() + 1);
      const y = maniana.getFullYear();
      const m = String(maniana.getMonth() + 1).padStart(2, "0");
      const d = String(maniana.getDate()).padStart(2, "0");
      const porPersona = await apiPost("/Turno", {
        PersonaDocumento: pedido.dni,
        FechaDesde: fecha,
        FechaHasta: `${y}-${m}-${d}`,
      });
      rows = filasTurnoMedexis(porPersona);
    } catch {
      /* fallback profesional */
    }
  }

  // 2) Fallback: agenda del profesional ese día.
  if (!rows.length) {
    const cfg = await fetchBuscaTurnoConfig();
    const lista = (cfg?.profesionales || []) as { enabled?: boolean; nombre?: string; doc?: string; sede?: string }[];
    const hit = lista
      .filter((p) => p.enabled !== false)
      .map((p) => ({ p, pts: scoreNombreProf(pedido.profesional, p.nombre || "") }))
      .filter((r) => r.pts >= 40)
      .sort((a, b) => b.pts - a.pts)[0]?.p;
    if (hit?.doc) {
      try {
        const { data } = await getTurnos(fecha, hit.doc);
        rows = filasTurnoMedexis(data).filter((row) => {
          const doc = String(row.PersonaDocumento || row.personaDocumento || "").replace(/\D/g, "");
          return !doc || doc === pedido.dni;
        });
      } catch {
        /* sigue al intento directo */
      }
    }
  }

  const delDia = rows.filter((row) => {
    const doc = String(row.PersonaDocumento || row.personaDocumento || "").replace(/\D/g, "");
    if (doc && doc !== pedido.dni) return false;
    const crudo = String(row.TurnoFechaHora || row.turnoFechaHora || row.Fecha || "");
    const cuando = fechaHoraBaDeCrudo(crudo);
    return cuando === objetivo || cuando.startsWith(objetivo);
  });

  // Si la hora no calza exacta pero hay un solo turno del paciente ese día con ese prof, usarlo.
  let fila = delDia[0];
  if (!fila && rows.length) {
    const porProf = rows.filter((row) => {
      const doc = String(row.PersonaDocumento || row.personaDocumento || "").replace(/\D/g, "");
      if (doc && doc !== pedido.dni) return false;
      const apellido = String(row.PrestadorApellido || row.prestadorApellido || "").trim();
      const nombre = String(row.PrestadorNombre || row.prestadorNombre || "").trim();
      const armado = String(row.profesionalNombre || "").trim() || [apellido, nombre].filter(Boolean).join(" ");
      return scoreNombreProf(pedido.profesional, armado) >= 40;
    });
    if (porProf.length === 1) fila = porProf[0];
    else if (delDia.length === 1) fila = delDia[0];
  }

  if (fila) {
    const turnoFh = String(fila.TurnoFechaHora || fila.turnoFechaHora || `${pedido.fechaHora}:00`);
    const sede = String(fila.Sede || fila.sede || "INECO");
    const prestador = String(fila.PrestadorDocumento || fila.prestadorDocumento || "");
    if (!prestador) {
      throw new Error("Medexis devolvió el turno sin documento del profesional.");
    }
    await anularTurno({
      prestadorDocumento: prestador,
      personaDocumento: pedido.dni,
      turnoFechaHora: turnoFh,
      sede,
    });
    return `Turno anulado: ${pedido.profesional}, ${turnoFh}.`;
  }

  // 3) Último intento: anular con la FechaISO del pedido + doc del catálogo.
  const cfg = await fetchBuscaTurnoConfig();
  const lista = (cfg?.profesionales || []) as { enabled?: boolean; nombre?: string; doc?: string; sede?: string }[];
  const hit = lista
    .filter((p) => p.enabled !== false)
    .map((p) => ({ p, pts: scoreNombreProf(pedido.profesional, p.nombre || "") }))
    .filter((r) => r.pts >= 40)
    .sort((a, b) => b.pts - a.pts)[0]?.p;
  if (!hit?.doc) {
    throw new Error(
      `No encontré el turno de ${pedido.profesional} el ${pedido.fechaHora} para DNI ${pedido.dni}.`,
    );
  }
  const turnoFh = `${pedido.fechaHora}:00`;
  await anularTurno({
    prestadorDocumento: hit.doc,
    personaDocumento: pedido.dni,
    turnoFechaHora: turnoFh,
    sede: hit.sede || "INECO",
  });
  return `Turno anulado: ${pedido.profesional}, ${turnoFh}.`;
}

/** Extrae campos del globo "Datos del pedido de turno:" por si menuEstado ya no alcanza. */
function parsePedidoTurnoBubble(text: string): {
  profesional?: string;
  prestacion?: string;
  tratamiento?: string;
  modalidad?: "" | "presencial" | "virtual" | "indistinto";
  dni?: string;
  paciente?: string;
  fechaNacimiento?: string;
  cobertura?: string;
} {
  const profesional = campoGlobo(text, "Profesional");
  const prestRaw = campoGlobo(text, "Prestaci[oó]n\\s*/\\s*motivo");
  let prestacion = prestRaw;
  let tratamiento = prestRaw;
  const dijo = prestRaw.match(/^(.*?)\s*\(dijo:\s*(.+?)\)\s*$/i);
  if (dijo) {
    prestacion = dijo[1]!.trim();
    tratamiento = dijo[2]!.trim();
  }
  const modRaw = campoGlobo(text, "Modalidad").toLowerCase();
  let modalidad: "" | "presencial" | "virtual" | "indistinto" = "";
  if (/presencial/.test(modRaw)) modalidad = "presencial";
  else if (/virtual/.test(modRaw)) modalidad = "virtual";
  else if (/indistinto/.test(modRaw)) modalidad = "indistinto";
  const dni = campoGlobo(text, "DNI").replace(/\D/g, "") || undefined;
  const paciente =
    campoGlobo(text, "Paciente") ||
    campoGlobo(text, "Nombre") ||
    [campoGlobo(text, "Apellido"), campoGlobo(text, "Nombre")].filter(Boolean).join(", ") ||
    undefined;
  const fechaNacimiento =
    campoGlobo(text, "Fecha de nacimiento") ||
    campoGlobo(text, "Nacimiento") ||
    undefined;
  const cobertura = campoGlobo(text, "Cobertura") || campoGlobo(text, "Obra social") || undefined;
  return {
    profesional: profesional || undefined,
    prestacion: prestacion || undefined,
    tratamiento: tratamiento || undefined,
    modalidad,
    dni,
    paciente: paciente?.trim() || undefined,
    fechaNacimiento: fechaNacimiento || undefined,
    cobertura: cobertura || undefined,
  };
}

function detallesPedidoTurno(
  text: string,
  estado?: WaConversation["menuEstado"],
  contact?: WaContact | null,
): Array<{ label: string; value: string }> {
  const delGlobo = parsePedidoTurnoBubble(text);
  const pick = (...vals: Array<string | null | undefined>) => {
    for (const v of vals) {
      const t = String(v ?? "").trim();
      if (t) return t;
    }
    return "";
  };
  const nombre = pick(
    delGlobo.paciente,
    [contact?.lastName, contact?.firstName].filter(Boolean).join(", "),
    contact?.displayName,
    [estado?.apellido, estado?.nombre].filter(Boolean).join(", "),
  );
  const rows: Array<{ label: string; value: string }> = [];
  const push = (label: string, value: string) => {
    if (value) rows.push({ label, value });
  };
  push("Paciente", nombre);
  push("DNI", pick(delGlobo.dni, estado?.dni, contact?.dni).replace(/\D/g, ""));
  push(
    "Nacimiento",
    pick(delGlobo.fechaNacimiento, estado?.fechaNacimiento, contact?.fechaNacimiento),
  );
  push("Prestación", pick(delGlobo.prestacion, estado?.tratamientoCatalogo, estado?.tratamiento));
  push("Profesional", pick(delGlobo.profesional, estado?.profesionalCatalogo, estado?.profesional));
  push("Modalidad", pick(delGlobo.modalidad, estado?.modalidad));
  push("Cobertura", pick(delGlobo.cobertura, estado?.cobertura));
  return rows;
}

function detallesCancelacionTurno(
  text: string,
  dniEstado = "",
): Array<{ label: string; value: string }> {
  const dni = (campoGlobo(text, "DNI") || dniEstado).replace(/\D/g, "");
  const profesional = campoGlobo(text, "Prof\\.") || campoGlobo(text, "Profesional");
  const prestacion = campoGlobo(text, "Prest\\.") || campoGlobo(text, "Prestaci[oó]n");
  let fechaHora = campoGlobo(text, "FechaISO").replace("T", " ").slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(fechaHora)) {
    const legible = text.match(
      /(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/i,
    );
    if (legible) {
      const dia = legible[1]!.padStart(2, "0");
      const mes = legible[2]!.padStart(2, "0");
      let anio = legible[3]!;
      if (anio.length === 2) anio = `20${anio}`;
      fechaHora = `${anio}-${mes}-${dia} ${legible[4]!.padStart(2, "0")}:${legible[5]!}`;
    } else {
      fechaHora = campoGlobo(text, "Fecha") || campoGlobo(text, "Turno") || "";
    }
  }
  const rows: Array<{ label: string; value: string }> = [];
  if (dni) rows.push({ label: "DNI", value: dni });
  if (profesional) rows.push({ label: "Profesional", value: profesional });
  if (prestacion) rows.push({ label: "Prestación", value: prestacion });
  if (fechaHora) rows.push({ label: "Fecha / hora", value: fechaHora });
  return rows;
}

function MessageTicks({ status }: { status: string }) {
  if (status === "FAILED") {
    return (
      <span className="wa-ticks is-failed" title="No se envió">
        !
      </span>
    );
  }
  if (status === "SENT") {
    return (
      <span className="wa-ticks" title="Enviado">
        ✓
      </span>
    );
  }
  if (status === "DELIVERED") {
    return (
      <span className="wa-ticks" title="Entregado">
        ✓✓
      </span>
    );
  }
  if (status === "READ") {
    return (
      <span className="wa-ticks is-read" title="Leído">
        ✓✓
      </span>
    );
  }
  return null;
}

function messageBody(message: WaMessage): string {
  if (message.isDeleted) return "Mensaje eliminado";
  if (message.type === "TEXT") return message.text || "";
  if (message.type === "IMAGE") return message.text || "Imagen";
  if (message.type === "AUDIO") return "Audio";
  if (message.type === "VIDEO") return message.text || "Video";
  if (message.type === "DOCUMENT") return message.fileName || "Documento";
  if (message.type === "STICKER") return "Sticker";
  return message.text || "Mensaje";
}

function textoDato(value: unknown): string {
  if (value == null || value === "") return "vacío";
  if (value === true) return "sí";
  if (value === false) return "no";
  return String(value);
}

function miles(valor: number): string {
  return new Intl.NumberFormat("es-AR").format(valor);
}

const DOLAR_PESOS = 1550;

const PASOS_BOT = [
  { paso: "detectar" as const, titulo: "Detecta", modelo: "gpt-6-luna" },
  { paso: "responder" as const, titulo: "Redacta", modelo: "gpt-6-luna" },
];

function precioModelo(modelo: string): { entrada: number; salida: number } {
  const id = modelo.toLowerCase();
  if (id.includes("gpt-6-luna")) return { entrada: 0.1, salida: 0.5 };
  if (id.includes("5.6-luna") || id.includes("luna")) return { entrada: 0.2, salida: 1.2 };
  if (id.includes("terra")) return { entrada: 2, salida: 12 };
  if (id.includes("5.4-mini")) return { entrada: 0.75, salida: 4.5 };
  if (id.includes("5.4-nano")) return { entrada: 0.2, salida: 1.25 };
  if (id.includes("4.1-mini")) return { entrada: 0.4, salida: 1.6 };
  if (id.includes("5-nano")) return { entrada: 0.05, salida: 0.4 };
  return { entrada: 0.1, salida: 0.5 };
}

function costoUsd(entrada: number, salida: number, precioEntrada: number, precioSalida: number): number {
  return (entrada / 1_000_000) * precioEntrada + (salida / 1_000_000) * precioSalida;
}

function tarifa(valor: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: valor < 1 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(valor);
}

function gastoUsd(valor: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(valor);
}

function gastoPesos(valor: number): string {
  const numero = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor);
  return `ARS ${numero}`;
}

export type WaConnectionBanner = {
  connected: boolean;
  connecting: boolean;
  label: string;
};

type Props = {
  onConnectionChange?: (status: WaConnectionBanner) => void;
  connectRef?: MutableRefObject<(() => void) | null>;
  mode?: "live" | "prueba" | "prueba-bot";
  createPruebaRef?: MutableRefObject<(() => void) | null>;
};

const PINNED_WA_TAGS_KEY = "wa-inbox-pinned-tag-ids";
const PINNED_CLUSTERS_KEY = "wa-inbox-pinned-tag-clusters";
const CLUSTER_MIN = 2;
/** Color único en el listado “Todas” (las aplicadas usan el color del grupo). */
const TAG_TODAS_NEUTRO = "#94a3b8";
const CLUSTER_COLORS = [
  "#a61948",
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

type PinnedCluster = {
  id: string;
  color: string;
  tagIds: string[];
};

type AssigneeTouch = {
  id: string;
  assigneeKind: "none" | "bot" | "user";
  assigneeUserId: string | null;
  assigneeName: string | null;
  at: number;
};

function sameAssigneeFields(
  a: {
    assigneeKind?: string | null;
    assigneeUserId?: string | null;
    assigneeName?: string | null;
  },
  b: {
    assigneeKind?: string | null;
    assigneeUserId?: string | null;
    assigneeName?: string | null;
  },
): boolean {
  return (
    (a.assigneeKind ?? "") === (b.assigneeKind ?? "") &&
    (a.assigneeUserId ?? "") === (b.assigneeUserId ?? "") &&
    (a.assigneeName ?? "") === (b.assigneeName ?? "")
  );
}

type WaInboxListItemProps = {
  conversation: WaConversation;
  active: boolean;
  color: string;
  pruebaMode: boolean;
  onSelect: (id: string) => void;
};

const WaInboxListItem = memo(function WaInboxListItem({
  conversation: c,
  active,
  color,
  pruebaMode,
  onSelect,
}: WaInboxListItemProps) {
  const label = pruebaMode ? waPruebaTitulo(c.contact) : waContactLabel(c.contact);
  return (
    <button
      type="button"
      className={`wa-inbox__item${active ? " is-active" : ""}`}
      style={{ "--assignee": color } as CSSProperties}
      onClick={() => onSelect(c.id)}
    >
      <div className="wa-inbox__item-top">
        <strong className="wa-inbox__item-name">{label}</strong>
        {!pruebaMode && c.prueba ? (
          <span className="wa-inbox__prueba-pill">Prueba</span>
        ) : null}
        <span className="wa-inbox__item-time">{formatPreviewTime(c.lastMessageAt)}</span>
      </div>
      {pruebaMode ? null : (
        <div className="wa-inbox__item-bottom">
          <span className="wa-inbox__item-preview">
            {c.resumen || c.lastMessagePreview || "Sin mensajes"}
          </span>
          <span className="wa-inbox__assignee">{waAssigneeLabel(c)}</span>
          {c.unreadCount > 0 ? <span className="wa-inbox__badge">{c.unreadCount}</span> : null}
        </div>
      )}
    </button>
  );
});

/** Evita que un poll/mark-read atrasado revierta un cambio de asignación local. */
function mergeConversationKeepAssignee(
  local: WaConversation,
  incoming: WaConversation,
  touch: AssigneeTouch | null,
): WaConversation {
  const merged: WaConversation = {
    ...local,
    ...incoming,
    contact: incoming.contact ?? local.contact,
  };
  const touched =
    touch &&
    touch.id === local.id &&
    Date.now() - touch.at < 12_000 &&
    sameAssigneeFields(local, touch);
  if (!touched) return merged;
  if (sameAssigneeFields(incoming, touch)) {
    // Servidor ya alcanzó el valor local: liberar el lock.
    return merged;
  }
  return {
    ...merged,
    assigneeKind: touch.assigneeKind,
    assigneeUserId: touch.assigneeUserId,
    assigneeName: touch.assigneeName,
  };
}

function readPinnedTagIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_WA_TAGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function newClusterId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `cluster-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readPinnedClusters(): PinnedCluster[] {
  try {
    const raw = localStorage.getItem(PINNED_CLUSTERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const used = new Set<string>();
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; color?: unknown; tagIds?: unknown };
      const id = String(row.id ?? "").trim();
      const color = String(row.color ?? "").trim().toLowerCase();
      const tagIds = Array.isArray(row.tagIds)
        ? row.tagIds
            .map((tagId) => String(tagId ?? "").trim())
            .filter((tagId) => tagId && !used.has(tagId) && used.add(tagId))
        : [];
      if (!id || !/^#[0-9a-f]{6}$/.test(color) || tagIds.length < CLUSTER_MIN) return [];
      return [{ id, color, tagIds }];
    });
  } catch {
    return [];
  }
}

function normalizeClusters(order: string[], clusters: PinnedCluster[]): PinnedCluster[] {
  const used = new Set<string>();
  const next: PinnedCluster[] = [];
  for (const cluster of clusters) {
    const indexes = [...new Set(cluster.tagIds.map((id) => order.indexOf(id)).filter((index) => index >= 0))].sort(
      (a, b) => a - b,
    );
    if (indexes.length < CLUSTER_MIN) continue;
    const runs: number[][] = [];
    let run: number[] = [indexes[0]!];
    for (let i = 1; i < indexes.length; i++) {
      const index = indexes[i]!;
      if (index === run[run.length - 1]! + 1) run.push(index);
      else {
        runs.push(run);
        run = [index];
      }
    }
    runs.push(run);
    let reused = false;
    for (const segment of runs) {
      const tagIds = segment
        .map((index) => order[index]!)
        .filter((id) => !used.has(id));
      if (tagIds.length < CLUSTER_MIN) continue;
      for (const id of tagIds) used.add(id);
      next.push({
        id: reused ? `${cluster.id}-${segment[0]}` : cluster.id,
        color: cluster.color,
        tagIds,
      });
      reused = true;
    }
  }
  return next;
}

function sameClusters(a: PinnedCluster[], b: PinnedCluster[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((cluster, index) => {
    const other = b[index];
    return (
      !!other &&
      cluster.id === other.id &&
      cluster.color === other.color &&
      cluster.tagIds.join("|") === other.tagIds.join("|")
    );
  });
}

function FichaAcordeon({
  titulo,
  abierto,
  onCambio,
  children,
}: {
  titulo: string;
  abierto: boolean;
  onCambio: (abierto: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="wa-ficha-fold"
      open={abierto}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next !== abierto) onCambio(next);
      }}
    >
      <summary>{titulo}</summary>
      <div className="wa-ficha-fold__body">{children}</div>
    </details>
  );
}

export function WhatsAppConversationsPanel({
  onConnectionChange,
  connectRef,
  mode = "live",
  createPruebaRef,
}: Props) {
  const pruebaMode = mode === "prueba" || mode === "prueba-bot";
  const pruebaMotor = mode === "prueba-bot" ? "menu" : "ia";
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [waStatus, setWaStatus] = useState<string>("");
  const [qr, setQr] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [nextConversationsOffset, setNextConversationsOffset] = useState<number | null>(null);
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [filters, setFilters] = useState<WaInboxFilters>(EMPTY_WA_FILTERS);
  const [vistaOperadora, setVistaOperadora] = useState(false);
  const [listaConversacionesVisible, setListaConversacionesVisible] = useState(true);
  const [tagFilterQuery, setTagFilterQuery] = useState("");
  const [tagFilterSuggestOpen, setTagFilterSuggestOpen] = useState(false);
  const tagFilterWrapRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingPrueba, setCreatingPrueba] = useState(false);
  const [selected, setSelected] = useState<WaConversation | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [botTyping, setBotTyping] = useState(false);
  const [ocultos, setOcultos] = useState<string[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [operators, setOperators] = useState<WaOperator[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [tags, setTags] = useState<WaTag[]>([]);
  const [pinnedTagIds, setPinnedTagIds] = useState<string[]>(readPinnedTagIds);
  const [pinnedClusters, setPinnedClusters] = useState<PinnedCluster[]>(readPinnedClusters);
  const [groupingTags, setGroupingTags] = useState(false);
  const [editingGroups, setEditingGroups] = useState(false);
  const [groupPick, setGroupPick] = useState<string[]>([]);
  const [groupColor, setGroupColor] = useState(CLUSTER_COLORS[0]!);
  const [dragPinnedId, setDragPinnedId] = useState<string | null>(null);
  const [pinnedDropIndex, setPinnedDropIndex] = useState<number | null>(null);
  const dragPinnedIdRef = useRef<string | null>(null);
  const pinnedDropIndexRef = useRef<number | null>(null);
  const [quickTagQuery, setQuickTagQuery] = useState("");
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelPinned, setSidePanelPinned] = useState(false);
  const [sidePanelUiLocked, setSidePanelUiLocked] = useState(false);
  const [operadoraTab, setOperadoraTab] = useState<
    "paciente" | "historial" | "etiquetas" | "busca"
  >("paciente");
  const [historialTurnos, setHistorialTurnos] = useState<{
    conversationId: string;
    turnos: WaTurnoFicha[];
    ultimosProfesionales: string[];
    aviso: string;
    loading: boolean;
  } | null>(null);
  const [historialBusqueda, setHistorialBusqueda] = useState("");
  const [historialTick, setHistorialTick] = useState(0);
  const [historialGrupos, setHistorialGrupos] = useState({ proximos: true, anteriores: true });
  useEffect(() => {
    setHistorialBusqueda("");
  }, [selectedId]);
  useEffect(() => {
    if (!selectedId) {
      setHistorialTurnos(null);
      return;
    }
    const id = selectedId;
    let cancel = false;
    setHistorialTurnos({
      conversationId: id,
      turnos: [],
      ultimosProfesionales: [],
      aviso: "",
      loading: true,
    });
    void fetchWaHistorialTurnos(id)
      .then((data) => {
        if (cancel) return;
        setHistorialTurnos({
          conversationId: id,
          turnos: data.turnos,
          ultimosProfesionales: data.ultimosProfesionales,
          aviso: data.aviso,
          loading: false,
        });
        const sumar = (actuales: string[]) => {
          const extra = data.tagIds.filter((tagId) => !actuales.includes(tagId));
          return extra.length ? [...actuales, ...extra] : actuales;
        };
        setSelected((prev) => {
          if (!prev || prev.id !== id) return prev;
          const tagIds = sumar(prev.tagIds ?? []);
          return tagIds === prev.tagIds ? prev : { ...prev, tagIds };
        });
        setConversations((prev) =>
          prev.map((item) => {
            if (item.id !== id) return item;
            const tagIds = sumar(item.tagIds ?? []);
            return tagIds === item.tagIds ? item : { ...item, tagIds };
          }),
        );
      })
      .catch(() => {
        if (cancel) return;
        setHistorialTurnos({
          conversationId: id,
          turnos: [],
          ultimosProfesionales: [],
          aviso: "No se pudo cargar el historial.",
          loading: false,
        });
      });
    return () => {
      cancel = true;
    };
  }, [selectedId, historialTick]);
  const [buscaTurnoMounted, setBuscaTurnoMounted] = useState(false);
  const [catalogoBusca, setCatalogoBusca] = useState<{
    profesionales?: { doc?: string; nombre?: string; enabled?: boolean }[];
    prestaciones?: Record<
      string,
      {
        nombre?: string;
        enabled?: boolean;
        profesionales?: { doc?: string; nombre?: string }[];
      }
    >;
  } | null>(null);
  const [prestacionElegida, setPrestacionElegida] = useState<Record<string, string>>({});
  const [fichaAbierta, setFichaAbierta] = useState({
    escribe: false,
    paciente: true,
    diagnostico: true,
    profesionales: true,
  });
  useEffect(() => {
    let cancel = false;
    void fetchBuscaTurnoConfig()
      .then((cfg) => {
        if (!cancel && cfg) setCatalogoBusca(cfg);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);
  const [buscaPedidoSeed, setBuscaPedidoSeed] = useState<{
    key: string;
    prestacionCodigo?: string;
    prestacionNombre?: string;
    tratamiento?: string;
    profesionalDoc?: string;
    profesionalNombre?: string;
    modalidad?: "" | "presencial" | "virtual" | "indistinto";
    preferencia?: PreferenciaTurnos | null;
    paciente?: {
      dni?: string;
      fechaNacimiento?: string;
      nombre?: string;
      apellido?: string;
      email?: string;
      telefono?: string;
      sexo?: "" | "masculino" | "femenino";
    } | null;
  } | null>(null);
  /** Mensaje de pedido WA abierto en Busca Turno; se marca hecho solo al asignar. */
  const [buscaAccionMessageId, setBuscaAccionMessageId] = useState<string | null>(null);
  const [buscaSoloLibres, setBuscaSoloLibres] = useState(true);
  const [cancelTurnoPendiente, setCancelTurnoPendiente] = useState<CancelTurnoPendiente | null>(
    null,
  );
  const [cancelTurnoBusy, setCancelTurnoBusy] = useState(false);
  const [accionesOpen, setAccionesOpen] = useState(false);
  const [accionesHechas, setAccionesHechas] = useState<Record<string, true>>({});
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [resueltaOpen, setResueltaOpen] = useState(false);
  const [diagnosticoSaving, setDiagnosticoSaving] = useState(false);
  const [tagGroups, setTagGroups] = useState<WaTagGroup[]>([]);
  const [tagsModalOpen, setTagsModalOpen] = useState(false);
  const [tagsModalGroupId, setTagsModalGroupId] = useState("");
  const [tagsModalQuery, setTagsModalQuery] = useState("");
  const [tagsModalGroupMenuOpen, setTagsModalGroupMenuOpen] = useState(false);
  const [tagsModalDragOver, setTagsModalDragOver] = useState<"available" | "assigned" | null>(
    null,
  );
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpKind, setFollowUpKind] = useState<WaFollowUpKind>("tarea");
  const [profileOpen, setProfileOpen] = useState(false);
  const [datoMenu, setDatoMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [datoSaving, setDatoSaving] = useState(false);
  const datoMenuRef = useRef<HTMLDivElement | null>(null);
  const wordPointer = useRef<{ x: number; y: number } | null>(null);
  const quickTagSearchRef = useRef<HTMLInputElement | null>(null);
  const tagSearchFocus = useRef(false);
  const [notaOpen, setNotaOpen] = useState(false);
  const [eligiendoRechazo, setEligiendoRechazo] = useState(false);
  const [rechazoIds, setRechazoIds] = useState<string[]>([]);
  const [comentarioId, setComentarioId] = useState<{
    id: string;
    texto: string;
    top: number;
    left: number;
  } | null>(null);
  const [aclaraciones, setAclaraciones] = useState<Record<string, string>>({});
  const [notaSaving, setNotaSaving] = useState(false);
  const [pruebaTab, setPruebaTab] = useState<
    "paciente" | "historial" | "modulo" | "intenciones" | "resultado"
  >("paciente");
  const pruebaTabsRef = useRef<HTMLDivElement | null>(null);
  const [tabsPueden, setTabsPueden] = useState({ izq: false, der: false });
  const medirTabs = useCallback(() => {
    const el = pruebaTabsRef.current;
    if (!el) {
      setTabsPueden({ izq: false, der: false });
      return;
    }
    setTabsPueden({
      izq: el.scrollLeft > 4,
      der: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    medirTabs();
    window.addEventListener("resize", medirTabs);
    return () => window.removeEventListener("resize", medirTabs);
  }, [medirTabs, pruebaTab, selectedId, pruebaMode]);
  const [uso, setUso] = useState<WaLlmUsage[]>([]);
  const [takeOverOpen, setTakeOverOpen] = useState(false);
  const [pendingAssignee, setPendingAssignee] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [assigning, setAssigning] = useState(false);
  const messagesBoxRef = useRef<HTMLDivElement | null>(null);
  const pegadoAlFinal = useRef(true);
  const chatAbierto = useRef("");
  const esperaMsRef = useRef(40_000);
  const typingAtRef = useRef<number | null>(null);
  const waitingReplyRef = useRef(false);
  const esperaDesdeRef = useRef<number | null>(null);
  const avisoFalloRef = useRef(false);
  const typingTimersRef = useRef<number[]>([]);
  const colaRef = useRef<string[]>([]);
  const pumpingRef = useRef(false);
  const vistosRef = useRef<Set<string>>(new Set());
  const abrirRef = useRef<string | null>(null);
  const vioCargaRef = useRef(false);
  const ultimoBotRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listBodyRef = useRef<HTMLDivElement | null>(null);
  const tagsGroupPickerRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const skipThreadLoad = useRef<string | null>(null);
  const creatingPruebaRef = useRef(false);
  const pollState = useRef({
    selectedId: null as string | null,
    loadedCount: 0,
    filters: EMPTY_WA_FILTERS,
  });
  const pendingTags = useRef<string[] | null>(null);
  const savingTags = useRef(false);
  const lastQuickReplyRef = useRef<QuickReply | null>(null);
  const assigneeTouchRef = useRef<AssigneeTouch | null>(null);
  pollState.current = { selectedId, loadedCount: conversations.length, filters };

  const activeFilterCount = useMemo(() => countWaFilters(filters), [filters]);
  const filtersQuery = useMemo(() => waFiltersQuery(filters), [filters]);

  const refreshStatus = useCallback(async () => {
    const status = await fetchWhatsappStatus();
    setWaStatus(String(status.status ?? ""));
    setQr(status.qr ?? null);
    setPhoneNumber(status.phoneNumber ?? null);
    return status;
  }, []);

  const loadList = useCallback(async (nextFilters?: WaInboxFilters) => {
    const applied = nextFilters ?? filters;
    setLoadingList(true);
    setHasMoreConversations(false);
    setNextConversationsOffset(null);
    try {
      const page = await fetchWaConversations({
        status: "OPEN",
        limit: CONVERSATIONS_PAGE_SIZE,
        offset: 0,
        prueba: pruebaMode,
        motor: pruebaMode ? pruebaMotor : undefined,
        ...waFiltersQuery(applied),
      });
      setConversations(page.items);
      setHasMoreConversations(page.hasMore);
      setNextConversationsOffset(page.nextOffset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las conversaciones");
      // No vaciar la lista: al entrar/salir un fallo puntual borraba la prueba visible.
      setHasMoreConversations(false);
      setNextConversationsOffset(null);
    } finally {
      setLoadingList(false);
    }
  }, [filters, pruebaMode, pruebaMotor]);

  const loadMoreConversations = useCallback(async () => {
    if (loadingMoreRef.current || loadingList || !hasMoreConversations || nextConversationsOffset == null) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchWaConversations({
        status: "OPEN",
        limit: CONVERSATIONS_PAGE_SIZE,
        offset: nextConversationsOffset,
        prueba: pruebaMode,
        motor: pruebaMode ? pruebaMotor : undefined,
        ...filtersQuery,
      });
      setConversations((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        const appended = page.items.filter((item) => !seen.has(item.id));
        return [...prev, ...appended];
      });
      setHasMoreConversations(page.hasMore);
      setNextConversationsOffset(page.nextOffset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar más conversaciones");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMoreConversations, loadingList, nextConversationsOffset, filtersQuery, pruebaMode, pruebaMotor]);

  const loadThread = useCallback(async (id: string) => {
    setLoadingMessages(true);
    try {
      const [conv, msgs] = await Promise.all([
        fetchWaConversation(id),
        fetchWaMessages(id),
      ]);
      if (pollState.current.selectedId !== id) return;
      const touch = assigneeTouchRef.current;
      setSelected((prev) =>
        prev && prev.id === id ? mergeConversationKeepAssignee(prev, conv, touch) : conv,
      );
      setConversations((prev) => patchConversationInList(prev, conv, touch));
      setMessages(msgs);
      void markWaConversationRead(id)
        .then((updated) => {
          if (pollState.current.selectedId !== id) return;
          const readTouch = assigneeTouchRef.current;
          const withRead = { ...updated, unreadCount: 0 };
          setSelected((prev) =>
            prev && prev.id === id
              ? { ...mergeConversationKeepAssignee(prev, withRead, readTouch), unreadCount: 0 }
              : prev,
          );
          setConversations((prev) => patchConversationInList(prev, withRead, readTouch));
        })
        .catch(() => {
          /* ignore */
        });
    } catch (error) {
      if (pollState.current.selectedId !== id) return;
      toast.error(error instanceof Error ? error.message : "No se pudo abrir la conversación");
      setMessages([]);
    } finally {
      if (pollState.current.selectedId === id) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (pruebaMode || !vistaOperadora) {
      document.body.classList.remove("wa-vista-operadora");
      setSidePanelOpen(false);
      setSidePanelPinned(false);
      setSidePanelUiLocked(false);
      return;
    }
    setBuscaTurnoMounted(true);
    setSidePanelPinned(true);
    document.body.classList.add("wa-vista-operadora");
    return () => document.body.classList.remove("wa-vista-operadora");
  }, [pruebaMode, vistaOperadora]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await fetchWhatsappCrmHealth();
        if (cancelled) return;
        setReady(true);
        await refreshStatus();
        const ops = await fetchWaOperators().catch(() => [] as WaOperator[]);
        if (cancelled) return;
        setOperators(ops);
        await loadList();
        void fetchQuickReplies()
          .then(setQuickReplies)
          .catch(() => {
            /* el chat sigue usable sin atajos */
          });
        void fetchWaTagCatalog()
          .then((catalog) => {
            setTagGroups(catalog.groups);
            setTags(catalog.items);
          })
          .catch(() => {
            /* el chat sigue usable sin etiquetas */
          });
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "No se pudo iniciar WhatsApp",
          );
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList, refreshStatus]);

  useEffect(() => {
    if (!ready) return;
    const waitingQr = qrModalOpen && waStatus !== "CONNECTED";
    let busy = false;
    const id = window.setInterval(() => {
      if (busy) return;
      busy = true;
      const snap = pollState.current;
      const tasks: Promise<unknown>[] = [
        refreshStatus().catch(() => undefined),
      ];
      if (!waitingQr) {
        tasks.push(
          fetchWaConversations({
            status: "OPEN",
            limit: Math.max(snap.loadedCount, CONVERSATIONS_PAGE_SIZE),
            offset: 0,
            prueba: pruebaMode,
            motor: pruebaMode ? pruebaMotor : undefined,
            ...waFiltersQuery(snap.filters),
          })
            .then((page) => {
              const touch = assigneeTouchRef.current;
              setConversations((prev) => {
                const byId = new Map(page.items.map((item) => [item.id, item]));
                let changed = false;
                const merged = prev.map((item) => {
                  const incoming = byId.get(item.id);
                  if (!incoming) return item;
                  const next = mergeConversationKeepAssignee(item, incoming, touch);
                  if (next !== item && conversationListSignature(next) !== conversationListSignature(item)) {
                    changed = true;
                    return next;
                  }
                  return item;
                });
                const known = new Set(merged.map((item) => item.id));
                const fresh = page.items.filter((item) => !known.has(item.id));
                if (fresh.length) changed = true;
                if (!changed) return prev;
                const next = [...fresh, ...merged].sort((a, b) => {
                  const ta = Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || "") || 0;
                  const tb = Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || "") || 0;
                  return tb - ta;
                });
                return sameConversationList(prev, next) ? prev : next;
              });
              if (snap.selectedId) {
                const freshSel = page.items.find((item) => item.id === snap.selectedId);
                if (freshSel) {
                  setSelected((prev) => {
                    if (!prev || prev.id !== freshSel.id) return prev;
                    const kept = mergeConversationKeepAssignee(prev, freshSel, touch);
                    const same =
                      conversationListSignature(kept) === conversationListSignature(prev) &&
                      (kept.menuEstado?.fechaNacimiento ?? "") ===
                        (prev.menuEstado?.fechaNacimiento ?? "") &&
                      (kept.tagIds ?? []).join() === (prev.tagIds ?? []).join();
                    if (same) return prev;
                    return {
                      ...kept,
                      menuEstado: freshSel.menuEstado ?? prev.menuEstado,
                      tagIds: freshSel.tagIds ?? prev.tagIds,
                    };
                  });
                }
              }
              setHasMoreConversations((prev) => (prev === page.hasMore ? prev : page.hasMore));
              setNextConversationsOffset((prev) =>
                prev === page.nextOffset ? prev : page.nextOffset,
              );
            })
            .catch(() => undefined),
        );
        if (snap.selectedId) {
          tasks.push(
            fetchWaMessages(snap.selectedId)
              .then((msgs) => {
                setMessages((prev) => {
                  const next = mergeMensajesServidor(prev, msgs);
                  return next === prev ? prev : next;
                });
              })
              .catch(() => undefined),
          );
        }
      }
      void Promise.all(tasks).finally(() => {
        busy = false;
      });
    }, pruebaMode
      ? 2500
      : waitingQr
        ? 3000
        : selected?.prueba
          ? 2500
          : 20000);
    return () => window.clearInterval(id);
  }, [ready, refreshStatus, qrModalOpen, waStatus, pruebaMode, pruebaMotor, selected?.prueba]);

  useEffect(() => {
    abrirRef.current = selectedId;
    // Si esta conversación se abrió con mensajes ya cargados (prueba nueva), no esperar loadThread.
    // Tiene que correr antes del efecto que consume skipThreadLoad.
    vioCargaRef.current = Boolean(selectedId && skipThreadLoad.current === selectedId);
    vistosRef.current = new Set();
    ultimoBotRef.current = 0;
    waitingReplyRef.current = false;
    typingAtRef.current = null;
    esperaDesdeRef.current = null;
    avisoFalloRef.current = false;
    for (const id of typingTimersRef.current) window.clearTimeout(id);
    typingTimersRef.current = [];
    colaRef.current = [];
    pumpingRef.current = false;
    setOcultos([]);
    setBotTyping(false);
    return () => {
      for (const id of typingTimersRef.current) window.clearTimeout(id);
      typingTimersRef.current = [];
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setMessages([]);
      return;
    }
    if (skipThreadLoad.current === selectedId) {
      // La prueba nueva ya trae los mensajes: no re-cargar el hilo.
      // Hay que marcar la carga como vista; si no, "escribiendo" queda trabado.
      skipThreadLoad.current = null;
      vioCargaRef.current = true;
      return;
    }
    setMessages([]);
    void loadThread(selectedId);
  }, [selectedId, loadThread]);

  useEffect(() => {
    setDatoMenu(null);
  }, [selectedId]);

  useEffect(() => {
    if (!tagSearchFocus.current || !(sidePanelOpen || sidePanelPinned)) return;
    if (operadoraTab !== "etiquetas") return;
    tagSearchFocus.current = false;
    quickTagSearchRef.current?.focus();
  }, [sidePanelOpen, sidePanelPinned, operadoraTab, quickTagQuery]);

  useEffect(() => {
    if (!datoMenu) return;
    function close(event: Event) {
      if (event.type === "pointerdown" && datoMenuRef.current?.contains(event.target as Node)) return;
      setDatoMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDatoMenu(null);
    }
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [datoMenu]);

  useEffect(() => {
    if (!pruebaMode || !selectedId) {
      setUso([]);
      return;
    }
    let cancelled = false;
    void fetchWaLlmUsage(selectedId)
      .then((items) => {
        if (!cancelled) setUso(items);
      })
      .catch(() => {
        if (!cancelled) setUso([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pruebaMode, selectedId, messages.length]);

  useEffect(() => {
    const entro = chatAbierto.current !== (selectedId ?? "");
    chatAbierto.current = selectedId ?? "";
    if (entro) pegadoAlFinal.current = true;
    if (!pegadoAlFinal.current) return;
    const caja = messagesBoxRef.current;
    if (!caja) return;
    caja.scrollTop = caja.scrollHeight;
  }, [selectedId, messages, botTyping, ocultos]);

  useEffect(() => {
    if (!pruebaMode) return;
    // Bot de menú (sin IA): espera corta (1s), no los 40s de la IA.
    if (pruebaMotor === "menu") {
      esperaMsRef.current = 1000;
      return;
    }
    let cancelled = false;
    void Promise.all([fetchWhatsappBotConfig(), fetchWhatsappMotorConfig()])
      .then(([bot, motor]) => {
        if (cancelled) return;
        const agrupar = motor.data.mensajeria.agruparMensajes !== false;
        const mensajeria = bot.data?.mensajeria;
        const raw =
          mensajeria && typeof mensajeria === "object"
            ? (mensajeria as Record<string, unknown>).tiempoEsperaEntreMensajes
            : 40;
        const n = Number(raw ?? 40);
        const segundos = !agrupar || !Number.isFinite(n) ? 0 : Math.min(120, Math.max(0, Math.round(n)));
        esperaMsRef.current = segundos * 1000;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pruebaMode, pruebaMotor]);

  useEffect(() => {
    if (!pruebaMode) return;
    const id = window.setInterval(() => {
      if (!waitingReplyRef.current || typingAtRef.current == null) return;
      const now = Date.now();
      if (now >= typingAtRef.current) setBotTyping(true);
      const desde = esperaDesdeRef.current ?? now;
      if (now < desde + esperaMsRef.current + 120_000 || avisoFalloRef.current) return;
      avisoFalloRef.current = true;
      waitingReplyRef.current = false;
      typingAtRef.current = null;
      esperaDesdeRef.current = null;
      setBotTyping(false);
      toast.error("La respuesta del bot no llegó. Probá mandar el mensaje de nuevo.");
    }, 200);
    return () => window.clearInterval(id);
  }, [pruebaMode]);

  useEffect(() => {
    if (!pruebaMode) return;
    const id = window.setInterval(() => {
      if (!waitingReplyRef.current || avisoFalloRef.current) return;
      const conversationId = pollState.current.selectedId;
      const desde = esperaDesdeRef.current;
      if (!conversationId || desde == null) return;
      void fetchWaLlmUsage(conversationId)
        .then((items) => {
          if (!waitingReplyRef.current || avisoFalloRef.current) return;
          const fallo = [...items].reverse().find((item) => {
            const at = Date.parse(item.creadoEn ?? "");
            return item.ok === false && Number.isFinite(at) && at >= desde - 2000;
          });
          if (!fallo) return;
          const falloAt = Date.parse(fallo.creadoEn ?? "");
          const siguio = items.some((item) => {
            const at = Date.parse(item.creadoEn ?? "");
            return item.ok && Number.isFinite(at) && at > falloAt;
          });
          if (siguio || !Number.isFinite(falloAt) || Date.now() - falloAt < 12_000) return;
          avisoFalloRef.current = true;
          waitingReplyRef.current = false;
          typingAtRef.current = null;
          esperaDesdeRef.current = null;
          setBotTyping(false);
          toast.error("El bot no pudo contestar. Probá mandar el mensaje de nuevo.");
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(id);
  }, [pruebaMode]);

  useEffect(() => {
    if (!pruebaMode || !selectedId) return;

    const outboundDesdeEspera = (item: (typeof messages)[number]) => {
      if (item.direction !== "OUTBOUND" || item.isDeleted) return false;
      const desde = esperaDesdeRef.current;
      if (desde == null) return false;
      const at = Date.parse(item.createdAt ?? "");
      // Margen chico por desfase de reloj; no usar 2s o toma respuestas viejas y corta mal la espera.
      return Number.isFinite(at) && at >= desde - 500;
    };

    const cortarEsperaTyping = () => {
      waitingReplyRef.current = false;
      typingAtRef.current = null;
      esperaDesdeRef.current = null;
      if (!pumpingRef.current && colaRef.current.length === 0) setBotTyping(false);
    };

    if (abrirRef.current === selectedId) {
      if (messages.some((item) => item.conversationId !== selectedId)) return;
      if (loadingMessages) {
        vioCargaRef.current = true;
        return;
      }
      if (!vioCargaRef.current) return;
      // No marcar como "ya vistos" los outbound de la espera actual: si no, el typing queda pegado.
      for (const item of messages) {
        if (waitingReplyRef.current && outboundDesdeEspera(item)) continue;
        vistosRef.current.add(item.id);
      }
      abrirRef.current = null;
      // Seguir: puede haber respuesta del bot llegada durante la carga inicial.
    }

    const nuevos = messages.filter(
      (item) => item.direction === "OUTBOUND" && !item.isDeleted && !vistosRef.current.has(item.id),
    );
    if (!nuevos.length) {
      if (waitingReplyRef.current && messages.some(outboundDesdeEspera)) {
        cortarEsperaTyping();
      }
      return;
    }
    for (const item of nuevos) vistosRef.current.add(item.id);
    waitingReplyRef.current = false;
    typingAtRef.current = null;
    esperaDesdeRef.current = null;

    // Bot menú: mostrar todos los globos al toque (sin ritmo de ~1–3s entre mensajes).
    if (pruebaMotor === "menu") {
      ultimoBotRef.current = Date.now();
      setOcultos([]);
      colaRef.current = [];
      pumpingRef.current = false;
      setBotTyping(false);
      return;
    }

    const reciente = ultimoBotRef.current > 0 && Date.now() - ultimoBotRef.current < 4000;
    // Si ya hay cola en curso, sumar todos los nuevos; si no, el primero se muestra ya.
    const encolar =
      pumpingRef.current || colaRef.current.length > 0
        ? nuevos.map((item) => item.id)
        : reciente && colaRef.current.length === 0
          ? nuevos.map((item) => item.id)
          : nuevos.slice(1).map((item) => item.id);
    if (!encolar.length) {
      ultimoBotRef.current = Date.now();
      setBotTyping(false);
      return;
    }
    colaRef.current = [...colaRef.current, ...encolar];
    setOcultos([...colaRef.current]);
    setBotTyping(true);
    if (!pumpingRef.current) {
      const sigue = reciente && encolar.length === nuevos.length;
      if (sigue) programarSiguiente();
      else {
        const gap = window.setTimeout(() => programarSiguiente(), 400);
        typingTimersRef.current.push(gap);
      }
    }

    function programarSiguiente() {
      if (!colaRef.current.length) {
        pumpingRef.current = false;
        setBotTyping(false);
        return;
      }
      pumpingRef.current = true;
      setBotTyping(true);
      const timer = window.setTimeout(() => {
        colaRef.current = colaRef.current.slice(1);
        setOcultos([...colaRef.current]);
        ultimoBotRef.current = Date.now();
        if (!colaRef.current.length) {
          pumpingRef.current = false;
          setBotTyping(false);
          return;
        }
        // Entre globos: seguir mostrando "escribiendo" hasta el próximo.
        setBotTyping(true);
        const gap = window.setTimeout(() => programarSiguiente(), 400);
        typingTimersRef.current.push(gap);
      }, 1100);
      typingTimersRef.current.push(timer);
    }
  }, [messages, pruebaMode, pruebaMotor, selectedId, loadingMessages]);

  useEffect(() => {
    if (!qrModalOpen || waStatus !== "CONNECTED") return;
    setQrModalOpen(false);
    toast.success("WhatsApp conectado");
  }, [waStatus, qrModalOpen]);

  useEffect(() => {
    if (!qrModalOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setQrModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrModalOpen]);

  useEffect(() => {
    setTagsModalOpen(false);
    setTagsModalGroupId("");
    setEligiendoRechazo(false);
    setNotaOpen(false);
  }, [selectedId]);

  useEffect(() => {
    onConnectionChange?.({
      connected: waStatus === "CONNECTED",
      connecting,
      label:
        waStatus === "CONNECTED"
          ? phoneNumber
            ? `Conectado · ${phoneNumber}`
            : "Conectado"
          : "Desconectado",
    });
  }, [connecting, onConnectionChange, phoneNumber, waStatus]);

  function patchFilters(patch: Partial<WaInboxFilters>) {
    const next: WaInboxFilters = {
      ...filters,
      ...patch,
      tagIds: patch.tagIds ? [...patch.tagIds] : [...filters.tagIds],
    };
    setFilters(next);
    void loadList(next);
  }

  function addFilterTag(tagId: string) {
    if (filters.tagIds.includes(tagId)) return;
    patchFilters({ tagIds: [...filters.tagIds, tagId] });
    setTagFilterQuery("");
    setTagFilterSuggestOpen(true);
  }

  function removeFilterTag(tagId: string) {
    patchFilters({ tagIds: filters.tagIds.filter((id) => id !== tagId) });
  }

  const threadHeader = useMemo(() => {
    const header = waContactThreadHeader(selected?.contact);
    if (!pruebaMode) return header;
    return { ...header, title: waPruebaTitulo(selected?.contact), subtitle: null };
  }, [pruebaMode, selected]);

  const accionesPendientes = useMemo((): AccionPendiente[] => {
    const out: AccionPendiente[] = [];
    for (const m of messages) {
      if (m.isDeleted || m.direction !== "OUTBOUND") continue;
      if (accionesHechas[m.id]) continue;
      const text = String(m.text ?? "");
      if (esMensajePedidoTurno(text)) {
        out.push({
          id: m.id,
          kind: "busca_turno",
          createdAt: m.createdAt,
          title: "Buscar turno",
          explanation:
            "El paciente pidió un turno. Revisá los datos del pedido y abrí Busca Turno para ofrecerle horarios.",
          details: detallesPedidoTurno(text, selected?.menuEstado, selected?.contact),
          messageText: text,
        });
      } else if (esMensajeCancelacionTurno(text)) {
        const combinado = [textoPrevioCancelacion(messages, messages.indexOf(m)), text]
          .filter(Boolean)
          .join("\n");
        out.push({
          id: m.id,
          kind: "cancelar_turno",
          createdAt: m.createdAt,
          title: "Eliminar turno",
          explanation:
            "El paciente pidió cancelar un turno. Confirmá los datos y anulalo en Medexis.",
          details: detallesCancelacionTurno(
            combinado,
            selected?.menuEstado?.dni?.trim() || selected?.contact?.dni || "",
          ),
          messageText: combinado,
        });
      }
    }
    return out;
  }, [accionesHechas, messages, selected?.contact, selected?.menuEstado]);

  useEffect(() => {
    setAccionesHechas({});
    setAccionesOpen(false);
    setHighlightMessageId(null);
    setBuscaAccionMessageId(null);
    setResueltaOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const fresh = conversations.find((item) => item.id === selectedId);
    if (!fresh) return;
    setSelected((current) => {
      if (!current || current.id !== fresh.id) return current;
      const sameResumen = (current.resumen ?? "") === (fresh.resumen ?? "");
      const sameContact = current.contact?.updatedAt === fresh.contact?.updatedAt;
      const sameTags = (current.tagIds ?? []).join() === (fresh.tagIds ?? []).join();
      const sameAssignee = sameAssigneeFields(current, fresh);
      const sameResolution =
        (current.resolutionStatus ?? "open") === (fresh.resolutionStatus ?? "open") &&
        Boolean(current.botPausedUntilInbound) === Boolean(fresh.botPausedUntilInbound);
      const sameDx =
        (current.motivoConsulta ?? "") === (fresh.motivoConsulta ?? "") &&
        (current.diagnosticoIa ?? "") === (fresh.diagnosticoIa ?? "") &&
        (current.diagnosticoHumano ?? "") === (fresh.diagnosticoHumano ?? "") &&
        (current.diagnosticoHumanoByName ?? "") === (fresh.diagnosticoHumanoByName ?? "");
      if (
        sameResumen &&
        sameContact &&
        sameTags &&
        sameAssignee &&
        sameResolution &&
        sameDx
      ) {
        return current;
      }
      return mergeConversationKeepAssignee(current, fresh, assigneeTouchRef.current);
    });
  }, [conversations, selectedId]);

  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const selectConversationById = useCallback((id: string) => {
    if (pollState.current.selectedId === id) return;
    const conversation = conversationsRef.current.find((item) => item.id === id);
    if (!conversation) return;
    setSelectedId(conversation.id);
    setSelected(conversation);
    setDraft("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    lastQuickReplyRef.current = null;
  }, []);

  const openByContactId = useCallback(async (contactId: string) => {
    const id = contactId.trim();
    if (!id) return;
    try {
      const conv = await fetchWaConversationByContact(id);
      setConversations((prev) =>
        prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev],
      );
      setSelectedId(conv.id);
      setSelected(conv);
      setDraft("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo abrir la conversación",
      );
    }
  }, []);

  const pendingOpenedRef = useRef(false);
  useEffect(() => {
    if (!ready || loadingList || pendingOpenedRef.current) return;
    const pending = consumePendingWaContact();
    pendingOpenedRef.current = true;
    if (pending) void openByContactId(pending);
  }, [ready, loadingList, openByContactId]);

  useEffect(() => {
    return subscribeOpenWaContact((contactId) => {
      void openByContactId(contactId);
    });
  }, [openByContactId]);

  const assignedTags = useMemo(
    () => tags.filter((tag) => (selected?.tagIds ?? []).includes(tag.id)),
    [tags, selected?.tagIds],
  );

  const diagnosticoOpciones = useMemo(() => {
    const grupo = tagGroups.find(
      (g) =>
        g.name
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .toLowerCase() === "diagnostico",
    );
    const delGrupo = grupo
      ? tags.filter((tag) => tag.groupId === grupo.id).map((tag) => tag.name)
      : [];
    const set = new Set(delGrupo);
    // Incluir valores ya guardados aunque no estén en el catálogo local.
    for (const extra of [selected?.diagnosticoIa, selected?.diagnosticoHumano]) {
      const t = String(extra ?? "").trim();
      if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "es"));
  }, [tagGroups, tags, selected?.diagnosticoIa, selected?.diagnosticoHumano]);

  async function guardarDiagnosticoHumano(valor: string) {
    if (!selectedId || diagnosticoSaving) return;
    setDiagnosticoSaving(true);
    try {
      const updated = await setWaDiagnosticoPresuntivo(selectedId, valor);
      setSelected((prev) =>
        prev && prev.id === updated.id
          ? { ...prev, ...updated, contact: updated.contact ?? prev.contact }
          : prev,
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      );
      toast.success(valor ? "Diagnóstico guardado" : "Diagnóstico quitado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el diagnóstico");
    } finally {
      setDiagnosticoSaving(false);
    }
  }

  const accesosListos = useRef(false);
  const accesosUserId = user?.id ?? "";
  useEffect(() => {
    accesosListos.current = false;
    if (!accesosUserId) return;
    let cancelled = false;
    void (async () => {
      try {
        let data = await fetchWaAccesos();
        if (!data.tagIds.length && !data.clusters.length) {
          const localesIds = readPinnedTagIds();
          const localesClusters = readPinnedClusters();
          if (localesIds.length || localesClusters.length) {
            data = await saveWaAccesos({ tagIds: localesIds, clusters: localesClusters });
          }
        }
        localStorage.removeItem(PINNED_WA_TAGS_KEY);
        localStorage.removeItem(PINNED_CLUSTERS_KEY);
        if (cancelled) return;
        setPinnedTagIds(data.tagIds);
        setPinnedClusters(data.clusters);
        accesosListos.current = true;
      } catch {
        /* si no carga, el acceso rápido queda vacío en esta sesión */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accesosUserId]);

  useEffect(() => {
    if (!accesosListos.current || !accesosUserId) return;
    const timer = window.setTimeout(() => {
      void saveWaAccesos({ tagIds: pinnedTagIds, clusters: pinnedClusters }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [pinnedTagIds, pinnedClusters, accesosUserId]);

  const pinnedTags = useMemo(
    () =>
      pinnedTagIds
        .map((id) => tags.find((tag) => tag.id === id))
        .filter((tag): tag is WaTag => Boolean(tag)),
    [pinnedTagIds, tags],
  );

  const pinnedOrderKey = pinnedTags.map((tag) => tag.id).join("|");
  const activeClusters = useMemo(() => {
    if (tags.length === 0) return pinnedClusters;
    return normalizeClusters(
      pinnedTags.map((tag) => tag.id),
      pinnedClusters,
    );
  }, [pinnedOrderKey, pinnedClusters, pinnedTags, tags.length]);

  useEffect(() => {
    if (!sameClusters(activeClusters, pinnedClusters)) setPinnedClusters(activeClusters);
  }, [activeClusters, pinnedClusters]);

  useEffect(() => {
    setPinnedTagIds((prev) => {
      const next = withGroupsFirst(prev, activeClusters);
      return next.join("|") === prev.join("|") ? prev : next;
    });
  }, [activeClusters, pinnedOrderKey]);

  useEffect(() => {
    if (groupingTags && pinnedTags.length < CLUSTER_MIN) {
      setGroupingTags(false);
      setEditingGroups(false);
      setGroupPick([]);
    }
  }, [groupingTags, pinnedTags.length]);

  const pinnedBlocks = useMemo(() => {
    const byTag = new Map<string, PinnedCluster>();
    for (const cluster of activeClusters) {
      for (const id of cluster.tagIds) byTag.set(id, cluster);
    }
    const seen = new Set<string>();
    const blocks: Array<
      | { kind: "single"; tag: WaTag; index: number }
      | { kind: "cluster"; cluster: PinnedCluster; items: { tag: WaTag; index: number }[] }
    > = [];
    pinnedTags.forEach((tag, index) => {
      const cluster = byTag.get(tag.id);
      if (!cluster) {
        blocks.push({ kind: "single", tag, index });
        return;
      }
      if (seen.has(cluster.id)) return;
      const items = pinnedTags
        .map((item, itemIndex) => ({ tag: item, index: itemIndex }))
        .filter((item) => cluster.tagIds.includes(item.tag.id));
      if (items.length < CLUSTER_MIN) {
        blocks.push({ kind: "single", tag, index });
        return;
      }
      seen.add(cluster.id);
      blocks.push({ kind: "cluster", cluster, items });
    });
    return blocks;
  }, [pinnedTags, activeClusters]);

  const freePinnedCount = pinnedTags.filter(
    (tag) => !activeClusters.some((cluster) => cluster.tagIds.includes(tag.id)),
  ).length;

  const quickTagResults = useMemo(() => {
    const q = quickTagQuery.trim().toLowerCase();
    const assigned = new Set(selected?.tagIds ?? []);
    return tags
      .filter((tag) => {
        if (!q) return true;
        const groupName =
          tagGroups.find((group) => group.id === tag.groupId)?.name?.toLowerCase() ?? "";
        return tag.name.toLowerCase().includes(q) || groupName.includes(q);
      })
      .sort((a, b) => {
        const aOn = assigned.has(a.id) ? 0 : 1;
        const bOn = assigned.has(b.id) ? 0 : 1;
        if (aOn !== bOn) return aOn - bOn;
        return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
      });
  }, [tags, quickTagQuery, tagGroups, selected?.tagIds]);
  const usoPorModelo = useMemo(() => {
    return PASOS_BOT.map((paso) => {
      const items = uso.filter((item) => item.paso === paso.paso);
      const modelos = [...new Set(items.map((item) => item.modelo).filter(Boolean))];
      const modelo = modelos.length ? modelos.join(", ") : paso.modelo;
      const precio = precioModelo(modelos[0] ?? paso.modelo);
      const entrada = items.reduce((sum, item) => sum + item.tokensEntrada, 0);
      const salida = items.reduce((sum, item) => sum + item.tokensSalida, 0);
      const costo = items.reduce((sum, item) => {
        const tarifaItem = precioModelo(item.modelo);
        return sum + costoUsd(item.tokensEntrada, item.tokensSalida, tarifaItem.entrada, tarifaItem.salida);
      }, 0);
      return {
        ...paso,
        modelo,
        entradaPorMillon: precio.entrada,
        salidaPorMillon: precio.salida,
        llamadas: items.length,
        entrada,
        salida,
        total: items.reduce((sum, item) => sum + item.tokensTotal, 0),
        costo,
      };
    });
  }, [uso]);
  const availableTags = useMemo(
    () => tags.filter((tag) => !(selected?.tagIds ?? []).includes(tag.id)),
    [tags, selected?.tagIds],
  );
  const assignedModalTags = useMemo(() => {
    const q = tagsModalQuery.trim().toLowerCase();
    return assignedTags.filter((tag) => {
      if (tagsModalGroupId && tag.groupId !== tagsModalGroupId) return false;
      if (!q) return true;
      const groupName =
        tagGroups.find((group) => group.id === tag.groupId)?.name?.toLowerCase() ?? "";
      return tag.name.toLowerCase().includes(q) || groupName.includes(q);
    });
  }, [assignedTags, tagsModalGroupId, tagsModalQuery, tagGroups]);
  const availableModalTags = useMemo(() => {
    const q = tagsModalQuery.trim().toLowerCase();
    return availableTags.filter((tag) => {
      if (tagsModalGroupId && tag.groupId !== tagsModalGroupId) return false;
      if (!q) return true;
      const groupName =
        tagGroups.find((group) => group.id === tag.groupId)?.name?.toLowerCase() ?? "";
      return tag.name.toLowerCase().includes(q) || groupName.includes(q);
    });
  }, [availableTags, tagsModalGroupId, tagsModalQuery, tagGroups]);

  function tagColor(tag: { groupId: string }): string {
    return tagGroups.find((group) => group.id === tag.groupId)?.color ?? "#a61948";
  }

  function tagGroupLabel(tag: { groupId: string }): string {
    return tagGroups.find((group) => group.id === tag.groupId)?.name ?? "Sin grupo";
  }

  const selectedFilterTags = useMemo(
    () =>
      filters.tagIds
        .map((id) => tags.find((tag) => tag.id === id))
        .filter((tag): tag is WaTag => Boolean(tag)),
    [filters.tagIds, tags],
  );

  const tagFilterSuggestions = useMemo(() => {
    const q = tagFilterQuery.trim().toLowerCase();
    return tags
      .filter((tag) => !filters.tagIds.includes(tag.id))
      .filter((tag) => {
        if (!q) return true;
        const groupName = tagGroupLabel(tag).toLowerCase();
        return tag.name.toLowerCase().includes(q) || groupName.includes(q);
      })
      .sort((a, b) => {
        const byGroup = tagGroupLabel(a).localeCompare(tagGroupLabel(b), "es");
        if (byGroup) return byGroup;
        return a.name.localeCompare(b.name, "es");
      });
  }, [tags, filters.tagIds, tagFilterQuery, tagGroups]);

  const tagsModalSelectedGroup = useMemo(
    () => tagGroups.find((group) => group.id === tagsModalGroupId) ?? null,
    [tagGroups, tagsModalGroupId],
  );

  useEffect(() => {
    if (!tagsModalGroupMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!tagsGroupPickerRef.current?.contains(e.target as Node)) {
        setTagsModalGroupMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tagsModalGroupMenuOpen]);

  useEffect(() => {
    if (!tagFilterSuggestOpen) return;
    function onDoc(e: MouseEvent) {
      if (!tagFilterWrapRef.current?.contains(e.target as Node)) {
        setTagFilterSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tagFilterSuggestOpen]);

  function setConversationTag(tagId: string, assigned: boolean) {
    const current = pendingTags.current ?? selected?.tagIds ?? [];
    const has = current.includes(tagId);
    if (assigned === has) return;
    const next = assigned ? [...current, tagId] : current.filter((id) => id !== tagId);
    void applyTags(next);
  }

  const operatorColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const op of operators) {
      if (op.id && op.color) map.set(op.id, op.color);
    }
    return map;
  }, [operators]);

  const operatorColorByName = useMemo(() => {
    return operators.map((op) => ({
      color: op.color || "#94a3b8",
      norm: op.nombre
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, ""),
    }));
  }, [operators]);

  function assigneeColor(conversation: {
    assigneeKind?: "none" | "bot" | "user" | null;
    assigneeUserId?: string | null;
    assigneeName?: string | null;
  }): string {
    if (conversation.assigneeKind === "bot") return "#a61948";
    if (conversation.assigneeKind !== "user") return "#94a3b8";
    if (conversation.assigneeUserId) {
      const byId = operatorColorById.get(conversation.assigneeUserId);
      if (byId) return byId;
    }
    const nombre = conversation.assigneeName?.trim().toLowerCase();
    if (nombre) {
      const tokens = nombre
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .split(/\s+/)
        .filter((t) => t.length >= 3);
      if (tokens.length) {
        const byName = operatorColorByName.find((op) =>
          tokens.every(
            (t) =>
              op.norm.includes(t) ||
              (t.length >= 5 && op.norm.split(/\s+/).some((p) => p.startsWith(t.slice(0, 5)))),
          ),
        );
        if (byName?.color) return byName.color;
      }
    }
    return "#94a3b8";
  }

  const slashQuery = useMemo(() => extractSlashQuery(draft), [draft]);
  const slashSuggestions = useMemo(() => {
    if (slashQuery === null) return [];
    return quickReplies
      .filter((item) => item.isActive && item.trigger.startsWith(slashQuery))
      .slice(0, 8);
  }, [quickReplies, slashQuery]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery, slashSuggestions.length]);

  function replyVars() {
    const operadora =
      selected?.assigneeKind === "user" || selected?.assigneeKind === "bot"
        ? selected.assigneeName
        : "";
    return quickReplyVars(selected?.contact, operadora);
  }

  function applyQuickReply(item: QuickReply) {
    lastQuickReplyRef.current = item;
    setDraft(resolveQuickReply(item.body, replyVars()));
  }

  function resolveOutgoingText(raw: string): { text: string; reply: QuickReply | null } {
    const query = extractSlashQuery(raw.trim());
    if (query) {
      const match = quickReplies.find((item) => item.isActive && item.trigger === query) ?? null;
      if (match) {
        return { text: resolveQuickReply(match.body, replyVars()), reply: match };
      }
    }
    return { text: raw.trim(), reply: lastQuickReplyRef.current };
  }

  async function applyQuickReplyTag(item: QuickReply): Promise<void> {
    const toAdd = (item.tagIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    if (toAdd.length === 0) return;
    const current = pendingTags.current ?? selected?.tagIds ?? [];
    const next = [...new Set([...current, ...toAdd])];
    if (next.length === current.length) return;
    await applyTags(next);
  }

  async function flushPendingTags(): Promise<void> {
    for (let i = 0; i < 50; i += 1) {
      if (!savingTags.current && !pendingTags.current) return;
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    }
  }

  async function applyTags(tagIds: string[]): Promise<void> {
    if (!selectedId) return;
    const conversationId = selectedId;
    pendingTags.current = tagIds;
    setSelected((prev) => (prev && prev.id === conversationId ? { ...prev, tagIds } : prev));
    setConversations((prev) =>
      prev.map((item) => (item.id === conversationId ? { ...item, tagIds } : item)),
    );
    if (savingTags.current) {
      await flushPendingTags();
      return;
    }
    savingTags.current = true;
    try {
      while (pendingTags.current) {
        const next = pendingTags.current;
        pendingTags.current = null;
        const updated = await setWaConversationTags(conversationId, next);
        const saved = updated.tagIds ?? next;
        if (pendingTags.current) continue;
        setSelected((prev) =>
          prev && prev.id === conversationId
            ? { ...prev, ...updated, tagIds: saved, contact: updated.contact ?? prev.contact }
            : prev,
        );
        setConversations((prev) =>
          prev.map((item) => (item.id === updated.id ? { ...item, ...updated, tagIds: saved } : item)),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar las etiquetas");
    } finally {
      savingTags.current = false;
      if (pendingTags.current) await applyTags(pendingTags.current);
    }
  }

  function toggleConversationTag(tagId: string, exclusiveIds?: string[]) {
    const current = pendingTags.current ?? selected?.tagIds ?? [];
    if (current.includes(tagId)) {
      void applyTags(current.filter((id) => id !== tagId));
      return;
    }
    const others = new Set((exclusiveIds ?? []).filter((id) => id !== tagId));
    void applyTags([...current.filter((id) => !others.has(id)), tagId]);
  }

  function togglePinnedTag(tagId: string) {
    setPinnedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
    setGroupPick((prev) => prev.filter((id) => id !== tagId));
  }

  function toggleGroupPick(tagId: string) {
    setGroupPick((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }

  function commitPinnedGroup() {
    const pick = new Set(groupPick);
    const orderedPick = pinnedTags.map((tag) => tag.id).filter((id) => pick.has(id));
    if (orderedPick.length < CLUSTER_MIN) return;
    const picked = new Set(orderedPick);
    setPinnedTagIds((prev) => {
      const known = new Set(tags.map((tag) => tag.id));
      const visible = prev.filter((id) => known.has(id));
      const hidden = prev.filter((id) => !known.has(id));
      const selected = visible.filter((id) => picked.has(id));
      if (selected.length < CLUSTER_MIN) return prev;
      const first = visible.findIndex((id) => picked.has(id));
      const before = visible.slice(0, first).filter((id) => !picked.has(id)).length;
      const rest = visible.filter((id) => !picked.has(id));
      return [...rest.slice(0, before), ...selected, ...rest.slice(before), ...hidden];
    });
    setPinnedClusters((prev) => [
      ...prev
        .map((cluster) => ({
          ...cluster,
          tagIds: cluster.tagIds.filter((id) => !picked.has(id)),
        }))
        .filter((cluster) => cluster.tagIds.length >= CLUSTER_MIN),
      { id: newClusterId(), color: groupColor, tagIds: orderedPick },
    ]);
    setGroupingTags(false);
    setEditingGroups(false);
    setGroupPick([]);
  }

  function beginPinnedDrag(tagId: string) {
    dragPinnedIdRef.current = tagId;
    pinnedDropIndexRef.current = null;
    setDragPinnedId(tagId);
    setPinnedDropIndex(null);
  }

  function movePinnedDrop(index: number) {
    if (pinnedDropIndexRef.current === index) return;
    pinnedDropIndexRef.current = index;
    setPinnedDropIndex(index);
  }

  function endPinnedDrag() {
    dragPinnedIdRef.current = null;
    pinnedDropIndexRef.current = null;
    setDragPinnedId(null);
    setPinnedDropIndex(null);
  }

  function clusterSpan(tagId: string): { start: number; end: number } | null {
    const cluster = activeClusters.find((item) => item.tagIds.includes(tagId));
    if (!cluster) return null;
    const indexes = pinnedTags
      .map((tag, index) => (cluster.tagIds.includes(tag.id) ? index : -1))
      .filter((index) => index >= 0);
    if (indexes.length < CLUSTER_MIN) return null;
    return { start: indexes[0]!, end: indexes[indexes.length - 1]! };
  }

  function dropInsideGroup(tagId: string, insertAt: number): boolean {
    const own = clusterSpan(tagId);
    if (own) return insertAt >= own.start && insertAt <= own.end + 1;
    const grouped = new Set(activeClusters.flatMap((cluster) => cluster.tagIds));
    const firstFree = pinnedTags.findIndex((tag) => !grouped.has(tag.id));
    const min = firstFree < 0 ? pinnedTags.length : firstFree;
    return insertAt >= min;
  }

  function reorderPinnedTags(tagId: string, insertAt: number) {
    if (!dropInsideGroup(tagId, insertAt)) return;
    setPinnedTagIds((prev) => {
      const known = new Set(tags.map((tag) => tag.id));
      const visible = prev.filter((id) => known.has(id));
      const hidden = prev.filter((id) => !known.has(id));
      const fromIndex = visible.indexOf(tagId);
      if (fromIndex < 0) return prev;
      let target = Math.max(0, Math.min(insertAt, visible.length));
      const next = [...visible];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      if (target > fromIndex) target -= 1;
      if (target === fromIndex) return prev;
      next.splice(target, 0, moved);
      return [...next, ...hidden];
    });
  }

  function handlePinnedDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const tagId = dragPinnedIdRef.current;
    if (!tagId) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const nextIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
    if (!dropInsideGroup(tagId, nextIndex)) {
      event.dataTransfer.dropEffect = "none";
      if (pinnedDropIndexRef.current != null) {
        pinnedDropIndexRef.current = null;
        setPinnedDropIndex(null);
      }
      return;
    }
    movePinnedDrop(nextIndex);
  }

  function handlePinnedDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const tagId = dragPinnedIdRef.current;
    const index = pinnedDropIndexRef.current;
    if (tagId && index != null) reorderPinnedTags(tagId, index);
    endPinnedDrag();
  }

  async function applyAssignee(kind: "none" | "bot" | "user", userId?: string): Promise<boolean> {
    if (!selectedId || assigning) return false;
    const conversationId = selectedId;
    const optimisticName =
      kind === "bot"
        ? "Bot"
        : kind === "user"
          ? operators.find((op) => op.id === userId)?.nombre?.trim() || selected?.assigneeName || null
          : null;
    const optimisticUserId = kind === "user" ? userId ?? null : null;
    const touch: AssigneeTouch = {
      id: conversationId,
      assigneeKind: kind,
      assigneeUserId: optimisticUserId,
      assigneeName: kind === "none" ? null : optimisticName,
      at: Date.now(),
    };
    assigneeTouchRef.current = touch;
    setSelected((prev) =>
      prev && prev.id === conversationId
        ? {
            ...prev,
            assigneeKind: kind,
            assigneeUserId: optimisticUserId,
            assigneeName: touch.assigneeName,
          }
        : prev,
    );
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              assigneeKind: kind,
              assigneeUserId: optimisticUserId,
              assigneeName: touch.assigneeName,
            }
          : c,
      ),
    );
    setAssigning(true);
    try {
      const updated = await assignWaConversation(conversationId, { kind, userId });
      assigneeTouchRef.current = {
        id: updated.id,
        assigneeKind:
          updated.assigneeKind === "bot" || updated.assigneeKind === "user"
            ? updated.assigneeKind
            : "none",
        assigneeUserId: updated.assigneeUserId ?? null,
        assigneeName: updated.assigneeName ?? null,
        at: Date.now(),
      };
      const merged = {
        ...selected,
        ...updated,
        contact: updated.contact ?? selected?.contact,
      };
      setSelected((prev) => (prev && prev.id === updated.id ? { ...prev, ...merged } : prev));
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      return true;
    } catch (error) {
      assigneeTouchRef.current = null;
      toast.error(error instanceof Error ? error.message : "No se pudo asignar");
      // Revertir optimista recargando la conversación actual desde la lista/servidor.
      void loadThread(conversationId);
      return false;
    } finally {
      setAssigning(false);
    }
  }

  async function applyResolve(): Promise<boolean> {
    if (!selectedId || assigning) return false;
    const conversationId = selectedId;
    const touch: AssigneeTouch = {
      id: conversationId,
      assigneeKind: "bot",
      assigneeUserId: null,
      assigneeName: "Bot",
      at: Date.now(),
    };
    assigneeTouchRef.current = touch;
    setSelected((prev) =>
      prev && prev.id === conversationId
        ? {
            ...prev,
            assigneeKind: "bot",
            assigneeUserId: null,
            assigneeName: "Bot",
            resolutionStatus: "resolved",
            botPausedUntilInbound: true,
          }
        : prev,
    );
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              assigneeKind: "bot",
              assigneeUserId: null,
              assigneeName: "Bot",
              resolutionStatus: "resolved",
              botPausedUntilInbound: true,
            }
          : c,
      ),
    );
    setAssigning(true);
    try {
      const updated = await resolveWaConversation(conversationId);
      assigneeTouchRef.current = {
        id: updated.id,
        assigneeKind: "bot",
        assigneeUserId: null,
        assigneeName: updated.assigneeName ?? "Bot",
        at: Date.now(),
      };
      setSelected((prev) =>
        prev && prev.id === updated.id
          ? { ...prev, ...updated, contact: updated.contact ?? prev.contact }
          : prev,
      );
      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      );
      return true;
    } catch (error) {
      assigneeTouchRef.current = null;
      toast.error(error instanceof Error ? error.message : "No se pudo marcar como resuelta");
      void loadThread(conversationId);
      return false;
    } finally {
      setAssigning(false);
    }
  }

  function rememberContact(updated: WaContact) {
    const merge = (current: WaConversation): WaConversation =>
      current.contactId === updated.id
        ? {
            ...current,
            contact: {
              ...updated,
              phoneNumber: updated.phoneNumber?.trim() || current.contact?.phoneNumber || "",
            },
          }
        : current;
    setSelected((prev) => (prev ? merge(prev) : prev));
    setConversations((prev) => prev.map(merge));
  }

  function onInboundWordClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.detail !== 1) return;
    const start = wordPointer.current;
    wordPointer.current = null;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    seleccionarPalabra(event.clientX, event.clientY, event.currentTarget);
  }

  function onInboundContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!selected?.contact) return;
    const bubble = event.currentTarget;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    const node = range?.commonAncestorContainer ?? null;
    const yaSelecciono =
      Boolean(range && !range.collapsed && node && bubble.contains(node)) &&
      (() => {
        const probe = document.caretPositionFromPoint?.(event.clientX, event.clientY);
        const probeNode = probe?.offsetNode;
        return !probeNode || range?.intersectsNode(probeNode) === true;
      })();
    let text = yaSelecciono ? selection?.toString().replace(/\s+/g, " ").trim() ?? "" : "";
    if (!text) text = seleccionarPalabra(event.clientX, event.clientY, bubble);
    if (!text) {
      text = bubble.querySelector(".wa-bubble__text")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    }
    if (!text) return;
    event.preventDefault();
    const width = 248;
    const height = 360;
    setDatoMenu({
      text,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  }

  function buscarComoEtiqueta() {
    const text = datoMenu?.text.trim() ?? "";
    if (!text) return;
    if (pruebaMode) {
      setTagsModalGroupId("");
      setTagsModalQuery(text);
      setTagsModalOpen(true);
    } else {
      setVistaOperadora(true);
      setSidePanelPinned(true);
      setSidePanelOpen(true);
      setOperadoraTab("etiquetas");
      setQuickTagQuery(text);
      tagSearchFocus.current = true;
    }
    setDatoMenu(null);
  }

  async function copyDatoSeleccionado() {
    if (!datoMenu) return;
    try {
      await navigator.clipboard.writeText(datoMenu.text);
      toast.success("Texto copiado");
    } catch {
      toast.error("No se pudo copiar el texto");
    }
    setDatoMenu(null);
  }

  async function guardarDatoSeleccionado(campo: DatoCampo) {
    const contact = selected?.contact;
    const text = datoMenu?.text.trim() ?? "";
    if (!contact || !text || datoSaving) return;
    let firstName = contact.firstName?.trim() || "";
    let lastName = contact.lastName?.trim() || "";
    let dni = contact.dni?.trim() || "";
    let email = contact.email?.trim() || "";
    let contactoNombre = contact.contactoNombre?.trim() || "";
    let contactoApellido = contact.contactoApellido?.trim() || "";
    let label = "dato";
    if (campo === "firstName") {
      firstName = text;
      label = "Nombre";
    } else if (campo === "lastName") {
      lastName = text;
      label = "Apellido";
    } else if (campo === "fullName") {
      const parts = text.split(/\s+/).filter(Boolean);
      firstName = parts[0] ?? "";
      lastName = parts.slice(1).join(" ");
      label = "Nombre y apellido";
    } else if (campo === "dni") {
      const digits = text.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 8) {
        toast.error("Ese texto no parece un DNI");
        return;
      }
      dni = digits;
      label = "DNI";
    } else if (campo === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        toast.error("Ese texto no es un email");
        return;
      }
      email = text;
      label = "Email";
    } else if (campo === "contactoNombre") {
      contactoNombre = text;
      label = "Nombre de quien escribe";
    } else if (campo === "contactoApellido") {
      contactoApellido = text;
      label = "Apellido de quien escribe";
    }
    if (!firstName) {
      toast.error("Primero guardá el nombre del paciente");
      return;
    }
    setDatoSaving(true);
    try {
      const updated = await updateWaContact(contact.id, {
        firstName,
        lastName,
        cobertura: contact.cobertura ?? "",
        email,
        fechaNacimiento: contact.fechaNacimiento ?? null,
        grupoEtario: contact.grupoEtario,
        consultaPara: contact.consultaPara,
        relacionFamiliar: contact.relacionFamiliar ?? "",
        contactoNombre,
        contactoApellido,
        dni,
        sexo: contact.sexo,
        esPaciente: contact.esPaciente,
      });
      rememberContact(updated);
      toast.success(`Guardado en ${label}`);
      setDatoMenu(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar el dato");
    } finally {
      setDatoSaving(false);
    }
  }

  function currentAssigneeSelectValue(): string {
    if (selected?.assigneeKind === "bot") return "bot";
    if (selected?.assigneeKind === "user") return selected.assigneeUserId ?? "";
    return "";
  }

  function requestAssigneeChange(value: string) {
    if (value === currentAssigneeSelectValue()) return;
    setPendingAssignee(value);
  }

  async function confirmAssigneeChange() {
    if (pendingAssignee === null) return;
    const value = pendingAssignee;
    let ok = false;
    if (value === "bot") ok = await applyAssignee("bot");
    else if (!value) ok = await applyAssignee("none");
    else ok = await applyAssignee("user", value);
    if (ok) setPendingAssignee(null);
  }

  async function confirmTakeOver() {
    if (!user?.id) {
      toast.error("No se pudo identificar tu usuario");
      return;
    }
    const ok = await applyAssignee("user", user.id);
    if (ok) setTakeOverOpen(false);
  }

  function closeSelectedConversation() {
    setSelectedId(null);
    setSelected(null);
    setMessages([]);
    setDraft("");
    setAttachment(null);
    setProfileOpen(false);
    setTakeOverOpen(false);
    setPendingAssignee(null);
    setAccionesOpen(false);
    setHighlightMessageId(null);
  }

  function marcarAccionHecha(messageId: string) {
    setAccionesHechas((prev) => ({ ...prev, [messageId]: true }));
  }

  function irAlMensajeAccion(messageId: string) {
    setAccionesOpen(false);
    window.requestAnimationFrame(() => {
      const root = messagesBoxRef.current;
      if (!root) return;
      const el = root.querySelector(
        `[data-message-id="${CSS.escape(messageId)}"]`,
      ) as HTMLElement | null;
      if (!el) {
        toast.info("No encontré ese mensaje en la conversación");
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightMessageId(messageId);
      window.setTimeout(() => {
        setHighlightMessageId((actual) => (actual === messageId ? null : actual));
      }, 2200);
    });
  }

  async function ejecutarBuscaTurnoDesdeMensaje(messageId: string) {
    const m = messages.find((item) => item.id === messageId);
    if (!m) return;
    let estado = selected?.menuEstado;
    if (selectedId) {
      try {
        const fresh = await fetchWaConversation(selectedId);
        estado = fresh.menuEstado ?? estado;
        setSelected((prev) =>
          prev && prev.id === fresh.id
            ? {
                ...prev,
                ...fresh,
                contact: fresh.contact ?? prev.contact,
              }
            : prev,
        );
      } catch {
        /* usamos el estado en memoria */
      }
    }
    const delGlobo = parsePedidoTurnoBubble(String(m.text ?? ""));
    const contact = selected?.contact;
    const pick = (...vals: Array<string | null | undefined>) => {
      for (const v of vals) {
        const t = String(v ?? "").trim();
        if (t) return t;
      }
      return "";
    };
    const dni = pick(estado?.dni, contact?.dni, delGlobo.dni).replace(/\D/g, "");
    const sexoRaw = pick(estado?.sexo, contact?.sexo).toLowerCase();
    const sexo =
      sexoRaw === "masculino" || sexoRaw === "femenino"
        ? (sexoRaw as "masculino" | "femenino")
        : "";
    const tratamientoLibre = pick(
      estado?.tratamiento,
      delGlobo.tratamiento,
      delGlobo.prestacion,
    );
    let prestacionCodigo = estado?.prestacionCodigo?.trim() || "";
    let prestacionNombre = estado?.tratamientoCatalogo?.trim() || delGlobo.prestacion || "";
    let profesionalDoc = estado?.profesionalDoc?.trim() || "";
    let profesionalNombre = pick(
      estado?.profesionalCatalogo,
      estado?.profesional,
      delGlobo.profesional,
    );
    const pidioProfesional = Boolean(profesionalDoc || profesionalNombre);
    const modalidad = estado?.modalidad || delGlobo.modalidad || "";
    const fechaNacimiento = pick(
      estado?.fechaNacimiento,
      contact?.fechaNacimiento,
      delGlobo.fechaNacimiento,
    );
    const grupoEtario =
      contact?.grupoEtario === "adulto" || contact?.grupoEtario === "infanto"
        ? contact.grupoEtario
        : "";
    if (tratamientoLibre) {
      try {
        const match = await matchWaPrestacion({
          texto: tratamientoLibre,
          profesionalDoc: profesionalDoc || undefined,
          profesionalNombre: profesionalNombre || undefined,
          modalidad,
          grupoEtario,
          fechaNacimiento: fechaNacimiento || undefined,
          dni: dni || undefined,
          conversacionId: selectedId || undefined,
        });
        if (match) {
          prestacionCodigo = match.codigo;
          prestacionNombre = match.nombre;
          if (!pidioProfesional && match.profesionalDoc) {
            profesionalDoc = match.profesionalDoc;
            profesionalNombre = match.profesionalNombre || profesionalNombre;
          }
        }
      } catch {
        /* el catálogo local de Busca Turno sigue intentando el match */
      }
    }
    setBuscaTurnoMounted(true);
    setVistaOperadora(true);
    setSidePanelPinned(true);
    setSidePanelOpen(true);
    setOperadoraTab("busca");
    const preferencia = preferenciaPaciente(selectedId || "", profesionalNombre, prestacionNombre);
    setBuscaPedidoSeed({
      key: `${selectedId ?? ""}-${m.id}-${Date.now()}`,
      prestacionCodigo: prestacionCodigo || undefined,
      prestacionNombre: prestacionNombre || undefined,
      tratamiento: tratamientoLibre || undefined,
      profesionalDoc: profesionalDoc || undefined,
      profesionalNombre: profesionalNombre || undefined,
      modalidad: estado?.modalidad || delGlobo.modalidad || "",
      preferencia,
      paciente: {
        dni: dni || undefined,
        fechaNacimiento:
          pick(estado?.fechaNacimiento, contact?.fechaNacimiento, delGlobo.fechaNacimiento) ||
          undefined,
        nombre: pick(estado?.nombre, contact?.firstName) || undefined,
        apellido: pick(estado?.apellido, contact?.lastName) || undefined,
        email: pick(estado?.email, contact?.email) || undefined,
        telefono:
          pick(estado?.telefono, contact?.phoneNumber).replace(/\D/g, "") || undefined,
        sexo: sexo || undefined,
      },
    });
    setBuscaAccionMessageId(messageId);
    setAccionesOpen(false);
  }

  async function pedirCancelarTurnoDesdeMensaje(messageId: string) {
    const m = messages.find((item) => item.id === messageId);
    if (!m) return;
    let estado = selected?.menuEstado;
    if (selectedId) {
      try {
        const fresh = await fetchWaConversation(selectedId);
        estado = fresh.menuEstado ?? estado;
        setSelected((prev) =>
          prev && prev.id === fresh.id
            ? {
                ...prev,
                ...fresh,
                contact: fresh.contact ?? prev.contact,
              }
            : prev,
        );
      } catch {
        /* ignore */
      }
    }
    const idx = messages.findIndex((item) => item.id === m.id);
    const pedido = parseCancelacionBubble(
      [textoPrevioCancelacion(messages, idx), String(m.text ?? "")].filter(Boolean).join("\n"),
      estado?.dni?.trim() || selected?.contact?.dni || "",
    );
    if (!pedido) {
      toast.error(
        "Faltan DNI, profesional o fecha/hora en el pedido para anularlo automático.",
      );
      return;
    }
    setCancelTurnoPendiente({ ...pedido, messageId });
  }

  async function handleConnect() {
    setQrModalOpen(true);
    setConnecting(true);
    try {
      const status = await connectWhatsapp();
      setWaStatus(String(status.status ?? ""));
      setQr(status.qr ?? null);
      setPhoneNumber(status.phoneNumber ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo conectar");
    } finally {
      setConnecting(false);
    }
  }

  if (connectRef) {
    connectRef.current = () => {
      void handleConnect();
    };
  }

  async function handleCreatePrueba() {
    if (creatingPruebaRef.current) return;
    creatingPruebaRef.current = true;
    setCreatingPrueba(true);
    setDraft("");
    setAttachment(null);
    try {
      const createdRaw = await createWaPrueba(pruebaMotor);
      const created: WaConversation = {
        ...createdRaw,
        lastMessageAt:
          createdRaw.lastMessageAt ||
          createdRaw.updatedAt ||
          createdRaw.createdAt ||
          null,
      };
      const msgs = pruebaMotor === "menu" ? await fetchWaMessages(created.id) : [];
      skipThreadLoad.current = created.id;
      abrirRef.current = created.id;
      vioCargaRef.current = true;
      setConversations((prev) =>
        [created, ...prev.filter((item) => item.id !== created.id)].sort((a, b) => {
          const ta = Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || "") || 0;
          const tb = Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || "") || 0;
          return tb - ta;
        }),
      );
      setMessages(msgs);
      setSelected(created);
      setSelectedId(created.id);
      if (createdRaw.__local) {
        toast.info("Prueba en memoria (Firestore sin cuota). Se borra al reiniciar la API.");
      }
      requestAnimationFrame(() => {
        listBodyRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear la prueba");
    } finally {
      creatingPruebaRef.current = false;
      setCreatingPrueba(false);
    }
  }

  if (createPruebaRef) {
    createPruebaRef.current = () => {
      void handleCreatePrueba();
    };
  }

  function openNotaIncorrecta() {
    const enviados = messages.filter((item) => item.direction === "OUTBOUND" && !item.isDeleted);
    if (enviados.length === 0) {
      toast.error("No hay respuestas de la IA para marcar");
      return;
    }
    const prev = selected?.pruebaAclaraciones ?? [];
    const validos = new Set(enviados.map((item) => item.id));
    setRechazoIds(prev.map((item) => item.messageId).filter((id) => validos.has(id)));
    setAclaraciones(Object.fromEntries(prev.map((item) => [item.messageId, item.texto])));
    setEligiendoRechazo(true);
  }

  function toggleRechazoMensaje(messageId: string) {
    setRechazoIds((prev) =>
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId],
    );
  }

  function abrirAclaraciones() {
    if (rechazoIds.length === 0) {
      toast.error("Elegí al menos un mensaje");
      return;
    }
    setNotaOpen(true);
  }

  function aplicarResultado(updated: WaConversation) {
    setSelected((prev) =>
      prev && prev.id === updated.id ? { ...prev, ...updated, contact: updated.contact ?? prev.contact } : prev,
    );
    setConversations((prev) =>
      prev.map((item) =>
        item.id === updated.id ? { ...item, ...updated, contact: updated.contact ?? item.contact } : item,
      ),
    );
  }

  async function marcarCorrecta() {
    if (!selectedId || notaSaving) return;
    setNotaSaving(true);
    try {
      aplicarResultado(await saveWaPruebaNota(selectedId, "correcta"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo marcar como correcta");
    } finally {
      setNotaSaving(false);
    }
  }

  async function saveNotaIncorrecta() {
    if (!selectedId || notaSaving) return;
    const elegidos = messages.filter(
      (item) => item.direction === "OUTBOUND" && rechazoIds.includes(item.id),
    );
    if (elegidos.length === 0) {
      toast.error("Elegí al menos un mensaje");
      return;
    }
    if (elegidos.some((item) => !String(aclaraciones[item.id] ?? "").trim())) {
      toast.error("Escribí una aclaración en cada mensaje elegido");
      return;
    }
    setNotaSaving(true);
    try {
      aplicarResultado(
        await saveWaPruebaNota(
          selectedId,
          "incorrecta",
          elegidos.map((item) => ({
            messageId: item.id,
            texto: String(aclaraciones[item.id] ?? "").trim(),
          })),
        ),
      );
      setNotaOpen(false);
      setEligiendoRechazo(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar la nota");
    } finally {
      setNotaSaving(false);
    }
  }

  function armarEsperaIa() {
    for (const id of typingTimersRef.current) window.clearTimeout(id);
    typingTimersRef.current = [];
    colaRef.current = [];
    pumpingRef.current = false;
    setOcultos([]);
    const espera = pruebaMotor === "menu" ? 1000 : esperaMsRef.current;
    const ahora = Date.now();
    esperaDesdeRef.current = ahora;
    avisoFalloRef.current = false;
    // Menú: typing al toque (máx. 1s). IA: cerca del final de la espera de agrupado.
    typingAtRef.current = pruebaMotor === "menu" ? ahora : ahora + Math.max(0, espera - 10_000);
    waitingReplyRef.current = true;
    setBotTyping(pruebaMotor === "menu" || espera <= 10_000);
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || (!pruebaMode && sending)) return;
    if (pruebaMode && (selected?.pruebaResultado === "correcta" || selected?.pruebaResultado === "incorrecta")) {
      return;
    }
    if (pruebaMode && selected?.assigneeKind === "user") return;
    if (!draft.trim() && !attachment) return;
    if (pruebaMode && attachment) {
      toast.error("En una prueba solo se puede mandar texto");
      return;
    }
    const conversationId = selectedId;
    const { text, reply } = resolveOutgoingText(draft);
    const file = attachment;
    if (reply) {
      await applyQuickReplyTag(reply);
    }
    await flushPendingTags();
    lastQuickReplyRef.current = null;
    if (pruebaMode) {
      const tempId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setDraft("");
      armarEsperaIa();
      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          conversationId,
          contactId: selected?.contactId ?? "",
          direction: "INBOUND",
          type: "TEXT",
          text,
          status: "RECEIVED",
          mimeType: null,
          fileName: null,
          mediaUrl: null,
          isDeleted: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      try {
        const result = await sendWaPruebaMessage(conversationId, text);
        // Por si la prueba se abrió sin loadThread: el efecto de typing necesita ver la carga.
        vioCargaRef.current = true;
        setMessages((prev) =>
          mergeMensajesServidor(
            prev.filter((item) => item.id !== tempId),
            result.messages,
          ),
        );
        if (result.conversation) {
          setSelected(result.conversation);
          setConversations((prev) =>
            prev.map((item) =>
              item.id === result.conversation!.id
                ? { ...item, ...result.conversation, contact: result.conversation!.contact ?? item.contact }
                : item,
            ),
          );
          // El bot menú puede crear etiquetas nuevas (turnos, pagos…): refrescar catálogo.
          void fetchWaTagCatalog()
            .then((catalog) => {
              setTagGroups(catalog.groups);
              setTags(catalog.items);
            })
            .catch(() => undefined);
        }
      } catch (error) {
        waitingReplyRef.current = false;
        typingAtRef.current = null;
        esperaDesdeRef.current = null;
        setBotTyping(false);
        setMessages((prev) => prev.filter((item) => item.id !== tempId));
        toast.error(error instanceof Error ? error.message : "No se pudo enviar el mensaje");
      }
      return;
    }
    setSending(true);
    try {
      if (file) {
        await sendWaMedia(conversationId, file, text || undefined);
        setAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        await sendWaMessage(conversationId, text);
      }
      setDraft("");
      const localTagIds = pendingTags.current ?? selected?.tagIds ?? [];
      const [msgs, page] = await Promise.all([
        fetchWaMessages(conversationId),
        fetchWaConversations({
          status: "OPEN",
          limit: Math.max(conversations.length, CONVERSATIONS_PAGE_SIZE),
          offset: 0,
          prueba: pruebaMode,
          motor: pruebaMode ? pruebaMotor : undefined,
          ...filtersQuery,
        }),
      ]);
      setMessages(msgs);
      setConversations((prev) => {
        const byId = new Map(page.items.map((item) => [item.id, item]));
        const merged = prev.map((item) => {
          const fresh = byId.get(item.id);
          if (!fresh) return item;
          if (item.id !== conversationId) return { ...item, ...fresh };
          return {
            ...item,
            ...fresh,
            tagIds: [...new Set([...(fresh.tagIds ?? []), ...(item.tagIds ?? []), ...localTagIds])],
            contact: fresh.contact ?? item.contact,
          };
        });
        const known = new Set(merged.map((item) => item.id));
        const fresh = page.items.filter((item) => !known.has(item.id));
        return [...fresh, ...merged].sort((a, b) => {
          const ta = Date.parse(a.lastMessageAt || a.updatedAt || a.createdAt || "") || 0;
          const tb = Date.parse(b.lastMessageAt || b.updatedAt || b.createdAt || "") || 0;
          return tb - ta;
        });
      });
      setSelected((prev) => {
        if (!prev || prev.id !== conversationId) return prev;
        const fresh = page.items.find((item) => item.id === conversationId);
        return {
          ...(fresh ?? prev),
          tagIds: [...new Set([...(fresh?.tagIds ?? []), ...(prev.tagIds ?? []), ...localTagIds])],
          contact: fresh?.contact ?? prev.contact,
        };
      });
      setHasMoreConversations(page.hasMore);
      setNextConversationsOffset(page.nextOffset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  const soyOperador = Boolean(user?.id && operators.some((op) => op.id === user.id));
  const otrosOperadores = useMemo(
    () => (user?.id ? operators.filter((op) => op.id !== user.id) : operators),
    [operators, user?.id],
  );

  if (!ready) {
    return (
      <div className="wa-inbox wa-inbox--loading">
        <LoadingBlock label="Cargando WhatsApp…" />
      </div>
    );
  }

  const connected = waStatus === "CONNECTED";
  const assignedToMe =
    selected?.assigneeKind === "user" &&
    Boolean(user?.id) &&
    selected.assigneeUserId === user?.id;
  const puedeMarcarResuelta =
    Boolean(assignedToMe) && (selected?.resolutionStatus ?? "open") !== "resolved";
  const pruebaCerrada =
    pruebaMode &&
    (selected?.pruebaResultado === "correcta" || selected?.pruebaResultado === "incorrecta");
  const pruebaDerivada = pruebaMode && selected?.assigneeKind === "user";
  const composerLocked = pruebaMode
    ? false
    : Boolean(selected) && selected?.contact?.isBlocked !== true && !assignedToMe;
  const takeOverHolderLabel = (() => {
    if (!selected) return "";
    if (selected.assigneeKind === "bot") return "Bot";
    if (selected.assigneeKind === "user" && selected.assigneeName?.trim()) {
      return selected.assigneeName.trim();
    }
    if (selected.assigneeKind === "user") return "otra operadora";
    return "";
  })();

  const pendingAssigneeMessage = (() => {
    if (pendingAssignee === null) return null;
    if (user?.id && pendingAssignee === user.id) {
      return (
        <>
          Si continuás, la conversación quedará <strong>en tus manos</strong> y vas a poder
          escribir.
        </>
      );
    }
    if (pendingAssignee === "bot") {
      return (
        <>
          Si continuás, se asignará al <strong>Bot</strong>.{" "}
          <strong>No vas a poder mandar mensajes</strong> hasta que te la vuelvas a asignar.
        </>
      );
    }
    if (!pendingAssignee) {
      return (
        <>
          Si continuás, la conversación quedará <strong>sin asignar</strong>.{" "}
          <strong>No vas a poder mandar mensajes</strong> hasta que te la asignes.
        </>
      );
    }
    const otherName =
      operators.find((op) => op.id === pendingAssignee)?.nombre?.trim() || "otra operadora";
    return (
      <>
        Si continuás, se asignará a <strong>{otherName}</strong>.{" "}
        <strong>No vas a poder mandar mensajes</strong> hasta que te la vuelvas a asignar.
      </>
    );
  })();

  function renderQuickTag(
    tag: WaTag,
    pinned: boolean,
    sortIndex?: number,
    showDropBefore = false,
    pickable = false,
    clusterColor?: string,
    groupEnd = false,
    canLeave = false,
    showGroup = true,
    exclusiveIds?: string[],
  ) {
    const assigned = (selected?.tagIds ?? []).includes(tag.id);
    const picked = pickable && groupPick.includes(tag.id);
    const sortable = sortIndex != null && !pickable;
    const tone = clusterColor ?? (picked ? groupColor : tagColor(tag));
    return (
      <div
        key={tag.id}
        className={`wa-tags-quick${assigned ? " is-on" : ""}${sortable ? " is-sortable" : ""}${
          dragPinnedId === tag.id ? " is-dragging" : ""
        }${showDropBefore ? " has-drop-before" : ""}${picked ? " is-picked" : ""}${
          groupEnd ? " is-group-end" : ""
        }`}
        style={{ "--tag": tone } as CSSProperties}
        draggable={sortable}
        onDragStart={
          sortable
            ? (event) => {
                if ((event.target as HTMLElement).closest("button")) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tag.id);
                beginPinnedDrag(tag.id);
              }
            : undefined
        }
        onDragOver={sortable ? (event) => handlePinnedDragOver(event, sortIndex) : undefined}
        onDrop={sortable ? handlePinnedDrop : undefined}
        onDragEnd={sortable ? endPinnedDrag : undefined}
      >
        {sortable ? (
          <span className="wa-tags-quick__grip" aria-hidden>
            <IconGrip size={14} />
          </span>
        ) : null}
        <button
          type="button"
          className="wa-tags-quick__apply"
          disabled={pickable ? false : !selectedId}
          aria-pressed={pickable ? picked : undefined}
          aria-label={
            pickable
              ? picked
                ? `Quitar ${tag.name} del grupo`
                : `Sumar ${tag.name} al grupo`
              : selectedId
                ? assigned
                  ? `Quitar ${tag.name}`
                  : `Etiquetar ${tag.name}`
                : "Elegí una conversación"
          }
          onClick={() =>
            pickable ? toggleGroupPick(tag.id) : toggleConversationTag(tag.id, exclusiveIds)
          }
        >
          <span className="wa-tags-quick__name">{tag.name}</span>
          {showGroup ? <span className="wa-tags-quick__group">{tagGroupLabel(tag)}</span> : null}
        </button>
        {clusterColor && !canLeave ? (
          <span className="wa-tags-quick__link" aria-hidden>
            <IconLink size={13} />
          </span>
        ) : null}
        {canLeave ? (
          <button
            type="button"
            className="wa-tags-quick__leave"
            aria-label={`Sacar ${tag.name} del grupo`}
            onClick={() => leavePinnedCluster(tag.id)}
          >
            <IconX size={13} />
          </button>
        ) : null}
        <button
          type="button"
          className={`wa-tags-quick__pin${pinned ? " is-pinned" : ""}`}
          aria-label={pinned ? `Quitar ${tag.name} del acceso rápido` : `Pinear ${tag.name}`}
          onClick={() => togglePinnedTag(tag.id)}
        >
          <IconPin size={14} filled={pinned} />
        </button>
      </div>
    );
  }

  function recolorPinnedCluster(clusterId: string, color: string) {
    setPinnedClusters((prev) =>
      prev.map((cluster) => (cluster.id === clusterId ? { ...cluster, color } : cluster)),
    );
  }

  function withGroupsFirst(tagIds: string[], clusters: PinnedCluster[]): string[] {
    const known = new Set(tags.map((tag) => tag.id));
    const visible = tagIds.filter((id) => known.has(id));
    const hidden = tagIds.filter((id) => !known.has(id));
    const grouped = new Set(clusters.flatMap((cluster) => cluster.tagIds));
    return [
      ...visible.filter((id) => grouped.has(id)),
      ...visible.filter((id) => !grouped.has(id)),
      ...hidden,
    ];
  }

  function dissolvePinnedCluster(clusterId: string) {
    const next = pinnedClusters.filter((cluster) => cluster.id !== clusterId);
    setPinnedClusters(next);
    setPinnedTagIds((prev) => withGroupsFirst(prev, next));
  }

  function leavePinnedCluster(tagId: string) {
    const next = pinnedClusters
      .map((cluster) =>
        cluster.tagIds.includes(tagId)
          ? { ...cluster, tagIds: cluster.tagIds.filter((id) => id !== tagId) }
          : cluster,
      )
      .filter((cluster) => cluster.tagIds.length >= CLUSTER_MIN);
    setPinnedClusters(next);
    setPinnedTagIds((prev) => withGroupsFirst(prev, next));
  }

  function renderPinnedItem(
    tag: WaTag,
    index: number,
    clusterColor?: string,
    groupEnd = false,
    exclusiveIds?: string[],
  ) {
    const fromIndex = dragPinnedId
      ? pinnedTags.findIndex((item) => item.id === dragPinnedId)
      : -1;
    const showDropBefore =
      !groupingTags &&
      dragPinnedId != null &&
      pinnedDropIndex === index &&
      pinnedDropIndex !== fromIndex &&
      pinnedDropIndex !== fromIndex + 1;
    return renderQuickTag(
      tag,
      true,
      groupingTags ? undefined : index,
      showDropBefore,
      groupingTags,
      clusterColor,
      groupEnd,
      Boolean(clusterColor) && editingGroups,
      false,
      exclusiveIds,
    );
  }

  function renderQuickTagsPanelBody(opts?: {
    withSearchRef?: boolean;
    pinned?: boolean;
    onTogglePin?: () => void;
  }) {
    return (
      <>
        <div className="table-search wa-tags-panel__search">
          <span className="table-search__icon" aria-hidden>
            <IconSearch size={16} />
          </span>
          <input
            ref={opts?.withSearchRef ? quickTagSearchRef : undefined}
            type="text"
            value={quickTagQuery}
            onChange={(e) => setQuickTagQuery(e.target.value)}
            placeholder="Buscar etiqueta…"
            aria-label="Buscar etiqueta"
            autoComplete="off"
          />
          {quickTagQuery ? (
            <button
              type="button"
              className="wa-tags-panel__clear"
              aria-label="Borrar búsqueda"
              onClick={() => setQuickTagQuery("")}
            >
              <IconX size={16} />
            </button>
          ) : null}
          {opts?.onTogglePin ? (
            <button
              type="button"
              className={`wa-tags-panel__pin${opts.pinned ? " is-on" : ""}`}
              aria-label={opts.pinned ? "Desfijar panel" : "Fijar panel"}
              title={opts.pinned ? "Desfijar panel" : "Fijar panel"}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                opts.onTogglePin?.();
              }}
            >
              <IconPin size={15} filled={Boolean(opts.pinned)} />
            </button>
          ) : null}
        </div>
        <div className="wa-tags-panel__scroll">
          {quickTagQuery.trim() ? (
            tags.length === 0 ? (
              <p>Todavía no hay etiquetas.</p>
            ) : quickTagResults.length === 0 ? (
              <p>Ninguna etiqueta coincide.</p>
            ) : (
              <div className="wa-tags-quick-list">
                {quickTagResults.map((tag) =>
                  renderQuickTag(
                    tag,
                    pinnedTagIds.includes(tag.id),
                    undefined,
                    false,
                    false,
                    (selected?.tagIds ?? []).includes(tag.id)
                      ? tagColor(tag)
                      : TAG_TODAS_NEUTRO,
                  ),
                )}
              </div>
            )
          ) : (
            <>
              <section className="wa-tags-panel__quick">
                <div className="wa-tags-panel__quick-head">
                  <h3>Acceso rápido</h3>
                  {pinnedTags.length >= CLUSTER_MIN ? (
                    groupingTags ? (
                      <button
                        type="button"
                        className={`wa-tags-panel__group-btn${
                          groupPick.length >= CLUSTER_MIN ? " is-ready" : " is-on"
                        }`}
                        onClick={() => {
                          if (editingGroups || groupPick.length < CLUSTER_MIN) {
                            setGroupingTags(false);
                            setEditingGroups(false);
                            setGroupPick([]);
                            return;
                          }
                          commitPinnedGroup();
                        }}
                      >
                        {groupPick.length >= CLUSTER_MIN ? "Listo" : "Cancelar"}
                      </button>
                    ) : (
                      <div className="wa-tags-panel__group-actions">
                        {activeClusters.length ? (
                          <button
                            type="button"
                            className="wa-tags-panel__group-btn"
                            onClick={() => {
                              const actual = activeClusters[activeClusters.length - 1];
                              if (!actual) return;
                              setGroupColor(actual.color);
                              setGroupPick([...actual.tagIds]);
                              setEditingGroups(true);
                              setGroupingTags(true);
                            }}
                          >
                            Editar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="wa-tags-panel__group-btn"
                          disabled={freePinnedCount < CLUSTER_MIN}
                          title={
                            freePinnedCount < CLUSTER_MIN
                              ? "No hay etiquetas libres para agrupar"
                              : "Agrupar"
                          }
                          onClick={() => {
                            if (freePinnedCount < CLUSTER_MIN) return;
                            const used = new Set(activeClusters.map((cluster) => cluster.color));
                            const next =
                              CLUSTER_COLORS.find((color) => !used.has(color)) ?? CLUSTER_COLORS[0]!;
                            setGroupColor(next);
                            setGroupPick([]);
                            setEditingGroups(false);
                            setGroupingTags(true);
                          }}
                        >
                          Agrupar
                        </button>
                      </div>
                    )
                  ) : null}
                </div>
                {groupingTags && !editingGroups ? (
                  <div className="wa-tags-color-picks" role="listbox" aria-label="Color del grupo">
                    {CLUSTER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="option"
                        className={`wa-tags-color-pick${groupColor === color ? " is-on" : ""}`}
                        style={{ background: color }}
                        aria-label="Elegir color"
                        aria-selected={groupColor === color}
                        onClick={() => setGroupColor(color)}
                      />
                    ))}
                  </div>
                ) : null}
                {pinnedTags.length === 0 ? (
                  <p>Pineá etiquetas del buscador para tenerlas acá.</p>
                ) : (
                  <div
                    className={`wa-tags-quick-list${dragPinnedId ? " is-sorting" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={handlePinnedDrop}
                  >
                    {pinnedBlocks.map((block, blockIndex) => {
                      if (block.kind === "single") {
                        const primeroSuelto =
                          pinnedBlocks.some((item) => item.kind === "cluster") &&
                          pinnedBlocks.findIndex((item) => item.kind === "single") === blockIndex;
                        return (
                          <div key={block.tag.id} className="wa-tags-free-slot">
                            {primeroSuelto ? <p className="wa-tags-free">Sin grupo</p> : null}
                            {renderPinnedItem(block.tag, block.index)}
                          </div>
                        );
                      }
                      return (
                        <div key={block.cluster.id} className="wa-tags-group">
                          {editingGroups ? (
                            <div className="wa-tags-group__edit">
                              <button
                                type="button"
                                className="wa-tags-group__undo"
                                onClick={() => dissolvePinnedCluster(block.cluster.id)}
                              >
                                Desagrupar
                              </button>
                              <div className="wa-tags-color-picks" role="listbox" aria-label="Color del grupo">
                                {CLUSTER_COLORS.map((color) => (
                                  <button
                                    key={color}
                                    type="button"
                                    role="option"
                                    className={`wa-tags-color-pick${block.cluster.color === color ? " is-on" : ""}`}
                                    style={{ background: color }}
                                    aria-label="Elegir color"
                                    aria-selected={block.cluster.color === color}
                                    onClick={() => recolorPinnedCluster(block.cluster.id, color)}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {block.items.map((item, itemIndex) =>
                            renderPinnedItem(
                              item.tag,
                              item.index,
                              block.cluster.color,
                              itemIndex === block.items.length - 1,
                              groupingTags ? undefined : block.cluster.tagIds,
                            ),
                          )}
                        </div>
                      );
                    })}
                    {dragPinnedId != null &&
                    pinnedDropIndex === pinnedTags.length &&
                    pinnedTags.findIndex((item) => item.id === dragPinnedId) !==
                      pinnedTags.length - 1 ? (
                      <div className="wa-tags-quick-drop-end" aria-hidden />
                    ) : null}
                  </div>
                )}
              </section>
              <section className="wa-tags-panel__fold">
                <h3>Todas</h3>
                {tags.length === 0 ? (
                  <p>Todavía no hay etiquetas.</p>
                ) : quickTagResults.length === 0 ? (
                  <p>Ninguna etiqueta coincide.</p>
                ) : (
                  <div className="wa-tags-quick-list">
                    {quickTagResults.map((tag) =>
                      renderQuickTag(
                        tag,
                        pinnedTagIds.includes(tag.id),
                        undefined,
                        false,
                        false,
                        (selected?.tagIds ?? []).includes(tag.id)
                          ? tagColor(tag)
                          : TAG_TODAS_NEUTRO,
                      ),
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </>
    );
  }

  function renderPacienteFicha(conv: WaConversation) {
    const persona = (value: string | null | undefined) => formatNombrePersona(value ?? "");
    return (
      <>
        <FichaAcordeon
          titulo="Quien escribe"
          abierto={fichaAbierta.escribe}
          onCambio={(abierto) =>
            setFichaAbierta((prev) => (prev.escribe === abierto ? prev : { ...prev, escribe: abierto }))
          }
        >
          <dl>
            {(
              [
                ["Nombre", persona(conv.contact?.contactoNombre)],
                ["Apellido", persona(conv.contact?.contactoApellido)],
                ["Relación con el paciente", persona(conv.contact?.relacionFamiliar)],
                ["Teléfono", conv.contact?.phoneNumber],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={textoDato(value) === "vacío" ? "is-empty" : ""}>{textoDato(value)}</dd>
              </div>
            ))}
          </dl>
        </FichaAcordeon>
        <FichaAcordeon
          titulo="Paciente"
          abierto={fichaAbierta.paciente}
          onCambio={(abierto) =>
            setFichaAbierta((prev) => (prev.paciente === abierto ? prev : { ...prev, paciente: abierto }))
          }
        >
          <dl>
            {(
              [
                [
                  "La consulta es para",
                  conv.contact?.consultaPara === "propio"
                    ? "Quien escribe"
                    : conv.contact?.consultaPara === "tercero"
                      ? "Otra persona"
                      : "",
                ],
                ["Nombre", persona(conv.contact?.firstName)],
                ["Apellido", persona(conv.contact?.lastName)],
                [
                  "Grupo etario",
                  conv.contact?.grupoEtario === "infanto"
                    ? "Infanto"
                    : conv.contact?.grupoEtario === "adulto"
                      ? "Adulto"
                      : "",
                ],
                ["DNI", conv.contact?.dni],
                ["Sexo", persona(conv.contact?.sexo)],
                [
                  "¿Es paciente?",
                  conv.contact?.esPaciente === true
                    ? "Sí"
                    : conv.contact?.esPaciente === false
                      ? "No"
                      : "",
                ],
                ["Cobertura", persona(conv.contact?.cobertura)],
                // Email sin Title Case.
                ["Email", conv.contact?.email],
                [
                  "Nacimiento",
                  conv.contact?.fechaNacimiento
                    ? formatFechaYmd(conv.contact.fechaNacimiento) || conv.contact.fechaNacimiento
                    : "",
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={textoDato(value) === "vacío" ? "is-empty" : ""}>{textoDato(value)}</dd>
              </div>
            ))}
          </dl>
        </FichaAcordeon>
        <FichaAcordeon
          titulo="Diagnóstico"
          abierto={fichaAbierta.diagnostico}
          onCambio={(abierto) =>
            setFichaAbierta((prev) =>
              prev.diagnostico === abierto ? prev : { ...prev, diagnostico: abierto },
            )
          }
        >
          <dl className="wa-side-panel__diagnostico">
            <div>
              <dt>Motivo</dt>
              <dd
                className={
                  !(
                    conv.motivoConsulta?.trim() ||
                    conv.menuEstado?.motivoConsulta?.trim()
                  )
                    ? "is-empty"
                    : undefined
                }
              >
                {textoDato(
                  conv.motivoConsulta?.trim() ||
                    conv.menuEstado?.motivoConsulta?.trim() ||
                    "",
                )}
              </dd>
            </div>
            <div>
              <dt>Según la IA</dt>
              <dd className={!conv.diagnosticoIa?.trim() ? "is-empty" : undefined}>
                {textoDato(conv.diagnosticoIa)}
                {conv.diagnosticoIaAt ? (
                  <small className="wa-side-panel__dx-meta">
                    {" "}
                    · {formatFechaHora(conv.diagnosticoIaAt)}
                  </small>
                ) : null}
              </dd>
            </div>
            <div className="wa-side-panel__dx-equipo-row">
              <div className="wa-side-panel__dx-equipo-line">
                <dt>Equipo</dt>
                <div className="wa-side-panel__dx-equipo-field">
                <input
                  id={`wa-dx-${conv.id}`}
                  key={`wa-dx-${conv.id}-${conv.diagnosticoHumano ?? ""}-${conv.diagnosticoHumanoAt ?? ""}`}
                  className="wa-side-panel__dx-input"
                  list={`wa-dx-list-${conv.id}`}
                  defaultValue={conv.diagnosticoHumano?.trim() || ""}
                  placeholder="Buscar…"
                  disabled={diagnosticoSaving || !selectedId || selectedId !== conv.id}
                  autoComplete="off"
                  aria-label="Diagnóstico del equipo"
                  onBlur={(event) => {
                    const raw = event.target.value.trim();
                    const actual = conv.diagnosticoHumano?.trim() || "";
                    if (raw === actual) return;
                    if (!raw) {
                      void guardarDiagnosticoHumano("");
                      return;
                    }
                    const exacto = diagnosticoOpciones.find(
                      (nombre) => nombre.toLowerCase() === raw.toLowerCase(),
                    );
                    const parcial = diagnosticoOpciones.find((nombre) =>
                      nombre.toLowerCase().includes(raw.toLowerCase()),
                    );
                    const elegido = exacto || parcial || "";
                    if (!elegido) {
                      event.target.value = actual;
                      toast.error("Elegí un diagnóstico de la lista");
                      return;
                    }
                    event.target.value = elegido;
                    if (elegido !== actual) void guardarDiagnosticoHumano(elegido);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.target as HTMLInputElement).blur();
                    }
                  }}
                />
                {conv.diagnosticoHumano?.trim() ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm wa-side-panel__dx-quitar"
                    disabled={diagnosticoSaving || !selectedId || selectedId !== conv.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void guardarDiagnosticoHumano("")}
                  >
                    Quitar
                  </button>
                ) : null}
                </div>
              </div>
                <datalist id={`wa-dx-list-${conv.id}`}>
                  {diagnosticoOpciones.map((nombre) => (
                    <option key={nombre} value={nombre} />
                  ))}
                </datalist>
                {conv.diagnosticoHumanoByName?.trim() ? (
                  <small className="wa-side-panel__dx-equipo-meta">
                    {persona(conv.diagnosticoHumanoByName)}
                    {conv.diagnosticoHumanoAt
                      ? ` · ${formatFechaHora(conv.diagnosticoHumanoAt)}`
                      : ""}
                  </small>
                ) : null}
            </div>
          </dl>
        </FichaAcordeon>
        <FichaAcordeon
          titulo="Profesionales"
          abierto={fichaAbierta.profesionales}
          onCambio={(abierto) =>
            setFichaAbierta((prev) =>
              prev.profesionales === abierto ? prev : { ...prev, profesionales: abierto },
            )
          }
        >
          <div className="wa-prof-prev">
          {historialTurnos?.conversationId === conv.id && historialTurnos.loading ? (
            <p>Buscando turnos…</p>
          ) : fichaProfesionales(conv).length ? (
            <div className="wa-prof-prev__list">
              {fichaProfesionales(conv).map((prof) => {
                const clave = `${conv.id}:${prof.clave}`;
                const elegida =
                  prestacionElegida[clave] ||
                  prof.opciones.find((item) => item.habitual)?.nombre ||
                  prof.opciones[0]?.nombre ||
                  "";
                const horario = prof.opciones.find((item) => item.nombre === elegida)?.preferencia?.texto;
                return (
                  <article key={prof.clave} className="wa-prof-card">
                    <div className="wa-prof-card__head">
                      <strong>{prof.nombre}</strong>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => abrirBuscaDesdeProfesional(conv, prof, elegida)}
                      >
                        Buscar turno
                      </button>
                    </div>
                    {prof.opciones.length ? (
                      <div className="wa-prof-card__chips" role="listbox" aria-label="Prestaciones">
                        {prof.opciones.map((item) => (
                          <button
                            key={item.nombre}
                            type="button"
                            className={`wa-prof-card__chip${elegida === item.nombre ? " is-on" : ""}`}
                            onClick={() =>
                              setPrestacionElegida((prev) => ({ ...prev, [clave]: item.nombre }))
                            }
                          >
                            {item.nombre}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="wa-prof-card__hint">Sin prestación cargada.</p>
                    )}
                    {horario ? <p className="wa-prof-card__pref">{horario}</p> : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <p>Sin profesionales anteriores.</p>
          )}
          </div>
        </FichaAcordeon>
        {(conv.resumen ?? "").trim() ? (
          <section>
            <h3>Resumen</h3>
            <p className="wa-side-panel__resumen">{conv.resumen}</p>
          </section>
        ) : null}
      </>
    );
  }

  function fichaProfesionales(conv: WaConversation): {
    clave: string;
    nombre: string;
    doc: string;
    opciones: { codigo: string; nombre: string; habitual: boolean; preferencia: PreferenciaTurnos | null }[];
  }[] {
    const grupos = new Map<string, { nombre: string; prestaciones: string[] }>();
    const sumar = (profesional: string, prestacion: string) => {
      const nombre = profesional.trim();
      if (!nombre) return;
      const clave = nombre.toLocaleLowerCase("es");
      let grupo = grupos.get(clave);
      if (!grupo) {
        if (grupos.size >= 3) return;
        grupo = { nombre, prestaciones: [] };
        grupos.set(clave, grupo);
      }
      const trato = prestacion.trim();
      if (
        trato &&
        !grupo.prestaciones.some((item) => item.toLocaleLowerCase("es") === trato.toLocaleLowerCase("es"))
      ) {
        grupo.prestaciones.push(trato);
      }
    };
    if (historialTurnos?.conversationId === conv.id) {
      for (const turno of historialTurnos.turnos) sumar(turno.profesional, turno.prestacion);
      for (const nombre of historialTurnos.ultimosProfesionales) sumar(nombre, "");
    }
    sumar(conv.menuEstado?.profesionalCatalogo || conv.menuEstado?.profesional || "", "");
    const prestaciones = catalogoBusca?.prestaciones ?? {};
    const profesionales = (catalogoBusca?.profesionales ?? []).filter((item) => item.enabled !== false);
    return [...grupos.entries()].map(([clave, grupo]) => {
      const doc = String(
        profesionales
          .map((item) => ({ item, pts: scoreNombreProf(grupo.nombre, item.nombre || "") }))
          .filter((row) => row.pts >= 40)
          .sort((a, b) => b.pts - a.pts)[0]?.item.doc || "",
      );
      const turnosConv = historialTurnos?.conversationId === conv.id ? historialTurnos.turnos : [];
      const vistas = new Map<
        string,
        {
          codigo: string;
          nombre: string;
          habitual: boolean;
          turnos: { fecha: string; hora: string; estado: string }[];
        }
      >();
      const matchCatalogo = (nombre: string) =>
        Object.entries(prestaciones)
          .map(([codigo, item]) => ({
            codigo,
            nombre: (item.nombre || "").trim(),
            pts: scoreNombreProf(nombre, item.nombre || ""),
          }))
          .filter((row) => row.nombre && row.pts >= 60)
          .sort((a, b) => b.pts - a.pts)[0];
      grupo.prestaciones.forEach((nombre, index) => {
        const match = matchCatalogo(nombre);
        const label = match?.nombre || nombre;
        const key = label.toLocaleLowerCase("es");
        const propios = turnosConv.filter(
          (turno) =>
            normWa(turno.profesional) === normWa(grupo.nombre) && normWa(turno.prestacion) === normWa(nombre),
        );
        const prev = vistas.get(key);
        vistas.set(key, {
          codigo: prev?.codigo || match?.codigo || "",
          nombre: label,
          habitual: prev?.habitual || index === 0,
          turnos: [...(prev?.turnos ?? []), ...propios],
        });
      });
      return {
        clave,
        nombre: grupo.nombre,
        doc,
        opciones: [...vistas.values()].map((item) => ({
          codigo: item.codigo,
          nombre: item.nombre,
          habitual: item.habitual,
          preferencia: preferenciaDeTurnos(item.turnos),
        })),
      };
    });
  }

  function turnosDelProfesional(convId: string, profesional: string) {
    const turnos = historialTurnos?.conversationId === convId ? historialTurnos.turnos : [];
    const clave = normWa(profesional);
    if (!clave) return [];
    return turnos.filter((turno) => normWa(turno.profesional) === clave);
  }

  function preferenciaPaciente(
    convId: string,
    profesional: string,
    prestacion: string,
  ): PreferenciaTurnos | null {
    if (!prestacion.trim()) return null;
    return preferenciaDeTurnos(
      turnosDelProfesional(convId, profesional).filter((turno) =>
        mismaPrestacion(turno.prestacion, prestacion),
      ),
    );
  }

  function abrirBuscaDesdeProfesional(
    conv: WaConversation,
    prof: {
      clave: string;
      nombre: string;
      doc: string;
      opciones: { codigo: string; nombre: string; preferencia: PreferenciaTurnos | null }[];
    },
    prestacionNombre: string,
  ) {
    const opcion = prof.opciones.find((item) => item.nombre === prestacionNombre) || prof.opciones[0];
    const sexo =
      conv.contact?.sexo === "masculino" || conv.contact?.sexo === "femenino" ? conv.contact.sexo : "";
    setBuscaTurnoMounted(true);
    setVistaOperadora(true);
    setSidePanelPinned(true);
    setSidePanelOpen(true);
    setOperadoraTab("busca");
    setBuscaPedidoSeed({
      key: `prof-${conv.id}-${prof.clave}-${opcion?.codigo || prestacionNombre}-${Date.now()}`,
      profesionalDoc: prof.doc || undefined,
      profesionalNombre: prof.nombre,
      prestacionCodigo: opcion?.codigo || undefined,
      prestacionNombre: opcion?.nombre || prestacionNombre || undefined,
      tratamiento: opcion?.nombre || prestacionNombre || undefined,
      preferencia: opcion?.preferencia ?? preferenciaPaciente(conv.id, prof.nombre, opcion?.nombre || prestacionNombre),
      paciente: {
        dni: conv.contact?.dni || conv.menuEstado?.dni || undefined,
        fechaNacimiento: conv.contact?.fechaNacimiento || conv.menuEstado?.fechaNacimiento || undefined,
        nombre: conv.contact?.firstName || conv.menuEstado?.nombre || undefined,
        apellido: conv.contact?.lastName || conv.menuEstado?.apellido || undefined,
        email: conv.contact?.email || conv.menuEstado?.email || undefined,
        telefono: conv.contact?.phoneNumber || conv.menuEstado?.telefono || undefined,
        sexo,
      },
    });
  }

  function esTurnoFuturo(fecha: string, hora: string): boolean {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
      parts.find((parte) => parte.type === tipo)?.value ?? "";
    const horaAhora = valor("hour") === "24" ? "00" : valor("hour");
    const ahora = `${valor("year")}-${valor("month")}-${valor("day")} ${horaAhora}:${valor("minute")}`;
    return `${fecha} ${hora.slice(0, 5)}` >= ahora;
  }

  function estadoVisible(turno: WaTurnoFicha): string {
    const estado = turno.estado?.trim() || "Sin dato";
    if (esTurnoFuturo(turno.fecha, turno.hora) && /presente|ausente/i.test(estado)) return "Asignado";
    return estado;
  }

  function pedirCancelarDesdeHistorial(turno: WaTurnoFicha) {
    const dni = String(selected?.contact?.dni || selected?.menuEstado?.dni || "").replace(/\D/g, "");
    if (dni.length < 7) {
      toast.error("Falta el DNI del paciente para anular el turno");
      return;
    }
    setCancelTurnoPendiente({
      dni,
      profesional: turno.profesional,
      prestacion: turno.prestacion,
      fechaHora: `${turno.fecha} ${turno.hora.slice(0, 5)}`,
      resumen: `${formatFechaConDia(turno.fecha) || turno.fecha} ${turno.hora} · ${turno.profesional} · ${turno.prestacion}`,
    });
  }

  function renderHistorialTurnos(convId: string) {
    const data = historialTurnos?.conversationId === convId ? historialTurnos : null;
    if (!data || data.loading) {
      return <p className="wa-inbox__empty">Buscando turnos…</p>;
    }
    if (!data.turnos.length) {
      return <p className="wa-inbox__empty">{data.aviso || "Sin turnos para mostrar."}</p>;
    }
    const consulta = normWa(historialBusqueda);
    const turnos = consulta
      ? data.turnos.filter(
          (turno) =>
            normWa(turno.profesional).includes(consulta) || normWa(turno.prestacion).includes(consulta),
        )
      : data.turnos;
    return (
      <div className="wa-historial">
        <div className="table-search wa-historial__buscar">
          <span className="table-search__icon" aria-hidden>
            <IconSearch size={16} />
          </span>
          <input
            value={historialBusqueda}
            onChange={(event) => setHistorialBusqueda(event.target.value)}
            placeholder="Buscar"
            aria-label="Buscar por profesional o prestación"
            autoComplete="off"
          />
        </div>
        {turnos.length ? (
          <>
            {(["Próximos", "Anteriores"] as const).map((titulo) => {
              const futuros = titulo === "Próximos";
              const lista = turnos
                .filter((turno) => esTurnoFuturo(turno.fecha, turno.hora) === futuros)
                .sort((a, b) =>
                  futuros
                    ? `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`)
                    : `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`),
                );
              return (
                <details
                  key={titulo}
                  className="wa-historial__fold"
                  open={futuros ? historialGrupos.proximos : historialGrupos.anteriores}
                  onToggle={(event) => {
                    const abierto = event.currentTarget.open;
                    const clave = futuros ? "proximos" : "anteriores";
                    setHistorialGrupos((prev) =>
                      prev[clave] === abierto ? prev : { ...prev, [clave]: abierto },
                    );
                  }}
                >
                  <summary>{titulo}</summary>
                  {lista.length ? (
                    <ul className="wa-historial-cards">
                      {lista.map((turno, index) => {
                        const estado = estadoVisible(turno);
                        const cancelable =
                          futuros && !/cancel|anul/i.test(normWa(estado));
                        return (
                          <li
                            key={`${turno.fecha}-${turno.hora}-${turno.prestacion}-${index}`}
                            className="wa-historial-card"
                          >
                            <div className="wa-historial-card__top">
                              <strong>{formatFechaConDia(turno.fecha) || turno.fecha}</strong>
                              <span>{turno.hora}</span>
                              <span className={`wa-historial-card__estado ${claseEstadoTurno(estado)}`}>
                                {estado}
                              </span>
                            </div>
                            <p>
                              <span className="wa-historial-card__label">Profesional</span>
                              <span>{turno.profesional || "Sin dato"}</span>
                            </p>
                            <p>
                              <span className="wa-historial-card__label">Prestación</span>
                              <span>{turno.prestacion || "Sin dato"}</span>
                            </p>
                            {cancelable ? (
                              <button
                                type="button"
                                className="wa-historial-card__cancelar"
                                onClick={() => pedirCancelarDesdeHistorial(turno)}
                              >
                                Cancelar turno
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="wa-historial__vacio">
                      {futuros ? "Sin turnos próximos." : "Sin turnos anteriores."}
                    </p>
                  )}
                </details>
              );
            })}
          </>
        ) : (
          <p className="wa-inbox__empty">Ningún turno coincide.</p>
        )}
      </div>
    );
  }

  function renderOperadoraSidePanel(pinned: boolean) {
    const open = pinned || sidePanelOpen;
    return (
      <aside
        className={
          pinned
            ? "wa-side-panel wa-side-panel--docked"
            : "wa-side-panel wa-side-panel--float"
        }
        aria-label="Panel operadora"
        aria-hidden={!open}
      >
        <div className="wa-side-panel__tabs" role="tablist" aria-label="Panel lateral">
          {(
            [
              ["paciente", "Paciente"],
              ["etiquetas", "Etiquetas"],
              ["historial", "Historial"],
              ["busca", "Turnos"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={operadoraTab === id}
              className={`wa-side-panel__tab${operadoraTab === id ? " is-active" : ""}`}
              onClick={() => setOperadoraTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={`wa-tags-panel__pin${pinned ? " is-on" : ""}`}
            aria-label={pinned ? "Desfijar panel" : "Fijar panel"}
            title={pinned ? "Desfijar panel" : "Fijar panel"}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSidePanelPinned((on) => {
                if (on) {
                  if (operadoraTab === "busca") setBuscaPedidoSeed(null);
                  setSidePanelOpen(false);
                } else {
                  setSidePanelOpen(false);
                }
                return !on;
              });
            }}
          >
            <IconPin size={15} filled={pinned} />
          </button>
        </div>
        <div className="wa-side-panel__body">
          <div
            className={`wa-side-panel__pane wa-side-panel__pane--paciente${
              operadoraTab === "paciente" ? " is-active" : ""
            }`}
            role="tabpanel"
            hidden={operadoraTab !== "paciente"}
          >
            {!selected ? (
              <p className="wa-inbox__empty">Elegí una conversación para ver la ficha.</p>
            ) : (
              renderPacienteFicha(selected)
            )}
          </div>
          <div
            className={`wa-side-panel__pane wa-side-panel__pane--historial${
              operadoraTab === "historial" ? " is-active" : ""
            }`}
            role="tabpanel"
            hidden={operadoraTab !== "historial"}
          >
            {!selected ? (
              <p className="wa-inbox__empty">Elegí una conversación para ver el historial.</p>
            ) : (
              renderHistorialTurnos(selected.id)
            )}
          </div>
          <div
            className={`wa-side-panel__pane wa-side-panel__pane--etiquetas${
              operadoraTab === "etiquetas" ? " is-active" : ""
            }`}
            role="tabpanel"
            hidden={operadoraTab !== "etiquetas"}
          >
            {renderQuickTagsPanelBody({
              withSearchRef: open && operadoraTab === "etiquetas",
            })}
          </div>
          <div
            className={`wa-side-panel__pane wa-side-panel__pane--busca${
              operadoraTab === "busca" ? " is-active" : ""
            }`}
            role="tabpanel"
            hidden={operadoraTab !== "busca"}
          >
            {buscaTurnoMounted ? (
              <>
                <div className="wa-busca-panel__head">
                  <h3>Buscar turno</h3>
                  <label
                    className={`wa-busca-solo-libres${buscaSoloLibres ? " is-on" : ""}`}
                  >
                    <span className="wa-busca-solo-libres__label">Solo libres</span>
                    <input
                      type="checkbox"
                      checked={buscaSoloLibres}
                      onChange={(e) => setBuscaSoloLibres(e.target.checked)}
                      aria-label="Solo libres"
                    />
                    <span className="wa-busca-solo-libres__track" aria-hidden>
                      <span className="wa-busca-solo-libres__thumb" />
                    </span>
                  </label>
                </div>
                <div className="wa-busca-panel__body">
                  <BuscaTurnoApp
                    mode="compact"
                    pedidoSeed={buscaPedidoSeed}
                    onPedidoSeedClear={() => setBuscaPedidoSeed(null)}
                    soloLibres={buscaSoloLibres}
                    onSoloLibresChange={setBuscaSoloLibres}
                    onUiLockChange={(locked) => {
                      setSidePanelUiLocked(locked);
                      if (locked) setSidePanelOpen(true);
                    }}
                    onTurnoAsignado={() => {
                      if (!buscaAccionMessageId) return;
                      marcarAccionHecha(buscaAccionMessageId);
                      setBuscaAccionMessageId(null);
                    }}
                    onProponerTurnosLibres={(texto) => {
                      const limpio = String(texto ?? "").trim();
                      if (!limpio) return;
                      if (selectedId) {
                        setDraft(limpio);
                        toast.success("Mensaje armado en el chat");
                        return;
                      }
                      void navigator.clipboard
                        ?.writeText(limpio)
                        .then(() => toast.success("Copiado al portapapeles"))
                        .catch(() => toast.info(limpio));
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="wa-inbox__empty">Cargando Busca Turno…</p>
            )}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <>
      {pruebaMode ? null : (
        <div className="wa-inbox-bar" aria-label="Filtros de conversaciones">
          <div className="wa-inbox-bar__filters">
            <div className="form-group wa-inbox-bar__field">
              <label htmlFor="wa-bar-assignee">Asignado a</label>
              <select
                id="wa-bar-assignee"
                className="ui-select"
                value={filters.assignee}
                onChange={(e) => patchFilters({ assignee: e.target.value })}
              >
                <option value="">Todos</option>
                {soyOperador && user?.id ? (
                  <option value={user.id}>Asignado a mí</option>
                ) : null}
                <option value="none">Sin asignar</option>
                <option value="bot">Bot</option>
                {otrosOperadores.map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group wa-inbox-bar__field wa-inbox-bar__field--date">
              <label htmlFor="wa-bar-from">Desde</label>
              <DatePicker
                id="wa-bar-from"
                value={filters.dateFrom}
                clearable
                formatHint={false}
                max={
                  filters.dateTo && filters.dateTo < fechaHoyIso()
                    ? filters.dateTo
                    : fechaHoyIso()
                }
                onChange={(value) => {
                  const hoy = fechaHoyIso();
                  let dateFrom = value;
                  if (dateFrom && dateFrom > hoy) dateFrom = hoy;
                  let { dateTo } = filters;
                  if (dateFrom && dateTo && dateFrom > dateTo) dateTo = dateFrom;
                  patchFilters({ dateFrom, dateTo });
                }}
              />
            </div>
            <div className="form-group wa-inbox-bar__field wa-inbox-bar__field--date">
              <label htmlFor="wa-bar-to">Hasta</label>
              <DatePicker
                id="wa-bar-to"
                value={filters.dateTo}
                clearable
                formatHint={false}
                min={filters.dateFrom || undefined}
                max={fechaHoyIso()}
                onChange={(value) => {
                  const hoy = fechaHoyIso();
                  let dateTo = value;
                  if (dateTo && dateTo > hoy) dateTo = hoy;
                  let { dateFrom } = filters;
                  if (dateFrom && dateTo && dateFrom > dateTo) dateFrom = dateTo;
                  patchFilters({ dateFrom, dateTo });
                }}
              />
            </div>
            <div className="form-group wa-inbox-bar__field wa-inbox-bar__field--tags">
              <label htmlFor="wa-bar-tags">Filtros</label>
              <div className="wa-inbox-bar__tags" ref={tagFilterWrapRef}>
                <div className="table-search wa-inbox-bar__tag-input">
                  <span className="table-search__icon" aria-hidden>
                    <IconSearch size={16} />
                  </span>
                  {selectedFilterTags.length > 0 ? (
                    <div
                      className="wa-inbox-bar__selected"
                      aria-live="polite"
                      aria-label="Etiquetas seleccionadas"
                    >
                      {selectedFilterTags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className="wa-filters__tag is-active wa-filters__tag--selected"
                          style={{ "--tag-color": tagColor(tag) } as CSSProperties}
                          onClick={() => removeFilterTag(tag.id)}
                          title={`Quitar ${tag.name}`}
                          aria-label={`Quitar ${tag.name}`}
                        >
                          <span className="wa-filters__tag-dot" aria-hidden />
                          <span className="wa-filters__tag-name">{tag.name}</span>
                          <span className="wa-filters__tag-remove" aria-hidden>
                            ×
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <input
                    id="wa-bar-tags"
                    type="search"
                    value={tagFilterQuery}
                    placeholder={
                      tags.length === 0
                        ? "Sin etiquetas"
                        : selectedFilterTags.length > 0
                          ? "Agregar…"
                          : "Buscar etiqueta…"
                    }
                    disabled={tags.length === 0}
                    aria-label="Buscar etiqueta"
                    aria-expanded={tagFilterSuggestOpen}
                    aria-controls="wa-bar-tag-suggestions"
                    onChange={(e) => {
                      setTagFilterQuery(e.target.value);
                      setTagFilterSuggestOpen(true);
                    }}
                    onFocus={() => setTagFilterSuggestOpen(true)}
                  />
                </div>
                {tagFilterSuggestOpen && tags.length > 0 ? (
                  <div
                    id="wa-bar-tag-suggestions"
                    className="wa-inbox-bar__suggest"
                    role="listbox"
                    aria-label="Etiquetas sugeridas"
                  >
                    {tagFilterSuggestions.length === 0 ? (
                      <p className="wa-inbox-bar__suggest-empty">
                        {tagFilterQuery.trim()
                          ? "Sin coincidencias"
                          : "No quedan etiquetas para agregar"}
                      </p>
                    ) : (
                      tagFilterSuggestions.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className="wa-inbox-bar__suggest-item"
                          role="option"
                          onClick={() => addFilterTag(tag.id)}
                        >
                          <span
                            className="wa-filters__tag-dot"
                            style={{ background: tagColor(tag) }}
                            aria-hidden
                          />
                          <span className="wa-filters__suggest-main">
                            <span className="wa-filters__suggest-name">{tag.name}</span>
                            <span className="wa-filters__suggest-group">
                              {tagGroupLabel(tag)}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="wa-inbox-bar__actions">
            <button
              type="button"
              className={`btn btn-secondary btn-sm wa-inbox-bar__vista${
                listaConversacionesVisible ? "" : " is-on"
              }`}
              aria-label={
                listaConversacionesVisible
                  ? "Ocultar lista de conversaciones"
                  : "Mostrar lista de conversaciones"
              }
              title={
                listaConversacionesVisible
                  ? "Ocultar lista de conversaciones"
                  : "Mostrar lista de conversaciones"
              }
              onClick={() => setListaConversacionesVisible((on) => !on)}
            >
              <IconConversations size={16} />
            </button>
            <button
              type="button"
              className={`btn btn-secondary btn-sm wa-inbox-bar__vista${vistaOperadora ? " is-on" : ""}`}
              aria-label={vistaOperadora ? "Vista normal" : "Vista operadora"}
              title={vistaOperadora ? "Vista normal" : "Vista operadora"}
              onClick={() =>
                setVistaOperadora((on) => {
                  if (!on) setOperadoraTab("paciente");
                  return !on;
                })
              }
            >
              {vistaOperadora ? <IconCollapse size={16} /> : <IconExpand size={16} />}
            </button>
          </div>
        </div>
      )}
      <div
        className={`wa-inbox${pruebaMode ? " wa-inbox--prueba" : ""}${
          vistaOperadora ? " wa-inbox--operadora" : ""
        }${listaConversacionesVisible ? "" : " wa-inbox--lista-oculta"}`}
      >
      <aside className="wa-inbox__list" aria-label="Conversaciones">
        <div
          className="wa-inbox__list-body"
          ref={listBodyRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
              void loadMoreConversations();
            }
          }}
        >
          {loadingList && conversations.length === 0 ? (
            <p className="wa-inbox__empty">Cargando…</p>
          ) : conversations.length === 0 ? (
            <p className="wa-inbox__empty">
              {pruebaMode
                ? "Creá una prueba para empezar a hablarle al bot."
                : connected
                  ? activeFilterCount > 0
                    ? "No hay conversaciones con esos filtros."
                    : "No hay conversaciones abiertas."
                  : "Conectá WhatsApp para empezar a recibir chats."}
            </p>
          ) : (
            <>
              {conversations.map((c) => {
                const color = pruebaMode
                  ? c.pruebaResultado === "incorrecta"
                    ? "#a61948"
                    : c.pruebaResultado === "correcta"
                      ? "#16a34a"
                      : "#94a3b8"
                  : assigneeColor(c);
                return (
                  <WaInboxListItem
                    key={c.id}
                    conversation={c}
                    active={c.id === selectedId}
                    color={color}
                    pruebaMode={pruebaMode}
                    onSelect={selectConversationById}
                  />
                );
              })}
              {loadingMore ? <p className="wa-inbox__empty wa-inbox__empty--more">Cargando más…</p> : null}
              {!loadingMore && hasMoreConversations ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm wa-inbox__load-more"
                  onClick={() => void loadMoreConversations()}
                >
                  Cargar más
                </button>
              ) : null}
            </>
          )}
        </div>
      </aside>

      <section className="wa-inbox__thread" aria-label="Mensajes">
        {!selectedId ? (
          <div className="wa-inbox__placeholder">
            <p>{creatingPrueba ? "Creando prueba…" : "Seleccioná una conversación"}</p>
          </div>
        ) : (
          <>
            <header className="wa-inbox__thread-head">
              <div className="wa-inbox__identity">
                {pruebaMode ? null : (
                  <button
                    type="button"
                    className="wa-inbox__avatar"
                    disabled={!selected?.contactId}
                    aria-label="Ver ficha del contacto"
                    onClick={() => {
                      setProfileOpen(true);
                      // Refrescar ficha (cobertura, dni, etc.) por si el bot la actualizó.
                      if (selectedId) {
                        void fetchWaConversation(selectedId)
                          .then((fresh) => {
                            setSelected((prev) =>
                              prev && prev.id === fresh.id
                                ? {
                                    ...prev,
                                    ...fresh,
                                    contact: fresh.contact ?? prev.contact,
                                  }
                                : prev,
                            );
                          })
                          .catch(() => undefined);
                      }
                    }}
                  >
                    <IconUsers size={18} />
                  </button>
                )}
                <button
                  type="button"
                  className="wa-inbox__contact-open"
                  onClick={() => {
                    if (!pruebaMode) setProfileOpen(true);
                  }}
                >
                  <div className="wa-inbox__title-row">
                    <h2>{threadHeader.title}</h2>
                    {pruebaMode ? null : (
                      <span className="wa-inbox__name-tip" role="tooltip">
                        Ver ficha del contacto
                      </span>
                    )}
                    {pruebaMode && selected?.pruebaCreadorNombre ? (
                      <span className="wa-prueba-creador">{selected.pruebaCreadorNombre}</span>
                    ) : null}
                  </div>
                  {!pruebaMode &&
                  threadHeader.phone &&
                  threadHeader.phone !== threadHeader.title ? (
                    <p className="wa-inbox__thread-phone">{threadHeader.phone}</p>
                  ) : null}
                  {threadHeader.subtitle ? (
                    <p className="wa-inbox__thread-rel">{threadHeader.subtitle}</p>
                  ) : null}
                  {selected?.resumen && !pruebaMode ? (
                    <p className="wa-inbox__thread-resumen">{selected.resumen}</p>
                  ) : null}
                </button>
              </div>
              <div className="wa-inbox__assign">
                {pruebaMode ? (
                  <>
                    <button
                      type="button"
                      className={`btn btn-secondary btn-sm wa-inbox__icon-btn wa-prueba-btn wa-prueba-btn--ok${selected?.pruebaResultado === "correcta" ? " is-on" : ""}`}
                      disabled={notaSaving}
                      aria-label="Marcar como correcta"
                      title="Marcar como correcta"
                      onClick={() => void marcarCorrecta()}
                    >
                      <IconCheck size={15} />
                      Correcta
                    </button>
                    <button
                      type="button"
                      className={`btn btn-secondary btn-sm wa-inbox__icon-btn wa-prueba-btn wa-prueba-btn--bad${selected?.pruebaResultado === "incorrecta" ? " is-on" : ""}`}
                      disabled={notaSaving}
                      aria-label="Marcar como incorrecta"
                      title="Marcar como incorrecta"
                      onClick={openNotaIncorrecta}
                    >
                      <IconX size={15} />
                      Incorrecta
                    </button>
                  </>
                ) : (
                  <>
                    <select
                      className="ui-select wa-inbox__assignee-select"
                      aria-label="Asignar operadora"
                      title={
                        selected?.assigneeKind === "bot"
                          ? "Bot"
                          : selected?.assigneeKind === "user" &&
                              user?.id &&
                              selected.assigneeUserId === user.id
                            ? "Asignado a mí"
                            : selected?.assigneeKind === "user"
                              ? selected.assigneeName || "Asignado"
                              : "Sin asignar"
                      }
                      value={
                        pendingAssignee !== null ? pendingAssignee : currentAssigneeSelectValue()
                      }
                      disabled={assigning || pendingAssignee !== null}
                      onChange={(event) => {
                        requestAssigneeChange(event.target.value);
                      }}
                    >
                      {soyOperador && user?.id ? (
                        <option value={user.id}>Asignado a mí</option>
                      ) : null}
                      <option value="">Sin asignar</option>
                      <option value="bot">Bot</option>
                      {otrosOperadores.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.nombre}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={`btn btn-secondary btn-sm wa-inbox__icon-btn wa-inbox__icon-btn--acciones${accionesPendientes.length > 0 ? " has-pending" : ""}`}
                      aria-label={
                        accionesPendientes.length > 0
                          ? `Acciones pendientes (${accionesPendientes.length})`
                          : "Acciones pendientes"
                      }
                      data-tooltip={
                        accionesPendientes.length > 0
                          ? `${accionesPendientes.length} acción${accionesPendientes.length === 1 ? "" : "es"} pendiente${accionesPendientes.length === 1 ? "" : "s"}`
                          : "Acciones pendientes"
                      }
                      onClick={() => setAccionesOpen(true)}
                    >
                      <IconAlert size={16} />
                      {accionesPendientes.length > 0 ? (
                        <span className="wa-inbox__acciones-badge" aria-hidden>
                          {accionesPendientes.length > 9 ? "9+" : accionesPendientes.length}
                        </span>
                      ) : null}
                    </button>
                    {puedeMarcarResuelta ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm wa-inbox__icon-btn wa-inbox__icon-btn--resuelta"
                        aria-label="Marcar como resuelta"
                        data-tooltip="Marcar como resuelta"
                        disabled={assigning}
                        onClick={() => setResueltaOpen(true)}
                      >
                        <IconCheck size={16} />
                      </button>
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm wa-inbox__icon-btn"
                  aria-label="Cerrar"
                  title="Cerrar"
                  onClick={closeSelectedConversation}
                >
                  <IconX size={16} />
                </button>
              </div>
            </header>
            <div
              className="wa-inbox__messages"
              ref={messagesBoxRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                pegadoAlFinal.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                setComentarioId(null);
              }}
            >
              {loadingMessages ? (
                <p className="wa-inbox__empty">Cargando mensajes…</p>
              ) : messages.length === 0 ? (
                <p className="wa-inbox__empty">Todavía no hay mensajes en este chat.</p>
              ) : (
                messages.filter((m) => !ocultos.includes(m.id)).map((m) => {
                  const outbound = m.direction === "OUTBOUND";
                  const deIa = pruebaMode && outbound && !m.isDeleted;
                  const elegido = rechazoIds.includes(m.id);
                  const mostrarCheck = deIa && eligiendoRechazo;
                  const comentario = selected?.pruebaAclaraciones?.find((item) => item.messageId === m.id);
                  const marcadaMal = Boolean(comentario?.texto) && selected?.pruebaResultado === "incorrecta";
                  return (
                    <div
                      key={m.id}
                      data-message-id={m.id}
                      className={`wa-bubble-pack${marcadaMal ? " is-mal" : ""}${highlightMessageId === m.id ? " is-highlight" : ""}`}
                    >
                    <div
                      className={`wa-bubble-row${outbound ? " is-out" : ""}${deIa ? " is-pick" : ""}`}
                    >
                      {deIa && mostrarCheck ? (
                        <label className="wa-bubble-check">
                          <input
                            type="checkbox"
                            checked={elegido}
                            tabIndex={0}
                            aria-label="Marcar esta respuesta de la IA"
                            onChange={() => toggleRechazoMensaje(m.id)}
                          />
                        </label>
                      ) : marcadaMal ? (
                        <span className="wa-bubble-nota-slot">
                          <button
                            type="button"
                            className={`wa-bubble-alerta${comentarioId?.id === m.id ? " is-open" : ""}`}
                            aria-label="Ver el comentario de esta respuesta"
                            aria-expanded={comentarioId?.id === m.id}
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setComentarioId((actual) =>
                                actual?.id === m.id
                                  ? null
                                  : {
                                      id: m.id,
                                      texto: comentario?.texto ?? "",
                                      top: rect.top - 10,
                                      left: rect.right + 10,
                                    },
                              );
                            }}
                          >
                            !
                          </button>
                        </span>
                      ) : deIa ? (
                        <span className="wa-bubble-check is-reserved" />
                      ) : null}
                      <div
                        className={`wa-bubble${outbound ? " is-out" : " is-in"}${elegido && mostrarCheck ? " is-picked" : ""}`}
                        onPointerDown={
                          outbound || m.isDeleted
                            ? undefined
                            : (event) => {
                                if (event.button !== 0) return;
                                wordPointer.current = { x: event.clientX, y: event.clientY };
                              }
                        }
                        onClick={outbound || m.isDeleted ? undefined : onInboundWordClick}
                        onContextMenu={outbound || m.isDeleted ? undefined : onInboundContextMenu}
                      >
                      {m.type === "IMAGE" && !m.isDeleted ? (
                        <img
                          className="wa-bubble__media"
                          src={waMediaUrl(m.id)}
                          alt={m.fileName || "Imagen"}
                        />
                      ) : null}
                      {m.type === "VIDEO" && !m.isDeleted ? (
                        <video className="wa-bubble__media" src={waMediaUrl(m.id)} controls />
                      ) : null}
                      {m.type === "AUDIO" && !m.isDeleted ? (
                        <audio className="wa-bubble__audio" src={waMediaUrl(m.id)} controls />
                      ) : null}
                      {m.type === "DOCUMENT" && !m.isDeleted ? (
                        <a
                          className="wa-bubble__file"
                          href={waMediaUrl(m.id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {m.fileName || "Documento"}
                        </a>
                      ) : null}
                      {m.type === "TEXT" ||
                      (m.text && !(m.type === "DOCUMENT" && m.text === m.fileName)) ? (
                        <p className="wa-bubble__text">
                          {m.type === "TEXT" ? messageBody(m) : m.text}
                        </p>
                      ) : null}
                      <span className="wa-bubble__meta">
                        {formatPreviewTime(m.createdAt)}
                        {outbound && !pruebaMode ? <MessageTicks status={m.status} /> : null}
                      </span>
                    </div>
                    </div>
                    </div>
                  );
                })
              )}
              {botTyping ? (
                <div className="wa-bubble-row is-out" aria-label="La IA está escribiendo">
                  <div className="wa-typing" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : null}
            </div>
            {comentarioId ? (
              <p
                className="wa-bubble-nota"
                style={{ top: comentarioId.top, left: comentarioId.left }}
                role="note"
              >
                {comentarioId.texto}
              </p>
            ) : null}
            {datoMenu ? (
              <div
                ref={datoMenuRef}
                className="wa-dato-menu"
                style={{ left: datoMenu.x, top: datoMenu.y }}
                role="menu"
                aria-label="Guardar texto seleccionado"
              >
                <p className="wa-dato-menu__hint" title={datoMenu.text}>
                  {datoMenu.text}
                </p>
                <button type="button" role="menuitem" onClick={() => void copyDatoSeleccionado()}>
                  Copiar
                </button>
                <div className="wa-dato-menu__sep" />
                <button type="button" role="menuitem" onClick={buscarComoEtiqueta}>
                  Buscar como etiqueta
                </button>
                <div className="wa-dato-menu__sep" />
                {datoOpciones(datoMenu.text, selected?.contact?.consultaPara === "tercero").map((item) => (
                  <button
                    key={item.campo}
                    type="button"
                    role="menuitem"
                    disabled={datoSaving}
                    onClick={() => void guardarDatoSeleccionado(item.campo)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              className={`wa-inbox__composer${composerLocked ? " is-locked" : ""}${pruebaDerivada ? " is-derivada" : ""}`}
              onSubmit={(e) => {
                if (composerLocked) {
                  e.preventDefault();
                  return;
                }
                void handleSend(e);
              }}
            >
              {slashSuggestions.length > 0 && !composerLocked ? (
                <div className="wa-slash" role="listbox" aria-label="Respuestas rápidas">
                  {slashSuggestions.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={index === slashIndex}
                      className={`wa-slash__item${index === slashIndex ? " is-active" : ""}`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyQuickReply(item);
                      }}
                    >
                      <code>{formatTrigger(item.trigger)}</code>
                      <span>
                        <em>
                          {resolveQuickReply(item.body, replyVars())}
                        </em>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {attachment && !composerLocked ? (
                <div className="wa-inbox__pending">
                  <span>{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachment(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ) : null}
              {eligiendoRechazo ? (
                <div className="wa-rechazo-bar">
                  <p>Marcá las respuestas de la IA.</p>
                  <div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEligiendoRechazo(false)}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={rechazoIds.length === 0}
                      onClick={abrirAclaraciones}
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="wa-inbox__composer-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > 16 * 1024 * 1024) {
                      toast.error("El archivo supera los 16 MB");
                      event.target.value = "";
                      return;
                    }
                    setAttachment(file);
                  }}
                />
                {pruebaMode ? null : (
                <button
                  type="button"
                  className="wa-inbox__attach"
                  aria-label="Adjuntar archivo"
                  title="Adjuntar imagen o archivo"
                  disabled={
                    sending ||
                    composerLocked ||
                    selected?.contact?.isBlocked === true
                  }
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
                    <path
                      d="M21.44 11.05l-8.49 8.49a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.82-2.83l8.48-8.48"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                )}
                <input
                  type="text"
                  value={composerLocked || pruebaDerivada ? "" : draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(event) => {
                    if (composerLocked || pruebaDerivada || pruebaCerrada) {
                      event.preventDefault();
                      return;
                    }
                    if (slashSuggestions.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSlashIndex((current) => (current + 1) % slashSuggestions.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSlashIndex(
                        (current) =>
                          (current - 1 + slashSuggestions.length) % slashSuggestions.length,
                      );
                      return;
                    }
                    if (event.key === "Tab" || event.key === "Enter") {
                      const selectedReply = slashSuggestions[slashIndex];
                      if (selectedReply) {
                        event.preventDefault();
                        applyQuickReply(selectedReply);
                      }
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setDraft("");
                    }
                  }}
                  placeholder={
                    pruebaDerivada
                      ? "Fuiste derivado a un humano."
                      : pruebaCerrada
                      ? "Esta prueba ya está marcada."
                      : composerLocked
                        ? "Asignate la conversación para escribir…"
                        : pruebaMode
                          ? "Escribí como la persona…"
                          : attachment
                            ? "Pie de foto o archivo (opcional)…"
                            : selected?.contact?.isBlocked
                              ? "Contacto bloqueado"
                              : "Escribí un mensaje… (/saludo)"
                  }
                  disabled={
                    (!pruebaMode && sending) ||
                    composerLocked ||
                    pruebaCerrada ||
                    pruebaDerivada ||
                    selected?.contact?.isBlocked === true
                  }
                  autoComplete="off"
                />
                {composerLocked ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={assigning || !user?.id}
                    onClick={() => setTakeOverOpen(true)}
                  >
                    {assigning ? "Asignando…" : "Asignar a mí"}
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      (!pruebaMode && sending) ||
                      pruebaCerrada ||
                      pruebaDerivada ||
                      (!draft.trim() && !attachment) ||
                      selected?.contact?.isBlocked === true
                    }
                  >
                    {sending && !pruebaMode ? "Enviando…" : "Enviar"}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
      {pruebaMode ? (
        <aside className="wa-prueba-panel" aria-label="Funcionamiento del bot">
          {!selected ? (
            <p className="wa-inbox__empty">Elegí una prueba para ver la ficha y las etiquetas.</p>
          ) : (
            <>
              <div className="wa-prueba-tabs-bar">
                <button
                  type="button"
                  className="wa-prueba-tabs__arrow"
                  aria-label="Ver pestañas anteriores"
                  disabled={!tabsPueden.izq}
                  onClick={() => {
                    pruebaTabsRef.current?.scrollTo({ left: 0, behavior: "smooth" });
                  }}
                >
                  <IconChevronLeft size={16} />
                </button>
                <div
                  className="wa-prueba-tabs"
                  role="tablist"
                  ref={pruebaTabsRef}
                  onScroll={medirTabs}
                >
                  {(
                    [
                      ["paciente", "Paciente"],
                      ["historial", "Historial"],
                      ["modulo", "Módulo"],
                      ["intenciones", "Intenciones"],
                      ["resultado", "Resultado"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={pruebaTab === id}
                      className={`wa-prueba-tabs__btn${pruebaTab === id ? " is-active" : ""}`}
                      onClick={() => setPruebaTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="wa-prueba-tabs__arrow"
                  aria-label="Ver pestañas siguientes"
                  disabled={!tabsPueden.der}
                  onClick={() => {
                    const el = pruebaTabsRef.current;
                    if (!el) return;
                    el.scrollTo({
                      left: el.scrollWidth - el.clientWidth,
                      behavior: "smooth",
                    });
                  }}
                >
                  <IconChevronRight size={16} />
                </button>
              </div>
              <div
                className={`wa-prueba-panel__body${pruebaTab === "historial" ? " is-historial" : ""}`}
              >
              {pruebaTab === "paciente" ? renderPacienteFicha(selected) : null}
              {pruebaTab === "historial" ? renderHistorialTurnos(selected.id) : null}
              {pruebaTab === "modulo" ? (
                <section>
                    <h3>Modelos</h3>
                    <ul className="wa-prueba-uso">
                      {usoPorModelo.map((grupo) => (
                        <li key={grupo.paso}>
                          <div className="wa-prueba-uso__head">
                            <strong>{grupo.titulo}</strong>
                            <span>{grupo.modelo}</span>
                          </div>
                          <dl className="wa-prueba-uso__nums">
                            <div>
                              <dt>Entrada</dt>
                              <dd>{miles(grupo.entrada)}</dd>
                            </div>
                            <div>
                              <dt>Salida</dt>
                              <dd>{miles(grupo.salida)}</dd>
                            </div>
                            <div>
                              <dt>Total</dt>
                              <dd>{miles(grupo.total)}</dd>
                            </div>
                          </dl>
                          <p className="wa-prueba-uso__meta">
                            {grupo.llamadas === 0
                              ? "Sin llamadas en esta conversación"
                              : `${grupo.llamadas} ${grupo.llamadas === 1 ? "llamada" : "llamadas"}`}
                            {" · "}
                            {tarifa(grupo.entradaPorMillon)} entrada · {tarifa(grupo.salidaPorMillon)} salida / millón
                          </p>
                        </li>
                      ))}
                    </ul>
                    <div className="wa-prueba-total">
                      <span>Total aproximado</span>
                      <strong>{gastoUsd(usoPorModelo.reduce((sum, grupo) => sum + grupo.costo, 0))}</strong>
                      <strong>{gastoPesos(usoPorModelo.reduce((sum, grupo) => sum + grupo.costo, 0) * DOLAR_PESOS)}</strong>
                    </div>
                  </section>
              ) : null}
              {pruebaTab === "resultado" ? (
                <section>
                  <h3>Resultado</h3>
                  <p
                    className={
                      selected.pruebaResultado === "correcta"
                        ? "wa-prueba-resultado is-ok"
                        : selected.pruebaResultado === "incorrecta"
                          ? "wa-prueba-resultado is-bad"
                          : "wa-prueba-resultado"
                    }
                  >
                    {selected.pruebaResultado === "correcta"
                      ? "Correcta"
                      : selected.pruebaResultado === "incorrecta"
                        ? "Incorrecta"
                        : "Sin marcar"}
                  </p>
                  {selected.pruebaResultado === "incorrecta" &&
                  (selected.pruebaAclaraciones?.length ?? 0) > 0 ? (
                    <ul className="wa-prueba-aclaraciones">
                      {selected.pruebaAclaraciones?.map((item) => {
                        const mensaje = messages.find((entry) => entry.id === item.messageId);
                        return (
                          <li key={item.messageId}>
                            <p>{mensaje?.text || "Mensaje"}</p>
                            <p>{item.texto}</p>
                          </li>
                        );
                      })}
                    </ul>
                  ) : selected.pruebaResultado === "incorrecta" && selected.pruebaNota ? (
                    <p>{selected.pruebaNota}</p>
                  ) : null}
                </section>
              ) : null}
              {pruebaTab === "intenciones" ? (
                <>
                  <section>
                    <h3>Quedó</h3>
                    <dl>
                      <div>
                        <dt>Intención abierta</dt>
                        <dd>{textoDato(selected.intencionAbierta)}</dd>
                      </div>
                      <div>
                        <dt>Concluida</dt>
                        <dd>{selected.intencionConcluida ? "sí" : "no"}</dd>
                      </div>
                      <div>
                        <dt>En conflicto con</dt>
                        <dd>{textoDato(selected.intencionPropuesta)}</dd>
                      </div>
                      <div>
                        <dt>En cola</dt>
                        <dd>{textoDato((selected.intencionCola ?? []).join(", "))}</dd>
                      </div>
                      <div>
                        <dt>Asignada</dt>
                        <dd>{waAssigneeLabel(selected)}</dd>
                      </div>
                      <div>
                        <dt>Resumen</dt>
                        <dd>{textoDato(selected.resumen)}</dd>
                      </div>
                    </dl>
                  </section>
                  <section>
                    <h3>Detecciones</h3>
                    {(selected.auditoria ?? []).length ? (
                      <ol className="wa-prueba-audit">
                        {[...(selected.auditoria ?? [])].reverse().map((paso, index) => {
                          const saludo = paso.cortesia === "saludo";
                          const despedida = paso.cortesia === "cierre";
                          const titulo =
                            paso.intencion ||
                            (saludo ? "Saludo" : despedida ? "Despedida" : "Sin intención");
                          const dicho = (paso.hecho || paso.resumen || "").trim();
                          const repiteCortesia =
                            (saludo || despedida) &&
                            /^(saludo( inicial)?|hola|despedida|cierre)\.?$/i.test(dicho);
                          const detalle = repiteCortesia ? "" : dicho;
                          const notas = [
                            paso.peligro ? "peligro" : "",
                            paso.duda ? "duda" : "",
                            paso.abierta && paso.abierta !== paso.intencion ? `quedó ${paso.abierta}` : "",
                            paso.concluida ? "concluida" : "",
                          ].filter(Boolean);
                          return (
                            <li key={`${paso.en}-${index}`}>
                              <strong>
                                {[titulo, paso.secundaria].filter(Boolean).join(" + ")}
                              </strong>
                              {notas.length ? <span>{notas.join(" · ")}</span> : null}
                              {detalle ? <p>{detalle}</p> : null}
                              {paso.etiquetas.length ? <p>Etiquetas: {paso.etiquetas.join(", ")}</p> : null}
                            </li>
                          );
                        })}
                      </ol>
                    ) : (
                      <p>Todavía no hay detecciones.</p>
                    )}
                  </section>
                </>
              ) : null}
              </div>
            </>
          )}
        </aside>
      ) : !vistaOperadora ? null : sidePanelPinned ? (
        renderOperadoraSidePanel(true)
      ) : (
        <div
          className={`wa-tags-hover${sidePanelOpen ? " is-open" : ""}`}
          onMouseEnter={() => setSidePanelOpen(true)}
          onMouseLeave={sidePanelUiLocked ? undefined : () => setSidePanelOpen(false)}
        >
          <span className="wa-tags-hover__tab" aria-hidden>
            <IconChevronLeft size={16} />
          </span>
          <div className="wa-tags-pop wa-side-pop" aria-hidden={!sidePanelOpen}>
            {renderOperadoraSidePanel(false)}
          </div>
        </div>
      )}

      <Modal
        open={tagsModalOpen}
        title="Etiquetas de la conversación"
        wide
        className="fl-modal--wa-tags"
        onClose={() => {
          setTagsModalOpen(false);
          setTagsModalDragOver(null);
          setTagsModalQuery("");
          setTagsModalGroupMenuOpen(false);
        }}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setTagsModalOpen(false)}
          >
            Listo
          </button>
        }
      >
        <div className="wa-tags-modal">
          <div className="wa-tags-modal__toolbar">
            <input
              type="search"
              className="wa-tags-modal__search-input"
              value={tagsModalQuery}
              onChange={(event) => setTagsModalQuery(event.target.value)}
              placeholder="Buscar etiqueta…"
              autoComplete="off"
              aria-label="Buscar etiqueta"
            />
            <div className="wa-tags-modal__group-picker" ref={tagsGroupPickerRef}>
              <button
                type="button"
                className="wa-tags-modal__group-trigger"
                aria-label="Filtrar por grupo"
                aria-expanded={tagsModalGroupMenuOpen}
                onClick={() => setTagsModalGroupMenuOpen((open) => !open)}
              >
                {tagsModalSelectedGroup ? (
                  <span
                    className="wa-tags-modal__group-swatch"
                    style={{ background: tagsModalSelectedGroup.color }}
                    aria-hidden
                  />
                ) : (
                  <span className="wa-tags-modal__group-swatch wa-tags-modal__group-swatch--all" aria-hidden />
                )}
                <span className="wa-tags-modal__group-trigger-label">
                  {tagsModalSelectedGroup ? tagsModalSelectedGroup.name : "Grupo: todos"}
                </span>
              </button>
              {tagsModalGroupMenuOpen ? (
                <ul className="wa-tags-modal__group-menu" role="listbox">
                  <li>
                    <button
                      type="button"
                      className={`wa-tags-modal__group-option${!tagsModalGroupId ? " is-active" : ""}`}
                      onClick={() => {
                        setTagsModalGroupId("");
                        setTagsModalGroupMenuOpen(false);
                      }}
                    >
                      <span
                        className="wa-tags-modal__group-swatch wa-tags-modal__group-swatch--all"
                        aria-hidden
                      />
                      <span>Grupo: todos</span>
                    </button>
                  </li>
                  {tagGroups.map((group) => (
                    <li key={group.id}>
                      <button
                        type="button"
                        className={`wa-tags-modal__group-option${
                          tagsModalGroupId === group.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          setTagsModalGroupId(group.id);
                          setTagsModalGroupMenuOpen(false);
                        }}
                      >
                        <span
                          className="wa-tags-modal__group-swatch"
                          style={{ background: group.color }}
                          aria-hidden
                        />
                        <span>{group.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="wa-tags-modal__columns">
            <section
              className={`wa-tags-modal__col${tagsModalDragOver === "available" ? " is-drop-target" : ""}`}
              aria-label="Etiquetas disponibles"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setTagsModalDragOver("available");
              }}
              onDragLeave={() => setTagsModalDragOver((prev) => (prev === "available" ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                setTagsModalDragOver(null);
                const tagId = e.dataTransfer.getData("text/tag-id");
                if (tagId) setConversationTag(tagId, false);
              }}
            >
              <header className="wa-tags-modal__col-head">
                <h3>Disponibles</h3>
                {availableModalTags.length > 0 ? (
                  <span className="wa-tags-modal__count">{availableModalTags.length}</span>
                ) : null}
              </header>
              <div className="wa-tags-modal__col-body">
                {availableModalTags.length === 0 ? (
                  <p className="form-hint">
                    {tagsModalQuery.trim()
                      ? "Ninguna etiqueta disponible coincide con la búsqueda."
                      : tagsModalGroupId
                        ? "No hay etiquetas disponibles en ese grupo."
                        : "No quedan etiquetas para agregar."}
                  </p>
                ) : (
                  <div className="wa-tags-modal__list" role="list">
                    {availableModalTags.map((tag) => (
                      <div
                        key={tag.id}
                        role="listitem"
                        className="wa-tags-modal__row"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/tag-id", tag.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setTagsModalDragOver(null)}
                      >
                        <span
                          className="wa-tags-modal__swatch"
                          style={{ background: tagColor(tag) }}
                          aria-hidden
                        />
                        <span className="wa-tags-modal__main">
                          <span className="wa-tags-modal__tag-name">{tag.name}</span>
                          <span className="wa-tags-modal__group-name">{tagGroupLabel(tag)}</span>
                        </span>
                        <button
                          type="button"
                          className="wa-tags-modal__action"
                          aria-label={`Asignar ${tag.name}`}
                          title={`Asignar ${tag.name}`}
                          onClick={() => setConversationTag(tag.id, true)}
                        >
                          <IconPlus size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section
              className={`wa-tags-modal__col${tagsModalDragOver === "assigned" ? " is-drop-target" : ""}`}
              aria-label="Etiquetas asignadas"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setTagsModalDragOver("assigned");
              }}
              onDragLeave={() => setTagsModalDragOver((prev) => (prev === "assigned" ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                setTagsModalDragOver(null);
                const tagId = e.dataTransfer.getData("text/tag-id");
                if (tagId) setConversationTag(tagId, true);
              }}
            >
              <header className="wa-tags-modal__col-head">
                <h3>Asignadas</h3>
                {assignedModalTags.length > 0 ? (
                  <span className="wa-tags-modal__count">{assignedModalTags.length}</span>
                ) : null}
              </header>
              <div className="wa-tags-modal__col-body">
                {assignedModalTags.length === 0 ? (
                  <p className="form-hint">
                    {tagsModalQuery.trim()
                      ? "Ninguna etiqueta asignada coincide con la búsqueda."
                      : tagsModalGroupId
                        ? "No hay etiquetas asignadas en ese grupo."
                        : "Arrastrá o usá el ícono para asignar."}
                  </p>
                ) : (
                  <div className="wa-tags-modal__list" role="list">
                    {assignedModalTags.map((tag) => (
                      <div
                        key={tag.id}
                        role="listitem"
                        className="wa-tags-modal__row"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/tag-id", tag.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setTagsModalDragOver(null)}
                      >
                        <span
                          className="wa-tags-modal__swatch"
                          style={{ background: tagColor(tag) }}
                          aria-hidden
                        />
                        <span className="wa-tags-modal__main">
                          <span className="wa-tags-modal__tag-name">{tag.name}</span>
                          <span className="wa-tags-modal__group-name">{tagGroupLabel(tag)}</span>
                        </span>
                        <button
                          type="button"
                          className="wa-tags-modal__action"
                          aria-label={`Quitar ${tag.name}`}
                          title={`Quitar ${tag.name}`}
                          onClick={() => setConversationTag(tag.id, false)}
                        >
                          <IconMinus size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </Modal>

      <Modal
        open={qrModalOpen && !connected}
        title="Vincular WhatsApp"
        onClose={() => setQrModalOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setQrModalOpen(false)}
          >
            Cerrar
          </button>
        }
      >
        <div className="wa-inbox__qr">
          {qr ? (
            <>
              <img src={qr} alt="QR WhatsApp" />
              <p>Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
            </>
          ) : (
            <p>{connecting ? "Generando código QR…" : "Esperando el código QR…"}</p>
          )}
        </div>
      </Modal>

      <WhatsAppContactFollowUpModal
        open={followUpOpen}
        contact={selected?.contact}
        phoneNumber={selected?.contact?.phoneNumber}
        fechaNacimientoPedido={selected?.menuEstado?.fechaNacimiento}
        kind={followUpKind}
        onClose={() => setFollowUpOpen(false)}
        onContactSaved={(updated) => {
          setSelected((prev) =>
            prev && prev.contactId === updated.id
              ? {
                  ...prev,
                  contact: {
                    ...updated,
                    phoneNumber:
                      updated.phoneNumber?.trim() ||
                      prev.contact?.phoneNumber ||
                      "",
                  },
                }
              : prev,
          );
          setConversations((prev) =>
            prev.map((c) =>
              c.contactId === updated.id
                ? {
                    ...c,
                    contact: {
                      ...updated,
                      phoneNumber:
                        updated.phoneNumber?.trim() ||
                        c.contact?.phoneNumber ||
                        "",
                    },
                  }
                : c,
            ),
          );
        }}
      />

      <WhatsAppContactProfileModal
        open={profileOpen && Boolean(selected)}
        contact={selected?.contact}
        phoneNumber={selected?.contact?.phoneNumber}
        fechaNacimientoPedido={selected?.menuEstado?.fechaNacimiento}
        onClose={() => setProfileOpen(false)}
        onContactSaved={(updated) => {
          setSelected((prev) =>
            prev && prev.contactId === updated.id
              ? {
                  ...prev,
                  contact: {
                    ...updated,
                    phoneNumber:
                      updated.phoneNumber?.trim() ||
                      prev.contact?.phoneNumber ||
                      "",
                  },
                }
              : prev,
          );
          setConversations((prev) =>
            prev.map((c) =>
              c.contactId === updated.id
                ? {
                    ...c,
                    contact: {
                      ...updated,
                      phoneNumber:
                        updated.phoneNumber?.trim() ||
                        c.contact?.phoneNumber ||
                        "",
                    },
                  }
                : c,
            ),
          );
        }}
        onCreate={(kind) => {
          setProfileOpen(false);
          setFollowUpKind(kind);
          setFollowUpOpen(true);
        }}
      />

      <Modal
        open={takeOverOpen}
        title="Tomar conversación"
        onClose={() => {
          if (!assigning) setTakeOverOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={assigning}
              onClick={() => setTakeOverOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={assigning || !user?.id}
              onClick={() => void confirmTakeOver()}
            >
              {assigning ? "Asignando…" : "Asignar a mí"}
            </button>
          </>
        }
      >
        <p className="wa-inbox__takeover-msg">
          {takeOverHolderLabel ? (
            <>
              Esta conversación está asignada a <strong>{takeOverHolderLabel}</strong>. Si
              continuás, pasará a estar <strong>en tus manos</strong>.
            </>
          ) : (
            <>
              Esta conversación no tiene asignación. Si continuás, quedará{" "}
              <strong>en tus manos</strong>.
            </>
          )}
        </p>
      </Modal>

      <Modal
        open={pendingAssignee !== null}
        title="Cambiar asignación"
        onClose={() => {
          if (!assigning) setPendingAssignee(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={assigning}
              onClick={() => setPendingAssignee(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={assigning}
              onClick={() => void confirmAssigneeChange()}
            >
              {assigning ? "Asignando…" : "Aceptar"}
            </button>
          </>
        }
      >
        <p className="wa-inbox__takeover-msg">{pendingAssigneeMessage}</p>
      </Modal>
      <Modal
        open={notaOpen}
        title="Marcar como incorrecta"
        wide
        className="wa-prueba-nota-modal"
        onClose={() => {
          if (!notaSaving) setNotaOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={notaSaving}
              onClick={() => setNotaOpen(false)}
            >
              Volver
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                notaSaving ||
                rechazoIds.length === 0 ||
                rechazoIds.some((id) => !String(aclaraciones[id] ?? "").trim())
              }
              onClick={() => void saveNotaIncorrecta()}
            >
              {notaSaving ? "Guardando…" : "Guardar"}
            </button>
          </>
        }
      >
        <div className="wa-prueba-nota-list">
          {messages
            .filter((item) => item.direction === "OUTBOUND" && rechazoIds.includes(item.id))
            .map((item) => (
              <label key={item.id} className="form-group form-group--full">
                <span>{item.text}</span>
                <textarea
                  className="wa-prueba-nota"
                  rows={4}
                  value={aclaraciones[item.id] ?? ""}
                  onChange={(event) =>
                    setAclaraciones((prev) => ({ ...prev, [item.id]: event.target.value }))
                  }
                  placeholder="Qué esperabas en este mensaje"
                />
              </label>
            ))}
        </div>
      </Modal>

      <Modal
        open={accionesOpen}
        title="Acciones pendientes"
        className="fl-modal--wa-acciones"
        onClose={() => setAccionesOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setAccionesOpen(false)}
          >
            Cerrar
          </button>
        }
      >
        {accionesPendientes.length === 0 ? (
          <p className="wa-acciones-empty">No hay acciones pendientes en esta conversación.</p>
        ) : (
          <ul className="wa-acciones-list">
            {accionesPendientes.map((accion) => (
              <li key={accion.id} className={`wa-acciones-card is-${accion.kind}`}>
                <div className="wa-acciones-card__head">
                  <strong>{accion.title}</strong>
                  <span>{formatPreviewTime(accion.createdAt)}</span>
                </div>
                <p className="wa-acciones-card__explain">{accion.explanation}</p>
                {accion.details.length > 0 ? (
                  <dl className="wa-acciones-card__details">
                    {accion.details.map((row) => (
                      <div key={`${accion.id}-${row.label}`}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <pre className="wa-acciones-card__raw">{accion.messageText}</pre>
                )}
                <div className="wa-acciones-card__actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm wa-acciones-card__quitar"
                    title="Quitar de pendientes sin ejecutar"
                    onClick={() => marcarAccionHecha(accion.id)}
                  >
                    Quitar
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => irAlMensajeAccion(accion.id)}
                  >
                    Ir al mensaje
                  </button>
                  {accion.kind === "busca_turno" ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        void ejecutarBuscaTurnoDesdeMensaje(accion.id);
                      }}
                    >
                      Pasar a Busca Turno
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={cancelTurnoBusy}
                      onClick={() => {
                        void pedirCancelarTurnoDesdeMensaje(accion.id);
                      }}
                    >
                      Eliminar turno
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={resueltaOpen}
        title="Marcar como resuelta"
        message="Si la marcás como resuelta, la conversación pasa al bot. El bot no vuelve a responder hasta que la persona escriba de nuevo. ¿Confirmás?"
        confirmLabel={assigning ? "Guardando…" : "Sí, marcar resuelta"}
        cancelLabel="Volver"
        confirmTone="primary"
        onCancel={() => {
          if (!assigning) setResueltaOpen(false);
        }}
        onConfirm={() => {
          if (assigning) return;
          void (async () => {
            const ok = await applyResolve();
            if (ok) {
              setResueltaOpen(false);
              setAccionesOpen(false);
              toast.success("Conversación marcada como resuelta");
            }
          })();
        }}
      />

      <ConfirmDialog
        open={cancelTurnoPendiente !== null}
        title="Cancelar turno"
        message={
          cancelTurnoPendiente
            ? `¿Cancelar este turno? ${cancelTurnoPendiente.resumen}`
            : ""
        }
        confirmTone="primary"
        confirmLabel={cancelTurnoBusy ? "Cancelando…" : "Cancelar turno"}
        cancelLabel="Volver"
        onCancel={() => {
          if (!cancelTurnoBusy) setCancelTurnoPendiente(null);
        }}
        onConfirm={() => {
          if (!cancelTurnoPendiente || cancelTurnoBusy) return;
          void (async () => {
            setCancelTurnoBusy(true);
            try {
              const ok = await anularTurnoDesdePedido(cancelTurnoPendiente);
              toast.success(ok);
              if (cancelTurnoPendiente.messageId) {
                marcarAccionHecha(cancelTurnoPendiente.messageId);
              }
              setCancelTurnoPendiente(null);
              setAccionesOpen(false);
              setHistorialTick((tick) => tick + 1);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "No se pudo anular el turno");
            } finally {
              setCancelTurnoBusy(false);
            }
          })();
        }}
      />
      </div>
    </>
  );
}
