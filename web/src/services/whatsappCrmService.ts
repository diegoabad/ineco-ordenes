import type { QuickReply } from "../lib/quickReplies";
import { apiFetch, getApiUrl } from "../config/api";
import type {
  WaConnectionStatus,
  WaContact,
  WaContactGrupoEtario,
  WaCobertura,
  WaConversation,
  WaDerivacionConfig,
  WaDerivacionRegla,
  WaIntencion,
  WaMessage,
  WaOperator,
  WaTag,
  WaTagCatalog,
  WaTagGroup,
} from "../types/whatsappCrm";

export async function fetchWhatsappCrmHealth(): Promise<{
  configured: boolean;
  status?: string;
}> {
  const res = await apiFetch<{ ok: boolean; configured: boolean; status?: string }>(
    "/api/whatsapp-crm/health",
  );
  return { configured: res.configured === true, status: res.status };
}

export async function fetchWhatsappStatus(): Promise<WaConnectionStatus> {
  const res = await apiFetch<{ ok: boolean; data: WaConnectionStatus }>(
    "/api/whatsapp-crm/whatsapp/status",
  );
  return res.data ?? {};
}

export async function connectWhatsapp(): Promise<WaConnectionStatus> {
  const res = await apiFetch<{ ok: boolean; data: WaConnectionStatus }>(
    "/api/whatsapp-crm/whatsapp/connect",
    { method: "POST", body: "{}" },
  );
  return res.data ?? {};
}

export async function disconnectWhatsapp(): Promise<WaConnectionStatus> {
  const res = await apiFetch<{ ok: boolean; data: WaConnectionStatus }>(
    "/api/whatsapp-crm/whatsapp/disconnect",
    { method: "POST", body: "{}" },
  );
  return res.data ?? {};
}

export async function logoutWhatsapp(): Promise<WaConnectionStatus> {
  const res = await apiFetch<{ ok: boolean; data: WaConnectionStatus }>(
    "/api/whatsapp-crm/whatsapp/logout",
    { method: "POST", body: "{}" },
  );
  return res.data ?? {};
}

export async function fetchQuickReplies(): Promise<QuickReply[]> {
  const res = await apiFetch<{ ok: boolean; data: QuickReply[] }>(
    "/api/whatsapp-crm/quick-replies",
  );
  return (Array.isArray(res.data) ? res.data : []).map((item) => normalizeQuickReply(item));
}

export async function createQuickReply(input: {
  trigger: string;
  title?: string | null;
  body: string;
  tagIds?: string[] | null;
  isActive?: boolean;
}): Promise<QuickReply> {
  const res = await apiFetch<{ ok: boolean; data: QuickReply }>(
    "/api/whatsapp-crm/quick-replies",
    { method: "POST", body: JSON.stringify(input) },
  );
  return normalizeQuickReply(res.data);
}

export async function updateQuickReply(
  id: string,
  input: {
    trigger?: string;
    title?: string | null;
    body?: string;
    tagIds?: string[] | null;
    isActive?: boolean;
  },
): Promise<QuickReply> {
  const res = await apiFetch<{ ok: boolean; data: QuickReply }>(
    `/api/whatsapp-crm/quick-replies/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return normalizeQuickReply(res.data);
}

function normalizeQuickReply(item: QuickReply & { tagId?: string | null }): QuickReply {
  const fromArray = Array.isArray(item.tagIds) ? item.tagIds.filter(Boolean) : [];
  const legacy = String(item.tagId ?? "").trim();
  if (legacy) fromArray.push(legacy);
  return { ...item, tagIds: [...new Set(fromArray)] };
}

export async function deleteQuickReply(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(
    `/api/whatsapp-crm/quick-replies/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export type WaAccesoCluster = {
  id: string;
  color: string;
  tagIds: string[];
};

export type WaAccesosRapidos = {
  tagIds: string[];
  clusters: WaAccesoCluster[];
};

export async function fetchWaAccesos(): Promise<WaAccesosRapidos> {
  const res = await apiFetch<{ ok: boolean; data: WaAccesosRapidos }>(
    "/api/whatsapp-crm/accesos-rapidos",
  );
  return {
    tagIds: Array.isArray(res.data?.tagIds) ? res.data.tagIds : [],
    clusters: Array.isArray(res.data?.clusters) ? res.data.clusters : [],
  };
}

export async function saveWaAccesos(input: {
  tagIds?: string[];
  clusters?: WaAccesoCluster[];
}): Promise<WaAccesosRapidos> {
  const res = await apiFetch<{ ok: boolean; data: WaAccesosRapidos }>(
    "/api/whatsapp-crm/accesos-rapidos",
    { method: "PUT", body: JSON.stringify(input) },
  );
  return {
    tagIds: Array.isArray(res.data?.tagIds) ? res.data.tagIds : [],
    clusters: Array.isArray(res.data?.clusters) ? res.data.clusters : [],
  };
}

export async function fetchWaTagCatalog(): Promise<WaTagCatalog> {
  const res = await apiFetch<{ ok: boolean; data: WaTagCatalog }>("/api/whatsapp-crm/tags");
  return {
    groups: Array.isArray(res.data?.groups) ? res.data.groups : [],
    items: Array.isArray(res.data?.items) ? res.data.items : [],
  };
}

export async function createWaTagGroup(input: {
  name: string;
  color: string;
}): Promise<WaTagGroup> {
  const res = await apiFetch<{ ok: boolean; data: WaTagGroup }>("/api/whatsapp-crm/tag-groups", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateWaTagGroup(
  id: string,
  input: { name?: string; color?: string },
): Promise<WaTagGroup> {
  const res = await apiFetch<{ ok: boolean; data: WaTagGroup }>(
    `/api/whatsapp-crm/tag-groups/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function deleteWaTagGroup(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/whatsapp-crm/tag-groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function createWaTag(input: {
  name: string;
  groupId: string;
}): Promise<WaTag> {
  const res = await apiFetch<{ ok: boolean; data: WaTag }>("/api/whatsapp-crm/tags", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateWaTag(
  id: string,
  input: { name?: string; groupId?: string },
): Promise<WaTag> {
  const res = await apiFetch<{ ok: boolean; data: WaTag }>(
    `/api/whatsapp-crm/tags/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function deleteWaTag(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/whatsapp-crm/tags/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function fetchWaCoberturas(
  grupoEtario?: WaContactGrupoEtario | null,
): Promise<WaCobertura[]> {
  const q =
    grupoEtario === "infanto" || grupoEtario === "adulto"
      ? `?grupoEtario=${encodeURIComponent(grupoEtario)}`
      : "";
  const res = await apiFetch<{ ok: boolean; data: WaCobertura[] }>(
    `/api/whatsapp-crm/coberturas${q}`,
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function createWaCobertura(input: {
  nombre: string;
  gruposEtarios: WaContactGrupoEtario[];
}): Promise<WaCobertura> {
  const res = await apiFetch<{ ok: boolean; data: WaCobertura }>("/api/whatsapp-crm/coberturas", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateWaCobertura(
  id: string,
  input: { nombre?: string; gruposEtarios?: WaContactGrupoEtario[] },
): Promise<WaCobertura> {
  const res = await apiFetch<{ ok: boolean; data: WaCobertura }>(
    `/api/whatsapp-crm/coberturas/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function deleteWaCobertura(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/whatsapp-crm/coberturas/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function setWaConversationTags(id: string, tagIds: string[]): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${encodeURIComponent(id)}/tags`,
    { method: "PATCH", body: JSON.stringify({ tagIds }) },
  );
  return res.data;
}

export async function updateWaContact(
  id: string,
  input: {
    firstName: string;
    lastName?: string;
    cobertura?: string;
    email?: string;
    fechaNacimiento?: string | null;
    grupoEtario?: string | null;
    consultaPara?: string | null;
    contactoNombre?: string | null;
    contactoApellido?: string | null;
    relacionFamiliar?: string | null;
    dni?: string | null;
    sexo?: string | null;
    esPaciente?: boolean | null;
  },
): Promise<WaContact> {
  const res = await apiFetch<{ ok: boolean; data: WaContact }>(
    `/api/whatsapp-crm/contacts/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        firstName: input.firstName,
        lastName: input.lastName ?? "",
        cobertura: input.cobertura ?? "",
        email: input.email ?? "",
        fechaNacimiento: input.fechaNacimiento ?? "",
        grupoEtario: input.grupoEtario ?? "",
        consultaPara: input.consultaPara ?? "",
        relacionFamiliar: input.relacionFamiliar ?? "",
        contactoNombre: input.contactoNombre ?? "",
        contactoApellido: input.contactoApellido ?? "",
        dni: input.dni ?? "",
        sexo: input.sexo ?? "",
        esPaciente: input.esPaciente ?? null,
      }),
    },
  );
  return res.data;
}

export async function fetchWaOperators(): Promise<WaOperator[]> {
  const res = await apiFetch<{ ok: boolean; data: WaOperator[] }>(
    "/api/whatsapp-crm/operators",
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchWaDerivacionTurno(): Promise<WaDerivacionConfig> {
  const res = await apiFetch<{ ok: boolean; data: WaDerivacionConfig }>(
    "/api/whatsapp-crm/derivacion-turno",
  );
  return res.data;
}

export async function saveWaDerivacionTurno(input: {
  defaultRecepcionista: string;
  reglas: WaDerivacionRegla[];
}): Promise<WaDerivacionConfig> {
  const res = await apiFetch<{ ok: boolean; data: WaDerivacionConfig }>(
    "/api/whatsapp-crm/derivacion-turno",
    { method: "PUT", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function addWaOperator(userId: string, color: string): Promise<WaOperator[]> {
  const res = await apiFetch<{ ok: boolean; data: WaOperator[] }>(
    "/api/whatsapp-crm/operators",
    { method: "POST", body: JSON.stringify({ userId, color }) },
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchWaOperatorAssignments(userId: string): Promise<number> {
  const res = await apiFetch<{ ok: boolean; data: { count: number } }>(
    `/api/whatsapp-crm/operators/${encodeURIComponent(userId)}/assignments`,
  );
  return Number(res.data?.count ?? 0);
}

export async function removeWaOperator(
  userId: string,
  reassign?: { kind: "none" | "bot" | "user"; userId?: string } | null,
): Promise<WaOperator[]> {
  const res = await apiFetch<{ ok: boolean; data: WaOperator[] }>(
    `/api/whatsapp-crm/operators/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      body: JSON.stringify(reassign ? { reassign } : {}),
    },
  );
  return Array.isArray(res.data) ? res.data : [];
}

export type WaConversationListPage = {
  items: WaConversation[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export async function fetchWaConversations(params?: {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
  assignee?: string;
  tagIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  prueba?: boolean;
  motor?: "ia" | "menu";
}): Promise<WaConversationListPage> {
  const q = new URLSearchParams();
  if (params?.search?.trim()) q.set("search", params.search.trim());
  if (params?.status) q.set("status", params.status);
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  if (params?.assignee?.trim()) q.set("assignee", params.assignee.trim());
  if (params?.tagIds?.length) q.set("tagIds", params.tagIds.filter(Boolean).join(","));
  if (params?.dateFrom?.trim()) q.set("dateFrom", params.dateFrom.trim());
  if (params?.dateTo?.trim()) q.set("dateTo", params.dateTo.trim());
  if (params?.prueba) q.set("prueba", "1");
  if (params?.prueba && params.motor === "menu") q.set("motor", "menu");
  const qs = q.toString();
  const res = await apiFetch<{
    ok: boolean;
    data: WaConversation[];
    total?: number;
    hasMore?: boolean;
    nextOffset?: number | null;
  }>(`/api/whatsapp-crm/conversations${qs ? `?${qs}` : ""}`);
  const items = Array.isArray(res.data) ? res.data : [];
  return {
    items,
    total: Number(res.total ?? items.length),
    hasMore: res.hasMore === true,
    nextOffset: res.nextOffset ?? null,
  };
}

export async function fetchWaConversation(id: string): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${id}`,
  );
  return res.data;
}

export type WaTurnoFicha = {
  fecha: string;
  hora: string;
  profesional: string;
  prestacion: string;
  estado: string;
};

export async function fetchWaHistorialTurnos(id: string): Promise<{
  turnos: WaTurnoFicha[];
  ultimosProfesionales: string[];
  tagIds: string[];
  aviso: string;
}> {
  const res = await apiFetch<{
    ok: boolean;
    data: {
      turnos: WaTurnoFicha[];
      ultimosProfesionales: string[];
      tagIds: string[];
      aviso?: string;
    };
  }>(`/api/whatsapp-crm/conversations/${encodeURIComponent(id)}/historial-turnos`);
  return {
    turnos: res.data.turnos ?? [],
    ultimosProfesionales: res.data.ultimosProfesionales ?? [],
    tagIds: res.data.tagIds ?? [],
    aviso: res.data.aviso ?? "",
  };
}

export async function fetchWaConversationByContact(
  contactId: string,
): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/by-contact/${encodeURIComponent(contactId)}`,
  );
  return res.data;
}

export async function markWaConversationRead(id: string): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${id}/read`,
    { method: "POST", body: "{}" },
  );
  return res.data;
}

export async function fetchWaMessages(
  conversationId: string,
  limit = 100,
): Promise<WaMessage[]> {
  const res = await apiFetch<{ ok: boolean; data: WaMessage[] }>(
    `/api/whatsapp-crm/messages/conversation/${conversationId}?limit=${limit}`,
  );
  return Array.isArray(res.data) ? res.data : [];
}

export type WaLlmUsage = {
  id: string;
  paso: "detectar" | "responder";
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  tokensTotal: number;
  tokensCache: number;
  tokensRazonamiento: number;
  ok: boolean;
  error?: string;
  creadoEn?: string;
};

export async function fetchWaLlmUsage(conversationId: string): Promise<WaLlmUsage[]> {
  const res = await apiFetch<{ ok: boolean; items: WaLlmUsage[] }>(
    `/api/whatsapp-crm/conversations/${encodeURIComponent(conversationId)}/llm-usage`,
  );
  return Array.isArray(res.items) ? res.items : [];
}

export async function createWaPrueba(
  motor: "ia" | "menu" = "ia",
): Promise<WaConversation & { __local?: boolean }> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation; local?: boolean }>(
    "/api/whatsapp-crm/pruebas",
    {
      method: "POST",
      body: JSON.stringify({ motor }),
    },
  );
  return { ...res.data, __local: res.local === true || String(res.data?.id ?? "").startsWith("local-") };
}

export async function sendWaPruebaMessage(
  conversationId: string,
  text: string,
): Promise<{ conversation: WaConversation | null; messages: WaMessage[] }> {
  const res = await apiFetch<{
    ok: boolean;
    data: { conversation: WaConversation | null; messages: WaMessage[] };
  }>(`/api/whatsapp-crm/pruebas/${encodeURIComponent(conversationId)}/mensajes`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return {
    conversation: res.data?.conversation ?? null,
    messages: Array.isArray(res.data?.messages) ? res.data.messages : [],
  };
}

export async function saveWaPruebaNota(
  conversationId: string,
  resultado: "correcta" | "incorrecta",
  aclaraciones: { messageId: string; texto: string }[] = [],
): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/pruebas/${encodeURIComponent(conversationId)}/nota`,
    {
      method: "POST",
      body: JSON.stringify({ resultado, aclaraciones }),
    },
  );
  return res.data;
}

export async function matchWaPrestacion(input: {
  texto: string;
  profesionalDoc?: string;
  profesionalNombre?: string;
  modalidad?: "" | "presencial" | "virtual" | "indistinto";
  grupoEtario?: "" | "infanto" | "adulto";
  fechaNacimiento?: string;
  dni?: string;
  conversacionId?: string;
}): Promise<{
  codigo: string;
  nombre: string;
  profesionalDoc?: string;
  profesionalNombre?: string;
} | null> {
  const res = await apiFetch<{
    ok: boolean;
    data: {
      codigo: string;
      nombre: string;
      profesionalDoc?: string;
      profesionalNombre?: string;
    } | null;
  }>("/api/whatsapp-crm/match-prestacion", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data?.codigo ? res.data : null;
}

export async function sendWaMessage(
  conversationId: string,
  message: string,
): Promise<unknown> {
  const res = await apiFetch<{ ok: boolean; data: unknown }>(
    `/api/whatsapp-crm/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ message }),
    },
  );
  return res.data;
}

export async function sendWaMedia(
  conversationId: string,
  file: File,
  caption?: string,
): Promise<unknown> {
  const body = new FormData();
  body.append("file", file);
  if (caption?.trim()) body.append("message", caption.trim());
  const res = await apiFetch<{ ok: boolean; data: unknown }>(
    `/api/whatsapp-crm/conversations/${conversationId}/messages`,
    { method: "POST", body },
  );
  return res.data;
}

export async function assignWaConversation(
  id: string,
  input: { kind: "none" | "bot" | "user"; userId?: string },
): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${id}/assignee`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
}

/** Marca el episodio como resuelto por humano → bot + pausa hasta próximo inbound. */
export async function resolveWaConversation(id: string): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${id}/resolve`,
    { method: "POST", body: JSON.stringify({}) },
  );
  return res.data;
}

/** Diagnóstico presuntivo confirmado/corregido por el equipo. */
export async function setWaDiagnosticoPresuntivo(
  id: string,
  diagnostico: string,
): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${id}/diagnostico`,
    { method: "PATCH", body: JSON.stringify({ diagnostico }) },
  );
  return res.data;
}

export function waMediaUrl(messageId: string): string {
  const base = getApiUrl() || "";
  return `${base}/api/whatsapp-crm/messages/${messageId}/media`;
}

export async function fetchWhatsappBotConfig(): Promise<{
  data: Record<string, unknown> | null;
  updatedAt: string | null;
}> {
  const res = await apiFetch<{
    ok: boolean;
    data: Record<string, unknown> | null;
    updatedAt: string | null;
  }>("/api/whatsapp-crm/bot-config");
  return {
    data: res.data ?? null,
    updatedAt: res.updatedAt ?? null,
  };
}

export async function saveWhatsappBotConfig(
  data: Record<string, unknown>,
  options?: { json?: string },
): Promise<{ data: Record<string, unknown>; json?: string; updatedAt: string }> {
  const res = await apiFetch<{
    ok: boolean;
    data: Record<string, unknown>;
    json?: string;
    updatedAt: string;
  }>("/api/whatsapp-crm/bot-config", {
    method: "PUT",
    body: JSON.stringify({
      data,
      ...(options?.json ? { json: options.json } : {}),
    }),
  });
  return { data: res.data, json: res.json, updatedAt: res.updatedAt };
}

export type WaMotorConfig = {
  interpretacion: {
    detectarDatosAutomaticamente: boolean;
    detectarCambiosDeTema: boolean;
    detectarIntencion: boolean;
  };
  contexto: {
    reutilizarDatosConocidos: boolean;
    permitirCorrecciones: boolean;
    conservarContexto: boolean;
    evitarPreguntasRepetidas: boolean;
    omitirPreguntaSiMotivoConocido: boolean;
  };
  intenciones: {
    permitirCambiosDeIntencion: boolean;
    permitirInterrupciones: boolean;
    retomarIntencionAnterior: boolean;
  };
  tiempo: {
    incluirFechaHoraActual: boolean;
    interpretarFechasRelativas: boolean;
  };
  mensajeria: {
    agruparMensajes: boolean;
    evitarMensajesDuplicados: boolean;
  };
  seguridad: {
    detectarRiesgos: boolean;
    evaluacionPrioritaria: boolean;
  };
  administracion: {
    id: string;
    version: string;
  };
};

export async function fetchWhatsappMotorConfig(): Promise<{
  data: WaMotorConfig;
  updatedAt: string | null;
}> {
  const res = await apiFetch<{
    ok: boolean;
    data: WaMotorConfig;
    updatedAt: string | null;
  }>("/api/whatsapp-crm/motor-config");
  return { data: res.data, updatedAt: res.updatedAt ?? null };
}

export async function saveWhatsappMotorConfig(
  data: WaMotorConfig,
): Promise<{ data: WaMotorConfig; updatedAt: string }> {
  const res = await apiFetch<{
    ok: boolean;
    data: WaMotorConfig;
    updatedAt: string;
  }>("/api/whatsapp-crm/motor-config", {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
  return { data: res.data, updatedAt: res.updatedAt };
}

export async function fetchWhatsappConocimiento(): Promise<{
  text: string;
  updatedAt: string | null;
}> {
  const res = await apiFetch<{
    ok: boolean;
    text: string;
    updatedAt: string | null;
  }>("/api/whatsapp-crm/conocimiento");
  return { text: res.text ?? "", updatedAt: res.updatedAt ?? null };
}

export async function saveWhatsappConocimiento(
  text: string,
): Promise<{ text: string; updatedAt: string }> {
  const res = await apiFetch<{
    ok: boolean;
    text: string;
    updatedAt: string;
  }>("/api/whatsapp-crm/conocimiento", {
    method: "PUT",
    body: JSON.stringify({ text }),
  });
  return { text: res.text, updatedAt: res.updatedAt };
}

export async function fetchIntenciones(): Promise<WaIntencion[]> {
  const res = await apiFetch<{ ok: boolean; data: WaIntencion[] }>(
    "/api/whatsapp-crm/intenciones",
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function createIntencion(input: {
  nombre: string;
  clave?: string;
  descripcion?: string;
  esRiesgo?: boolean;
  mensajeRiesgo?: string;
}): Promise<WaIntencion> {
  const res = await apiFetch<{ ok: boolean; data: WaIntencion }>(
    "/api/whatsapp-crm/intenciones",
    { method: "POST", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function updateIntencion(
  id: string,
  input: {
    nombre?: string;
    clave?: string;
    descripcion?: string;
    esRiesgo?: boolean;
    mensajeRiesgo?: string;
  },
): Promise<WaIntencion> {
  const res = await apiFetch<{ ok: boolean; data: WaIntencion }>(
    `/api/whatsapp-crm/intenciones/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function deleteIntencion(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(
    `/api/whatsapp-crm/intenciones/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export type WaMetricaFila = {
  tagIds: string[];
  assigneeKind: "none" | "bot" | "user";
  assigneeUserId: string | null;
  assigneeName: string | null;
  resolutionStatus?: "open" | "resolved";
  resolucionesEnPeriodo?: {
    id: string;
    at: string;
    byKind: "human" | "bot";
    byUserId: string | null;
    byName: string | null;
    motivo?: "manual" | "timeout" | "cierre_bot";
  }[];
};

export type WaMetricas = {
  filas: WaMetricaFila[];
  grupos: { id: string; name: string; color: string }[];
  etiquetas: { id: string; name: string; groupId: string }[];
};

export type WaMetricaContador = {
  id: string;
  nombre: string;
  color: string;
  modo: "etiquetas" | "grupo";
  tagIds: string[];
  groupId: string | null;
};

export type WaMetricaAgrupacion = {
  id: string;
  nombre: string;
  contadores: WaMetricaContador[];
};

export type WaMetricaTablero = {
  agrupaciones: WaMetricaAgrupacion[];
};

export async function fetchWaMetricaTablero(): Promise<WaMetricaTablero> {
  const res = await apiFetch<{ ok: boolean; data: WaMetricaTablero }>(
    "/api/whatsapp-crm/metricas-tablero",
  );
  return {
    agrupaciones: Array.isArray(res.data?.agrupaciones) ? res.data.agrupaciones : [],
  };
}

export async function saveWaMetricaTablero(agrupaciones: WaMetricaAgrupacion[]): Promise<WaMetricaTablero> {
  const res = await apiFetch<{ ok: boolean; data: WaMetricaTablero }>(
    "/api/whatsapp-crm/metricas-tablero",
    { method: "PUT", body: JSON.stringify({ agrupaciones }) },
  );
  return {
    agrupaciones: Array.isArray(res.data?.agrupaciones) ? res.data.agrupaciones : [],
  };
}

export async function fetchWaMetricas(desde: string, hasta: string): Promise<WaMetricas> {
  const params = new URLSearchParams({ desde, hasta });
  const res = await apiFetch<{ ok: boolean; data: WaMetricas }>(
    `/api/whatsapp-crm/metricas?${params.toString()}`,
  );
  return {
    filas: Array.isArray(res.data?.filas) ? res.data.filas : [],
    grupos: Array.isArray(res.data?.grupos) ? res.data.grupos : [],
    etiquetas: Array.isArray(res.data?.etiquetas) ? res.data.etiquetas : [],
  };
}
