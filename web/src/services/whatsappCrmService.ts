import type { QuickReply } from "../lib/quickReplies";
import { apiFetch, getApiUrl } from "../config/api";
import type { WaConnectionStatus, WaConversation, WaMessage, WaOperator, WaTag, WaTagCatalog, WaTagGroup } from "../types/whatsappCrm";

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
  return Array.isArray(res.data) ? res.data : [];
}

export async function createQuickReply(input: {
  trigger: string;
  title?: string | null;
  body: string;
  isActive?: boolean;
}): Promise<QuickReply> {
  const res = await apiFetch<{ ok: boolean; data: QuickReply }>(
    "/api/whatsapp-crm/quick-replies",
    { method: "POST", body: JSON.stringify(input) },
  );
  return res.data;
}

export async function updateQuickReply(
  id: string,
  input: {
    trigger?: string;
    title?: string | null;
    body?: string;
    isActive?: boolean;
  },
): Promise<QuickReply> {
  const res = await apiFetch<{ ok: boolean; data: QuickReply }>(
    `/api/whatsapp-crm/quick-replies/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return res.data;
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

export async function createWaTagGroup(name: string): Promise<WaTagGroup> {
  const res = await apiFetch<{ ok: boolean; data: WaTagGroup }>("/api/whatsapp-crm/tag-groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return res.data;
}

export async function updateWaTagGroup(id: string, name: string): Promise<WaTagGroup> {
  const res = await apiFetch<{ ok: boolean; data: WaTagGroup }>(
    `/api/whatsapp-crm/tag-groups/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
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
  color: string;
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
  input: { name?: string; color?: string; groupId?: string },
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

export async function setWaConversationTags(id: string, tagIds: string[]): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${encodeURIComponent(id)}/tags`,
    { method: "PATCH", body: JSON.stringify({ tagIds }) },
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

export async function removeWaOperator(userId: string): Promise<WaOperator[]> {
  const res = await apiFetch<{ ok: boolean; data: WaOperator[] }>(
    `/api/whatsapp-crm/operators/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchWaConversations(params?: {
  search?: string;
  status?: string;
}): Promise<WaConversation[]> {
  const q = new URLSearchParams();
  if (params?.search?.trim()) q.set("search", params.search.trim());
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  const res = await apiFetch<{ ok: boolean; data: WaConversation[] }>(
    `/api/whatsapp-crm/conversations${qs ? `?${qs}` : ""}`,
  );
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchWaConversation(id: string): Promise<WaConversation> {
  const res = await apiFetch<{ ok: boolean; data: WaConversation }>(
    `/api/whatsapp-crm/conversations/${id}`,
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
