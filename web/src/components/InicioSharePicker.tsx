import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { fetchUserDirectory } from "../services/dataService";
import type { InicioUserRef, UserDirectoryEntry } from "../types";
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

export function InicioSharePicker({
  open,
  title,
  subtitle,
  selectedIds,
  excludeUserId,
  onClose,
  onSave,
}: PickerProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>(directoryCache ?? []);
  const [selected, setSelected] = useState<string[]>(selectedIds);

  useEffect(() => {
    if (!open) return;
    setSelected(selectedIds);
    setQuery("");
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

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return directory
      .filter((u) => u.id !== excludeUserId)
      .filter((u) => {
        if (!q) return true;
        return (
          u.nombre.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        );
      });
  }, [directory, excludeUserId, query]);

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

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o email"
          autoFocus
        />
        <ul className="inicio-share-picker__list" aria-busy={loading || undefined}>
          {loading ? (
            <li className="inicio-share-picker__empty">Cargando usuarios…</li>
          ) : options.length === 0 ? (
            <li className="inicio-share-picker__empty">No hay usuarios para mostrar.</li>
          ) : (
            options.map((user) => {
              const checked = selected.includes(user.id);
              return (
                <li key={user.id}>
                  <label className={`inicio-share-picker__row${checked ? " is-checked" : ""}`}>
                    <input
                      type="checkbox"
                      className="inicio-share-picker__checkbox"
                      checked={checked}
                      onChange={() => toggle(user.id)}
                    />
                    <span className="inicio-aviso-card__check" aria-hidden="true" />
                    <UserAvatar user={user} size={32} />
                    <span className="inicio-share-picker__meta">
                      <span className="inicio-share-picker__name" title={user.nombre}>
                        {user.nombre}
                      </span>
                      <span className="inicio-share-picker__email" title={user.email}>
                        {user.email}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </Modal>
  );
}
