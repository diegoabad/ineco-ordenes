import { doc, getDoc, setDoc } from "firebase/firestore";
import { firestore } from "../config/firebase.js";

const CONFIG_DOC = doc(firestore, "ordenes_config", "whatsapp_motor_config");

export type WhatsappMotorConfig = {
  interpretacion: {
    detectarDatosAutomaticamente: boolean;
    detectarCambiosDeTema: boolean;
    detectarIntencion: boolean;
  };
  contexto: {
    reutilizarDatosConocidos: boolean;
    permitirCorrecciones: boolean;
    conservarContexto: boolean;
    evitarPreguntasRepetidas: boolean;
    omitirPreguntaSiMotivoConocido: boolean;
  };
  intenciones: {
    permitirCambiosDeIntencion: boolean;
    permitirInterrupciones: boolean;
    retomarIntencionAnterior: boolean;
  };
  tiempo: {
    incluirFechaHoraActual: boolean;
    interpretarFechasRelativas: boolean;
  };
  mensajeria: {
    agruparMensajes: boolean;
    evitarMensajesDuplicados: boolean;
  };
  seguridad: {
    detectarRiesgos: boolean;
    evaluacionPrioritaria: boolean;
  };
  administracion: {
    id: string;
    version: string;
  };
};

export type WhatsappMotorConfigDoc = {
  data: WhatsappMotorConfig;
  updatedAt: string;
};

export const DEFAULT_MOTOR_CONFIG: WhatsappMotorConfig = {
  interpretacion: {
    detectarDatosAutomaticamente: true,
    detectarCambiosDeTema: true,
    detectarIntencion: true,
  },
  contexto: {
    reutilizarDatosConocidos: true,
    permitirCorrecciones: true,
    conservarContexto: true,
    evitarPreguntasRepetidas: true,
    omitirPreguntaSiMotivoConocido: true,
  },
  intenciones: {
    permitirCambiosDeIntencion: true,
    permitirInterrupciones: true,
    retomarIntencionAnterior: true,
  },
  tiempo: {
    incluirFechaHoraActual: true,
    interpretarFechasRelativas: true,
  },
  mensajeria: {
    agruparMensajes: true,
    evitarMensajesDuplicados: true,
  },
  seguridad: {
    detectarRiesgos: true,
    evaluacionPrioritaria: true,
  },
  administracion: {
    id: "motor-ineco",
    version: "1",
  },
};

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function normalizeMotorConfig(raw: unknown): WhatsappMotorConfig {
  const root = pickObject(raw);
  const interpretacion = pickObject(root.interpretacion);
  const contexto = pickObject(root.contexto);
  const intenciones = pickObject(root.intenciones);
  const tiempo = pickObject(root.tiempo);
  const mensajeria = pickObject(root.mensajeria);
  const seguridad = pickObject(root.seguridad);
  const administracion = pickObject(root.administracion);
  const d = DEFAULT_MOTOR_CONFIG;

  return {
    interpretacion: {
      detectarDatosAutomaticamente: asBool(
        interpretacion.detectarDatosAutomaticamente,
        d.interpretacion.detectarDatosAutomaticamente,
      ),
      detectarCambiosDeTema: asBool(
        interpretacion.detectarCambiosDeTema,
        d.interpretacion.detectarCambiosDeTema,
      ),
      detectarIntencion: asBool(
        interpretacion.detectarIntencion,
        d.interpretacion.detectarIntencion,
      ),
    },
    contexto: {
      reutilizarDatosConocidos: asBool(
        contexto.reutilizarDatosConocidos,
        d.contexto.reutilizarDatosConocidos,
      ),
      permitirCorrecciones: asBool(
        contexto.permitirCorrecciones,
        d.contexto.permitirCorrecciones,
      ),
      conservarContexto: asBool(contexto.conservarContexto, d.contexto.conservarContexto),
      evitarPreguntasRepetidas: asBool(
        contexto.evitarPreguntasRepetidas,
        d.contexto.evitarPreguntasRepetidas,
      ),
      omitirPreguntaSiMotivoConocido: asBool(
        contexto.omitirPreguntaSiMotivoConocido,
        d.contexto.omitirPreguntaSiMotivoConocido,
      ),
    },
    intenciones: {
      permitirCambiosDeIntencion: asBool(
        intenciones.permitirCambiosDeIntencion,
        d.intenciones.permitirCambiosDeIntencion,
      ),
      permitirInterrupciones: asBool(
        intenciones.permitirInterrupciones,
        d.intenciones.permitirInterrupciones,
      ),
      retomarIntencionAnterior: asBool(
        intenciones.retomarIntencionAnterior,
        d.intenciones.retomarIntencionAnterior,
      ),
    },
    tiempo: {
      incluirFechaHoraActual: asBool(
        tiempo.incluirFechaHoraActual,
        d.tiempo.incluirFechaHoraActual,
      ),
      interpretarFechasRelativas: asBool(
        tiempo.interpretarFechasRelativas,
        d.tiempo.interpretarFechasRelativas,
      ),
    },
    mensajeria: {
      agruparMensajes: asBool(mensajeria.agruparMensajes, d.mensajeria.agruparMensajes),
      evitarMensajesDuplicados: asBool(
        mensajeria.evitarMensajesDuplicados,
        d.mensajeria.evitarMensajesDuplicados,
      ),
    },
    seguridad: {
      detectarRiesgos: asBool(seguridad.detectarRiesgos, d.seguridad.detectarRiesgos),
      evaluacionPrioritaria: asBool(
        seguridad.evaluacionPrioritaria,
        d.seguridad.evaluacionPrioritaria,
      ),
    },
    administracion: {
      id: asString(administracion.id, d.administracion.id).trim() || d.administracion.id,
      version:
        asString(administracion.version, d.administracion.version).trim() ||
        d.administracion.version,
    },
  };
}

export async function getWhatsappMotorConfig(): Promise<WhatsappMotorConfigDoc> {
  const snap = await getDoc(CONFIG_DOC);
  if (!snap.exists()) {
    return { data: DEFAULT_MOTOR_CONFIG, updatedAt: "" };
  }
  const raw = snap.data() as Record<string, unknown>;
  const payload = raw.data ?? raw;
  return {
    data: normalizeMotorConfig(payload),
    updatedAt: String(raw.updatedAt ?? ""),
  };
}

export async function saveWhatsappMotorConfig(
  data: unknown,
): Promise<WhatsappMotorConfigDoc> {
  const normalized = normalizeMotorConfig(data);
  const updatedAt = new Date().toISOString();
  const payload: WhatsappMotorConfigDoc = { data: normalized, updatedAt };
  await setDoc(CONFIG_DOC, payload, { merge: false });
  return payload;
}
