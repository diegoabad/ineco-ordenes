import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "react-toastify";
import type { AppModuleId, AuthUser, UserRole } from "../auth/AuthContext";
import { apiFetch } from "../config/api";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconCheck, IconFile, IconPencil, IconPlus, IconTrash, IconX } from "./Icons";
import { ScrollableAppTabs } from "./ScrollableAppTabs";

type Tab = "approved" | "pending" | "dominios";

const MODULE_OPTIONS: { id: AppModuleId; label: string }[] = [
  { id: "ordenes", label: "Órdenes" },
  { id: "presupuestos", label: "Presupuestos" },
  { id: "pami", label: "PAMI" },
  { id: "busca-turno", label: "Busca turno" },
  { id: "pedidos-sistema", label: "Pedidos sistema" },
  { id: "usuarios", label: "Usuarios" },
];

type AccessDraft = {
  userId: string;
  nombre: string;
  email: string;
  role: UserRole;
  modules: AppModuleId[];
  mode: "approve" | "edit";
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UsuariosPanel() {
  const [tab, setTab] = useState<Tab>("pending");
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<AccessDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AuthUser | null>(null);

  const [domains, setDomains] = useState<string[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainInput, setDomainInput] = useState("");
  const [savingDomains, setSavingDomains] = useState(false);

  const load = useCallback(async () => {
    if (tab === "dominios") return;
    setLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; data: AuthUser[] }>(
        `/api/usuarios?status=${tab}`,
      );
      setUsers(res.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron cargar usuarios");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const loadDomains = useCallback(async () => {
    setDomainsLoading(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        data: { allowedDomains: string[] };
      }>("/api/usuarios/config/dominios");
      setDomains(res.data.allowedDomains);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudieron cargar dominios");
    } finally {
      setDomainsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "dominios") {
      void loadDomains();
    } else {
      void load();
    }
  }, [tab, load, loadDomains]);

  function openApprove(user: AuthUser) {
    setDraft({
      userId: user.id,
      nombre: user.nombre,
      email: user.email,
      role: "user",
      modules: ["ordenes"],
      mode: "approve",
    });
  }

  function openEdit(user: AuthUser) {
    setDraft({
      userId: user.id,
      nombre: user.nombre,
      email: user.email,
      role: user.role,
      modules: [...user.modules],
      mode: "edit",
    });
  }

  function toggleModule(id: AppModuleId) {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.modules.includes(id);
      let modules = has
        ? prev.modules.filter((m) => m !== id)
        : [...prev.modules, id];
      if (prev.role === "admin" && !modules.includes("usuarios")) {
        modules = [...modules, "usuarios"];
      }
      if (prev.role !== "admin") {
        modules = modules.filter((m) => m !== "usuarios");
      }
      return { ...prev, modules };
    });
  }

  function setRole(role: UserRole) {
    setDraft((prev) => {
      if (!prev) return prev;
      let modules = [...prev.modules];
      if (role === "admin" && !modules.includes("usuarios")) {
        modules.push("usuarios");
      }
      if (role !== "admin") {
        modules = modules.filter((m) => m !== "usuarios");
      }
      return { ...prev, role, modules };
    });
  }

  async function saveDraft() {
    if (!draft) return;
    if (draft.modules.length === 0) {
      toast.warning("Asigná al menos una pantalla");
      return;
    }
    setSaving(true);
    try {
      if (draft.mode === "approve") {
        const res = await apiFetch<{
          ok: boolean;
          data: { emailSent: boolean; emailError: string | null };
        }>(`/api/usuarios/${encodeURIComponent(draft.userId)}/approve`, {
          method: "POST",
          body: JSON.stringify({ role: draft.role, modules: draft.modules }),
        });
        toast.success("Usuario aprobado");
        if (!res.data.emailSent) {
          toast.warning(res.data.emailError || "No se pudo enviar el email de aviso");
        }
      } else {
        await apiFetch(`/api/usuarios/${encodeURIComponent(draft.userId)}`, {
          method: "PUT",
          body: JSON.stringify({ role: draft.role, modules: draft.modules }),
        });
        toast.success("Acceso actualizado");
      }
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    setSaving(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        data: { emailSent: boolean; emailError: string | null };
      }>(`/api/usuarios/${encodeURIComponent(rejectTarget.id)}/reject`, {
        method: "POST",
      });
      toast.success("Usuario rechazado");
      if (!res.data.emailSent) {
        toast.warning(res.data.emailError || "No se pudo enviar el email de aviso");
      }
      setRejectTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo rechazar");
    } finally {
      setSaving(false);
    }
  }

  async function persistDomains(next: string[]) {
    setSavingDomains(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        data: { allowedDomains: string[] };
      }>("/api/usuarios/config/dominios", {
        method: "PUT",
        body: JSON.stringify({ allowedDomains: next }),
      });
      setDomains(res.data.allowedDomains);
      toast.success("Dominios actualizados");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSavingDomains(false);
    }
  }

  function onAddDomain(e: FormEvent) {
    e.preventDefault();
    const value = domainInput.trim().toLowerCase().replace(/^@/, "");
    if (!value) return;
    if (domains.includes(value)) {
      toast.warning("Ese dominio ya está en la lista");
      return;
    }
    setDomainInput("");
    void persistDomains([...domains, value]);
  }

  function onRemoveDomain(domain: string) {
    void persistDomains(domains.filter((d) => d !== domain));
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Usuarios</h1>
          <p className="app-header__hint">
            Gestioná accesos, roles, pantallas y dominios permitidos
          </p>
        </div>
      </header>

      <ScrollableAppTabs aria-label="Secciones de usuarios">
        <button
          type="button"
          className={`app-tabs__btn${tab === "pending" ? " is-active" : ""}`}
          onClick={() => setTab("pending")}
        >
          Pendientes
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "approved" ? " is-active" : ""}`}
          onClick={() => setTab("approved")}
        >
          Activos
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "dominios" ? " is-active" : ""}`}
          onClick={() => setTab("dominios")}
        >
          Dominios
        </button>
      </ScrollableAppTabs>

      {tab === "dominios" ? (
        <section className="fl-table-card">
          <div className="table-toolbar table-toolbar--filters">
            <form className="usuarios-dominios__form" onSubmit={onAddDomain}>
              <label className="form-group">
                <span>Agregar dominio</span>
                <input
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="ej. ineco.ar"
                  disabled={savingDomains}
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingDomains || !domainInput.trim()}
              >
                <IconPlus size={16} />
                Agregar
              </button>
            </form>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dominio</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              {!domainsLoading && domains.length > 0 ? (
                <tbody>
                  {domains.map((d) => (
                    <tr key={d}>
                      <td>@{d}</td>
                      <td>
                        <div className="fl-table-actions">
                          <button
                            type="button"
                            className="fl-icon-btn fl-icon-btn--danger"
                            title="Quitar"
                            disabled={savingDomains}
                            onClick={() => onRemoveDomain(d)}
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : null}
            </table>
            {domainsLoading ? (
              <div className="fl-table-empty fl-table-empty--fill">
                <p className="fl-table-empty__title">Cargando dominios…</p>
              </div>
            ) : domains.length === 0 ? (
              <div className="fl-table-empty fl-table-empty--fill">
                <div className="fl-table-empty__art">
                  <IconFile size={32} />
                </div>
                <p className="fl-table-empty__title">Sin restricciones</p>
                <p className="fl-table-empty__hint">
                  Cualquier dominio puede intentar ingresar (queda en pendientes).
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="fl-table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>{tab === "pending" ? "Solicitado" : "Rol"}</th>
                  {tab === "approved" && <th>Pantallas</th>}
                  <th>Acciones</th>
                </tr>
              </thead>
              {!loading && users.length > 0 ? (
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.nombre}</td>
                      <td>{u.email}</td>
                      <td>
                        {tab === "pending" ? (
                          formatDate(u.creadoAt)
                        ) : (
                          <span
                            className={`chip ${u.role === "admin" ? "chip--ok" : "chip--default"}`}
                          >
                            {u.role === "admin" ? "Admin" : "Usuario"}
                          </span>
                        )}
                      </td>
                      {tab === "approved" && (
                        <td>
                          <div className="usuarios-modules">
                            {u.modules.map((m) => (
                              <span key={m} className="chip chip--muted">
                                {MODULE_OPTIONS.find((o) => o.id === m)?.label ?? m}
                              </span>
                            ))}
                          </div>
                        </td>
                      )}
                      <td>
                        <div className="fl-table-actions">
                          {tab === "pending" ? (
                            <>
                              <button
                                type="button"
                                className="fl-icon-btn fl-icon-btn--success"
                                title="Aprobar"
                                onClick={() => openApprove(u)}
                              >
                                <IconCheck size={16} />
                              </button>
                              <button
                                type="button"
                                className="fl-icon-btn fl-icon-btn--danger"
                                title="Rechazar"
                                onClick={() => setRejectTarget(u)}
                              >
                                <IconX size={16} />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="fl-icon-btn fl-icon-btn--edit"
                              title="Editar acceso"
                              onClick={() => openEdit(u)}
                            >
                              <IconPencil size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ) : null}
            </table>
            {loading ? (
              <div className="fl-table-empty fl-table-empty--fill">
                <p className="fl-table-empty__title">Cargando usuarios…</p>
              </div>
            ) : users.length === 0 ? (
              <div className="fl-table-empty fl-table-empty--fill">
                <div className="fl-table-empty__art">
                  <IconFile size={32} />
                </div>
                <p className="fl-table-empty__title">
                  {tab === "pending"
                    ? "No hay solicitudes pendientes"
                    : "Todavía no hay usuarios activos"}
                </p>
                <p className="fl-table-empty__hint">
                  {tab === "pending"
                    ? "Cuando alguien pida acceso, va a aparecer acá."
                    : "Los usuarios que apruebes van a listarse acá."}
                </p>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {draft && (
        <div className="fl-modal-backdrop" role="presentation">
          <div
            className="fl-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fl-modal__header">
              <h2>{draft.mode === "approve" ? "Aprobar usuario" : "Editar acceso"}</h2>
              <button
                type="button"
                className="fl-icon-btn"
                onClick={() => setDraft(null)}
                aria-label="Cerrar"
              >
                <IconX size={18} />
              </button>
            </div>
            <div className="fl-modal__body">
              <p className="confirm-dialog__message">
                <strong>{draft.nombre}</strong>
                <br />
                {draft.email}
              </p>
              <label className="form-group">
                <span>Rol</span>
                <select
                  value={draft.role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                >
                  <option value="user">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <fieldset className="usuarios-modules-fieldset">
                <legend>Pantallas</legend>
                {MODULE_OPTIONS.filter(
                  (m) => draft.role === "admin" || m.id !== "usuarios",
                ).map((m) => (
                  <label key={m.id} className="usuarios-modules-check">
                    <input
                      type="checkbox"
                      checked={draft.modules.includes(m.id)}
                      onChange={() => toggleModule(m.id)}
                      disabled={draft.role === "admin" && m.id === "usuarios"}
                    />
                    {m.label}
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="fl-modal__footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDraft(null)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveDraft()}
                disabled={saving}
              >
                {saving
                  ? "Guardando…"
                  : draft.mode === "approve"
                    ? "Aprobar y notificar"
                    : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={rejectTarget !== null}
        title="Rechazar solicitud"
        message={
          rejectTarget
            ? `¿Rechazar a ${rejectTarget.nombre} (${rejectTarget.email})? Se le enviará un email.`
            : ""
        }
        confirmLabel={saving ? "Rechazando…" : "Rechazar"}
        onConfirm={() => void confirmReject()}
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  );
}
