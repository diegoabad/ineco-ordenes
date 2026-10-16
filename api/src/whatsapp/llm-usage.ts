import { randomUUID } from "node:crypto";
import { arrayUnion, doc, getDoc, updateDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

const CONVERSATIONS = "whatsapp_conversations";

export type LlmPaso = "detectar" | "responder";

export type LlmUsageRecord = {
  id: string;
  conversacionId: string;
  paso: LlmPaso;
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  tokensTotal: number;
  tokensCache: number;
  tokensRazonamiento: number;
  ok: boolean;
  error: string;
  creadoEn: string;
};

function asCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function asRecord(raw: unknown): LlmUsageRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const conversacionId = String(row.conversacionId ?? "").trim();
  const paso = row.paso === "responder" ? "responder" : row.paso === "detectar" ? "detectar" : "";
  if (!id || !conversacionId || !paso) return null;
  return {
    id,
    conversacionId,
    paso,
    modelo: String(row.modelo ?? ""),
    tokensEntrada: asCount(row.tokensEntrada),
    tokensSalida: asCount(row.tokensSalida),
    tokensTotal: asCount(row.tokensTotal),
    tokensCache: asCount(row.tokensCache),
    tokensRazonamiento: asCount(row.tokensRazonamiento),
    ok: row.ok === true,
    error: String(row.error ?? ""),
    creadoEn: String(row.creadoEn ?? ""),
  };
}

export async function recordLlmUsage(input: {
  conversacionId: string;
  paso: LlmPaso;
  modelo: string;
  tokensEntrada?: number;
  tokensSalida?: number;
  tokensTotal?: number;
  tokensCache?: number;
  tokensRazonamiento?: number;
  ok: boolean;
  error?: string;
}): Promise<LlmUsageRecord> {
  const tokensEntrada = asCount(input.tokensEntrada);
  const tokensSalida = asCount(input.tokensSalida);
  const record: LlmUsageRecord = {
    id: randomUUID(),
    conversacionId: input.conversacionId,
    paso: input.paso,
    modelo: input.modelo,
    tokensEntrada,
    tokensSalida,
    tokensTotal: asCount(input.tokensTotal) || tokensEntrada + tokensSalida,
    tokensCache: asCount(input.tokensCache),
    tokensRazonamiento: asCount(input.tokensRazonamiento),
    ok: input.ok,
    error: String(input.error ?? "").slice(0, 500),
    creadoEn: new Date().toISOString(),
  };
  await updateDoc(doc(firestore, CONVERSATIONS, input.conversacionId), {
    llmUsage: arrayUnion(record),
  });
  return record;
}

export async function listLlmUsageByConversation(conversacionId: string): Promise<LlmUsageRecord[]> {
  const id = conversacionId.trim();
  if (!id) return [];
  const snap = await getDoc(doc(firestore, CONVERSATIONS, id));
  if (!snap.exists()) return [];
  const raw = snap.data()?.llmUsage;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(asRecord)
    .filter((item): item is LlmUsageRecord => item !== null)
    .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}
