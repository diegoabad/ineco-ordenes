/**
 * Deja el grupo Coberturas solo con:
 * IOMA, Swiss Medical, OSPIS, Prevención, Particular, OS no soportada.
 *
 *   node scripts/sync-cobertura-tags.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { collection, doc, getDoc, getDocs, getFirestore, query, setDoc, updateDoc, where } from "firebase/firestore";

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

const KEEP = ["IOMA", "Swiss Medical", "OSPIS", "Prevención", "Particular", "OS no soportada"];

/** Nombres viejos → canónico (mismo id si se puede). */
const ALIAS_TO_CANON = new Map([
  ["swiss medical", "Swiss Medical"],
  ["prevencion", "Prevención"],
  ["prevención", "Prevención"],
  ["prevencion salud", "Prevención"],
  ["particular", "Particular"],
  ["sin cobertura", "OS no soportada"],
  ["sin convenio", "OS no soportada"],
  ["no soportada", "OS no soportada"],
  ["os no soportada", "OS no soportada"],
  ["cobertura no soportada", "OS no soportada"],
  ["ioma", "IOMA"],
  ["ospis", "OSPIS"],
]);

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

async function main() {
  const now = new Date().toISOString();
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const tagsRef = doc(db, "ordenes_config", "whatsapp_tags");
  const snap = await getDoc(tagsRef);
  if (!snap.exists()) {
    console.error("No hay catálogo whatsapp_tags");
    process.exit(1);
  }
  const data = snap.data() || {};
  const groups = Array.isArray(data.groups) ? [...data.groups] : [];
  const existingItems = Array.isArray(data.items) ? data.items : [];

  let grupo = groups.find((g) => norm(g.name) === "coberturas");
  if (!grupo) {
    grupo = {
      id: randomUUID(),
      name: "Coberturas",
      color: "#0d9488",
      createdAt: now,
      updatedAt: now,
    };
    groups.push(grupo);
    console.log("Creado grupo Coberturas");
  }

  const enGrupo = existingItems.filter((item) => item.groupId === grupo.id);
  const otros = existingItems.filter((item) => item.groupId !== grupo.id);

  /** id viejo → id canónico (para remapear conversaciones / quick replies). */
  const remapIds = new Map();
  const keepByNorm = new Map();

  for (const nombre of KEEP) {
    const n = norm(nombre);
    const aliases = [...ALIAS_TO_CANON.entries()]
      .filter(([, canon]) => norm(canon) === n)
      .map(([alias]) => alias);
    const encontrados = enGrupo.filter((item) => {
      const ni = norm(item.name);
      return ni === n || aliases.includes(ni) || ALIAS_TO_CANON.get(ni) === nombre;
    });
    let keep = encontrados.find((item) => norm(item.name) === n) || encontrados[0];
    if (keep) {
      keep = { ...keep, name: nombre, groupId: grupo.id, updatedAt: now };
      for (const item of encontrados) {
        if (item.id !== keep.id) remapIds.set(item.id, keep.id);
      }
    } else {
      keep = {
        id: randomUUID(),
        name: nombre,
        groupId: grupo.id,
        createdAt: now,
        updatedAt: now,
      };
      console.log(`+ ${nombre}`);
    }
    keepByNorm.set(n, keep);
  }

  const keptIds = new Set([...keepByNorm.values()].map((item) => item.id));
  const borradas = enGrupo.filter((item) => !keptIds.has(item.id) && !remapIds.has(item.id));
  for (const item of borradas) {
    console.log(`- ${item.name}`);
  }
  // Alias fusionados (se borran del catálogo pero se remapean).
  for (const [fromId, toId] of remapIds) {
    const from = enGrupo.find((item) => item.id === fromId);
    const to = [...keepByNorm.values()].find((item) => item.id === toId);
    if (from && to) console.log(`~ ${from.name} → ${to.name}`);
  }

  const items = [...otros, ...keepByNorm.values()].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "es"),
  );

  const remap = (ids) => [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => remapIds.get(id) || id)
        .filter((id) => {
          // quitar ids de coberturas eliminadas
          if (borradas.some((b) => b.id === id)) return false;
          return true;
        }),
    ),
  ];

  if (remapIds.size || borradas.length) {
    const repliesRef = doc(db, "ordenes_config", "whatsapp_quick_replies");
    const repliesSnap = await getDoc(repliesRef);
    const replies = Array.isArray(repliesSnap.data()?.items) ? repliesSnap.data().items : [];
    let repliesChanged = 0;
    const nextReplies = replies.map((row) => {
      const before = JSON.stringify(row.tagIds || []);
      const tagIds = remap(row.tagIds);
      if (JSON.stringify(tagIds) === before) return row;
      repliesChanged += 1;
      return { ...row, tagIds, updatedAt: now };
    });
    if (repliesChanged) {
      await setDoc(repliesRef, { items: nextReplies, updatedAt: now }, { merge: true });
    }

    const flowsRef = doc(db, "ordenes_config", "whatsapp_flows");
    const flowsSnap = await getDoc(flowsRef);
    const flows = Array.isArray(flowsSnap.data()?.items) ? flowsSnap.data().items : [];
    let flowsChanged = 0;
    const nextFlows = flows.map((row) => {
      const before = JSON.stringify(row.tagIds || []);
      const tagIds = remap(row.tagIds);
      if (JSON.stringify(tagIds) === before) return row;
      flowsChanged += 1;
      return { ...row, tagIds, updatedAt: now };
    });
    if (flowsChanged) {
      await setDoc(flowsRef, { items: nextFlows, updatedAt: now }, { merge: true });
    }

    let convChanged = 0;
    const idsAfectados = [...remapIds.keys(), ...borradas.map((b) => b.id)];
    for (const id of idsAfectados) {
      const convSnap = await getDocs(
        query(collection(db, "whatsapp_conversations"), where("tagIds", "array-contains", id)),
      );
      for (const conv of convSnap.docs) {
        await updateDoc(conv.ref, { tagIds: remap(conv.data()?.tagIds), updatedAt: now });
        convChanged += 1;
      }
    }

    console.log(
      `Remapeo: respuestas ${repliesChanged}, flujos ${flowsChanged}, conversaciones ${convChanged}`,
    );
  }

  await setDoc(
    tagsRef,
    { groups, items, updatedAt: now, source: "sync-cobertura-tags" },
    { merge: true },
  );

  console.log("Coberturas finales:");
  for (const nombre of KEEP) console.log(`  • ${nombre}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
