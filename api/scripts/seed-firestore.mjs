import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const MEDICOS = "ordenes_medicos";
const PACIENTES = "ordenes_pacientes";
const CONFIG = "ordenes_config";
const CONFIG_DOC = "main";

const seedFile = path.join(root, "data", "db.json");
const force = process.argv.includes("--force");

async function collectionEmpty(name) {
  const snap = await getDocs(query(collection(db, name), limit(1)));
  return snap.empty;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(seedFile, "utf8"));
  const medicos = Array.isArray(raw.medicos) ? raw.medicos : [];
  const pacientes = Array.isArray(raw.pacientes) ? raw.pacientes : [];

  const medicosVacios = await collectionEmpty(MEDICOS);
  const pacientesVacios = await collectionEmpty(PACIENTES);

  if (!force && !medicosVacios && !pacientesVacios) {
    console.log("Firestore ya tiene datos. Usá --force para reimportar.");
    process.exit(0);
  }

  console.log(`Importando ${medicos.length} médicos y ${pacientes.length} pacientes...`);

  // Firestore limita batches a 500 operaciones
  const chunks = [];
  const allOps = [];

  for (const medico of medicos) {
    allOps.push({
      type: "medico",
      id: String(medico.id),
      data: {
        nombre: String(medico.nombre ?? ""),
        especialidad: String(medico.especialidad ?? ""),
        matricula: String(medico.matricula ?? "").replace(/^MN\s*/i, "").trim(),
        firmaUrl: typeof medico.firmaUrl === "string" ? medico.firmaUrl : null,
      },
    });
  }

  for (const paciente of pacientes) {
    allOps.push({
      type: "paciente",
      id: String(paciente.id),
      data: {
        paciente: String(paciente.paciente ?? ""),
        obraSocial: String(paciente.obraSocial ?? ""),
        afiliado: String(paciente.afiliado ?? ""),
        prestacion: String(paciente.prestacion ?? ""),
        diagnostico: String(paciente.diagnostico ?? ""),
        medicoId:
          typeof paciente.medicoId === "string" && paciente.medicoId.trim()
            ? paciente.medicoId.trim()
            : null,
      },
    });
  }

  allOps.push({
    type: "config",
    id: CONFIG_DOC,
    data: {
      version: typeof raw.version === "number" ? raw.version : 1,
      medicoSeleccionadoId:
        typeof raw.medicoSeleccionadoId === "string" ? raw.medicoSeleccionadoId : null,
    },
  });

  for (let i = 0; i < allOps.length; i += 450) {
    chunks.push(allOps.slice(i, i + 450));
  }

  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.type === "medico") {
        batch.set(doc(db, MEDICOS, op.id), op.data);
      } else if (op.type === "paciente") {
        batch.set(doc(db, PACIENTES, op.id), op.data);
      } else {
        batch.set(doc(db, CONFIG, op.id), op.data);
      }
    }
    await batch.commit();
  }

  console.log("OK → datos importados en Firestore");
  console.log(`   Colecciones: ${MEDICOS}, ${PACIENTES}, ${CONFIG}`);
}

main().catch((err) => {
  if (err.code === "permission-denied") {
    console.error("\n✗ Firestore bloqueó el acceso (permission-denied).");
    console.error("  Publicá las reglas de api/firestore.rules en Firebase Console:");
    console.error("  Firestore → Reglas → pegar → Publicar");
    console.error("  Luego volvé a correr: npm run seed\n");
  } else {
    console.error(err);
  }
  process.exit(1);
});
