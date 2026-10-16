import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

const CONFIG_DOC = doc(firestore, "ordenes_config", "whatsapp_conocimiento");

const MAX_CHARS = 200_000;

export type WhatsappConocimientoDoc = {
  text: string;
  updatedAt: string;
};

export async function getWhatsappConocimiento(): Promise<WhatsappConocimientoDoc> {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) return { text: "", updatedAt: "" };
  const raw = snap.data() as Record<string, unknown>;
  return {
    text: typeof raw.text === "string" ? raw.text : "",
    updatedAt: String(raw.updatedAt ?? ""),
  };
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
  return { text: value, updatedAt };
}
