/**
 * Pruebas reales (aparecen en Prueba bot del CRM) para darTurnos sí/no,
 * en bot IA y bot menú.
 *
 * Uso:
 *   npx tsx scripts/bot-prueba-dar-turnos.ts
 *   npx tsx scripts/bot-prueba-dar-turnos.ts --only ia
 *   npx tsx scripts/bot-prueba-dar-turnos.ts --only menu
 *   npx tsx scripts/bot-prueba-dar-turnos.ts --mode no
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  botDaTurnos,
  getWhatsappBotConfig,
  saveWhatsappBotConfig,
} from "../src/whatsapp/bot-config.js";
import { setBotDeliver, runBotTurn } from "../src/whatsapp/bot-turn.js";
import { abrirBotMenu, runMenuTurn } from "../src/whatsapp/bot-menu.js";
import {
  createMessage,
  createPruebaConversation,
  getConversation,
  listMessagesByConversation,
} from "../src/whatsapp/firestore-store.js";
import { listWhatsappTagCatalog } from "../src/whatsapp/tags.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

setBotDeliver(async (conversationId, text) => {
  const conversation = await getConversation(conversationId);
  if (!conversation?.contactId) throw new Error("Conversación no encontrada");
  await createMessage({
    conversationId,
    contactId: conversation.contactId,
    direction: "OUTBOUND",
    type: "TEXT",
    text,
    externalMessageId: `dar-turnos-out-${randomUUID()}`,
    status: "SENT",
  });
});

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function conDarTurnos(data: Record<string, unknown>, dar: boolean): Record<string, unknown> {
  const prev =
    data.turnos && typeof data.turnos === "object" && !Array.isArray(data.turnos)
      ? (data.turnos as Record<string, unknown>)
      : {};
  return { ...data, turnos: { ...prev, darTurnos: dar } };
}

async function estadoTexto(conversationId: string, nombres: Map<string, string>): Promise<string> {
  const c = await getConversation(conversationId);
  if (!c) return "(sin conversación)";
  const etiquetas = (c.tagIds ?? []).map((id) => nombres.get(id) ?? id);
  return [
    `motor ${c.pruebaMotor || "ia"}`,
    `asignado ${c.assigneeKind}${c.assigneeName ? ` (${c.assigneeName})` : ""}`,
    `derivación ${c.derivacionPendiente ? "pendiente" : "no"}`,
    `dato ${c.datoPedido || "-"}`,
    `etiquetas ${etiquetas.length ? etiquetas.join(", ") : "(ninguna)"}`,
  ].join(" · ");
}

async function outboundNuevos(
  conversationId: string,
  vistos: Set<string>,
): Promise<string[]> {
  const msgs = await listMessagesByConversation(conversationId, 300);
  return msgs
    .filter((m) => m.direction === "OUTBOUND" && !vistos.has(m.id))
    .map((m) => {
      vistos.add(m.id);
      return m.text.trim();
    })
    .filter(Boolean);
}

async function decirIa(
  conversationId: string,
  contactId: string,
  texto: string,
  vistos: Set<string>,
): Promise<string[]> {
  await createMessage({
    conversationId,
    contactId,
    direction: "INBOUND",
    type: "TEXT",
    text: texto,
    externalMessageId: `dar-turnos-in-${randomUUID()}`,
    status: "RECEIVED",
  });
  await runBotTurn(conversationId);
  return outboundNuevos(conversationId, vistos);
}

async function decirMenu(
  conversationId: string,
  contactId: string,
  texto: string,
  vistos: Set<string>,
): Promise<string[]> {
  await createMessage({
    conversationId,
    contactId,
    direction: "INBOUND",
    type: "TEXT",
    text: texto,
    externalMessageId: `dar-turnos-menu-in-${randomUUID()}`,
    status: "RECEIVED",
  });
  await runMenuTurn(conversationId);
  return outboundNuevos(conversationId, vistos);
}

type Turno = { persona: string; bot: string[]; error?: string; estado: string };
type CasoReporte = {
  id: string;
  titulo: string;
  conversationId: string;
  darTurnos: boolean;
  motor: "ia" | "menu";
  turnos: Turno[];
  errorFatal?: string;
  ms: number;
  okEsperado?: string[];
};

async function correrIaConDar(
  dar: boolean,
  nombres: Map<string, string>,
): Promise<CasoReporte> {
  const id = dar ? "DT-IA-SI" : "DT-IA-NO";
  const t0 = Date.now();
  const reporte: CasoReporte = {
    id,
    titulo: dar
      ? "IA · dar turnos SÍ · pide turno y pregunta profesional"
      : "IA · dar turnos NO · aviso + toma datos + deriva",
    conversationId: "",
    darTurnos: dar,
    motor: "ia",
    turnos: [],
    ms: 0,
    okEsperado: dar
      ? ["profesional", "para vos"]
      : ["no puedo asignarte", "equipo", "edad|para vos|dni|nombre"],
  };
  try {
    const conv = await createPruebaConversation(
      { id: "prueba-dar-turnos", nombre: `DarTurnos IA ${dar ? "SI" : "NO"}` },
      "ia",
    );
    reporte.conversationId = conv.id;
    const vistos = new Set<string>();

    const lotes = dar
      ? [
          "Hola, quiero un turno",
          "Para mí",
          "35",
        ]
      : [
          "Hola, quiero un turno",
          "Para mí",
          "40",
          "Ana",
          "Pérez",
          "45999881",
        ];

    for (const texto of lotes) {
      let error = "";
      let bot: string[] = [];
      try {
        bot = await decirIa(conv.id, conv.contactId, texto, vistos);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      reporte.turnos.push({
        persona: texto,
        bot,
        error: error || undefined,
        estado: await estadoTexto(conv.id, nombres),
      });
      if (error) break;
    }
  } catch (err) {
    reporte.errorFatal = err instanceof Error ? err.message : String(err);
  }
  reporte.ms = Date.now() - t0;
  return reporte;
}

async function correrMenuConDar(
  dar: boolean,
  nombres: Map<string, string>,
): Promise<CasoReporte> {
  const id = dar ? "DT-MENU-SI" : "DT-MENU-NO";
  const t0 = Date.now();
  const reporte: CasoReporte = {
    id,
    titulo: dar
      ? "Menú · dar turnos SÍ · sacar turno llega a profesional"
      : "Menú · dar turnos NO · aviso + ficha + deriva a equipo",
    conversationId: "",
    darTurnos: dar,
    motor: "menu",
    turnos: [],
    ms: 0,
  };
  try {
    const conv = await createPruebaConversation(
      { id: "prueba-dar-turnos", nombre: `DarTurnos Menú ${dar ? "SI" : "NO"}` },
      "menu",
    );
    reporte.conversationId = conv.id;
    const vistos = new Set<string>();

    // Apertura
    await abrirBotMenu(conv.id);
    reporte.turnos.push({
      persona: "(apertura)",
      bot: await outboundNuevos(conv.id, vistos),
      estado: await estadoTexto(conv.id, nombres),
    });

    // 1 = CABA (primera sede suele ser CABA en la lista)
    const pasosSi = ["1", "1", "1", "45999881"];
    // sede → menú turnos → sacar → dni → (ficha…)
    const pasosNo = ["1", "1", "1", "45999881", "Ana", "Pérez", "1", "ana.prueba.nina@example.com"];

    const pasos = dar ? pasosSi : pasosNo;
    for (const texto of pasos) {
      let error = "";
      let bot: string[] = [];
      try {
        bot = await decirMenu(conv.id, conv.contactId, texto, vistos);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      reporte.turnos.push({
        persona: texto,
        bot,
        error: error || undefined,
        estado: await estadoTexto(conv.id, nombres),
      });
      if (error) break;
      // Si ya pidió profesional (modo sí) o ya derivó (modo no), cortar.
      const junto = bot.join("\n");
      if (dar && /profesional en especial|algunos médicos|Elegí un número/i.test(junto)) break;
      if (!dar && /equipo te va a escribir|asignar el turno lo antes posible/i.test(junto)) break;
    }
  } catch (err) {
    reporte.errorFatal = err instanceof Error ? err.message : String(err);
  }
  reporte.ms = Date.now() - t0;
  return reporte;
}

function renderMarkdown(reportes: CasoReporte[]): string {
  const lineas: string[] = [
    "# Prueba dar turnos (IA + menú) — conversaciones reales",
    "",
    `Casos: ${reportes.length}`,
    "",
  ];
  for (const caso of reportes) {
    lineas.push(`## ${caso.id} — ${caso.titulo}`, "");
    lineas.push(
      `darTurnos=${caso.darTurnos} · motor=${caso.motor} · conversación ${caso.conversationId || "(no)"} · ${caso.ms} ms`,
      "",
    );
    if (caso.errorFatal) lineas.push(`Error fatal: ${caso.errorFatal}`, "");
    for (const [i, t] of caso.turnos.entries()) {
      lineas.push(`### Paso ${i + 1}`, "");
      lineas.push("Persona:", `> ${t.persona}`, "");
      if (t.error) lineas.push(`Error: ${t.error}`, "");
      lineas.push(`Estado: ${t.estado}`, "");
      lineas.push("Respuesta:", t.bot.length ? t.bot.join("\n\n") : "(ninguna)", "");
    }
    lineas.push("---", "");
  }
  return lineas.join("\n");
}

async function main(): Promise<void> {
  const only = (arg("--only") ?? "ambos").toLowerCase();
  const modeArg = (arg("--mode") ?? "ambos").toLowerCase();
  const modos =
    modeArg === "si" || modeArg === "yes" || modeArg === "true"
      ? [true]
      : modeArg === "no" || modeArg === "false"
        ? [false]
        : [true, false];

  const original = await getWhatsappBotConfig();
  if (!original?.data || !Object.keys(original.data).length) {
    throw new Error("No hay configuración del bot en Firestore para modificar turnos.darTurnos");
  }
  const dataOriginal = original.data;
  const jsonOriginal = original.json;

  const catalogo = await listWhatsappTagCatalog();
  const nombres = new Map(catalogo.items.map((item) => [item.id, item.name]));

  const reportes: CasoReporte[] = [];
  try {
    for (const dar of modos) {
      console.log(`\n=== Configurando darTurnos=${dar} (antes era ${botDaTurnos(dataOriginal)}) ===`);
      await saveWhatsappBotConfig({
        data: conDarTurnos(dataOriginal, dar),
      });

      if (only === "ambos" || only === "ia") {
        console.log(`Corriendo IA darTurnos=${dar}…`);
        const r = await correrIaConDar(dar, nombres);
        reportes.push(r);
        console.log(
          `${r.errorFatal || r.turnos.some((t) => t.error) ? "ERR" : "ok "} ${r.id} ${Math.round(r.ms / 1000)}s → ${r.conversationId}`,
        );
      }
      if (only === "ambos" || only === "menu") {
        console.log(`Corriendo Menú darTurnos=${dar}…`);
        const r = await correrMenuConDar(dar, nombres);
        reportes.push(r);
        console.log(
          `${r.errorFatal || r.turnos.some((t) => t.error) ? "ERR" : "ok "} ${r.id} ${Math.round(r.ms / 1000)}s → ${r.conversationId}`,
        );
      }
    }
  } finally {
    console.log("\nRestaurando configuración original…");
    await saveWhatsappBotConfig({ data: dataOriginal, json: jsonOriginal });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, "tests", "bateria", "reportes", stamp);
  await mkdir(dir, { recursive: true });
  const reportePath = path.join(dir, "reporte-dar-turnos.md");
  await writeFile(reportePath, renderMarkdown(reportes), "utf8");

  console.log(`\nListo. Conversaciones creadas:`);
  for (const r of reportes) {
    console.log(`- ${r.id}: ${r.conversationId}`);
  }
  console.log(`\n${reportePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
