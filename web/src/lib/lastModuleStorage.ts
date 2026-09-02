import type { AppModuleId } from "../auth/AuthContext";

const STORAGE_KEY = "ineco-ordenes.lastModuleByUser";

const VALID_MODULES = new Set<AppModuleId>([
  "ordenes",
  "presupuestos",
  "pami",
  "busca-turno",
  "pedidos-sistema",
  "usuarios",
]);

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

export function loadLastModule(userId: string): AppModuleId | null {
  if (!userId) return null;
  const value = readMap()[userId];
  if (typeof value !== "string") return null;
  return VALID_MODULES.has(value as AppModuleId) ? (value as AppModuleId) : null;
}

export function saveLastModule(userId: string, module: AppModuleId): void {
  if (!userId) return;
  try {
    const map = readMap();
    map[userId] = module;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}
