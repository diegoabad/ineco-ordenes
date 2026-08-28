import { LOGO_INECO_DATA_URL } from "../assets/logoIneco";
import { IconOrders, IconPresupuesto } from "./Icons";

export type AppModule = "ordenes" | "presupuestos";

type Props = {
  module: AppModule;
  onModuleChange: (module: AppModule) => void;
};

export function AppSidebar({ module, onModuleChange }: Props) {
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
        <button
          type="button"
          className={`app-sidebar__btn${module === "ordenes" ? " is-active" : ""}`}
          onClick={() => onModuleChange("ordenes")}
        >
          <span className="app-sidebar__btn-icon" aria-hidden>
            <IconOrders size={16} />
          </span>
          Órdenes
        </button>
        <button
          type="button"
          className={`app-sidebar__btn${module === "presupuestos" ? " is-active" : ""}`}
          onClick={() => onModuleChange("presupuestos")}
        >
          <span className="app-sidebar__btn-icon" aria-hidden>
            <IconPresupuesto size={16} />
          </span>
          Presupuestos
        </button>
      </nav>
    </aside>
  );
}
