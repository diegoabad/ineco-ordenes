import type { AppModuleId } from "../auth/AuthContext";
import {
  BUSCA_TURNO_SECTIONS,
  ORDENES_SECTIONS,
  PAMI_SECTIONS,
  PRESUPUESTOS_SECTIONS,
  isAccordionModule,
  type AppSection,
  type BuscaTurnoSection,
  type OrdenesSection,
  type PamiSection,
  type PresupuestosSection,
} from "./appNav";

const STORAGE_KEY = "ineco-ordenes.lastNavByUser";
/** Compat con la clave anterior (solo módulo). */
const LEGACY_STORAGE_KEY = "ineco-ordenes.lastModuleByUser";

const VALID_MODULES = new Set<AppModuleId>([
  "ordenes",
  "presupuestos",
  "pami",
  "busca-turno",
  "pedidos-sistema",
  "usuarios",
]);

const ORDENES_IDS = new Set(ORDENES_SECTIONS.map((s) => s.id));
const PRESUPUESTOS_IDS = new Set(PRESUPUESTOS_SECTIONS.map((s) => s.id));
const PAMI_IDS = new Set(PAMI_SECTIONS.map((s) => s.id));
const BUSCA_TURNO_IDS = new Set(BUSCA_TURNO_SECTIONS.map((s) => s.id));

export type LastNav = {
  module: AppModuleId;
  section?: AppSection;
};

function isValidModule(value: unknown): value is AppModuleId {
  return typeof value === "string" && VALID_MODULES.has(value as AppModuleId);
}

function normalizeSection(module: AppModuleId, section: unknown): AppSection | undefined {
  if (typeof section !== "string") return undefined;
  if (module === "ordenes" && ORDENES_IDS.has(section as OrdenesSection)) {
    return section as OrdenesSection;
  }
  if (module === "presupuestos" && PRESUPUESTOS_IDS.has(section as PresupuestosSection)) {
    return section as PresupuestosSection;
  }
  if (module === "pami" && PAMI_IDS.has(section as PamiSection)) {
    return section as PamiSection;
  }
  if (module === "busca-turno" && BUSCA_TURNO_IDS.has(section as BuscaTurnoSection)) {
    return section as BuscaTurnoSection;
  }
  return undefined;
}

function parseNav(value: unknown): LastNav | null {
  if (typeof value === "string" && isValidModule(value)) {
    return { module: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { module?: unknown; section?: unknown };
  if (!isValidModule(raw.module)) return null;
  const section = normalizeSection(raw.module, raw.section);
  return section ? { module: raw.module, section } : { module: raw.module };
}

function readMap(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    // ignore
  }

  // Migrar mapa legacy (módulo como string).
  try {
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return {};
    const parsed = JSON.parse(legacy) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function loadLastNav(userId: string): LastNav | null {
  if (!userId) return null;
  return parseNav(readMap()[userId]);
}

/** @deprecated usar loadLastNav */
export function loadLastModule(userId: string): AppModuleId | null {
  return loadLastNav(userId)?.module ?? null;
}

export function saveLastNav(userId: string, nav: LastNav): void {
  if (!userId || !isValidModule(nav.module)) return;
  try {
    const map = readMap();
    const section =
      isAccordionModule(nav.module) && nav.section
        ? normalizeSection(nav.module, nav.section)
        : undefined;
    map[userId] = section ? { module: nav.module, section } : { module: nav.module };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

/** @deprecated usar saveLastNav */
export function saveLastModule(userId: string, module: AppModuleId): void {
  saveLastNav(userId, { module });
}
