/**
 * Importa plantillas de texto del CRM-BOT INECO como respuestas rápidas.
 *
 * Uso:
 *   node scripts/seed-quick-replies-from-crm-bot.mjs --replace
 *   node scripts/seed-quick-replies-from-crm-bot.mjs --path "C:/ruta/ineco-templates.json" --replace
 *
 * --replace: saca las importadas antes (por sourceTemplateId o id viejo) y vuelve a cargar
 *            con disparadores fáciles (triggers del JSON).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { initializeApp } from "firebase/app";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

const replace = process.argv.includes("--replace") || process.argv.includes("--force");
const pathIdx = process.argv.indexOf("--path");
const templatesPath =
  pathIdx >= 0 && process.argv[pathIdx + 1]
    ? path.resolve(process.argv[pathIdx + 1])
    : path.resolve(
        root,
        "..",
        "..",
        "CRM-BOT-INECO",
        "CRM-BOT-INECO",
        "api",
        "data",
        "bot-knowledge",
        "ineco-templates.json",
      );

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

function normalizeTrigger(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+/, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/** Palabras en inglés → español para disparadores usables. */
const EN_TO_ES = {
  welcome: "saludo",
  ask: "pedir",
  profile: "perfil",
  patient: "paciente",
  coverage: "cobertura",
  medical: "medico",
  channel: "canal",
  disclaimer: "aviso",
  suicide: "suicidio",
  hotline: "linea",
  crisis: "crisis",
  safety: "seguridad",
  handoff: "derivar",
  admin: "admin",
  enabled: "habilitado",
  doctor: "medico",
  doctors: "medicos",
  branch: "sede",
  branches: "sedes",
  program: "programa",
  programs: "programas",
  list: "listado",
  goodbye: "despedida",
  thanks: "gracias",
  anything: "algo",
  else: "mas",
  redirect: "redirigir",
  nudge: "recordatorio",
  initial: "inicial",
  help: "ayuda",
  appointment: "turno",
  appointments: "turnos",
  unit: "unidad",
  units: "unidades",
  area: "area",
  fee: "honorario",
  fees: "honorarios",
  interest: "interes",
  intake: "datos",
  provide: "enviar",
  data: "datos",
  operator: "asesor",
  off: "fuera",
  topic: "tema",
  unknown: "desconocido",
  menu: "menu",
  after: "despues",
  before: "antes",
  more: "mas",
  yes: "si",
  no: "no",
  confirm: "confirmar",
  cancel: "cancelar",
  schedule: "agenda",
  booking: "reserva",
  book: "reservar",
  reminder: "recordatorio",
  followup: "seguimiento",
  follow: "seguimiento",
  up: "",
  intro: "inicio",
  start: "inicio",
  end: "fin",
  close: "cerrar",
  open: "abrir",
  message: "mensaje",
  reply: "respuesta",
  quick: "rapida",
  template: "plantilla",
  flow: "flujo",
  step: "paso",
  info: "info",
  contact: "contacto",
  phone: "telefono",
  email: "mail",
  name: "nombre",
  age: "edad",
  address: "direccion",
  location: "ubicacion",
  schedule_preference: "horario",
  preference: "preferencia",
  referral: "derivacion",
  refer: "derivar",
  human: "humano",
  agent: "asesor",
  advisor: "asesor",
  receptionist: "recepcion",
  reception: "recepcion",
  central: "central",
  enabled_doctor: "medico_habilitado",
  caba: "caba",
  pda: "pda",
  tdah: "tdah",
  tea: "tea",
};

function spanishizeTrigger(value) {
  const base = normalizeTrigger(value);
  if (!base) return "";
  const parts = base.split("_").map((part) => {
    if (!part) return "";
    if (EN_TO_ES[part] !== undefined) return EN_TO_ES[part];
    return part;
  });
  return parts.filter(Boolean).join("_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}

function looksEnglishHeavy(trigger) {
  const suspicious = [
    "welcome",
    "ask",
    "profile",
    "coverage",
    "handoff",
    "nudge",
    "intake",
    "followup",
    "disclaimer",
    "hotline",
    "enabled",
    "doctor",
    "branch",
    "goodbye",
    "thanks",
    "redirect",
    "operator",
    "appointment",
  ];
  return suspicious.some((word) => trigger.split("_").includes(word) || trigger.includes(word));
}

function bodyFromTemplate(template) {
  const parts = Array.isArray(template.parts) ? [...template.parts] : [];
  parts.sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0));
  return parts
    .map((part) => String(part?.body ?? "").trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Prioriza triggers en español, cortos y usables. */
function pickEasyTrigger(template, used) {
  const overrides = {
    pda_tdah: "tdah",
    taller_tdah: "taller_tdah",
    pda_tea: "tea",
    pda_ansiedad_panico: "panico",
    pda_psq: "pda_psiquiatrico",
  };
  const rawCandidates = [
    overrides[String(template.id ?? "")] || null,
    ...(Array.isArray(template.triggers) ? template.triggers : []),
    template.title,
    template.id,
  ].filter(Boolean);

  const candidates = [];
  for (const raw of rawCandidates) {
    const es = spanishizeTrigger(raw);
    if (!es || es.length < 2 || es.length > 28) continue;
    if (looksEnglishHeavy(es)) continue;
    if (!candidates.includes(es)) candidates.push(es);
  }

  for (const trigger of candidates) {
    if (!used.has(trigger)) return trigger;
  }

  const base = spanishizeTrigger(template.id || template.title) || "mensaje";
  let n = 2;
  let candidate = `${base}_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base}_${n}`;
  }
  return candidate;
}

function suggestManualTrigger(row, used) {
  const trigger = normalizeTrigger(row?.trigger);
  const body = String(row?.body ?? "").toLowerCase();
  const title = String(row?.title ?? "").toLowerCase();
  if (
    trigger === "tdah" &&
    (body.includes("seguimiento") || title.includes("seguimiento"))
  ) {
    const next = "tdah_seguimiento";
    if (!used.has(next)) return next;
  }
  if (!trigger) return `mensaje_${randomUUID().slice(0, 8)}`;
  if (!used.has(trigger)) return trigger;
  let n = 2;
  let candidate = `${trigger}_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${trigger}_${n}`;
  }
  return candidate;
}

function toQuickReply(template, now, used) {
  const body = bodyFromTemplate(template);
  const sourceTemplateId = String(template.id ?? "").trim();
  if (!sourceTemplateId || !body) return null;
  const trigger = pickEasyTrigger(template, used);
  used.add(trigger);
  const title = String(template.title ?? "").trim();
  return {
    id: randomUUID(),
    trigger,
    title: title || null,
    body,
    tagIds: [],
    isActive: true,
    sourceTemplateId,
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  if (!fs.existsSync(templatesPath)) {
    console.error(`No se encontró el JSON:\n  ${templatesPath}`);
    console.error("Pasá --path con la ruta a ineco-templates.json");
    process.exit(1);
  }
  if (!replace) {
    console.error("Usá --replace para regenerar los disparadores fáciles (recomendado).");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(templatesPath, "utf8"));
  const templates = Array.isArray(raw.templates) ? raw.templates : [];
  const now = new Date().toISOString();
  const templateIds = new Set(
    templates.map((t) => normalizeTrigger(t?.id)).filter(Boolean),
  );

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const repliesRef = doc(db, "ordenes_config", "whatsapp_quick_replies");
  const snap = await getDoc(repliesRef);
  const existingRaw = snap.exists() ? snap.data()?.items : [];
  const existing = Array.isArray(existingRaw) ? existingRaw : [];

  // Conservar solo respuestas que NO vienen del CRM-BOT
  const keptRaw = existing.filter((row) => {
    const sourceId = String(row?.sourceTemplateId ?? "").trim();
    if (sourceId) return false;
    const trigger = normalizeTrigger(row?.trigger);
    if (templateIds.has(trigger)) return false;
    return true;
  });

  const used = new Set();
  const kept = [];
  for (const row of keptRaw) {
    const trigger = suggestManualTrigger(row, used);
    used.add(trigger);
    kept.push({
      ...row,
      trigger,
      updatedAt: trigger === normalizeTrigger(row?.trigger) ? row.updatedAt : now,
    });
    if (trigger !== normalizeTrigger(row?.trigger)) {
      console.log(`Manual: /${normalizeTrigger(row?.trigger)} → /${trigger}`);
    }
  }

  const imported = [];
  const skippedEmpty = [];
  const preview = [];

  for (const template of templates) {
    const item = toQuickReply(template, now, used);
    if (!item) {
      skippedEmpty.push(String(template?.id ?? "(sin id)"));
      continue;
    }
    imported.push(item);
    preview.push(`/${item.trigger}  ←  ${template.id}`);
  }

  const next = [...kept, ...imported].sort((a, b) =>
    String(a.trigger ?? "").localeCompare(String(b.trigger ?? ""), "es"),
  );

  // Seguridad: un solo item por disparador
  const unique = [];
  const seen = new Set();
  for (const item of next) {
    const trigger = normalizeTrigger(item.trigger);
    if (!trigger || seen.has(trigger)) {
      console.warn(`Duplicado omitido: /${trigger} (${item.sourceTemplateId || item.title || item.id})`);
      continue;
    }
    seen.add(trigger);
    unique.push({ ...item, trigger });
  }

  await setDoc(
    repliesRef,
    { items: unique, updatedAt: now, source: "crm-bot-ineco-templates" },
    { merge: true },
  );

  console.log(`Fuente: ${templatesPath}`);
  console.log(`Plantillas leídas: ${templates.length}`);
  console.log(`Importadas con disparador fácil: ${imported.length}`);
  console.log(`Conservadas (no CRM): ${kept.length}`);
  if (skippedEmpty.length) {
    console.log(`Sin texto (omitidas): ${skippedEmpty.join(", ")}`);
  }
  console.log(`Total respuestas rápidas ahora: ${unique.length}`);
  console.log("\nEjemplos:");
  for (const line of preview.slice(0, 12)) console.log(`  ${line}`);
  const tdah = unique.filter((item) => String(item.trigger).includes("tdah"));
  if (tdah.length) {
    console.log("\nTDAH:");
    for (const item of tdah) {
      console.log(`  /${item.trigger}  ←  ${item.sourceTemplateId || item.title || "manual"}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
