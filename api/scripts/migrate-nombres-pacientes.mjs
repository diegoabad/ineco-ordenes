/**
 * Normaliza nombres de pacientes y profesionales a minúsculas.
 * La UI / PDF muestra Title Case al renderizar.
 *
 * Uso: npm run migrate:nombres-pacientes
 *      npm run migrate:nombres-pacientes:dry
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { collection, doc, getDoc, getDocs, getFirestore, setDoc, writeBatch } from "firebase/firestore";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID,
};

for (const [key, value] of Object.entries(firebaseConfig)) {
  if (!value && key !== "measurementId") {
    console.error(`Falta ${key} en api/.env`);
    process.exit(1);
  }
}

const PACIENTES = "ordenes_pacientes";
const MEDICOS = "ordenes_medicos";
const PRESUPUESTOS = "presupuestos_emitidos";
const ENVIOS = "ordenes_email_envios";
const CONFIG = "ordenes_config";
const PRESUPUESTOS_CONFIG_DOC = "presupuestos";

const dryRun = process.argv.slice(2).includes("--dry-run");

function normalizeNombrePersona(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-AR");
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateCollection(colName, field) {
  const snap = await getDocs(collection(db, colName));
  const changes = [];
  for (const d of snap.docs) {
    const raw = d.data();
    const current = String(raw[field] ?? "");
    const next = normalizeNombrePersona(current);
    if (!next || next === current) continue;
    changes.push({ id: d.id, from: current, to: next });
  }

  console.log(`\n[${colName}.${field}] a corregir: ${changes.length}${dryRun ? " (dry-run)" : ""}`);
  for (const c of changes.slice(0, 20)) {
    console.log(`  ${c.id}: "${c.from}" → "${c.to}"`);
  }
  if (changes.length > 20) console.log(`  … y ${changes.length - 20} más`);

  if (dryRun || changes.length === 0) return changes.length;

  const BATCH = 400;
  for (let i = 0; i < changes.length; i += BATCH) {
    const batch = writeBatch(db);
    const slice = changes.slice(i, i + BATCH);
    for (const c of slice) {
      batch.update(doc(db, colName, c.id), { [field]: c.to });
    }
    await batch.commit();
  }
  return changes.length;
}

async function migratePresupuestosConfigProfesionales() {
  const ref = doc(db, CONFIG, PRESUPUESTOS_CONFIG_DOC);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    console.log("\n[ordenes_config/presupuestos] sin documento");
    return 0;
  }
  const data = snap.data();
  const profesionales = Array.isArray(data.profesionales) ? data.profesionales : [];
  let changed = 0;
  const next = profesionales.map((p) => {
    const current = String(p?.nombreApellido ?? p?.nombre ?? "");
    const nombreApellido = normalizeNombrePersona(current);
    if (nombreApellido && nombreApellido !== current) {
      changed += 1;
      console.log(`  profesional ${p?.id}: "${current}" → "${nombreApellido}"`);
      return { ...p, nombreApellido };
    }
    return p;
  });
  console.log(
    `\n[ordenes_config/presupuestos.profesionales] a corregir: ${changed}${dryRun ? " (dry-run)" : ""}`,
  );
  if (!dryRun && changed > 0) {
    await setDoc(ref, { ...data, profesionales: next }, { merge: true });
  }
  return changed;
}

async function main() {
  const n1 = await migrateCollection(PACIENTES, "paciente");
  const n2 = await migrateCollection(MEDICOS, "nombre");
  const n3 = await migrateCollection(PRESUPUESTOS, "nombrePaciente");
  const n4 = await migrateCollection(PRESUPUESTOS, "profesional");
  const n5 = await migrateCollection(ENVIOS, "pacienteNombre");
  const n6 = await migratePresupuestosConfigProfesionales();
  console.log(
    `\nTotal corregidos: ${n1 + n2 + n3 + n4 + n5 + n6}${dryRun ? " (dry-run, sin escribir)" : ""}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
