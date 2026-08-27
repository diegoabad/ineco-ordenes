import { randomUUID } from "node:crypto";
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  where,
  writeBatch,
  type QueryConstraint,
} from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import type { AppDb, Medico, MedicoInput, Paciente, PacienteInput, EmailEnvio, EmailEnvioInput } from "../types.js";
import {
  emailConfigWithEnvDefaults,
  type EmailConfig,
} from "./email-templates.js";
import { deleteEnvioPdfFile } from "./envio-pdf.service.js";

const MEDICOS = "ordenes_medicos";
const PACIENTES = "ordenes_pacientes";
const EMAIL_ENVIOS = "ordenes_email_envios";
const CONFIG = "ordenes_config";
const CONFIG_DOC = "main";
const EMAIL_CONFIG_DOC = "email";

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
    email: String(raw.email ?? "").trim(),
    obraSocial: String(raw.obraSocial ?? ""),
    afiliado: String(raw.afiliado ?? ""),
    prestacion: String(raw.prestacion ?? ""),
    diagnostico: String(raw.diagnostico ?? ""),
    medicoId,
    // Registros viejos sin campo = activos
    activo: raw.activo !== false,
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
    activo: raw.activo !== false,
  };
}

function medicoPayload(medico: Medico): Omit<Medico, "id"> {
  return {
    nombre: medico.nombre,
    especialidad: medico.especialidad,
    matricula: medico.matricula,
    firmaUrl: medico.firmaUrl,
    activo: medico.activo,
  };
}

function pacientePayload(paciente: Paciente): Omit<Paciente, "id"> {
  return {
    paciente: paciente.paciente,
    email: paciente.email,
    obraSocial: paciente.obraSocial,
    afiliado: paciente.afiliado,
    prestacion: paciente.prestacion,
    diagnostico: paciente.diagnostico,
    medicoId: paciente.medicoId,
    activo: paciente.activo,
  };
}

function defaultMedicoId(medicos: Medico[]): string | null {
  return medicos.find((m) => m.activo)?.id ?? null;
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

export async function getPacienteById(id: string): Promise<Paciente | null> {
  const snap = await getDoc(doc(firestore, PACIENTES, id));
  if (!snap.exists()) return null;
  return normalizePaciente(snap.id, snap.data() as Record<string, unknown>);
}

function normalizeEmailEnvio(id: string, raw: Record<string, unknown>): EmailEnvio {
  const medicoId =
    typeof raw.medicoId === "string" && raw.medicoId.trim() ? raw.medicoId.trim() : null;
  const errorMessage =
    typeof raw.errorMessage === "string" && raw.errorMessage.trim()
      ? raw.errorMessage.trim()
      : null;
  const pdfUrl =
    typeof raw.pdfUrl === "string" && raw.pdfUrl.trim() ? raw.pdfUrl.trim() : null;

  return {
    id,
    pacienteId: String(raw.pacienteId ?? ""),
    pacienteNombre: String(raw.pacienteNombre ?? ""),
    toEmail: String(raw.toEmail ?? "").trim(),
    medicoId,
    medicoNombre: String(raw.medicoNombre ?? ""),
    fechaOrden: String(raw.fechaOrden ?? ""),
    filename: String(raw.filename ?? ""),
    pdfUrl,
    subject: String(raw.subject ?? ""),
    status: raw.status === "error" ? "error" : "ok",
    errorMessage,
    enviadoAt: String(raw.enviadoAt ?? ""),
  };
}

function emailEnvioPayload(envio: EmailEnvio): EmailEnvioInput {
  const { id: _id, ...rest } = envio;
  return rest;
}

export type ListEmailEnviosParams = {
  page?: number;
  pageSize?: number;
  /** YYYY-MM; vacío / null = todos */
  mes?: string | null;
  q?: string | null;
};

export type ListEmailEnviosResult = {
  data: EmailEnvio[];
  total: number;
  page: number;
  pageSize: number;
};

function mesBoundsIso(ym: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const start = new Date(y, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, month, 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function matchesEmailEnvioQuery(envio: EmailEnvio, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [envio.pacienteNombre, envio.toEmail, envio.status, envio.errorMessage ?? "", envio.fechaOrden]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export async function listEmailEnvios(
  params: ListEmailEnviosParams = {},
): Promise<ListEmailEnviosResult> {
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
  let page = Math.max(1, Math.floor(Number(params.page) || 1));
  const qText = typeof params.q === "string" ? params.q.trim() : "";
  const mesRaw = typeof params.mes === "string" ? params.mes.trim() : "";
  const mes = /^\d{4}-\d{2}$/.test(mesRaw) ? mesRaw : null;

  const col = collection(firestore, EMAIL_ENVIOS);
  const constraints: QueryConstraint[] = [];
  if (mes) {
    const bounds = mesBoundsIso(mes);
    if (bounds) {
      constraints.push(where("enviadoAt", ">=", bounds.start));
      constraints.push(where("enviadoAt", "<", bounds.end));
    }
  }
  constraints.push(orderBy("enviadoAt", "desc"));

  // Con búsqueda de texto no hay índice full-text: filtramos en memoria (acotado por mes si aplica).
  if (qText) {
    const snap = await getDocs(query(col, ...constraints));
    const all = snap.docs
      .map((d) => normalizeEmailEnvio(d.id, d.data() as Record<string, unknown>))
      .filter((e) => matchesEmailEnvioQuery(e, qText));
    const total = all.length;
    const maxPage = Math.max(1, Math.ceil(total / pageSize) || 1);
    if (page > maxPage) page = maxPage;
    const startIdx = (page - 1) * pageSize;
    return {
      data: all.slice(startIdx, startIdx + pageSize),
      total,
      page,
      pageSize,
    };
  }

  const countSnap = await getCountFromServer(query(col, ...constraints));
  const total = countSnap.data().count;
  if (total === 0) {
    return { data: [], total: 0, page: 1, pageSize };
  }

  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  if (page > maxPage) page = maxPage;
  const skip = (page - 1) * pageSize;

  let snap;
  if (skip === 0) {
    snap = await getDocs(query(col, ...constraints, limit(pageSize)));
  } else {
    const skipSnap = await getDocs(query(col, ...constraints, limit(skip)));
    const last = skipSnap.docs.at(-1);
    if (!last) {
      return { data: [], total, page, pageSize };
    }
    snap = await getDocs(query(col, ...constraints, startAfter(last), limit(pageSize)));
  }

  return {
    data: snap.docs.map((d) => normalizeEmailEnvio(d.id, d.data() as Record<string, unknown>)),
    total,
    page,
    pageSize,
  };
}

export async function createEmailEnvio(
  input: EmailEnvioInput,
  opts?: { id?: string },
): Promise<EmailEnvio> {
  const id = opts?.id?.trim() || randomUUID();
  const envio: EmailEnvio = { ...input, id };
  await setDoc(doc(firestore, EMAIL_ENVIOS, id), emailEnvioPayload(envio));
  return envio;
}

export async function deleteEmailEnvio(id: string): Promise<void> {
  const ref = doc(firestore, EMAIL_ENVIOS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Registro de envío no encontrado");
  await deleteDoc(ref);
  await deleteEnvioPdfFile(id);
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const snap = await getDoc(doc(firestore, CONFIG, EMAIL_CONFIG_DOC));
  if (!snap.exists()) {
    return emailConfigWithEnvDefaults(null);
  }
  const data = snap.data() as Record<string, unknown>;
  return emailConfigWithEnvDefaults({
    fromEmail: typeof data.fromEmail === "string" ? data.fromEmail : undefined,
    fromName: typeof data.fromName === "string" ? data.fromName : undefined,
    subject: typeof data.subject === "string" ? data.subject : undefined,
    body: typeof data.body === "string" ? data.body : undefined,
  });
}

export async function saveEmailConfig(input: EmailConfig): Promise<EmailConfig> {
  const fromEmail = input.fromEmail.trim();
  const fromName = input.fromName.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();

  if (!fromEmail) throw new Error("El email remitente es obligatorio");
  if (!fromName) throw new Error("El nombre remitente es obligatorio");
  if (!subject) throw new Error("El asunto es obligatorio");
  if (!body) throw new Error("El cuerpo del mail es obligatorio");

  const config: EmailConfig = { fromEmail, fromName, subject, body };
  await setDoc(doc(firestore, CONFIG, EMAIL_CONFIG_DOC), config, { merge: true });
  return config;
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
    if (!medico.activo) throw new Error("El médico está desactivado");
  }

  const config = await getConfigDoc();
  await saveConfigDoc({ ...config, medicoSeleccionadoId });
  return getDb();
}

export async function createPaciente(input: PacienteInput): Promise<Paciente> {
  const id = randomUUID();
  const paciente: Paciente = { ...input, id, activo: true };
  await setDoc(doc(firestore, PACIENTES, id), pacientePayload(paciente));
  return paciente;
}

export async function updatePaciente(id: string, input: PacienteInput): Promise<Paciente> {
  const existing = await getDoc(doc(firestore, PACIENTES, id));
  if (!existing.exists()) throw new Error("Paciente no encontrado");

  const current = normalizePaciente(id, existing.data() as Record<string, unknown>);
  const paciente: Paciente = { ...input, id, activo: current.activo };
  await setDoc(doc(firestore, PACIENTES, id), pacientePayload(paciente));
  return paciente;
}

export async function setPacienteActivo(id: string, activo: boolean): Promise<Paciente> {
  const existing = await getDoc(doc(firestore, PACIENTES, id));
  if (!existing.exists()) throw new Error("Paciente no encontrado");

  const paciente = normalizePaciente(id, existing.data() as Record<string, unknown>);
  paciente.activo = activo;
  await setDoc(doc(firestore, PACIENTES, id), pacientePayload(paciente));
  return paciente;
}

export async function createMedico(input: MedicoInput): Promise<Medico> {
  const id = randomUUID();
  const medico: Medico = { ...input, id, firmaUrl: null, activo: true };
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
  const medico: Medico = { ...current, ...input, id, activo: current.activo };
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

export async function setMedicoActivo(
  id: string,
  activo: boolean,
): Promise<{ medico: Medico; pacientesReasignados: number }> {
  const existing = await getDoc(doc(firestore, MEDICOS, id));
  if (!existing.exists()) throw new Error("Médico no encontrado");

  const medico = normalizeMedico(id, existing.data() as Record<string, unknown>);

  if (!activo) {
    const config = await getConfigDoc();
    if (config.medicoSeleccionadoId === id) {
      throw new Error(
        "No se puede desactivar el médico por defecto. Primero elegí otro médico por defecto.",
      );
    }

    medico.activo = false;
    await setDoc(doc(firestore, MEDICOS, id), medicoPayload(medico));

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

    return { medico, pacientesReasignados: afectados.length };
  }

  medico.activo = true;
  await setDoc(doc(firestore, MEDICOS, id), medicoPayload(medico));
  return { medico, pacientesReasignados: 0 };
}
