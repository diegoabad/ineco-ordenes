/**
 * Prueba E2E como en el CRM: crea conversación de prueba real en Firestore
 * y manda mensajes uno a uno por el mismo camino que Nina (runBotTurn + Medexis/OpenAI).
 *
 * Uso:
 *   npx tsx scripts/bot-prueba-humana.ts
 *   npx tsx scripts/bot-prueba-humana.ts --solo cetkovich
 */
import { randomUUID } from "node:crypto";
import {
  createMessage,
  createPruebaConversation,
  getConversation,
  listMessagesByConversation,
} from "../src/whatsapp/firestore-store.js";
import { runBotTurn, setBotDeliver } from "../src/whatsapp/bot-turn.js";

setBotDeliver(async (conversationId, text) => {
  const conversation = await getConversation(conversationId);
  if (!conversation?.contactId) throw new Error("Conversación de prueba no encontrada");
  await createMessage({
    conversationId,
    contactId: conversation.contactId,
    direction: "OUTBOUND",
    type: "TEXT",
    text,
    externalMessageId: `prueba-out-${randomUUID()}`,
    status: "SENT",
  });
});

type Paso = { user: string; chequear?: (bot: string[]) => string | null };

const escenarios: Record<string, { titulo: string; pasos: Paso[] }> = {
  cetkovich: {
    titulo: "Sedes → turno CABA → Cetkovich (el que falló en la UI)",
    pasos: [
      {
        user: "hola buenas noches, queria hacer una consulta?",
        chequear: (bot) =>
          bot.some((t) => /nina|ineco|buenas noches|hola/i.test(t))
            ? null
            : "no saludó / no se presentó",
      },
      {
        user: "que sucursales tenes?",
        chequear: (bot) => {
          const t = bot.join("\n");
          if (!/caba|quilmes|rosario/i.test(t)) return "no listó sedes";
          if (/sacar un turno|gustaría sacar/i.test(t)) {
            return `cerró ofreciendo sacar turno: «${bot.at(-1)}»`;
          }
          if (!/ayudar con algo más|necesitas algo más|algo más/i.test(t)) {
            return `cierre raro: «${bot.at(-1)}»`;
          }
          return null;
        },
      },
      {
        user: "me gustaria sacar un turno para la sucursal de caba",
        chequear: (bot) => {
          const t = bot.join("\n");
          if (/pasás el dni|pasas el dni|dni del paciente/i.test(t) && !/profesional/i.test(t)) {
            return `pidió DNI antes que profesional: «${bot.at(-1)}»`;
          }
          if (!/profesional/i.test(t)) return `no preguntó por profesional: «${bot.at(-1)}»`;
          return null;
        },
      },
      {
        user: "con Marcelo",
        chequear: (bot) => {
          const t = bot.join("\n");
          if (/buscás a cetkovich|buscas a cetkovich/i.test(t) && !/referís a|referis a/i.test(t)) {
            return `usó «Buscás a» en vez de «te referís a»: «${bot.join(" | ")}»`;
          }
          if (!/cetkovich/i.test(t)) return `no propuso Cetkovich: «${bot.join(" | ")}»`;
          if ((t.match(/cetkovich/gi) ?? []).length >= 2 && /buscás a|buscas a/i.test(t)) {
            return `parece duplicar la confirmación: «${bot.join(" | ")}»`;
          }
          return null;
        },
      },
      {
        user: "si",
        chequear: (bot) => {
          const t = bot.join("\n");
          if (/no hay un profesional habilitado|no figura entre los profesionales/i.test(t)) {
            return `rechazó a Cetkovich habilitado: «${bot.join(" | ")}»`;
          }
          if (!/tratamiento|consulta/i.test(t)) {
            return `después del sí no pidió tratamiento: «${bot.join(" | ")}»`;
          }
          return null;
        },
      },
    ],
  },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function decir(conversationId: string, contactId: string, texto: string): Promise<string[]> {
  const antes = await listMessagesByConversation(conversationId, 200);
  const vistos = new Set(antes.map((m) => m.id));
  await createMessage({
    conversationId,
    contactId,
    direction: "INBOUND",
    type: "TEXT",
    text: texto,
    externalMessageId: `prueba-in-${randomUUID()}`,
    status: "RECEIVED",
  });
  await runBotTurn(conversationId);
  const despues = await listMessagesByConversation(conversationId, 200);
  return despues
    .filter((m) => m.direction === "OUTBOUND" && !vistos.has(m.id))
    .map((m) => m.text.trim())
    .filter(Boolean);
}

async function correr(nombre: string, escenario: { titulo: string; pasos: Paso[] }) {
  console.log(`\n======== ${nombre}: ${escenario.titulo} ========`);
  const conv = await createPruebaConversation(
    { id: "script-humana", nombre: "Prueba humana script" },
    "ia",
  );
  console.log(`conversación ${conv.id}`);
  const fallos: string[] = [];

  for (const paso of escenario.pasos) {
    console.log(`\nUSER: ${paso.user}`);
    const bot = await decir(conv.id, conv.contactId, paso.user);
    if (!bot.length) {
      console.log("BOT: (sin respuesta)");
      fallos.push(`${paso.user} → sin respuesta`);
      continue;
    }
    for (const linea of bot) console.log(`BOT: ${linea}`);
    if (paso.chequear) {
      const mal = paso.chequear(bot);
      if (mal) {
        console.log(`MAL: ${mal}`);
        fallos.push(`${paso.user} → ${mal}`);
      } else {
        console.log("ok");
      }
    }
  }

  console.log(`\n--- fin ${nombre} | fallos ${fallos.length} ---`);
  for (const f of fallos) console.log(`- ${f}`);
  return fallos;
}

const solo = arg("--solo");
const elegidos = solo ? { [solo]: escenarios[solo]! } : escenarios;
if (solo && !escenarios[solo]) {
  console.error(`Escenario desconocido: ${solo}. Opciones: ${Object.keys(escenarios).join(", ")}`);
  process.exit(1);
}

const todos: string[] = [];
for (const [nombre, escenario] of Object.entries(elegidos)) {
  todos.push(...(await correr(nombre, escenario)));
}

if (todos.length) {
  console.log(`\nRESUMEN: ${todos.length} fallo(s)`);
  process.exit(1);
}
console.log("\nRESUMEN: todo ok");
