/**
 * Migra IDs predecibles de médicos (ej. medico-seed-001) a UUID.
 * Actualiza pacientes, config y renombra archivos de firma en disco.
 *
 * Uso: npm run migrate:medico-ids
 *      npm run migrate:medico-ids -- --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  writeBatch,
} from "firebase/firestore";

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

const MEDICOS = "ordenes_medicos";
const PACIENTES = "ordenes_pacientes";
const CONFIG = "ordenes_config";
const CONFIG_DOC = "main";

const dryRun = process.argv.slice(2).includes("--dry-run");
const firmasDir = path.join(root, "uploads", "firmas");

function needsMigration(id) {
  return !UUID_RE.test(id);
}

function newFirmaUrl(oldUrl, oldId, newId) {
  if (!oldUrl || typeof oldUrl !== "string") return null;
  if (oldUrl.includes(oldId)) {
    return oldUrl.replace(oldId, newId);
  }
  return `/uploads/firmas/${newId}.webp`;
}

function renameFirmaFile(oldId, newId) {
  const oldPath = path.join(firmasDir, `${oldId}.webp`);
  const newPath = path.join(firmasDir, `${newId}.webp`);
  if (!fs.existsSync(oldPath)) return false;
  if (dryRun) {
    console.log(`  [dry-run] Renombrar ${oldPath} → ${newPath}`);
    return true;
  }
  fs.renameSync(oldPath, newPath);
  return true;
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const medicosSnap = await getDocs(collection(db, MEDICOS));
  const medicos = medicosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const toMigrate = medicos.filter((m) => needsMigration(m.id));
  if (toMigrate.length === 0) {
    console.log("No hay médicos con IDs predecibles. Nada que hacer.");
    return;
  }

  const idMap = new Map();
  for (const medico of toMigrate) {
    idMap.set(medico.id, randomUUID());
  }

  console.log(`Médicos a migrar: ${toMigrate.length}${dryRun ? " (dry-run)" : ""}`);
  for (const [oldId, newId] of idMap) {
    console.log(`  ${oldId} → ${newId}`);
  }

  const pacientesSnap = await getDocs(collection(db, PACIENTES));
  const pacientes = pacientesSnap.docs.map((d) => ({ docId: d.id, ...d.data() }));

  const configSnap = await getDoc(doc(db, CONFIG, CONFIG_DOC));
  const config = configSnap.exists() ? configSnap.data() : {};

  const ops = [];

  for (const medico of toMigrate) {
    const oldId = medico.id;
    const newId = idMap.get(oldId);
    const firmaUrl = newFirmaUrl(medico.firmaUrl ?? null, oldId, newId);

    ops.push({ type: "delete", collection: MEDICOS, id: oldId });
    ops.push({
      type: "set",
      collection: MEDICOS,
      id: newId,
      data: {
        nombre: String(medico.nombre ?? ""),
        especialidad: String(medico.especialidad ?? ""),
        matricula: String(medico.matricula ?? ""),
        firmaUrl,
      },
    });

    renameFirmaFile(oldId, newId);
  }

  for (const paciente of pacientes) {
    const medicoId = paciente.medicoId;
    if (typeof medicoId === "string" && idMap.has(medicoId)) {
      ops.push({
        type: "merge",
        collection: PACIENTES,
        id: paciente.docId,
        data: { medicoId: idMap.get(medicoId) },
      });
    }
  }

  const selected = config.medicoSeleccionadoId;
  if (typeof selected === "string" && idMap.has(selected)) {
    ops.push({
      type: "merge",
      collection: CONFIG,
      id: CONFIG_DOC,
      data: { medicoSeleccionadoId: idMap.get(selected) },
    });
  }

  if (dryRun) {
    console.log(`\n[dry-run] Se aplicarían ${ops.length} operaciones en Firestore.`);
    return;
  }

  for (let i = 0; i < ops.length; i += 450) {
    const chunk = ops.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, op.collection, op.id);
      if (op.type === "delete") {
        batch.delete(ref);
      } else if (op.type === "set") {
        batch.set(ref, op.data);
      } else {
        batch.set(ref, op.data, { merge: true });
      }
    }
    await batch.commit();
  }

  console.log("\nOK → IDs migrados a UUID.");
  console.log("Los links viejos (/firmar/medico-seed-XXX) dejan de funcionar.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
