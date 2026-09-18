import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import { getUserById } from "../services/users.service.js";

export type WaOperator = {
  id: string;
  nombre: string;
  email: string;
  color: string;
};

const OPERATORS_DOC = doc(firestore, "ordenes_config", "whatsapp_operators");
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOR = "#a61948";

type Stored = {
  userIds: string[];
  colors: Record<string, string>;
};

function normalizeColor(value: unknown): string | null {
  const color = String(value ?? "").trim().toLowerCase();
  return COLOR_RE.test(color) ? color : null;
}

async function readStored(): Promise<Stored> {
  const snap = await getDoc(OPERATORS_DOC);
  if (!snap.exists()) return { userIds: [], colors: {} };
  const data = snap.data();
  const raw = data?.userIds;
  const userIds = Array.isArray(raw)
    ? [...new Set(raw.map((id) => String(id ?? "").trim()).filter(Boolean))]
    : [];
  const colors: Record<string, string> = {};
  const rawColors = data?.colors;
  if (rawColors && typeof rawColors === "object") {
    for (const [key, value] of Object.entries(rawColors as Record<string, unknown>)) {
      const color = normalizeColor(value);
      if (color) colors[key] = color;
    }
  }
  return { userIds, colors };
}

async function writeStored(stored: Stored): Promise<void> {
  const colors: Record<string, string> = {};
  for (const id of stored.userIds) {
    colors[id] = stored.colors[id] ?? DEFAULT_COLOR;
  }
  await setDoc(
    OPERATORS_DOC,
    { userIds: stored.userIds, colors, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function listWhatsappOperators(): Promise<WaOperator[]> {
  const stored = await readStored();
  const out: WaOperator[] = [];
  for (const id of stored.userIds) {
    const user = await getUserById(id);
    if (!user || user.status !== "approved") continue;
    out.push({
      id: user.id,
      nombre: user.nombre.trim() || user.email,
      email: user.email,
      color: stored.colors[user.id] ?? DEFAULT_COLOR,
    });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

export async function isWhatsappOperator(userId: string): Promise<boolean> {
  const stored = await readStored();
  return stored.userIds.includes(userId);
}

export async function addWhatsappOperator(userId: string, color: string): Promise<WaOperator[]> {
  const id = userId.trim();
  const picked = normalizeColor(color);
  if (!picked) throw new Error("Elegí un color");
  const user = id ? await getUserById(id) : null;
  if (!user || user.status !== "approved") {
    throw new Error("Ese usuario no está activo");
  }
  const stored = await readStored();
  if (!stored.userIds.includes(user.id)) stored.userIds.push(user.id);
  stored.colors[user.id] = picked;
  await writeStored(stored);
  return listWhatsappOperators();
}

export async function removeWhatsappOperator(userId: string): Promise<WaOperator[]> {
  const id = userId.trim();
  const stored = await readStored();
  stored.userIds = stored.userIds.filter((item) => item !== id);
  delete stored.colors[id];
  await writeStored(stored);
  return listWhatsappOperators();
}
