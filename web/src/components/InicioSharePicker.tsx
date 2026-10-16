import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { useAuth } from "../auth/AuthContext";
import { fetchUserDirectory } from "../services/dataService";
import type { InicioUserRef, UserDirectoryEntry } from "../types";
import { IconX } from "./Icons";
import { Modal } from "./Modal";

const AVATAR_COLORS = [
  "#0f766e",
  "#1d4ed8",
  "#7c3aed",
  "#b45309",
  "#be123c",
  "#047857",
  "#0369a1",
  "#9333ea",
];

export function userInitials(nombre: string, email = ""): string {
  const base = nombre.trim() || email.trim();
  if (!base) return "?";
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

export function avatarColorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

type AvatarProps = {
  user: Pick<InicioUserRef, "id" | "nombre" | "email">;
  size?: number;
  className?: string;
};

export function UserAvatar({ user, size = 22, className }: AvatarProps) {
  const label = user.nombre.trim() || user.email;
  return (
    <span
      className={`inicio-avatar${className ? ` ${className}` : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
        background: avatarColorForId(user.id),
      }}
      title={label}
      aria-label={label}
    >
      {userInitials(user.nombre, user.email)}
    </span>
  );
}

type StackProps = {
  users: InicioUserRef[];
  max?: number;
  size?: number;
  onClick?: () => void;
  emptyLabel?: string;
  disabled?: boolean;
};

/** Stack de iniciales; si no hay nadie, botón sutil para asignar/compartir. */
export function UserAvatarStack({
  users,
  max = 2,
  size = 22,
  onClick,
  emptyLabel = "Asignar",
  disabled,
}: StackProps) {
  const visible = users.slice(0, max);
  const extra = users.length - visible.length;

  if (users.length === 0) {
    return (
      <button
        type="button"
        className="inicio-share-trigger"
        onClick={onClick}
        disabled={disabled}
        data-tooltip={emptyLabel}
        aria-label={emptyLabel}
      >
        +
      </button>
    );
  }

  return (
    <button
      type="button"
      className="inicio-avatar-stack"
      onClick={onClick}
      disabled={disabled}
      data-tooltip={users.map((u) => u.nombre || u.email).join(", ")}
      aria-label={users.map((u) => u.nombre || u.email).join(", ")}
    >
      {visible.map((user) => (
        <UserAvatar key={user.id} user={user} size={size} />
      ))}
      {extra > 0 ? (
        <span
          className="inicio-avatar inicio-avatar--more"
          style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) }}
        >
          +{extra}
        </span>
      ) : null}
    </button>
  );
}

type AssigneeFieldProps = {
  label?: string;
  options: UserDirectoryEntry[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Para marcar “vos” en la lista y mostrar tu chip aunque el directorio tarde. */
  currentUserId?: string;
  currentUser?: Pick<UserDirectoryEntry, "id" | "nombre" | "email"> | null;
};

/**
 * Asignación multi: buscador (50%) + “Sin asignar” o avatares (50%).
 */
export function UserAssigneeField({
  label = "Asignar a",
  options,
  selectedIds,
  onChange,
  loading,
  disabled,
  placeholder = "Buscar persona…",
  currentUserId,
  currentUser,
}: AssigneeFieldProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const mergedOptions = useMemo(() => {
    const list = [...options];
    const self =
      currentUser && currentUser.id
        ? {
            id: currentUser.id,
            nombre: currentUser.nombre?.trim() || currentUser.email || "Vos",
            email: currentUser.email ?? "",
          }
        : currentUserId
          ? { id: currentUserId, nombre: "Vos", email: "" }
          : null;
    if (self && !list.some((u) => u.id === self.id)) {
      list.unshift(self);
    }
    return list;
  }, [options, currentUser, currentUserId]);

  const byId = useMemo(() => {
    const map = new Map(mergedOptions.map((u) => [u.id, u]));
    return map;
  }, [mergedOptions]);

  const selectedUsers = useMemo(() => {
    const list = selectedIds
      .map((id) => {
        const found = byId.get(id);
        if (found) return found;
        if (currentUserId && id === currentUserId) {
          return {
            id,
            nombre: currentUser?.nombre?.trim() || currentUser?.email || "Vos",
            email: currentUser?.email ?? "",
          } satisfies UserDirectoryEntry;
        }
        return null;
      })
      .filter((u): u is UserDirectoryEntry => Boolean(u));
    if (!currentUserId) return list;
    return [...list].sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      return 0;
    });
  }, [selectedIds, byId, currentUserId, currentUser]);

  const available = useMemo(() => {
    const selected = new Set(selectedIds);
    const q = query.trim().toLowerCase();
    const filtered = mergedOptions
      .filter((u) => !selected.has(u.id))
      .filter((u) => {
        if (!q) return true;
        return (
          u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
        );
      });
    filtered.sort((a, b) => {
      if (currentUserId) {
        if (a.id === currentUserId) return -1;
        if (b.id === currentUserId) return 1;
      }
      const an = (a.nombre.trim() || a.email).toLowerCase();
      const bn = (b.nombre.trim() || b.email).toLowerCase();
      return an.localeCompare(bn, "es");
    });
    return filtered.slice(0, 12);
  }, [mergedOptions, selectedIds, query, currentUserId]);

  function displayName(u: UserDirectoryEntry): string {
    const base = u.nombre.trim() || u.email;
    if (currentUserId && u.id === currentUserId) return `${base} (vos)`;
    return base;
  }

  function updateMenuPos() {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(rect.width, 220), Math.max(120, vw - pad * 2));

    let left = rect.left;
    if (left + width > vw - pad) left = vw - pad - width;
    if (left < pad) left = pad;

    const spaceBelow = Math.max(0, vh - rect.bottom - pad);
    const spaceAbove = Math.max(0, rect.top - pad);
    const preferredMax = Math.min(14 * 16, vh * 0.4);
    const measured = menuRef.current?.scrollHeight ?? 0;
    const needed = measured > 0 ? measured : preferredMax;

    const placeAbove =
      spaceBelow < Math.min(needed, preferredMax) + gap && spaceAbove > spaceBelow;

    const availableSpace = placeAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(120, Math.min(preferredMax, availableSpace - gap));

    let top = placeAbove
      ? rect.top - gap - Math.min(needed, maxHeight)
      : rect.bottom + gap;

    if (top < pad) top = pad;
    if (top + Math.min(needed, maxHeight) > vh - pad) {
      top = Math.max(pad, vh - pad - Math.min(needed, maxHeight));
    }

    const next = {
      top: Math.round(top),
      left: Math.round(left),
      width: Math.round(width),
      maxHeight: Math.round(maxHeight),
    };
    setMenuPos((prev) => {
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight
      ) {
        return prev;
      }
      return next;
    });
  }

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const refineId = window.requestAnimationFrame(() => updateMenuPos());
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScrollOrResize() {
      updateMenuPos();
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.cancelAnimationFrame(refineId);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, available.length, loading, mergedOptions.length]);
  function add(id: string) {
    if (selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  const menu =
    open && menuPos
      ? createPortal(
          <ul
            ref={menuRef}
            className="user-assignee__menu"
            role="listbox"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {loading && mergedOptions.length === 0 ? (
              <li className="user-assignee__empty">Cargando…</li>
            ) : available.length === 0 ? (
              <li className="user-assignee__empty">
                {query.trim()
                  ? "Sin coincidencias"
                  : mergedOptions.length === 0
                    ? "No hay usuarios"
                    : "Todos asignados"}
              </li>
            ) : (
              available.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="user-assignee__option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(u.id)}
                  >
                    <UserAvatar user={u} size={28} />
                    <span className="user-assignee__option-meta">
                      <span className="user-assignee__option-name">{displayName(u)}</span>
                      {u.nombre.trim() ? (
                        <span className="user-assignee__option-email">{u.email}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div className="form-group form-group--full user-assignee">
      {label ? <span className="wa-followup__avisos-label">{label}</span> : null}
      <div className="user-assignee__row" ref={rootRef}>
        <div className="user-assignee__search">
          <input
            ref={inputRef}
            type="search"
            value={query}
            disabled={disabled}
            placeholder={loading && mergedOptions.length === 0 ? "Cargando…" : placeholder}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                return;
              }
              if (e.key === "Enter" && available[0]) {
                e.preventDefault();
                add(available[0].id);
              }
            }}
          />
        </div>
        <div className="user-assignee__selected" aria-label="Asignados">
          {selectedUsers.length === 0 ? (
            <span className="user-assignee__empty-label">Sin asignar</span>
          ) : (
            <div className="user-assignee__chips">
              {selectedUsers.map((u) => {
                const name = displayName(u);
                return (
                  <span key={u.id} className="user-assignee__chip" title={name}>
                    <UserAvatar user={u} size={28} />
                    <button
                      type="button"
                      className="user-assignee__chip-remove"
                      aria-label={`Quitar ${name}`}
                      title={`Quitar ${name}`}
                      disabled={disabled}
                      onClick={() => remove(u.id)}
                    >
                      <IconX size={10} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {menu}
    </div>
  );
}

type PickerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  selectedIds: string[];
  excludeUserId?: string;
  onClose: () => void;
  onSave: (ids: string[]) => void | Promise<void>;
};

let directoryCache: UserDirectoryEntry[] | null = null;
let directoryPromise: Promise<UserDirectoryEntry[]> | null = null;

async function loadDirectory(): Promise<UserDirectoryEntry[]> {
  if (directoryCache) return directoryCache;
  if (!directoryPromise) {
    directoryPromise = fetchUserDirectory()
      .then((data) => {
        directoryCache = data;
        return data;
      })
      .finally(() => {
        directoryPromise = null;
      });
  }
  return directoryPromise;
}

export function peekUserDirectoryCache(): UserDirectoryEntry[] {
  return directoryCache ?? [];
}

export async function loadUserDirectoryCached(): Promise<UserDirectoryEntry[]> {
  return loadDirectory();
}

export function InicioSharePicker({
  open,
  title,
  subtitle,
  selectedIds,
  excludeUserId,
  onClose,
  onSave,
}: PickerProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>(directoryCache ?? []);
  const [selected, setSelected] = useState<string[]>(selectedIds);

  useEffect(() => {
    if (!open) return;
    setSelected(selectedIds);
    let cancelled = false;
    if (!directoryCache) setLoading(true);
    void loadDirectory()
      .then((data) => {
        if (!cancelled) setDirectory(data);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "No se pudo cargar usuarios");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedIds]);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(selected);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      title={title}
      wide
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || loading}
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div className="inicio-share-picker">
        {subtitle ? <p className="text-muted inicio-share-picker__hint">{subtitle}</p> : null}
        <UserAssigneeField
          label=""
          options={directory.filter((u) => u.id !== excludeUserId)}
          selectedIds={selected}
          onChange={setSelected}
          loading={loading}
          disabled={saving}
          placeholder="Buscar por nombre o email…"
          currentUserId={user?.id}
          currentUser={
            user
              ? { id: user.id, nombre: user.nombre, email: user.email }
              : null
          }
        />
      </div>
    </Modal>
  );
}
