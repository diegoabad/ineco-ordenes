import type { AppModuleId } from "../auth/AuthContext";

export type OrdenesSection = "pacientes" | "medicos" | "historial" | "config";
export type PresupuestosSection =
  | "presupuestos"
  | "prestaciones"
  | "metricas"
  | "plantillaPresupuesto"
  | "plantillaEmail"
  | "config";
export type PamiSection = "historial" | "analisis";
export type BuscaTurnoSection = "turnos" | "config";

export type AccordionModuleId = "ordenes" | "presupuestos" | "pami" | "busca-turno";

export type AppSection =
  | OrdenesSection
  | PresupuestosSection
  | PamiSection
  | BuscaTurnoSection;

export type AppNavTarget =
  | { module: "ordenes"; section: OrdenesSection }
  | { module: "presupuestos"; section: PresupuestosSection }
  | { module: "pami"; section: PamiSection }
  | { module: "busca-turno"; section: BuscaTurnoSection }
  | { module: "pedidos-sistema" | "usuarios"; section?: undefined };

export const ORDENES_SECTIONS: { id: OrdenesSection; label: string }[] = [
  { id: "pacientes", label: "Pacientes" },
  { id: "medicos", label: "Profesionales" },
  { id: "historial", label: "Historial" },
  { id: "config", label: "Plantilla email" },
];

export const PRESUPUESTOS_SECTIONS: { id: PresupuestosSection; label: string }[] = [
  { id: "presupuestos", label: "Listado" },
  { id: "metricas", label: "Métricas" },
  { id: "prestaciones", label: "Prestaciones" },
  { id: "plantillaPresupuesto", label: "Plantilla presupuesto" },
  { id: "plantillaEmail", label: "Plantilla email" },
  { id: "config", label: "Configuración" },
];

export const PAMI_SECTIONS: { id: PamiSection; label: string }[] = [
  { id: "historial", label: "Historial" },
  { id: "analisis", label: "Análisis" },
];

export const BUSCA_TURNO_SECTIONS: { id: BuscaTurnoSection; label: string }[] = [
  { id: "turnos", label: "Turnos" },
  { id: "config", label: "Configuración" },
];

export function isAccordionModule(module: AppModuleId): module is AccordionModuleId {
  return (
    module === "ordenes" ||
    module === "presupuestos" ||
    module === "pami" ||
    module === "busca-turno"
  );
}
