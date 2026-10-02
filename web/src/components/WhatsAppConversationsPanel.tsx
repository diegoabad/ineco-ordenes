import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import { formatFechaHora } from "../lib/fechas";
import {
  assignWaConversation,
  connectWhatsapp,
  fetchWaConversation,
  fetchWaConversations,
  fetchWaMessages,
  fetchWaOperators,
  fetchQuickReplies,
  fetchWaTagCatalog,
  fetchWhatsappCrmHealth,
  fetchWhatsappStatus,
  markWaConversationRead,
  sendWaMedia,
  sendWaMessage,
  setWaConversationTags,
  waMediaUrl,
} from "../services/whatsappCrmService";
import type { WaConversation, WaMessage, WaOperator, WaTag, WaTagGroup } from "../types/whatsappCrm";
import { waAssigneeLabel, waContactLabel } from "../types/whatsappCrm";
import {
  extractSlashQuery,
  formatTrigger,
  quickReplyVars,
  resolveQuickReply,
  type QuickReply,
} from "../lib/quickReplies";
import { IconCheckSquare, IconClock, IconMinus, IconNote, IconPlus, IconSearch, IconTag, IconUsers } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";
import {
  WhatsAppContactFollowUpModal,
  type WaFollowUpKind,
} from "./WhatsAppContactFollowUpModal";

const CONVERSATIONS_PAGE_SIZE = 40;

function formatPreviewTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return formatFechaHora(iso);
  } catch {
    return "";
  }
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

export type WaConnectionBanner = {
  connected: boolean;
  connecting: boolean;
  label: string;
};

type Props = {
  onConnectionChange?: (status: WaConnectionBanner) => void;
  connectRef?: MutableRefObject<(() => void) | null>;
};

export function WhatsAppConversationsPanel({
  onConnectionChange,
  connectRef,
}: Props) {
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
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<WaConversation | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [operators, setOperators] = useState<WaOperator[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [tags, setTags] = useState<WaTag[]>([]);
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
  const [slashIndex, setSlashIndex] = useState(0);
  const [assigning, setAssigning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listBodyRef = useRef<HTMLDivElement | null>(null);
  const tagsGroupPickerRef = useRef<HTMLDivElement | null>(null);
  const searchTimer = useRef<number | null>(null);
  const loadingMoreRef = useRef(false);
  const pollState = useRef({
    search: "",
    selectedId: null as string | null,
    loadedCount: 0,
  });
  const pendingTags = useRef<string[] | null>(null);
  const savingTags = useRef(false);
  pollState.current = { search, selectedId, loadedCount: conversations.length };

  const refreshStatus = useCallback(async () => {
    const status = await fetchWhatsappStatus();
    setWaStatus(String(status.status ?? ""));
    setQr(status.qr ?? null);
    setPhoneNumber(status.phoneNumber ?? null);
    return status;
  }, []);

  const loadList = useCallback(async (q?: string) => {
    setLoadingList(true);
    setHasMoreConversations(false);
    setNextConversationsOffset(null);
    try {
      const page = await fetchWaConversations({
        search: q,
        status: "OPEN",
        limit: CONVERSATIONS_PAGE_SIZE,
        offset: 0,
      });
      setConversations(page.items);
      setHasMoreConversations(page.hasMore);
      setNextConversationsOffset(page.nextOffset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las conversaciones");
      setConversations([]);
      setHasMoreConversations(false);
      setNextConversationsOffset(null);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMoreConversations = useCallback(async () => {
    if (loadingMoreRef.current || loadingList || !hasMoreConversations || nextConversationsOffset == null) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchWaConversations({
        search: search.trim() || undefined,
        status: "OPEN",
        limit: CONVERSATIONS_PAGE_SIZE,
        offset: nextConversationsOffset,
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
  }, [hasMoreConversations, loadingList, nextConversationsOffset, search]);

  const loadThread = useCallback(async (id: string) => {
    setLoadingMessages(true);
    try {
      const [conv, msgs] = await Promise.all([
        fetchWaConversation(id),
        fetchWaMessages(id),
      ]);
      if (pollState.current.selectedId !== id) return;
      setSelected(conv);
      setMessages(msgs);
      void markWaConversationRead(id)
        .then((updated) => {
          if (pollState.current.selectedId !== id) return;
          setSelected(updated);
          setConversations((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
          );
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
            search: snap.search.trim() || undefined,
            status: "OPEN",
            limit: Math.max(snap.loadedCount, CONVERSATIONS_PAGE_SIZE),
            offset: 0,
          })
            .then((page) => {
              setConversations((prev) => {
                const byId = new Map(page.items.map((item) => [item.id, item]));
                const merged = prev.map((item) => byId.get(item.id) ?? item);
                const known = new Set(merged.map((item) => item.id));
                const fresh = page.items.filter((item) => !known.has(item.id));
                return [...fresh, ...merged].sort((a, b) => {
                  const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
                  const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
                  return tb - ta;
                });
              });
              setHasMoreConversations(page.hasMore);
              setNextConversationsOffset(page.nextOffset);
            })
            .catch(() => undefined),
        );
        if (snap.selectedId) {
          tasks.push(
            fetchWaMessages(snap.selectedId)
              .then((msgs) => setMessages(msgs))
              .catch(() => undefined),
          );
        }
      }
      void Promise.all(tasks).finally(() => {
        busy = false;
      });
    }, waitingQr ? 3000 : 20000);
    return () => window.clearInterval(id);
  }, [ready, refreshStatus, qrModalOpen, waStatus]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setMessages([]);
      return;
    }
    setMessages([]);
    void loadThread(selectedId);
  }, [selectedId, loadThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  function onSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      void loadList(value);
    }, 300);
  }

  const selectedLabel = useMemo(
    () => waContactLabel(selected?.contact),
    [selected],
  );

  function selectConversation(conversation: WaConversation) {
    setSelectedId(conversation.id);
    setSelected(conversation);
    setDraft("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  const assignedTags = useMemo(
    () => tags.filter((tag) => (selected?.tagIds ?? []).includes(tag.id)),
    [tags, selected?.tagIds],
  );
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

  function setConversationTag(tagId: string, assigned: boolean) {
    const current = pendingTags.current ?? selected?.tagIds ?? [];
    const has = current.includes(tagId);
    if (assigned === has) return;
    const next = assigned ? [...current, tagId] : current.filter((id) => id !== tagId);
    void applyTags(next);
  }

  function assigneeColor(conversation: {
    assigneeKind?: "none" | "bot" | "user" | null;
    assigneeUserId?: string | null;
  }): string {
    if (conversation.assigneeKind === "bot") return "#a61948";
    if (conversation.assigneeKind === "user" && conversation.assigneeUserId) {
      return (
        operators.find((user) => user.id === conversation.assigneeUserId)?.color ?? "#94a3b8"
      );
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

  function matchQuickReply(raw: string): QuickReply | null {
    const query = extractSlashQuery(raw.trim());
    if (!query) return null;
    return quickReplies.find((item) => item.isActive && item.trigger === query) ?? null;
  }

  async function applyTags(tagIds: string[]) {
    if (!selectedId) return;
    const conversationId = selectedId;
    pendingTags.current = tagIds;
    setSelected((prev) => (prev && prev.id === conversationId ? { ...prev, tagIds } : prev));
    setConversations((prev) =>
      prev.map((item) => (item.id === conversationId ? { ...item, tagIds } : item)),
    );
    if (savingTags.current) return;
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
      if (pendingTags.current) void applyTags(pendingTags.current);
    }
  }

  function applyQuickReplyTags(item: QuickReply) {
    const toAdd = Array.isArray(item.tagIds) ? item.tagIds.filter(Boolean) : [];
    if (toAdd.length === 0) return;
    const current = pendingTags.current ?? selected?.tagIds ?? [];
    const missing = toAdd.filter((id) => !current.includes(id));
    if (missing.length === 0) return;
    void applyTags([...current, ...missing]);
  }

  function applyQuickReply(item: QuickReply) {
    setDraft(resolveQuickReply(item.body, replyVars()));
    applyQuickReplyTags(item);
  }

  function toggleConversationTag(tagId: string) {
    const current = pendingTags.current ?? selected?.tagIds ?? [];
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    void applyTags(next);
  }

  async function applyAssignee(kind: "none" | "bot" | "user", userId?: string) {
    if (!selectedId || assigning) return;
    setAssigning(true);
    try {
      const updated = await assignWaConversation(selectedId, { kind, userId });
      const merged = { ...selected, ...updated, contact: updated.contact ?? selected?.contact };
      setSelected(merged);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo asignar");
    } finally {
      setAssigning(false);
    }
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

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || sending) return;
    if (!draft.trim() && !attachment) return;
    const matchedReply = matchQuickReply(draft);
    const text = matchedReply
      ? resolveQuickReply(matchedReply.body, replyVars())
      : draft.trim();
    const file = attachment;
    setSending(true);
    try {
      if (matchedReply) applyQuickReplyTags(matchedReply);
      if (file) {
        await sendWaMedia(selectedId, file, text || undefined);
        setAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        await sendWaMessage(selectedId, text);
      }
      setDraft("");
      const [msgs, page] = await Promise.all([
        fetchWaMessages(selectedId),
        fetchWaConversations({
          search: search.trim() || undefined,
          status: "OPEN",
          limit: Math.max(conversations.length, CONVERSATIONS_PAGE_SIZE),
          offset: 0,
        }),
      ]);
      setMessages(msgs);
      setConversations((prev) => {
        const byId = new Map(page.items.map((item) => [item.id, item]));
        const merged = prev.map((item) => byId.get(item.id) ?? item);
        const known = new Set(merged.map((item) => item.id));
        const fresh = page.items.filter((item) => !known.has(item.id));
        return [...fresh, ...merged].sort((a, b) => {
          const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
          const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
          return tb - ta;
        });
      });
      setHasMoreConversations(page.hasMore);
      setNextConversationsOffset(page.nextOffset);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  if (!ready) {
    return (
      <div className="wa-inbox wa-inbox--loading">
        <LoadingBlock label="Cargando WhatsApp…" />
      </div>
    );
  }

  const connected = waStatus === "CONNECTED";

  return (
    <div className="wa-inbox">
      <aside className="wa-inbox__list" aria-label="Conversaciones">
        <div className="wa-inbox__list-head">
          <div className="table-search wa-inbox__search">
            <span className="table-search__icon" aria-hidden>
              <IconSearch size={16} />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar conversación…"
              aria-label="Buscar conversación"
            />
          </div>
        </div>
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
              {connected
                ? "No hay conversaciones abiertas."
                : "Conectá WhatsApp para empezar a recibir chats."}
            </p>
          ) : (
            <>
              {conversations.map((c) => {
                const label = waContactLabel(c.contact);
                const active = c.id === selectedId;
                const color = assigneeColor(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`wa-inbox__item${active ? " is-active" : ""}`}
                    style={{ "--assignee": color } as CSSProperties}
                    onClick={() => selectConversation(c)}
                  >
                    <div className="wa-inbox__item-top">
                      <strong className="wa-inbox__item-name" data-tooltip={label}>
                        {label}
                      </strong>
                      <span className="wa-inbox__item-time">
                        {formatPreviewTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="wa-inbox__item-bottom">
                      <span
                        className="wa-inbox__item-preview"
                        data-tooltip={c.lastMessagePreview || "Sin mensajes"}
                      >
                        {c.lastMessagePreview || "Sin mensajes"}
                      </span>
                      <span
                        className="wa-inbox__assignee"
                        data-tooltip={waAssigneeLabel(c)}
                      >
                        {waAssigneeLabel(c)}
                      </span>
                      {c.unreadCount > 0 ? (
                        <span className="wa-inbox__badge">{c.unreadCount}</span>
                      ) : null}
                    </div>
                  </button>
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
            <p>Seleccioná una conversación</p>
          </div>
        ) : (
          <>
            <header className="wa-inbox__thread-head">
              <div>
                <h2>{selectedLabel}</h2>
                <p>{selected?.contact?.phoneNumber ?? ""}</p>
              </div>
              <div className="wa-inbox__assign">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm wa-inbox__icon-btn wa-inbox__icon-btn--tarea"
                  disabled={!selected?.contactId}
                  aria-label="Tarea"
                  onClick={() => {
                    setFollowUpKind("tarea");
                    setFollowUpOpen(true);
                  }}
                >
                  <IconCheckSquare size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm wa-inbox__icon-btn wa-inbox__icon-btn--rec"
                  disabled={!selected?.contactId}
                  aria-label="Recordatorio"
                  onClick={() => {
                    setFollowUpKind("recordatorio");
                    setFollowUpOpen(true);
                  }}
                >
                  <IconClock size={16} />
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm wa-inbox__icon-btn wa-inbox__icon-btn--nota"
                  disabled={!selected?.contactId}
                  aria-label="Notas"
                  onClick={() => {
                    setFollowUpKind("nota");
                    setFollowUpOpen(true);
                  }}
                >
                  <IconNote size={16} />
                </button>
                {tags.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm wa-inbox__icon-btn wa-inbox__icon-btn--tag"
                    aria-label="Etiquetas"
                    onClick={() => {
                      setTagsModalGroupId("");
                      setTagsModalOpen(true);
                    }}
                  >
                    <IconTag size={16} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm wa-inbox__icon-btn wa-inbox__icon-btn--contacto"
                  disabled={!selected?.contactId}
                  aria-label="Agendar contacto"
                  onClick={() => {
                    setFollowUpKind("agendar");
                    setFollowUpOpen(true);
                  }}
                >
                  <IconUsers size={16} />
                </button>
                <select
                  className="ui-select"
                  aria-label="Asignar operadora"
                  value={
                    selected?.assigneeKind === "bot"
                      ? "bot"
                      : selected?.assigneeKind === "user"
                        ? selected.assigneeUserId ?? ""
                        : ""
                  }
                  disabled={assigning}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "bot") void applyAssignee("bot");
                    else if (!value) void applyAssignee("none");
                    else void applyAssignee("user", value);
                  }}
                >
                  <option value="">Sin asignar</option>
                  <option value="bot">Bot</option>
                  {operators.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </header>
            <div className="wa-inbox__tags">
              {assignedTags.length > 0 ? (
                assignedTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="wa-tag"
                    style={{ "--tag": tagColor(tag) } as CSSProperties}
                    title="Quitar etiqueta"
                    onClick={() => toggleConversationTag(tag.id)}
                  >
                    {tag.name}
                    <span aria-hidden>×</span>
                  </button>
                ))
              ) : (
                <p className="wa-inbox__tags-empty">Sin etiquetas asignadas</p>
              )}
            </div>
            <div className="wa-inbox__messages">
              {loadingMessages ? (
                <p className="wa-inbox__empty">Cargando mensajes…</p>
              ) : messages.length === 0 ? (
                <p className="wa-inbox__empty">Todavía no hay mensajes en este chat.</p>
              ) : (
                messages.map((m) => {
                  const outbound = m.direction === "OUTBOUND";
                  return (
                    <div
                      key={m.id}
                      className={`wa-bubble${outbound ? " is-out" : " is-in"}`}
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
                        {outbound ? <MessageTicks status={m.status} /> : null}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="wa-inbox__composer" onSubmit={(e) => void handleSend(e)}>
              {slashSuggestions.length > 0 ? (
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
              {attachment ? (
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
                <button
                  type="button"
                  className="wa-inbox__attach"
                  aria-label="Adjuntar archivo"
                  title="Adjuntar imagen o archivo"
                  disabled={sending || !connected || selected?.contact?.isBlocked === true}
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
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(event) => {
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
                    attachment
                      ? "Pie de foto o archivo (opcional)…"
                      : !connected
                        ? "Conectá WhatsApp para escribir"
                        : selected?.contact?.isBlocked
                          ? "Contacto bloqueado"
                          : "Escribí un mensaje… (/saludo)"
                  }
                  disabled={sending || !connected || selected?.contact?.isBlocked === true}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    sending ||
                    !connected ||
                    (!draft.trim() && !attachment) ||
                    selected?.contact?.isBlocked === true
                  }
                >
                  {sending ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

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
        kind={followUpKind}
        onClose={() => setFollowUpOpen(false)}
        onContactSaved={(updated) => {
          setSelected((prev) =>
            prev && prev.contactId === updated.id
              ? { ...prev, contact: updated }
              : prev,
          );
          setConversations((prev) =>
            prev.map((c) =>
              c.contactId === updated.id ? { ...c, contact: updated } : c,
            ),
          );
        }}
      />
    </div>
  );
}
