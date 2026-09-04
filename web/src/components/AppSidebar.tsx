import { LOGO_INECO_DATA_URL } from "../assets/logoIneco";
import { usePendingUsers } from "../auth/PendingUsersContext";
import type { AppModuleId } from "../auth/AuthContext";
import {
  IconCalendar,
  IconOrders,
  IconPami,
  IconPedidos,
  IconPresupuesto,
  IconUsers,
} from "./Icons";

export type AppModule = AppModuleId;

type Props = {
  module: AppModule;
  onModuleChange: (module: AppModule) => void;
  allowedModules: AppModule[];
  /** Solo admin ve el ítem Usuarios en el menú. */
  isAdmin?: boolean;
  userName?: string;
  onLogout?: () => void;
};

type NavItem = { id: AppModule; label: string; Icon: typeof IconOrders };

const MAIN_ITEMS: NavItem[] = [
  { id: "ordenes", label: "Órdenes", Icon: IconOrders },
  { id: "presupuestos", label: "Presupuestos", Icon: IconPresupuesto },
  { id: "pami", label: "PAMI", Icon: IconPami },
  { id: "busca-turno", label: "Busca turno", Icon: IconCalendar },
];

const CONFIG_ITEMS: NavItem[] = [
  { id: "pedidos-sistema", label: "Pedidos sistema", Icon: IconPedidos },
];

const ADMIN_ONLY_ITEMS: NavItem[] = [
  { id: "usuarios", label: "Usuarios", Icon: IconUsers },
];

function NavButtons({
  items,
  module,
  onModuleChange,
  badges,
}: {
  items: NavItem[];
  module: AppModule;
  onModuleChange: (module: AppModule) => void;
  badges?: Partial<Record<AppModule, number>>;
}) {
  return items.map(({ id, label, Icon }) => {
    const count = badges?.[id] ?? 0;
    return (
      <button
        key={id}
        type="button"
        className={`app-sidebar__btn${module === id ? " is-active" : ""}`}
        onClick={() => onModuleChange(id)}
      >
        <span className="app-sidebar__btn-icon" aria-hidden>
          <Icon size={16} />
        </span>
        <span className="app-sidebar__btn-label">{label}</span>
        {count > 0 ? (
          <span className="app-nav-badge" aria-label={`${count} pendientes`}>
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
    );
  });
}

export function AppSidebar({
  module,
  onModuleChange,
  allowedModules,
  isAdmin = false,
  userName,
  onLogout,
}: Props) {
  const { pendingUsersCount } = usePendingUsers();
  const main = MAIN_ITEMS.filter((item) => allowedModules.includes(item.id));
  const config = [
    ...CONFIG_ITEMS.filter((item) => allowedModules.includes(item.id)),
    ...(isAdmin
      ? ADMIN_ONLY_ITEMS.filter((item) => allowedModules.includes(item.id))
      : []),
  ];

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <img
          className="app-sidebar__logo"
          src={LOGO_INECO_DATA_URL}
          alt="Ineco"
        />
      </div>
      <nav className="app-sidebar__nav" aria-label="Módulos">
        <NavButtons items={main} module={module} onModuleChange={onModuleChange} />
      </nav>

      <div className="app-sidebar__bottom">
        {config.length > 0 ? (
          <nav className="app-sidebar__nav app-sidebar__nav--config" aria-label="Configuración">
            <NavButtons
              items={config}
              module={module}
              onModuleChange={onModuleChange}
              badges={isAdmin ? { usuarios: pendingUsersCount } : undefined}
            />
          </nav>
        ) : null}
        {(userName || onLogout) && (
          <div className="app-sidebar__footer">
            {userName && <p className="app-sidebar__user">{userName}</p>}
            {onLogout && (
              <button
                type="button"
                className="btn btn-secondary app-sidebar__logout"
                onClick={onLogout}
              >
                Cerrar sesión
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
