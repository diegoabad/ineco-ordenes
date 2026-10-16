import type { QuickReply } from "../lib/quickReplies";
import { apiFetch, getApiUrl } from "../config/api";
import type {
  WaConnectionStatus,
  WaContact,
  WaContactGrupoEtario,
  WaCobertura,
  WaConversation,
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
};

export async function fetchWaLlmUsage(conversationId: string): Promise<WaLlmUsage[]> {
  const res = await apiFetch<{ ok: boolean; items: WaLlmUsage[] }>(
    `/api/whatsapp-crm/conversations/${encodeURIComponent(conversationId)}/llm-usage`,
  );
  return Array.isArray(res.items) ? res.items : [];
}

export async function createWaPrueba(): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>("/api/whatsapp-crm/pruebas", {
    method: "POST",
  });
  return res.data;
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
  texto = "",
): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/pruebas/${encodeURIComponent(conversationId)}/nota`,
    {
      method: "POST",
      body: JSON.stringify({ resultado, texto }),
    },
  );
  return res.data;
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
