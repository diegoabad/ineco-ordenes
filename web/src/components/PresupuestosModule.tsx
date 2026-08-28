import { useCallback, useEffect, useState } from "react";
import { IconPlus } from "./Icons";
import { PresupuestoEmailConfigPanel } from "./PresupuestoEmailConfigPanel";
import { PresupuestoPlantillaPanel } from "./PresupuestoPlantillaPanel";
import { PresupuestosConfigPanel } from "./PresupuestosConfigPanel";
import { PresupuestosPanel } from "./PresupuestosPanel";
import { PrestacionesPanel } from "./PrestacionesPanel";
import { mergeMissingDefaultTipos } from "../lib/tipoPrestacion";
import { fetchPresupuestosConfig, savePresupuestosConfig } from "../services/dataService";
import { DEFAULT_TIPOS_PRESTACION, type ProfesionalPresupuesto, type TipoPrestacion } from "../types";

type PresupuestoTab =
  | "presupuestos"
  | "prestaciones"
  | "plantillaEmail"
  | "plantillaPresupuesto"
  | "config";

export function PresupuestosModule() {
  const [tab, setTab] = useState<PresupuestoTab>("presupuestos");
  const [addPrestacionKey, setAddPrestacionKey] = useState(0);
  const [addPresupuestoKey, setAddPresupuestoKey] = useState(0);
  const [tiposPrestacion, setTiposPrestacion] = useState<TipoPrestacion[]>(
    DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t })),
  );
  const [profesionalesPresupuesto, setProfesionalesPresupuesto] = useState<ProfesionalPresupuesto[]>(
    [],
  );

  const cargarConfig = useCallback(async () => {
    try {
      const config = await fetchPresupuestosConfig();
      const { tipos: tiposMerged, changed } = mergeMissingDefaultTipos(config.tiposPrestacion);
      if (changed) {
        const saved = await savePresupuestosConfig({
          tiposPrestacion: tiposMerged,
          profesionales: config.profesionales,
        });
        setTiposPrestacion(saved.tiposPrestacion);
        setProfesionalesPresupuesto(saved.profesionales);
      } else {
        setTiposPrestacion(config.tiposPrestacion);
        setProfesionalesPresupuesto(config.profesionales);
      }
    } catch {
      setTiposPrestacion(DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t })));
      setProfesionalesPresupuesto([]);
    }
  }, []);

  useEffect(() => {
    void cargarConfig();
  }, [cargarConfig]);

  useEffect(() => {
    if (tab !== "prestaciones") setAddPrestacionKey(0);
    if (tab !== "presupuestos") setAddPresupuestoKey(0);
  }, [tab]);

  function handleCrearPresupuesto() {
    setTab("presupuestos");
    setAddPresupuestoKey((k) => k + 1);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>Presupuestos</h1>
            <p>Prestaciones y armado de presupuestos</p>
          </div>
        </div>
        <div className="app-header__actions">
          {tab === "prestaciones" ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAddPrestacionKey((k) => k + 1)}
            >
              <IconPlus size={16} />
              Agregar prestación
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={handleCrearPresupuesto}>
            <IconPlus size={16} />
            Crear presupuesto
          </button>
        </div>
      </header>

      <nav className="app-tabs app-tabs--full" aria-label="Secciones de presupuestos">
        <button
          type="button"
          className={`app-tabs__btn${tab === "presupuestos" ? " is-active" : ""}`}
          onClick={() => setTab("presupuestos")}
        >
          Presupuestos
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "prestaciones" ? " is-active" : ""}`}
          onClick={() => setTab("prestaciones")}
        >
          Prestaciones
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "plantillaPresupuesto" ? " is-active" : ""}`}
          onClick={() => setTab("plantillaPresupuesto")}
        >
          Plantilla presupuesto
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "plantillaEmail" ? " is-active" : ""}`}
          onClick={() => setTab("plantillaEmail")}
        >
          Plantilla email
        </button>
        <button
          type="button"
          className={`app-tabs__btn${tab === "config" ? " is-active" : ""}`}
          onClick={() => setTab("config")}
        >
          Configuración
        </button>
      </nav>

      {tab === "presupuestos" ? (
        <PresupuestosPanel
          addRequestKey={addPresupuestoKey}
          profesionales={profesionalesPresupuesto}
          onProfesionalesChange={setProfesionalesPresupuesto}
        />
      ) : null}
      {tab === "prestaciones" ? (
        <PrestacionesPanel addRequestKey={addPrestacionKey} tiposPrestacion={tiposPrestacion} />
      ) : null}
      {tab === "plantillaEmail" ? <PresupuestoEmailConfigPanel /> : null}
      {tab === "plantillaPresupuesto" ? <PresupuestoPlantillaPanel /> : null}
      {tab === "config" ? (
        <PresupuestosConfigPanel
          onSaved={() => {
            void cargarConfig();
          }}
        />
      ) : null}
    </div>
  );
}
