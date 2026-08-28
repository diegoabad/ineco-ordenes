import fs from "node:fs";
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

const PRESTACIONES = "presupuestos_prestaciones";
const seedFile = path.join(root, "data", "prestaciones-seed.json");
const force = process.argv.includes("--force");

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function toMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  return 0;
}

async function main() {
  const items = JSON.parse(fs.readFileSync(seedFile, "utf8"));
  if (!Array.isArray(items) || items.length === 0) {
    console.error("No hay prestaciones en el archivo seed.");
    process.exit(1);
  }

  const existingSnap = await getDocs(collection(db, PRESTACIONES));
  const existingIds = new Set(existingSnap.docs.map((d) => d.id));

  if (existingIds.size > 0 && !force) {
    const nuevas = items.filter((p) => !existingIds.has(String(p.id)));
    if (nuevas.length === 0) {
      console.log("Todas las prestaciones del seed ya existen. Usá --force para reimportar.");
      process.exit(0);
    }
    console.log(`Importando ${nuevas.length} prestaciones nuevas (${existingIds.size} ya existían)...`);
    await importBatch(nuevas);
    console.log("OK → prestaciones importadas");
    return;
  }

  if (force && existingIds.size > 0) {
    console.log(`Reimportando ${items.length} prestaciones (--force)...`);
  } else {
    console.log(`Importando ${items.length} prestaciones...`);
  }

  await importBatch(items);
  console.log("OK → prestaciones importadas");
}

function toMinutes(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  return 0;
}

async function importBatch(items) {
  for (let i = 0; i < items.length; i += 450) {
    const chunk = items.slice(i, i + 450);
    const batch = writeBatch(db);
    for (const raw of chunk) {
      const id = String(raw.id ?? "").trim();
      if (!id) continue;
      batch.set(doc(db, PRESTACIONES, id), {
        titulo: String(raw.titulo ?? "").trim(),
        descripcion: String(raw.descripcion ?? "").trim(),
        tipo: String(raw.tipo ?? "").trim() || "Evaluación",
        duracionMinutos: toMinutes(raw.duracionMinutos),
        precioEfectivo: toMoney(raw.precioEfectivo),
        precio3Cuotas: toMoney(raw.precio3Cuotas),
      });
    }
    await batch.commit();
  }
}

main().catch((err) => {
  if (err.code === "permission-denied") {
    console.error("\n✗ Firestore bloqueó el acceso (permission-denied).");
    console.error("  Publicá las reglas con presupuestos_prestaciones en Firebase Console.");
    console.error("  Luego volvé a correr: npm run seed:prestaciones\n");
  } else {
    console.error(err);
  }
  process.exit(1);
});
