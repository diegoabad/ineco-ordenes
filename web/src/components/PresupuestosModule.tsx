import { useCallback, useEffect, useState } from "react";
import type { PresupuestosSection } from "../lib/appNav";
import { PRESUPUESTOS_SECTIONS } from "../lib/appNav";
import { mergeMissingDefaultTipos } from "../lib/tipoPrestacion";
import { fetchPresupuestosConfig, savePresupuestosConfig } from "../services/dataService";
import {
  DEFAULT_TIPOS_PRESTACION,
  type ModalidadPresupuesto,
  type ProfesionalPresupuesto,
  type TipoPrestacion,
} from "../types";
import { IconPlus } from "./Icons";
import { PresupuestoEmailConfigPanel } from "./PresupuestoEmailConfigPanel";
import { PresupuestoPlantillaPanel } from "./PresupuestoPlantillaPanel";
import { PresupuestosConfigPanel } from "./PresupuestosConfigPanel";
import { PresupuestosMetricasPanel } from "./PresupuestosMetricasPanel";
import { PresupuestosPanel } from "./PresupuestosPanel";
import { PrestacionesPanel } from "./PrestacionesPanel";

type Props = {
  section: PresupuestosSection;
  onSectionChange: (section: PresupuestosSection) => void;
};

export function PresupuestosModule({ section, onSectionChange }: Props) {
  const [addPrestacionKey, setAddPrestacionKey] = useState(0);
  const [addPresupuestoKey, setAddPresupuestoKey] = useState(0);
  const [tiposPrestacion, setTiposPrestacion] = useState<TipoPrestacion[]>(
    DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t })),
  );
  const [profesionalesPresupuesto, setProfesionalesPresupuesto] = useState<ProfesionalPresupuesto[]>(
    [],
  );
  const [modalidadesPresupuesto, setModalidadesPresupuesto] = useState<ModalidadPresupuesto[]>([]);

  const cargarConfig = useCallback(async () => {
    try {
      const config = await fetchPresupuestosConfig();
      const { tipos: tiposMerged, changed } = mergeMissingDefaultTipos(config.tiposPrestacion);
      if (changed) {
        const saved = await savePresupuestosConfig({
          tiposPrestacion: tiposMerged,
          profesionales: config.profesionales,
          modalidades: config.modalidades,
        });
        setTiposPrestacion(saved.tiposPrestacion);
        setProfesionalesPresupuesto(saved.profesionales);
        setModalidadesPresupuesto(saved.modalidades);
      } else {
        setTiposPrestacion(config.tiposPrestacion);
        setProfesionalesPresupuesto(config.profesionales);
        setModalidadesPresupuesto(config.modalidades);
      }
    } catch {
      setTiposPrestacion(DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t })));
      setProfesionalesPresupuesto([]);
      setModalidadesPresupuesto([]);
    }
  }, []);

  useEffect(() => {
    void cargarConfig();
  }, [cargarConfig]);

  useEffect(() => {
    if (section !== "prestaciones") setAddPrestacionKey(0);
    if (section !== "presupuestos") setAddPresupuestoKey(0);
  }, [section]);

  function handleCrearPresupuesto() {
    onSectionChange("presupuestos");
    setAddPresupuestoKey((k) => k + 1);
  }

  const sectionLabel =
    PRESUPUESTOS_SECTIONS.find((s) => s.id === section)?.label ?? "Presupuestos";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div>
            <h1>{sectionLabel}</h1>
            <p>
              {section === "metricas"
                ? "Control visual de envíos, estados, profesionales y prestaciones"
                : "Prestaciones y armado de presupuestos"}
            </p>
          </div>
        </div>
        <div className="app-header__actions">
          {section === "prestaciones" ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAddPrestacionKey((k) => k + 1)}
            >
              <IconPlus size={16} />
              Agregar prestación
            </button>
          ) : null}
          {section !== "metricas" ? (
            <button type="button" className="btn btn-primary" onClick={handleCrearPresupuesto}>
              <IconPlus size={16} />
              Crear presupuesto
            </button>
          ) : null}
        </div>
      </header>

      {section === "presupuestos" ? (
        <PresupuestosPanel
          addRequestKey={addPresupuestoKey}
          profesionales={profesionalesPresupuesto}
          onProfesionalesChange={setProfesionalesPresupuesto}
          modalidades={modalidadesPresupuesto}
        />
      ) : null}
      {section === "prestaciones" ? (
        <PrestacionesPanel addRequestKey={addPrestacionKey} tiposPrestacion={tiposPrestacion} />
      ) : null}
      {section === "metricas" ? <PresupuestosMetricasPanel /> : null}
      {section === "plantillaEmail" ? <PresupuestoEmailConfigPanel /> : null}
      {section === "plantillaPresupuesto" ? <PresupuestoPlantillaPanel /> : null}
      {section === "config" ? (
        <PresupuestosConfigPanel
          onSaved={() => {
            void cargarConfig();
          }}
        />
      ) : null}
    </div>
  );
}
