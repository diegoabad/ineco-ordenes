import { initializeApp } from "firebase/app";
import { initializeFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";

loadEnv();

const SEEDS = [
  {
    clave: "INFO_SUCURSALES",
    nombre: "Información de sucursales",
    descripcion:
      "Consultas sobre ubicaciones, direcciones, horarios de atención y datos de contacto de las sucursales de INECO.",
  },
  {
    clave: "INFO_PROFESIONALES",
    nombre: "Información de profesionales",
    descripcion:
      "Consultas sobre médicos y profesionales, sus especialidades, tratamientos que realizan, sedes y modalidades de atención.",
  },
  {
    clave: "INFO_TRATAMIENTOS",
    nombre: "Información de tratamientos",
    descripcion:
      "Consultas sobre tratamientos, evaluaciones y prestaciones de INECO, incluyendo descripción, duración, requisitos, precios, cobertura médica y destinatarios.",
  },
  {
    clave: "TURNOS",
    nombre: "Gestión de turnos",
    descripcion:
      "Solicitudes para obtener, consultar, cancelar o reprogramar turnos, incluyendo consultas sobre disponibilidad de profesionales, fechas y horarios.",
  },
  {
    clave: "QUEJAS",
    nombre: "Quejas y reclamos",
    descripcion:
      "Registro y seguimiento de quejas, reclamos o inconvenientes relacionados con la atención, profesionales, turnos o servicios de INECO.",
  },
  {
    clave: "URGENCIAS_EMERGENCIAS",
    nombre: "Urgencias y emergencias",
    descripcion:
      "Detecta consultas o situaciones que podrían requerir atención inmediata, incluyendo emergencias médicas, crisis de salud mental, riesgo suicida, autolesiones u otras situaciones críticas. Activa el protocolo de orientación y derivación correspondiente.",
    prioridad: "CRITICA",
  },
];

function normalizeClave(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

const app = initializeApp({
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
});

const firestore = initializeFirestore(app, { experimentalForceLongPolling: true });
const ref = doc(firestore, "ordenes_config", "whatsapp_intenciones");
const snap = await getDoc(ref);
const existing = Array.isArray(snap.data()?.items) ? snap.data().items : [];
const byClave = new Set(
  existing.map((item) => normalizeClave(item?.clave ?? item?.key ?? "")).filter(Boolean),
);

const now = new Date().toISOString();
const created = [];
const skipped = [];

for (const seed of SEEDS) {
  const clave = normalizeClave(seed.clave);
  if (byClave.has(clave)) {
    skipped.push(clave);
    continue;
  }
  created.push({
    id: randomUUID(),
    nombre: seed.nombre,
    clave,
    descripcion: seed.descripcion ?? "",
    prioridad: seed.prioridad ? String(seed.prioridad).toUpperCase() : null,
    createdAt: now,
    updatedAt: now,
  });
  byClave.add(clave);
}

if (created.length) {
  await setDoc(
    ref,
    { items: [...existing, ...created], updatedAt: now },
    { merge: true },
  );
}

console.log(JSON.stringify({ created: created.map((c) => c.clave), skipped }, null, 2));
process.exit(0);
