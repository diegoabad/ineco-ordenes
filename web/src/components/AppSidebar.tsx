import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { LOGO_INECO_DATA_URL } from "../assets/logoIneco";
import { usePendingUsers } from "../auth/PendingUsersContext";
import type { AppModuleId } from "../auth/AuthContext";
import {
  BUSCA_TURNO_SECTIONS,
  ORDENES_SECTIONS,
  PAMI_SECTIONS,
  PRESUPUESTOS_SECTIONS,
  isAccordionModule,
  type AccordionModuleId,
  type AppNavTarget,
  type AppSection,
} from "../lib/appNav";
import {
  IconCalendar,
  IconChevronDown,
  IconOrders,
  IconPami,
  IconPedidos,
  IconPresupuesto,
  IconUsers,
} from "./Icons";

export type AppModule = AppModuleId;

type Props = {
  module: AppModule;
  section: AppSection | null;
  onNavigate: (target: AppNavTarget) => void;
  allowedModules: AppModule[];
  isAdmin?: boolean;
  userName?: string;
  onLogout?: () => void;
};

type FlatItem = { id: "pedidos-sistema" | "usuarios"; label: string; Icon: typeof IconOrders };

const CONFIG_ITEMS: FlatItem[] = [
  { id: "pedidos-sistema", label: "Pedidos sistema", Icon: IconPedidos },
];

const ADMIN_ONLY_ITEMS: FlatItem[] = [
  { id: "usuarios", label: "Usuarios", Icon: IconUsers },
];

function FlatNavButtons({
  items,
  module,
  onNavigate,
  badges,
}: {
  items: FlatItem[];
  module: AppModule;
  onNavigate: (target: AppNavTarget) => void;
  badges?: Partial<Record<AppModule, number>>;
}) {
  return items.map(({ id, label, Icon }) => {
    const count = badges?.[id] ?? 0;
    return (
      <button
        key={id}
        type="button"
        className={`app-sidebar__btn${module === id ? " is-active" : ""}`}
        onClick={() => onNavigate({ module: id })}
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

function AccordionGroup({
  id,
  label,
  Icon,
  open,
  active,
  children,
  onToggle,
}: {
  id: AccordionModuleId;
  label: string;
  Icon: typeof IconOrders;
  open: boolean;
  active: boolean;
  children: ReactNode;
  onToggle: () => void;
}) {
  return (
    <div className={`app-sidebar__acc${open ? " is-open" : ""}${active ? " is-active-group" : ""}`}>
      <button
        type="button"
        className={`app-sidebar__btn app-sidebar__acc-toggle${active ? " is-active" : ""}`}
        aria-expanded={open}
        aria-controls={`sidebar-acc-${id}`}
        onClick={onToggle}
      >
        <span className="app-sidebar__btn-icon" aria-hidden>
          <Icon size={16} />
        </span>
        <span className="app-sidebar__btn-label">{label}</span>
        <span className={`app-sidebar__acc-chevron${open ? " is-open" : ""}`} aria-hidden>
          <IconChevronDown size={14} />
        </span>
      </button>
      {open ? (
        <div
          id={`sidebar-acc-${id}`}
          className="app-sidebar__acc-panel"
          role="group"
          aria-label={label}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function AppSidebar({
  module,
  section,
  onNavigate,
  allowedModules,
  isAdmin = false,
  userName,
  onLogout,
}: Props) {
  const { pendingUsersCount } = usePendingUsers();
  const showOrdenes = allowedModules.includes("ordenes");
  const showPresupuestos = allowedModules.includes("presupuestos");
  const showPami = allowedModules.includes("pami");
  const showBuscaTurno = allowedModules.includes("busca-turno");
  const config = [
    ...CONFIG_ITEMS.filter((item) => allowedModules.includes(item.id)),
    ...(isAdmin
      ? ADMIN_ONLY_ITEMS.filter((item) => allowedModules.includes(item.id))
      : []),
  ];

  const [expanded, setExpanded] = useState<AccordionModuleId | null>(() =>
    isAccordionModule(module) ? module : null,
  );

  // Al restaurar / cambiar de módulo, abrir el acordeón activo y marcar la pestaña.
  useEffect(() => {
    setExpanded(isAccordionModule(module) ? module : null);
  }, [module]);

  /** Solo abre/cierra el menú. No navega ni elige la primera opción. */
  function toggleGroup(id: AccordionModuleId) {
    setExpanded((prev) => (prev === id ? null : id));
  }

  function navigateFlat(target: AppNavTarget) {
    setExpanded(null);
    onNavigate(target);
  }

  function navigateSection(target: Exclude<AppNavTarget, { section?: undefined }>) {
    setExpanded(target.module);
    onNavigate(target);
  }

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar__brand">
        <img className="app-sidebar__logo" src={LOGO_INECO_DATA_URL} alt="Ineco" />
      </div>
      <nav className="app-sidebar__nav" aria-label="Módulos">
        {showBuscaTurno ? (
          <AccordionGroup
            id="busca-turno"
            label="Busca turno"
            Icon={IconCalendar}
            open={expanded === "busca-turno"}
            active={module === "busca-turno"}
            onToggle={() => toggleGroup("busca-turno")}
          >
            {BUSCA_TURNO_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-sidebar__subbtn${
                  module === "busca-turno" && section === item.id ? " is-active" : ""
                }`}
                onClick={() =>
                  navigateSection({ module: "busca-turno", section: item.id })
                }
              >
                {item.label}
              </button>
            ))}
          </AccordionGroup>
        ) : null}

        {showOrdenes ? (
          <AccordionGroup
            id="ordenes"
            label="Órdenes"
            Icon={IconOrders}
            open={expanded === "ordenes"}
            active={module === "ordenes"}
            onToggle={() => toggleGroup("ordenes")}
          >
            {ORDENES_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-sidebar__subbtn${
                  module === "ordenes" && section === item.id ? " is-active" : ""
                }`}
                onClick={() => navigateSection({ module: "ordenes", section: item.id })}
              >
                {item.label}
              </button>
            ))}
          </AccordionGroup>
        ) : null}

        {showPresupuestos ? (
          <AccordionGroup
            id="presupuestos"
            label="Presupuestos"
            Icon={IconPresupuesto}
            open={expanded === "presupuestos"}
            active={module === "presupuestos"}
            onToggle={() => toggleGroup("presupuestos")}
          >
            {PRESUPUESTOS_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-sidebar__subbtn${
                  module === "presupuestos" && section === item.id ? " is-active" : ""
                }`}
                onClick={() =>
                  navigateSection({ module: "presupuestos", section: item.id })
                }
              >
                {item.label}
              </button>
            ))}
          </AccordionGroup>
        ) : null}

        {showPami ? (
          <AccordionGroup
            id="pami"
            label="PAMI"
            Icon={IconPami}
            open={expanded === "pami"}
            active={module === "pami"}
            onToggle={() => toggleGroup("pami")}
          >
            {PAMI_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-sidebar__subbtn${
                  module === "pami" && section === item.id ? " is-active" : ""
                }`}
                onClick={() => navigateSection({ module: "pami", section: item.id })}
              >
                {item.label}
              </button>
            ))}
          </AccordionGroup>
        ) : null}
      </nav>

      <div className="app-sidebar__bottom">
        {config.length > 0 ? (
          <nav className="app-sidebar__nav app-sidebar__nav--config" aria-label="Configuración">
            <FlatNavButtons
              items={config}
              module={module}
              onNavigate={navigateFlat}
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
