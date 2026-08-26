import { randomUUID } from "node:crypto";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import type { AppDb, Medico, MedicoInput, Paciente, PacienteInput } from "../types.js";

const MEDICOS = "ordenes_medicos";
const PACIENTES = "ordenes_pacientes";
const CONFIG = "ordenes_config";
const CONFIG_DOC = "main";

type ConfigDoc = {
  version: number;
  medicoSeleccionadoId: string | null;
};

function normalizePaciente(id: string, raw: Record<string, unknown>): Paciente {
  const medicoId =
    typeof raw.medicoId === "string" && raw.medicoId.trim() ? raw.medicoId.trim() : null;

  return {
    id,
    paciente: String(raw.paciente ?? ""),
    obraSocial: String(raw.obraSocial ?? ""),
    afiliado: String(raw.afiliado ?? ""),
    prestacion: String(raw.prestacion ?? ""),
    diagnostico: String(raw.diagnostico ?? ""),
    medicoId,
  };
}

function normalizeMedico(id: string, raw: Record<string, unknown>): Medico {
  const firmaUrl =
    typeof raw.firmaUrl === "string" && raw.firmaUrl.trim() ? raw.firmaUrl.trim() : null;

  return {
    id,
    nombre: String(raw.nombre ?? ""),
    especialidad: String(raw.especialidad ?? ""),
    matricula: String(raw.matricula ?? "").replace(/^MN\s*/i, "").trim(),
    firmaUrl,
  };
}

function medicoPayload(medico: Medico): Omit<Medico, "id"> {
  return {
    nombre: medico.nombre,
    especialidad: medico.especialidad,
    matricula: medico.matricula,
    firmaUrl: medico.firmaUrl,
  };
}

function pacientePayload(paciente: Paciente): Omit<Paciente, "id"> {
  return {
    paciente: paciente.paciente,
    obraSocial: paciente.obraSocial,
    afiliado: paciente.afiliado,
    prestacion: paciente.prestacion,
    diagnostico: paciente.diagnostico,
    medicoId: paciente.medicoId,
  };
}

function defaultMedicoId(medicos: Medico[]): string | null {
  return medicos[0]?.id ?? null;
}

async function getConfigDoc(): Promise<ConfigDoc> {
  const snap = await getDoc(doc(firestore, CONFIG, CONFIG_DOC));
  if (!snap.exists()) {
    return { version: 1, medicoSeleccionadoId: null };
  }
  const data = snap.data();
  return {
    version: typeof data.version === "number" ? data.version : 1,
    medicoSeleccionadoId:
      typeof data.medicoSeleccionadoId === "string" ? data.medicoSeleccionadoId : null,
  };
}

async function saveConfigDoc(config: ConfigDoc): Promise<void> {
  await setDoc(doc(firestore, CONFIG, CONFIG_DOC), config, { merge: true });
}

export async function listMedicos(): Promise<Medico[]> {
  const snap = await getDocs(query(collection(firestore, MEDICOS), orderBy("nombre", "asc")));
  return snap.docs.map((d) => normalizeMedico(d.id, d.data() as Record<string, unknown>));
}

export async function listPacientes(): Promise<Paciente[]> {
  const snap = await getDocs(query(collection(firestore, PACIENTES), orderBy("paciente", "asc")));
  return snap.docs.map((d) => normalizePaciente(d.id, d.data() as Record<string, unknown>));
}

export async function getMedicoById(id: string): Promise<Medico | null> {
  const snap = await getDoc(doc(firestore, MEDICOS, id));
  if (!snap.exists()) return null;
  return normalizeMedico(snap.id, snap.data() as Record<string, unknown>);
}

export async function getDb(): Promise<AppDb> {
  const [medicos, pacientes, config] = await Promise.all([
    listMedicos(),
    listPacientes(),
    getConfigDoc(),
  ]);

  const medicoSeleccionadoId =
    config.medicoSeleccionadoId &&
    medicos.some((m) => m.id === config.medicoSeleccionadoId)
      ? config.medicoSeleccionadoId
      : defaultMedicoId(medicos);

  return {
    version: config.version,
    medicoSeleccionadoId,
    medicos,
    pacientes,
  };
}

export async function setMedicoSeleccionadoId(medicoSeleccionadoId: string | null): Promise<AppDb> {
  if (medicoSeleccionadoId) {
    const medico = await getMedicoById(medicoSeleccionadoId);
    if (!medico) throw new Error("Médico no encontrado");
  }

  const config = await getConfigDoc();
  await saveConfigDoc({ ...config, medicoSeleccionadoId });
  return getDb();
}

export async function createPaciente(input: PacienteInput): Promise<Paciente> {
  const id = randomUUID();
  const paciente: Paciente = { ...input, id };
  await setDoc(doc(firestore, PACIENTES, id), pacientePayload(paciente));
  return paciente;
}

export async function updatePaciente(id: string, input: PacienteInput): Promise<Paciente> {
  const existing = await getDoc(doc(firestore, PACIENTES, id));
  if (!existing.exists()) throw new Error("Paciente no encontrado");

  const paciente: Paciente = { ...input, id };
  await setDoc(doc(firestore, PACIENTES, id), pacientePayload(paciente));
  return paciente;
}

export async function deletePaciente(id: string): Promise<void> {
  const existing = await getDoc(doc(firestore, PACIENTES, id));
  if (!existing.exists()) throw new Error("Paciente no encontrado");
  await deleteDoc(doc(firestore, PACIENTES, id));
}

export async function createMedico(input: MedicoInput): Promise<Medico> {
  const id = randomUUID();
  const medico: Medico = { ...input, id, firmaUrl: null };
  await setDoc(doc(firestore, MEDICOS, id), medicoPayload(medico));

  const config = await getConfigDoc();
  if (!config.medicoSeleccionadoId) {
    await saveConfigDoc({ ...config, medicoSeleccionadoId: id });
  }

  return medico;
}

export async function updateMedico(id: string, input: MedicoInput): Promise<Medico> {
  const existing = await getDoc(doc(firestore, MEDICOS, id));
  if (!existing.exists()) throw new Error("Médico no encontrado");

  const current = normalizeMedico(id, existing.data() as Record<string, unknown>);
  const medico: Medico = { ...current, ...input, id };
  await setDoc(doc(firestore, MEDICOS, id), medicoPayload(medico));
  return medico;
}

export async function setMedicoFirmaUrl(id: string, firmaUrl: string | null): Promise<Medico> {
  const existing = await getDoc(doc(firestore, MEDICOS, id));
  if (!existing.exists()) throw new Error("Médico no encontrado");

  const medico = normalizeMedico(id, existing.data() as Record<string, unknown>);
  medico.firmaUrl = firmaUrl;
  await setDoc(doc(firestore, MEDICOS, id), medicoPayload(medico), { merge: true });
  return medico;
}

export async function deleteMedico(id: string): Promise<Medico> {
  const existing = await getDoc(doc(firestore, MEDICOS, id));
  if (!existing.exists()) throw new Error("Médico no encontrado");

  const medico = normalizeMedico(id, existing.data() as Record<string, unknown>);
  await deleteDoc(doc(firestore, MEDICOS, id));

  const pacientes = await listPacientes();
  const afectados = pacientes.filter((p) => p.medicoId === id);
  if (afectados.length > 0) {
    const batch = writeBatch(firestore);
    for (const paciente of afectados) {
      batch.set(
        doc(firestore, PACIENTES, paciente.id),
        pacientePayload({ ...paciente, medicoId: null }),
        { merge: true },
      );
    }
    await batch.commit();
  }

  const config = await getConfigDoc();
  if (config.medicoSeleccionadoId === id) {
    const medicos = await listMedicos();
    await saveConfigDoc({
      ...config,
      medicoSeleccionadoId: defaultMedicoId(medicos),
    });
  }

  return medico;
}
