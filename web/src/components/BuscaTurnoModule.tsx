import { useState } from "react";
import BuscaTurnoApp from "./busca-turno/BuscaTurnoApp";
import { ScrollableAppTabs } from "./ScrollableAppTabs";

export type BuscaTurnoTab = "turnos" | "config";

type CatalogStatus = {
  cacheDot: string;
  cacheLabel: string;
};

/** Módulo Busca turno (Medexis) — layout alineado al resto de la app. */
export function BuscaTurnoModule() {
  const [tab, setTab] = useState<BuscaTurnoTab>("turnos");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({
    cacheDot: "loading",
    cacheLabel: "Cargando…",
  });

  return (
    <div className="app-shell app-shell--busca-turno">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>Busca turno</h1>
            <p>Turnos disponibles por prestación (Medexis)</p>
          </div>
        </div>
        <div className="app-header__actions busca-turno-header-status">
          <span
            className={`dot ${catalogStatus.cacheDot}`}
            title={catalogStatus.cacheLabel}
          />
          <span className="busca-turno-header-status__label">
            {catalogStatus.cacheLabel}
          </span>
        </div>
      </header>

      <ScrollableAppTabs aria-label="Secciones busca turno">
        <button
          type="button"
          className={`app-tabs__btn${tab === "turnos" ? " is-active" : ""}`}
          onClick={() => setTab("turnos")}
        >
          Turnos
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "config" ? " is-active" : ""}`}
          onClick={() => setTab("config")}
        >
          Configuración
        </button>
      </ScrollableAppTabs>

      <BuscaTurnoApp
        section={tab}
        onRequestSection={setTab}
        onCatalogStatus={setCatalogStatus}
      />
    </div>
  );
}
