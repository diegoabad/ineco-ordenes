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
import type { AppDb, Medico, MedicoInput, Paciente, PacienteInput, EmailEnvio, EmailEnvioInput, Prestacion, PrestacionInput, Presupuesto, PresupuestoCreateInput, PresupuestoItem, PresupuestoUpdateInput, PresupuestosConfig, ProfesionalPresupuesto, TipoPrestacion } from "../types.js";
import {
  DEFAULT_TIPOS_PRESTACION,
  TIPO_COLOR_PALETTE,
} from "../types.js";
import {
  emailConfigWithEnvDefaults,
  emailConfigNeedsLegacyBodyUpgrade,
  type EmailConfig,
} from "./email-templates.js";
import {
  presupuestoEmailConfigWithDefaults,
  type PresupuestoEmailConfig,
} from "./presupuesto-email-templates.js";
import {
  presupuestoPlantillaConfigWithDefaults,
  type PresupuestoPlantillaConfig,
} from "./presupuesto-plantilla-templates.js";
import { deleteEnvioPdfFile } from "./envio-pdf.service.js";
import { deletePresupuestoPdfFile, readPresupuestoPdfBase64, savePresupuestoPdf } from "./presupuesto-pdf.service.js";
import { sendPresupuestoEmail } from "./email.service.js";

const MEDICOS = "ordenes_medicos";
const PACIENTES = "ordenes_pacientes";
const EMAIL_ENVIOS = "ordenes_email_envios";
const PRESTACIONES = "presupuestos_prestaciones";
const PRESUPUESTOS_EMITIDOS = "presupuestos_emitidos";
const CONFIG = "ordenes_config";
const CONFIG_DOC = "main";
const EMAIL_CONFIG_DOC = "email";
const PRESUPUESTOS_CONFIG_COLLECTION = "presupuestos_config";
const PRESUPUESTO_EMAIL_CONFIG_DOC = "email";
const PRESUPUESTO_PLANTILLA_CONFIG_DOC = "plantilla";
const PRESUPUESTOS_CONFIG_DOC = "presupuestos";

function nowIso(): string {
  return new Date().toISOString();
}

function creadoAtMs(value?: string): number {
  if (!value?.trim()) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function sortRecientes<T extends { creadoAt?: string }>(
  items: T[],
  tieBreak?: (a: T, b: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const diff = creadoAtMs(b.creadoAt) - creadoAtMs(a.creadoAt);
    if (diff !== 0) return diff;
    return tieBreak?.(a, b) ?? 0;
  });
}

function readCreadoAt(raw: Record<string, unknown>): string | undefined {
  const v = String(raw.creadoAt ?? "").trim();
  return v || undefined;
}

function fechaHoyIso(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().split("T")[0]!;
}

function normalizePresupuestoItem(raw: unknown): PresupuestoItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const prestacionId = String(o.prestacionId ?? "").trim();
  if (!prestacionId) return null;
  return {
    prestacionId,
    titulo: String(o.titulo ?? ""),
    descripcion: String(o.descripcion ?? ""),
    tipo: String(o.tipo ?? ""),
    duracionMinutos: toMinutes(o.duracionMinutos),
    precioEfectivo: toMoney(o.precioEfectivo),
    precio3Cuotas: toMoney(o.precio3Cuotas),
  };
}

function normalizePresupuesto(id: string, raw: Record<string, unknown>): Presupuesto {
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw
    .map((item) => normalizePresupuestoItem(item))
    .filter((item): item is PresupuestoItem => item !== null);
  const estadoRaw = String(raw.estado ?? "pendiente").trim();
  const estado =
    estadoRaw === "enviado" ||
    estadoRaw === "aceptado" ||
    estadoRaw === "rechazado" ||
    estadoRaw === "fallido"
      ? estadoRaw
      : "pendiente";
  const pdfUrl =
    typeof raw.pdfUrl === "string" && raw.pdfUrl.trim() ? raw.pdfUrl.trim() : null;
  return {
    id,
    fecha: String(raw.fecha ?? fechaHoyIso()),
    nombrePaciente: String(raw.nombrePaciente ?? raw.nombre ?? ""),
    profesional: String(raw.profesional ?? "").trim(),
    email: String(raw.email ?? "").trim(),
    items,
    totalEfectivo: toMoney(raw.totalEfectivo ?? raw.total),
    total3Cuotas: toMoney(raw.total3Cuotas),
    estado,
    pdfUrl,
    creadoAt: readCreadoAt(raw),
  };
}

function presupuestoPayload(p: Presupuesto): Omit<Presupuesto, "id"> {
  return {
    fecha: p.fecha,
    nombrePaciente: p.nombrePaciente,
    profesional: p.profesional,
    email: p.email,
    items: p.items,
    totalEfectivo: p.totalEfectivo,
    total3Cuotas: p.total3Cuotas,
    estado: p.estado,
    pdfUrl: p.pdfUrl,
    ...(p.creadoAt ? { creadoAt: p.creadoAt } : {}),
  };
}

function prestacionToPresupuestoItem(p: Prestacion): PresupuestoItem {
  return {
    prestacionId: p.id,
    titulo: p.titulo,
    descripcion: p.descripcion,
    tipo: p.tipo,
    duracionMinutos: p.duracionMinutos,
    precioEfectivo: p.precioEfectivo,
    precio3Cuotas: p.precio3Cuotas,
  };
}

function normalizeHexColor(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function normalizeTiposPrestacion(raw: unknown): TipoPrestacion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t }));
  }

  const result: TipoPrestacion[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item === "string") {
      const nombre = item.trim();
      if (!nombre) continue;
      const preset = DEFAULT_TIPOS_PRESTACION.find((t) => t.nombre === nombre);
      result.push(
        preset ?? {
          nombre,
          color: TIPO_COLOR_PALETTE[result.length % TIPO_COLOR_PALETTE.length]!,
        },
      );
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const nombre = String(obj.nombre ?? "").trim();
      if (!nombre) continue;
      const color =
        normalizeHexColor(String(obj.color ?? "")) ??
        TIPO_COLOR_PALETTE[result.length % TIPO_COLOR_PALETTE.length]!;
      result.push({ nombre, color });
    }
  }

  const seen = new Set<string>();
  const unique = result.filter((t) => {
    const key = t.nombre.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.length > 0 ? unique : DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t }));
}

function normalizeProfesionalesPresupuesto(raw: unknown): ProfesionalPresupuesto[] {
  if (!Array.isArray(raw)) return [];

  const result: ProfesionalPresupuesto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const nombreApellido = String(obj.nombreApellido ?? obj.nombre ?? "").trim();
    if (!nombreApellido) continue;
    const id = String(obj.id ?? "").trim() || randomUUID();
    const titulo = String(obj.titulo ?? "").trim();
    result.push({ id, titulo, nombreApellido });
  }

  return result;
}

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
    creadoAt: readCreadoAt(raw),
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
    creadoAt: readCreadoAt(raw),
  };
}

function toMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const n = Number(value.trim().replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function toMinutes(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return 0;
}

function normalizePrestacion(id: string, raw: Record<string, unknown>): Prestacion {
  const efectivo = toMoney(raw.precioEfectivo);
  const transferencia = toMoney(raw.precioTransferencia);
  return {
    id,
    titulo: String(raw.titulo ?? ""),
    descripcion: String(raw.descripcion ?? ""),
    tipo: String(raw.tipo ?? "").trim() || DEFAULT_TIPOS_PRESTACION[0]!.nombre,
    duracionMinutos: toMinutes(raw.duracionMinutos),
    // Efectivo y transferencia son el mismo precio; fallback por datos viejos
    precioEfectivo: efectivo || transferencia,
    precio3Cuotas: toMoney(raw.precio3Cuotas),
    creadoAt: readCreadoAt(raw),
  };
}

function medicoPayload(medico: Medico): Omit<Medico, "id"> {
  return {
    nombre: medico.nombre,
    especialidad: medico.especialidad,
    matricula: medico.matricula,
    firmaUrl: medico.firmaUrl,
    activo: medico.activo,
    ...(medico.creadoAt ? { creadoAt: medico.creadoAt } : {}),
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
    ...(paciente.creadoAt ? { creadoAt: paciente.creadoAt } : {}),
  };
}

function prestacionPayload(prestacion: Prestacion): Omit<Prestacion, "id"> {
  return {
    titulo: prestacion.titulo,
    descripcion: prestacion.descripcion,
    tipo: prestacion.tipo,
    duracionMinutos: prestacion.duracionMinutos,
    precioEfectivo: prestacion.precioEfectivo,
    precio3Cuotas: prestacion.precio3Cuotas,
    ...(prestacion.creadoAt ? { creadoAt: prestacion.creadoAt } : {}),
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
  const snap = await getDocs(collection(firestore, MEDICOS));
  const items = snap.docs.map((d) => normalizeMedico(d.id, d.data() as Record<string, unknown>));
  return sortRecientes(items, (a, b) =>
    a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }),
  );
}

export async function listPacientes(): Promise<Paciente[]> {
  const snap = await getDocs(collection(firestore, PACIENTES));
  const items = snap.docs.map((d) => normalizePaciente(d.id, d.data() as Record<string, unknown>));
  return sortRecientes(items, (a, b) =>
    a.paciente.localeCompare(b.paciente, "es", { sensitivity: "base" }),
  );
}

export async function listPrestaciones(): Promise<Prestacion[]> {
  const snap = await getDocs(collection(firestore, PRESTACIONES));
  const items = snap.docs.map((d) => normalizePrestacion(d.id, d.data() as Record<string, unknown>));
  return sortRecientes(items, (a, b) =>
    a.titulo.localeCompare(b.titulo, "es", { sensitivity: "base" }),
  );
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
  const stored = {
    fromEmail: typeof data.fromEmail === "string" ? data.fromEmail : undefined,
    fromName: typeof data.fromName === "string" ? data.fromName : undefined,
    subject: typeof data.subject === "string" ? data.subject : undefined,
    body: typeof data.body === "string" ? data.body : undefined,
  };
  const config = emailConfigWithEnvDefaults(stored);
  if (emailConfigNeedsLegacyBodyUpgrade(stored)) {
    await setDoc(doc(firestore, CONFIG, EMAIL_CONFIG_DOC), config, { merge: true });
  }
  return config;
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

export async function getPresupuestoEmailConfig(): Promise<PresupuestoEmailConfig> {
  const snap = await getDoc(
    doc(firestore, PRESUPUESTOS_CONFIG_COLLECTION, PRESUPUESTO_EMAIL_CONFIG_DOC),
  );
  if (!snap.exists()) {
    return presupuestoEmailConfigWithDefaults(null);
  }
  const data = snap.data() as Record<string, unknown>;
  return presupuestoEmailConfigWithDefaults({
    fromEmail: typeof data.fromEmail === "string" ? data.fromEmail : undefined,
    fromName: typeof data.fromName === "string" ? data.fromName : undefined,
    subject: typeof data.subject === "string" ? data.subject : undefined,
    body: typeof data.body === "string" ? data.body : undefined,
  });
}

export async function savePresupuestoEmailConfig(
  input: PresupuestoEmailConfig,
): Promise<PresupuestoEmailConfig> {
  const fromEmail = input.fromEmail.trim();
  const fromName = input.fromName.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();

  if (!fromEmail) throw new Error("El email remitente es obligatorio");
  if (!fromName) throw new Error("El nombre remitente es obligatorio");
  if (!subject) throw new Error("El asunto es obligatorio");
  if (!body) throw new Error("El cuerpo del mail es obligatorio");

  const config: PresupuestoEmailConfig = { fromEmail, fromName, subject, body };
  await setDoc(
    doc(firestore, PRESUPUESTOS_CONFIG_COLLECTION, PRESUPUESTO_EMAIL_CONFIG_DOC),
    config,
    { merge: true },
  );
  return config;
}

export async function getPresupuestoPlantillaConfig(): Promise<PresupuestoPlantillaConfig> {
  const snap = await getDoc(
    doc(firestore, PRESUPUESTOS_CONFIG_COLLECTION, PRESUPUESTO_PLANTILLA_CONFIG_DOC),
  );
  if (!snap.exists()) {
    return presupuestoPlantillaConfigWithDefaults(null);
  }
  const data = snap.data() as Record<string, unknown>;
  return presupuestoPlantillaConfigWithDefaults({
    body: typeof data.body === "string" ? data.body : undefined,
  });
}

export async function savePresupuestoPlantillaConfig(
  input: PresupuestoPlantillaConfig,
): Promise<PresupuestoPlantillaConfig> {
  const body = input.body.trim();
  const config: PresupuestoPlantillaConfig = { body };
  await setDoc(
    doc(firestore, PRESUPUESTOS_CONFIG_COLLECTION, PRESUPUESTO_PLANTILLA_CONFIG_DOC),
    config,
    { merge: true },
  );
  return config;
}

export async function getPresupuestosConfig(): Promise<PresupuestosConfig> {
  const snap = await getDoc(doc(firestore, CONFIG, PRESUPUESTOS_CONFIG_DOC));
  if (!snap.exists()) {
    return {
      tiposPrestacion: DEFAULT_TIPOS_PRESTACION.map((t) => ({ ...t })),
      profesionales: [],
    };
  }
  const data = snap.data() as Record<string, unknown>;
  return {
    tiposPrestacion: normalizeTiposPrestacion(data.tiposPrestacion),
    profesionales: normalizeProfesionalesPresupuesto(data.profesionales),
  };
}

export async function savePresupuestosConfig(input: PresupuestosConfig): Promise<PresupuestosConfig> {
  const tipos = normalizeTiposPrestacion(input.tiposPrestacion);
  if (tipos.length === 0) {
    throw new Error("Debe haber al menos un tipo de prestación");
  }
  const profesionales = normalizeProfesionalesPresupuesto(input.profesionales);
  const config: PresupuestosConfig = { tiposPrestacion: tipos, profesionales };
  await setDoc(doc(firestore, CONFIG, PRESUPUESTOS_CONFIG_DOC), config, { merge: true });
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
  const paciente: Paciente = { ...input, id, activo: true, creadoAt: nowIso() };
  await setDoc(doc(firestore, PACIENTES, id), pacientePayload(paciente));
  return paciente;
}

export async function updatePaciente(id: string, input: PacienteInput): Promise<Paciente> {
  const existing = await getDoc(doc(firestore, PACIENTES, id));
  if (!existing.exists()) throw new Error("Paciente no encontrado");

  const current = normalizePaciente(id, existing.data() as Record<string, unknown>);
  const paciente: Paciente = { ...input, id, activo: current.activo, creadoAt: current.creadoAt };
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
  const medico: Medico = { ...input, id, firmaUrl: null, activo: true, creadoAt: nowIso() };
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

export async function createPrestacion(input: PrestacionInput): Promise<Prestacion> {
  const id = randomUUID();
  const prestacion: Prestacion = { ...input, id, creadoAt: nowIso() };
  await setDoc(doc(firestore, PRESTACIONES, id), prestacionPayload(prestacion));
  return prestacion;
}

export async function updatePrestacion(id: string, input: PrestacionInput): Promise<Prestacion> {
  const existing = await getDoc(doc(firestore, PRESTACIONES, id));
  if (!existing.exists()) throw new Error("Prestación no encontrada");

  const current = normalizePrestacion(id, existing.data() as Record<string, unknown>);
  const prestacion: Prestacion = { ...input, id, creadoAt: current.creadoAt };
  await setDoc(doc(firestore, PRESTACIONES, id), prestacionPayload(prestacion));
  return prestacion;
}

export async function deletePrestacion(id: string): Promise<void> {
  const existing = await getDoc(doc(firestore, PRESTACIONES, id));
  if (!existing.exists()) throw new Error("Prestación no encontrada");
  await deleteDoc(doc(firestore, PRESTACIONES, id));
}

export async function listPresupuestos(): Promise<Presupuesto[]> {
  const snap = await getDocs(collection(firestore, PRESUPUESTOS_EMITIDOS));
  const items = snap.docs.map((d) =>
    normalizePresupuesto(d.id, d.data() as Record<string, unknown>),
  );
  return sortRecientes(items, (a, b) =>
    a.nombrePaciente.localeCompare(b.nombrePaciente, "es", { sensitivity: "base" }),
  );
}

function presupuestoPermiteEdicion(estado: Presupuesto["estado"]): boolean {
  return estado === "pendiente" || estado === "fallido";
}

function presupuestoPermiteEnvio(estado: Presupuesto["estado"]): boolean {
  return estado === "pendiente" || estado === "fallido";
}

export class PresupuestoEnvioError extends Error {
  presupuesto: Presupuesto;

  constructor(presupuesto: Presupuesto) {
    super("No se pudo enviar el presupuesto");
    this.name = "PresupuestoEnvioError";
    this.presupuesto = presupuesto;
  }
}

async function marcarPresupuestoEnvioFallido(presupuesto: Presupuesto): Promise<never> {
  const fallido: Presupuesto = { ...presupuesto, estado: "fallido" };
  await setDoc(
    doc(firestore, PRESUPUESTOS_EMITIDOS, presupuesto.id),
    presupuestoPayload(fallido),
  );
  throw new PresupuestoEnvioError(fallido);
}

async function loadPresupuestoItemsFromIds(ids: string[]): Promise<PresupuestoItem[]> {
  const uniqueIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (uniqueIds.length === 0) throw new Error("Seleccioná al menos una prestación");

  const items: PresupuestoItem[] = [];
  for (const pid of uniqueIds) {
    const snap = await getDoc(doc(firestore, PRESTACIONES, pid));
    if (!snap.exists()) throw new Error("Una de las prestaciones seleccionadas no existe");
    items.push(prestacionToPresupuestoItem(normalizePrestacion(snap.id, snap.data())));
  }
  return items;
}

export async function createPresupuesto(input: PresupuestoCreateInput): Promise<Presupuesto> {
  const nombrePaciente = input.nombrePaciente.trim();
  if (!nombrePaciente) throw new Error("El nombre del paciente es obligatorio");
  if (input.enviar && !input.email.trim()) {
    throw new Error("El email es obligatorio para enviar el presupuesto");
  }

  const items = await loadPresupuestoItemsFromIds(input.prestacionIds);

  const id = randomUUID();
  let pdfUrl: string | null = null;
  if (input.pdfBase64?.trim()) {
    const saved = await savePresupuestoPdf(id, input.pdfBase64);
    pdfUrl = saved.publicUrl;
  }

  const presupuesto: Presupuesto = {
    id,
    fecha: fechaHoyIso(),
    nombrePaciente,
    profesional: input.profesional.trim(),
    email: input.email.trim(),
    items,
    totalEfectivo: items.reduce((s, i) => s + i.precioEfectivo, 0),
    total3Cuotas: items.reduce((s, i) => s + i.precio3Cuotas, 0),
    estado: "pendiente",
    pdfUrl,
    creadoAt: nowIso(),
  };

  await setDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id), presupuestoPayload(presupuesto));

  if (input.enviar) {
    if (!input.pdfBase64?.trim()) throw new Error("Falta el PDF para enviar el presupuesto");
    try {
      await sendPresupuestoEmail({
        toEmail: input.email.trim(),
        nombrePaciente,
        profesional: presupuesto.profesional,
        pdfBase64: input.pdfBase64,
        filename: `presupuesto-${nombrePaciente.replace(/\s+/g, "-").toLowerCase() || "paciente"}.pdf`,
        fechaPresupuesto: presupuesto.fecha,
        totalEfectivo: presupuesto.totalEfectivo,
        total3Cuotas: presupuesto.total3Cuotas,
        cantidadPrestaciones: presupuesto.items.length,
        items: presupuesto.items,
      });
      presupuesto.estado = "enviado";
      await setDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id), presupuestoPayload(presupuesto));
    } catch (error) {
      console.error("[create-presupuesto] envio", error);
      await marcarPresupuestoEnvioFallido(presupuesto);
    }
  }

  return presupuesto;
}

export async function updatePresupuesto(
  id: string,
  input: PresupuestoUpdateInput,
): Promise<Presupuesto> {
  const existingSnap = await getDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id));
  if (!existingSnap.exists()) throw new Error("Presupuesto no encontrado");

  const current = normalizePresupuesto(id, existingSnap.data() as Record<string, unknown>);
  if (!presupuestoPermiteEdicion(current.estado)) {
    throw new Error("Solo se pueden editar presupuestos que no fueron enviados");
  }

  const nombrePaciente = input.nombrePaciente.trim();
  if (!nombrePaciente) throw new Error("El nombre del paciente es obligatorio");
  if (input.enviar && !input.email.trim()) {
    throw new Error("El email es obligatorio para enviar el presupuesto");
  }

  const items = await loadPresupuestoItemsFromIds(input.prestacionIds);

  let pdfUrl = current.pdfUrl;
  if (input.pdfBase64?.trim()) {
    const saved = await savePresupuestoPdf(id, input.pdfBase64);
    pdfUrl = saved.publicUrl;
  }

  const presupuesto: Presupuesto = {
    ...current,
    nombrePaciente,
    profesional: input.profesional.trim(),
    email: input.email.trim(),
    items,
    totalEfectivo: items.reduce((s, i) => s + i.precioEfectivo, 0),
    total3Cuotas: items.reduce((s, i) => s + i.precio3Cuotas, 0),
    estado: "pendiente",
    pdfUrl,
  };

  await setDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id), presupuestoPayload(presupuesto));

  if (input.enviar) {
    if (!input.pdfBase64?.trim()) throw new Error("Falta el PDF para enviar el presupuesto");
    try {
      await sendPresupuestoEmail({
        toEmail: input.email.trim(),
        nombrePaciente,
        profesional: presupuesto.profesional,
        pdfBase64: input.pdfBase64,
        filename: `presupuesto-${nombrePaciente.replace(/\s+/g, "-").toLowerCase() || "paciente"}.pdf`,
        fechaPresupuesto: presupuesto.fecha,
        totalEfectivo: presupuesto.totalEfectivo,
        total3Cuotas: presupuesto.total3Cuotas,
        cantidadPrestaciones: presupuesto.items.length,
        items: presupuesto.items,
      });
      presupuesto.estado = "enviado";
      await setDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id), presupuestoPayload(presupuesto));
    } catch (error) {
      console.error("[update-presupuesto] envio", error);
      await marcarPresupuestoEnvioFallido(presupuesto);
    }
  }

  return presupuesto;
}

export async function enviarPresupuesto(id: string): Promise<Presupuesto> {
  const existingSnap = await getDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id));
  if (!existingSnap.exists()) throw new Error("Presupuesto no encontrado");

  const current = normalizePresupuesto(id, existingSnap.data() as Record<string, unknown>);
  if (!presupuestoPermiteEnvio(current.estado)) {
    throw new Error("Este presupuesto ya fue enviado");
  }
  if (!current.email.trim()) {
    throw new Error("El presupuesto no tiene email cargado");
  }
  if (!current.pdfUrl) {
    throw new Error("Este presupuesto no tiene PDF guardado");
  }

  let pdfBase64: string;
  try {
    pdfBase64 = await readPresupuestoPdfBase64(id);
  } catch (error) {
    console.error("[enviar-presupuesto] pdf", error);
    return await marcarPresupuestoEnvioFallido(current);
  }

  try {
    await sendPresupuestoEmail({
      toEmail: current.email.trim(),
      nombrePaciente: current.nombrePaciente,
      profesional: current.profesional,
      pdfBase64,
      filename: `presupuesto-${current.nombrePaciente.replace(/\s+/g, "-").toLowerCase() || "paciente"}.pdf`,
      fechaPresupuesto: current.fecha,
      totalEfectivo: current.totalEfectivo,
      total3Cuotas: current.total3Cuotas,
      cantidadPrestaciones: current.items.length,
      items: current.items,
    });
  } catch (error) {
    console.error("[enviar-presupuesto] email", error);
    return await marcarPresupuestoEnvioFallido(current);
  }

  const presupuesto: Presupuesto = { ...current, estado: "enviado" };
  await setDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id), presupuestoPayload(presupuesto));
  return presupuesto;
}

const PRESUPUESTO_ESTADOS_MANUALES: PresupuestoEstado[] = ["aceptado", "rechazado"];

export async function updatePresupuestoEstado(
  id: string,
  estado: PresupuestoEstado,
): Promise<Presupuesto> {
  const existingSnap = await getDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id));
  if (!existingSnap.exists()) throw new Error("Presupuesto no encontrado");

  if (!PRESUPUESTO_ESTADOS_MANUALES.includes(estado)) {
    throw new Error("Solo se puede marcar como aceptado o rechazado");
  }

  const current = normalizePresupuesto(id, existingSnap.data() as Record<string, unknown>);
  if (current.estado === estado) return current;

  const presupuesto: Presupuesto = { ...current, estado };
  await setDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id), presupuestoPayload(presupuesto));
  return presupuesto;
}

export async function deletePresupuesto(id: string): Promise<void> {
  const existing = await getDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id));
  if (!existing.exists()) throw new Error("Presupuesto no encontrado");
  await deleteDoc(doc(firestore, PRESUPUESTOS_EMITIDOS, id));
  await deletePresupuestoPdfFile(id);
}
