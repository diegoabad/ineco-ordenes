import deployDb from "./data/db.json";
import { buildDeployDb, buildSeedMedicos, buildSeedPacientes, defaultMedicoId } from "./data/buildSeed";
import { lookupDiagnostico } from "./data/pacienteDiagnostico";
import type { Medico, Paciente } from "./types";

const PACIENTES_KEY = "ordenes-ineco:pacientes";
const LEGACY_RECETAS_KEY = "ordenes-ineco:recetas";
const MEDICOS_KEY = "ordenes-ineco:medicos";
const MEDICO_SELECCIONADO_KEY = "ordenes-ineco:medico-seleccionado";
const LEGACY_MEDICO_KEY = "ordenes-ineco:medico";
const LOCAL_VERSION_KEY = "ordenes-ineco:db-version";

export type AppDb = {
  version: number;
  medicoSeleccionadoId: string | null;
  medicos: Medico[];
  pacientes: Paciente[];
};

function normalizePaciente(raw: Record<string, unknown>): Paciente | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : crypto.randomUUID();
  const medicoId =
    typeof raw.medicoId === "string" && raw.medicoId.trim() ? raw.medicoId.trim() : null;
  const paciente = String(raw.paciente ?? "");
  const diagnosticoRaw = String(raw.diagnostico ?? "").trim();
  const diagnostico = diagnosticoRaw || lookupDiagnostico(paciente);
  return {
    id,
    paciente,
    obraSocial: String(raw.obraSocial ?? ""),
    afiliado: String(raw.afiliado ?? ""),
    prestacion: String(raw.prestacion ?? ""),
    diagnostico,
    medicoId,
  };
}

function normalizeMedico(raw: Record<string, unknown>): Medico | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : crypto.randomUUID();
  return {
    id,
    nombre: String(raw.nombre ?? ""),
    especialidad: String(raw.especialidad ?? ""),
    matricula: String(raw.matricula ?? "").replace(/^MN\s*/i, "").trim(),
    firmaDataUrl:
      typeof raw.firmaDataUrl === "string" && raw.firmaDataUrl
        ? raw.firmaDataUrl
        : null,
  };
}

/** Datos embebidos en el deploy (`src/data/db.json`). */
export function getDeployDb(): AppDb {
  const raw = deployDb as {
    version?: number;
    medicoSeleccionadoId?: string | null;
    medicos?: unknown[];
    pacientes?: unknown[];
  };

  const medicos = Array.isArray(raw.medicos)
    ? raw.medicos
        .map((item) => normalizeMedico(item as Record<string, unknown>))
        .filter((m): m is Medico => m !== null)
    : buildSeedMedicos();

  const pacientes = Array.isArray(raw.pacientes)
    ? raw.pacientes
        .map((item) => normalizePaciente(item as Record<string, unknown>))
        .filter((p): p is Paciente => p !== null)
    : buildSeedPacientes(medicos);

  const medicoSeleccionadoId =
    typeof raw.medicoSeleccionadoId === "string" &&
    medicos.some((m) => m.id === raw.medicoSeleccionadoId)
      ? raw.medicoSeleccionadoId
      : defaultMedicoId(medicos);

  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    medicoSeleccionadoId,
    medicos,
    pacientes,
  };
}

function clearLegacyKeys() {
  localStorage.removeItem(LEGACY_RECETAS_KEY);
  localStorage.removeItem(LEGACY_MEDICO_KEY);
  localStorage.removeItem("ordenes-ineco:seed-v1");
  localStorage.removeItem("ordenes-ineco:medicos-seed-v2");
  localStorage.removeItem("ordenes-ineco:pacientes-medico-v1");
}

/** Escribe el DB de deploy en localStorage (estado editable local). */
export function hydrateFromDeployDb(): AppDb {
  const db = getDeployDb();
  savePacientes(db.pacientes);
  saveMedicos(db.medicos);
  saveMedicoSeleccionadoId(db.medicoSeleccionadoId);
  localStorage.setItem(LOCAL_VERSION_KEY, String(db.version));
  clearLegacyKeys();
  return db;
}

function localDbVersion(): number | null {
  const v = localStorage.getItem(LOCAL_VERSION_KEY);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Si no hay datos locales o el deploy es más nuevo, hidrata desde db.json. */
function ensureLocalDb(): AppDb {
  const deploy = getDeployDb();
  const localVersion = localDbVersion();
  const hasLocal =
    Boolean(localStorage.getItem(PACIENTES_KEY) || localStorage.getItem(MEDICOS_KEY)) &&
    localVersion !== null;

  if (!hasLocal || (localVersion !== null && localVersion < deploy.version)) {
    return hydrateFromDeployDb();
  }
  return {
    version: localVersion ?? deploy.version,
    pacientes: loadPacientesRaw(),
    medicos: loadMedicosRaw(),
    medicoSeleccionadoId: loadMedicoSeleccionadoIdRaw(loadMedicosRaw()),
  };
}

function loadPacientesRaw(): Paciente[] {
  try {
    const raw = localStorage.getItem(PACIENTES_KEY) ?? localStorage.getItem(LEGACY_RECETAS_KEY);
    if (!raw) return getDeployDb().pacientes;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return getDeployDb().pacientes;
    return parsed
      .map((item) => normalizePaciente(item as Record<string, unknown>))
      .filter((p): p is Paciente => p !== null);
  } catch {
    return getDeployDb().pacientes;
  }
}

function loadMedicosRaw(): Medico[] {
  try {
    const raw = localStorage.getItem(MEDICOS_KEY);
    if (!raw) return getDeployDb().medicos;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return getDeployDb().medicos;
    return parsed
      .map((item) => normalizeMedico(item as Record<string, unknown>))
      .filter((m): m is Medico => m !== null);
  } catch {
    return getDeployDb().medicos;
  }
}

function loadMedicoSeleccionadoIdRaw(medicos: Medico[]): string | null {
  try {
    const saved = localStorage.getItem(MEDICO_SELECCIONADO_KEY);
    if (saved && medicos.some((m) => m.id === saved)) return saved;
    return defaultMedicoId(medicos);
  } catch {
    return defaultMedicoId(medicos);
  }
}

export function loadPacientes(): Paciente[] {
  return ensureLocalDb().pacientes;
}

export function loadMedicos(): Medico[] {
  return ensureLocalDb().medicos;
}

export function loadMedicoSeleccionadoId(medicos: Medico[]): string | null {
  ensureLocalDb();
  return loadMedicoSeleccionadoIdRaw(medicos);
}

export function savePacientes(pacientes: Paciente[]) {
  localStorage.setItem(PACIENTES_KEY, JSON.stringify(pacientes));
}

export function saveMedicos(medicos: Medico[]) {
  localStorage.setItem(MEDICOS_KEY, JSON.stringify(medicos));
}

export function saveMedicoSeleccionadoId(id: string | null) {
  if (!id) {
    localStorage.removeItem(MEDICO_SELECCIONADO_KEY);
    return;
  }
  localStorage.setItem(MEDICO_SELECCIONADO_KEY, id);
}

export function newId() {
  return crypto.randomUUID();
}

export { buildDeployDb, buildSeedMedicos, buildSeedPacientes };
