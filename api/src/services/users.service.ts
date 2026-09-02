import { randomUUID } from "node:crypto";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import type {
  AppModuleId,
  AppUser,
  AppUserPublic,
  ApproveUserInput,
  UserRole,
  UserStatus,
} from "../types.js";
import { ALL_APP_MODULES } from "../types.js";

const USUARIOS = "ordenes_usuarios";
const CONFIG = "ordenes_config";
const AUTH_CONFIG_DOC = "auth";

export type AuthAccessConfig = {
  /** Dominios permitidos sin @. Vacío = permitir todos. */
  allowedDomains: string[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "").replace(/^\.+|\.+$/g, "");
}

export function normalizeAllowedDomains(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .map((d) => normalizeDomain(String(d ?? "")))
    .filter((d) => d.includes(".") || /^[a-z0-9-]+$/i.test(d));
  return [...new Set(cleaned)].sort((a, b) => a.localeCompare(b));
}

export async function getAuthAccessConfig(): Promise<AuthAccessConfig> {
  const snap = await getDoc(doc(firestore, CONFIG, AUTH_CONFIG_DOC));
  if (!snap.exists()) {
    return { allowedDomains: [] };
  }
  const data = snap.data() as Record<string, unknown>;
  return { allowedDomains: normalizeAllowedDomains(data.allowedDomains) };
}

export async function saveAuthAccessConfig(
  input: AuthAccessConfig,
): Promise<AuthAccessConfig> {
  const config: AuthAccessConfig = {
    allowedDomains: normalizeAllowedDomains(input.allowedDomains),
  };
  await setDoc(doc(firestore, CONFIG, AUTH_CONFIG_DOC), config, { merge: true });
  return config;
}

function isModuleId(value: unknown): value is AppModuleId {
  return (
    value === "ordenes" ||
    value === "presupuestos" ||
    value === "pami" ||
    value === "busca-turno" ||
    value === "pedidos-sistema" ||
    value === "usuarios"
  );
}

function normalizeModules(raw: unknown, role: UserRole): AppModuleId[] {
  const list = Array.isArray(raw)
    ? raw.filter(isModuleId)
    : ([] as AppModuleId[]);
  const unique = [...new Set(list)];
  if (role === "admin" && !unique.includes("usuarios")) {
    unique.push("usuarios");
  }
  if (role !== "admin") {
    return unique.filter((m) => m !== "usuarios");
  }
  return unique;
}

function normalizeUser(id: string, raw: Record<string, unknown>): AppUser {
  const role: UserRole = raw.role === "admin" ? "admin" : "user";
  const status: UserStatus =
    raw.status === "approved" || raw.status === "rejected"
      ? raw.status
      : "pending";
  return {
    id,
    email: normalizeEmail(String(raw.email ?? "")),
    nombre: String(raw.nombre ?? "").trim(),
    passwordHash: String(raw.passwordHash ?? ""),
    role,
    modules: normalizeModules(raw.modules, role),
    status,
    creadoAt: String(raw.creadoAt ?? "") || nowIso(),
    actualizadoAt: String(raw.actualizadoAt ?? "") || nowIso(),
    aprobadoAt: raw.aprobadoAt ? String(raw.aprobadoAt) : null,
    rechazadoAt: raw.rechazadoAt ? String(raw.rechazadoAt) : null,
  };
}

function userPayload(user: AppUser): Omit<AppUser, "id"> {
  return {
    email: user.email,
    nombre: user.nombre,
    passwordHash: user.passwordHash,
    role: user.role,
    modules: user.modules,
    status: user.status,
    creadoAt: user.creadoAt,
    actualizadoAt: user.actualizadoAt,
    aprobadoAt: user.aprobadoAt ?? null,
    rechazadoAt: user.rechazadoAt ?? null,
  };
}

export function toPublicUser(user: AppUser): AppUserPublic {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(firestore, USUARIOS, id));
  if (!snap.exists()) return null;
  return normalizeUser(snap.id, snap.data() as Record<string, unknown>);
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const q = query(collection(firestore, USUARIOS), where("email", "==", normalized));
  const snap = await getDocs(q);
  const first = snap.docs[0];
  if (!first) return null;
  return normalizeUser(first.id, first.data() as Record<string, unknown>);
}

export async function listUsersByStatus(status: UserStatus): Promise<AppUser[]> {
  const q = query(collection(firestore, USUARIOS), where("status", "==", status));
  const snap = await getDocs(q);
  const users = snap.docs.map((d) =>
    normalizeUser(d.id, d.data() as Record<string, unknown>),
  );
  return users.sort((a, b) => b.creadoAt.localeCompare(a.creadoAt));
}

/** Primer login OAuth o reintento: queda en pendientes hasta que un admin apruebe. */
export async function createOAuthUser(input: {
  email: string;
  nombre: string;
  asBootstrapAdmin?: boolean;
}): Promise<AppUser> {
  const email = normalizeEmail(input.email);
  const existing = await getUserByEmail(email);
  if (existing) {
    return existing;
  }

  const now = nowIso();
  const asAdmin = Boolean(input.asBootstrapAdmin);
  const user: AppUser = {
    id: randomUUID(),
    email,
    nombre: input.nombre.trim() || email.split("@")[0] || "Usuario",
    passwordHash: "",
    role: asAdmin ? "admin" : "user",
    modules: asAdmin ? [...ALL_APP_MODULES] : [],
    status: asAdmin ? "approved" : "pending",
    creadoAt: now,
    actualizadoAt: now,
    aprobadoAt: asAdmin ? now : null,
    rechazadoAt: null,
  };

  await setDoc(doc(firestore, USUARIOS, user.id), userPayload(user));
  return user;
}

/** Si fue rechazado y vuelve a intentar login, regresa a la lista de espera. */
export async function reopenAsPending(
  id: string,
  nombre?: string,
): Promise<AppUser> {
  const user = await getUserById(id);
  if (!user) throw new Error("Usuario no encontrado");
  if (user.status === "approved") return user;
  if (user.status === "pending") {
    if (nombre?.trim() && nombre.trim() !== user.nombre) {
      const next = { ...user, nombre: nombre.trim(), actualizadoAt: nowIso() };
      await setDoc(doc(firestore, USUARIOS, id), userPayload(next));
      return next;
    }
    return user;
  }

  const now = nowIso();
  const next: AppUser = {
    ...user,
    nombre: nombre?.trim() || user.nombre,
    status: "pending",
    role: "user",
    modules: [],
    actualizadoAt: now,
    rechazadoAt: null,
  };
  await setDoc(doc(firestore, USUARIOS, id), userPayload(next));
  return next;
}

export async function approveUser(
  id: string,
  input: ApproveUserInput,
): Promise<AppUser> {
  const user = await getUserById(id);
  if (!user) throw new Error("Usuario no encontrado");
  if (user.status === "approved") throw new Error("El usuario ya está aprobado");

  const role: UserRole = input.role === "admin" ? "admin" : "user";
  const modules = normalizeModules(input.modules, role);
  if (modules.length === 0) {
    throw new Error("Debés asignar al menos una pantalla");
  }

  const now = nowIso();
  const next: AppUser = {
    ...user,
    role,
    modules,
    status: "approved",
    actualizadoAt: now,
    aprobadoAt: now,
    rechazadoAt: null,
  };
  await setDoc(doc(firestore, USUARIOS, id), userPayload(next));
  return next;
}

export async function rejectUser(id: string): Promise<AppUser> {
  const user = await getUserById(id);
  if (!user) throw new Error("Usuario no encontrado");
  if (user.status === "rejected") throw new Error("El usuario ya está rechazado");

  const now = nowIso();
  const next: AppUser = {
    ...user,
    status: "rejected",
    modules: [],
    role: "user",
    actualizadoAt: now,
    rechazadoAt: now,
  };
  await setDoc(doc(firestore, USUARIOS, id), userPayload(next));
  return next;
}

export async function updateApprovedUser(
  id: string,
  input: ApproveUserInput,
): Promise<AppUser> {
  const user = await getUserById(id);
  if (!user) throw new Error("Usuario no encontrado");
  if (user.status !== "approved") {
    throw new Error("Solo se pueden editar usuarios activos");
  }

  const role: UserRole = input.role === "admin" ? "admin" : "user";
  const modules = normalizeModules(input.modules, role);
  if (modules.length === 0) {
    throw new Error("Debés asignar al menos una pantalla");
  }

  const next: AppUser = {
    ...user,
    role,
    modules,
    actualizadoAt: nowIso(),
  };
  await setDoc(doc(firestore, USUARIOS, id), userPayload(next));
  return next;
}
