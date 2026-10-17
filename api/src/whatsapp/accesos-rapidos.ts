import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

const LEGACY_DOC = doc(firestore, "ordenes_config", "whatsapp_accesos_rapidos");

export type AccesoCluster = {
  id: string;
  color: string;
  tagIds: string[];
};

export type AccesosRapidos = {
  tagIds: string[];
  clusters: AccesoCluster[];
};

function userDoc(userId: string) {
  const safe = userId.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  if (!safe) throw new Error("Usuario inválido");
  return doc(firestore, "ordenes_config", `whatsapp_accesos_usuario_${safe}`);
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function clusters(value: unknown): AccesoCluster[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const next: AccesoCluster[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; color?: unknown; tagIds?: unknown };
    const id = String(row.id ?? "").trim();
    const color = String(row.color ?? "").trim().toLowerCase();
    const tagIds = ids(row.tagIds).filter((tagId) => !used.has(tagId) && used.add(tagId));
    if (!id || !/^#[0-9a-f]{6}$/.test(color) || tagIds.length < 2) continue;
    next.push({ id, color, tagIds });
  }
  return next;
}

function readAccesos(raw: { tagIds?: unknown; clusters?: unknown } | undefined): AccesosRapidos {
  if (!raw) return { tagIds: [], clusters: [] };
  return { tagIds: ids(raw.tagIds), clusters: clusters(raw.clusters) };
}

async function claimLegacy(userId: string): Promise<AccesosRapidos> {
  const snap = await getDoc(LEGACY_DOC);
  if (!snap.exists()) return { tagIds: [], clusters: [] };
  const raw = snap.data() as { tagIds?: unknown; clusters?: unknown; claimedBy?: unknown };
  const claimedBy = String(raw.claimedBy ?? "").trim();
  const stored = readAccesos(raw);
  if (!stored.tagIds.length && !stored.clusters.length) return stored;
  if (claimedBy && claimedBy !== userId) return { tagIds: [], clusters: [] };
  if (!claimedBy) {
    await setDoc(LEGACY_DOC, { ...stored, claimedBy: userId, updatedAt: new Date().toISOString() });
  }
  return stored;
}

export async function getAccesosRapidos(userId: string): Promise<AccesosRapidos> {
  const snap = await getDoc(userDoc(userId));
  if (snap.exists()) return readAccesos(snap.data());
  const legacy = await claimLegacy(userId);
  if (legacy.tagIds.length || legacy.clusters.length) {
    await setDoc(userDoc(userId), { ...legacy, updatedAt: new Date().toISOString() });
  }
  return legacy;
}

export async function saveAccesosRapidos(
  userId: string,
  input: { tagIds?: string[]; clusters?: AccesoCluster[] },
): Promise<AccesosRapidos> {
  const current = await getAccesosRapidos(userId);
  const next: AccesosRapidos = {
    tagIds: input.tagIds ? ids(input.tagIds) : current.tagIds,
    clusters: input.clusters ? clusters(input.clusters) : current.clusters,
  };
  await setDoc(userDoc(userId), { ...next, updatedAt: new Date().toISOString() });
  return next;
}
