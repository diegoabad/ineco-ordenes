/**
 * Migra IDs predecibles de pacientes (ej. seed-001) a UUID.
 *
 * Uso: npm run migrate:paciente-ids
 *      npm run migrate:paciente-ids:dry
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { collection, doc, getDocs, getFirestore, writeBatch } from "firebase/firestore";

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PACIENTES = "ordenes_pacientes";

const dryRun = process.argv.slice(2).includes("--dry-run");

function needsMigration(id) {
  return !UUID_RE.test(id);
}

function pacienteData(raw) {
  return {
    paciente: String(raw.paciente ?? ""),
    obraSocial: String(raw.obraSocial ?? ""),
    afiliado: String(raw.afiliado ?? ""),
    prestacion: String(raw.prestacion ?? ""),
    diagnostico: String(raw.diagnostico ?? ""),
    medicoId:
      typeof raw.medicoId === "string" && raw.medicoId.trim() ? raw.medicoId.trim() : null,
  };
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const snap = await getDocs(collection(db, PACIENTES));
  const pacientes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const toMigrate = pacientes.filter((p) => needsMigration(p.id));
  if (toMigrate.length === 0) {
    console.log("No hay pacientes con IDs predecibles. Nada que hacer.");
    return;
  }

  const idMap = new Map();
  for (const paciente of toMigrate) {
    idMap.set(paciente.id, randomUUID());
  }

  console.log(`Pacientes a migrar: ${toMigrate.length}${dryRun ? " (dry-run)" : ""}`);
  for (const [oldId, newId] of idMap) {
    const nombre = toMigrate.find((p) => p.id === oldId)?.paciente ?? "";
    console.log(`  ${oldId} → ${newId}${nombre ? ` (${nombre})` : ""}`);
  }

  const ops = [];
  for (const paciente of toMigrate) {
    const oldId = paciente.id;
    const newId = idMap.get(oldId);
    ops.push({ type: "delete", id: oldId });
    ops.push({ type: "set", id: newId, data: pacienteData(paciente) });
  }

  if (dryRun) {
    console.log(`\n[dry-run] Se aplicarían ${ops.length} operaciones en Firestore.`);
    return;
  }

  for (let i = 0; i < ops.length; i += 450) {
    const chunk = ops.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, PACIENTES, op.id);
      if (op.type === "delete") {
        batch.delete(ref);
      } else {
        batch.set(ref, op.data);
      }
    }
    await batch.commit();
  }

  console.log("\nOK → IDs de pacientes migrados a UUID.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
