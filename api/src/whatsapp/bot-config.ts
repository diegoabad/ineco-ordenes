import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";
import { createTtlCache } from "../lib/ttl-cache.js";

const CONFIG_DOC = doc(firestore, "ordenes_config", "whatsapp_bot_config");

export type WhatsappBotConfigDoc = {
  data: Record<string, unknown>;
  /** JSON serializado: conserva el orden de claves (Firestore maps no lo garantizan). */
  json: string;
  updatedAt: string;
};

const botConfigCache = createTtlCache<WhatsappBotConfigDoc | null>(10 * 60_000);

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
  const cached = botConfigCache.get();
  if (cached !== undefined) return cached;
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    botConfigCache.set(null);
    return null;
  }
  const raw = snap.data() as Record<string, unknown>;

  // Preferir el string: mantiene el orden de secciones/claves.
  if (typeof raw.json === "string" && raw.json.trim()) {
    try {
      const data = parseJsonObject(raw.json);
      if (Object.keys(data).length === 0) {
        botConfigCache.set(null);
        return null;
      }
      const docValue = {
        data,
        json: raw.json,
        updatedAt: String(raw.updatedAt ?? ""),
      };
      botConfigCache.set(docValue);
      return docValue;
    } catch {
      /* fallback a data map */
    }
  }

  const data = isPlainObject(raw.data)
    ? raw.data
    : isPlainObject(raw)
      ? stripMeta(raw)
      : null;
  if (!data || Object.keys(data).length === 0) {
    botConfigCache.set(null);
    return null;
  }
  const docValue = {
    data,
    json: JSON.stringify(data, null, 2),
    updatedAt: String(raw.updatedAt ?? ""),
  };
  botConfigCache.set(docValue);
  return docValue;
}

/**
 * Si el bot puede buscar profesionales, horarios libres y reservar turnos.
 * Default: true (comportamiento actual). Se lee de `turnos.darTurnos` o `darTurnos`.
 */
export function botDaTurnos(bot: Record<string, unknown> | null | undefined): boolean {
  const seccion =
    bot?.turnos && typeof bot.turnos === "object" && !Array.isArray(bot.turnos)
      ? (bot.turnos as Record<string, unknown>)
      : {};
  const raw = seccion.darTurnos ?? bot?.darTurnos;
  if (raw === false || raw === 0 || raw === "0" || raw === "no" || raw === "false") return false;
  if (raw === true || raw === 1 || raw === "1" || raw === "si" || raw === "sí" || raw === "true") {
    return true;
  }
  return true;
}

export const TEXTO_TURNO_SIN_ASIGNAR =
  "Por este canal no puedo asignarte el turno ahora: lo va a dar una persona del equipo lo antes posible. Mientras tanto te voy a pedir unos datos para que sea más rápido.";

function despedidaHorario(now = new Date()): string {
  const hora = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  if (hora >= 6 && hora < 12) return "¡Que tengas un buen día!";
  if (hora >= 12 && hora < 20) return "¡Que tengas buenas tardes!";
  return "¡Que tengas buenas noches!";
}

/** Cierre tras confirmar el pedido de turno (despedida según horario AR). */
export function textoTurnoDatosListos(now = new Date()): string {
  return [
    "Perfecto. A la brevedad, alguien del equipo de INECO se va a comunicar con vos para comentarte las opciones de turnos disponibles y coordinarlo.",
    "",
    despedidaHorario(now),
  ].join("\n");
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
  const docValue = { data, json, updatedAt };
  botConfigCache.set(docValue);
  return docValue;
}
