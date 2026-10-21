import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import { createTtlCache } from "../lib/ttl-cache.js";

const CONFIG_DOC = doc(firestore, "ordenes_config", "whatsapp_conocimiento");

const MAX_CHARS = 200_000;

export type WhatsappConocimientoDoc = {
  text: string;
  updatedAt: string;
};

const conocimientoCache = createTtlCache<WhatsappConocimientoDoc>(10 * 60_000);

export async function getWhatsappConocimiento(): Promise<WhatsappConocimientoDoc> {
  const cached = conocimientoCache.get();
  if (cached !== undefined) return cached;
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    const empty = { text: "", updatedAt: "" };
    conocimientoCache.set(empty);
    return empty;
  }
  const raw = snap.data() as Record<string, unknown>;
  const value = {
    text: typeof raw.text === "string" ? raw.text : "",
    updatedAt: String(raw.updatedAt ?? ""),
  };
  conocimientoCache.set(value);
  return value;
}

export async function saveWhatsappConocimiento(
  text: string,
): Promise<WhatsappConocimientoDoc> {
  const value = String(text ?? "").replace(/\r\n/g, "\n");
  if (value.length > MAX_CHARS) {
    throw new Error(`El texto supera el máximo de ${MAX_CHARS} caracteres`);
  }
  const updatedAt = new Date().toISOString();
  await setDoc(CONFIG_DOC, { text: value, updatedAt }, { merge: false });
  const docValue = { text: value, updatedAt };
  conocimientoCache.set(docValue);
  return docValue;
}
