import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

export type MetricaContador = {
  id: string;
  nombre: string;
  color: string;
  modo: "etiquetas" | "grupo";
  tagIds: string[];
  groupId: string | null;
};

export type MetricaAgrupacion = {
  id: string;
  nombre: string;
  contadores: MetricaContador[];
};

export type MetricaTablero = {
  agrupaciones: MetricaAgrupacion[];
};

const COLOR_RE = /^#[0-9a-f]{6}$/;

function userDoc(userId: string) {
  const safe = userId.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  if (!safe) throw new Error("Usuario inválido");
  return doc(firestore, "ordenes_config", `whatsapp_metricas_usuario_${safe}`);
}

function texto(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id ?? "").trim()).filter(Boolean))].slice(0, 12);
}

function contador(value: unknown): MetricaContador | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MetricaContador>;
  const id = texto(row.id, 80);
  const nombre = texto(row.nombre, 80);
  const color = texto(row.color, 7).toLowerCase();
  const modo = row.modo === "grupo" ? "grupo" : row.modo === "etiquetas" ? "etiquetas" : null;
  if (!id || !nombre || !COLOR_RE.test(color) || !modo) return null;
  const tagIds = modo === "etiquetas" ? ids(row.tagIds) : [];
  const groupId = modo === "grupo" ? texto(row.groupId, 80) : "";
  if (modo === "etiquetas" && !tagIds.length) return null;
  if (modo === "grupo" && !groupId) return null;
  return { id, nombre, color, modo, tagIds, groupId: groupId || null };
}

function agrupaciones(value: unknown): MetricaAgrupacion[] {
  if (!Array.isArray(value)) return [];
  const next: MetricaAgrupacion[] = [];
  for (const item of value.slice(0, 30)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; nombre?: unknown; contadores?: unknown };
    const id = texto(row.id, 80);
    const nombre = texto(row.nombre, 80);
    if (!id || !nombre) continue;
    const contadores = Array.isArray(row.contadores)
      ? row.contadores.map(contador).filter((entry): entry is MetricaContador => entry != null).slice(0, 40)
      : [];
    next.push({ id, nombre, contadores });
  }
  return next;
}

export async function getMetricaTablero(userId: string): Promise<MetricaTablero> {
  const snap = await getDoc(userDoc(userId));
  if (!snap.exists()) return { agrupaciones: [] };
  return { agrupaciones: agrupaciones(snap.data()?.agrupaciones) };
}

export async function saveMetricaTablero(
  userId: string,
  input: unknown,
): Promise<MetricaTablero> {
  const next = { agrupaciones: agrupaciones(input) };
  await setDoc(userDoc(userId), { ...next, updatedAt: new Date().toISOString() });
  return next;
}
