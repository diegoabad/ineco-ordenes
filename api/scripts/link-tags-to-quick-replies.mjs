/**
 * Vincula respuestas rápidas con las etiquetas que les corresponden
 * (sedes, coberturas, tratamientos, profesionales, general).
 *
 *   node scripts/link-tags-to-quick-replies.mjs
 *
 * Fusiona con las etiquetas ya asignadas (no las borra).
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

function tags(...names) {
  return names;
}

/** trigger o sourceTemplateId → nombres de etiqueta */
const REPLY_TO_TAGS = {
  // Profesionales
  abadi: tags("Dra. Abadi"),
  dra_abadi: tags("Dra. Abadi"),
  cetkovich: tags("Dr. Cetkovich"),
  dr_cetkovich: tags("Dr. Cetkovich"),
  alfredo_thomson: tags("Thomson Alfredo"),
  thomson_alfredo: tags("Thomson Alfredo"),
  gershanik: tags("Gershanik"),

  // Tratamientos
  tdah: tags("TDAH"),
  pda_tdah: tags("TDAH"),
  tdah_seguimiento: tags("TDAH", "Seguimiento"),
  taller_tdah: tags("Taller TDAH", "TDAH"),
  tea: tags("TEA"),
  pda_tea: tags("TEA"),
  asperger: tags("Asperger", "Autismo", "Adulto"),
  asperger_autismo_adultos: tags("Asperger", "Autismo", "Adulto"),
  panico: tags("Pánico y Ansiedad"),
  pda_ansiedad_panico: tags("Pánico y Ansiedad"),
  pda_psiquiatrico: tags("PDA Psiquiátrico"),
  pda_psq: tags("PDA Psiquiátrico"),
  mindfulness: tags("Mindfulness"),
  mindfulness_mbsr: tags("Mindfulness"),
  sueno: tags("Programa de Sueño"),
  programa_sueno: tags("Programa de Sueño"),
  orientacion_vocacional: tags("Orientación Vocacional"),
  nps_adultos: tags("NPS Adultos", "Adulto"),
  evaluacion_nps_adultos: tags("NPS Adultos", "Adulto"),
  nps_infantil: tags("NPS Infanto", "Infanto"),
  nps_infanto: tags("NPS Infanto", "Infanto"),
  evaluacion_nps_infanto: tags("NPS Infanto", "Infanto"),
  evaluacion_nps_infanto_alt: tags("NPS Infanto", "Infanto"),
  ados_adultos: tags("ADOS Adultos", "Adulto"),
  ados_infanto: tags("ADOS Infanto", "Infanto"),
  ados_adir_infanto: tags("ADOS Infanto", "Infanto"),
  neurodivergencia: tags("Neurodivergencia"),
  consultas_neurodivergencia: tags("Neurodivergencia"),
  psicologia: tags("Psicología"),
  psiquiatria: tags("Psiquiatría", "Adulto"),
  psq_hasta_60: tags("Psiquiatría", "Adulto"),
  psiquiatria_60: tags("Psiquiatría +60", "+60"),
  psq_mas_60: tags("Psiquiatría +60", "+60"),
  psiquiatria_infantil: tags("Psiquiatría Infantil", "Infanto"),
  psq_infanto_menor_13: tags("Psiquiatría Infantil", "Infanto"),
  psiquiatria_adolescente: tags("Psiquiatría Adolescente", "Adolescente"),
  psq_infanto_mas_13: tags("Psiquiatría Adolescente", "Adolescente"),
  neurologia_infantil: tags("Neurología Infantil", "Infanto"),
  cefalea: tags("Cefalea / Migraña"),
  cefaleas_migranas: tags("Cefalea / Migraña"),
  parkinson: tags("Parkinson"),
  movimientos_involuntarios_parkinson: tags("Parkinson"),
  olvidos: tags("Olvidos / Memoria"),
  neuro_deterioro_memoria: tags("Olvidos / Memoria"),
  mareos: tags("Mareos / Vértigo"),
  mareos_vertigo: tags("Mareos / Vértigo"),
  talleres: tags("Talleres"),
  capacitacion_talleres: tags("Talleres"),
  programas: tags("Pedido de info"),
  list_programas: tags("Pedido de info"),
  interes_programa: tags("Interesado"),
  ask_program_interest: tags("Interesado"),

  // Coberturas
  pami: tags("PAMI"),
  swiss: tags("Swiss Medical"),
  eval_swiss_medical: tags("Swiss Medical"),

  // Sedes
  caba: tags("CABA"),
  sede_central: tags("CABA"),
  turno_caba: tags("CABA", "Pedido de turno"),
  ask_caba_area: tags("CABA"),
  sede_caba_central: tags("CABA"),
  ask_caba_enabled_doctor: tags("CABA", "Pedido de turno"),
  cites: tags("CITES"),
  sede_cites: tags("CITES"),
  quilmes: tags("Quilmes"),
  sede_quilmes: tags("Quilmes"),
  ramos_mejia: tags("Ramos Mejía"),
  sede_ramos_mejia: tags("Ramos Mejía"),
  moreno: tags("Moreno"),
  sede_moreno: tags("Moreno"),
  temperley: tags("Temperley"),
  sede_temperley: tags("Temperley"),
  junin: tags("Junín"),
  sede_junin: tags("Junín"),
  rosario: tags("Rosario"),
  sede_rosario: tags("Rosario"),
  comodoro: tags("Comodoro Rivadavia"),
  sede_comodoro: tags("Comodoro Rivadavia"),
  pilar: tags("Pilar"),
  sede_pilar: tags("Pilar"),
  san_juan: tags("San Juan"),
  sede_san_juan: tags("San Juan"),
  ineco_casa: tags("INECO Casa"),
  ineco_u: tags("INECO U"),
  fundacion: tags("Fundación INECO"),
  fundacion_ineco: tags("Fundación INECO"),

  // General
  turno: tags("Pedido de turno"),
  ask_turno_sucursal: tags("Pedido de turno"),
  faltan_datos_turno: tags("Pedido de turno"),
  completar_pedido_turno: tags("Pedido de turno"),
  datos_completos: tags("Pedido de turno"),
  intake_complete_turnos: tags("Pedido de turno"),
  primera_vez: tags("Primera vez"),
  pedir_datos_clave_natural: tags("Primera vez"),
  pedido_de_datos_clave_legacy: tags("Primera vez"),
  pedir_datos_clave: tags("Primera vez"),
  saludo_paciente: tags("Paciente"),
  ask_welcome_paciente: tags("Paciente"),
  asesor: tags("Derivado a asesor"),
  derivacion_asesor_admin: tags("Derivado a asesor"),
  derivar: tags("Derivado a asesor"),
  derivacion_asesor: tags("Derivado a asesor"),
  consulta_compleja: tags("Derivado a asesor"),
  consultar_secretarias: tags("Derivado a asesor"),
  crisis_nerviosa: tags("Crisis", "Urgencia"),
  crisis_safety: tags("Crisis", "Urgencia"),
  suicidio: tags("Crisis", "Urgencia"),
  suicide_hotline: tags("Crisis", "Urgencia"),
  urgencia: tags("Urgencia"),
  medical_channel_disclaimer: tags("Urgencia"),
  fuera_tema: tags("Fuera de tema"),
  off_topic: tags("Fuera de tema"),
  fuera_tema_soft: tags("Fuera de tema"),
  off_topic_soft: tags("Fuera de tema"),
  retomar: tags("Retomar conversación"),
  retomar_conversacion_tarde: tags("Retomar conversación"),
};

async function main() {
  const now = new Date().toISOString();
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const tagsSnap = await getDoc(doc(db, "ordenes_config", "whatsapp_tags"));
  const tagsData = tagsSnap.exists() ? tagsSnap.data() : {};
  const tagItems = Array.isArray(tagsData.items) ? tagsData.items : [];
  const tagIdByName = new Map();
  for (const item of tagItems) {
    tagIdByName.set(normName(item.name), item.id);
  }

  const repliesRef = doc(db, "ordenes_config", "whatsapp_quick_replies");
  const repliesSnap = await getDoc(repliesRef);
  const items = Array.isArray(repliesSnap.data()?.items)
    ? [...repliesSnap.data().items]
    : [];

  let updated = 0;
  const missing = new Set();

  for (const row of items) {
    const trigger = String(row.trigger ?? "").trim().toLowerCase();
    const sourceId = String(row.sourceTemplateId ?? "").trim().toLowerCase();
    const names = [
      ...(REPLY_TO_TAGS[trigger] || []),
      ...(REPLY_TO_TAGS[sourceId] || []),
    ];
    if (!names.length) continue;

    const addIds = [];
    for (const name of names) {
      const id = tagIdByName.get(normName(name));
      if (!id) {
        missing.add(name);
        continue;
      }
      addIds.push(id);
    }
    if (!addIds.length) continue;

    const current = Array.isArray(row.tagIds) ? row.tagIds : [];
    const next = [...new Set([...current, ...addIds])];
    if (next.length === current.length && next.every((id, i) => id === current[i])) {
      continue;
    }
    if (
      next.length === current.length &&
      next.every((id) => current.includes(id))
    ) {
      continue;
    }
    row.tagIds = next;
    row.updatedAt = now;
    updated += 1;
    const label = next
      .map((id) => tagItems.find((t) => t.id === id)?.name || id)
      .join(", ");
    console.log(`/${trigger} → ${label}`);
  }

  if (missing.size) {
    console.warn("Etiquetas no encontradas:", [...missing].join(", "));
  }

  if (updated === 0) {
    console.log("Nada que actualizar.");
    return;
  }

  await setDoc(
    repliesRef,
    { items, updatedAt: now, source: "link-tags-to-quick-replies" },
    { merge: true },
  );
  console.log(`Actualizadas: ${updated} respuestas rápidas`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
