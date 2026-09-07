import { useState } from "react";
import type { BuscaTurnoSection } from "../lib/appNav";
import { BUSCA_TURNO_SECTIONS } from "../lib/appNav";
import BuscaTurnoApp from "./busca-turno/BuscaTurnoApp";

type CatalogStatus = {
  cacheDot: string;
  cacheLabel: string;
};

type Props = {
  section: BuscaTurnoSection;
  onSectionChange: (section: BuscaTurnoSection) => void;
};

/** Módulo Busca turno (Medexis) — layout alineado al resto de la app. */
export function BuscaTurnoModule({ section, onSectionChange }: Props) {
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({
    cacheDot: "loading",
    cacheLabel: "Cargando…",
  });

  const sectionLabel =
    BUSCA_TURNO_SECTIONS.find((s) => s.id === section)?.label ?? "Busca turno";

  return (
    <div className="app-shell app-shell--busca-turno">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>{sectionLabel}</h1>
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

      <BuscaTurnoApp
        section={section}
        onRequestSection={onSectionChange}
        onCatalogStatus={setCatalogStatus}
      />
    </div>
  );
}
