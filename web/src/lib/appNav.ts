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
export type GestionProfesionalSection =
  | "cuadro"
  | "profesionales"
  | "tratamientos"
  | "departamentos"
  | "categorias";
export type WhatsappSection =
  | "conversaciones"
  | "metricas"
  | "prueba"
  | "prueba-bot"
  | "flujos-bot"
  | "contactos"
  | "operadoras"
  | "etiquetas"
  | "respuestas-rapidas"
  | "config"
  | "motor"
  | "intenciones"
  | "conocimiento";

export type AccordionModuleId =
  | "ordenes"
  | "presupuestos"
  | "pami"
  | "busca-turno"
  | "gestion-profesional"
  | "whatsapp";

export type AppSection =
  | OrdenesSection
  | PresupuestosSection
  | PamiSection
  | BuscaTurnoSection
  | GestionProfesionalSection
  | WhatsappSection;

export type AppNavTarget =
  | { module: "inicio" | "pedidos-sistema" | "usuarios"; section?: undefined }
  | { module: "ordenes"; section: OrdenesSection }
  | { module: "presupuestos"; section: PresupuestosSection }
  | { module: "pami"; section: PamiSection }
  | { module: "busca-turno"; section: BuscaTurnoSection }
  | { module: "gestion-profesional"; section: GestionProfesionalSection }
  | { module: "whatsapp"; section: WhatsappSection };

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

export const GESTION_PROFESIONAL_SECTIONS: { id: GestionProfesionalSection; label: string }[] = [
  { id: "cuadro", label: "Cuadro" },
  { id: "profesionales", label: "Profesionales" },
  { id: "tratamientos", label: "Tratamientos" },
  { id: "departamentos", label: "Departamentos" },
  { id: "categorias", label: "Categorías" },
];

export const WHATSAPP_SECTIONS: { id: WhatsappSection; label: string }[] = [
  { id: "conversaciones", label: "Conversaciones" },
  { id: "metricas", label: "Métricas" },
  { id: "prueba", label: "Prueba IA" },
  { id: "prueba-bot", label: "Prueba bot" },
  { id: "flujos-bot", label: "Flujos bot" },
  { id: "contactos", label: "Contactos" },
  { id: "operadoras", label: "Operadoras" },
  { id: "etiquetas", label: "Etiquetas" },
  { id: "respuestas-rapidas", label: "Respuestas rápidas" },
  { id: "config", label: "Bot" },
  { id: "motor", label: "Motor" },
  { id: "intenciones", label: "Intenciones" },
  { id: "conocimiento", label: "Conocimiento" },
];

export function isAccordionModule(module: AppModuleId): module is AccordionModuleId {
  return (
    module === "ordenes" ||
    module === "presupuestos" ||
    module === "pami" ||
    module === "busca-turno" ||
    module === "gestion-profesional" ||
    module === "whatsapp"
  );
}
