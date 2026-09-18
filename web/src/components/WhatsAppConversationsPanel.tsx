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
import type { WaConversation, WaMessage, WaTag, WaTagGroup } from "../types/whatsappCrm";
import { waAssigneeLabel, waContactLabel } from "../types/whatsappCrm";
import type { UserDirectoryEntry } from "../types";
import {
  extractSlashQuery,
  formatTrigger,
  quickReplyVars,
  resolveQuickReply,
  type QuickReply,
} from "../lib/quickReplies";
import { IconSearch } from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";

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

export function WhatsAppConversationsPanel({ onConnectionChange, connectRef }: Props) {
  const [ready, setReady] = useState(false);
  const [waStatus, setWaStatus] = useState<string>("");
  const [qr, setQr] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [conversations, setConversations] = useState<WaConversation[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<WaConversation | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [operators, setOperators] = useState<UserDirectoryEntry[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [tags, setTags] = useState<WaTag[]>([]);
  const [tagGroups, setTagGroups] = useState<WaTagGroup[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [assigning, setAssigning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tagPickerRef = useRef<HTMLDivElement | null>(null);
  const searchTimer = useRef<number | null>(null);
  const pollState = useRef({
    search: "",
    selectedId: null as string | null,
  });
  const pendingTags = useRef<string[] | null>(null);
  const savingTags = useRef(false);
  pollState.current = { search, selectedId };

  const refreshStatus = useCallback(async () => {
    const status = await fetchWhatsappStatus();
    setWaStatus(String(status.status ?? ""));
    setQr(status.qr ?? null);
    setPhoneNumber(status.phoneNumber ?? null);
    return status;
  }, []);

  const loadList = useCallback(async (q?: string) => {
    setLoadingList(true);
    try {
      const data = await fetchWaConversations({
        search: q,
        status: "OPEN",
      });
      setConversations(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron cargar las conversaciones");
      setConversations([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setLoadingMessages(true);
    try {
      const [conv, msgs] = await Promise.all([
        fetchWaConversation(id),
        fetchWaMessages(id),
      ]);
      setSelected(conv);
      setMessages(msgs);
      void markWaConversationRead(id)
        .then((updated) => {
          setSelected(updated);
          setConversations((prev) =>
            prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
          );
        })
        .catch(() => {
          /* ignore */
        });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo abrir la conversación");
      setMessages([]);
    } finally {
      setLoadingMessages(false);
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
        await loadList();
        void fetchWaOperators()
          .then(setOperators)
          .catch(() => {
            /* el chat sigue usable sin el listado */
          });
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
          })
            .then((list) => setConversations(list))
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
    setTagPickerOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!tagPickerOpen) return;
    function onPointer(event: MouseEvent) {
      if (!tagPickerRef.current?.contains(event.target as Node)) setTagPickerOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [tagPickerOpen]);

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
    setDraft(resolveQuickReply(item.body, replyVars()));
  }

  function outgoingText(raw: string): string {
    const query = extractSlashQuery(raw.trim());
    if (!query) return raw.trim();
    const match = quickReplies.find((item) => item.isActive && item.trigger === query);
    if (!match) return raw.trim();
    return resolveQuickReply(match.body, replyVars());
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
    const text = outgoingText(draft);
    const file = attachment;
    setSending(true);
    try {
      if (file) {
        await sendWaMedia(selectedId, file, text || undefined);
        setAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        await sendWaMessage(selectedId, text);
      }
      setDraft("");
      const [msgs, list] = await Promise.all([
        fetchWaMessages(selectedId),
        fetchWaConversations({ search: search.trim() || undefined, status: "OPEN" }),
      ]);
      setMessages(msgs);
      setConversations(list);
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
        <div className="wa-inbox__list-body">
          {loadingList ? (
            <p className="wa-inbox__empty">Cargando…</p>
          ) : conversations.length === 0 ? (
            <p className="wa-inbox__empty">
              {connected
                ? "No hay conversaciones abiertas."
                : "Conectá WhatsApp para empezar a recibir chats."}
            </p>
          ) : (
            conversations.map((c) => {
              const label = waContactLabel(c.contact);
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`wa-inbox__item${active ? " is-active" : ""}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="wa-inbox__item-top">
                    <strong className="wa-inbox__item-name">{label}</strong>
                    <span className="wa-inbox__item-time">
                      {formatPreviewTime(c.lastMessageAt)}
                    </span>
                  </div>
                  {tags.some((tag) => (c.tagIds ?? []).includes(tag.id)) ? (
                    <div className="wa-inbox__item-tags">
                      {tags
                        .filter((tag) => (c.tagIds ?? []).includes(tag.id))
                        .map((tag) => (
                          <span
                            key={tag.id}
                            className="wa-tag wa-tag--mini"
                            style={{ "--tag": tag.color } as CSSProperties}
                          >
                            {tag.name}
                          </span>
                        ))}
                    </div>
                  ) : null}
                  <div className="wa-inbox__item-bottom">
                    <span className="wa-inbox__item-preview">
                      {c.lastMessagePreview || "Sin mensajes"}
                    </span>
                    <span
                      className={`wa-inbox__assignee${c.assigneeKind === "bot" ? " is-bot" : ""}`}
                    >
                      {waAssigneeLabel(c)}
                    </span>
                    {c.unreadCount > 0 ? (
                      <span className="wa-inbox__badge">{c.unreadCount}</span>
                    ) : null}
                  </div>
                </button>
              );
            })
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
            {tags.length > 0 ? (
              <div className="wa-inbox__tags">
                {tags
                  .filter((tag) => (selected?.tagIds ?? []).includes(tag.id))
                  .map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className="wa-tag"
                      style={{ "--tag": tag.color } as CSSProperties}
                      title="Quitar etiqueta"
                      onClick={() => toggleConversationTag(tag.id)}
                    >
                      {tag.name}
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                <div className="wa-tag-picker" ref={tagPickerRef}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setTagPickerOpen((open) => !open)}
                  >
                    + Etiqueta
                  </button>
                  {tagPickerOpen ? (
                    <div className="wa-tag-picker__menu" role="listbox" aria-label="Elegir etiquetas">
                      {tagGroups.map((group) => {
                        const options = tags.filter((tag) => tag.groupId === group.id);
                        if (options.length === 0) return null;
                        return (
                          <div key={group.id}>
                            <p className="wa-tag-picker__group">{group.name}</p>
                            {options.map((tag) => {
                              const checked = (selected?.tagIds ?? []).includes(tag.id);
                              return (
                                <label key={tag.id} className="usuarios-modules-check wa-tag-picker__item">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleConversationTag(tag.id)}
                                  />
                                  <span className="wa-tag" style={{ "--tag": tag.color } as CSSProperties}>
                                    {tag.name}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })}
                      {tags.every((tag) => tagGroups.some((group) => group.id === tag.groupId)) ? null : (
                        <div>
                          <p className="wa-tag-picker__group">Sin grupo</p>
                          {tags
                            .filter((tag) => !tagGroups.some((group) => group.id === tag.groupId))
                            .map((tag) => {
                              const checked = (selected?.tagIds ?? []).includes(tag.id);
                              return (
                                <label key={tag.id} className="usuarios-modules-check wa-tag-picker__item">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleConversationTag(tag.id)}
                                  />
                                  <span className="wa-tag" style={{ "--tag": tag.color } as CSSProperties}>
                                    {tag.name}
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
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
    </div>
  );
}
