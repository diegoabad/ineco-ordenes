/**
 * Crea etiquetas WhatsApp a partir de sedes / profesionales / tratamientos / general.
 *
 *   node scripts/seed-whatsapp-tags-from-crm-bot.mjs
 *   node scripts/seed-whatsapp-tags-from-crm-bot.mjs --replace
 *
 * Por defecto solo agrega las que faltan (por nombre dentro del grupo).
 * --replace: reemplaza el catálogo completo por este set (conserva ids si coinciden nombres).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const replace = process.argv.includes("--replace");

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

const GROUP_DEFS = [
  { key: "general", name: "General", color: "#06b6d4" },
  { key: "profesionales", name: "Profesionales", color: "#f97316" },
  { key: "sedes", name: "Sedes", color: "#a61948" },
  { key: "coberturas", name: "Coberturas", color: "#0d9488" },
  { key: "tratamientos", name: "Tratamientos", color: "#8b5cf6" },
];

const TAGS_BY_GROUP = {
  profesionales: [
    "Dra. Abadi",
    "Dr. Cetkovich",
    "Thomson Alfredo",
    "Gershanik",
  ],
  sedes: [
    "CABA",
    "CITES",
    "Quilmes",
    "Ramos Mejía",
    "Moreno",
    "Temperley",
    "Junín",
    "Rosario",
    "Comodoro Rivadavia",
    "Pilar",
    "San Juan",
    "INECO Casa",
    "INECO U",
    "Fundación INECO",
  ],
  coberturas: [
    "OSDE",
    "Swiss Medical",
    "Galeno",
    "Medicus",
    "Omint",
    "PAMI",
    "Con cobertura",
    "Sin cobertura",
  ],
  tratamientos: [
    "TDAH",
    "Taller TDAH",
    "TEA",
    "Autismo",
    "Asperger",
    "Pánico y Ansiedad",
    "PDA Psiquiátrico",
    "Mindfulness",
    "Programa de Sueño",
    "Orientación Vocacional",
    "NPS Adultos",
    "NPS Infanto",
    "ADOS Adultos",
    "ADOS Infanto",
    "Neurodivergencia",
    "Psicología",
    "Psiquiatría",
    "Psiquiatría +60",
    "Psiquiatría Infantil",
    "Psiquiatría Adolescente",
    "Neurología Infantil",
    "Cefalea / Migraña",
    "Parkinson",
    "Olvidos / Memoria",
    "Mareos / Vértigo",
    "Talleres",
  ],
  general: [
    "Oportunidad",
    "Paciente",
    "No paciente",
    "Familiar / acompañante",
    "Con diagnóstico",
    "Sin diagnóstico",
    "Infanto",
    "Adolescente",
    "Adulto",
    "+60",
    "Primera vez",
    "Seguimiento",
    "Interesado",
    "Pedido de turno",
    "Pedido de info",
    "Derivado a asesor",
    "Urgencia",
    "Crisis",
    "Fuera de tema",
    "Retomar conversación",
  ],
};

/** Nombres duplicados que no se conservan (se fusionan con la canónica). */
const DROP_ALIAS_NAMES = new Set(["particular"]);

function normName(value) {
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
  const existing = snap.exists() ? snap.data() : {};
  const existingGroups = Array.isArray(existing.groups) ? existing.groups : [];
  const existingItems = Array.isArray(existing.items) ? existing.items : [];

  const groups = [];
  const groupIdByKey = new Map();

  for (const def of GROUP_DEFS) {
    const found = existingGroups.find((g) => normName(g.name) === normName(def.name));
    const group = found
      ? {
          ...found,
          name: def.name,
          color: found.color || def.color,
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          name: def.name,
          color: def.color,
          createdAt: now,
          updatedAt: now,
        };
    groups.push(group);
    groupIdByKey.set(def.key, group.id);
  }

  // Conservar grupos extra que no están en el seed (si no es --replace)
  if (!replace) {
    for (const group of existingGroups) {
      if (groups.some((g) => g.id === group.id || normName(g.name) === normName(group.name))) {
        continue;
      }
      groups.push(group);
    }
  }

  const items = [];
  const usedIds = new Set();
  let added = 0;
  let kept = 0;
  let moved = 0;

  // Nombres canónicos del seed (cualquier grupo) → evita duplicados al mover
  const seededNames = new Set(
    Object.values(TAGS_BY_GROUP)
      .flat()
      .map((name) => normName(name)),
  );

  for (const [groupKey, names] of Object.entries(TAGS_BY_GROUP)) {
    const groupId = groupIdByKey.get(groupKey);
    if (!groupId) continue;
    for (const name of names) {
      const found =
        existingItems.find(
          (item) =>
            item.groupId === groupId &&
            normName(item.name) === normName(name) &&
            !usedIds.has(item.id),
        ) ||
        existingItems.find(
          (item) =>
            normName(item.name) === normName(name) && !usedIds.has(item.id),
        );
      if (found) {
        usedIds.add(found.id);
        const relocated = found.groupId !== groupId;
        items.push({
          ...found,
          name,
          groupId,
          updatedAt: relocated ? now : found.updatedAt || now,
        });
        if (relocated) moved += 1;
        else kept += 1;
      } else {
        const id = randomUUID();
        usedIds.add(id);
        items.push({
          id,
          name,
          groupId,
          createdAt: now,
          updatedAt: now,
        });
        added += 1;
      }
    }
  }

  if (!replace) {
    for (const item of existingItems) {
      if (usedIds.has(item.id)) continue;
      // no conservar huérfanas cuya secuencia canónica ya está en el seed
      if (seededNames.has(normName(item.name))) continue;
      if (DROP_ALIAS_NAMES.has(normName(item.name))) continue;
      if (groups.some((g) => g.id === item.groupId)) {
        items.push(item);
        kept += 1;
      }
    }
  }

  items.sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  groups.sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));

  const keepSinCobertura = items.find((item) => normName(item.name) === "sin cobertura");
  const dropParticular = existingItems.find((item) => normName(item.name) === "particular");
  const fromId = dropParticular?.id;
  const toId = keepSinCobertura?.id;

  if (fromId && toId && fromId !== toId) {
    const remap = (ids) => [
      ...new Set((Array.isArray(ids) ? ids : []).map((id) => (id === fromId ? toId : id)).filter(Boolean)),
    ];

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

    const convSnap = await getDocs(
      query(collection(db, "whatsapp_conversations"), where("tagIds", "array-contains", fromId)),
    );
    let convChanged = 0;
    for (const conv of convSnap.docs) {
      await updateDoc(conv.ref, { tagIds: remap(conv.data()?.tagIds), updatedAt: now });
      convChanged += 1;
    }

    console.log(
      `Fusionadas: Particular → Sin cobertura (respuestas ${repliesChanged}, flujos ${flowsChanged}, conversaciones ${convChanged})`,
    );
  }

  await setDoc(
    tagsRef,
    { groups, items, updatedAt: now, source: "crm-bot-seed-tags" },
    { merge: true },
  );

  console.log(`Grupos: ${groups.length}`);
  for (const group of groups) {
    const count = items.filter((item) => item.groupId === group.id).length;
    console.log(`  - ${group.name}: ${count} etiquetas`);
  }
  console.log(`Agregadas: ${added}`);
  console.log(`Movidas de grupo: ${moved}`);
  console.log(`Conservadas/reutilizadas: ${kept}`);
  console.log(`Total etiquetas: ${items.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
