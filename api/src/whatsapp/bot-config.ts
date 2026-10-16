import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

const CONFIG_DOC = doc(firestore, "ordenes_config", "whatsapp_bot_config");

export type WhatsappBotConfigDoc = {
  data: Record<string, unknown>;
  /** JSON serializado: conserva el orden de claves (Firestore maps no lo garantizan). */
  json: string;
  updatedAt: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stripMeta(raw: Record<string, unknown>): Record<string, unknown> {
  const { updatedAt: _u, createdAt: _c, json: _j, data: _d, ...rest } = raw;
  return rest;
}

function parseJsonObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("JSON inválido");
  }
  if (!isPlainObject(parsed)) {
    throw new Error("El JSON debe ser un objeto { ... }");
  }
  return parsed;
}

export async function getWhatsappBotConfig(): Promise<WhatsappBotConfigDoc | null> {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) return null;
  const raw = snap.data() as Record<string, unknown>;

  // Preferir el string: mantiene el orden de secciones/claves.
  if (typeof raw.json === "string" && raw.json.trim()) {
    try {
      const data = parseJsonObject(raw.json);
      if (Object.keys(data).length === 0) return null;
      return {
        data,
        json: raw.json,
        updatedAt: String(raw.updatedAt ?? ""),
      };
    } catch {
      /* fallback a data map */
    }
  }

  const data = isPlainObject(raw.data)
    ? raw.data
    : isPlainObject(raw)
      ? stripMeta(raw)
      : null;
  if (!data || Object.keys(data).length === 0) return null;
  return {
    data,
    json: JSON.stringify(data, null, 2),
    updatedAt: String(raw.updatedAt ?? ""),
  };
}

export async function saveWhatsappBotConfig(input: {
  data?: Record<string, unknown>;
  json?: string;
}): Promise<WhatsappBotConfigDoc> {
  let data: Record<string, unknown>;
  let json: string;

  if (typeof input.json === "string" && input.json.trim()) {
    data = parseJsonObject(input.json);
    // Re-serializar desde el parse para validar; si el cliente mandó texto formateado, lo conservamos.
    json = input.json.trim();
    // Asegurar que el texto parsea al mismo objeto; si está mal formateado pero válido, ok.
    parseJsonObject(json);
  } else if (isPlainObject(input.data)) {
    data = input.data;
    json = JSON.stringify(data, null, 2);
  } else {
    throw new Error("La configuración debe ser un objeto JSON");
  }

  if (Object.keys(data).length === 0) {
    throw new Error("La configuración está vacía");
  }

  const updatedAt = new Date().toISOString();
  // Guardamos data + json: data para inspección; json es la fuente de verdad del orden.
  await setDoc(
    CONFIG_DOC,
    {
      data,
      json,
      updatedAt,
    },
    { merge: false },
  );
  return { data, json, updatedAt };
}
