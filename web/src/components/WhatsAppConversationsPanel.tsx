import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject } from "react";
import { toast } from "react-toastify";
import { useAuth } from "../auth/AuthContext";
import { formatFechaHora, fechaHoyIso } from "../lib/fechas";
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
  connectWhatsapp,
  fetchWaConversation,
  fetchWaConversationByContact,
  fetchWaConversations,
  fetchWaMessages,
  fetchWaLlmUsage,
  fetchWaOperators,
  type WaLlmUsage,
  fetchQuickReplies,
  fetchWaTagCatalog,
  fetchWhatsappBotConfig,
  fetchWhatsappCrmHealth,
  fetchWhatsappMotorConfig,
  fetchWhatsappStatus,
  markWaConversationRead,
  createWaPrueba,
  saveWaPruebaNota,
  sendWaMedia,
  sendWaMessage,
  sendWaPruebaMessage,
  setWaConversationTags,
  updateWaContact,
  waMediaUrl,
} from "../services/whatsappCrmService";
import type { WaContact, WaConversation, WaMessage, WaOperator, WaTag, WaTagGroup } from "../types/whatsappCrm";
import { waAssigneeLabel, waContactLabel, waContactThreadHeader } from "../types/whatsappCrm";
import { DatePicker } from "./DatePicker";
import {
  IconCheck,
  IconCheckSquare,
  IconClock,
  IconX,
  IconChevronLeft,
  IconFilter,
  IconGrip,
  IconLink,
  IconMinus,
  IconNote,
  IconPin,
  IconPlus,
  IconSearch,
  IconTag,
  IconUsers,
} from "./Icons";
import { LoadingBlock } from "./InecoMark";
import { Modal } from "./Modal";
import {
  WhatsAppContactFollowUpModal,
  type WaFollowUpKind,
} from "./WhatsAppContactFollowUpModal";
import { WhatsAppContactProfileModal } from "./WhatsAppContactProfileModal";

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

function mergeMensajesServidor(prev: WaMessage[], server: WaMessage[]): WaMessage[] {
  const locales = prev.filter((item) => item.id.startsWith("local-"));
  if (!locales.length) return server;
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
  if (!pendientes.length) return server;
  return [...server, ...pendientes].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
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
  mode?: "live" | "prueba";
  createPruebaRef?: MutableRefObject<(() => void) | null>;
};

const PINNED_WA_TAGS_KEY = "wa-inbox-pinned-tag-ids";
const PINNED_CLUSTERS_KEY = "wa-inbox-pinned-tag-clusters";
const CLUSTER_MIN = 2;
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

export function WhatsAppConversationsPanel({
  onConnectionChange,
  connectRef,
  mode = "live",
  createPruebaRef,
}: Props) {
  const pruebaMode = mode === "prueba";
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
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<WaInboxFilters>(EMPTY_WA_FILTERS);
  const [filterDraft, setFilterDraft] = useState<WaInboxFilters>(EMPTY_WA_FILTERS);
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
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
  const [quickPanelOpen, setQuickPanelOpen] = useState(false);
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
  const [aclaraciones, setAclaraciones] = useState<Record<string, string>>({});
  const [notaSaving, setNotaSaving] = useState(false);
  const [pruebaTab, setPruebaTab] = useState<"paciente" | "modulo" | "intenciones">("paciente");
  const tagWatch = useRef<{ id: string; tags: string[] }>({ id: "", tags: [] });
  const [freshTagIds, setFreshTagIds] = useState<string[]>([]);
  const [uso, setUso] = useState<WaLlmUsage[]>([]);
  const [takeOverOpen, setTakeOverOpen] = useState(false);
  const [pendingAssignee, setPendingAssignee] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [assigning, setAssigning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
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
  const searchTimer = useRef<number | null>(null);
  const loadingMoreRef = useRef(false);
  const skipThreadLoad = useRef<string | null>(null);
  const creatingPruebaRef = useRef(false);
  const pollState = useRef({
    search: "",
    selectedId: null as string | null,
    loadedCount: 0,
    filters: EMPTY_WA_FILTERS,
  });
  const pendingTags = useRef<string[] | null>(null);
  const savingTags = useRef(false);
  const lastQuickReplyRef = useRef<QuickReply | null>(null);
  pollState.current = { search, selectedId, loadedCount: conversations.length, filters };

  const activeFilterCount = useMemo(() => countWaFilters(filters), [filters]);
  const filtersQuery = useMemo(() => waFiltersQuery(filters), [filters]);

  const refreshStatus = useCallback(async () => {
    const status = await fetchWhatsappStatus();
    setWaStatus(String(status.status ?? ""));
    setQr(status.qr ?? null);
    setPhoneNumber(status.phoneNumber ?? null);
    return status;
  }, []);

  const loadList = useCallback(async (q?: string, nextFilters?: WaInboxFilters) => {
    const applied = nextFilters ?? filters;
    setLoadingList(true);
    setHasMoreConversations(false);
    setNextConversationsOffset(null);
    try {
      const page = await fetchWaConversations({
        search: q,
        status: "OPEN",
        limit: CONVERSATIONS_PAGE_SIZE,
        offset: 0,
        prueba: pruebaMode,
        ...waFiltersQuery(applied),
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
  }, [filters, pruebaMode]);

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
        prueba: pruebaMode,
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
  }, [hasMoreConversations, loadingList, nextConversationsOffset, search, filtersQuery, pruebaMode]);

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
            prueba: pruebaMode,
            ...waFiltersQuery(snap.filters),
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
              .then((msgs) => {
                setMessages((prev) => mergeMensajesServidor(prev, msgs));
              })
              .catch(() => undefined),
          );
        }
      }
      void Promise.all(tasks).finally(() => {
        busy = false;
      });
    }, pruebaMode ? 2000 : waitingQr ? 3000 : 20000);
    return () => window.clearInterval(id);
  }, [ready, refreshStatus, qrModalOpen, waStatus, pruebaMode]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setMessages([]);
      return;
    }
    if (skipThreadLoad.current === selectedId) {
      skipThreadLoad.current = null;
      return;
    }
    setMessages([]);
    void loadThread(selectedId);
  }, [selectedId, loadThread]);

  useEffect(() => {
    setDatoMenu(null);
  }, [selectedId]);

  useEffect(() => {
    if (!tagSearchFocus.current || !quickPanelOpen) return;
    tagSearchFocus.current = false;
    quickTagSearchRef.current?.focus();
  }, [quickPanelOpen, quickTagQuery]);

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
    const current = selected?.tagIds ?? [];
    const sameChat = tagWatch.current.id === (selected?.id ?? "");
    const added = sameChat ? current.filter((id) => !tagWatch.current.tags.includes(id)) : [];
    if (!sameChat) setFreshTagIds([]);
    else if (added.length) setFreshTagIds(added);
    tagWatch.current = { id: selected?.id ?? "", tags: [...current] };
  }, [selected?.id, selected?.tagIds]);

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
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [messages, botTyping, ocultos]);

  useEffect(() => {
    if (!pruebaMode) return;
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
  }, [pruebaMode]);

  useEffect(() => {
    abrirRef.current = selectedId;
    vioCargaRef.current = false;
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
          if (siguio) return;
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
    if (abrirRef.current === selectedId) {
      if (messages.some((item) => item.conversationId !== selectedId)) return;
      if (loadingMessages) {
        vioCargaRef.current = true;
        return;
      }
      if (!vioCargaRef.current) return;
      for (const item of messages) vistosRef.current.add(item.id);
      abrirRef.current = null;
      return;
    }
    const nuevos = messages.filter(
      (item) => item.direction === "OUTBOUND" && !item.isDeleted && !vistosRef.current.has(item.id),
    );
    if (!nuevos.length) return;
    for (const item of nuevos) vistosRef.current.add(item.id);
    waitingReplyRef.current = false;
    typingAtRef.current = null;

    const reciente = ultimoBotRef.current > 0 && Date.now() - ultimoBotRef.current < 4000;
    const encolar =
      reciente && colaRef.current.length === 0 ? nuevos.map((item) => item.id) : nuevos.slice(1).map((item) => item.id);
    if (!encolar.length) {
      ultimoBotRef.current = Date.now();
      setBotTyping(false);
      return;
    }
    colaRef.current = [...colaRef.current, ...encolar];
    setOcultos([...colaRef.current]);
    setBotTyping(false);
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
        setBotTyping(false);
        if (!colaRef.current.length) {
          pumpingRef.current = false;
          return;
        }
        const gap = window.setTimeout(() => programarSiguiente(), 400);
        typingTimersRef.current.push(gap);
      }, 1100);
      typingTimersRef.current.push(timer);
    }
  }, [messages, pruebaMode, selectedId, loadingMessages]);

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

  function onSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      void loadList(value);
    }, 300);
  }

  function openFiltersModal() {
    setFilterDraft(filters);
    setTagFilterQuery("");
    setTagFilterSuggestOpen(false);
    setFiltersModalOpen(true);
  }

  function applyFilters() {
    const next = {
      ...filterDraft,
      tagIds: [...filterDraft.tagIds],
    };
    setFilters(next);
    setFiltersModalOpen(false);
    setTagFilterQuery("");
    setTagFilterSuggestOpen(false);
    void loadList(search.trim() || undefined, next);
  }

  function clearFilters() {
    setFilterDraft(EMPTY_WA_FILTERS);
    setFilters(EMPTY_WA_FILTERS);
    setFiltersModalOpen(false);
    setTagFilterQuery("");
    setTagFilterSuggestOpen(false);
    void loadList(search.trim() || undefined, EMPTY_WA_FILTERS);
  }

  function addDraftTag(tagId: string) {
    setFilterDraft((prev) =>
      prev.tagIds.includes(tagId) ? prev : { ...prev, tagIds: [...prev.tagIds, tagId] },
    );
    setTagFilterQuery("");
    setTagFilterSuggestOpen(true);
  }

  function removeDraftTag(tagId: string) {
    setFilterDraft((prev) => ({
      ...prev,
      tagIds: prev.tagIds.filter((id) => id !== tagId),
    }));
  }

  const threadHeader = useMemo(
    () => waContactThreadHeader(selected?.contact),
    [selected],
  );

  useEffect(() => {
    if (!selectedId) return;
    const fresh = conversations.find((item) => item.id === selectedId);
    if (!fresh) return;
    setSelected((current) => {
      if (!current || current.id !== fresh.id) return current;
      const sameResumen = (current.resumen ?? "") === (fresh.resumen ?? "");
      const sameContact = current.contact?.updatedAt === fresh.contact?.updatedAt;
      const sameTags = (current.tagIds ?? []).join() === (fresh.tagIds ?? []).join();
      const sameAssignee =
        (current.assigneeKind ?? "") === (fresh.assigneeKind ?? "") &&
        (current.assigneeName ?? "") === (fresh.assigneeName ?? "");
      if (sameResumen && sameContact && sameTags && sameAssignee) return current;
      return { ...current, ...fresh, contact: fresh.contact ?? current.contact };
    });
  }, [conversations, selectedId]);

  function selectConversation(conversation: WaConversation) {
    setSelectedId(conversation.id);
    setSelected(conversation);
    setDraft("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    lastQuickReplyRef.current = null;
  }

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

  useEffect(() => {
    localStorage.setItem(PINNED_WA_TAGS_KEY, JSON.stringify(pinnedTagIds));
  }, [pinnedTagIds]);

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
    localStorage.setItem(PINNED_CLUSTERS_KEY, JSON.stringify(pinnedClusters));
  }, [pinnedClusters]);

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
    return tags.filter((tag) => {
      if (!q) return true;
      const groupName = tagGroups.find((group) => group.id === tag.groupId)?.name?.toLowerCase() ?? "";
      return tag.name.toLowerCase().includes(q) || groupName.includes(q);
    });
  }, [tags, quickTagQuery, tagGroups]);
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

  function appliedTagColor(tag: WaTag): string {
    const cluster = activeClusters.find((item) => item.tagIds.includes(tag.id));
    return cluster?.color ?? tagColor(tag);
  }

  function tagGroupLabel(tag: { groupId: string }): string {
    return tagGroups.find((group) => group.id === tag.groupId)?.name ?? "Sin grupo";
  }

  const selectedFilterTags = useMemo(
    () =>
      filterDraft.tagIds
        .map((id) => tags.find((tag) => tag.id === id))
        .filter((tag): tag is WaTag => Boolean(tag)),
    [filterDraft.tagIds, tags],
  );

  const tagFilterSuggestions = useMemo(() => {
    const q = tagFilterQuery.trim().toLowerCase();
    return tags
      .filter((tag) => !filterDraft.tagIds.includes(tag.id))
      .filter((tag) => {
        if (!q) return true;
        const groupName = tagGroupLabel(tag).toLowerCase();
        return tag.name.toLowerCase().includes(q) || groupName.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .slice(0, 10);
  }, [tags, filterDraft.tagIds, tagFilterQuery, tagGroups]);

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
    setAssigning(true);
    try {
      const updated = await assignWaConversation(selectedId, { kind, userId });
      const merged = { ...selected, ...updated, contact: updated.contact ?? selected?.contact };
      setSelected(merged);
      setConversations((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo asignar");
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
      setQuickTagQuery(text);
      setQuickPanelOpen(true);
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
    setSelectedId(null);
    setSelected(null);
    setMessages([]);
    setDraft("");
    setAttachment(null);
    try {
      const created = await createWaPrueba();
      skipThreadLoad.current = created.id;
      setConversations((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setSelected(created);
      setMessages([]);
      setSelectedId(created.id);
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
    const espera = esperaMsRef.current;
    const ahora = Date.now();
    esperaDesdeRef.current = ahora;
    avisoFalloRef.current = false;
    typingAtRef.current = ahora + Math.max(0, espera - 10_000);
    waitingReplyRef.current = true;
    setBotTyping(espera <= 10_000);
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
        setMessages((prev) =>
          mergeMensajesServidor(
            prev.filter((item) => item.id !== tempId),
            result.messages,
          ),
        );
        if (result.conversation) setSelected(result.conversation);
      } catch (error) {
        waitingReplyRef.current = false;
        typingAtRef.current = null;
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
          search: search.trim() || undefined,
          status: "OPEN",
          limit: Math.max(conversations.length, CONVERSATIONS_PAGE_SIZE),
          offset: 0,
          prueba: pruebaMode,
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
          const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
          const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
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

  return (
    <div className={`wa-inbox${pruebaMode ? " wa-inbox--prueba" : ""}`}>
      <aside className="wa-inbox__list" aria-label="Conversaciones">
        <div className="wa-inbox__list-head">
          <div className="wa-inbox__list-tools">
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
            {pruebaMode ? null : (
            <button
              type="button"
              className={`wa-inbox__filter-btn${activeFilterCount > 0 ? " is-active" : ""}`}
              aria-label={
                activeFilterCount > 0
                  ? `Filtros (${activeFilterCount} activos)`
                  : "Filtros"
              }
              title={
                activeFilterCount > 0
                  ? `Filtros activos: ${activeFilterCount}`
                  : "Filtros"
              }
              onClick={openFiltersModal}
            >
              <IconFilter size={14} />
              {activeFilterCount > 0 ? (
                <span className="wa-inbox__filter-badge">{activeFilterCount}</span>
              ) : null}
            </button>
            )}
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
              {pruebaMode
                ? "Creá una prueba para empezar a hablarle al bot."
                : connected
                  ? activeFilterCount > 0 || search.trim()
                    ? "No hay conversaciones con esos filtros."
                    : "No hay conversaciones abiertas."
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
                    {pruebaMode && c.pruebaResultado ? (
                      <span className={`wa-prueba-flag${c.pruebaResultado === "correcta" ? " is-ok" : " is-bad"}`}>
                        {c.pruebaResultado === "correcta" ? "Correcta" : "Incorrecta"}
                      </span>
                    ) : null}
                    <div className="wa-inbox__item-bottom">
                      <span
                        className="wa-inbox__item-preview"
                        data-tooltip={c.resumen || c.lastMessagePreview || "Sin mensajes"}
                      >
                        {c.resumen || c.lastMessagePreview || "Sin mensajes"}
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
                    title="Ver ficha del contacto"
                    onClick={() => setProfileOpen(true)}
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
                  title={pruebaMode ? "Datos de la prueba" : "Ver ficha del contacto"}
                >
                  <h2>{threadHeader.title}</h2>
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
                      className="ui-select"
                      aria-label="Asignar operadora"
                      title={
                        selected?.assigneeKind === "bot"
                          ? "Bot"
                          : selected?.assigneeKind === "user"
                            ? selected.assigneeName || "Asignado"
                            : "Sin asignar"
                      }
                      value={currentAssigneeSelectValue()}
                      disabled={assigning || pendingAssignee !== null}
                      onChange={(event) => {
                        requestAssigneeChange(event.target.value);
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
                        title="Etiquetas"
                        onClick={() => {
                          setTagsModalGroupId("");
                          setTagsModalOpen(true);
                        }}
                      >
                        <IconTag size={16} />
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
            {pruebaMode ? null : (
            <div className="wa-inbox__tags">
              {assignedTags.length > 0 ? (
                assignedTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="wa-tag"
                    style={{ "--tag": appliedTagColor(tag) } as CSSProperties}
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
            )}
            <div className="wa-inbox__messages">
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
                  return (
                    <div
                      key={m.id}
                      className={`wa-bubble-row${outbound ? " is-out" : ""}${deIa ? " is-pick" : ""}`}
                    >
                      {deIa ? (
                        <label className={`wa-bubble-check${mostrarCheck ? "" : " is-reserved"}`}>
                          <input
                            type="checkbox"
                            checked={elegido}
                            disabled={!mostrarCheck}
                            tabIndex={mostrarCheck ? 0 : -1}
                            aria-hidden={!mostrarCheck}
                            aria-label="Marcar esta respuesta de la IA"
                            onChange={() => toggleRechazoMensaje(m.id)}
                          />
                        </label>
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
              <div ref={messagesEndRef} />
            </div>
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
              <div className="wa-prueba-tabs" role="tablist">
                {(
                  [
                    ["paciente", "Paciente"],
                    ["modulo", "Módulo"],
                    ["intenciones", "Intenciones"],
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
              {pruebaTab === "paciente" ? (
                <>
                  <section>
                    <h3>Quien escribe</h3>
                    <dl>
                      {(
                        [
                          ["Nombre", selected.contact?.contactoNombre],
                          ["Apellido", selected.contact?.contactoApellido],
                          ["Relación con el paciente", selected.contact?.relacionFamiliar],
                          ["Teléfono", selected.contact?.phoneNumber],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd className={textoDato(value) === "vacío" ? "is-empty" : ""}>{textoDato(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h3>Paciente</h3>
                    <dl>
                      {(
                        [
                          [
                            "La consulta es para",
                            selected.contact?.consultaPara === "propio"
                              ? "quien escribe"
                              : selected.contact?.consultaPara === "tercero"
                                ? "otra persona"
                                : "",
                          ],
                          ["Nombre", selected.contact?.firstName],
                          ["Apellido", selected.contact?.lastName],
                          [
                            "Grupo etario",
                            selected.contact?.grupoEtario === "infanto"
                              ? "infanto"
                              : selected.contact?.grupoEtario === "adulto"
                                ? "adulto"
                                : "",
                          ],
                          ["DNI", selected.contact?.dni],
                          ["Sexo", selected.contact?.sexo],
                          [
                            "¿Es paciente?",
                            selected.contact?.esPaciente === true
                              ? "sí"
                              : selected.contact?.esPaciente === false
                                ? "no"
                                : "",
                          ],
                          ["Cobertura", selected.contact?.cobertura],
                          ["Email", selected.contact?.email],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd className={textoDato(value) === "vacío" ? "is-empty" : ""}>{textoDato(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h3>Etiquetas</h3>
                    {assignedTags.length ? (
                      <div className="wa-prueba-tags">
                        {assignedTags.map((tag) => (
                          <span
                            key={tag.id}
                            className={`wa-tag${freshTagIds.includes(tag.id) ? " is-new" : ""}`}
                            style={{ "--tag": appliedTagColor(tag) } as CSSProperties}
                            title={tagGroupLabel(tag)}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p>Todavía ninguna.</p>
                    )}
                  </section>
                </>
              ) : null}
              {pruebaTab === "modulo" ? (
                <>
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
                </>
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
            </>
          )}
        </aside>
      ) : (
        <div
          className={`wa-tags-hover${quickPanelOpen ? " is-open" : ""}`}
          onMouseEnter={() => setQuickPanelOpen(true)}
          onMouseLeave={() => setQuickPanelOpen(false)}
        >
          <span className="wa-tags-hover__tab" aria-hidden>
            <IconChevronLeft size={16} />
          </span>
          <aside className="wa-tags-pop" aria-label="Etiquetas rápidas">
          <div className="wa-tags-panel wa-tags-panel--float">
          <div className="table-search wa-tags-panel__search">
            <span className="table-search__icon" aria-hidden>
              <IconSearch size={16} />
            </span>
            <input
              ref={quickTagSearchRef}
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
          </div>
          <div className="wa-tags-panel__scroll">
          {quickTagQuery.trim() ? (
            tags.length === 0 ? (
              <p>Todavía no hay etiquetas.</p>
            ) : quickTagResults.length === 0 ? (
              <p>Ninguna etiqueta coincide.</p>
            ) : (
              <div className="wa-tags-quick-list">
                {quickTagResults.map((tag) => renderQuickTag(tag, pinnedTagIds.includes(tag.id)))}
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
                    {quickTagResults.map((tag) => renderQuickTag(tag, pinnedTagIds.includes(tag.id)))}
                  </div>
                )}
              </section>
            </>
          )}
          </div>
          </div>
          </aside>
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
        open={filtersModalOpen}
        title="Filtros de conversaciones"
        className="fl-modal--wa-filters"
        onClose={() => setFiltersModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={clearFilters}>
              Limpiar
            </button>
            <button type="button" className="btn btn-primary" onClick={applyFilters}>
              Aplicar
            </button>
          </>
        }
      >
        <div className="wa-filters">
          <section className="wa-filters__section">
            <h3 className="wa-filters__title">Fecha del último mensaje</h3>
            <div className="wa-filters__dates">
              <div className="form-group">
                <label htmlFor="wa-filter-from">Desde</label>
                <DatePicker
                  id="wa-filter-from"
                  value={filterDraft.dateFrom}
                  formatHint={false}
                  max={
                    filterDraft.dateTo && filterDraft.dateTo < fechaHoyIso()
                      ? filterDraft.dateTo
                      : fechaHoyIso()
                  }
                  onChange={(value) =>
                    setFilterDraft((prev) => {
                      const hoy = fechaHoyIso();
                      let dateFrom = value;
                      if (dateFrom && dateFrom > hoy) dateFrom = hoy;
                      let { dateTo } = prev;
                      if (dateFrom && dateTo && dateFrom > dateTo) {
                        dateTo = dateFrom;
                      }
                      return { ...prev, dateFrom, dateTo };
                    })
                  }
                />
              </div>
              <div className="form-group">
                <label htmlFor="wa-filter-to">Hasta</label>
                <DatePicker
                  id="wa-filter-to"
                  value={filterDraft.dateTo}
                  formatHint={false}
                  min={filterDraft.dateFrom || undefined}
                  max={fechaHoyIso()}
                  onChange={(value) =>
                    setFilterDraft((prev) => {
                      const hoy = fechaHoyIso();
                      let dateTo = value;
                      if (dateTo && dateTo > hoy) dateTo = hoy;
                      let { dateFrom } = prev;
                      if (dateFrom && dateTo && dateFrom > dateTo) {
                        dateFrom = dateTo;
                      }
                      return { ...prev, dateFrom, dateTo };
                    })
                  }
                />
              </div>
            </div>
          </section>

          <section className="wa-filters__section">
            <h3 className="wa-filters__title">Asignado a</h3>
            <select
              className="ui-select"
              value={filterDraft.assignee}
              onChange={(e) =>
                setFilterDraft((prev) => ({ ...prev, assignee: e.target.value }))
              }
              aria-label="Filtrar por asignación"
            >
              <option value="">Todos</option>
              <option value="none">Sin asignar</option>
              <option value="bot">Bot</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.nombre}
                </option>
              ))}
            </select>
          </section>

          <section className="wa-filters__section wa-filters__section--tags">
            <div className="wa-filters__tags-head">
              <h3 className="wa-filters__title">Etiquetas</h3>
              {filterDraft.tagIds.length > 0 ? (
                <span className="wa-filters__tags-count">
                  {filterDraft.tagIds.length} seleccionada
                  {filterDraft.tagIds.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            {tags.length === 0 ? (
              <p className="wa-filters__hint">No hay etiquetas cargadas.</p>
            ) : (
              <div className="wa-filters__tag-search" ref={tagFilterWrapRef}>
                <div className="wa-filters__tag-row">
                  <div className="wa-filters__tag-input-wrap">
                    <div className="table-search wa-filters__tag-input">
                      <span className="table-search__icon" aria-hidden>
                        <IconSearch size={16} />
                      </span>
                      <input
                        type="search"
                        value={tagFilterQuery}
                        placeholder="Buscar etiqueta…"
                        aria-label="Buscar etiqueta"
                        aria-expanded={tagFilterSuggestOpen}
                        aria-controls="wa-filter-tag-suggestions"
                        onChange={(e) => {
                          setTagFilterQuery(e.target.value);
                          setTagFilterSuggestOpen(true);
                        }}
                        onFocus={() => setTagFilterSuggestOpen(true)}
                      />
                    </div>
                    {tagFilterSuggestOpen ? (
                      <div
                        id="wa-filter-tag-suggestions"
                        className="wa-filters__suggest"
                        role="listbox"
                        aria-label="Etiquetas sugeridas"
                      >
                        {tagFilterSuggestions.length === 0 ? (
                          <p className="wa-filters__suggest-empty">
                            {tagFilterQuery.trim()
                              ? "Sin coincidencias"
                              : "No quedan etiquetas para agregar"}
                          </p>
                        ) : (
                          tagFilterSuggestions.map((tag) => (
                            <button
                              key={tag.id}
                              type="button"
                              className="wa-filters__suggest-item"
                              role="option"
                              onClick={() => addDraftTag(tag.id)}
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
                  <div
                    className="wa-filters__selected"
                    aria-live="polite"
                    aria-label="Etiquetas seleccionadas"
                  >
                    {selectedFilterTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className="wa-filters__tag is-active wa-filters__tag--selected"
                        style={{ "--tag-color": tagColor(tag) } as CSSProperties}
                        onClick={() => removeDraftTag(tag.id)}
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
                </div>
              </div>
            )}
          </section>
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
        tagIds={selected?.tagIds ?? []}
        tags={tags}
        tagGroups={tagGroups}
        onClose={() => setProfileOpen(false)}
        onToggleTag={toggleConversationTag}
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
    </div>
  );
}
