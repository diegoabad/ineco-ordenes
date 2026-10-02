/**
 * Vincula respuestas rápidas de coberturas con etiquetas del grupo Coberturas.
 *
 *   node scripts/link-cobertura-tags-to-quick-replies.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

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

function normName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

const COBERTURA_REPLY_TO_TAG = {
  pami: "PAMI",
  swiss: "Swiss Medical",
  eval_swiss_medical: "Swiss Medical",
};

async function main() {
  const now = new Date().toISOString();
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const tagsSnap = await getDoc(doc(db, "ordenes_config", "whatsapp_tags"));
  const tagsData = tagsSnap.exists() ? tagsSnap.data() : {};
  const groups = Array.isArray(tagsData.groups) ? tagsData.groups : [];
  const tagItems = Array.isArray(tagsData.items) ? tagsData.items : [];
  const cobGroup = groups.find((g) => normName(g.name) === "coberturas");
  if (!cobGroup) {
    console.error('No existe el grupo "Coberturas". Corré seed-whatsapp-tags-from-crm-bot.mjs');
    process.exit(1);
  }

  const tagIdByName = new Map();
  for (const item of tagItems) {
    if (item.groupId !== cobGroup.id) continue;
    tagIdByName.set(normName(item.name), item.id);
  }

  const repliesRef = doc(db, "ordenes_config", "whatsapp_quick_replies");
  const repliesSnap = await getDoc(repliesRef);
  const items = Array.isArray(repliesSnap.data()?.items)
    ? [...repliesSnap.data().items]
    : [];

  let updated = 0;
  for (const row of items) {
    const trigger = String(row.trigger ?? "").trim().toLowerCase();
    const sourceId = String(row.sourceTemplateId ?? "").trim().toLowerCase();
    const tagName =
      COBERTURA_REPLY_TO_TAG[trigger] ||
      COBERTURA_REPLY_TO_TAG[sourceId] ||
      null;
    if (!tagName) continue;
    const tagId = tagIdByName.get(normName(tagName));
    if (!tagId) {
      console.warn(`Sin etiqueta para /${trigger} → ${tagName}`);
      continue;
    }
    const current = Array.isArray(row.tagIds) ? row.tagIds : [];
    if (current.length === 1 && current[0] === tagId) continue;
    row.tagIds = [tagId];
    row.updatedAt = now;
    updated += 1;
    console.log(`/${trigger} → ${tagName}`);
  }

  if (updated === 0) {
    console.log("Nada que actualizar (ya estaban vinculadas).");
    return;
  }

  await setDoc(
    repliesRef,
    { items, updatedAt: now, source: "link-cobertura-tags" },
    { merge: true },
  );
  console.log(`Actualizadas: ${updated} respuestas rápidas`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
