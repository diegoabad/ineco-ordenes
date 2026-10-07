import type { QuickReply } from "../lib/quickReplies";
import type { WaFlow, WaFlowStep } from "../lib/waFlows";
import type { WaProfileField } from "../lib/waProfileSchema";
import { apiFetch, getApiUrl } from "../config/api";
import type { WaConnectionStatus, WaContact, WaContactGrupoEtario, WaCobertura, WaConversation, WaMessage, WaOperator, WaTag, WaTagCatalog, WaTagGroup } from "../types/whatsappCrm";

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

export async function fetchWaFlows(): Promise<WaFlow[]> {
  const res = await apiFetch<{ ok: boolean; data: WaFlow[] }>("/api/whatsapp-crm/flows");
  if (!Array.isArray(res.data)) return [];
  return res.data.map((item) => ({
    ...item,
    objective: item.objective ?? null,
    triggers: Array.isArray(item.triggers) ? item.triggers : [],
    requiredFieldKeys: Array.isArray(item.requiredFieldKeys) ? item.requiredFieldKeys : [],
    childFlowIds: Array.isArray(item.childFlowIds) ? item.childFlowIds : [],
    steps: Array.isArray(item.steps)
      ? item.steps.map((step) => ({
          ...step,
          tagIds: Array.isArray(step.tagIds) ? step.tagIds : [],
          fieldKey: step.fieldKey ?? null,
          flowId: step.flowId ?? null,
        }))
      : [],
  }));
}

export async function createWaFlow(input: {
  name: string;
  objective?: string | null;
  description?: string | null;
  triggers?: string[];
  requiredFieldKeys?: string[];
  childFlowIds?: string[];
  steps: WaFlowStep[];
  isActive?: boolean;
}): Promise<WaFlow> {
  const res = await apiFetch<{ ok: boolean; data: WaFlow }>("/api/whatsapp-crm/flows", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateWaFlow(
  id: string,
  input: {
    name?: string;
    objective?: string | null;
    description?: string | null;
    triggers?: string[];
    requiredFieldKeys?: string[];
    childFlowIds?: string[];
    steps?: WaFlowStep[];
    isActive?: boolean;
  },
): Promise<WaFlow> {
  const res = await apiFetch<{ ok: boolean; data: WaFlow }>(
    `/api/whatsapp-crm/flows/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function deleteWaFlow(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/whatsapp-crm/flows/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function fetchWaProfileFields(): Promise<WaProfileField[]> {
  const res = await apiFetch<{ ok: boolean; data: WaProfileField[] }>(
    "/api/whatsapp-crm/profile-fields",
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function createWaProfileField(input: {
  key: string;
  label: string;
  description?: string | null;
  type: string;
  scope?: string;
  options?: string[];
  group?: string;
  askPrompt?: string | null;
  confirmPrompt?: string | null;
  isActive?: boolean;
}): Promise<WaProfileField> {
  const res = await apiFetch<{ ok: boolean; data: WaProfileField }>(
    "/api/whatsapp-crm/profile-fields",
    { method: "POST", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function updateWaProfileField(
  id: string,
  input: {
    key?: string;
    label?: string;
    description?: string | null;
    type?: string;
    scope?: string;
    options?: string[];
    group?: string;
    askPrompt?: string | null;
    confirmPrompt?: string | null;
    isActive?: boolean;
  },
): Promise<WaProfileField> {
  const res = await apiFetch<{ ok: boolean; data: WaProfileField }>(
    `/api/whatsapp-crm/profile-fields/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function deleteWaProfileField(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(
    `/api/whatsapp-crm/profile-fields/${encodeURIComponent(id)}`,
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
