import { lookupDiagnostico } from "./pacienteDiagnostico";
import { MEDICOS_SEED } from "./medicosSeed";
import {
  isSinMedicoRef,
  lookupMedicoRef,
  normalizeNombreKey,
} from "./pacienteMedicoAsignacion";
import { PACIENTES_SEED } from "./pacientesSeed";
import type { Medico, Paciente } from "../types";
import { DEFAULT_MEDICO } from "../types";

/** Resuelve apellido / clave de la planilla → id de médico. */
export function resolveMedicoIdByRef(
  ref: string | null | undefined,
  medicos: Medico[],
): string | null {
  if (isSinMedicoRef(ref)) return null;
  const key = normalizeNombreKey(ref!).replace(/\?+$/g, "").trim();
  if (!key) return null;

  const match = medicos.find((m) => {
    const nombre = normalizeNombreKey(m.nombre);
    if (nombre.includes(key)) return true;
    const parts = nombre.split(" ");
    if (parts[parts.length - 1] === key) return true;
    if (parts.length >= 2 && parts.slice(-2).join(" ") === key) return true;
    return false;
  });
  return match?.id ?? null;
}

function medicoIdParaPacienteNombre(nombre: string, medicos: Medico[]): string | null {
  const ref = lookupMedicoRef(nombre);
  if (ref === undefined) return null;
  return resolveMedicoIdByRef(ref, medicos);
}

export function buildSeedMedicos(): Medico[] {
  return MEDICOS_SEED.map((m, i) => ({
    ...m,
    id: `medico-seed-${String(i + 1).padStart(3, "0")}`,
  }));
}

export function buildSeedPacientes(medicos: Medico[] = buildSeedMedicos()): Paciente[] {
  return PACIENTES_SEED.map((p, i) => ({
    ...p,
    diagnostico: lookupDiagnostico(p.paciente),
    medicoId: medicoIdParaPacienteNombre(p.paciente, medicos),
    id: `seed-${String(i + 1).padStart(3, "0")}`,
  }));
}

export function defaultMedicoId(medicos: Medico[]): string | null {
  return medicos.find((m) => m.matricula === DEFAULT_MEDICO.matricula)?.id ?? medicos[0]?.id ?? null;
}

export function buildDeployDb() {
  const medicos = buildSeedMedicos();
  const pacientes = buildSeedPacientes(medicos);
  return {
    version: 2 as const,
    medicoSeleccionadoId: defaultMedicoId(medicos),
    medicos,
    pacientes,
  };
}
